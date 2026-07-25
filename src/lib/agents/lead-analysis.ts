import "server-only";
import { runAgentJSON } from "@/lib/ai";
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

  return lines.join("\n");
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

  return runAgentJSON({
    agent: AGENT,
    system,
    prompt,
    temperature: 0.3,
    maxOutputTokens: 900,
    schema: LeadAnalysisOutputSchema,
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
}
