import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import type { AgentRun, AuditEntry, Lead, LeadStatus, Message } from "@/lib/store/types";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { AUDIT_LABELS } from "@/lib/audit";
import { marketLabel } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * داده‌ی صفحه‌ی CRM — **صفر توکن LLM**، فقط کوئری دیتابیس.
 *
 * هر چهار بخش صفحه در یک درخواست می‌آید تا با تغییر بازه‌ی تاریخ چهار رفت‌وبرگشت
 * جدا نشود.
 *
 * نکته‌ی کلیدی: رویدادها از **دو منبع** ساخته می‌شوند —
 *   ۱. `audit_log` → تصمیم‌های انسانی از فاز ۶ به بعد
 *   ۲. رکوردهای موجود (`agent_runs`, `campaigns`, `leads`) → تاریخچه‌ای که از
 *      قبل تاریخ داشته
 * بدون منبع دوم، صفحه در روز اول خالی بود و کل تاریخچه‌ی واقعی سیستم گم می‌شد.
 */

export type CrmEvent = {
  id: string;
  at: string;
  kind: "decision" | "agent" | "campaign" | "lead";
  action: string;
  /** برچسب فارسی نوع رویداد */
  label: string;
  /** کسب‌وکار یا کمپین مربوطه */
  subject: string | null;
  detail: string;
  ok: boolean;
};

/** قیف تبدیل — تعریف قطعی، بدون هیچ فراخوان مدل */
const ANALYZED: LeadStatus[] = [
  "SCORED",
  "READY_FOR_MESSAGE",
  "MESSAGE_DRAFTED",
  "MESSAGE_REVIEW",
  "APPROVED",
  "SENT",
  "REPLIED",
  "HANDOVER_READY",
  "HANDED_OVER",
  "NURTURE",
  "REJECTED",
];
const SENT_ON: LeadStatus[] = ["SENT", "REPLIED", "HANDOVER_READY", "HANDED_OVER"];
const REPLIED_ON: LeadStatus[] = ["REPLIED", "HANDOVER_READY", "HANDED_OVER"];

/**
 * قیف تبدیل — تعریف قطعی، صفر توکن.
 *
 * ⚠️ پله‌های «پیام‌دار / تأییدشده / ارسال‌شده» از جدول **messages** خوانده
 * می‌شوند، نه از وضعیت لید. نسخه‌ی اول از وضعیت لید می‌خواند و روی داده‌ی واقعی
 * غلط درآمد: یک پیام با نمره‌ی ۸۲ وجود داشت ولی لیدش هنوز READY_FOR_MESSAGE بود،
 * چون جریان بین ساخت پیام و به‌روزرسانی وضعیت (با خطای سهمیه) قطع شده بود.
 *
 * مشکل دوم و مهم‌تر: وضعیت لید **بازنویسی می‌شود**. اگر پیامی رد شود لید به
 * REJECTED می‌رود و از شمارش «پیام‌دار» بیرون می‌افتد — یعنی قیف تعداد پیام‌های
 * واقعاً تولیدشده را کمتر از واقع نشان می‌داد. `messages.status` مستقل است و
 * این اتفاق برایش نمی‌افتد.
 *
 * پله‌های «پاسخ‌داده/تبدیل‌شده» از وضعیت لید می‌آیند چون منبعشان
 * `/api/conversations` است که خودش همان وضعیت را می‌نویسد.
 */
