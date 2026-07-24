import "server-only";

/**
 * یکپارچه‌سازی Google Places API (New) — تنها منبع رسمی کشف لید.
 *
 * دو عملیات:
 *  - textSearch: جست‌وجوی کسب‌وکارها بر اساس عبارت + شهر (places:searchText)
 *  - placeDetails: جزئیات یک مکان بر اساس placeId (places/{id})
 *
 * نکته‌ی معماری: این یک «سرویس قطعی» است که ارکستریتور/جریان کشف صدا می‌زند —
 * صفر توکن LLM. فقط داده‌ی عمومی رسمی. هر رکورد source_url دارد (اصل Evidence).
 *
 * کلید: GOOGLE_MAPS_API_KEY (از Google Cloud Console، با Places API (New) فعال).
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

/** فیلدهایی که از هر مکان می‌خواهیم (FieldMask — هم برای هزینه هم سرعت مهم است) */
const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "primaryTypeDisplayName",
  "businessStatus",
] as const;

export type PlaceResult = {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewsCount: number | null;
  mapsUri: string | null;
  typeLabel: string | null;
  businessStatus: string | null;
};

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function apiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY تنظیم نشده است.");
  return k;
}

/** fetch با timeout تا در محیط serverless معلق نماند */
async function fetchWithTimeout(url: string, init: RequestInit, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapPlace(p: any): PlaceResult {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? p.displayName ?? "",
    address: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewsCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    mapsUri: p.googleMapsUri ?? null,
    typeLabel: p.primaryTypeDisplayName?.text ?? null,
    businessStatus: p.businessStatus ?? null,
  };
}

/**
 * جست‌وجوی متنی کسب‌وکارها.
 * @param query عبارت جست‌وجو (مثلاً «کلینیک زیبایی»)
 * @param city شهر (به query اضافه می‌شود؛ regionCode=IR)
 * @param opts سقف تعداد و pageToken برای صفحه‌بندی
 */
export async function textSearch(
  query: string,
  city: string,
  opts: { max?: number; pageToken?: string } = {}
): Promise<{ places: PlaceResult[]; nextPageToken: string | null }> {
  const fieldMask =
    PLACE_FIELDS.map((f) => `places.${f}`).join(",") + ",nextPageToken";

  const body: Record<string, unknown> = {
    textQuery: `${query} ${city}`.trim(),
    languageCode: "fa",
    regionCode: "IR",
    pageSize: Math.min(Math.max(opts.max ?? 20, 1), 20), // سقف API = ۲۰ در هر صفحه
  };
  if (opts.pageToken) body.pageToken = opts.pageToken;

  const res = await fetchWithTimeout(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Places textSearch شکست خورد (${res.status}): ${txt.slice(0, 300)}`);
  }

  const data: any = await res.json();
  const places: PlaceResult[] = Array.isArray(data.places) ? data.places.map(mapPlace) : [];
  return { places, nextPageToken: data.nextPageToken ?? null };
}

/** جزئیات یک مکان بر اساس placeId (در صورت نیاز به تکمیل داده) */
export async function placeDetails(placeId: string): Promise<PlaceResult | null> {
  const fieldMask = PLACE_FIELDS.join(",");
  const res = await fetchWithTimeout(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    const txt = await res.text().catch(() => "");
    throw new Error(`Places placeDetails شکست خورد (${res.status}): ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  return mapPlace(data);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
