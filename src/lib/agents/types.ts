import { z } from "zod";

/**
 * قرارداد خروجی هر ایجنت — با Zod.
 *
 * خروجی هر ایجنت «ورودی» گام بعدی است؛ اگر این قرارداد شل باشد خطا در کل
 * زنجیره سرایت می‌کند. اسکیمای صریح + اعتبارسنجی، همان کاری است که interface
 * در کد معمولی می‌کند. (نقشه‌راه §13)
 */

/* ── ۱. تحلیل لید ───────────────────────────────────────── */

export const LeadAnalysisOutputSchema = z.object({
  businessSummary: z.string().min(10),
  targetCustomer: z.string().min(3),
  /** درد اصلی و مشخصِ همین کسب‌وکار — قلب شخصی‌سازی پیام */
  painPoint: z.string().min(10),
  /** نشانه‌های نیاز (حداکثر ۴ مورد کوتاه) */
  needSignals: z.array(z.string()).min(1).max(4),
  /** شواهد قابل‌استناد از داده‌ی داده‌شده — بدون شاهد، پیام ساخته نمی‌شود */
  evidence: z.array(z.string()).min(1).max(4),
  /** چیزهایی که مطمئن نیستیم (صداقت — نقشه‌راه §7.3) */
  uncertainties: z.array(z.string()).max(3),
  brandTone: z.string(),
  riskFlags: z.array(z.string()).max(3),
  /** اطمینان ۰ تا ۱ */
  confidence: z.number().min(0).max(1),
});

export type LeadAnalysisOutput = z.infer<typeof LeadAnalysisOutputSchema>;

/* ── ۲. انتخاب خدمت ─────────────────────────────────────── */

export const ServiceMatchOutputSchema = z.object({
  /** شناسه‌ی خدمت از میان ۷ خدمت رسمی مهدیار (brand.SERVICE_IDS) */
  serviceId: z.string().min(2),
  reason: z.string().min(10),
  /** شواهدی که این انتخاب را پشتیبانی می‌کنند */
  evidence: z.array(z.string()).min(1).max(3),
  /** خدمت جایگزین (اختیاری) */
  alternativeServiceId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type ServiceMatchOutput = z.infer<typeof ServiceMatchOutputSchema>;

/* ── ۳. انتخاب نمونه‌کار ────────────────────────────────── */

export const PortfolioSelectOutputSchema = z.object({
  /** حداکثر ۲ نمونه، ترجیحاً ۱ (نقشه‌راه §21) — فقط id از فهرست داده‌شده */
  selectedIds: z.array(z.string()).max(2),
  reason: z.string(),
  /** اگر هیچ نمونه‌ی مرتبطی نبود، صادقانه true */
  missingPortfolioGap: z.boolean(),
});

export type PortfolioSelectOutput = z.infer<typeof PortfolioSelectOutputSchema>;

/* ── شناسه‌ی ایجنت‌ها (برای درس‌های خودبهبودی) ───────────── */

export const AGENT_IDS = [
  "lead-analysis",
  "service-match",
  "portfolio-select",
  "message-writer",
  "message-critic",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
