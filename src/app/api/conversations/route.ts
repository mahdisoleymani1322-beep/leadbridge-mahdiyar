import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getStore } from "@/lib/store";
import type {
  Conversation,
  ConversationSentiment,
  ConversationState,
  LeadStatus,
} from "@/lib/store/types";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { recordDecision } from "@/lib/audit";
import { handleBulkDelete } from "@/lib/delete-route";

export const dynamic = "force-dynamic";

/**
 * ثبت پاسخ بیزینس و پیگیری — روی جدول `conversations` که از فاز ۱ خالی مانده بود.
 *
 * جدا از `lead_feedback` می‌ماند و با آن قاطی نمی‌شود:
 *   • conversations = «بیزینس چه گفت» (پیگیری و قیف فروش)
 *   • lead_feedback = «کیفیت خودِ پیام ما چطور بود» (ورودی خام خودبهبودی)
 */

const STATES: ConversationState[] = ["no_reply", "replied", "meeting", "closed"];
const SENTIMENTS: ConversationSentiment[] = ["positive", "neutral", "negative"];

/**
 * اثر قطعی وضعیت گفت‌وگو روی State Machine لید — **کد، نه مدل**.
 *
 * `closed` عمداً نگاشت ندارد: بسته‌شدن گفت‌وگو می‌تواند هم موفق باشد هم ناموفق،
 * و «تبدیل شد» تصمیم صریح جدایی است (`converted: true`).
 */
const STATE_TO_LEAD_STATUS: Partial<Record<ConversationState, LeadStatus>> = {
  replied: "REPLIED",
  meeting: "HANDOVER_READY",
};

/** GET /api/conversations?leadId= — گفت‌وگوی یک لید یا همه */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId") || undefined;
  const conversations = await getStore().listConversations({ leadId });
  return Response.json({ conversations });
}

/**
 * PUT /api/conversations — ثبت/به‌روزرسانی پاسخ و پیگیری یک لید (upsert).
 *
 * بدنه: { leadId, conversationState?, sentiment?, summary?, nextAction?,
 *         nextActionAt?, handoverRequired?, converted? }
 */
export async function PUT(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  if (!leadId) return Response.json({ error: "leadId لازم است." }, { status: 400 });

  const store = getStore();
  const lead = await store.getLead(leadId);
  if (!lead) return Response.json({ error: "لید یافت نشد." }, { status: 404 });

  const conversationState: ConversationState | null = STATES.includes(body.conversationState)
    ? body.conversationState
    : null;
  const sentiment: ConversationSentiment | null = SENTIMENTS.includes(body.sentiment)
    ? body.sentiment
    : null;
  const converted = body.converted === true;
  const handoverRequired = body.handoverRequired === true;

  const now = new Date().toISOString();
  const existing = await store.getConversation(leadId);
  const statusBefore = lead.status;

  const next: Conversation = {
    id: existing?.id ?? randomUUID(),
    leadId,
    channel: lead.preferredChannel,
    conversationState: conversationState ?? existing?.conversationState ?? null,
    summary: typeof body.summary === "string" ? body.summary.trim() : existing?.summary ?? null,
    sentiment: sentiment ?? existing?.sentiment ?? null,
    intent: typeof body.intent === "string" ? body.intent.trim() : existing?.intent ?? null,
    nextAction:
      typeof body.nextAction === "string" ? body.nextAction.trim() : existing?.nextAction ?? null,
    nextActionAt:
      typeof body.nextActionAt === "string" && body.nextActionAt
        ? body.nextActionAt
        : existing?.nextActionAt ?? null,
    handoverRequired: handoverRequired || existing?.handoverRequired || false,
    lastMessageAt: conversationState === "replied" ? now : existing?.lastMessageAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    deletedBatch: null,
  };
  await store.upsertConversation(next);

  /*
    پیشروی وضعیت لید — فقط رو به جلو.

    چرا «فقط رو به جلو»: ثبت دوباره‌ی یک پاسخ روی لیدی که قبلاً به مرحله‌ی
    بالاتر رفته نباید عقبش بکشد. مثلاً اگر لید HANDED_OVER است و مالک خلاصه‌ی
    پاسخ را ویرایش کند، نباید به REPLIED برگردد.
  */
  const RANK: LeadStatus[] = ["SENT", "REPLIED", "HANDOVER_READY", "HANDED_OVER"];
  const target: LeadStatus | null = converted
    ? "HANDED_OVER"
    : handoverRequired
      ? "HANDOVER_READY"
      : (conversationState && STATE_TO_LEAD_STATUS[conversationState]) ?? null;

  let statusAfter = statusBefore;
  if (target) {
    const curRank = RANK.indexOf(statusBefore);
    const newRank = RANK.indexOf(target);
    if (newRank > curRank) {
      await store.updateLead(leadId, { status: target });
      statusAfter = target;
    }
  }

  await recordDecision({
    entityType: "lead",
    entityId: leadId,
    action: converted ? "lead.converted" : "lead.replied",
    reason: converted
      ? `«${lead.businessName}» تبدیل شد.${next.summary ? ` ${next.summary}` : ""}`
      : `پاسخ «${lead.businessName}» ثبت شد${
          next.sentiment
            ? ` — لحن ${
                { positive: "مثبت", neutral: "خنثی", negative: "منفی" }[next.sentiment]
              }`
            : ""
        }.${next.summary ? ` ${next.summary}` : ""}`,
    beforeData: { leadStatus: statusBefore },
    afterData: {
      leadStatus: statusAfter,
      conversationState: next.conversationState,
      sentiment: next.sentiment,
      nextAction: next.nextAction,
      nextActionAt: next.nextActionAt,
    },
  });

  return Response.json({ conversation: next, leadStatus: statusAfter });
}

/**
 * DELETE — حذف نرم انبوه. بدنه: { ids: string[] }
 * حذف می‌شود: رکورد پیگیری.
 *
 * ردیف واقعاً پاک نمی‌شود (`deleted_at` می‌گیرد) و از صفحه‌ی سطل زباله قابل
 * بازگرداندن است. دلیلش در `store/types.ts → SoftDeleteFields`.
 */
export async function DELETE(req: NextRequest) {
  return handleBulkDelete(req, "conversation");
}
