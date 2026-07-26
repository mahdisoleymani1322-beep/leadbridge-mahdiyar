import "server-only";
import { randomUUID, createHash } from "crypto";
import { getStore, type Lead, type LeadAnalysis, type LeadStatus } from "@/lib/store";
import { MAX_STEPS_PER_LEAD } from "@/lib/config";
import { businessDiscovery, isInstagramConfigured } from "@/lib/integrations/instagram";
import { runLeadAnalysis } from "./lead-analysis";
import { scoreLead, type ScoreResult } from "./scoring";
import { runServiceMatch } from "./service-match";
import { runPortfolioSelect } from "./portfolio-select";
import { runMessageWriter } from "./message-writer";
import { runMessageCritic } from "./message-critic";
import { checkPolicy } from "./policy-guard";
import { CRITIC_THRESHOLDS, MAX_REVISION_ROUNDS } from "@/lib/config";
import type { Message } from "@/lib/store";
import type { LeadAnalysisOutput, ServiceMatchOutput, PortfolioSelectOutput } from "./types";

/**
 * ارکستریتور — «ایجنت مادر»، ولی **کد قطعی است، نه LLM** (نقشه‌راه §6 و §14).
 *
 * چرا: جریان کار (ترتیب، شرط‌ها، State Machine، بودجه، توقف) باید قابل‌پیش‌بینی،
 * قابل‌دیباگ و قابل‌تست باشد. رایج‌ترین اشتباه در مولتی‌ایجنت، سپردن orchestration
 * به LLM است. تصمیم‌های خلاقانه با ایجنت‌ها، کنترل جریان با کد.
 *
 * جریان فاز ۳:
 * VALIDATING → ANALYZING (ایجنت) → SCORED (سرویس قطعی)
 *   → اگر PASS: انتخاب خدمت (ایجنت) → انتخاب نمونه‌کار (ایجنت) → READY_FOR_MESSAGE
 *   → اگر NURTURE/REJECT: همان‌جا توقف
 *
 * گاردریل‌های حلقه (نقشه‌راه §32):
 * - سقف MAX_STEPS_PER_LEAD گام در هر اجرا
 * - هر گام حداکثر یک فراخوان مدل
 * - جلوگیری از اجرای تکراری با ورودی یکسان (input hash)
 * - توقف اجباری بعد از ۲ خطای متوالی
 * - هر گام با stop_reason در agent_runs ثبت می‌شود
 */

const MAX_CONSECUTIVE_ERRORS = 2;

export type PipelineResult = {
  leadId: string;
  finalStatus: LeadStatus;
  steps: { agent: string; status: "done" | "error" | "skipped"; summary: string }[];
  score: number | null;
  stopReason: string;
};

/* ── اجرای گام‌به‌گام (برای اتصال‌های کند/ناپایدار) ──────────
 *
 * چرا: اجرای کل یک لید ~۳۵ ثانیه طول می‌کشد و درخواست HTTP آن‌قدر باز می‌ماند
 * که پروکسی/شبکه‌های کند آن را قطع می‌کنند (NetworkError). با اجرای «یک گام در
 * هر درخواست»، هر فراخوان ~۱۰ ثانیه است و کلاینت گام‌ها را پشت‌سرهم می‌زند.
 * مزیت دوم: پیشرفت واقعی و از سرگیری بعد از خطا.
 */

export type StepResult = {
  leadId: string;
  /** گامی که همین حالا اجرا شد */
  ran: "analysis" | "service-match" | "portfolio-select" | "message" | "none";
  status: LeadStatus;
  score: number | null;
  /** آیا این لید کارش تمام شده؟ (دیگر گامی نمانده) */
  done: boolean;
  summary: string;
};

