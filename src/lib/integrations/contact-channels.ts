import "server-only";
import type { ChannelKey, ContactChannels } from "@/lib/store/types";

/**
 * استخراج «راه‌های ارتباط مجازی» یک کسب‌وکار از داده‌ی عمومی.
 *
 * ورودی: تلفن از Places + (اختیاری) HTML صفحه‌ی سایت.
 * خروجی: ContactChannels (اینستاگرام/واتساپ/تلگرام/ایمیل/فرم/تلفن) +
 *         preferredChannel بر اساس اولویت config.
 *
 * سرویس قطعی — صفر توکن LLM. فقط داده‌ی عمومی (regex روی HTML سایتِ خود کسب‌وکار).
 */

const IG_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i;
const WA_RE = /(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d[\d\s-]{6,})/i;
const TG_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{3,})/i;
const MAILTO_RE = /mailto:([^"'\s>]+@[^"'\s>]+)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const TEL_RE = /tel:([+\d][\d\s()-]{6,})/i;

/** فقط ارقام را نگه می‌دارد (برای نرمال‌سازی شماره‌ها) */
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

async function fetchHtml(url: string, ms = 6000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // UA معمولی؛ فقط صفحه‌ی عمومی را می‌خوانیم
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadBridge/1.0; +https://mahdiyar.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    const html = await res.text();
    return html.slice(0, 400_000); // سقف حجم برای امنیت حافظه
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** یک صفحه‌ی «تماس» محتمل را از HTML خانه پیدا می‌کند */
function findContactPath(html: string, baseUrl: string): string | null {
  const m = html.match(/href=["']([^"']*(?:contact|تماس|ارتباط)[^"']*)["']/i);
  if (!m) return null;
  try {
    return new URL(m[1], baseUrl).toString();
  } catch {
    return null;
  }
}

/** کانال‌ها را از یک قطعه HTML استخراج و در acc ادغام می‌کند */
function extractFromHtml(html: string, acc: ContactChannels): void {
  if (!acc.instagram) {
    const m = html.match(IG_RE);
    // مسیرهای عمومی اینستاگرام (نه پست/اکسپلور) را نادیده بگیر
    if (m && !/^(p|reel|reels|explore|stories|accounts)$/i.test(m[1])) {
      acc.instagram = "@" + m[1].replace(/\/$/, "");
    }
  }
  if (!acc.whatsapp) {
    const m = html.match(WA_RE);
    if (m) acc.whatsapp = digits(m[1]);
  }
  if (!acc.telegram) {
    const m = html.match(TG_RE);
    if (m && !/^(s|joinchat)$/i.test(m[1])) acc.telegram = "@" + m[1];
  }
  if (!acc.email) {
    const m = html.match(MAILTO_RE) ?? html.match(EMAIL_RE);
    if (m) {
      const email = (m[1] ?? m[0]).trim();
      // ایمیل‌های تصویری/جعلی رایج را رد کن
      if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) acc.email = email;
    }
  }
  if (!acc.phone) {
    const m = html.match(TEL_RE);
    if (m) acc.phone = m[1].replace(/[()\s-]/g, "");
  }
}

/** اولین کانال موجود بر اساس ترتیب اولویت را انتخاب می‌کند */
export function pickPreferredChannel(
  channels: ContactChannels,
  priority: ChannelKey[]
): ChannelKey | null {
  for (const key of priority) {
    if (channels[key]) return key;
  }
  return null;
}

export type ExtractInput = {
  website: string | null;
  phone: string | null;
  /** هندل اینستاگرامی که جای دیگر پیدا شده (مثلاً از IG discovery یا تگ OSM) */
  instagramHandle?: string | null;
  /** کانال‌های آماده از خود منبع (تگ‌های contact:* در OSM) */
  seedChannels?: Partial<ContactChannels>;
  priority: ChannelKey[];
};

export type ExtractResult = {
  channels: ContactChannels;
  preferredChannel: ChannelKey | null;
  instagramHandle: string | null;
};

/**
 * کانال‌های ارتباط یک کسب‌وکار را استخراج می‌کند.
 * تلفن از Places پایه است؛ اگر سایت باشد، صفحه‌ی خانه و صفحه‌ی تماس را
 * (best-effort) می‌خواند و کانال‌های بیشتری استخراج می‌کند.
 */
export async function extractContactChannels(input: ExtractInput): Promise<ExtractResult> {
  const channels: ContactChannels = { ...(input.seedChannels ?? {}) };
  if (input.phone && !channels.phone) channels.phone = input.phone.replace(/[()\s-]/g, "");
  if (input.instagramHandle && !channels.instagram) channels.instagram = input.instagramHandle;

  if (input.website) {
    const home = await fetchHtml(input.website);
    if (home) {
      extractFromHtml(home, channels);
      const contactUrl = findContactPath(home, input.website);
      if (contactUrl && contactUrl !== input.website) {
        const contactHtml = await fetchHtml(contactUrl);
        if (contactHtml) {
          extractFromHtml(contactHtml, channels);
          // اگر فرم تماس دیده شد، به‌عنوان کانال ثبت کن
          if (!channels.siteForm && /<form[\s>]/i.test(contactHtml)) {
            channels.siteForm = contactUrl;
          }
        }
      }
      if (!channels.siteForm && /<form[\s>]/i.test(home)) {
        channels.siteForm = input.website;
      }
    }
  }

  const instagramHandle = channels.instagram ?? null;
  const preferredChannel = pickPreferredChannel(channels, input.priority);
  return { channels, preferredChannel, instagramHandle };
}
