import "server-only";
import type { Lead, ChannelKey } from "@/lib/store/types";

/**
 * سیگنال توان مالی کسب‌وکار — **سرویس قطعی، صفر توکن LLM**.
 *
 * چرا لازم است: خواسته‌ی صریح مالک این است که لیدهای پیشنهادی درآمد بالاتری
 * داشته باشند، و مهم‌تر: این نمره **دروازه‌ی پیش از تحلیل** است. هر لید ضعیفی
 * که تحلیل شود یک فراخوان از سهمیه‌ی ۵۰ درخواستِ روزانه را می‌سوزاند. پس اول
 * رایگان غربال می‌کنیم، بعد توکن خرج می‌کنیم (اصل §کارایی توکن نقشه‌راه).
 *
 * چرا کد و نه ایجنت: همه‌ی سیگنال‌ها از داده‌ی ساختاریافته‌ی موجود قابل‌محاسبه‌اند.
 * سپردنش به مدل یعنی خرج توکن برای کاری که یک تابع خالص انجام می‌دهد — و
 * نتیجه‌ی ناپایدار.
 *
 * ⚠️ این **تخمینی از نشانه‌های عمومی** است، نه واقعیت مالی. هرگز نباید وارد متن
 * پیام شود؛ «درآمد مجموعه» جزو UNKNOWABLE_FACTS است.
 *
 * ── درسی که از داده‌ی واقعی گرفته شد ──
 * نسخه‌ی اول این فایل سنگین‌ترین وزنش را روی `reviewsCount` و `rating` گذاشته
 * بود. بررسی ۴۵ لید واقعی نشان داد **هر ۴۵ تا `reviewsCount = null` دارند**:
 * منبع پیش‌فرض ما OpenStreetMap است و این فیلدها مال Google Places هستند
 * (`openstreetmap.ts` صریحاً `rating: null, reviewsCount: null` می‌گذارد).
 * پس وزن اصلی به سیگنال‌هایی منتقل شد که واقعاً در دسترس‌اند: نوع دامنه،
 * ایمیل روی دامنه‌ی اختصاصی، تلفن ثابت، تعداد کانال‌های ارتباط، منطقه و مقیاس
 * نام. کد امتیاز نظرات می‌ماند تا اگر روزی کلید Google اضافه شد کار کند.
 */

export type AffluenceResult = {
  /** ۰ تا ۱۰۰ — هرچه بالاتر، نشانه‌های توان مالی بیشتر */
  score: number;
  /** توضیح خوانا برای انسان: هر سیگنالی که امتیاز داد */
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
  "تجریش",
  "ظفر",
  "ونک",
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
  "instagram.com",
];

/** سرویس‌های ایمیل رایگان — ایمیل روی دامنه‌ی اختصاصی سیگنال قوی‌تری است */
const FREE_MAIL_HOSTS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "mail.ru",
  "chmail.ir",
  "yahoo.co",
];

/**
 * کلیدواژه‌های مقیاس در نام — «گروه صنعتی» معمولاً بزرگ‌تر از «فروشگاه» است.
 *
 * «دفتر مرکزی» عمداً هست: کسب‌وکاری که دفتر مرکزی جدا از محل تولید دارد ذاتاً
 * بزرگ‌تر است. «نمایندگی» عمداً **نیست** — نمایندگی خودروی تک‌شعبه هم همین
 * نام را دارد و سیگنال را رقیق می‌کند.
 */
const SCALE_KEYWORDS = [
  "گروه صنعتی",
  "هلدینگ",
  "دفتر مرکزی",
  "صنایع",
  "مجتمع",
  "بین‌المللی",
  "بین المللی",
  "کارخانه",
  "گروه",
  "شرکت",
];

