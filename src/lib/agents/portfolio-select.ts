import "server-only";
import { runAgentJSON } from "@/lib/ai";
import { lessonsBlockFor } from "./lessons";
import { PortfolioSelectOutputSchema, type PortfolioSelectOutput } from "./types";
import type { PortfolioItem } from "@/lib/store";

/**
 * ایجنت ۳ — انتخاب نمونه‌کار (نقشه‌راه §21)
 *
 * نقش: از میان نمونه‌کارهای **موجود و مجاز**، مرتبط‌ترین را برای پیشنهاد اتچ
 * انتخاب کند. سیستم نمونه‌کار نمی‌سازد و در متن پیام هم جاسازی نمی‌کند —
 * فقط پیشنهاد می‌دهد تا مالک خودش اتچ کند (تصمیم مالک).
 *
 * ابزار مجاز: هیچ. اولویت: صنعت یکسان > مسئله‌ی یکسان > خدمت یکسان.
 */

const AGENT = "portfolio-select";

export async function runPortfolioSelect(input: {
  businessName: string;
  industry: string | null;
  painPoint: string;
  serviceId: string;
  /** فقط نمونه‌کارهای approved && shareAllowed باید داده شوند */
  portfolio: PortfolioItem[];
}): Promise<PortfolioSelectOutput> {
  // اگر مخزن خالی است، اصلاً مدل را صدا نزن (صرفه‌جویی توکن)
  if (input.portfolio.length === 0) {
    return { selectedIds: [], reason: "مخزن نمونه‌کار خالی است.", missingPortfolioGap: true };
  }

  const lessons = await lessonsBlockFor(AGENT);

  const list = input.portfolio
    .map((p) => `- id=${p.id} | ${p.title} | صنعت: ${p.industry} | خدمت: ${p.service} | ${p.style}`)
    .join("\n");

  const system = `تو مسئول انتخاب نمونه‌کار در تیم مهدیار هوش‌افزا هستی.

— قوانین سخت —
۱. فقط از id‌های فهرست زیر انتخاب کن. **id نساز.**
۲. حداکثر ۲ نمونه، ترجیحاً ۱ نمونه‌ی واقعاً مرتبط.
۳. اولویت: صنعت یکسان > مسئله‌ی مشابه > خدمت یکسان > سبک مشابه.
۴. اگر هیچ‌کدام واقعاً مرتبط نیست، آرایه را خالی بگذار و missingPortfolioGap=true. نمونه‌ی بی‌ربط بدتر از هیچ است.
۵. ادعای نتیجه‌ی بدون سند ممنوع.${lessons}`;

  const prompt = `کسب‌وکار هدف: ${input.businessName}${input.industry ? ` (صنعت: ${input.industry})` : ""}
درد: ${input.painPoint}
خدمت انتخاب‌شده: ${input.serviceId}

نمونه‌کارهای موجود:
${list}

کدام نمونه‌کار برای این کسب‌وکار مرتبط‌تر است؟`;

  const result = await runAgentJSON({
    agent: AGENT,
    system,
    prompt,
    temperature: 0.2,
    maxOutputTokens: 400,
    schema: PortfolioSelectOutputSchema,
    shapeHint: `{
  "selectedIds": ["id از فهرست بالا"],
  "reason": "چرا این نمونه مرتبط است",
  "missingPortfolioGap": false
}`,
  });

  // گاردریل قطعی: id‌های توهمی حذف شوند
  const validIds = new Set(input.portfolio.map((p) => p.id));
  const filtered = result.selectedIds.filter((id) => validIds.has(id));
  return {
    ...result,
    selectedIds: filtered,
    missingPortfolioGap: filtered.length === 0 ? true : result.missingPortfolioGap,
  };
}
