import "server-only";
import type { DiscoveredPlace } from "./types";
import { normalizeHandle } from "./instagram";
import { WEB_SEARCH } from "@/lib/config";

/**
 * منبع سوم کشف: جست‌وجوی وب با Tavily (رایگان، بدون کارت — کلید از tavily.com).
 *
 * در همان دکمه‌ی «کشف لید» ادغام می‌شود (نه دکمه‌ی جدا). فقط اگر TAVILY_API_KEY
 * تنظیم شده باشد فعال می‌شود؛ وگرنه بی‌صدا رد می‌شود و کشف با OSM ادامه می‌یابد.
 *
 * صفر توکن LLM: نتایج با کد پارس می‌شوند (نه با مدل). کسب‌وکارها عمدتاً از روی
 * لینک اینستاگرام یا سایت رسمی در نتایج استخراج می‌شوند.
 */

const TAVILY_URL = "https://api.tavily.com/search";

/**
 * دامنه‌هایی که کسب‌وکار هدف نیستند و باید رد شوند.
 *
 * چرا لازم است: کوئری‌هایی مثل «بهترین کارخانه تهران» عمداً به فهرست‌های
 * تجمیع‌گر و مقاله‌های خبری می‌رسند. بدون این فیلتر، لیدهایی مثل «خبرگزاری مهر»
 * یا «لیست بهترین کارخانه شن و ماسه» وارد پایگاه می‌شوند و سهمیه‌ی تحلیل را
 * می‌سوزانند.
 */