/** صنایعی که ذاتاً ارزش قرارداد بالاتری دارند (اولویت ICP مالک) */
const HIGH_VALUE_INDUSTRY = [
  "صنعت",
  "کارخانه",
  "تولید",
  "company",
  "industrial",
  "works",
  "clinic",
  "dentist",
  "بازرگانی",
  "پخش",
  "کلینیک",
];

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** ارقام فارسی/عربی را به لاتین تبدیل و بقیه را حذف می‌کند */
function digits(v: string): string {
  return v
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

/**
 * توان مالی یک لید را از روی نشانه‌های عمومی تخمین می‌زند.
 *
 * امتیاز از صفر جمع می‌شود (نه از یک پایه‌ی خنثی) تا عدد تفسیرپذیر باشد:
 * «۴۵» یعنی مجموع سیگنال‌های مثبتِ پیداشده، نه «۳۰ پایه + ۱۵».
 *
 * @param lead لید
 * @param opts.siblingNames نام همه‌ی لیدهای همان کمپین — برای تشخیص چندشعبه‌ای
 * @param opts.instagramFollowers اگر داده‌ی اینستاگرام موجود بود
 */
export function scoreAffluence(
  lead: Lead,
  opts: { siblingNames?: string[]; instagramFollowers?: number | null } = {}
): AffluenceResult {
  let score = 0;
  const signals: string[] = [];

  // ── ۱) وب‌سایت و نوع دامنه — قوی‌ترین سیگنال در دسترس ──
  const host = hostOf(lead.website);
  if (host && FREE_HOSTS.some((f) => host === f || host.endsWith("." + f) || host.includes(f))) {
    signals.push(`سایت روی سرویس رایگان (${host}) — سرمایه‌گذاری دیجیتال کم`);
  } else if (host) {
    score += 18;
    signals.push(`دامنه‌ی اختصاصی (${host})`);
  } else {
    signals.push("سایتی ثبت نشده");
  }

  // ── ۲) ایمیل روی دامنه‌ی اختصاصی — نشانه‌ی زیرساخت واقعی ──
  const email = lead.contactChannels.email;
  if (email) {
    const mailHost = email.split("@")[1]?.toLowerCase() ?? "";
    if (mailHost && !FREE_MAIL_HOSTS.some((f) => mailHost.endsWith(f))) {
      score += 14;
      signals.push(`ایمیل روی دامنه‌ی اختصاصی (@${mailHost})`);
    } else {
      score += 3;
      signals.push("ایمیل روی سرویس رایگان");
    }
  }

  // ── ۳) تلفن ثابت در برابر موبایل — ثابت یعنی دفتر فیزیکی ──
  const phone = digits(lead.contactChannels.phone ?? lead.phone ?? "");
  if (phone) {
    const isMobile = /^(0?9\d{9}|989\d{9})$/.test(phone);
    if (!isMobile && phone.length >= 8) {
      score += 10;
      signals.push("تلفن ثابت — دفتر فیزیکی");
    } else {
      score += 2;
      signals.push("فقط تلفن همراه");
    }
  }

  // ── ۴) تعداد کانال‌های ارتباط — کسب‌وکار جاافتاده چند راه ارتباط دارد ──
  const channelKeys = (Object.keys(lead.contactChannels) as ChannelKey[]).filter(
    (k) => lead.contactChannels[k]
  );
  if (channelKeys.length > 1) {
    const bonus = Math.min(12, (channelKeys.length - 1) * 3);
    score += bonus;
    signals.push(`${channelKeys.length} کانال ارتباط فعال`);
  }

  // ── ۵) حضور اینستاگرام — فعالیت دیجیتال ──
  if (lead.instagramHandle) {
    score += 6;
    signals.push("پیج اینستاگرام دارد");
  }

  // ── ۶) منطقه‌ی آدرس ──
  const addr = lead.address ?? "";
  const area = AFFLUENT_AREAS.find((a) => addr.includes(a));
  if (area) {
    score += 14;
    signals.push(`آدرس در منطقه‌ی ${area}`);
  }

  // ── ۷) کلیدواژه‌ی مقیاس در نام ──
  const scaleHit = SCALE_KEYWORDS.find((k) => lead.businessName.includes(k));
  if (scaleHit) {
    score += 12;
    signals.push(`نام حاوی «${scaleHit}» — احتمال مقیاس بزرگ‌تر`);
  }

  // ── ۸) صنعت پرارزش ──
  const ind = `${lead.industry ?? ""}`.toLowerCase();
  const indHit = HIGH_VALUE_INDUSTRY.find((h) => ind.includes(h.toLowerCase()));
  if (indHit) {
    score += 8;
    signals.push(`صنعت «${lead.industry}» — ارزش قرارداد بالاتر`);
  }

  // ── ۹) چندشعبه‌ای ──
  if (opts.siblingNames?.length) {
    const base = lead.businessName.trim();
    const twins = opts.siblingNames.filter((n) => n.trim() === base).length;
    if (twins > 1) {
      score += 8;
      signals.push(`${twins} شعبه با همین نام`);
    }
  }

  // ── ۱۰) نظرات و امتیاز نقشه ──
  // فقط Google Places این‌ها را می‌دهد؛ با OSM (منبع پیش‌فرض فعلی) همیشه null
  // است. کد می‌ماند تا اگر کلید Google اضافه شد بدون تغییر کار کند.
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
  if (lead.rating != null && lead.rating >= 4.3 && reviews >= 20) {
    score += 5;
    signals.push(`امتیاز ${lead.rating} با ${reviews} نظر`);
  }

  // ── ۱۱) فالوئر اینستاگرام (وقتی داده موجود شد — خودکار یا دستی) ──
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

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  if (signals.length === 0) signals.push("نشانه‌ی مشخصی از توان مالی پیدا نشد");
  return { score: clamped, signals };
}
