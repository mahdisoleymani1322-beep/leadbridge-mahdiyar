import "server-only";
import type { ContactChannels } from "@/lib/store/types";
import type { DiscoveredPlace } from "./types";
import { normalizeHandle } from "./instagram";
import { OSM } from "@/lib/config";

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

export type BBox = { south: number; north: number; west: number; east: number };

/** مرز جغرافیایی شهر را با Nominatim پیدا می‌کند */
async function geocodeCity(city: string): Promise<BBox | null> {
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(city + "، ایران")}` +
    `&format=json&limit=1&countrycodes=ir&accept-language=fa`;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA } }, OSM.geocodeTimeoutMs);
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

/**
 * مهلت سرآیند Overpass عمداً از همان عددی می‌آید که AbortController ما
 * استفاده می‌کند. قبلاً سرآیند ۳۰ ثانیه بود و کلاینت هم ۳۰ ثانیه صبر می‌کرد،
 * یعنی یک کوئری کند تنهایی دوسوم بودجه‌ی ۴۵ ثانیه‌ای کشف را می‌خورد. اگر این
 * دو از هم جدا شوند، سرور تا مهلت خودش کار می‌کند در حالی که ما قطع کرده‌ایم —
 * یعنی هزینه‌ی محاسباتی مفت به یک سرویس عمومی رایگان تحمیل می‌شود.
 */
function buildOverpassQuery(osmTags: string[], b: BBox, limit: number, timeoutMs: number): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const clauses = osmTags.map((t) => `  nwr${tagSelector(t)}(${bbox});`).join("\n");
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  return `[out:json][timeout:${secs}];\n(\n${clauses}\n);\nout center tags ${limit};`;
}

/**
 * نتیجه‌ی یک کوئری Overpass — **«خالی» از «شکست» جدا شده است**.
 *
 * چرا این تفکیک لازم شد: نسخه‌ی قبلی در هر شکستی `[]` برمی‌گرداند، و `[]` از
 * «این کاشی واقعاً کسب‌وکاری ندارد» قابل‌تشخیص نبود. اثرش در داده‌ی زنده دیده
 * شد: در چهار اجرای پیاپی روی پروداکشن، OSM صفر نتیجه داد در حالی که
 * `errors: 0` گزارش شد — کشف به ۲۰ آدرس خام جست‌وجوی وب تکیه کرد و ۱۲ تا ۱۶
 * تای‌شان به‌خاطر نداشتن راه تماس رد شدند. از دید مالک «دکمه کار نمی‌کند».
 *
 * Overpass وقتی ظرفیتش پر است ۴۲۹ یا ۵۰۴ می‌دهد؛ این حالت گذرا است و باید از
 * «کاشی خالی» جدا بماند، چون تصمیمِ **جلوبردن مکان‌نما** به آن وابسته است.
 */
type OverpassResult = { ok: boolean; elements: unknown[] };

/**
 * حداقل زمانی که ارزش دارد یک endpoint را با آن امتحان کنیم.
 * کمتر از این، درخواست تقریباً حتماً نصفه قطع می‌شود و فقط بودجه را می‌سوزاند.
 */
const MIN_ATTEMPT_MS = 2_500;

/**
 * @param deadlineAt مهلت مطلق منابع — **سقف واقعی**، نه فقط مهلت هر درخواست.
 *
 * چرا لازم شد: مهلت هر endpoint ثابت ۱۲ ثانیه بود و دو endpoint داریم، یعنی یک
 * کاشی که هر دو جوابش را ندهند ۲۴ ثانیه می‌خورد — در حالی که کل سهم منابع از
 * بودجه ۲۳ ثانیه است. اندازه‌گیری زنده نشان داد این حالت نادر نیست: از ۶ کوئری
 * پیاپی فقط ۱ جواب گرفت و آینه‌ی دوم هیچ‌بار در ۱۲ ثانیه جواب نداد. یعنی یک
 * کاشیِ بد به‌تنهایی کل کشف را می‌بلعید و جست‌وجوی وب هم بی‌نتیجه می‌ماند.
 */
async function runOverpass(
  query: string,
  timeoutMs: number,
  deadlineAt: number
): Promise<OverpassResult> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const budget = Math.min(timeoutMs, deadlineAt - Date.now());
    if (budget < MIN_ATTEMPT_MS) break;
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
          body: "data=" + encodeURIComponent(query),
        },
        budget
      );
      if (!res.ok) continue;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const data: any = await res.json();
      if (Array.isArray(data?.elements)) return { ok: true, elements: data.elements };
    } catch {
      /* endpoint بعدی را امتحان کن */
    }
  }
  return { ok: false, elements: [] };
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
 * مرز شهر را به شبکه‌ی grid×grid کاشی می‌شکند، **مرتب از مرکز به بیرون**.
 *
 * چرا مرکز اول: تراکم کسب‌وکار در تهران به‌شدت نامتوازن است. با ترتیب سطری
 * (raster) اجرای اول به گوشه‌ی خالی جنوب‌غرب می‌افتاد و مالک «۲ لید» می‌دید و
 * نتیجه می‌گرفت کشف خراب است. فاصله‌ی مربعی از مرکزِ شبکه، ترتیب را هم قطعی
 * نگه می‌دارد و هم معنادار.
 *
 * `sort` در V8 پایدار است، پس کاشی‌های هم‌فاصله ترتیب سطر/ستون خود را حفظ
 * می‌کنند — یعنی اندیس کاشی بین دو اجرا معنای ثابتی دارد. این برای مکان‌نما
 * حیاتی است: اگر ترتیب عوض شود، `osmTile: 7` دفعه‌ی بعد جای دیگری را نشان
 * می‌دهد و کشف بی‌صدا از روی بخشی از شهر می‌پرد.
 */
export function cityTiles(b: BBox, grid: number): BBox[] {
  const dLat = (b.north - b.south) / grid;
  const dLon = (b.east - b.west) / grid;
  const c = (grid - 1) / 2;
  const tiles: { t: BBox; d: number }[] = [];
  for (let r = 0; r < grid; r++) {
    for (let q = 0; q < grid; q++) {
      tiles.push({
        t: {
          south: b.south + r * dLat,
          north: b.south + (r + 1) * dLat,
          west: b.west + q * dLon,
          east: b.west + (q + 1) * dLon,
        },
        d: (r - c) ** 2 + (q - c) ** 2,
      });
    }
  }
  return tiles.sort((a, z) => a.d - z.d).map((x) => x.t);
}

export type OsmDiscoveryResult = {
  places: DiscoveredPlace[];
  /**
   * اندیس کاشی بعدی — startTile + **پیشوند پیوسته‌ی کاشی‌های موفق**.
   *
   * عمداً از روی کاشیِ شکست‌خورده رد نمی‌شود: کاشی‌ای که Overpass جوابش را
   * نداده هنوز دیده نشده، و جلوبردن مکان‌نما از رویش یعنی آن بخش شهر تا یک دور
   * کامل (۱۶ کاشی) دیگر هرگز گشته نمی‌شود.
   */
  nextTile: number;
  /** کاشی‌هایی که کوئری‌شان **جواب گرفت** (پایه‌ی متن پوشش) */
  tilesQueried: number;
  /** کاشی‌هایی که امتحان شدند ولی Overpass جواب نداد (۴۲۹/۵۰۴/تایم‌اوت) */
  tilesFailed: number;
  tileCount: number;
  /** آیا این اجرا یک دور کامل شهر را بست؟ */
  wrapped: boolean;
  /** مرز شهر — برای کش‌شدن در مکان‌نما و صرفه‌جویی Nominatim اجرای بعد */
  bbox: BBox;
};

/**
 * کشف کسب‌وکارها از OSM — **کاشی به کاشی، با ادامه از جایی که اجرای قبل رسید**.
 *
 * چرا کاشی: Overpass QL هیچ OFFSET/SKIP ندارد. `out … N` همیشه همان N عنصر اول
 * را به ترتیب canonical می‌دهد، پس تکرار همان کوئری همان مجموعه را می‌دهد —
 * دقیقاً همان چیزی که باعث می‌شد هر «کشف لید» همان ۲۰ کسب‌وکار قبلی را بیاورد.
 * تنها راهِ عوض‌کردن *مجموعه*، عوض‌کردن bbox است.
 *
 * @returns فهرست DiscoveredPlace (فقط آن‌هایی که نام + حداقل یک راه تماس دارند)
 */
export async function discoverViaOsm(
  osmTags: string[],
  city: string,
  opts: {
    /** اندیس کاشی شروع — از مکان‌نمای کمپین */
    startTile: number;
    /** چند نامزد کافی است؛ زودتر از تمام‌شدن کاشی‌ها متوقف می‌شود */
    want: number;
    /** مرز شهرِ کش‌شده؛ اگر بود، Nominatim اصلاً صدا زده نمی‌شود */
    bbox?: BBox | null;
    /** مهلت مطلق منابع (Date.now میلی‌ثانیه) */
    deadlineAt: number;
  }
): Promise<OsmDiscoveryResult> {
  const bbox = opts.bbox ?? (await geocodeCity(city));
  if (!bbox) throw new Error(`مرز شهر «${city}» در OpenStreetMap پیدا نشد.`);
  if (osmTags.length === 0) {
    return {
      places: [],
      nextTile: opts.startTile,
      tilesQueried: 0,
      tilesFailed: 0,
      tileCount: 0,
      wrapped: false,
      bbox,
    };
  }

  const tiles = cityTiles(bbox, OSM.tileGrid);
  const out: DiscoveredPlace[] = [];
  const seenIds = new Set<string>();
  let queried = 0;
  let failed = 0;
  /*
    فقط **پیشوند پیوسته‌ی** موفقیت‌ها مکان‌نما را جلو می‌برد.

    اگر کاشی اول شکست بخورد و دوم موفق شود، اجرای بعد باید از همان کاشی اول
    شروع کند؛ وگرنه کاشی نادیده برای همیشه جا می‌ماند. بهایش این است که کاشی
    دوم دوباره گشته می‌شود — که فقط یک کوئری تکراری است، نه از دست رفتن داده.
  */
  let contiguousOk = 0;
  let sawFailure = false;

  for (let n = 0; n < OSM.tilesPerRun; n++) {
    if (out.length >= opts.want) break;
    const remaining = opts.deadlineAt - Date.now();
    /*
      کاشی اول **همیشه** اجرا می‌شود، فقط با مهلت فشرده‌شده.
      بدون این استثنا، اگر ژئوکد یا منبع موازی وقت برده باشد، OSM دست‌خالی
      برمی‌گشت و کشف بی‌دلیل صفر می‌داد — همان کلاس باگی که بار قبل با
      `skipHtml` دیدیم.
    */
    if (n > 0 && remaining < OSM.tileTimeoutMs) break;
    const timeoutMs = n === 0 ? Math.max(3_000, Math.min(OSM.tileTimeoutMs, remaining)) : OSM.tileTimeoutMs;

    const tile = tiles[(opts.startTile + n) % tiles.length];
    const query = buildOverpassQuery(osmTags, tile, OSM.maxPerTile, timeoutMs);
    const { ok, elements } = await runOverpass(query, timeoutMs, opts.deadlineAt);
    if (!ok) {
      failed++;
      sawFailure = true;
      continue;
    }
    queried++;
    if (!sawFailure) contiguousOk++;
    for (const el of elements) {
      const d = toDiscovered(el);
      if (d && !seenIds.has(d.placeId)) {
        seenIds.add(d.placeId);
        out.push(d);
      }
    }
  }

  // فقط کاشی‌هایی که واقعاً **جواب گرفتند** مکان‌نما را جلو می‌برند — وگرنه کشف
  // از روی کاشی‌های دیده‌نشده می‌پرد و آن کسب‌وکارها تا دور بعد گم می‌شوند.
  const advanced = opts.startTile + contiguousOk;
  return {
    places: out,
    nextTile: advanced % tiles.length,
    tilesQueried: queried,
    tilesFailed: failed,
    tileCount: tiles.length,
    wrapped: contiguousOk > 0 && advanced >= tiles.length,
    bbox,
  };
}
