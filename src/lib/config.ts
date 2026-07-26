/**
 * پارامترهای قطعی سیستم — همه‌جا از اینجا خوانده می‌شوند تا «کار قطعی» از
 * تصمیم LLM جدا بماند (اصل §6 نقشه‌راه). تغییر آستانه/وزن/سقف فقط اینجا.
 */

import type { ChannelKey } from "./store/types";

/* ── شهر و بازارهای هدف (ICP) ─────────────────────────────── */

export const DEFAULT_CITY = "تهران";

export type Market = {
  id: string;
  title: string;
  /** اولویت پایین‌تر = مهم‌تر (۱ بالاترین اولویت) */
  priority: number;
  /** عبارت‌های جست‌وجو برای Google Places Text Search */
  queryTerms: string[];
  /**
   * عبارت‌های ویژه‌ی «دفتر در شهر هدف» — برای بازارهایی که خودِ کسب‌وکار
   * ممکن است بیرون شهر باشد ولی دفتر مرکزی/فروش در شهر داشته باشد.
   *
   * فقط بازار صنعتی این را دارد: کارخانه‌ی ساوه یا کاشان دفتر تهران دارد و
   * قرار حضوری همان‌جاست. «دفتر مرکزی کلینیک زیبایی» بی‌معنی است، پس بقیه‌ی
   * بازارها این فیلد را نمی‌گیرند.
   *
   * سمت OSM چیزی لازم نیست: مرز Overpass همان شهر است و `office=company`
   * از قبل در تگ‌های بازار صنعتی هست — دفتر تهران خودبه‌خود پیدا می‌شود.
   * شکاف فقط سمت جست‌وجوی وب (Tavily) بود.
   */
  officeTerms?: string[];
  /** تگ‌های OpenStreetMap (Overpass) — منبع پیش‌فرض کشف (رایگان، بدون کلید) */
  osmTags: string[];
};

export const MARKETS: Market[] = [
  {
    id: "industrial",
    title: "کارخانجات و گروه‌های صنعتی",
    priority: 1, // اولویت بالا: ارزش قرارداد بالاتر، ضعف دیجیتال رایج
    queryTerms: ["کارخانه", "شرکت تولیدی", "مجتمع صنعتی", "گروه صنعتی"],
    officeTerms: [
      "دفتر مرکزی کارخانه",
      "دفتر فروش کارخانه",
      "دفتر مرکزی گروه صنعتی",
      "نمایندگی صنایع",
    ],
    osmTags: ["man_made=works", "office=company", "industrial", "craft", "office=industrial"],
  },
  {
    id: "beauty_clinic",
    title: "کلینیک‌های زیبایی و دندان‌پزشکی",
    priority: 2,
    queryTerms: ["کلینیک زیبایی", "کلینیک پوست و مو", "دندان‌پزشکی", "مطب زیبایی"],
    osmTags: [
      "amenity=clinic",
      "amenity=dentist",
      "amenity=doctors",
      "shop=beauty",
      "shop=hairdresser",
      "healthcare=clinic",
    ],
  },
  {
    id: "traditional_highrev",
    title: "کسب‌وکارهای سنتی پردرآمد",
    priority: 3,
    queryTerms: ["فروشگاه", "شرکت پخش", "بازرگانی", "تولیدی پوشاک"],
    osmTags: ["shop=jewelry", "shop=furniture", "shop=clothes", "shop=car", "shop=wholesale"],
  },
  {
    id: "general_ai_fit",
    title: "هر بیزینسی که با AI مشکلاتش حل می‌شود",
    priority: 4,
    queryTerms: ["شرکت خدماتی", "آموزشگاه", "املاک", "مرکز درمانی"],
    osmTags: ["office=estate_agent", "amenity=school", "office=educational_institution", "office=company"],
  },
];

export function getMarket(id: string): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}

/** شناسه‌ی ویژه‌ی «همه‌ی بازارها با هم» (کشف ترکیبی) */
export const ALL_MARKET_ID = "all";

/** آیا این کمپین همه‌ی بازارها را با هم هدف می‌گیرد؟ */
export function isAllMarkets(id: string): boolean {
  return id === ALL_MARKET_ID;
}

/** برچسب نمایشی بازار (شامل حالت ترکیبی) */
export function marketLabel(id: string): string {
  if (isAllMarkets(id)) return "همه‌ی بازارها (ترکیبی)";
  return getMarket(id)?.title ?? id;
}

/** اجتماع (union) تگ‌های OSM همه‌ی بازارها — برای کشف ترکیبی */
export function combinedOsmTags(): string[] {
  return Array.from(new Set(MARKETS.flatMap((m) => m.osmTags)));
}

/** همه‌ی عبارت‌های جست‌وجوی یک بازار (عادی + عبارت‌های دفتر شهر) */
function allTermsOf(m: Market): string[] {
  return [...m.queryTerms, ...(m.officeTerms ?? [])];
}

