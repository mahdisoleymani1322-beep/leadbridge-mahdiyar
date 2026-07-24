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
};

export const MARKETS: Market[] = [
  {
    id: "industrial",
    title: "کارخانجات و گروه‌های صنعتی",
    priority: 1, // اولویت بالا: ارزش قرارداد بالاتر، ضعف دیجیتال رایج
    queryTerms: ["کارخانه", "شرکت تولیدی", "مجتمع صنعتی", "گروه صنعتی"],
  },
  {
    id: "beauty_clinic",
    title: "کلینیک‌های زیبایی و دندان‌پزشکی",
    priority: 2,
    queryTerms: ["کلینیک زیبایی", "کلینیک پوست و مو", "دندان‌پزشکی", "مطب زیبایی"],
  },
  {
    id: "traditional_highrev",
    title: "کسب‌وکارهای سنتی پردرآمد",
    priority: 3,
    queryTerms: ["فروشگاه", "شرکت پخش", "بازرگانی", "تولیدی پوشاک"],
  },
  {
    id: "general_ai_fit",
    title: "هر بیزینسی که با AI مشکلاتش حل می‌شود",
    priority: 4,
    queryTerms: ["شرکت خدماتی", "آموزشگاه", "املاک", "مرکز درمانی"],
  },
];

export function getMarket(id: string): Market | undefined {
  return MARKETS.find((m) => m.id === id);
}

/** بازار پیش‌فرض کمپین جدید — اولویت با صنعتی */
export const DEFAULT_MARKET_ID = "industrial";

/* ── سقف‌های پایلوت ────────────────────────────────────────── */

export const LIMITS = {
  dailyDiscovery: 20,
  dailyMessage: 5,
  followUp: 1,
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
