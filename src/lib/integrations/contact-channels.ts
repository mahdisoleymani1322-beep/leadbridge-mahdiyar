import "server-only";
import type { ChannelKey, ContactChannels } from "@/lib/store/types";
import { EXTRACTION } from "@/lib/config";

/**
 * استخراج «راه‌های ارتباط مجازی» یک کسب‌وکار از داده‌ی عمومی.
 *
 * ورودی: تلفن از Places + (اختیاری) HTML صفحه‌ی سایت.
 * خروجی: ContactChannels (اینستاگرام/واتساپ/تلگرام/ایمیل/فرم/تلفن) +
 *         preferredChannel بر اساس اولویت config + trace مسیرهای امتحان‌شده.
 *
 * سرویس قطعی — صفر توکن LLM. فقط داده‌ی عمومی (regex روی HTML سایتِ خود کسب‌وکار).
 *
 * **الگوی «لیست مرتب مسیرها»**: استخراج یک مسیر ثابت نیست، دنباله‌ای از مسیرهای
 * اولویت‌دار است که تا اولین موفقیت جلو می‌رود. هر مسیر نتیجه‌اش را در `trace`
 * ثبت می‌کند. دلیلش یک شکست واقعی بود: لیدی که سایتش باز نمی‌شد صفر کانال
 * می‌گرفت، در اعتبارسنجی رد می‌شد و **هرگز ذخیره نمی‌شد** — و هیچ‌جا ثبت نمی‌شد
 * که چرا. حالا هم مسیر جایگزین هست و هم دلیل شکست قابل‌شمارش است.
 */

/** پیمایش همه‌ی لینک‌های اینستاگرام صفحه (نه فقط اولی) */
const IG_ALL_RE = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/gi;
/** مسیرهای عمومی اینستاگرام که هندل کسب‌وکار نیستند */
const IG_RESERVED = /^(p|reel|reels|explore|stories|accounts|direct|tv|share)$/i;
const WA_RE = /(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\+?\d[\d\s-]{6,})/i;
const TG_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{3,})/i;
const MAILTO_RE = /mailto:([^"'\s>]+@[^"'\s>]+)/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const TEL_RE = /tel:([+\d][\d\s()-]{6,})/i;

/** فقط ارقام را نگه می‌دارد (برای نرمال‌سازی شماره‌ها) */
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

/**
 * URL را برای fetch آماده می‌کند و مقصدهای نامناسب را رد می‌کند.
 *
 * دو مشکل واقعی را حل می‌کند:
 * ۱. **بدون پروتکل**: تگ website در OSM اغلب «www.example.com» است. `fetch`
 *    روی چنین رشته‌ای استثنا می‌داد، استثنا بی‌صدا گرفته می‌شد و نتیجه این بود
 *    که کانال‌های آن کسب‌وکار **هرگز استخراج نمی‌شدند**. در داده‌ی زنده دو لید
 *    دقیقاً همین وضع را داشتند (سایپا امداد و مرکز بهداشت ارتباطات زیرساخت).
 * ۲. **مقصد داخلی**: آدرس سایت از داده‌ی بیرونی (OSM/Tavily) می‌آید و
 *    `redirect: follow` داریم؛ فقط http/https و هاست غیرمحلی مجاز است.
 */
function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (
      h === "localhost" ||
      h.endsWith(".local") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h === "[::1]"
    ) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * گونه‌ی جایگزین هاست: www ↔ بدون www.
 *
 * ارزان‌ترین مسیر جایگزین ممکن است — بدون فراخوان اضافه به سرویس بیرونی. در
 * داده‌ی واقعی، تگ website در OSM اغلب دستی وارد شده و نیمی از سایت‌ها فقط روی
 * یکی از این دو گونه جواب می‌دهند.
 */
function altHostUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    u.hostname = h.startsWith("www.") ? h.slice(4) : "www." + h;
    if (u.hostname === h) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * دلیل شکست خواندن یک صفحه — برای شمارش تجمیعی در گزارش کشف.
 *
 * تفکیک `dns` از `connect` تزئینی نیست، **تصمیم‌ساز** است: وقتی دامنه
 * resolve نمی‌شود، گونه‌ی دیگرِ هاست (www ↔ بدون www) ممکن است اصلاً رکورد
 * جدا داشته باشد و امتحانش می‌ارزد. ولی وقتی دامنه resolve شده و TCP معلق
 * مانده، گونه‌ی دیگر تقریباً همیشه به همان IP می‌رود و تلاش دوباره فقط یک
 * تایم‌اوت کامل از بودجه می‌خورد. در اندازه‌گیری ۷۱ سایت، مسیر جایگزین روی
 * تایم‌اوت‌ها **۷۰ بار امتحان شد و صفر بار نجات داد** — دقیقاً همین اشتباه.
 */
export type FetchFailReason =
  | "bad_url"
  | "timeout"
  | "dns"
  | "connect"
  | "network"
  | "http_error"
  | "not_html";

type FetchOutcome =
  | { ok: true; html: string; url: string }
  | { ok: false; reason: FetchFailReason; status?: number };

/**
 * یک صفحه را می‌خواند و **دلیل شکست را برمی‌گرداند، نه فقط null**.
 *
 * قبلاً همه‌ی شکست‌ها به یک `null` یکسان تبدیل می‌شدند: تایم‌اوت، ۴۰۴،
 * content-type غیر HTML و دامنه‌ی مرده از هم قابل‌تشخیص نبودند. نتیجه این بود که
 * گزارش کشف مجبور بود علت را **حدس بزند** («احتمالاً سایت‌ها باز نشده‌اند»).
 */
async function fetchHtml(rawUrl: string, ms: number = EXTRACTION.pageTimeoutMs): Promise<FetchOutcome> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, reason: "bad_url" };
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
    if (!res.ok) return { ok: false, reason: "http_error", status: res.status };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return { ok: false, reason: "not_html" };
    const html = await res.text();
    return { ok: true, html: html.slice(0, 400_000), url }; // سقف حجم برای امنیت حافظه
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" }; // مهلت خودمان تمام شد
    }
    // undici کد واقعی را در cause می‌گذارد؛ همین کد تعیین می‌کند مسیر جایگزین
    // بیارزد یا نه
    const code = String(
      (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code ?? ""
    );
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { ok: false, reason: "dns" };
    if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
      return { ok: false, reason: "connect" };
    }
    return { ok: false, reason: "network" };
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

