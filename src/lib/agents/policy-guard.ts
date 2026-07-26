import "server-only";
import { BANNED_WORDS } from "@/lib/brand";
import { MESSAGE_RULES } from "@/lib/config";

/**
 * Policy & Safety Guard — **کد قطعی، صفر توکن LLM** (نقشه‌راه §24).
 *
 * چرا کد و نه ایجنت: محدودیت‌های سختِ قابل‌محاسبه (کلمه‌ی ممنوع، قیمت، طول)
 * نباید به قضاوت مدل سپرده شوند. مدل ممکن است اشتباه کند؛ این چک‌ها نمی‌کنند.
 * این لایه **علاوه بر** پرامپت است، نه به‌جای آن.
 *
 * Policy Guard حق کاهش محدودیت‌ها را ندارد؛ فقط انسان می‌تواند با ثبت دلیل
 * قوانین را تغییر دهد (config/brand).
 */

export type PolicyVerdict = "PASS" | "BLOCK" | "HUMAN_REVIEW";

export type PolicyCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type PolicyResult = {
  verdict: PolicyVerdict;
  checks: PolicyCheck[];
  violations: string[];
};

/** الگوهای اشاره به قیمت/تخفیف/قرارداد — ممنوع مطلق در پیام اول (§3.3) */
const PRICE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b\d[\d,،.]{2,}\s*(تومان|ریال|میلیون|هزار|دلار)\b/i, label: "مبلغ" },
  { re: /(تخفیف|رایگان\s*نیست|قیمت|هزینه‌ی؟\s*(پروژه|خدمت)|نرخ|تعرفه|قرارداد|پیش‌فاکتور|فاکتور)/i, label: "قیمت/قرارداد" },
  { re: /(٪|درصد)\s*تخفیف/i, label: "تخفیف" },
];

/** شمارش کلمات فارسی (تقریب کافی برای قاعده‌ی طول پیام) */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** کلمات ممنوع برند که در متن آمده‌اند */
export function findBannedWords(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter((w) => lower.includes(w.toLowerCase()));
}

/**
 * پیام را در برابر قواعد سخت بررسی می‌کند.
 * @param message متن پیام کانال مجازی
 * @param opts businessName برای چک شخصی‌سازی؛ isEmail برای معافیت طول
 */
export function checkPolicy(
  message: string,
  opts: { businessName?: string; isEmail?: boolean } = {}
): PolicyResult {
  const checks: PolicyCheck[] = [];
  const violations: string[] = [];
  let hardBlock = false;

  // ۱) کلمات ممنوع برند
  const banned = findBannedWords(message);
  checks.push({
    id: "banned-words",
    label: "کلمات ممنوع برند",
    pass: banned.length === 0,
    detail: banned.length ? `یافت شد: ${banned.join("، ")}` : "هیچ کلمه‌ی ممنوعی نیست",
  });
  if (banned.length) {
    violations.push(`کلمه‌ی ممنوع: ${banned.join("، ")}`);
    hardBlock = true;
  }

  // ۲) قیمت / تخفیف / قرارداد — ممنوع مطلق
  const priceHits = PRICE_PATTERNS.filter((p) => p.re.test(message)).map((p) => p.label);
  checks.push({
    id: "no-price",
    label: "بدون قیمت/تخفیف/قرارداد",
    pass: priceHits.length === 0,
    detail: priceHits.length ? `اشاره به: ${priceHits.join("، ")}` : "اشاره‌ای به قیمت نیست",
  });
  if (priceHits.length) {
    violations.push(`اشاره به قیمت/قرارداد: ${priceHits.join("، ")}`);
    hardBlock = true;
  }

  // ۳) طول پیام (فقط برای پیام کانال مجازی — ایمیل می‌تواند بلندتر باشد)
  if (!opts.isEmail) {
    const words = countWords(message);
    const ok = words >= MESSAGE_RULES.minWords && words <= MESSAGE_RULES.maxWords;
    checks.push({
      id: "length",
      label: `طول ${MESSAGE_RULES.minWords}–${MESSAGE_RULES.maxWords} کلمه`,
      pass: ok,
      detail: `${words} کلمه`,
    });
    if (!ok) violations.push(`طول پیام ${words} کلمه است (مجاز: ${MESSAGE_RULES.minWords}–${MESSAGE_RULES.maxWords})`);
  }

  // ۴) شخصی‌سازی: نام کسب‌وکار باید در پیام باشد (معیار اصلی پروژه)
  if (opts.businessName) {
    // نام‌های طولانی را با چند واژه‌ی کلیدی می‌سنجیم
    const keyParts = opts.businessName
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 3);
    const mentioned = keyParts.some((p) => message.includes(p));
    checks.push({
      id: "personalization",
      label: "ذکر نام کسب‌وکار",
      pass: mentioned,
      detail: mentioned ? "نام کسب‌وکار در پیام آمده" : "نام کسب‌وکار در پیام نیامده",
    });
    if (!mentioned) violations.push("نام کسب‌وکار در پیام ذکر نشده (پیام عمومی است)");
  }

  // ۵) تضمین/ادعای مطلق
  const guarantee = /(تضمین می‌کن|قطعاً نتیجه|۱۰۰٪|100٪|حتماً موفق)/i.test(message);
  checks.push({
    id: "no-guarantee",
    label: "بدون تضمین نتیجه",
    pass: !guarantee,
    detail: guarantee ? "ادعای تضمین یافت شد" : "ادعای تضمینی نیست",
  });
  if (guarantee) {
    violations.push("ادعای تضمین نتیجه");
    hardBlock = true;
  }

  const verdict: PolicyVerdict = hardBlock ? "BLOCK" : violations.length ? "HUMAN_REVIEW" : "PASS";
  return { verdict, checks, violations };
}
