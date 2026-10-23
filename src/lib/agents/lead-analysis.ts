import "server-only";
import { newCallBudget, runAgentJSON } from "@/lib/ai";
import { BRAND_CONTEXT_SHORT } from "@/lib/brand";
import { lessonsBlockFor } from "./lessons";
import { LeadAnalysisOutputSchema, type LeadAnalysisOutput } from "./types";
import type { Lead } from "@/lib/store";
import type { IgProfile } from "@/lib/integrations/instagram";

/**
 * ایجنت ۱ — تحلیل لید (نقشه‌راه §18)
 *
 * نقش: از داده‌ی عمومیِ یک کسب‌وکار، «درد اصلی و قابل‌استناد» آن را استخراج کند.
 * این خروجی، پایه‌ی شخصی‌سازی پیام است — بدون شاهد واقعی، پیامی ساخته نمی‌شود.
 *
 * ابزار مجاز: هیچ. (معماری «مدل تصمیم می‌گیرد، کد اجرا می‌کند» — همه‌ی داده
 * توسط ارکستریتور فراهم می‌شود؛ ایجنت حق فراخوانی بیرونی یا ساختن داده ندارد.)
 *
 * بودجه: یک فراخوان، خروجی کوتاه — بهینه‌ی توکن.
 */

const AGENT = "lead-analysis";
export const LEAD_ANALYSIS_FALLBACK_FLAG =
  "مدل هوش مصنوعی در دسترس نبود؛ این گزارش فقط بر پایه‌ی داده‌های ثبت‌شده است.";

/** ورودی فشرده‌ی ایجنت — فقط داده‌ی واقعیِ موجود (بدون حدس) */
export type LeadAnalysisInput = {
  lead: Lead;
  /** پروفایل اینستاگرام اگر در دسترس بود (اختیاری) */
  igProfile?: IgProfile | null;
};

/** داده‌ی لید را به یک بلوک کوتاه و خوانا برای مدل تبدیل می‌کند (کم‌توکن) */
function factsBlock(input: LeadAnalysisInput): string {
  const l = input.lead;
  const channels = Object.entries(l.contactChannels)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join("، ");

  const lines = [
    `نام: ${l.businessName}`,
    l.industry ? `صنف/نوع: ${l.industry}` : null,
    l.city ? `شهر: ${l.city}` : null,
    l.address ? `آدرس: ${l.address}` : null,
    l.website ? `وب‌سایت: ${l.website}` : "وب‌سایت: ندارد (یا پیدا نشد)",
    l.instagramHandle ? `اینستاگرام: ${l.instagramHandle}` : "اینستاگرام: پیدا نشد",
    channels ? `کانال‌های تماس موجود: ${channels}` : "کانال تماس: تقریباً هیچ",
    l.rating != null ? `امتیاز نقشه: ${l.rating} (${l.reviewsCount ?? 0} نظر)` : null,
    `منبع کشف: ${l.source}`,
  ].filter(Boolean);

  if (input.igProfile) {
    const ig = input.igProfile;
    lines.push(
      `— اینستاگرام (داده‌ی عمومی) —`,
      `فالوئر: ${ig.followersCount ?? "?"} · تعداد پست: ${ig.mediaCount ?? "?"}`,
      ig.biography ? `بایو: ${ig.biography.slice(0, 200)}` : "بایو: خالی",
      ig.recentCaptions.length
        ? `نمونه کپشن‌های اخیر: ${ig.recentCaptions.slice(0, 3).map((c) => c.slice(0, 100)).join(" | ")}`
        : "پست اخیر: یافت نشد"
    );
  }

  // یافته‌ی دستی — تا وقتی توکن اینستاگرام ست نشده، این تنها منبع مشاهده‌ی
  // واقعی پیج است. برای مدل به‌اندازه‌ی داده‌ی خودکار معتبر است.
  if (l.igNote) {
    lines.push(`— بررسی دستی پیج اینستاگرام (مشاهده‌ی قطعی) —`, l.igNote.slice(0, 600));
  }

  return lines.join("\n");
}

/**
 * اگر مدل/سهمیه در دسترس نبود، یک گزارش محدود و صادقانه از فیلدهای موجود
 * می‌سازیم تا دکمه‌ی تحلیل کل صف را متوقف نکند. این خروجی اجازه‌ی پیام‌سازی
 * یا امتیازدهی خودکار نمی‌دهد؛ ارکستریتور لید را برای بررسی نگه می‌دارد.
 */
