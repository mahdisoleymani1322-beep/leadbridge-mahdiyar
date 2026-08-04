import "server-only";
import type { DiscoveredPlace } from "./types";
import { WEB_SEARCH } from "@/lib/config";
import { QUERY_PATTERNS, buildSearchPlan, resultToPlace } from "./search-filters";

/**
 * منبع کشف: جست‌وجوی وب با Tavily (رایگان، بدون کارت — کلید از tavily.com).
 *
 * در همان دکمه‌ی «کشف لید» ادغام می‌شود (نه دکمه‌ی جدا). فقط اگر TAVILY_API_KEY
 * تنظیم شده باشد فعال می‌شود؛ وگرنه بی‌صدا رد می‌شود و کشف با OSM ادامه می‌یابد.
 *
 * صفر توکن LLM: نتایج با کد پارس می‌شوند (نه با مدل). کسب‌وکارها عمدتاً از روی
 * لینک اینستاگرام یا سایت رسمی در نتایج استخراج می‌شوند.
 *
 * فیلترها، تبدیل نتیجه و ساخت نقشه‌ی جست‌وجو در `search-filters.ts` مشترک‌اند —
 * تا منبع دومِ جست‌وجو (گوگل) نسخه‌ی دومِ همان قواعد را نسازد.
 */

const TAVILY_URL = "https://api.tavily.com/search";

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

export type WebSearchResult = {
  places: DiscoveredPlace[];
  /** چند فراخوان Tavily واقعاً مصرف شد (شفافیت سهمیه‌ی رایگان) */
  searchesUsed: number;
  /** اندیس بعدی در نقشه — همیشه چرخشی و کمتر از planLength */
  nextIndex: number;
  planLength: number;
  /** آیا در این اجرا نقشه دور کامل زد؟ */
  wrapped: boolean;
};

/**
 * کسب‌وکارها را با جست‌وجوی وب (Tavily) پیدا می‌کند.
 * best-effort: در صورت نبود کلید یا خطا، نتیجه‌ی خالی برمی‌گرداند تا کشف نشکند.
 */
export async function discoverViaWebSearch(
  queryTerms: string[],
  city: string,
  limit: number,
  /**
   * مهلت مطلق (Date.now میلی‌ثانیه). وقتی گذشت، حلقه بدون شروع جست‌وجوی تازه
   * تمام می‌شود و هرچه تا اینجا جمع شده برمی‌گردد.
   *
   * چرا لازم است: تابع Vercel سقف ۶۰ ثانیه دارد. ۸ جست‌وجو × ۱۵ ثانیه تایم‌اوت
   * در بدترین حالت ۱۲۰ ثانیه است و کل کشف را با FUNCTION_INVOCATION_TIMEOUT
   * می‌ترکاند — همان کلاس باگی که قبلاً تولید پیام را از کار انداخت. نتیجه‌ی
   * ناقص خیلی بهتر از شکست کامل و از دست رفتن همه‌ی لیدهای پیداشده است.
   */
  deadlineAt?: number,
  /**
   * از کجای نقشه شروع کند (اندیس از مکان‌نمای کمپین).
   *
   * چرا لازم شد: نقشه در حالت «همه‌ی بازارها» ~۶۰ جفت (عبارت، الگو) دارد ولی
   * بودجه‌ی Tavily ۸ فراخوان در هر اجراست. تا امروز همیشه از صفر شروع می‌شد،
   * یعنی جفت‌های ۹ تا ۶۰ **هرگز در تاریخ این پروژه جست‌وجو نشده‌اند**.
   *
   * با شروعِ چرخشی، هزینه‌ی هر اجرا همان ۸ می‌ماند (سهمیه‌ی رایگان دست‌نخورده)
   * ولی ۸ اجرا کل نقشه را می‌پوشاند. عمق از **جای شروع** می‌آید، نه از
   * بالابردن سقف فراخوان.
   */
  startIndex = 0
): Promise<WebSearchResult> {
  if (!isWebSearchConfigured() || queryTerms.length === 0) {
    return { places: [], searchesUsed: 0, nextIndex: startIndex, planLength: 0, wrapped: false };
  }

  // گاردریل: سقف لیدها = کمینه‌ی (limit خواسته‌شده، سقف پیکربندی)
  const leadCap = Math.min(limit, WEB_SEARCH.maxLeadsPerRun);
  const out: DiscoveredPlace[] = [];
  const seen = new Set<string>();
  let searchesUsed = 0;

  // عبارت‌ها از config چرخشی می‌آیند (سهم هر بازار)؛ اینجا الگو هم می‌چرخد
  const plan = buildSearchPlan(queryTerms, QUERY_PATTERNS);

  // گاردریل مصرف: حداکثر maxSearchesPerRun فراخوان Tavily در هر کشف.
  // پیمایش چرخشی از startIndex — نه از صفر.
  let consumed = 0;
  for (let n = 0; n < plan.length; n++) {
    if (searchesUsed >= WEB_SEARCH.maxSearchesPerRun) break;
    if (out.length >= leadCap) break;
    // مهلت را قبل از شروع جست‌وجوی بعدی چک کن، نه وسطش
    if (deadlineAt && Date.now() >= deadlineAt) break;

    const { term, pattern } = plan[(startIndex + n) % plan.length];
    consumed = n + 1;
    searchesUsed++;
    const results = await tavilySearch(pattern(term, city), WEB_SEARCH.maxResultsPerSearch);
    for (const r of results) {
      const raw = r as { url?: unknown; title?: unknown };
      const place = resultToPlace(
        typeof raw?.url === "string" ? raw.url : "",
        typeof raw?.title === "string" ? raw.title : "",
        term,
        "web_search"
      );
      if (place && !seen.has(place.placeId)) {
        seen.add(place.placeId);
        out.push(place);
        if (out.length >= leadCap) break;
      }
    }
  }

  return {
    places: out,
    searchesUsed,
    nextIndex: (startIndex + consumed) % plan.length,
    planLength: plan.length,
    wrapped: startIndex + consumed >= plan.length,
  };
}
