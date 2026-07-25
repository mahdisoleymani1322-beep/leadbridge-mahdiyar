import "server-only";
import { randomUUID, createHash } from "crypto";
import { getStore, type Lead, type LeadAnalysis, type LeadStatus } from "@/lib/store";
import { MAX_STEPS_PER_LEAD } from "@/lib/config";
import { businessDiscovery, isInstagramConfigured } from "@/lib/integrations/instagram";
import { runLeadAnalysis } from "./lead-analysis";
import { scoreLead, type ScoreResult } from "./scoring";
import { runServiceMatch } from "./service-match";
import { runPortfolioSelect } from "./portfolio-select";
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
