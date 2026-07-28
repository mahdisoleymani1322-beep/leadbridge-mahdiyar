import "server-only";
import { randomUUID, createHash } from "crypto";
import { getStore, type Lead, type LeadAnalysis, type LeadStatus } from "@/lib/store";
import { MAX_STEPS_PER_LEAD } from "@/lib/config";
import { businessDiscovery, isInstagramConfigured } from "@/lib/integrations/instagram";
import { runLeadAnalysis } from "./lead-analysis";
import { scoreAffluence } from "./affluence";
import { scoreLead, type ScoreResult } from "./scoring";
import { runServiceMatch } from "./service-match";
import { runPortfolioSelect } from "./portfolio-select";
import { runMessageWriter } from "./message-writer";
import { runMessageCritic } from "./message-critic";
import { recordLessonsFromCritic } from "./lesson-writer";
import { checkPolicy } from "./policy-guard";
import { CRITIC_THRESHOLDS, MAX_REVISION_ROUNDS, AFFLUENCE_THRESHOLDS } from "@/lib/config";
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
  ran:
    | "affluence-gate"
    | "analysis"
    | "service-match"
    | "portfolio-select"
    | "message-draft"
    | "message-critic"
    | "message-revise"
    | "message"
    | "none";
  status: LeadStatus;
  score: number | null;
  /** آیا این لید کارش تمام شده؟ (دیگر گامی نمانده) */
  done: boolean;
  summary: string;
};

/**
 * یک گام از پردازش لید را اجرا می‌کند و وضعیت بعدی را برمی‌گرداند.
 *
 * @param opts.force دروازه‌ی توان مالی را نادیده بگیر. دکمه‌ی «تحلیل لید» هر
 *   ردیف این را می‌فرستد: اراده‌ی صریح انسان بر غربال خودکار مقدم است.
 */
/**
 * بعد از این مدت، قفل ANALYZING «کهنه» حساب می‌شود و لید دوباره قابل پردازش است.
 *
 * سقف اجرای تابع روی Vercel ۶۰ ثانیه است، پس هیچ اجرای سالمی بیشتر از آن قفل
 * را نگه نمی‌دارد؛ ۳ دقیقه حاشیه‌ی امن می‌دهد بدون اینکه لیدِ واقعاً گیرکرده
 * ساعت‌ها بلااستفاده بماند.
 */
const STALE_LOCK_MS = 3 * 60 * 1000;

