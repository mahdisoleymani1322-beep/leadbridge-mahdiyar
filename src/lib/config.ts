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
  /** تگ‌های OpenStreetMap (Overpass) — منبع پیش‌فرض کشف (رایگان، بدون کلید) */
  osmTags: string[];
};

export const MARKETS: Market[] = [
  {
    id: "industrial",
    title: "کارخانجات و گروه‌های صنعتی",
    priority: 1, // اولویت بالا: ارزش قرارداد بالاتر، ضعف دیجیتال رایج
    queryTerms: ["کارخانه", "شرکت تولیدی", "مجتمع صنعتی", "گروه صنعتی"],
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

/** اجتماع عبارت‌های جست‌وجوی همه‌ی بازارها (برای Google) */
export function combinedQueryTerms(): string[] {
  return Array.from(new Set(MARKETS.flatMap((m) => m.queryTerms)));
}

/** تگ‌های OSM متناسب با بازار (یا ترکیبی) */
export function osmTagsFor(marketId: string): string[] {
  return isAllMarkets(marketId) ? combinedOsmTags() : getMarket(marketId)?.osmTags ?? [];
}

/** عبارت‌های جست‌وجوی متناسب با بازار (یا ترکیبی) */
export function queryTermsFor(marketId: string): string[] {
  return isAllMarkets(marketId) ? combinedQueryTerms() : getMarket(marketId)?.queryTerms ?? [marketId];
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
 * Tavily کوتای رایگان محدودی دارد (~۱۰۰۰ جست‌وجو/ماه). پس در هر «کشف لید»
 * استفاده می‌شود ولی با سقف‌های سخت تا مصرف بهینه بماند:
 * - maxSearchesPerRun: حداکثر فراخوان Tavily در هر دکمه‌ی کشف (نه به‌ازای هر عبارت).
 * - maxResultsPerSearch: نتایج هر فراخوان (کمتر = ارزان‌تر).
 * - maxLeadsPerRun: سقف لیدهای وب که به نتیجه اضافه می‌شود.
 * - searchDepth: "basic" (ارزان‌تر و کافی؛ "advanced" گران‌تر است).
 * تخمین مصرف: هر کشف حداکثر ۳ جست‌وجو → ~۳۳۰ کشف در ماه با پلن رایگان.
 */
export const WEB_SEARCH = {
  maxSearchesPerRun: 3,
  maxResultsPerSearch: 6,
  maxLeadsPerRun: 12,
  searchDepth: "basic" as const,
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

/* ── قواعد پیام (نقشه‌راه §22) ─────────────────────────────── */

export const MESSAGE_RULES = {
  minWords: 80,
  maxWords: 120,
} as const;

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