function funnelOf(leads: Lead[], messages: Message[]) {
  const n = (list: LeadStatus[]) => leads.filter((l) => list.includes(l.status)).length;
  const leadIds = new Set(leads.map((l) => l.id));
  const scoped = messages.filter((m) => leadIds.has(m.leadId));
  const leadsWith = (pick: (m: Message) => boolean) =>
    new Set(scoped.filter(pick).map((m) => m.leadId)).size;

  return [
    { key: "discovered", label: "کشف‌شده", count: leads.length },
    { key: "shortlisted", label: "منتخب", count: leads.filter((l) => l.shortlisted).length },
    { key: "analyzed", label: "تحلیل‌شده", count: n(ANALYZED) },
    { key: "messaged", label: "پیام‌دار", count: leadsWith(() => true) },
    {
      key: "approved",
      label: "تأییدشده",
      count: leadsWith((m) => m.status === "approved" || m.status === "sent"),
    },
    { key: "sent", label: "ارسال‌شده", count: leadsWith((m) => m.status === "sent") },
    { key: "replied", label: "پاسخ‌داده", count: n(REPLIED_ON) },
    { key: "converted", label: "تبدیل‌شده", count: n(["HANDED_OVER"]) },
  ];
}

/** برچسب فارسی ایجنت‌ها برای دفترچه */
const AGENT_LABELS: Record<string, string> = {
  discovery: "کشف لید",
  "lead-analysis": "تحلیل لید",
  scoring: "امتیازدهی",
  "service-match": "انتخاب خدمت",
  "portfolio-select": "انتخاب نمونه‌کار",
  "message-writer": "نوشتن پیام",
  "message-critic": "نقد پیام",
  "affluence-gate": "دروازه‌ی توان مالی",
};

