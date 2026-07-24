import "server-only";
import type { ContactChannels } from "@/lib/store/types";
import type { DiscoveredPlace } from "./types";
import { normalizeHandle } from "./instagram";

/**
 * کشف لید از OpenStreetMap — رایگان، بدون کلید، بدون کارت (جایگزین Google Places).
 *
 * دو گام: Nominatim (پیداکردن مرز شهر) → Overpass (کسب‌وکارها بر اساس تگ + مرز).
 * سرویس قطعی — صفر توکن LLM. فقط داده‌ی باز عمومی.
 *
 * نکته: داده‌ی OSM از گوگل کم‌پشت‌تر است (بعضی POIها تلفن/سایت ندارند)، ولی
 * تگ‌های contact:* آن اغلب مستقیماً اینستاگرام/ایمیل/تلگرام را می‌دهند.
 */

const UA = "LeadBridge-Mahdiyar/1.0 (lead discovery; contact via mahdiyar.ai)";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** OSM همیشه در دسترس است (کلید نمی‌خواهد) */
export function isOsmAvailable(): boolean {
  return true;
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

type BBox = { south: number; north: number; west: number; east: number };

/** مرز جغرافیایی شهر را با Nominatim پیدا می‌کند */
async function geocodeCity(city: string): Promise<BBox | null> {
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(city + "، ایران")}` +
    `&format=json&limit=1&countrycodes=ir&accept-language=fa`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, 8000);
    if (!res.ok) return null;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const data: any[] = await res.json();
    const bb = data?.[0]?.boundingbox; // [south, north, west, east] (strings)
    if (!Array.isArray(bb) || bb.length < 4) return null;
    return {
      south: parseFloat(bb[0]),
      north: parseFloat(bb[1]),
      west: parseFloat(bb[2]),
      east: parseFloat(bb[3]),
    };
  } catch {
    return null;
  }
}

/** «amenity=clinic» → ["amenity"="clinic"] و «office» → ["office"] */
function tagSelector(tag: string): string {
  const eq = tag.indexOf("=");
  if (eq === -1) return `["${tag}"]`;
  return `["${tag.slice(0, eq)}"="${tag.slice(eq + 1)}"]`;
}

function buildOverpassQuery(osmTags: string[], b: BBox, limit: number): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const clauses = osmTags.map((t) => `  nwr${tagSelector(t)}(${bbox});`).join("\n");
  return `[out:json][timeout:30];\n(\n${clauses}\n);\nout center tags ${limit};`;
}

async function runOverpass(query: string): Promise<unknown[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
          body: "data=" + encodeURIComponent(query),
        },
        30000
      );
      if (!res.ok) continue;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const data: any = await res.json();
      if (Array.isArray(data?.elements)) return data.elements;
    } catch {
      /* endpoint بعدی را امتحان کن */
    }
  }
  return [];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toDiscovered(el: any): DiscoveredPlace | null {
  const tags = el.tags ?? {};
  const name: string | undefined = tags.name || tags["name:fa"] || tags["name:en"];
  if (!name) return null;

  const phone: string | null = tags.phone || tags["contact:phone"] || tags["contact:mobile"] || null;
  const website: string | null = tags.website || tags["contact:website"] || tags.url || null;

  const seed: Partial<ContactChannels> = {};
  const email = tags.email || tags["contact:email"];
  if (email) seed.email = String(email).trim();
  const tg = tags["contact:telegram"];
  if (tg) seed.telegram = normalizeTelegram(String(tg));
  const wa = tags["contact:whatsapp"];
  if (wa) seed.whatsapp = String(wa).replace(/\D+/g, "");

  let instagramHandle: string | null = null;
  const ig = tags["contact:instagram"] || tags.instagram;
  if (ig) instagramHandle = "@" + normalizeHandle(String(ig));

  // فقط رکوردهایی که حداقل یک راه تماس دارند (برای نرخ درج بهتر)
  const hasContact = Boolean(phone || website || email || tg || wa || instagramHandle);
  if (!hasContact) return null;

  const addressParts = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:district"],
    tags["addr:city"],
  ].filter(Boolean);

  const typeLabel: string | null =
    tags.amenity || tags.shop || tags.office || tags.healthcare || tags.craft || tags["man_made"] || tags.industrial || null;

  return {
    placeId: `osm:${el.type}/${el.id}`,
    name: String(name).trim(),
    address: addressParts.length ? addressParts.join("، ") : null,
    phone,
    website,
    rating: null,
    reviewsCount: null,
    mapsUri: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    typeLabel: typeLabel ? String(typeLabel) : null,
    businessStatus: "OPERATIONAL",
    instagramHandle,
    seedChannels: Object.keys(seed).length ? seed : undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function normalizeTelegram(v: string): string {
  const m = v.match(/(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{3,})/i);
  const handle = (m ? m[1] : v).replace(/^@/, "").trim();
  return "@" + handle;
}

/**
 * کشف کسب‌وکارها از OSM بر اساس تگ‌های بازار + شهر.
 * @returns فهرست DiscoveredPlace (فقط آن‌هایی که نام + حداقل یک راه تماس دارند)
 */
export async function discoverViaOsm(
  osmTags: string[],
  city: string,
  limit: number
): Promise<DiscoveredPlace[]> {
  if (osmTags.length === 0) return [];
  const bbox = await geocodeCity(city);
  if (!bbox) throw new Error(`مرز شهر «${city}» در OpenStreetMap پیدا نشد.`);

  // بیشتر از limit می‌گیریم چون بخشی بدون تماس فیلتر می‌شوند
  const query = buildOverpassQuery(osmTags, bbox, Math.min(limit * 4, 150));
  const elements = await runOverpass(query);

  const out: DiscoveredPlace[] = [];
  const seenIds = new Set<string>();
  for (const el of elements) {
    const d = toDiscovered(el);
    if (d && !seenIds.has(d.placeId)) {
      seenIds.add(d.placeId);
      out.push(d);
    }
  }
  return out;
}
