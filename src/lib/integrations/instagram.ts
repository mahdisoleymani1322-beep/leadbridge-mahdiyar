import "server-only";

/**
 * یکپارچه‌سازی Instagram Graph API — فقط business_discovery رسمی.
 *
 * با توکن حساب بیزینس مهدیار، داده‌ی «عمومی» یک پیج هدف را می‌خوانیم
 * (followers, media_count, biography, website, چند پست اخیر). این تنها
 * روش رسمیِ مجاز است؛ هیچ جست‌وجوی آزادِ همه‌ی حساب‌ها و هیچ ارسال دایرکتی
 * اینجا نیست.
 *
 * کلیدها: IG_ACCESS_TOKEN + IG_BUSINESS_ID (حساب بیزینس متصل مهدیار).
 * سرویس قطعی — صفر توکن LLM. اگر کلیدها نباشند، best-effort و بی‌صدا رد می‌شود.
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export type IgProfile = {
  username: string;
  followersCount: number | null;
  mediaCount: number | null;
  biography: string | null;
  website: string | null;
  /** کپشن چند پست اخیر — سیگنال فعالیت/نیاز برای تحلیل بعدی */
  recentCaptions: string[];
};

export function isInstagramConfigured(): boolean {
  return Boolean(process.env.IG_ACCESS_TOKEN && process.env.IG_BUSINESS_ID);
}

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** «@name» یا URL را به username خام تبدیل می‌کند */
export function normalizeHandle(handle: string): string {
  let h = handle.trim();
  const m = h.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (m) h = m[1];
  return h.replace(/^@/, "").replace(/\/$/, "").trim();
}

/**
 * داده‌ی عمومی یک پیج هدف را با business_discovery برمی‌گرداند.
 * در صورت نبود کلید یا خطا، null (best-effort — کشف نباید بشکند).
 */
export async function businessDiscovery(handleOrUrl: string): Promise<IgProfile | null> {
  if (!isInstagramConfigured()) return null;
  const username = normalizeHandle(handleOrUrl);
  if (!username) return null;

  const token = process.env.IG_ACCESS_TOKEN!;
  const igId = process.env.IG_BUSINESS_ID!;
  const sub =
    `business_discovery.username(${username})` +
    `{username,followers_count,media_count,biography,website,media.limit(6){caption,like_count,timestamp}}`;
  const url =
    `${GRAPH_BASE}/${encodeURIComponent(igId)}` +
    `?fields=${encodeURIComponent(sub)}&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const data: any = await res.json();
    const bd = data?.business_discovery;
    if (!bd) return null;
    const captions: string[] = Array.isArray(bd.media?.data)
      ? bd.media.data
          .map((m: { caption?: string }) => (m.caption ?? "").trim())
          .filter((c: string) => c.length > 0)
      : [];
    return {
      username: bd.username ?? username,
      followersCount: typeof bd.followers_count === "number" ? bd.followers_count : null,
      mediaCount: typeof bd.media_count === "number" ? bd.media_count : null,
      biography: bd.biography ?? null,
      website: bd.website ?? null,
      recentCaptions: captions,
    };
  } catch {
    return null; // best-effort: کشف نباید به‌خاطر IG بشکند
  }
}