/** یک گام از پردازش لید را اجرا می‌کند و وضعیت بعدی را برمی‌گرداند. */
export async function runLeadStep(leadId: string): Promise<StepResult> {
  const store = getStore();
  const lead = await store.getLead(leadId);
  if (!lead) throw new Error("لید یافت نشد.");

  const existing = await store.getAnalysis(leadId);
  const started = Date.now();

  const logRun = async (agent: string, status: "done" | "error", summary: string, output: unknown) => {
    await store.addAgentRun({
      id: randomUUID(),
      leadId,
      agentName: agent,
      status,
      summary,
      output,
      tokenInput: null,
      tokenOutput: null,
      cost: null,
      durationMs: Date.now() - started,
      stopReason: status === "done" ? "ok" : "error",
      errorCode: null,
      createdAt: new Date().toISOString(),
    });
  };

  // ── گام ۱: تحلیل + امتیازدهی (اگر هنوز تحلیل نشده) ──
  if (!existing) {
    await store.updateLead(leadId, { status: "ANALYZING" });
    const igProfile =
      isInstagramConfigured() && lead.instagramHandle
        ? await businessDiscovery(lead.instagramHandle)
        : null;

    const analysis = await runLeadAnalysis({ lead, igProfile });
    await store.upsertAnalysis({
      id: randomUUID(),
      leadId,
      businessSummary: analysis.businessSummary,
      targetCustomer: analysis.targetCustomer,
      painPoint: analysis.painPoint,
      needSignals: analysis.needSignals,
      evidence: analysis.evidence,
      uncertainties: analysis.uncertainties,
      brandTone: analysis.brandTone,
      recommendedService: "",
      riskFlags: analysis.riskFlags,
      confidence: analysis.confidence,
      agentVersion: "v1",
      createdAt: new Date().toISOString(),
    });
    await logRun("lead-analysis", "done", `درد: ${analysis.painPoint.slice(0, 80)}…`, analysis);

    // امتیازدهی قطعی (صفر توکن) — بلافاصله بعد از تحلیل
    const sc = scoreLead(lead, analysis);
    const nextStatus: LeadStatus =
      sc.decision === "PASS" ? "SCORED" : sc.decision === "NURTURE" ? "NURTURE" : "REJECTED";
    await store.updateLead(leadId, {
      status: nextStatus,
      score: sc.score,
      confidence: analysis.confidence,
    });
    await logRun("scoring", "done", sc.reason, sc);

    return {
      leadId,
      ran: "analysis",
      status: nextStatus,
      score: sc.score,
      done: sc.decision !== "PASS", // فقط لیدهای PASS گام بعدی دارند
      summary: sc.reason,
    };
  }

  // ── گام ۲: انتخاب خدمت (اگر تحلیل هست ولی خدمت انتخاب نشده) ──
  if (!existing.recommendedService) {
    if (lead.status !== "SCORED") {
      return { leadId, ran: "none", status: lead.status, score: lead.score, done: true, summary: "گام دیگری لازم نیست." };
    }
    const match = await runServiceMatch({
      businessName: lead.businessName,
      analysis: {
        businessSummary: existing.businessSummary,
        targetCustomer: existing.targetCustomer,
        painPoint: existing.painPoint,
        needSignals: existing.needSignals,
        evidence: existing.evidence,
        uncertainties: existing.uncertainties,
        brandTone: existing.brandTone,
        riskFlags: existing.riskFlags,
        confidence: existing.confidence,
      },
    });
    await store.upsertAnalysis({ ...existing, recommendedService: match.serviceId });
    await logRun("service-match", "done", `خدمت: ${match.serviceId}`, match);
    return {
      leadId,
      ran: "service-match",
      status: lead.status,
      score: lead.score,
      done: false,
      summary: `خدمت انتخاب شد: ${match.serviceId}`,
    };
  }

  // ── گام ۳: انتخاب نمونه‌کار → آماده‌ی پیام ──
  if (lead.status === "SCORED") {
    const items = await store.listPortfolio({ approvedOnly: true });
    const sel = await runPortfolioSelect({
      businessName: lead.businessName,
      industry: lead.industry,
      painPoint: existing.painPoint,
      serviceId: existing.recommendedService,
      portfolio: items,
    });
    await logRun(
      "portfolio-select",
      "done",
      sel.selectedIds.length ? `${sel.selectedIds.length} نمونه‌کار پیشنهاد شد` : "نمونه‌کار مرتبطی نبود",
      sel
    );
    await store.updateLead(leadId, { status: "READY_FOR_MESSAGE" });
    return {
      leadId,
      ran: "portfolio-select",
      status: "READY_FOR_MESSAGE",
      score: lead.score,
      done: false, // گام پیام مانده
      summary: "آماده‌ی تولید پیام.",
    };
  }

  // ── گام ۴: تولید پیام + نقد + Policy Guard (فاز ۴) ──
  if (lead.status === "READY_FOR_MESSAGE") {
    const existingMsgs = await store.listMessages({ leadId });
    if (existingMsgs.length > 0) {
      return { leadId, ran: "none", status: lead.status, score: lead.score, done: true, summary: "پیام قبلاً ساخته شده." };
    }

    const analysisInput: LeadAnalysisOutput = {
      businessSummary: existing.businessSummary,
      targetCustomer: existing.targetCustomer,
      painPoint: existing.painPoint,
      needSignals: existing.needSignals,
      evidence: existing.evidence,
      uncertainties: existing.uncertainties,
      brandTone: existing.brandTone,
      riskFlags: existing.riskFlags,
      confidence: existing.confidence,
    };
    const hasEmail = Boolean(lead.contactChannels.email);

    // نمونه‌کارهای پیشنهادی از خروجی گام قبلی (portfolio-select) خوانده می‌شوند
    const runs = await store.listAgentRuns(leadId, 20);
    const portfolioRun = runs.find((r) => r.agentName === "portfolio-select" && r.status === "done");
    const recommendedPortfolioIds: string[] =
      (portfolioRun?.output as { selectedIds?: string[] } | null)?.selectedIds ?? [];

    // حلقه‌ی نویسنده ⇄ منتقد — حداکثر MAX_REVISION_ROUNDS دور (گاردریل §23)
    let draft = await runMessageWriter({
      businessName: lead.businessName,
      industry: lead.industry,
      city: lead.city,
      analysis: analysisInput,
      serviceId: existing.recommendedService,
      channel: lead.preferredChannel,
      hasEmail,
    });
    let critic = await runMessageCritic({
      message: draft.message,
      businessName: lead.businessName,
      analysis: analysisInput,
      serviceId: existing.recommendedService,
    });

    let rounds = 0;
    while (critic.score < CRITIC_THRESHOLDS.pass && rounds < MAX_REVISION_ROUNDS) {
      rounds++;
      draft = await runMessageWriter({
        businessName: lead.businessName,
        industry: lead.industry,
        city: lead.city,
        analysis: analysisInput,
        serviceId: existing.recommendedService,
        channel: lead.preferredChannel,
        hasEmail,
        revision: { previousMessage: draft.message, instructions: critic.revisionInstructions },
      });
      critic = await runMessageCritic({
        message: draft.message,
        businessName: lead.businessName,
        analysis: analysisInput,
        serviceId: existing.recommendedService,
      });
    }

    // Policy Guard قطعی — علاوه بر قضاوت مدل (صفر توکن)
    const policy = checkPolicy(draft.message, { businessName: lead.businessName });

    const msg: Message = {
      id: randomUUID(),
      leadId,
      targetChannel: lead.preferredChannel,
      draftText: draft.message,
      finalText: null,
      emailSubject: draft.emailSubject,
      emailText: draft.emailBody,
      status: "draft", // همیشه پیش‌نویس — ارسال فقط با تأیید انسانی
      criticScore: critic.score,
      painTargeted: draft.painTargeted,
      recommendedPortfolioIds,
      approvedBy: null,
      sentAt: null,
      createdAt: new Date().toISOString(),
    };
    await store.createMessage(msg);

    const needsHuman = critic.score < CRITIC_THRESHOLDS.pass || policy.verdict !== "PASS";
    await store.updateLead(leadId, { status: needsHuman ? "MESSAGE_REVIEW" : "MESSAGE_DRAFTED" });

    await logRun(
      "message-writer",
      "done",
      `پیام ساخته شد — نمره‌ی منتقد ${critic.score}${rounds ? ` (${rounds} بازنویسی)` : ""}` +
        (policy.verdict !== "PASS" ? ` · Policy: ${policy.verdict}` : ""),
      { draft, critic, policy, rounds }
    );

    return {
      leadId,
      ran: "message",
      status: needsHuman ? "MESSAGE_REVIEW" : "MESSAGE_DRAFTED",
      score: lead.score,
      done: true,
      summary: `پیش‌نویس پیام آماده شد (نمره ${critic.score}).`,
    };
  }

  return { leadId, ran: "none", status: lead.status, score: lead.score, done: true, summary: "گام دیگری لازم نیست." };
}

