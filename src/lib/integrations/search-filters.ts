import "server-only";
import type { DiscoveredPlace } from "./types";
import { normalizeHandle } from "./instagram";

/**
 * فیلترها و تبدیل‌های مشترک **همه‌ی** منابع جست‌وجوی وب (Tavily، Google
 * Programmable Search، و هر منبع بعدی).
 *
 * چرا جدا شد: این قواعد از دل داده‌ی واقعی درآمده‌اند — هر دامنه‌ی این فهرست
 * یک بار لید آشغال ساخته و دستی پیدا شده. وقتی منبع دوم اضافه شد، وسوسه‌ی
 * کپی‌کردنشان زیاد بود؛ ولی دو نسخه یعنی شش ماه دیگر یکی به‌روز می‌شود و
 * دیگری نه، و لید آشغال از همان منبع فراموش‌شده برمی‌گردد.
 */

/**
 * دامنه‌هایی که کسب‌وکار هدف نیستند و باید رد شوند.
 *
 * چرا لازم است: کوئری‌هایی مثل «بهترین کارخانه تهران» عمداً به فهرست‌های
 * تجمیع‌گر و مقاله‌های خبری می‌رسند. بدون این فیلتر، لیدهایی مثل «خبرگزاری مهر»
 * یا «لیست بهترین کارخانه شن و ماسه» وارد پایگاه می‌شوند و سهمیه‌ی تحلیل را
 * می‌سوزانند.
 */
export const DIRECTORY_HOSTS = [
  // تجمیع‌گر و دایرکتوری
  "behtarino.com",
  "iranamozeshgah.com",
  "zibato.net",
  "gzlocation.com",
  "senfyab.com",
  "codata.ir",
  "jobinja.ir",
  "eforosh.com",
  "kilid.com",
  "1717.ir",
  "esfahanchi.ir",
  "doctoreto.com",
  "drdr.ir",
  "paziresh24.com",
  "hircana.com",
  "didebanamniatghazaie.ir",
  "nobat.ir",
  "nobatdehi.com",
  "balad.ir",
  "neshan.org",
  "irunesco.org",
  "aparat.ir",
  "namava.ir",
  // بازارگاه و آگهی
  "digikala.com",
  "sheypoor.com",
  "divar.ir",
  "torob.com",
  "basalam.com",
  "emalls.ir",
  // خبرگزاری و رسانه
  "mehrnews.com",
  "irna.ir",
  "isna.ir",
  "farsnews.ir",
  "tasnimnews.com",
  "khabaronline.ir",
  "yjc.ir",
  "eghtesadonline.com",
  "donya-e-eqtesad.com",
  "shana.ir",
  // عمومی
  "google.com",
  "wikipedia.org",
  "aparat.com",
  "instagram.com", // شاخه‌ی اینستاگرام جداگانه پردازش می‌شود
  "linkedin.com",
  "facebook.com",
  "t.me",
  "telegram.me",
];

/** پسوندهای دامنه که کسب‌وکار خصوصی نیستند */
export const NON_BUSINESS_TLDS = [".ac.ir", ".gov.ir", ".sch.ir", ".edu"];

/**
 * عنوان‌هایی که نشان می‌دهند صفحه یک **فهرست/مقاله** است، نه خود کسب‌وکار.
 * الگوی «لیست بهترین X با آدرس و تلفن» رایج‌ترین دام این نوع جست‌وجوست.
 */
export const LISTICLE_PATTERNS = [
  /^لیست\s/,
  /^فهرست\s/,
  /بانک اطلاعات/,
  /با آدرس و تلفن/,
  /معرفی\s+\d+/,
  /^[\d۰-۹]+\s/, // «۱۰ فروشگاه برتر…»، «۱۳۳ مدل…»
  /(برتر|بهترین|محبوب‌ترین|معروف‌ترین)/,
  /راهنمای (خرید|انتخاب)/,
  /اخبار|خبرگزاری|خبرنگار/,
  /مقاله|پایان‌نامه|دانشگاه|پژوهش/,
  /(\.\.\.|…)\s*$/, // عنوان بریده‌شده = تیتر مقاله، نه نام کسب‌وکار
  /^کلینیک های\s|^کلینیک‌های\s/, // جمع = صفحه‌ی فهرست، نه یک کلینیک
  // نهاد و سرویس عمومی — کسب‌وکار هدف ما نیستند
  /(نقشه|مسیریاب|نوبت‌دهی|نوبت دهی|سامانه)/,
  /(کمیسیون|سازمان|وزارت|شهرداری|اتحادیه|انجمن|فدراسیون|یونسکو)/,
];

