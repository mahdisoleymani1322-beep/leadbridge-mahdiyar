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
  /^\d+\s*(تا|مورد|بهترین)/,
  /راهنمای (خرید|انتخاب)/,
  /^بهترین\s.{0,40}(در|های)\s/,
  /اخبار|خبرگزاری|خبرنگار/,
  /مقاله|پایان‌نامه|دانشگاه|پژوهش/,
];

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

/** عنوان صفحه را به نام کسب‌وکار تمیز تبدیل می‌کند */
function cleanTitle(title: string): string {
  let t = title;
  t = t.replace(/\(@[^)]+\)/g, ""); // (@handle)
  t = t.replace(/[•|·–-]\s*Instagram.*$/i, "");
  t = t.replace(/Instagram photos and videos.*$/i, "");
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
function resultToPlace(r: any): DiscoveredPlace | null {
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
      typeLabel: null,
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
    typeLabel: null,
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
 * عبارت‌ها را طوری می‌چیند که **از هر بازار سهم برسد**.
 *
 * باگی که این رفع می‌کند: قبلاً `queryTerms.slice(0, 3)` بود و چون
 * `combinedQueryTerms()` بازارها را به‌ترتیب اولویت پشت‌سرهم می‌چیند، در حالت
 * «همه‌ی بازارها» هر سه عبارت همیشه از بازار «کارخانه» می‌آمد — کلینیک زیبایی
 * و بقیه هرگز جست‌وجوی وب نمی‌شدند.
 *
 * @param terms عبارت‌ها به‌ترتیب بازار (خروجی combinedQueryTerms)
 * @param groupSize چند عبارت در هر بازار (برای چرخش round-robin)
 */
export function interleaveTerms(terms: string[], groupSize = 4): string[] {
  if (terms.length <= groupSize) return terms;
  const out: string[] = [];
  for (let i = 0; i < groupSize; i++) {
    for (let start = 0; start < terms.length; start += groupSize) {
      const t = terms[start + i];
      if (t) out.push(t);
    }
  }
  return out;
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

  // عبارت‌ها چرخشی می‌شوند تا سهم همه‌ی بازارها برسد
  const terms = interleaveTerms(queryTerms);

  // گاردریل مصرف: حداکثر maxSearchesPerRun فراخوان Tavily در هر کشف.
  // ترتیب حلقه‌ها مهم است: اول همه‌ی عبارت‌ها با الگوی ۱، بعد الگوی ۲ — تا اگر
  // بودجه وسط کار تمام شد، دست‌کم یک جست‌وجو برای هر بازار انجام شده باشد.
  outer: for (const pattern of QUERY_PATTERNS) {
    for (const term of terms) {
      if (searchesUsed >= WEB_SEARCH.maxSearchesPerRun) break outer;
      if (out.length >= leadCap) break outer;

      searchesUsed++;
      const results = await tavilySearch(pattern(term, city), WEB_SEARCH.maxResultsPerSearch);
      for (const r of results) {
        const place = resultToPlace(r);
        if (place && !seen.has(place.placeId)) {
          seen.add(place.placeId);
          out.push(place);
          if (out.length >= leadCap) break;
        }
      }
    }
  }

  return { places: out, searchesUsed };
}
