import "server-only";
import { runAgentJSON } from "@/lib/ai";
import { CRITIC_RUBRIC, messageLengthFor } from "@/lib/config";
import { SERVICES, CLICHE_PHRASES, UNKNOWABLE_FACTS } from "@/lib/brand";
import type { ChannelKey } from "@/lib/store/types";
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
  /** کانال ارسال — بازه‌ی طول مجاز از روی آن تعیین می‌شود */
  channel?: ChannelKey | null;
  /** آیا نویسنده ادعا کرده نمونه‌کار همراه پیام است؟ */
  portfolioMention?: "attached" | "available" | "linked" | "none";
}): Promise<MessageCriticOutput> {
  const lessons = await lessonsBlockFor(AGENT);
  const service = SERVICES.find((s) => s.id === input.serviceId);
  const len = messageLengthFor(input.channel ?? null);

  const system = `تو منتقد مستقل پیام‌های تیم مهدیار هوش‌افزا هستی. کارت این است که پیش از ارسال، پیام را سخت‌گیرانه ارزیابی کنی. تو پیام را بازنویسی نمی‌کنی؛ فقط نمره می‌دهی و ایراد می‌گیری.

— روبریک (جمع = ۱۰۰) —
• صحت و اتکا به شواهد (${CRITIC_RUBRIC.accuracy}): هر چیزی که پیام به‌عنوان **واقعیت** می‌گوید باید در شواهد زیر قابل‌ردیابی باشد. هر ادعای بدون سند → این معیار را صفر بده. مخصوصاً حواست به این‌ها باشد که هرگز از داده‌ی عمومی قابل‌دانستن نیستند: ${UNKNOWABLE_FACTS.join("، ")}.
• شخصی‌سازی (${CRITIC_RUBRIC.personalization}): جمله‌ی اول باید یک **جزئیات مشخص** از همین کسب‌وکار داشته باشد، نه تعریف کلی. «صفحه حرفه‌ای شما را دیدم» یا «پتانسیل بالایی دارید» = نمره‌ی خیلی پایین.
• وضوح (${CRITIC_RUBRIC.clarity}): پیام روشن است؟ جمله‌ها کوتاه و قابل‌فهم‌اند؟
• طبیعی‌بودن (${CRITIC_RUBRIC.naturalness}): مثل یک آدم واقعی نوشته شده یا مثل تبلیغات؟ وجود هر یک از این عبارت‌های قالبی نمره را کف می‌آورد: ${CLICHE_PHRASES.slice(0, 8).join("، ")}.
• تناسب خدمت (${CRITIC_RUBRIC.serviceFit}): خدمت‌های معرفی‌شده (۱ اصلی + حداکثر ۲ مکمل) واقعاً یک نتیجه‌ی مشترک می‌دهند و درد را حل می‌کنند؟ اگر پیام به فهرست توانایی‌ها تبدیل شده، نمره‌ی پایین.
• دعوت به گفت‌وگو (${CRITIC_RUBRIC.cta}): دعوت نرم و روشن است؟ فشار ندارد؟
• رعایت محدودیت‌ها (${CRITIC_RUBRIC.constraints}): بدون قیمت/تخفیف/قرارداد/تضمین، بدون ادعای ساختگی، بدون تظاهر به آشنایی قبلی.

— قواعد نمره‌دهی —
۱. سخت‌گیر باش. نمره‌ی بالا فقط برای پیامی که واقعاً آماده‌ی ارسال است.
۲. پیام «عمومی» (که برای هر کسب‌وکاری صدق می‌کند) نمی‌تواند بالای ۷۵ بگیرد.
۳. اگر قیمت/تخفیف/تضمین دیدی، constraints را صفر بده.
۴. **پیشنهاد به‌شکل مشکل قطعی** ممنوع است: «محتوای شما ضعیف است» یا «مشتریانتان پیگیری نمی‌شوند» → constraints صفر. برداشت باید محتاطانه بیان شود («فکر کردم می‌شه…»، «به نظرم…»).
۵. **ادعای دروغِ نمونه‌کار**: نویسنده اعلام کرده وضعیت نمونه‌کار «${input.portfolioMention ?? "available"}» است. اگر متن می‌گوید «فرستادم/همراه پیام ارسال کردم» ولی وضعیت «attached» نیست → constraints صفر.
۶. **طول**: کانال «${input.channel ?? "نامشخص"}» → حدود ${len.min} تا ${len.max} کلمه. کوتاه‌تر بودن ایراد نیست اگر منظور کامل رسیده باشد؛ ولی پیامِ بی‌دلیل کش‌داده‌شده از نمره‌ی وضوح کم می‌کند.
۷. score باید دقیقاً مجموع هفت معیار باشد.
۸. revisionInstructions باید **مشخص و عملی** باشد («جمله‌ی دوم را با اشاره به X جایگزین کن»)، نه کلی («بهترش کن»).${lessons}`;

  const prompt = `کسب‌وکار: ${input.businessName}
درد تشخیص‌داده‌شده: ${input.analysis.painPoint}
شواهد موجود (تنها منبع مجاز برای ادعای واقعیت): ${input.analysis.evidence.join(" | ")}
خدمت اصلی انتخاب‌شده: ${service?.title ?? input.serviceId}
کانال ارسال: ${input.channel ?? "نامشخص"}

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