const DIRECTORY_HOSTS = [
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
const NON_BUSINESS_TLDS = [".ac.ir", ".gov.ir", ".sch.ir", ".edu"];

/**
 * عنوان‌هایی که نشان می‌دهند صفحه یک **فهرست/مقاله** است، نه خود کسب‌وکار.
 * الگوی «لیست بهترین X با آدرس و تلفن» رایج‌ترین دام این نوع جست‌وجوست.
 */
const LISTICLE_PATTERNS = [
  /^لیست\s/,
  /^فهرست\s/,
  /بانک اطلاعات/,
  /با آدرس و تلفن/,
  /معرفی\s+\d+/,
  /^[\d۰-۹]+\s/, // «۱۰ فروشگاه برتر…»، «۱۳۳ مدل…» — عنوان با عدد شروع نمی‌شود اگر نام کسب‌وکار باشد
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
const ARTICLE_PATH_PATTERNS = [
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
function looksLikeBusinessPage(url: string): boolean {
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

export function isWebSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * عنوان صفحه را به نام کسب‌وکار تمیز تبدیل می‌کند.
 *
 * پیشوندهای «درباره ما -» و «تماس با ما -» عمداً حذف می‌شوند: همین دو کوئری را
 * خودمان می‌فرستیم، پس عنوان نتیجه‌ی صفحه‌ی داخلی است و نام واقعی بعد از خط تیره
 * می‌آید («درباره ما - سالن زیبایی آرزو براتی»).
 */
function cleanTitle(title: string): string {
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @param term عبارتی که این نتیجه را آورده — به‌عنوان `typeLabel` ذخیره می‌شود.
 *
 * چرا مهم است: `discovery.ts` صنعت لید را از `p.typeLabel ?? market?.title`
 * می‌سازد. لیدهای Tavily تا امروز `typeLabel: null` داشتند و در حالت «همه‌ی
 * بازارها» هم `getMarket("all")` مقدار undefined می‌دهد — یعنی **صنعت همه‌ی
 * لیدهای وب null می‌شد**. آن فیلد مستقیماً به انتخاب نمونه‌های نویسنده،
 * پرامپت تحلیل و سیگنال ۸ توان مالی می‌رود. خودِ عبارت جست‌وجو («کلینیک
 * زیبایی») دقیق‌تر از عنوان بازار است.
 */
function resultToPlace(r: any, term: string): DiscoveredPlace | null {
  const url: string = typeof r?.url === "string" ? r.url : "";
  const title: string = typeof r?.title === "string" ? r.title : "";
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
      source: "web_search",
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
    source: "web_search",
    instagramHandle: null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function tavilySearch(query: string, maxResults: number): Promise<unknown[]> {
  try {
    const res = await fetchWithTimeout(
      TAVILY_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: WEB_SEARCH.searchDepth,
          max_results: maxResults,
        }),
      },
      15000
    );
    if (!res.ok) return [];
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const data: any = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

/**
 * سه الگوی کوئری — هر کدام نوع متفاوتی از نتیجه می‌آورد.
 *
 * عمداً از «بهترین {term} {city}» استفاده نمی‌کنیم: آن کوئری تقریباً همیشه به
 * فهرست‌های تجمیع‌گر و مقاله‌های «۱۰ تای برتر» می‌رسد، نه به خود کسب‌وکار.
 * «درباره ما» و «تماس با ما» برعکس، تقریباً فقط روی سایت کسب‌وکار واقعی هستند.
 */
const QUERY_PATTERNS: ((term: string, city: string) => string)[] = [
  (t, c) => `${t} ${c} اینستاگرام`, // پیج بیزینس
  (t, c) => `${t} ${c} درباره ما`, // صفحه‌ی «درباره ما» = سایت واقعی کسب‌وکار
  (t, c) => `${t} ${c} تماس با ما`, // صفحه‌ی تماس = سایت واقعی کسب‌وکار
];

/**
 * جفت‌های «(الگو، عبارت)» را به ترتیبی می‌سازد که در بودجه‌ی محدودِ Tavily،
 * **هم از هر بازار سهم برسد و هم هر سه الگو استفاده شوند**.
 *
 * باگی که این رفع می‌کند: قبلاً دو حلقه‌ی تودرتو بود با الگو در بیرون و عبارت
 * در داخل. با ۱۶+ عبارت (حالت ترکیبی) و بودجه‌ی ۸، کل بودجه در همان الگوی اول
 * («اینستاگرام») تمام می‌شد و الگوهای «درباره ما» و «تماس با ما» — که دقیقاً
 * همان‌هایی‌اند که سایت واقعی کسب‌وکار را می‌آورند — هرگز اجرا نمی‌شدند.
 *
 * حالا شاخص الگو با هر جفت یکی جلو می‌رود، پس ۸ جست‌وجوی اول هر سه الگو را
 * پوشش می‌دهند. ترتیب خود عبارت‌ها از قبل در `config.combinedQueryTerms`
 * بین بازارها چرخانده شده است.
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

export type WebSearchResult = {
  places: DiscoveredPlace[];
  /** چند فراخوان Tavily واقعاً مصرف شد (شفافیت سهمیه‌ی رایگان) */
  searchesUsed: number;
};

/**
 * کسب‌وکارها را با جست‌وجوی وب (Tavily) پیدا می‌کند.
 * best-effort: در صورت نبود کلید یا خطا، نتیجه‌ی خالی برمی‌گرداند تا کشف نشکند.
 */
export async function discoverViaWebSearch(
  queryTerms: string[],
  city: string,
  limit: number
): Promise<WebSearchResult> {
  if (!isWebSearchConfigured() || queryTerms.length === 0) {
    return { places: [], searchesUsed: 0 };
  }

  // گاردریل: سقف لیدها = کمینه‌ی (limit خواسته‌شده، سقف پیکربندی)
  const leadCap = Math.min(limit, WEB_SEARCH.maxLeadsPerRun);
  const out: DiscoveredPlace[] = [];
  const seen = new Set<string>();
  let searchesUsed = 0;

  // عبارت‌ها از config چرخشی می‌آیند (سهم هر بازار)؛ اینجا الگو هم می‌چرخد
  const plan = buildSearchPlan(queryTerms, QUERY_PATTERNS);

  // گاردریل مصرف: حداکثر maxSearchesPerRun فراخوان Tavily در هر کشف
  for (const { term, pattern } of plan) {
    if (searchesUsed >= WEB_SEARCH.maxSearchesPerRun) break;
    if (out.length >= leadCap) break;

    searchesUsed++;
    const results = await tavilySearch(pattern(term, city), WEB_SEARCH.maxResultsPerSearch);
    for (const r of results) {
      const place = resultToPlace(r, term);
      if (place && !seen.has(place.placeId)) {
        seen.add(place.placeId);
        out.push(place);
        if (out.length >= leadCap) break;
      }
    }
  }

  return { places: out, searchesUsed };
}
