import { NextRequest } from "next/server";
import { getStore, type MessageStatus } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { checkPolicy } from "@/lib/agents/policy-guard";

export const dynamic = "force-dynamic";

/** GET /api/messages?leadId=&campaignId=&status= — فهرست پیام‌ها (+ نتیجه‌ی Policy Guard) */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId") || undefined;
  const campaignId = searchParams.get("campaignId") || undefined;
  const status = (searchParams.get("status") as MessageStatus | null) || undefined;

  const store = getStore();
  const messages = await store.listMessages({ leadId, status });

  // فیلتر کمپین: store روی پیام کمپین ندارد، پس از روی لیدهای کمپین فیلتر می‌کنیم
  let scoped = messages;
  if (campaignId) {
    const leads = await store.listLeads({ campaignId, limit: 1000 });
    const ids = new Set(leads.map((l) => l.id));
    scoped = messages.filter((m) => ids.has(m.leadId));
  }

  // مخزن نمونه‌کار یک‌بار خوانده می‌شود (نه به‌ازای هر پیام)
  const portfolio = await store.listPortfolio();
  const byId = new Map(portfolio.map((p) => [p.id, p]));

  // برای هر پیام، نام کسب‌وکار، نمونه‌کارهای پیشنهادی و چک سیاست را ضمیمه می‌کنیم (صفر توکن)
  const enriched = await Promise.all(
    scoped.map(async (m) => {
      const lead = await store.getLead(m.leadId);
      const text = m.finalText ?? m.draftText;
      return {
        ...m,
        businessName: lead?.businessName ?? "—",
        contactChannels: lead?.contactChannels ?? {},
        portfolio: m.recommendedPortfolioIds
          .map((id) => byId.get(id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => ({ id: p.id, title: p.title, publicUrl: p.publicUrl, service: p.service })),
        policy: checkPolicy(text, { businessName: lead?.businessName }),
      };
    })
  );

  return Response.json({ messages: enriched });
}

/**
 * PATCH /api/messages — تأیید/رد/ویرایش/ثبت ارسال (تأیید انسانی — §9)
 * بدنه: { id, action: "approve"|"reject"|"edit"|"sent", text? }
 */
export async function PATCH(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!id || !action) {
    return Response.json({ error: "id و action لازم است." }, { status: 400 });
  }

  const store = getStore();
  const msg = await store.getMessage(id);
  if (!msg) return Response.json({ error: "پیام یافت نشد." }, { status: 404 });

  const now = new Date().toISOString();

  switch (action) {
    case "edit": {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return Response.json({ error: "متن خالی است." }, { status: 400 });
      await store.updateMessage(id, { finalText: text });
      break;
    }
    case "approve": {
      const text = msg.finalText ?? msg.draftText;
      // گاردریل: پیام ناقض سیاست هرگز تأیید نمی‌شود (حتی با کلیک انسان)
      const lead = await store.getLead(msg.leadId);
      const policy = checkPolicy(text, { businessName: lead?.businessName });
      if (policy.verdict === "BLOCK") {
        return Response.json(
          { error: `تأیید ممکن نیست — نقض سیاست: ${policy.violations.join("، ")}` },
          { status: 400 }
        );
      }
      await store.updateMessage(id, { status: "approved", approvedBy: "human", finalText: text });
      await store.updateLead(msg.leadId, { status: "APPROVED" });
      break;
    }
    case "reject": {
      await store.updateMessage(id, { status: "rejected" });
      await store.updateLead(msg.leadId, { status: "REJECTED" });
      break;
    }
    case "sent": {
      await store.updateMessage(id, { status: "sent", sentAt: now });
      await store.updateLead(msg.leadId, { status: "SENT" });
      break;
    }
    default:
      return Response.json({ error: "action نامعتبر است." }, { status: 400 });
  }

  const updated = await store.getMessage(id);
  return Response.json({ message: updated });
}
