import "server-only";
import type { ContactChannels } from "@/lib/store/types";

/**
 * سرویس قطعی اعتبارسنجی لید — صفر توکن LLM (نقشه‌راه §17).
 *
 * وظیفه: پیش از خرجِ توکنِ تحلیل، لیدهای بی‌کیفیت/تکراری/تعطیل را رایگان فیلتر کن.
 * dedup واقعی (lookup دیتابیس) در جریان کشف با computeDedupKey انجام می‌شود؛
 * اینجا فقط قواعد قطعیِ روی خود رکورد بررسی می‌شوند.
 */

export type LeadCandidate = {
  businessName: string;
  phone: string | null;
  website: string | null;
  placeId: string | null;
  city: string | null;
  channels: ContactChannels;
  businessStatus: string | null;
};

export type ValidationResult = {
  valid: boolean;
  reasons: string[];
};

/** فقط ارقام (برای نرمال‌سازی و کلید یکتا) */
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

/** آیا رکورد حداقل یک راه تماس دارد؟ */
function hasAnyChannel(c: ContactChannels): boolean {
  return Boolean(c.instagram || c.whatsapp || c.telegram || c.email || c.siteForm || c.phone);
}

/**
 * هاست‌هایی که **هویت یک کسب‌وکار خاص نیستند** و نباید کلید یکتاسازی بسازند.
 *
 * چرا حیاتی است: در داده‌ی واقعی، دو کسب‌وکار کاملاً بی‌ربط («شیرینی مجید» و
 * «پوشاک گِس») هر دو `instagram.com` را در فیلد website داشتند — چون تگ OSM
 * آن‌ها لینک پیج بود نه سایت. اگر دامنه بدون این استثنا کلید می‌شد، آن دو در
 * هم ادغام می‌شدند و یکی‌شان بی‌صدا حذف می‌شد.
 */
const NON_IDENTITY_HOSTS = [
  "instagram.com",
  "facebook.com",
  "t.me",
  "telegram.me",
  "wa.me",
  "linkedin.com",
  "aparat.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "blogfa.com",
  "blog.ir",
  "mihanblog.com",
  "persianblog.ir",
  "wordpress.com",
  "blogspot.com",
  "wixsite.com",
  "sites.google.com",
];

/**
 * دامنه‌ی اصلی سایت را نرمال می‌کند (بدون پروتکل، بدون www، حروف کوچک).
 * اگر هاست هویت‌بخش نبود، null برمی‌گرداند.
 */
export function identityHost(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    // OSM گاهی سایت را بدون پروتکل ذخیره می‌کند («www.example.com»)
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || !host.includes(".")) return null;
    if (NON_IDENTITY_HOSTS.some((h) => host === h || host.endsWith("." + h))) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * کلید یکتاسازی برای حذف تکراری قطعی.
 * اولویت: دامنه‌ی اختصاصی > place_id > تلفن نرمال‌شده > نام+شهر.
 *
 * **چرا دامنه بالاتر از place_id است:** کلیدهای place_id منبع‌محورند
 * (`osm:node/…` در برابر `web:site:…` در برابر خالی برای لید دستی)، پس یک
 * کسب‌وکار که از دو منبع کشف شود دو کلید متفاوت می‌گیرد و دو ردیف می‌سازد.
 * این دقیقاً در داده‌ی واقعی اتفاق افتاد: «کلینیک زیبایی ایرانیان» دو بار ثبت
 * شده بود — یکی از جست‌وجوی وب و یکی دستی — هر دو با `iranianclinic.com`.
 * دامنه‌ی اختصاصی تنها شناسه‌ای است که بین منابع مشترک می‌ماند.
 */
export function computeDedupKey(c: LeadCandidate): string {
  const host = identityHost(c.website);
  if (host) return `site:${host}`;
  if (c.placeId) return `place:${c.placeId}`;
  const phone = c.phone ? digits(c.phone) : c.channels.phone ? digits(c.channels.phone) : "";
  if (phone.length >= 7) return `phone:${phone}`;
  const name = c.businessName.trim().toLowerCase().replace(/\s+/g, " ");
  const city = (c.city ?? "").trim().toLowerCase();
  return `name:${name}|${city}`;
}

/** قواعد قطعی پذیرش یک لید خام */
export function validateCandidate(c: LeadCandidate): ValidationResult {
  const reasons: string[] = [];

  if (!c.businessName || c.businessName.trim().length < 2) {
    reasons.push("نام کسب‌وکار نامعتبر است.");
  }
  if (!hasAnyChannel(c.channels) && !c.phone) {
    reasons.push("هیچ راه تماس عمومی‌ای ندارد.");
  }
  if (c.businessStatus && c.businessStatus !== "OPERATIONAL") {
    reasons.push(`وضعیت کسب‌وکار «${c.businessStatus}» است (فعال نیست).`);
  }

  return { valid: reasons.length === 0, reasons };
}