/**
 * مسیرهای URL که نشان می‌دهند صفحه **مقاله یا فهرست** است، نه خود کسب‌وکار.
 *
 * این قوی‌ترین سیگنال است: سایت یک کسب‌وکار واقعی در نتیجه‌ی جست‌وجو معمولاً
 * صفحه‌ی اصلی یا یک مسیر کم‌عمق («/about»، «/contact») است. مقاله و دایرکتوری
 * تقریباً همیشه مسیر عمیق یا شناسه‌ی پست دارند.
 */
export const ARTICLE_PATH_PATTERNS = [
  /\/blog\//i,
  /\/news\//i,
  /\/article/i,
  /\/magazine/i,
  /\/category\//i,
  /\/centers?\//i,
  /\/tag\//i,
  /\/archive/i,
  /\/list\//i,
  /\/post\//i,
  /\/\d{4}\/\d{2}\//, // تاریخ در مسیر: /1404/07/
];

/** آیا این URL شکل «صفحه‌ی کسب‌وکار» دارد؟ */
export function looksLikeBusinessPage(url: string): boolean {
  try {
    const u = new URL(url);
    if (ARTICLE_PATH_PATTERNS.some((re) => re.test(u.pathname))) return false;
    // شناسه‌ی پست وردپرس (?p=123) = مقاله
    if (u.searchParams.has("p") || u.searchParams.has("page_id")) return false;
    // عمق مسیر: صفحه‌ی اصلی یا یک/دو سطح قابل‌قبول است؛ عمیق‌تر تقریباً همیشه محتواست
    const depth = u.pathname.split("/").filter(Boolean).length;
    return depth <= 2;
  } catch {
    return false;
  }
}

/**
 * عنوان صفحه را به نام کسب‌وکار تمیز تبدیل می‌کند.
 *
 * پیشوندهای «درباره ما -» و «تماس با ما -» عمداً حذف می‌شوند: همین دو کوئری را
 * خودمان می‌فرستیم، پس عنوان نتیجه‌ی صفحه‌ی داخلی است و نام واقعی بعد از خط تیره
 * می‌آید («درباره ما - سالن زیبایی آرزو براتی»).
 */