/** ریشه‌ی دامنه برای مقایسه با هندل («www.iranianclinic.com» → «iranianclinic») */
function hostRoot(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, "");
  } catch {
    return "";
  }
}

/** هندل را برای مقایسه نرمال می‌کند («iranian_clinic» → «iranianclinic») */
function handleKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * هندل اینستاگرام صفحه را انتخاب می‌کند.
 *
 * چرا «اولین تطبیق» غلط بود: فوتر بسیاری از سایت‌های ایرانی پیج **طراح سایت** را
 * دارد. هندل اشتباه از نداشتن هندل بدتر است، چون پیام به آدرس یک کسب‌وکار دیگر
 * می‌رود. پس اگر چند هندل روی صفحه بود، آن که با دامنه‌ی خود سایت هم‌ریشه است
 * مقدم می‌شود و در غیر این صورت اولی با ثبت ابهام در trace برداشته می‌شود.
 */
function pickInstagram(html: string, pageUrl: string): { handle: string | null; distinct: number } {
  const found: string[] = [];
  for (const m of html.matchAll(IG_ALL_RE)) {
    const raw = m[1].replace(/\/$/, "");
    if (IG_RESERVED.test(raw)) continue;
    if (!found.includes(raw)) found.push(raw);
  }
  if (found.length === 0) return { handle: null, distinct: 0 };

  const root = hostRoot(pageUrl);
  if (root.length >= 4) {
    const owned = found.find((h) => {
      const k = handleKey(h);
      return k.length >= 4 && (k.includes(root) || root.includes(k));
    });
    if (owned) return { handle: "@" + owned, distinct: found.length };
  }
  return { handle: "@" + found[0], distinct: found.length };
}

/**
 * کانال‌ها را از یک قطعه HTML استخراج و در acc ادغام می‌کند.
 * فهرست کانال‌هایی را برمی‌گرداند که **همین مسیر** برای اولین بار پیدا کرد،
 * به‌اضافه‌ی تعداد هندل‌های اینستاگرام متمایز صفحه (سیگنال ابهام).
 */