function fallbackAnalysis(lead: Lead): LeadAnalysisOutput {
  const evidence: string[] = [];
  if (lead.industry) evidence.push(`صنف ثبت‌شده در رکورد لید: ${lead.industry}.`);
  if (lead.city) evidence.push(`شهر ثبت‌شده در رکورد لید: ${lead.city}.`);
  if (lead.website) {
    evidence.push(`نشانی وب‌سایت ثبت‌شده: ${lead.website}.`);
  } else {
    evidence.push("نشانی وب‌سایت در رکورد لید ثبت نشده است؛ این به‌تنهایی نبود وب‌سایت را ثابت نمی‌کند.");
  }

  const channelNames: Record<string, string> = {
    instagram: "اینستاگرام",
    whatsapp: "واتساپ",
    telegram: "تلگرام",
    email: "ایمیل",
    phone: "تلفن",
    siteForm: "فرم سایت",
  };
  const channels = Object.entries(lead.contactChannels)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => channelNames[key] ?? key);
  if (channels.length) evidence.push(`کانال‌های تماس ثبت‌شده: ${channels.join("، ")}.`);
  if (lead.igNote) evidence.push(`یادداشت بررسی دستی اینستاگرام ثبت شده است: ${lead.igNote.slice(0, 180)}.`);
  if (lead.rating != null) {
    evidence.push(`امتیاز ثبت‌شده در نقشه: ${lead.rating} از ${lead.reviewsCount ?? 0} نظر.`);
  }
  if (evidence.length === 0) evidence.push(`نام کسب‌وکار ثبت‌شده: ${lead.businessName}.`);

  const businessDescription = lead.industry
    ? `در رکورد لید به‌عنوان کسب‌وکارِ حوزه‌ی «${lead.industry}» ثبت شده است`
    : "در فهرست لیدها ثبت شده است";
  const missingOnlineChannel = !lead.website && !lead.instagramHandle;

  return LeadAnalysisOutputSchema.parse({
    businessSummary: `«${lead.businessName}» ${businessDescription}${lead.city ? ` و شهر ثبت‌شده‌ی آن ${lead.city} است` : ""}.`,
    targetCustomer: "مشتری هدف دقیق از داده‌های ثبت‌شده قابل‌تشخیص نیست.",
    painPoint: `درد دیجیتالِ قابل‌استنادی برای «${lead.businessName}» در داده‌های موجود مشخص نیست؛ پیش از پیشنهاد خدمت باید وضعیت واقعی کانال‌های آنلاین بررسی شود.`,
    needSignals: [
      missingOnlineChannel
        ? "نشانی وب‌سایت و شناسه‌ی اینستاگرام در رکورد ثبت نشده‌اند؛ وجود یا نبود واقعی آن‌ها باید بررسی شود."
        : "داده‌های فعلی برای تأیید یک نیاز دیجیتال مشخص کافی نیستند.",
    ],
    evidence: evidence.slice(0, 4),
    uncertainties: [
      "گزارش به‌دلیل در دسترس نبودن مدل، از روی فیلدهای ذخیره‌شده ساخته شده است.",
      "وضعیت واقعی وب‌سایت و شبکه‌های اجتماعی مستقلاً بررسی نشده است.",
    ],
    brandTone: "محترمانه و کوتاه؛ ابتدا وضعیت فعلی را با یک پرسش روشن بررسی کن.",
    riskFlags: [LEAD_ANALYSIS_FALLBACK_FLAG],
    confidence: 0.05,
  });
}

function isModelAvailabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|aborted|aborterror|429|rate.?limit|quota|free.?model|provider returned error|invalid json response|json.{0,20}(invalid|parse|valid)|502|503|504|overloaded|unavailable|fetch failed|network/i.test(
    message
  );
}

export async function runLeadAnalysis(input: LeadAnalysisInput): Promise<LeadAnalysisOutput> {
  const lessons = await lessonsBlockFor(AGENT);

  const system = `تو تحلیل‌گر کسب‌وکار تیم مهدیار هوش‌افزا هستی. کارت این است که از داده‌ی عمومیِ یک کسب‌وکار، «درد دیجیتالِ مشخص و قابل‌استناد» آن را پیدا کنی تا بعداً بتوانیم پیام شخصی‌سازی‌شده بنویسیم.

${BRAND_CONTEXT_SHORT}

— قوانین سخت —
۱. فقط از داده‌ای که به تو داده شده استفاده کن. **هیچ اطلاعاتی نساز** (نه شماره، نه آمار، نه ادعا).
۲. هر ادعای تحلیلی باید به یک شاهد واقعی از همان داده وصل باشد (فیلد evidence).
۳. اگر داده کم است، صادق باش: confidence را پایین بده و در uncertainties بنویس. کم‌داده‌بودن خودش یک یافته است، نه دلیلِ ساختنِ حدس.
۴. درد باید **مختص همین کسب‌وکار** باشد، نه جمله‌ی عمومی مثل «نیاز به دیجیتال‌مارکتینگ دارد».
۵. ممنوع: قیمت، تخفیف، تضمین نتیجه، لحن تبلیغاتی.

— هدف —
درد را طوری بنویس که بشود مستقیماً به یکی از خدمات مهدیار وصلش کرد.
مثال خوب: «سایت ندارد و تنها کانالش یک اینستاگرام کم‌پست است؛ مشتری جدید فقط از مراجعه‌ی حضوری می‌آید.»
مثال بد: «باید حضور آنلاین خود را تقویت کند.»${lessons}`;

  const prompt = `این داده‌ی عمومیِ یک کسب‌وکار است. تحلیلش کن:

${factsBlock(input)}`;

  try {
    return await runAgentJSON({
      agent: AGENT,
      system,
      prompt,
      temperature: 0.3,
      maxOutputTokens: 900,
      schema: LeadAnalysisOutputSchema,
      // یک لید ناموفق سه مدل رایگان را پشت‌سرهم امتحان نکند؛ گزارش محدود
      // جایگزین، خطای مدل یا JSON نامعتبر را بدون خرج‌کردن تلاش‌های بیشتر پوشش می‌دهد.
      budget: newCallBudget(1),
      shapeHint: `{
  "businessSummary": "این کسب‌وکار چه می‌فروشد و چطور کار می‌کند (۱-۲ جمله)",
  "targetCustomer": "مشتری هدفش کیست",
  "painPoint": "درد دیجیتالِ مشخص همین کسب‌وکار",
  "needSignals": ["نشانه‌ی نیاز ۱", "نشانه‌ی نیاز ۲"],
  "evidence": ["شاهد واقعی از داده‌ی بالا"],
  "uncertainties": ["چیزی که مطمئن نیستیم"],
  "brandTone": "لحن مناسب برای صحبت با این کسب‌وکار",
  "riskFlags": [],
  "confidence": 0.7
}`,
    });
  } catch (error) {
    if (!isModelAvailabilityError(error)) throw error;
    return fallbackAnalysis(input.lead);
  }
}
