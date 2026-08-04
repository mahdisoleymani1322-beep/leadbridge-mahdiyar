import "server-only";
import type { DiscoveredPlace } from "./types";
import { GOOGLE_SEARCH } from "@/lib/config";
import { QUERY_PATTERNS, buildSearchPlan, resultToPlace } from "./search-filters";

/**
 * منبع کشف: Google Programmable Search (Custom Search JSON API).
 *
 * چرا کنار Tavily و نه به‌جایش: ایندکس گوگل روی سایت‌های فارسیِ کوچک به‌مراتب
 * کامل‌تر است — دقیقاً همان کسب‌وکارهایی که هدف این پروژه‌اند و اغلب در
 * ایندکس‌های کوچک‌تر نیستند. دو منبع مستقل یعنی پوشش بیشتر با همان هزینه‌ی
 * زمانی، چون موازی اجرا می‌شوند.
 *
 * دو کلید لازم دارد که مالک باید خودش بسازد:
 *   GOOGLE_SEARCH_API_KEY   — از Google Cloud، برای Custom Search API
 *   GOOGLE_SEARCH_ENGINE_ID — از programmablesearchengine.google.com («کل وب»)
 *
 * بدون آن‌ها **بی‌صدا رد می‌شود** و کشف با بقیه‌ی منابع ادامه می‌یابد. این همان
 * الگوی Tavily و Places است: هیچ منبعی نباید نبودِ کلیدش را به شکست کل کشف
 * تبدیل کند.
 *
 * سهمیه‌ی رایگان روزی ۱۰۰ کوئری است. مثل Tavily، عمق از **جای شروع در نقشه**
 * می‌آید نه از بالابردن سقف فراخوان — تا کشف چند بار در روز قابل زدن بماند.
 *
 * صفر توکن LLM. فیلترها و تبدیل نتیجه در `search-filters.ts` مشترک‌اند.
 */

const CSE_URL = "https://www.googleapis.com/customsearch/v1";

export function isGoogleSearchConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID);
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** یک کوئری به CSE — در هر خطایی آرایه‌ی خالی، چون منبع best-effort است */
async function cseSearch(query: string, num: number): Promise<{ link?: string; title?: string }[]> {
  const url =
    `${CSE_URL}?key=${encodeURIComponent(process.env.GOOGLE_SEARCH_API_KEY!)}` +
    `&cx=${encodeURIComponent(process.env.GOOGLE_SEARCH_ENGINE_ID!)}` +
    `&q=${encodeURIComponent(query)}` +
    // سقف خود API روی num عدد ۱۰ است؛ بیشتر بفرستی ۴۰۰ می‌دهد
    `&num=${Math.min(10, num)}` +
    // زبان و کشور: نتایج فارسیِ ایران در اولویت باشند
    `&lr=lang_fa&cr=countryIR&hl=fa`;
  try {
    const res = await fetchWithTimeout(url, GOOGLE_SEARCH.timeoutMs);
    if (!res.ok) return [];
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const data: any = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

export type GoogleSearchResult = {
  places: DiscoveredPlace[];
  /** چند فراخوان CSE مصرف شد (شفافیت سهمیه‌ی ۱۰۰ تایی روزانه) */
  searchesUsed: number;
  nextIndex: number;
  planLength: number;
  wrapped: boolean;
};

/**
 * کسب‌وکارها را با جست‌وجوی گوگل پیدا می‌کند.
 * best-effort: بدون کلید یا در صورت خطا، نتیجه‌ی خالی — کشف نباید بشکند.
 */
export async function discoverViaGoogleSearch(
  queryTerms: string[],
  city: string,
  limit: number,
  /** مهلت مطلق منابع (Date.now میلی‌ثانیه) */
  deadlineAt?: number,
  /** از کجای نقشه شروع کند — از مکان‌نمای کمپین */
  startIndex = 0
): Promise<GoogleSearchResult> {
  if (!isGoogleSearchConfigured() || queryTerms.length === 0) {
    return { places: [], searchesUsed: 0, nextIndex: startIndex, planLength: 0, wrapped: false };
  }

  const leadCap = Math.min(limit, GOOGLE_SEARCH.maxLeadsPerRun);
  const out: DiscoveredPlace[] = [];
  const seen = new Set<string>();
  let searchesUsed = 0;
  let consumed = 0;

  const plan = buildSearchPlan(queryTerms, QUERY_PATTERNS);

  for (let n = 0; n < plan.length; n++) {
    if (searchesUsed >= GOOGLE_SEARCH.maxSearchesPerRun) break;
    if (out.length >= leadCap) break;
    if (deadlineAt && Date.now() >= deadlineAt) break;

    const { term, pattern } = plan[(startIndex + n) % plan.length];
    consumed = n + 1;
    searchesUsed++;
    const items = await cseSearch(pattern(term, city), GOOGLE_SEARCH.maxResultsPerSearch);
    for (const it of items) {
      const place = resultToPlace(
        typeof it?.link === "string" ? it.link : "",
        typeof it?.title === "string" ? it.title : "",
        term,
        "google_search"
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