function extractFromHtml(
  html: string,
  pageUrl: string,
  acc: ContactChannels
): { found: ChannelKey[]; igCandidates: number } {
  const found: ChannelKey[] = [];
  const ig = pickInstagram(html, pageUrl);
  if (!acc.instagram && ig.handle) {
    acc.instagram = ig.handle;
    found.push("instagram");
  }
  if (!acc.whatsapp) {
    const m = html.match(WA_RE);
    if (m) {
      acc.whatsapp = digits(m[1]);
      found.push("whatsapp");
    }
  }
  if (!acc.telegram) {
    const m = html.match(TG_RE);
    if (m && !/^(s|joinchat)$/i.test(m[1])) {
      acc.telegram = "@" + m[1];
      found.push("telegram");
    }
  }
  if (!acc.email) {
    const m = html.match(MAILTO_RE) ?? html.match(EMAIL_RE);
    if (m) {
      const email = (m[1] ?? m[0]).trim();
      // ایمیل‌های تصویری/جعلی رایج را رد کن
      if (!/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) {
        acc.email = email;
        found.push("email");
      }
    }
  }
  if (!acc.phone) {
    const m = html.match(TEL_RE);
    if (m) {
      acc.phone = m[1].replace(/[()\s-]/g, "");
      found.push("phone");
    }
  }
  return { found, igCandidates: ig.distinct };
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

/** نام مسیرهای استخراج — ترتیب اعلام همان ترتیب امتحان‌شدن است */
export type ExtractionPath =
  | "seed" // کانال‌های آماده‌ی خود منبع (تگ‌های contact:* در OSM)
  | "site_home" // صفحه‌ی اصلی سایت
  | "site_home_alt" // همان سایت با گونه‌ی www ↔ بدون www
  | "site_contact"; // صفحه‌ی «تماس با ما»

export type ExtractionStep = {
  path: ExtractionPath;
  ok: boolean;
  /** دلیل شکست — فقط وقتی ok=false */
  reason?: FetchFailReason | "no_input" | "no_time" | "skipped";
  /** کانال‌هایی که این مسیر برای اولین بار پیدا کرد */
  found?: ChannelKey[];
  /** چند هندل اینستاگرام متمایز روی صفحه بود (>۱ یعنی احتمال هندل طراح سایت) */
  igCandidates?: number;
};

export type ExtractInput = {
  website: string | null;
  phone: string | null;
  /** هندل اینستاگرامی که جای دیگر پیدا شده (مثلاً از IG discovery یا تگ OSM) */
  instagramHandle?: string | null;
  /** کانال‌های آماده از خود منبع (تگ‌های contact:* در OSM) */
  seedChannels?: Partial<ContactChannels>;
  /**
   * از خواندن HTML سایت صرف‌نظر کن (وقتی بودجه‌ی زمانی کشف رو به اتمام است).
   * کانال‌های پایه از منبع همچنان ثبت می‌شوند.
   */
  skipHtml?: boolean;
  /**
   * مهلت مطلق کل کشف (Date.now میلی‌ثانیه). مسیرهای جایگزین فقط وقتی امتحان
   * می‌شوند که وقت کافی مانده باشد — وگرنه جایگزین، خودِ کشف را می‌خورد.
   */
  deadlineAt?: number;
  priority: ChannelKey[];
};

export type ExtractResult = {
  channels: ContactChannels;
  preferredChannel: ChannelKey | null;
  instagramHandle: string | null;
  /** مسیرهایی که امتحان شدند و نتیجه‌شان — ورودی تشخیص در گزارش کشف */
  trace: ExtractionStep[];
};

/** یک خواندن صفحه به‌اضافه‌ی استخراج، با ثبت نتیجه در trace */
async function tryPage(
  url: string,
  path: ExtractionPath,
  channels: ContactChannels,
  trace: ExtractionStep[]
): Promise<string | null> {
  const res = await fetchHtml(url);
  if (!res.ok) {
    trace.push({ path, ok: false, reason: res.reason });
    return null;
  }
  const { found, igCandidates } = extractFromHtml(res.html, res.url, channels);
  trace.push({ path, ok: true, found, ...(igCandidates > 1 ? { igCandidates } : {}) });
  return res.html;
}

/**
 * کانال‌های ارتباط یک کسب‌وکار را استخراج می‌کند.
 *
 * ترتیب مسیرها: کانال‌های خودِ منبع → صفحه‌ی اصلی → گونه‌ی www جایگزین →
 * صفحه‌ی تماس. هر مسیر فقط جای خالی‌ها را پر می‌کند، پس داده‌ی منبع (که
 * مطمئن‌تر است) هرگز با داده‌ی HTML بازنویسی نمی‌شود.
 */
export async function extractContactChannels(input: ExtractInput): Promise<ExtractResult> {
  const trace: ExtractionStep[] = [];
  const channels: ContactChannels = { ...(input.seedChannels ?? {}) };
  if (input.phone && !channels.phone) channels.phone = input.phone.replace(/[()\s-]/g, "");
  if (input.instagramHandle && !channels.instagram) channels.instagram = input.instagramHandle;

  const seedKeys = (Object.keys(channels) as ChannelKey[]).filter((k) => channels[k]);
  trace.push({ path: "seed", ok: seedKeys.length > 0, found: seedKeys });

  // پایه‌ی مسیرهای نسبی باید همان URL نرمال‌شده باشد، وگرنه «/contact» روی
  // ورودی بدون پروتکل به آدرس غلط حل می‌شود.
  const siteUrl = input.website && !input.skipHtml ? normalizeUrl(input.website) : null;
  if (!siteUrl) {
    trace.push({
      path: "site_home",
      ok: false,
      reason: input.skipHtml ? "no_time" : input.website ? "bad_url" : "no_input",
    });
  } else {
    let home = await tryPage(siteUrl, "site_home", channels, trace);
    let baseUrl = siteUrl;

    /*
      مسیر جایگزین — فقط وقتی دامنه **resolve نشد**.

      نسخه‌ی اول روی تایم‌اوت هم دوباره امتحان می‌کرد. اندازه‌گیری روی ۷۱ سایت
      واقعی نشان داد آن حالت ۷۰ بار اجرا شد و صفر بار نجات داد — چون تایم‌اوت
      یعنی دامنه resolve شده و فقط کند/معلق است، و گونه‌ی www به همان IP می‌رود.
      نتیجه‌اش صرفاً دو برابر شدن زمان هر لید بود (میانه از ۶ به ۱۲ ثانیه).
      شکست DNS برعکس، دقیقاً همان جایی است که گونه‌ی دیگر رکورد جدا دارد.
    */
    if (!home) {
      const last = trace[trace.length - 1];
      const worthRetry = last.reason === "dns";
      const timeOk =
        !input.deadlineAt || input.deadlineAt - Date.now() > EXTRACTION.altHostMinRemainingMs;
      const alt = worthRetry ? altHostUrl(siteUrl) : null;
      if (alt && timeOk) {
        home = await tryPage(alt, "site_home_alt", channels, trace);
        if (home) baseUrl = alt;
      } else if (worthRetry && alt) {
        trace.push({ path: "site_home_alt", ok: false, reason: "no_time" });
      }
    }

    if (home) {
      /*
        صفحه‌ی تماس فقط وقتی خوانده می‌شود که صفحه‌ی اصلی کانالِ **قابل‌پیام** نداده.

        قبلاً بی‌قیدوشرط خوانده می‌شد. برای لیدی که همان صفحه‌ی اول اینستاگرام و
        واتساپ داشت، این یک تایم‌اوت کامل اضافه بود بدون هیچ سود — و بودجه‌ی
        استخراج (۲۲ ثانیه از ۴۵) دقیقاً همان چیزی است که کم می‌آید. ایمیل و
        تلفن کافی حساب نمی‌شوند چون کانال‌های ضعیف‌تر این کمپین‌اند.
      */
      const hasStrongChannel = Boolean(
        channels.instagram || channels.whatsapp || channels.telegram
      );
      const contactUrl = hasStrongChannel ? null : findContactPath(home, baseUrl);
      if (hasStrongChannel) {
        trace.push({ path: "site_contact", ok: false, reason: "skipped" });
      } else if (contactUrl && contactUrl !== baseUrl) {
        const contactHtml = await tryPage(contactUrl, "site_contact", channels, trace);
        if (contactHtml) {
          // اگر فرم تماس دیده شد، به‌عنوان کانال ثبت کن
          if (!channels.siteForm && /<form[\s>]/i.test(contactHtml)) {
            channels.siteForm = contactUrl;
          }
        }
      } else {
        trace.push({ path: "site_contact", ok: false, reason: "no_input" });
      }
      if (!channels.siteForm && /<form[\s>]/i.test(home)) {
        channels.siteForm = baseUrl;
      }
    }
  }

  const instagramHandle = channels.instagram ?? null;
  const preferredChannel = pickPreferredChannel(channels, input.priority);
  return { channels, preferredChannel, instagramHandle, trace };
}