/**
 * اجتماع عبارت‌های جست‌وجوی همه‌ی بازارها — **چرخشی (round-robin)**، نه پشت‌سرهم.
 *
 * چرا چرخش اینجا و نه در web-search: بودجه‌ی Tavily (۸ فراخوان) خیلی کمتر از
 * تعداد کل عبارت‌هاست، پس فقط ابتدای این فهرست واقعاً جست‌وجو می‌شود. اگر
 * بازارها پشت‌سرهم بیایند، همه‌ی بودجه صرف بازار اول (صنعتی) می‌شود و کلینیک
 * و بقیه هیچ‌وقت نوبتشان نمی‌رسد.
 *
 * قبلاً این کار در `interleaveTerms(terms, groupSize = 4)` انجام می‌شد که فرض
 * می‌کرد **هر بازار دقیقاً ۴ عبارت دارد**. با اضافه‌شدن `officeTerms` به بازار
 * صنعتی (۸ عبارت) آن فرض می‌شکست و بی‌سروصدا بازارها را نامتوازن می‌کرد. اینجا
 * مرز بازارها معلوم است، پس چرخش درست انجام می‌شود.
 */
export function combinedQueryTerms(): string[] {
  const groups = MARKETS.map(allTermsOf);
  const longest = Math.max(0, ...groups.map((g) => g.length));
  const out: string[] = [];
  for (let i = 0; i < longest; i++) {
    for (const g of groups) {
      if (g[i]) out.push(g[i]);
    }
  }
  return Array.from(new Set(out));
}

/** تگ‌های OSM متناسب با بازار (یا ترکیبی) */
export function osmTagsFor(marketId: string): string[] {
  return isAllMarkets(marketId) ? combinedOsmTags() : getMarket(marketId)?.osmTags ?? [];
}

/** عبارت‌های جست‌وجوی متناسب با بازار (یا ترکیبی) — شامل عبارت‌های دفتر شهر */
export function queryTermsFor(marketId: string): string[] {
  if (isAllMarkets(marketId)) return combinedQueryTerms();
  const m = getMarket(marketId);
  return m ? allTermsOf(m) : [marketId];
}

/** بازار پیش‌فرض کمپین جدید — ترکیبی (همه با هم) */
export const DEFAULT_MARKET_ID = ALL_MARKET_ID;

/* ── سقف‌های پایلوت ────────────────────────────────────────── */

export const LIMITS = {
  dailyDiscovery: 20,
  dailyMessage: 5,
  followUp: 1,
} as const;

/* ── گاردریل جست‌وجوی وب (Tavily) ──────────────────────────── */

/**
 * Tavily کوتای رایگان محدودی دارد (~۱۰۰۰ اعتبار/ماه؛ advanced = ۲ اعتبار).
 * حالت «متوسط» انتخاب مالک: ~۲۰ اعتبار در هر کشف → حدود ۵۰ کشف در ماه.
 *
 * - maxSearchesPerRun: حداکثر فراخوان Tavily در هر دکمه‌ی کشف (نه به‌ازای هر عبارت).
 * - maxResultsPerSearch: نتایج هر فراخوان.
 * - maxLeadsPerRun: سقف لیدهای وب که به نتیجه اضافه می‌شود.
 * - searchDepth: "advanced" — نتایج غنی‌تر و دقیق‌تر (۲ اعتبار به‌جای ۱).
 * - enrichTopLeads: چند لید برترِ توان مالی برای جست‌وجوی غنی‌سازی جدا شوند.
 */
export const WEB_SEARCH = {
  maxSearchesPerRun: 8,
  maxResultsPerSearch: 10,
  maxLeadsPerRun: 25,
  searchDepth: "advanced" as const,
  enrichTopLeads: 2,
} as const;

/* ── امتیازدهی لید (۷ معیار وزنی — نقشه‌راه §11.4) ─────────── */

export const SCORING_WEIGHTS = {
  marketFit: 20,
  visibleNeed: 20,
  infoCredibility: 15,
  onlineActivity: 10,
  portfolioFit: 15,
  decisionMakerAccess: 10,
  lowRisk: 10,
} as const;

export type ScoringCriterion = keyof typeof SCORING_WEIGHTS;

export const SCORE_THRESHOLDS = {
  /** ≥ این امتیاز → واجد شرایط پیام */
  pass: 70,
  /** بین nurture و pass → نگه‌داری برای بعد */
  nurture: 50,
} as const;

/* ── دروازه‌ی توان مالی (پیش از تحلیل — صرفه‌جویی سهمیه) ───── */

