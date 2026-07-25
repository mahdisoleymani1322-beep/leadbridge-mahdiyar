import "server-only";
import { runAgentJSON } from "@/lib/ai";
import { SERVICES_BLOCK, SERVICE_IDS, FLAGSHIP_SERVICE_ID } from "@/lib/brand";
import { lessonsBlockFor } from "./lessons";
import { ServiceMatchOutputSchema, type ServiceMatchOutput, type LeadAnalysisOutput } from "./types";

/**
 * ایجنت ۲ — انتخاب خدمت (نقشه‌راه §20)
 *
 * نقش: از میان ۷ خدمت رسمی مهدیار، خدمتی را انتخاب کند که مستقیماً درد
 * تشخیص‌داده‌شده‌ی همان کسب‌وکار را حل می‌کند.
 *
 * ابزار مجاز: هیچ. فقط از تحلیل داده‌شده استفاده می‌کند.
 * قواعد: یک خدمت اصلی برای پیام اول، بدون cross-sell، بدون قیمت.
 */

const AGENT = "service-match";

export async function runServiceMatch(input: {
  businessName: string;
  analysis: LeadAnalysisOutput;
}): Promise<ServiceMatchOutput> {
  const lessons = await lessonsBlockFor(AGENT);

  const system = `تو مسئول تطبیق خدمت در تیم مهدیار هوش‌افزا هستی. از میان خدمات رسمی، آن یکی را انتخاب می‌کنی که دقیقاً درد این کسب‌وکار را حل می‌کند.

${SERVICES_BLOCK}

— قوانین سخت —
۱. serviceId باید **دقیقاً** یکی از id‌های بالا باشد؛ چیز دیگری ننویس.
۲. فقط **یک خدمت اصلی** برای پیام اول (نقشه‌راه §20). خدمت جایگزین اختیاری است.
۳. انتخاب باید به درد و شواهد تحلیل وصل باشد، نه سلیقه.
۴. «${FLAGSHIP_SERVICE_ID}» (تولید محتوای هوشمند) تخصص ویژه‌ی مهدیار است؛ **اگر واقعاً با درد جور بود** به آن اولویت بده — ولی هرگز به‌زور تحمیلش نکن.
۵. اگر هیچ خدمتی واقعاً متناسب نبود، کم‌ترین‌بدترین را انتخاب کن ولی confidence را پایین بگذار.
۶. ممنوع: قیمت، تخفیف، تضمین نتیجه.${lessons}`;

  const prompt = `کسب‌وکار: ${input.businessName}

درد اصلی: ${input.analysis.painPoint}
خلاصه: ${input.analysis.businessSummary}
نشانه‌های نیاز: ${input.analysis.needSignals.join("، ")}
شواهد: ${input.analysis.evidence.join(" | ")}

کدام خدمت مهدیار این درد را حل می‌کند؟`;

  const result = await runAgentJSON({
    agent: AGENT,
    system,
    prompt,
    temperature: 0.2,
    maxOutputTokens: 500,
    schema: ServiceMatchOutputSchema,
    shapeHint: `{
  "serviceId": "یکی از id های خدمات",
  "reason": "چرا این خدمت دقیقاً این درد را حل می‌کند",
  "evidence": ["شاهدی که این انتخاب را پشتیبانی می‌کند"],
  "alternativeServiceId": null,
  "confidence": 0.8
}`,
  });

  // گاردریل قطعی: مدل ممکن است id غیرمجاز بدهد — اینجا مهار می‌شود
  if (!SERVICE_IDS.includes(result.serviceId)) {
    throw new Error(
      `ایجنت «${AGENT}» خدمت نامعتبر «${result.serviceId}» برگرداند (مجاز: ${SERVICE_IDS.join(", ")}).`
    );
  }
  if (result.alternativeServiceId && !SERVICE_IDS.includes(result.alternativeServiceId)) {
    result.alternativeServiceId = null; // جایگزین نامعتبر را بی‌صدا حذف کن
  }

  return result;
}
