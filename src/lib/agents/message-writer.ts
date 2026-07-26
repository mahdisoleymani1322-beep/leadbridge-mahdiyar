import "server-only";
import { runAgentJSON, writerModel } from "@/lib/ai";
import { COMPANY_PROFILE, BRAND_VOICE, PERSONAS, BANNED_WORDS, SERVICES } from "@/lib/brand";
import { MESSAGE_RULES } from "@/lib/config";
import { lessonsBlockFor } from "./lessons";
import { MessageWriterOutputSchema, type MessageWriterOutput, type LeadAnalysisOutput } from "./types";

/**
 * ایجنت ۴ — نویسنده‌ی پیام (نقشه‌راه §22)
 *
 * نقش: نوشتن یک پیام کوتاه، طبیعی و **عمیقاً شخصی‌سازی‌شده** که دقیقاً درد همین
 * کسب‌وکار را هدف بگیرد و خدمت متناسب مهدیار را به‌عنوان راه‌حل معرفی کند.
 *
 * منبع اصلی: **کل هویت برند مهدیار** (لحن سه‌گانه، ارزش‌ها، کلمات مجاز/ممنوع) —
 * نه فقط فهرست خدمات. این تنها ایجنتی است که بلوک کامل برند را می‌گیرد.
 *
 * ابزار مجاز: هیچ. فقط از تحلیل و شواهدِ داده‌شده استفاده می‌کند.
 * Non-Goals: فروش کامل، قیمت، تخفیف، قرارداد، تعهد، فشار، وعده‌ی نتیجه.
 */

const AGENT = "message-writer";

export type MessageWriterInput = {
  businessName: string;
  industry: string | null;
  city: string | null;
  analysis: LeadAnalysisOutput;
  /** شناسه‌ی خدمت منتخب از ۷ خدمت مهدیار */
  serviceId: string;
  /** کانالی که پیام از آن می‌رود (لحن را کمی تغییر می‌دهد) */
  channel: string | null;
  /** آیا لید ایمیل دارد؟ (اگر بله، نسخه‌ی ایمیلی هم بنویس) */
  hasEmail: boolean;
  /** برای بازنویسی: پیام قبلی + ایرادهای منتقد */
  revision?: { previousMessage: string; instructions: string[] };
};

export async function runMessageWriter(input: MessageWriterInput): Promise<MessageWriterOutput> {
  const lessons = await lessonsBlockFor(AGENT);
  const service = SERVICES.find((s) => s.id === input.serviceId);
  const serviceLabel = service ? `${service.title} (${service.description})` : input.serviceId;

  const system = `تو نویسنده‌ی پیام اول تیم مهدیار هوش‌افزا هستی. پیام‌های تو باید طوری باشد که گیرنده حس کند «این پیام مخصوص من نوشته شده»، نه یک پیام تبلیغاتی کپی‌شده.

${COMPANY_PROFILE}

${BRAND_VOICE}

${PERSONAS}

— ساختار اجباری پیام —
۱. یک مشاهده‌ی واقعی و مشخص از همین کسب‌وکار (از شواهد داده‌شده) — نه تعریف کلی.
۲. اتصال طبیعی آن مشاهده به دردش (بدون تحقیر یا بزرگ‌نمایی).
۳. معرفی کوتاه خدمت مهدیار به‌عنوان راه‌حل — با نام: «${serviceLabel}».
۴. یک دعوت نرم برای گفت‌وگو (نه فشار، نه قرار ملاقات اجباری).

— قوانین سخت —
• طول: ${MESSAGE_RULES.minWords} تا ${MESSAGE_RULES.maxWords} کلمه. نه کمتر، نه بیشتر.
• نام کسب‌وکار باید در پیام بیاید.
• فقط **یک** خدمت معرفی کن. فهرست خدمات نده.
• **ممنوع مطلق**: قیمت، تخفیف، مبلغ، قرارداد، تضمین نتیجه، ادعای بدون سند.
• ممنوع: تظاهر به آشنایی قبلی، ساختن نام مخاطب، اطلاعاتی که در شواهد نیست.
• کلمات ممنوع برند: ${BANNED_WORDS.slice(0, 10).join("، ")} و مشابه آن‌ها.
• لحن: مثل یک همکار باتجربه که چیزی دیده و صادقانه می‌گوید — نه فروشنده.

— نمونه‌کار —
در متن پیام هیچ لینک یا نام نمونه‌کاری نگذار؛ مالک خودش دستی اتچ می‌کند.${lessons}`;

  const emailNote = input.hasEmail
    ? `\n\nاین کسب‌وکار ایمیل دارد: علاوه بر پیام کوتاه، یک نسخه‌ی ایمیلی هم بنویس (emailSubject و emailBody). نسخه‌ی ایمیلی می‌تواند کمی رسمی‌تر و تا ۱۵۰ کلمه باشد، با امضای «احمد پورسلیمانی — مهدیار هوش‌افزا».`
    : `\n\nاین کسب‌وکار ایمیل ندارد: emailSubject و emailBody را null بگذار.`;

  const prompt = `کسب‌وکار: ${input.businessName}${input.industry ? ` (${input.industry})` : ""}${input.city ? ` — ${input.city}` : ""}
کانال ارسال: ${input.channel ?? "نامشخص"}

خلاصه: ${input.analysis.businessSummary}
مشتری هدفش: ${input.analysis.targetCustomer}
درد اصلی: ${input.analysis.painPoint}
شواهد واقعی: ${input.analysis.evidence.join(" | ")}
نشانه‌های نیاز: ${input.analysis.needSignals.join("، ")}
لحن مناسب: ${input.analysis.brandTone}

خدمت انتخاب‌شده‌ی مهدیار: ${serviceLabel}

برای این کسب‌وکار پیام اول را بنویس.${emailNote}${
    input.revision
      ? `\n\n— بازنویسی —\nپیام قبلی‌ات این بود:\n«${input.revision.previousMessage}»\n\nمنتقد این ایرادها را گرفت (همه را رفع کن، ولی ساختار و قواعد بالا را نگه دار):\n${input.revision.instructions
          .map((s) => `- ${s}`)
          .join("\n")}`
      : ""
  }`;

  return runAgentJSON({
    agent: AGENT,
    system,
    prompt,
    model: writerModel(),
    temperature: 0.6, // کمی خلاقیت برای طبیعی‌بودن، ولی نه بی‌ثبات
    maxOutputTokens: 1100,
    schema: MessageWriterOutputSchema,
    shapeHint: `{
  "message": "متن پیام کوتاه (${MESSAGE_RULES.minWords}-${MESSAGE_RULES.maxWords} کلمه)",
  "emailSubject": ${input.hasEmail ? '"موضوع ایمیل"' : "null"},
  "emailBody": ${input.hasEmail ? '"متن ایمیل"' : "null"},
  "personalizationUsed": ["چیزی که مخصوص این کسب‌وکار استفاده شد"],
  "painTargeted": "دردی که پیام هدف گرفته",
  "cta": "دعوت پایانی",
  "confidence": 0.8
}`,
  });
}