/**
 * لیدی که نمره‌ی توان مالی‌اش زیر این حد است **تحلیل نمی‌شود**.
 *
 * چرا: سهمیه‌ی مدل رایگان ۵۰ درخواست در روز است و هر لید ردشده یک فراخوان
 * تحلیل را می‌سوزاند. غربال رایگان قبل از خرج توکن، همان اصل «فیلتر رایگان
 * پیش از مراحل توکن‌بر» نقشه‌راه است.
 *
 * عدد ۳۵ از داده‌ی واقعی کالیبره شده، نه حدس: روی ۴۵ لید موجود، توزیع نمره
 * ۰ تا ۷۲ است و آستانه‌ی ۳۵ حدود ۴۴٪ لیدها را نگه می‌دارد. نقطه‌ی شکست طبیعیِ
 * بعدی ۴۰ است که به ۲۷٪ می‌رسد — سخت‌گیرانه‌تر ولی کلینیک‌های واقعیِ دارای
 * سایت و تلفن ثابت را هم کنار می‌گذارد.
 *
 * لید زیر آستانه پاک نمی‌شود؛ وضعیتش LOW_VALUE می‌شود و همیشه می‌توان با
 * دکمه‌ی «تحلیل لید» همان ردیف دستی تحلیلش کرد (اراده‌ی صریح انسان بر دروازه
 * مقدم است).
 */
export const AFFLUENCE_THRESHOLDS = {
  analyze: 35,
} as const;

/* ── روبریک نقد پیام (نقشه‌راه §23) ────────────────────────── */

export const CRITIC_RUBRIC = {
  accuracy: 20, // صحت و اتکا به Evidence
  personalization: 15, // شخصی‌سازی مختص همان بیزینس
  clarity: 15,
  naturalness: 10,
  serviceFit: 10,
  cta: 10,
  constraints: 20, // رعایت محدودیت‌ها (بدون قیمت/ادعا/…)
} as const;

export const CRITIC_THRESHOLDS = {
  /** ≥ این → تأیید */
  pass: 85,
  /** بین revise و pass → یک دور اصلاح */
  revise: 75,
} as const;

/** حداکثر دور بازنویسی پیام؛ بعد از آن → Human Review */
export const MAX_REVISION_ROUNDS = 2;

/**
 * گاردریل حلقه‌ی بی‌نهایت (نقشه‌راه §14/§32): سقف گام‌های ارکستریتور برای هر
 * لید در یک اجرا. اگر پر شد، اجرا با stop_reason=MAX_STEPS متوقف می‌شود.
 */
export const MAX_STEPS_PER_LEAD = 10;

/* ── قواعد پیام (نقشه‌راه §22 + دستور پیام‌نویسی مالک) ─────── */

/**
 * طول پیام **تابع کانال** است، نه یک عدد ثابت.
 *
 * چرا: دایرکت اینستاگرام جای پیام کوتاه است و متن ۱۲۰ کلمه‌ای آنجا خوانده
 * نمی‌شود؛ ایمیل برعکس، جا برای توضیح دارد. عدد ثابت قبلی (۸۰–۱۲۰) باعث
 * می‌شد نویسنده پیام دایرکت را بی‌دلیل کش بدهد.
 *
 * این‌ها **سقف قطعی نیستند**: کوتاه‌ترین نسخه‌ای که منظور را کامل می‌رساند
 * بهتر است. Policy Guard فقط خارج‌از‌بازه‌بودن را به‌عنوان هشدار ثبت می‌کند،
 * نه به‌عنوان BLOCK.
 */
export const MESSAGE_LENGTH_BY_CHANNEL: Record<ChannelKey | "email", { min: number; max: number }> = {
  instagram: { min: 50, max: 90 },
  whatsapp: { min: 60, max: 110 },
  telegram: { min: 60, max: 110 },
  siteForm: { min: 60, max: 110 },
  phone: { min: 60, max: 110 },
  email: { min: 80, max: 140 },
};

/** بازه‌ی طول برای یک کانال (اگر کانال نامشخص بود، حالت میانه) */
export function messageLengthFor(channel: ChannelKey | "email" | null): { min: number; max: number } {
  return (channel && MESSAGE_LENGTH_BY_CHANNEL[channel]) || { min: 60, max: 110 };
}

/**
 * حداکثر خدمت در یک پیام: ۱ اصلی + تا ۲ مکمل — به‌شرطی که هر سه **یک نتیجه‌ی
 * مشترک** بدهند. فهرست‌کردن توانایی‌ها ممنوع است.
 */
export const MAX_SERVICES_PER_MESSAGE = 3;

/** حداکثر نمونه‌کار پیشنهادی برای اتچ — معمولاً ۱ */
export const MAX_PORTFOLIO_PER_MESSAGE = 2;

/** ترتیب اولویت انتخاب نمونه‌کار (دستور پیام‌نویسی، بند ۸) */
export const PORTFOLIO_MATCH_PRIORITY = [
  "همان صنعت",
  "مسئله‌ی مشابه",
  "سبک بصری نزدیک",
  "نوع خروجی مشابه",
  "نزدیک‌ترین نمونه‌ی تأییدشده",
] as const;

/* ── اولویت کانال ارتباط ──────────────────────────────────── */

/**
 * اولویت انتخاب کانال مجازی برای ارسال. ایمیل جداست: اگر لید ایمیل داشته
 * باشد، همیشه یک نسخه‌ی ایمیلی هم علاوه بر کانال مجازی ساخته می‌شود.
 */
export const CHANNEL_PRIORITY: ChannelKey[] = [
  "instagram",
  "whatsapp",
  "telegram",
  "siteForm",
  "phone",
];
