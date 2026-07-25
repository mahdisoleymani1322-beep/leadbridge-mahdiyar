import "server-only";
import { SCORING_WEIGHTS, SCORE_THRESHOLDS, type ScoringCriterion } from "@/lib/config";
import type { Lead } from "@/lib/store";
import type { LeadAnalysisOutput } from "./types";

/**
 * سرویس امتیازدهی لید — **کد قطعی، صفر توکن LLM** (نقشه‌راه §19).
 *
 * تصمیم معماری: محاسبه‌ی امتیاز یک Workflow قطعی است، نه کار ایجنت. مدل حق
 * تغییر وزن یا آستانه را ندارد؛ این‌ها فقط در config.ts و با تأیید انسان عوض
 * می‌شوند. نتیجه: امتیازدهی پایدار، قابل‌تکرار و قابل‌ممیزی.
 */

export type ScoreDecision = "PASS" | "NURTURE" | "REJECT";

export type ScoreResult = {
  /** امتیاز نهایی ۰ تا ۱۰۰ */
  score: number;
  /** امتیاز خام هر معیار (۰ تا ۱) — برای شفافیت در داشبورد */
  criteria: Record<ScoringCriterion, number>;
  decision: ScoreDecision;
  reason: string;
};

/** آیا کانال‌های تماس، دسترسی مستقیم به تصمیم‌گیرنده می‌دهند؟ */
function decisionMakerAccess(lead: Lead): number {
  const c = lead.contactChannels;
  // دایرکت/واتساپ/تلگرام = دسترسی نسبتاً مستقیم؛ فرم سایت = ضعیف‌ترین
  if (c.instagram || c.whatsapp || c.telegram) return 1;
  if (c.email) return 0.7;
  if (c.phone) return 0.6;
  if (c.siteForm) return 0.3;
  return 0;
}

/** اعتبار اطلاعات: هرچه فیلدهای هویتی بیشتر و منبع معتبرتر، بالاتر */
function infoCredibility(lead: Lead): number {
  let hits = 0;
  if (lead.phone) hits++;
  if (lead.website) hits++;
  if (lead.address) hits++;
  if (lead.instagramHandle) hits++;
  if (lead.reviewsCount && lead.reviewsCount > 0) hits++;
  return Math.min(hits / 4, 1);
}

/** فعالیت آنلاین: سایت + اینستاگرام + نظرات */
function onlineActivity(lead: Lead): number {
  let s = 0;
  if (lead.website) s += 0.4;
  if (lead.instagramHandle) s += 0.4;
  if (lead.reviewsCount && lead.reviewsCount >= 5) s += 0.2;
  return Math.min(s, 1);
}

/** تناسب نمونه‌کار: آیا صنعت لید با نمونه‌کارهای موجود هم‌خانواده است؟ */
function portfolioFit(lead: Lead): number {
  const industry = (lead.industry ?? "").toLowerCase();
  // نمونه‌کارهای مهدیار: مبلمان/تشک، طلا و جواهر، صنعت کابل و برق (B2B صنعتی)
  const strong = ["company", "industrial", "works", "wholesale", "furniture", "jewelry", "clothes", "shop"];
  const medium = ["clinic", "dentist", "doctors", "beauty", "hairdresser", "school", "educational"];
  if (strong.some((k) => industry.includes(k))) return 1;
  if (medium.some((k) => industry.includes(k))) return 0.7;
  return 0.5; // پیش‌فرض: تناسب متوسط (خدمات مهدیار عمومی‌اند)
}

/** ریسک پایین: عدم DNC، وضعیت سالم، نبود پرچم ریسک در تحلیل */
function lowRisk(lead: Lead, analysis: LeadAnalysisOutput | null): number {
  if (lead.doNotContact) return 0;
  const flags = analysis?.riskFlags?.length ?? 0;
  if (flags === 0) return 1;
  if (flags === 1) return 0.6;
  return 0.3;
}

/**
 * امتیاز لید را می‌سنجد.
 * @param analysis خروجی ایجنت تحلیل (اگر هنوز تحلیل نشده، null → امتیاز محافظه‌کارانه)
 */
export function scoreLead(lead: Lead, analysis: LeadAnalysisOutput | null): ScoreResult {
  const criteria: Record<ScoringCriterion, number> = {
    // تطابق بازار: اگر به کمپینی با بازار مشخص وصل است، تطابق دارد
    marketFit: lead.campaignId ? 1 : 0.6,
    // نیاز قابل مشاهده: از تحلیل (شواهد + قدرت درد)
    visibleNeed: analysis
      ? Math.min((analysis.evidence.length / 2) * 0.5 + analysis.confidence * 0.5, 1)
      : 0.4,
    infoCredibility: infoCredibility(lead),
    onlineActivity: onlineActivity(lead),
    portfolioFit: portfolioFit(lead),
    decisionMakerAccess: decisionMakerAccess(lead),
    lowRisk: lowRisk(lead, analysis),
  };

  let total = 0;
  for (const [key, weight] of Object.entries(SCORING_WEIGHTS) as [ScoringCriterion, number][]) {
    total += criteria[key] * weight;
  }
  const score = Math.round(total);

  let decision: ScoreDecision;
  let reason: string;
  if (score >= SCORE_THRESHOLDS.pass) {
    decision = "PASS";
    reason = `امتیاز ${score} ≥ ${SCORE_THRESHOLDS.pass} — واجد شرایط پیام.`;
  } else if (score >= SCORE_THRESHOLDS.nurture) {
    decision = "NURTURE";
    reason = `امتیاز ${score} بین ${SCORE_THRESHOLDS.nurture} و ${SCORE_THRESHOLDS.pass} — فعلاً نگه‌داری شود.`;
  } else {
    decision = "REJECT";
    reason = `امتیاز ${score} < ${SCORE_THRESHOLDS.nurture} — تناسب کافی ندارد.`;
  }

  return { score, criteria, decision, reason };
}
