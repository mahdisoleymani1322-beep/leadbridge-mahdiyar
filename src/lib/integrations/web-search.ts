import "server-only";
import type { DiscoveredPlace } from "./types";
import { normalizeHandle } from "./instagram";

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

/** دامنه‌های دایرکتوری/تجمیع‌گر که کسب‌وکار واقعی نیستند (رد می‌شوند) */
const DIRECTORY_HOSTS = [
  "behtarino.com",
  "iranamozeshgah.com",
  "zibato.net",
  "gzlocation.com",
  "google.com",
  "wikipedia.org",
  "aparat.com",
  "digikala.com",
  "sheypoor.com",
  "divar.ir",
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

  // در غیر این صورت: سایت رسمیِ کسب‌وکار (دایرکتوری‌ها رد می‌شوند)
  const host = hostOf(url);
  if (!host || DIRECTORY_HOSTS.some((d) => host.endsWith(d))) return null;
  const name = cleanTitle(title);
  if (!name) return null;
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
          search_depth: "basic",
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
 * کسب‌وکارها را با جست‌وجوی وب (Tavily) پیدا می‌کند.
 * best-effort: در صورت نبود کلید یا خطا، آرایه‌ی خالی برمی‌گرداند تا کشف نشکند.
 */
export async function discoverViaWebSearch(
  queryTerms: string[],
  city: string,
  limit: number
): Promise<DiscoveredPlace[]> {
  if (!isWebSearchConfigured() || queryTerms.length === 0) return [];

  const out: DiscoveredPlace[] = [];
  const seen = new Set<string>();
  // چند عبارت اول را با تأکید بر اینستاگرام جست‌وجو می‌کنیم
  for (const term of queryTerms.slice(0, 4)) {
    if (out.length >= limit) break;
    const query = `${term} ${city} اینستاگرام`;
    const results = await tavilySearch(query, 8);
    for (const r of results) {
      const place = resultToPlace(r);
      if (place && !seen.has(place.placeId)) {
        seen.add(place.placeId);
        out.push(place);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
