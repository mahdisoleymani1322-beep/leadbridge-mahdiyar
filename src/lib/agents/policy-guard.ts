import "server-only";
import { BANNED_WORDS, CLICHE_PHRASES, FORBIDDEN_CLAIMS } from "@/lib/brand";
import { messageLengthFor } from "@/lib/config";
import type { ChannelKey } from "@/lib/store/types";

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

/** ادعای «نمونه‌کار را فرستادم» — دروغ است چون مالک دستی اتچ می‌کند */
const SENT_PORTFOLIO_RE =
  /(نمونه[‌\s]?کار|نمونه)[^.،]{0,30}(فرستادم|ارسال کردم|همراه پیام فرستادم|پیوست کردم|ضمیمه کردم)/i;

/**
 * پیام را در برابر قواعد سخت بررسی می‌کند.
 *
 * @param message متن پیام
 * @param opts
 *   - `businessName` برای چک شخصی‌سازی
 *   - `channel` بازه‌ی طول مجاز را تعیین می‌کند (دایرکت کوتاه‌تر از ایمیل)
 *   - `isEmail` نسخه‌ی ایمیلی — بازه‌ی خودش را دارد
 *   - `portfolioMention` وضعیت اعلام‌شده‌ی نمونه‌کار؛ اگر `attached` نباشد،
 *     ادعای «فرستادم» در متن یک دروغ است و BLOCK می‌شود
 */
export function checkPolicy(
  message: string,
  opts: {
    businessName?: string;
    isEmail?: boolean;
    channel?: ChannelKey | null;
    portfolioMention?: "attached" | "available" | "linked" | "none";
  } = {}
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

  // ۳) طول پیام — **تابع کانال** است، نه یک عدد ثابت.
  //    زیر حد مجاز ایراد نیست: دستور پیام‌نویسی می‌گوید «کوتاه‌ترین نسخه‌ای که
  //    منظور را کامل می‌رساند بهتر است». فقط بلندی بیش از حد ثبت می‌شود.
  {
    const range = messageLengthFor(opts.isEmail ? "email" : opts.channel ?? null);
    const words = countWords(message);
    const tooLong = words > range.max;
    checks.push({
      id: "length",
      label: `طول متناسب کانال (تا ${range.max} کلمه)`,
      pass: !tooLong,
      detail: tooLong
        ? `${words} کلمه — بیش از حد این کانال`
        : `${words} کلمه (بازه‌ی پیشنهادی ${range.min}–${range.max})`,
    });
    if (tooLong) violations.push(`طول پیام ${words} کلمه است (سقف این کانال: ${range.max})`);
  }

  // ۳-ب) عبارت‌های قالبی — پیام را ماشینی می‌کنند (بند ۱۰ دستور پیام‌نویسی).
  //      BLOCK نمی‌شوند چون خطای اخلاقی نیستند؛ فقط به بازبینی انسانی می‌روند.
  {
    const lower = message.toLowerCase();
    const found = CLICHE_PHRASES.filter((p) => lower.includes(p.toLowerCase()));
    checks.push({
      id: "no-cliche",
      label: "بدون عبارت‌های قالبی",
      pass: found.length === 0,
      detail: found.length ? `یافت شد: ${found.join("، ")}` : "لحن قالبی نیست",
    });
    if (found.length) violations.push(`عبارت قالبی: ${found.join("، ")}`);
  }

  // ۳-ج) جمله‌های ممنوع (بند ۱۸) — تحقیر کسب‌وکار، وعده‌ی نتیجه، فشار برای پاسخ
  {
    const lower = message.toLowerCase();
    const found = FORBIDDEN_CLAIMS.filter((p) => lower.includes(p.toLowerCase()));
    checks.push({
      id: "no-forbidden-claims",
      label: "بدون ادعای ممنوع",
      pass: found.length === 0,
      detail: found.length ? `یافت شد: ${found.join("، ")}` : "ادعای ممنوعی نیست",
    });
    if (found.length) {
      violations.push(`ادعای ممنوع: ${found.join("، ")}`);
      hardBlock = true;
    }
  }

  // ۳-د) ادعای دروغِ نمونه‌کار — مالک دستی اتچ می‌کند، پس «فرستادم» دروغ است
  {
    const claimsSent = SENT_PORTFOLIO_RE.test(message);
    const actuallyAttached = opts.portfolioMention === "attached";
    const lying = claimsSent && !actuallyAttached;
    checks.push({
      id: "portfolio-honesty",
      label: "ادعای درست درباره‌ی نمونه‌کار",
      pass: !lying,
      detail: lying
        ? "متن می‌گوید نمونه‌کار فرستاده شده، ولی چیزی همراه پیام نیست"
        : "ادعای نادرستی درباره‌ی نمونه‌کار نیست",
    });
    if (lying) {
      violations.push("ادعای دروغ: نمونه‌کار همراه پیام فرستاده نشده است");
      hardBlock = true;
    }
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
