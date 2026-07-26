import "server-only";
import { runAgentJSON } from "@/lib/ai";
import { CRITIC_RUBRIC } from "@/lib/config";
import { SERVICES } from "@/lib/brand";
import { lessonsBlockFor } from "./lessons";
import { MessageCriticOutputSchema, type MessageCriticOutput, type LeadAnalysisOutput } from "./types";

/**
 * ایجنت ۵ — منتقد پیام (نقشه‌راه §23)
 *
 * نقش: ارزیابی **مستقل** پیام پیش از ارسال. عمداً جدا از نویسنده است؛ اگر همان
 * ایجنت هم بنویسد هم نمره بدهد، کار خودش را تأیید می‌کند.
 *
 * آستانه‌ها (از config، نه از قضاوت مدل):
 *   ≥۸۵ تأیید · ۷۵–۸۴ یک بازنویسی · <۷۵ رد
 *
 * ابزار مجاز: هیچ. فقط پیام و زمینه‌ی داده‌شده را می‌سنجد.
 * Non-Goals: بازنویسی پیام (فقط ایراد می‌گیرد)، تغییر آستانه‌ها.
 */

const AGENT = "message-critic";

export async function runMessageCritic(input: {
  message: string;
  businessName: string;
  analysis: LeadAnalysisOutput;
  serviceId: string;
}): Promise<MessageCriticOutput> {
  const lessons = await lessonsBlockFor(AGENT);
  const service = SERVICES.find((s) => s.id === input.serviceId);

  const system = `تو منتقد مستقل پیام‌های تیم مهدیار هوش‌افزا هستی. کارت این است که پیش از ارسال، پیام را سخت‌گیرانه ارزیابی کنی. تو پیام را بازنویسی نمی‌کنی؛ فقط نمره می‌دهی و ایراد می‌گیری.

— روبریک (جمع = ۱۰۰) —
• صحت و اتکا به شواهد (${CRITIC_RUBRIC.accuracy}): آیا هر ادعای پیام از شواهد واقعی می‌آید؟ چیزی از خودش ساخته؟
• شخصی‌سازی (${CRITIC_RUBRIC.personalization}): آیا این پیام **فقط** برای همین کسب‌وکار معنا دارد؟ اگر با تغییر نام برای هر کسب‌وکار دیگری هم کار می‌کند، نمره‌ی این بخش خیلی پایین است.
• وضوح (${CRITIC_RUBRIC.clarity}): پیام روشن است؟ جمله‌ها کوتاه و قابل‌فهم‌اند؟
• طبیعی‌بودن (${CRITIC_RUBRIC.naturalness}): مثل یک آدم واقعی نوشته شده یا مثل تبلیغات؟
• تناسب خدمت (${CRITIC_RUBRIC.serviceFit}): خدمت معرفی‌شده واقعاً درد را حل می‌کند؟
• دعوت به گفت‌وگو (${CRITIC_RUBRIC.cta}): دعوت نرم و روشن است؟ فشار ندارد؟
• رعایت محدودیت‌ها (${CRITIC_RUBRIC.constraints}): بدون قیمت/تخفیف/قرارداد/تضمین، بدون ادعای ساختگی، بدون تظاهر به آشنایی قبلی.

— قواعد نمره‌دهی —
۱. سخت‌گیر باش. نمره‌ی بالا فقط برای پیامی که واقعاً آماده‌ی ارسال است.
۲. پیام «عمومی» (که برای هر کسب‌وکاری صدق می‌کند) نمی‌تواند بالای ۷۵ بگیرد.
۳. اگر قیمت/تخفیف/تضمین دیدی، constraints را صفر بده.
۴. score باید دقیقاً مجموع هفت معیار باشد.
۵. revisionInstructions باید **مشخص و عملی** باشد («جمله‌ی دوم را با اشاره به X جایگزین کن»)، نه کلی («بهترش کن»).${lessons}`;

  const prompt = `کسب‌وکار: ${input.businessName}
درد تشخیص‌داده‌شده: ${input.analysis.painPoint}
شواهد موجود: ${input.analysis.evidence.join(" | ")}
خدمت انتخاب‌شده: ${service?.title ?? input.serviceId}

— پیام برای ارزیابی —
«${input.message}»

این پیام را طبق روبریک نمره بده.`;

  return runAgentJSON({
    agent: AGENT,
    system,
    prompt,
    temperature: 0.2, // ارزیابی باید پایدار باشد، نه خلاقانه
    maxOutputTokens: 700,
    schema: MessageCriticOutputSchema,
    shapeHint: `{
  "score": 82,
  "rubric": { "accuracy": 16, "personalization": 11, "clarity": 13, "naturalness": 8, "serviceFit": 8, "cta": 8, "constraints": 18 },
  "violations": ["ایراد مشاهده‌شده"],
  "revisionInstructions": ["دستور اصلاح مشخص و عملی"]
}`,
  });
}
