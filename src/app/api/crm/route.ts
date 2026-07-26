import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import type { AgentRun, AuditEntry, Lead, LeadStatus } from "@/lib/store/types";
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
const HAS_MESSAGE: LeadStatus[] = [
  "MESSAGE_DRAFTED",
  "MESSAGE_REVIEW",
  "APPROVED",
  "SENT",
  "REPLIED",
  "HANDOVER_READY",
  "HANDED_OVER",
];
const APPROVED_ON: LeadStatus[] = ["APPROVED", "SENT", "REPLIED", "HANDOVER_READY", "HANDED_OVER"];
const SENT_ON: LeadStatus[] = ["SENT", "REPLIED", "HANDOVER_READY", "HANDED_OVER"];
const REPLIED_ON: LeadStatus[] = ["REPLIED", "HANDOVER_READY", "HANDED_OVER"];

function funnelOf(leads: Lead[]) {
  const n = (list: LeadStatus[]) => leads.filter((l) => list.includes(l.status)).length;
  return [
    { key: "discovered", label: "کشف‌شده", count: leads.length },
    { key: "shortlisted", label: "منتخب", count: leads.filter((l) => l.shortlisted).length },
    { key: "analyzed", label: "تحلیل‌شده", count: n(ANALYZED) },
    { key: "messaged", label: "پیام‌دار", count: n(HAS_MESSAGE) },
    { key: "approved", label: "تأییدشده", count: n(APPROVED_ON) },
    { key: "sent", label: "ارسال‌شده", count: n(SENT_ON) },
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

  const [allCampaigns, audit, runs, conversations] = await Promise.all([
    store.listCampaigns(),
    store.listAudit({ ...range, limit: 400 }),
    store.listAgentRunsBetween({ ...range, campaignId, limit: 400 }),
    store.listConversations({ limit: 500 }),
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

  for (const a of audit as AuditEntry[]) {
    events.push({
      id: `audit:${a.id}`,
      at: a.createdAt,
      kind: "decision",
      action: a.action,
      label: AUDIT_LABELS[a.action] ?? a.action,
      subject:
        (a.entityType === "campaign" && a.entityId ? campaignName.get(a.entityId) : null) ??
        (a.entityId ? leadName.get(a.entityId) : null) ??
        null,
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
      sent: own.filter((l) => SENT_ON.includes(l.status)).length,
      converted: own.filter((l) => l.status === "HANDED_OVER").length,
    };
  });

  /* ── پیگیری‌ها: ارسال‌شده بدون پاسخ + سررسیدشده ── */
  const convByLead = new Map(conversations.map((c) => [c.leadId, c]));
  const nowIso = new Date().toISOString();
  const followUps = scopedLeads
    .filter((l) => SENT_ON.includes(l.status))
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
    funnel: funnelOf(leadsInRange),
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