export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const campaignId = searchParams.get("campaignId") || undefined;

  const store = getStore();
  const range = { from, to };

  const [allCampaigns, audit, runs, conversations, allMessages] = await Promise.all([
    store.listCampaigns(),
    store.listAudit({ ...range, limit: 400 }),
    store.listAgentRunsBetween({ ...range, campaignId, limit: 400 }),
    store.listConversations({ limit: 500 }),
    // بدون فیلتر بازه: پیام ممکن است بعد از بازه‌ی کشفِ لید ساخته شده باشد و
    // قیف باید سرنوشت **همان لیدها** را نشان دهد، نه فقط پیام‌های داخل بازه.
    store.listMessages(),
  ]);

  // لیدهای بازه (برای آمار) و لیدهای کل (برای نام‌بردن در رویدادها)
  const scopedLeads = await store.listLeads({ campaignId, limit: 2000 });
  const leadName = new Map(scopedLeads.map((l) => [l.id, l.businessName]));
  const campaignName = new Map(allCampaigns.map((c) => [c.id, c.name]));

  const inRange = (at: string) => (!from || at >= from) && (!to || at <= to);
  const campaigns = allCampaigns.filter(
    (c) => inRange(c.createdAt) && (!campaignId || c.id === campaignId)
  );
  const leadsInRange = scopedLeads.filter((l) => inRange(l.createdAt));

  /* ── رویدادها از دو منبع ── */
  const events: CrmEvent[] = [];

  /*
    رکورد تصمیم‌های پیام، `entityId` را روی **شناسه‌ی پیام** می‌گذارند نه لید.
    بدون این نگاشت، دو مهم‌ترین ردیف دفترچه («پیام تأیید شد»، «پیام ارسال شد»)
    بدون نام کسب‌وکار نمایش داده می‌شدند — در تست زنده دقیقاً همین دیده شد.
  */
  const messageToLead = new Map(allMessages.map((m) => [m.id, m.leadId]));
  const subjectOf = (a: AuditEntry): string | null => {
    if (!a.entityId) return null;
    if (a.entityType === "campaign") return campaignName.get(a.entityId) ?? null;
    if (a.entityType === "message") {
      const lid = messageToLead.get(a.entityId);
      return lid ? leadName.get(lid) ?? null : null;
    }
    return leadName.get(a.entityId) ?? null;
  };

  for (const a of audit as AuditEntry[]) {
    events.push({
      id: `audit:${a.id}`,
      at: a.createdAt,
      kind: "decision",
      action: a.action,
      label: AUDIT_LABELS[a.action] ?? a.action,
      subject: subjectOf(a),
      detail: a.reason ?? "",
      ok: true,
    });
  }

  for (const r of runs as AgentRun[]) {
    events.push({
      id: `run:${r.id}`,
      at: r.createdAt,
      kind: "agent",
      action: r.agentName,
      label: AGENT_LABELS[r.agentName] ?? r.agentName,
      subject: r.leadId ? leadName.get(r.leadId) ?? null : r.campaignId ? campaignName.get(r.campaignId) ?? null : null,
      detail: r.summary,
      ok: r.status !== "error",
    });
  }

  // ساخت کمپین قبل از فاز ۶ رکورد audit ندارد؛ از خود جدول بازسازی می‌شود
  for (const c of campaigns) {
    if (!events.some((e) => e.kind === "decision" && e.action === "campaign.created" && e.at === c.createdAt)) {
      events.push({
        id: `campaign:${c.id}`,
        at: c.createdAt,
        kind: "campaign",
        action: "campaign.created",
        label: "کمپین ساخته شد",
        subject: c.name,
        detail: `بازار: ${marketLabel(c.market)} — شهر: ${c.city}`,
        ok: true,
      });
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  /* ── آمار کمپین‌های بازه ── */
  const sentLeadIds = new Set(
    allMessages.filter((m) => m.status === "sent").map((m) => m.leadId)
  );
  const campaignStats = campaigns.map((c) => {
    const own = scopedLeads.filter((l) => l.campaignId === c.id);
    return {
      id: c.id,
      name: c.name,
      market: marketLabel(c.market),
      city: c.city,
      createdAt: c.createdAt,
      leads: own.length,
      shortlisted: own.filter((l) => l.shortlisted).length,
      // مثل قیف: از جدول پیام‌ها، نه وضعیت لید (که بازنویسی می‌شود)
      sent: own.filter((l) => sentLeadIds.has(l.id)).length,
      converted: own.filter((l) => l.status === "HANDED_OVER").length,
    };
  });

  /* ── پیگیری‌ها: ارسال‌شده بدون پاسخ + سررسیدشده ── */
  const convByLead = new Map(conversations.map((c) => [c.leadId, c]));
  const nowIso = new Date().toISOString();
  // «ارسال‌شده» = پیامش sent است **یا** وضعیت لید جلوتر رفته. شرط دوم لازم است
  // چون لید ممکن است از مسیر ثبت پاسخ جلو رفته باشد؛ شرط اول لازم است چون
  // وضعیت لید ممکن است به‌خاطر قطع‌شدن جریان عقب مانده باشد.
  const followUps = scopedLeads
    .filter((l) => sentLeadIds.has(l.id) || SENT_ON.includes(l.status))
    .map((l) => {
      const c = convByLead.get(l.id) ?? null;
      return {
        leadId: l.id,
        businessName: l.businessName,
        status: l.status,
        channel: l.preferredChannel,
        conversationState: c?.conversationState ?? null,
        sentiment: c?.sentiment ?? null,
        summary: c?.summary ?? null,
        nextAction: c?.nextAction ?? null,
        nextActionAt: c?.nextActionAt ?? null,
        overdue: Boolean(c?.nextActionAt && c.nextActionAt <= nowIso),
        awaitingReply: !c || c.conversationState === "no_reply" || c.conversationState == null,
      };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue));

  return Response.json({
    range: { from: from ?? null, to: to ?? null },
    funnel: funnelOf(leadsInRange, allMessages),
    totals: {
      events: events.length,
      campaigns: campaigns.length,
      newLeads: leadsInRange.length,
      awaitingReply: followUps.filter((f) => f.awaitingReply).length,
      overdue: followUps.filter((f) => f.overdue).length,
    },
    campaigns: campaignStats,
    events: events.slice(0, 300),
    followUps,
    allCampaigns: allCampaigns.map((c) => ({ id: c.id, name: c.name })),
  });
}
