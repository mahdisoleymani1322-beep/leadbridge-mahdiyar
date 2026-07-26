import "server-only";
import type { Lead } from "@/lib/store/types";

/**
 * سیگنال توان مالی کسب‌وکار — **سرویس قطعی، صفر توکن LLM**.
 *
 * چرا لازم است: خواسته‌ی صریح مالک این است که لیدهای پیشنهادی درآمد بالاتری
 * داشته باشند تا بستن قرارداد راحت‌تر باشد. تا امروز هیچ سیگنالی از توان مالی
 * وجود نداشت و صف لیدها فقط بر اساس تناسب بازار مرتب می‌شد.
 *
 * چرا کد و نه ایجنت: همه‌ی این سیگنال‌ها از داده‌ی ساختاریافته‌ی موجود
 * (تعداد نظر، دامنه، آدرس، نام، صنعت) قابل‌محاسبه‌اند. سپردنش به مدل یعنی
 * خرج توکن برای کاری که یک تابع خالص انجام می‌دهد — و نتیجه‌ی ناپایدار.
 *
 * ⚠️ این یک **تخمین از روی نشانه‌های عمومی** است، نه واقعیت مالی. هرگز نباید
 * وارد متن پیام شود؛ «درآمد مجموعه» جزو UNKNOWABLE_FACTS است. فقط برای
 * اولویت‌بندی صف کار داخل داشبورد استفاده می‌شود.
 */

export type AffluenceResult = {
  /** ۰ تا ۱۰۰ — هرچه بالاتر، نشانه‌های توان مالی بیشتر */
  score: number;
  /** توضیح خوانا برای انسان: هر سیگنالی که امتیاز داد یا کم کرد */
  signals: string[];
};

/** مناطق مرفه تهران — آدرس در این مناطق نشانه‌ی اجاره/ملک گران‌تر است */
const AFFLUENT_AREAS = [
  "زعفرانیه",
  "نیاوران",
  "الهیه",
  "فرمانیه",
  "ولنجک",
  "جردن",
  "آفریقا",
  "پاسداران",
  "میرداماد",
  "سعادت‌آباد",
  "سعادت آباد",
  "قیطریه",
  "دروس",
  "کامرانیه",
  "شهرک غرب",
  "اقدسیه",
  "ï»؟", // نگهبان: رشته‌ی خراب انکودینگ در داده‌ی OSM دیده شده
];

/** دامنه‌های وبلاگ/سایت‌ساز رایگان — نشانه‌ی نبود سرمایه‌گذاری دیجیتال */
const FREE_HOSTS = [
  "blogfa.com",
  "blog.ir",
  "mihanblog.com",
  "persianblog.ir",
  "rozblog.com",
  "blogsky.com",
  "parsiblog.com",
  "sitesaz",
  "wordpress.com",
  "blogspot.com",
  "wixsite.com",
];

/** کلیدواژه‌های مقیاس در نام — «گروه صنعتی» معمولاً بزرگ‌تر از «فروشگاه» است */
const SCALE_KEYWORDS = [
  "گروه صنعتی",
  "هلدینگ",
  "صنایع",
  "مجتمع",
  "بین‌المللی",
  "بین المللی",
  "گروه",
  "کارخانه",
];

/** صنایعی که ذاتاً ارزش قرارداد بالاتری دارند (اولویت ICP مالک) */
const HIGH_VALUE_INDUSTRY = ["صنعت", "کارخانه", "تولید", "شرکت", "بازرگانی", "پخش", "کلینیک"];

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * توان مالی یک لید را از روی نشانه‌های عمومی تخمین می‌زند.
 *
 * @param lead لید (نام، آدرس، سایت، تعداد نظر، صنعت)
 * @param opts.siblingNames نام همه‌ی لیدهای همان کمپین — برای تشخیص چندشعبه‌ای
 * @param opts.instagramFollowers اگر داده‌ی اینستاگرام موجود بود
 */
export function scoreAffluence(
  lead: Lead,
  opts: { siblingNames?: string[]; instagramFollowers?: number | null } = {}
): AffluenceResult {
  let score = 30; // پایه‌ی خنثی — نبودِ داده نباید مثل نشانه‌ی منفی رفتار کند
  const signals: string[] = [];

  // ۱) تعداد نظرات — نماینده‌ی حجم مشتری
  const reviews = lead.reviewsCount ?? 0;
  if (reviews >= 200) {
    score += 18;
    signals.push(`${reviews} نظر ثبت‌شده — حجم مشتری بالا`);
  } else if (reviews >= 50) {
    score += 12;
    signals.push(`${reviews} نظر ثبت‌شده — حجم مشتری قابل‌توجه`);
  } else if (reviews >= 10) {
    score += 6;
    signals.push(`${reviews} نظر ثبت‌شده`);
  }

  // ۲) دامنه: اختصاصی در برابر سایت‌ساز رایگان
  const host = hostOf(lead.website);
  if (!host) {
    score -= 6;
    signals.push("سایتی ثبت نشده");
  } else if (FREE_HOSTS.some((f) => host.endsWith(f) || host.includes(f))) {
    score -= 12;
    signals.push(`سایت روی سرویس رایگان (${host}) — سرمایه‌گذاری دیجیتال کم`);
  } else {
    score += 12;
    signals.push(`دامنه‌ی اختصاصی (${host})`);
    if (lead.website?.startsWith("https://")) score += 3;
  }

  // ۳) منطقه‌ی آدرس
  const addr = lead.address ?? "";
  const area = AFFLUENT_AREAS.find((a) => a.length > 3 && addr.includes(a));
  if (area) {
    score += 14;
    signals.push(`آدرس در منطقه‌ی ${area}`);
  }

  // ۴) کلیدواژه‌ی مقیاس در نام
  const scaleHit = SCALE_KEYWORDS.find((k) => lead.businessName.includes(k));
  if (scaleHit) {
    score += 12;
    signals.push(`نام حاوی «${scaleHit}» — احتمال مقیاس بزرگ‌تر`);
  }

  // ۵) صنعت پرارزش
  const ind = `${lead.industry ?? ""}`;
  if (HIGH_VALUE_INDUSTRY.some((h) => ind.includes(h))) {
    score += 8;
    signals.push(`صنعت «${ind}» — ارزش قرارداد بالاتر`);
  }

  // ۶) چندشعبه‌ای — همان نام روی چند رکورد
  if (opts.siblingNames?.length) {
    const base = lead.businessName.trim();
    const twins = opts.siblingNames.filter((n) => n.trim() === base).length;
    if (twins > 1) {
      score += 10;
      signals.push(`${twins} شعبه با همین نام`);
    }
  }

  // ۷) فالوئر اینستاگرام (وقتی داده موجود شد — خودکار یا دستی)
  const followers = opts.instagramFollowers ?? null;
  if (followers != null) {
    if (followers >= 50_000) {
      score += 14;
      signals.push(`${followers} فالوئر اینستاگرام`);
    } else if (followers >= 10_000) {
      score += 9;
      signals.push(`${followers} فالوئر اینستاگرام`);
    } else if (followers >= 2_000) {
      score += 4;
      signals.push(`${followers} فالوئر اینستاگرام`);
    }
  }

  // ۸) رتبه‌ی بالا با نظر کافی — کیفیت پایدار معمولاً با گردش بالاتر همراه است
  if (lead.rating != null && lead.rating >= 4.3 && reviews >= 20) {
    score += 5;
    signals.push(`امتیاز ${lead.rating} با ${reviews} نظر`);
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (signals.length === 0) signals.push("نشانه‌ی مشخصی از توان مالی پیدا نشد");
  return { score: clamped, signals };
}