export function cleanTitle(title: string): string {
  let t = title;
  t = t.replace(/\(@[^)]+\)/g, ""); // (@handle)
  t = t.replace(/[•|·–-]\s*Instagram.*$/i, "");
  t = t.replace(/Instagram photos and videos.*$/i, "");
  // پیشوند صفحه‌ی داخلی
  t = t.replace(/^\s*(درباره\s*ما|تماس\s*با\s*ما|درباره|تماس)\s*[-–|:]\s*/i, "");
  // پسوند صفحه‌ی داخلی («سالن زیبایی X | درباره ما»)
  t = t.replace(/\s*[-–|]\s*(درباره\s*ما|تماس\s*با\s*ما)\s*$/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * یک نتیجه‌ی جست‌وجو (هر منبعی) را به DiscoveredPlace تبدیل می‌کند، یا اگر
 * کسب‌وکار نبود null می‌دهد.
 *
 * @param term عبارتی که این نتیجه را آورده — به‌عنوان `typeLabel` ذخیره می‌شود.
 *   چرا مهم است: `discovery.ts` صنعت لید را از `p.typeLabel ?? market?.title`
 *   می‌سازد. لیدهای جست‌وجوی وب تا امروز `typeLabel: null` داشتند و در حالت
 *   «همه‌ی بازارها» هم `getMarket("all")` مقدار undefined می‌دهد — یعنی **صنعت
 *   همه‌ی لیدهای وب null می‌شد**. آن فیلد مستقیماً به انتخاب نمونه‌های نویسنده،
 *   پرامپت تحلیل و سیگنال ۸ توان مالی می‌رود.
 * @param source مقدار فیلد `source` لید («web_search» یا «google_search»).
 *   نگه‌داشتنش یعنی بعداً می‌شود سنجید کدام منبع لید بهتری می‌دهد.
 */
export function resultToPlace(
  url: string,
  title: string,
  term: string,
  source: string
): DiscoveredPlace | null {
  if (!url) return null;

  const igMatch = url.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (igMatch && !/^(p|reel|reels|explore|accounts|stories)$/i.test(igMatch[1])) {
    const handle = normalizeHandle(igMatch[1]);
    if (!handle) return null;
    const name = cleanTitle(title) || handle;
    return {
      placeId: `web:ig:${handle.toLowerCase()}`,
      name,
      address: null,
      phone: null,
      website: null,
      rating: null,
      reviewsCount: null,
      mapsUri: `https://instagram.com/${handle}`,
      typeLabel: term,
      businessStatus: "OPERATIONAL",
      source,
      instagramHandle: "@" + handle,
    };
  }

  // در غیر این صورت: سایت رسمیِ کسب‌وکار (دایرکتوری/خبر/دانشگاه رد می‌شوند)
  const host = hostOf(url);
  if (!host) return null;
  if (DIRECTORY_HOSTS.some((d) => host === d || host.endsWith("." + d))) return null;
  if (NON_BUSINESS_TLDS.some((t) => host.endsWith(t))) return null;
  if (!looksLikeBusinessPage(url)) return null;

  const name = cleanTitle(title);
  if (!name) return null;
  // عنوانی که شبیه فهرست/مقاله است، کسب‌وکار نیست
  if (LISTICLE_PATTERNS.some((re) => re.test(name))) return null;
  // عنوان خیلی بلند تقریباً همیشه تیتر مقاله است، نه نام کسب‌وکار
  if (name.length > 70) return null;
  return {
    placeId: `web:site:${host}`,
    name,
    address: null,
    phone: null,
    website: url,
    rating: null,
    reviewsCount: null,
    mapsUri: url,
    typeLabel: term,
    businessStatus: "OPERATIONAL",
    source,
    instagramHandle: null,
  };
}

/**
 * سه الگوی کوئری — هر کدام نوع متفاوتی از نتیجه می‌آورد.
 *
 * عمداً از «بهترین {term} {city}» استفاده نمی‌کنیم: آن کوئری تقریباً همیشه به
 * فهرست‌های تجمیع‌گر و مقاله‌های «۱۰ تای برتر» می‌رسد، نه به خود کسب‌وکار.
 * «درباره ما» و «تماس با ما» برعکس، تقریباً فقط روی سایت کسب‌وکار واقعی هستند.
 */
export const QUERY_PATTERNS: ((term: string, city: string) => string)[] = [
  (t, c) => `${t} ${c} اینستاگرام`, // پیج بیزینس
  (t, c) => `${t} ${c} درباره ما`, // صفحه‌ی «درباره ما» = سایت واقعی کسب‌وکار
  (t, c) => `${t} ${c} تماس با ما`, // صفحه‌ی تماس = سایت واقعی کسب‌وکار
];

/**
 * جفت‌های «(الگو، عبارت)» را به ترتیبی می‌سازد که در بودجه‌ی محدودِ جست‌وجو،
 * **هم از هر بازار سهم برسد و هم هر سه الگو استفاده شوند**.
 *
 * باگی که این رفع می‌کند: قبلاً دو حلقه‌ی تودرتو بود با الگو در بیرون و عبارت
 * در داخل. با ۱۶+ عبارت (حالت ترکیبی) و بودجه‌ی ۸، کل بودجه در همان الگوی اول
 * («اینستاگرام») تمام می‌شد و الگوهای «درباره ما» و «تماس با ما» — که دقیقاً
 * همان‌هایی‌اند که سایت واقعی کسب‌وکار را می‌آورند — هرگز اجرا نمی‌شدند.
 *
 * ⚠️ ترتیب این نقشه **باید بین اجراها ثابت بماند**: مکان‌نمای کمپین اندیس
 * داخل همین آرایه را ذخیره می‌کند. اگر ترتیب عوض شود، `webPlan: 12` دفعه‌ی
 * بعد کوئری دیگری را نشان می‌دهد و کشف بی‌صدا از روی بخشی از نقشه می‌پرد.
 */
export function buildSearchPlan(
  terms: string[],
  patterns: ((term: string, city: string) => string)[]
): { term: string; pattern: (term: string, city: string) => string }[] {
  const plan: { term: string; pattern: (term: string, city: string) => string }[] = [];
  for (let round = 0; round < patterns.length; round++) {
    terms.forEach((term, i) => {
      plan.push({ term, pattern: patterns[(i + round) % patterns.length] });
    });
  }
  return plan;
}
