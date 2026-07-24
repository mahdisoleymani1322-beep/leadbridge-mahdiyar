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
 * کلید یکتاسازی برای حذف تکراری قطعی.
 * اولویت: place_id > تلفن نرمال‌شده > نام+شهر (پایین‌ترین اعتماد).
 */
export function computeDedupKey(c: LeadCandidate): string {
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