export async function runLeadStep(
  leadId: string,
  opts: { force?: boolean } = {}
): Promise<StepResult> {
  const store = getStore();
  const lead = await store.getLead(leadId);
  if (!lead) throw new Error("لید یافت نشد.");
  // همان گارد runLeadStep — شرحش آنجاست
  if (lead.deletedAt) throw new Error("این لید حذف شده است.");
  /*
    گارد لید حذف‌شده — `getLead` عمداً ردیف‌های حذف‌شده را هم برمی‌گرداند (چون
    بازگردانی به آن نیاز دارد)، پس چک باید اینجا باشد. بدون این، یک درخواست با
    شناسه‌ی قدیمی (تبِ باز، دکمه‌ی بازگشت مرورگر) روی لید حذف‌شده مدل را صدا
    می‌زد و از سهمیه‌ی روزانه خرج می‌کرد.
  */
  if (lead.deletedAt) throw new Error("این لید حذف شده است.");

  /*
    گارد همزمانی — مستقیماً از سهمیه‌ی مدل محافظت می‌کند.

    بدون این، دو درخواست همزمان روی یک لید (دو کلیک سریع، یا همپوشانی حلقه‌ی
    گروهی با دکمه‌ی تک‌ردیفی) هر دو وضعیت NEW را می‌خوانند، هر دو ANALYZING
    می‌کنند و **هر دو مدل را صدا می‌زنند** — یعنی دو فراخوان از سهمیه‌ی ۵۰
    درخواستِ روزانه برای یک لید.

    ⚠️ نسخه‌ی اول این گارد پشت `!opts.force` بود و در تست زنده شکست خورد: دو
    درخواست همزمان هر دو `analysis` را اجرا کردند (نمره‌های ۶۹ و ۷۲). علتش این
    است که `force` را **دکمه‌ی تحلیل هر ردیف و حلقه‌ی گروهی منتخب** می‌فرستند،
    یعنی دقیقاً در مسیر اصلی کار، گارد خاموش بود.

    درس: `force` معنایش «دروازه‌ی توان مالی را نادیده بگیر» است — یک تصمیم
    محصولی درباره‌ی اینکه کدام لید ارزش تحلیل دارد. قفل همزمانی ربطی به آن
    ندارد؛ کارش جلوگیری از هدررفت است و باید مستقل از اراده‌ی کاربر بماند.

    به‌جای آن، قفل **کهنه‌شونده** است: اگر لید بیش از STALE_LOCK_MS در
    ANALYZING مانده باشد، یعنی اجرای قبلی قطع شده و شروع دوباره درست است.
    زیر آن، یعنی واقعاً در حال اجراست و باید رد شود — حتی با force.
  */
  if (lead.status === "ANALYZING") {
    const heldMs = Date.now() - new Date(lead.updatedAt).getTime();
    if (Number.isFinite(heldMs) && heldMs < STALE_LOCK_MS) {
      return {
        leadId,
        ran: "none",
        status: lead.status,
        score: lead.score,
        done: true,
        summary: `«${lead.businessName}» همین حالا در حال تحلیل است؛ برای جلوگیری از خرج دوباره‌ی سهمیه رد شد.`,
      };
    }
  }

  const existing = await store.getAnalysis(leadId);
  const started = Date.now();

  const logRun = async (agent: string, status: "done" | "error", summary: string, output: unknown) => {
    await store.addAgentRun({
      id: randomUUID(),
      leadId,
      // برای گروه‌بندی دفترچه‌ی تصمیم بر اساس کمپین
      campaignId: lead.campaignId,
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
      deletedAt: null,
      deletedBatch: null,
    });
  };

  // ── گام ۰: دروازه‌ی توان مالی — **صفر توکن، پیش از هر فراخوان مدل** ──
  //
  // چرا اینجا و نه بعد از تحلیل: هر لید ضعیفی که تحلیل شود یک فراخوان از
  // سهمیه‌ی ۵۰ درخواستِ روزانه را می‌سوزاند. غربال رایگان اول، خرج توکن بعد.
  if (!existing) {
    // همیشه از نو محاسبه می‌شود، نه فقط وقتی null است: نمره‌ی ذخیره‌شده ممکن
    // است مال نسخه‌ی قبلی الگوریتم باشد و تصمیمِ دروازه را با داده‌ی بیات بگیرد.
    // تابع خالص است، پس محاسبه‌ی دوباره صفر توکن و بی‌خطر است.
    {
      const aff = scoreAffluence(lead);
      if (aff.score !== lead.affluenceScore) {
        await store.updateLead(leadId, {
          affluenceScore: aff.score,
          affluenceSignals: aff.signals,
        });
      }
      lead.affluenceScore = aff.score;
      lead.affluenceSignals = aff.signals;
    }

    if (!opts.force && (lead.affluenceScore ?? 0) < AFFLUENCE_THRESHOLDS.analyze) {
      await store.updateLead(leadId, { status: "LOW_VALUE" });
      await logRun(
        "affluence-gate",
        "done",
        `توان مالی ${lead.affluenceScore} زیر آستانه‌ی ${AFFLUENCE_THRESHOLDS.analyze} — تحلیل نشد (صفر توکن).`,
        { affluenceScore: lead.affluenceScore, signals: lead.affluenceSignals }
      );
      return {
        leadId,
        ran: "affluence-gate",
        status: "LOW_VALUE",
        score: null,
        done: true,
        summary: `توان مالی ${lead.affluenceScore} از ۱۰۰ — زیر آستانه، سهمیه‌ی مدل صرف لیدهای بهتر شد.`,
      };
    }
  }

  // ── گام ۱: تحلیل + امتیازدهی (اگر هنوز تحلیل نشده) ──
  if (!existing) {
    const statusBefore = lead.status;
    await store.updateLead(leadId, { status: "ANALYZING" });
    const igProfile =
      isInstagramConfigured() && lead.instagramHandle
        ? await businessDiscovery(lead.instagramHandle)
        : null;

    // اگر داده‌ی اینستاگرام آمد، نمره‌ی توان مالی را با فالوئر دقیق‌تر کن
    if (igProfile?.followersCount != null) {
      const aff = scoreAffluence(lead, { instagramFollowers: igProfile.followersCount });
      await store.updateLead(leadId, {
        affluenceScore: aff.score,
        affluenceSignals: aff.signals,
      });
      lead.affluenceScore = aff.score;
      lead.affluenceSignals = aff.signals;
    }

    /*
      ANALYZING یک وضعیت گذرا است و در صف کمپین دیده نمی‌شود (صف فقط NEW،
      SCORED و READY_FOR_MESSAGE را برمی‌دارد). پس اگر ایجنت خطا بدهد —
      مثلاً سهمیه‌ی روزانه‌ی مدل تمام شود — لید **برای همیشه** در ANALYZING
      گیر می‌کند و هیچ‌وقت دوباره برداشته نمی‌شود. سه لید واقعی همین‌طور
      گیر کرده بودند. پس وضعیت قبلی را برمی‌گردانیم و خطا را بالا می‌دهیم.
    */
    let analysis: Awaited<ReturnType<typeof runLeadAnalysis>>;
    try {
      analysis = await runLeadAnalysis({ lead, igProfile });
    } catch (err) {
      await store.updateLead(leadId, { status: statusBefore });
      await logRun(
        "lead-analysis",
        "error",
        `تحلیل ناموفق — وضعیت به ${statusBefore} برگردانده شد تا لید در صف بماند.`,
        { error: err instanceof Error ? err.message : String(err) }
      );
      throw err;
    }
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

    // امتیازدهی قطعی (صفر توکن) — بلافاصله بعد از تحلیل.
    // بازار کمپین لازم است تا marketFit واقعاً تطابق را بسنجد، نه اینکه به
    // همه ۲۰ امتیاز رایگان بدهد.
    const campaign = lead.campaignId ? await store.getCampaign(lead.campaignId) : null;
    const sc = scoreLead(lead, analysis, campaign?.market ?? null);
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
  //
  // چرا سه زیرگام جدا و نه یک حلقه‌ی کامل: نویسنده + منتقد + بازنویسی یعنی تا
  // ۴ فراخوان مدل پشت‌سرهم (~۹۰ ثانیه) که از سقف ۶۰ ثانیه‌ای تابع Vercel رد
  // می‌شود (FUNCTION_INVOCATION_TIMEOUT). پس هر درخواست **یک** فراخوان مدل
  // دارد و حالت بین درخواست‌ها در خود دیتابیس نگه داشته می‌شود:
  //   ۴الف) نویسنده  → ردیف message با criticScore = null ساخته می‌شود
  //   ۴ب ) منتقد    → نمره ثبت می‌شود؛ یا نهایی می‌شود یا بازنویسی می‌خواهد
  //   ۴ج ) بازنویسی → متن به‌روزرسانی و criticScore دوباره null می‌شود → ۴ب
  // شمارش دورها از روی agent_runs است، پس حلقه هرگز بی‌پایان نمی‌شود.
  if (lead.status === "READY_FOR_MESSAGE") {
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
    const runs = await store.listAgentRuns(leadId, 30);
    const existingMsgs = await store.listMessages({ leadId });
    const msg = existingMsgs[0] ?? null;

    // ── ۴الف: هنوز پیامی نیست → نویسنده ──
    if (!msg) {
      // نمونه‌کارهای پیشنهادی از خروجی گام قبلی (portfolio-select) خوانده می‌شوند
      const portfolioRun = runs.find((r) => r.agentName === "portfolio-select" && r.status === "done");
      const recommendedPortfolioIds: string[] =
        (portfolioRun?.output as { selectedIds?: string[] } | null)?.selectedIds ?? [];

      const draft = await runMessageWriter({
        businessName: lead.businessName,
        industry: lead.industry,
        city: lead.city,
        analysis: analysisInput,
        serviceId: existing.recommendedService,
        channel: lead.preferredChannel,
        hasEmail,
        igNote: lead.igNote,
      });

      // نویسنده حق دارد بگوید داده کافی نیست (دستور پیام‌نویسی، بند ۱۷).
      // در آن حالت پیام ساخته نمی‌شود و لید به بازبینی انسانی می‌رود — بهتر از
      // ساختن پیامی که اطلاعاتش از خود مدل درآمده.
      if (draft.status !== "OK" || !draft.message.trim()) {
        await store.updateLead(leadId, { status: "MESSAGE_REVIEW" });
        await logRun(
          "message-writer",
          "done",
          `پیام ساخته نشد — ${draft.status}. داده‌ی کافی برای پیام شخصی‌سازی‌شده نبود.`,
          draft
        );
        return {
          leadId,
          ran: "message",
          status: "MESSAGE_REVIEW",
          score: lead.score,
          done: true,
          summary:
            draft.status === "NO_RELEVANT_PORTFOLIO"
              ? "نمونه‌کار مرتبطی نبود؛ نیاز به بازبینی انسانی."
              : "داده‌ی کافی برای پیام شخصی‌سازی‌شده نبود؛ نیاز به بازبینی انسانی.",
        };
      }

      const created: Message = {
        id: randomUUID(),
        leadId,
        targetChannel: lead.preferredChannel,
        draftText: draft.message,
        finalText: null,
        emailSubject: draft.emailSubject,
        emailText: draft.emailBody,
        status: "draft", // همیشه پیش‌نویس — ارسال فقط با تأیید انسانی
        criticScore: null, // هنوز نقد نشده؛ گام بعد پرش می‌کند
        painTargeted: draft.painTargeted,
        recommendedPortfolioIds,
        approvedBy: null,
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        deletedBatch: null,
      };
      await store.createMessage(created);
      await logRun("message-writer", "done", "پیش‌نویس اول نوشته شد؛ منتظر نقد.", draft);

      return {
        leadId,
        ran: "message-draft",
        status: lead.status,
        score: lead.score,
        done: false, // نقد مانده
        summary: "پیش‌نویس نوشته شد؛ گام بعد نقد است.",
      };
    }

    const currentText = msg.finalText ?? msg.draftText;
    const rounds = runs.filter((r) => r.agentName === "message-writer" && r.status === "done").length - 1;

    // وضعیت نمونه‌کارِ اعلام‌شده‌ی نویسنده — منتقد و Policy Guard برای تشخیص
    // ادعای دروغِ «فرستادم» به آن نیاز دارند.
    const lastWriter = runs.find((r) => r.agentName === "message-writer" && r.status === "done");
    const portfolioMention =
      (lastWriter?.output as { portfolioMention?: "attached" | "available" | "linked" | "none" } | null)
        ?.portfolioMention ?? "available";

    // ── ۴ب: پیام هست ولی نمره ندارد → منتقد ──
    if (msg.criticScore == null) {
      const critic = await runMessageCritic({
        message: currentText,
        businessName: lead.businessName,
        analysis: analysisInput,
        serviceId: existing.recommendedService,
        channel: lead.preferredChannel,
        portfolioMention,
      });
      await store.updateMessage(msg.id, { criticScore: critic.score });

      // ── خودبهبودی: درس از معیارهای ضعیف (صفر توکن) ──
      // این تنها جایی است که درس نوشته می‌شود؛ تا پیش از این addLesson هیچ
      // فراخوانی نداشت و حلقه‌ی یادگیری نیمه‌کاره بود.
      const learned = await recordLessonsFromCritic(critic);

      await logRun(
        "message-critic",
        "done",
        `نمره ${critic.score}${critic.violations.length ? ` — ${critic.violations[0]}` : ""}${
          learned.length ? ` · ${learned.length} درس تازه ثبت شد` : ""
        }`,
        { ...critic, lessonsLearned: learned }
      );

      // نمره قبول است یا سهمیه‌ی بازنویسی تمام شده → نهایی کن
      if (critic.score >= CRITIC_THRESHOLDS.pass || rounds >= MAX_REVISION_ROUNDS) {
        const policy = checkPolicy(currentText, {
          businessName: lead.businessName,
          channel: lead.preferredChannel,
          portfolioMention,
        });
        const needsHuman = critic.score < CRITIC_THRESHOLDS.pass || policy.verdict !== "PASS";
        await store.updateLead(leadId, { status: needsHuman ? "MESSAGE_REVIEW" : "MESSAGE_DRAFTED" });
        return {
          leadId,
          ran: "message",
          status: needsHuman ? "MESSAGE_REVIEW" : "MESSAGE_DRAFTED",
          score: lead.score,
          done: true,
          summary: `پیش‌نویس پیام آماده شد (نمره ${critic.score}${
            policy.verdict !== "PASS" ? ` · Policy: ${policy.verdict}` : ""
          }).`,
        };
      }

      // نمره پایین و هنوز سهمیه‌ی بازنویسی هست → گام بعد بازنویسی
      return {
        leadId,
        ran: "message-critic",
        status: lead.status,
        score: lead.score,
        done: false,
        summary: `نمره ${critic.score} کافی نبود؛ گام بعد بازنویسی است.`,
      };
    }

    // ── ۴ج: نمره پایین و سهمیه باقی → بازنویسی با دستورهای منتقد ──
    const lastCritic = runs.find((r) => r.agentName === "message-critic" && r.status === "done");
    const instructions =
      (lastCritic?.output as { revisionInstructions?: string[] } | null)?.revisionInstructions ?? [];

    const revised = await runMessageWriter({
      businessName: lead.businessName,
      industry: lead.industry,
      city: lead.city,
      analysis: analysisInput,
      serviceId: existing.recommendedService,
      channel: lead.preferredChannel,
      hasEmail,
      igNote: lead.igNote,
      revision: { previousMessage: currentText, instructions },
    });

    // اگر بازنویسی هم به داده‌ی کافی نرسید، همان متن قبلی می‌ماند و کار به
    // بازبینی انسانی می‌رود — بهتر از خالی‌کردن پیامِ موجود.
    if (revised.status !== "OK" || !revised.message.trim()) {
      await store.updateLead(leadId, { status: "MESSAGE_REVIEW" });
      await logRun("message-writer", "done", `بازنویسی ناموفق — ${revised.status}`, revised);
      return {
        leadId,
        ran: "message",
        status: "MESSAGE_REVIEW",
        score: lead.score,
        done: true,
        summary: "بازنویسی به نتیجه نرسید؛ متن قبلی برای بازبینی انسانی ماند.",
      };
    }

    await store.updateMessage(msg.id, {
      draftText: revised.message,
      finalText: null,
      emailSubject: revised.emailSubject,
      emailText: revised.emailBody,
      painTargeted: revised.painTargeted,
      criticScore: null, // باید دوباره نقد شود
    });
    await logRun("message-writer", "done", `بازنویسی دور ${rounds + 1}`, revised);

    return {
      leadId,
      ran: "message-revise",
      status: lead.status,
      score: lead.score,
      done: false,
      summary: `پیام بازنویسی شد (دور ${rounds + 1})؛ گام بعد نقد دوباره است.`,
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

  // بیرون از closure گرفته می‌شود: `step` یک function declaration هوست‌شده است و
  // TypeScript نمی‌تواند تضمین کند بعد از چکِ null بالا اجرا می‌شود، پس narrowing
  // را از دست می‌دهد.
  const runCampaignId = lead.campaignId;

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
        campaignId: runCampaignId,
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
        deletedAt: null,
        deletedBatch: null,
      });
      return output;
    } catch (err) {
      consecutiveErrors++;
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ agent, status: "error", summary: message });
      await store.addAgentRun({
        id: randomUUID(),
        leadId,
        campaignId: runCampaignId,
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
        deletedAt: null,
        deletedBatch: null,
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
  const pipelineCampaign = lead.campaignId ? await store.getCampaign(lead.campaignId) : null;
  const scoreResult: ScoreResult = scoreLead(lead, analysis, pipelineCampaign?.market ?? null);
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