/** هش ورودی — برای جلوگیری از تکرار یک ایجنت با ورودی یکسان */
function inputHash(agent: string, payload: unknown): string {
  return createHash("sha1").update(agent + JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export async function runLeadPipeline(leadId: string): Promise<PipelineResult> {
  const store = getStore();
  const lead = await store.getLead(leadId);
  if (!lead) throw new Error("لید یافت نشد.");

  const steps: PipelineResult["steps"] = [];
  const seenHashes = new Set<string>();
  let stepCount = 0;
  let consecutiveErrors = 0;
  let stopReason = "completed";

  /** اجرای یک گام با ثبت کامل در agent_runs (قابل‌ممیزی) */
  async function step<T>(
    agent: string,
    hashPayload: unknown,
    fn: () => Promise<{ output: T; summary: string }>
  ): Promise<T | null> {
    // گاردریل ۱: سقف گام
    if (stepCount >= MAX_STEPS_PER_LEAD) {
      stopReason = "MAX_STEPS";
      steps.push({ agent, status: "skipped", summary: "سقف گام‌های مجاز پر شد." });
      return null;
    }
    // گاردریل ۲: ورودی تکراری
    const h = inputHash(agent, hashPayload);
    if (seenHashes.has(h)) {
      stopReason = "DUPLICATE_INPUT";
      steps.push({ agent, status: "skipped", summary: "ورودی تکراری — از اجرای دوباره جلوگیری شد." });
      return null;
    }
    seenHashes.add(h);
    stepCount++;

    const started = Date.now();
    try {
      const { output, summary } = await fn();
      consecutiveErrors = 0;
      steps.push({ agent, status: "done", summary });
      await store.addAgentRun({
        id: randomUUID(),
        leadId,
        agentName: agent,
        status: "done",
        summary,
        output,
        tokenInput: null,
        tokenOutput: null,
        cost: null,
        durationMs: Date.now() - started,
        stopReason: "ok",
        errorCode: null,
        createdAt: new Date().toISOString(),
      });
      return output;
    } catch (err) {
      consecutiveErrors++;
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ agent, status: "error", summary: message });
      await store.addAgentRun({
        id: randomUUID(),
        leadId,
        agentName: agent,
        status: "error",
        summary: message,
        output: null,
        tokenInput: null,
        tokenOutput: null,
        cost: null,
        durationMs: Date.now() - started,
        stopReason: "error",
        errorCode: message.slice(0, 80),
        createdAt: new Date().toISOString(),
      });
      // گاردریل ۳: توقف بعد از ۲ خطای متوالی
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) stopReason = "CONSECUTIVE_ERRORS";
      return null;
    }
  }

  async function setStatus(status: LeadStatus, patch: Partial<Lead> = {}) {
    await store.updateLead(leadId, { status, ...patch });
  }

  // ── ۱. تحلیل (ایجنت) ──
  await setStatus("ANALYZING");

  // غنی‌سازی اختیاری اینستاگرام (سرویس قطعی، صفر توکن)
  const igProfile =
    isInstagramConfigured() && lead.instagramHandle
      ? await businessDiscovery(lead.instagramHandle)
      : null;

  const analysis = await step<LeadAnalysisOutput>("lead-analysis", { id: lead.id }, async () => {
    const out = await runLeadAnalysis({ lead, igProfile });
    return {
      output: out,
      summary: `درد: ${out.painPoint.slice(0, 80)}… (اطمینان ${Math.round(out.confidence * 100)}٪)`,
    };
  });

  if (!analysis) {
    await setStatus("NEW");
    return { leadId, finalStatus: "NEW", steps, score: null, stopReason: stopReason || "ANALYSIS_FAILED" };
  }

  // ذخیره‌ی تحلیل
  const analysisRow: LeadAnalysis = {
    id: randomUUID(),
    leadId,
    businessSummary: analysis.businessSummary,
    targetCustomer: analysis.targetCustomer,
    painPoint: analysis.painPoint,
    needSignals: analysis.needSignals,
    evidence: analysis.evidence,
    uncertainties: analysis.uncertainties,
    brandTone: analysis.brandTone,
    recommendedService: "",
    riskFlags: analysis.riskFlags,
    confidence: analysis.confidence,
    agentVersion: "v1",
    createdAt: new Date().toISOString(),
  };
  await store.upsertAnalysis(analysisRow);

  // ── ۲. امتیازدهی (سرویس قطعی — صفر توکن) ──
  const scoreResult: ScoreResult = scoreLead(lead, analysis);
  await setStatus("SCORED", { score: scoreResult.score, confidence: analysis.confidence });
  steps.push({ agent: "scoring", status: "done", summary: scoreResult.reason });

  if (scoreResult.decision !== "PASS") {
    const finalStatus: LeadStatus = scoreResult.decision === "NURTURE" ? "NURTURE" : "REJECTED";
    await setStatus(finalStatus);
    return { leadId, finalStatus, steps, score: scoreResult.score, stopReason: scoreResult.decision };
  }

  // ── ۳. انتخاب خدمت (ایجنت) ──
  const match = await step<ServiceMatchOutput>(
    "service-match",
    { id: lead.id, pain: analysis.painPoint },
    async () => {
      const out = await runServiceMatch({ businessName: lead.businessName, analysis });
      return { output: out, summary: `خدمت: ${out.serviceId} — ${out.reason.slice(0, 60)}…` };
    }
  );

  if (match) {
    await store.upsertAnalysis({ ...analysisRow, recommendedService: match.serviceId });
  }

  // ── ۴. انتخاب نمونه‌کار (ایجنت) ──
  let portfolio: PortfolioSelectOutput | null = null;
  if (match) {
    const items = await store.listPortfolio({ approvedOnly: true });
    portfolio = await step<PortfolioSelectOutput>(
      "portfolio-select",
      { id: lead.id, service: match.serviceId },
      async () => {
        const out = await runPortfolioSelect({
          businessName: lead.businessName,
          industry: lead.industry,
          painPoint: analysis.painPoint,
          serviceId: match.serviceId,
          portfolio: items,
        });
        return {
          output: out,
          summary: out.selectedIds.length
            ? `${out.selectedIds.length} نمونه‌کار پیشنهاد شد`
            : "نمونه‌کار مرتبطی نبود",
        };
      }
    );
  }

  // ── ۵. آماده برای پیام (فاز ۴) ──
  const finalStatus: LeadStatus = match ? "READY_FOR_MESSAGE" : "SCORED";
  await setStatus(finalStatus);

  return {
    leadId,
    finalStatus,
    steps,
    score: scoreResult.score,
    stopReason: portfolio || match ? stopReason : "PARTIAL",
  };
}
