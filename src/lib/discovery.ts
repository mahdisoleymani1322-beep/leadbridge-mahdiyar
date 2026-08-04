import "server-only";
import { randomUUID } from "crypto";
import { getStore, type Lead } from "@/lib/store";
import type { DiscoveryCursor } from "@/lib/store/types";
import {
  getMarket,
  CHANNEL_PRIORITY,
  marketLabel,
  osmTagsFor,
  queryTermsFor,
  WEB_SEARCH,
  EXTRACTION,
  OSM,
  PLACES,
  GOOGLE_SEARCH,
  DISCOVERY,
} from "@/lib/config";
import { textSearch, isPlacesConfigured } from "@/lib/integrations/google-places";
import { discoverViaOsm } from "@/lib/integrations/openstreetmap";
import { discoverViaWebSearch, isWebSearchConfigured } from "@/lib/integrations/web-search";
import {
  discoverViaGoogleSearch,
  isGoogleSearchConfigured,
} from "@/lib/integrations/google-search";
import type { DiscoveredPlace } from "@/lib/integrations/types";
import { extractContactChannels } from "@/lib/integrations/contact-channels";
import { businessDiscovery, isInstagramConfigured } from "@/lib/integrations/instagram";
import { computeDedupKey, validateCandidate, type LeadCandidate } from "@/lib/agents/validation";
import { scoreAffluence, preRankPlace } from "@/lib/agents/affluence";
import { recordDecision } from "@/lib/audit";

/**
 * جریان کشف لید (کمپین‌محور) — سرویس قطعی، صفر توکن LLM.
 *
 * منبع پیش‌فرض: OpenStreetMap (رایگان، بدون کلید). اگر GOOGLE_MAPS_API_KEY
 * تنظیم شده باشد، از Google Places استفاده می‌شود.
 *
 * منبع → استخراج کانال‌های ارتباط (تگ‌های OSM + سایت) → حذف تکراری (dedup) →
 * درج لید با status=NEW. هر گام در agent_runs ثبت می‌شود. فقط داده‌ی عمومی.
 */

export type DiscoverySource = "google_places" | "openstreetmap";

export type DiscoverySummary = {
  campaignId: string;
  source: DiscoverySource;
  query: string;
  found: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  errors: number;
  /** چند جست‌وجوی Tavily در این کشف مصرف شد (شفافیت سهمیه‌ی رایگان) */
  webSearches: number;
  /** چند لید از جست‌وجوی وب آمد (بقیه از OSM/Google) */
  webLeads: number;
  /** چند فراخوان Google Programmable Search مصرف شد */
  googleSearches: number;
  /**
   * چند نامزد **از قبل در پایگاه بود** — پیش از برش سقف روزانه.
   *
   * این عددی است که مالک واقعاً می‌خواهد بداند. تا امروز با `duplicates`
   * قاطی بود و «تکراری» هم‌زمان یعنی «دو منبع یک چیز آوردند» و «قبلاً داشتمش».
   */
  alreadyKnown: number;
  /** زیرمجموعه‌ی alreadyKnown که در سطل زباله است (مالک خودش پاکشان کرده) */
  knownTrashed: number;
  /** دو نتیجه‌ی همین اجرا که یک کسب‌وکار بودند */
  duplicatesInRun: number;
  /** نامزدهای واقعاً تازه‌ای که برای پرکردن سقف روزانه ماندند */
  fresh: number;
  /**
   * اگر پیش‌فیلتر یک کلید را «تازه» دید ولی درج آن را تکراری یافت.
   * غیرصفر بودنش یعنی چیزی بین این دو مرحله درج شده (ورود CSV یا اجرای هم‌زمان).
   */
  raceDuplicates: number;
  /**
   * چرا لیدها در اعتبارسنجی رد شدند — دلیل → تعداد.
   *
   * `validateCandidate` این دلیل‌ها را از اول حساب می‌کرد ولی اینجا فقط
   * `check.valid` خوانده می‌شد و `reasons` دور ریخته می‌شد. نتیجه: گزارش مجبور
   * بود علت را حدس بزند در حالی که یک لایه بالاتر دقیقاً می‌دانستش.
   */
  rejectReasons: Record<string, number>;
  /**
   * چرا مسیرهای استخراج کانال شکست خوردند — مسیر:دلیل → تعداد.
   * (مثلاً `site_home:timeout`) تفکیک تایم‌اوت از ۴۰۴ از دامنه‌ی مرده تعیین
   * می‌کند که راه‌حل «بودجه‌ی بیشتر» است یا «منبع دیگر».
   */
  extractionFailures: Record<string, number>;
  /**
   * توضیح خوانا وقتی نتیجه کمتر از انتظار است.
   *
   * چرا لازم شد: در تست زنده، کشف با `found: 0` و `errors: 0` و پاسخ ۲۰۰
   * برگشت. از دید مالک «دکمه را زدم و هیچ اتفاقی نیفتاد» — بدون هیچ سرنخی که
   * مشکل از شهر است، از تگ‌های بازار، یا از در دسترس نبودن سرویس.
   */
  notes: string[];
  leadIds: string[];
};

/**
 * بودجه‌ی زمانی کل کشف.
 *
 * تابع Vercel سقف ۶۰ ثانیه دارد و کشف سه بخش کند دارد که پشت‌سرهم اجرا
 * می‌شوند: Overpass (تا ۳۰ ثانیه)، جست‌وجوی وب (تا ۸ × ۱۵ ثانیه) و خواندن
 * سایت‌ها (تا ۲ صفحه × ۶ ثانیه برای هر لید). جمعشان به‌راحتی از ۶۰ رد می‌شود.
 *
 * با این بودجه، هر بخش قبل از شروعِ کارِ تازه مهلت را چک می‌کند و کشف با
 * نتیجه‌ی **ناقص ولی ذخیره‌شده** تمام می‌شود، نه با تایم‌اوت و از دست رفتن
 * همه‌چیز. ۴۵ ثانیه انتخاب شده تا برای درج در دیتابیس و ثبت لاگ جا بماند.
 */
const DISCOVERY_BUDGET_MS = EXTRACTION.budgetMs;

/**
 * سهم **تضمین‌شده‌ی** استخراج کانال‌ها از بودجه.
 *
 * چرا لازم شد: بعد از موازی‌کردن منابع، هر دو تا نزدیک مهلت کار می‌کردند و
 * برای خواندن سایت‌ها چیزی نمی‌ماند. نتیجه در تست زنده: `skipHtml` روشن شد،
 * لیدها بدون راه تماس ماندند و **۷ از ۸ لید نامعتبر رد شدند** — یعنی کشف
 * موفق بود ولی خروجی‌اش تقریباً صفر.
 *
 * حالا منابع فقط تا `deadlineAt - EXTRACTION_RESERVE_MS` وقت دارند و بقیه
 * دست‌نخورده برای استخراج می‌ماند. لیدِ بدون راه تماس اصلاً به درد نمی‌خورد،
 * پس این سهم از خودِ کشف مهم‌تر است.
 */
const EXTRACTION_RESERVE_MS = EXTRACTION.reserveMs;

export async function runDiscovery(campaignId: string): Promise<DiscoverySummary> {
  const started = Date.now();
  const deadlineAt = started + DISCOVERY_BUDGET_MS;
  const sourceDeadlineAt = deadlineAt - EXTRACTION_RESERVE_MS;
  const timeLeft = () => deadlineAt - Date.now();
  const store = getStore();

  const campaign = await store.getCampaign(campaignId);
  if (!campaign) throw new Error("کمپین یافت نشد.");

  const market = getMarket(campaign.market);
  const limit = campaign.dailyDiscoveryLimit;
  const useGoogle = isPlacesConfigured();
  const source: DiscoverySource = useGoogle ? "google_places" : "openstreetmap";

  /*
    ۰) مکان‌نمای پیشرفت — «اجرای قبل تا کجا رفت».

    مکان‌نمای بی‌اعتبار **دور ریخته می‌شود، نه وصله**: اگر شهر یا بازار کمپین
    عوض شده باشد، اندیس کاشی و اندیس نقشه به فضای جست‌وجوی دیگری اشاره می‌کنند
    و ادامه‌دادنشان یعنی بی‌صدا پریدن از روی نیمی از شهر جدید.
  */
  const storedCursor = await store.getDiscoveryCursor(campaignId);
  const cursorValid =
    storedCursor?.v === 1 &&
    storedCursor.city === campaign.city &&
    storedCursor.market === campaign.market;
  const cursor: DiscoveryCursor = cursorValid
    ? storedCursor!
    : {
        v: 1,
        city: campaign.city,
        market: campaign.market,
        bbox: null,
        osmTile: 0,
        webPlan: 0,
        placesTermIndex: 0,
        placesPageToken: null,
        googleSearchIndex: 0,
        laps: 0,
        lastRunAt: null,
      };

  /*
    مسیر سازگاری: اگر ستون مکان‌نما هنوز ساخته نشده (مهاجرت ۷ اجرا نشده)،
    پیشرفت را از **تعداد اجراهای قبلیِ کشفِ همین کمپین** بازسازی می‌کنیم.
    دقیق نیست (اجرای شکست‌خورده هم شمرده می‌شود) ولی خاصیت اصلی را نگه می‌دارد:
    اجرای N+1 جای دیگری از فضای جست‌وجو را می‌بیند. بعد از اجرای مهاجرت،
    `storedCursor` دیگر null نیست و این شاخه خودبه‌خود خاموش می‌شود.
  */
  if (!storedCursor) {
    try {
      const priorRuns = await store.listAgentRunsBetween({ campaignId, limit: 200 });
      const n = priorRuns.filter((r) => r.agentName === "discovery").length;
      if (n > 0) {
        cursor.osmTile = n * OSM.tilesPerRun;
        cursor.webPlan = n * WEB_SEARCH.maxSearchesPerRun;
        cursor.googleSearchIndex = n * GOOGLE_SEARCH.maxSearchesPerRun;
      }
    } catch {
      /* تخمین پیشرفت اختیاری است — نبودش کشف را نمی‌شکند */
    }
  }

  const summary: DiscoverySummary = {
    campaignId,
    source,
    query: `${marketLabel(campaign.market)} — ${campaign.city}`,
    found: 0,
    inserted: 0,
    duplicates: 0,
    invalid: 0,
    errors: 0,
    webSearches: 0,
    webLeads: 0,
    googleSearches: 0,
    alreadyKnown: 0,
    knownTrashed: 0,
    duplicatesInRun: 0,
    fresh: 0,
    raceDuplicates: 0,
    rejectReasons: {},
    extractionFailures: {},
    notes: [],
    leadIds: [],
  };

  /** شمارنده‌ی تجمیعی — کلید تکراری را جمع می‌زند */
  const bump = (m: Record<string, number>, key: string) => {
    m[key] = (m[key] ?? 0) + 1;
  };

  /**
   * ارقام لاتین → فارسی. `notes` مستقیم در نوار اعلان استودیو نمایش داده می‌شود
   * و `fa()` سمت کلاینت فقط روی اعداد ساختاریِ summary اعمال می‌شود، نه روی متن
   * یادداشت‌ها — پس تبدیل باید همین‌جا انجام شود.
   */
  const fa = (n: number | string) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);

  /*
    ۱) جمع‌آوری از منابع — **موازی، نه پشت‌سرهم**.

    قبلاً منبع نقشه اول کامل می‌شد و بعد نوبت جست‌وجوی وب می‌رسید. با اضافه‌شدن
    بودجه‌ی زمانی، این ترتیب یک عارضه‌ی واقعی ساخت که در تست زنده دیده شد: وقتی
    Overpass کند بود (~۳۵ ثانیه)، مهلت باقی‌مانده زیر آستانه می‌افتاد و
    **Tavily اصلاً اجرا نمی‌شد** (`webSearches: 0`). یعنی گاردی که برای
    جلوگیری از تایم‌اوت گذاشته شده بود، منبع دوم را قربانی می‌کرد.

    دو منبع کاملاً مستقل و هر دو I/O شبکه‌اند؛ اجرای موازی هم زمان کل را
    تقریباً نصف می‌کند و هم گرسنگی را حذف می‌کند.

    allSettled: شکست یک منبع نباید منبع دیگر را از بین ببرد.
  */
  /*
    چند نامزد جمع کنیم؟ **بیشتر از سقف روزانه، و عمداً.**

    از این پس فیلترِ «این را از قبل می‌شناسیم» پیش از برش سقف اجرا می‌شود. اگر
    فقط `limit` نامزد جمع کنیم، بعد از فیلتر ممکن است صفر تازه بماند و کشف
    دست‌خالی برگردد — یعنی همان باگ با لباس تازه.
  */
  const want = limit * DISCOVERY.candidateMultiplier;

  const mapSource = async (): Promise<{
    places: DiscoveredPlace[];
    osm?: Awaited<ReturnType<typeof discoverViaOsm>>;
    placesTermIndex?: number;
    placesPageToken?: string | null;
  }> => {
    if (!useGoogle) {
      const r = await discoverViaOsm(osmTagsFor(campaign.market), campaign.city, {
        startTile: cursor.osmTile,
        want,
        bbox: cursor.bbox,
        deadlineAt: sourceDeadlineAt,
      });
      return { places: r.places, osm: r };
    }
    /*
      Google Places با صفحه‌بندی ماندگار.

      `nextPageToken` از قبل هم برمی‌گشت ولی دور ریخته می‌شد، پس صفحه‌ی ۲ به
      بعدِ هیچ عبارتی هرگز دیده نشد. توکن بین دو اجرا ذخیره می‌شود، ولی گوگل
      عمرش را تضمین نمی‌کند: توکن کهنه یعنی خطا، و آن حالت **خطای کشف نیست** —
      توکن دور ریخته می‌شود و از عبارت بعدی ادامه می‌دهیم. چیزی که واقعاً
      قابل‌اتکاست جلورفتنِ اندیس عبارت است، نه توکن.
    */
    const terms = queryTermsFor(campaign.market);
    const out: DiscoveredPlace[] = [];
    const seen = new Set<string>();
    let termIdx = cursor.placesTermIndex % Math.max(1, terms.length);
    let token: string | null = cursor.placesPageToken;
    let consumedTerms = 0;

    for (; consumedTerms < terms.length; consumedTerms++) {
      if (out.length >= want || Date.now() >= sourceDeadlineAt) break;
      const term = terms[(termIdx + consumedTerms) % terms.length];
      for (let page = 0; page < PLACES.maxPagesPerRun; page++) {
        if (out.length >= want || Date.now() >= sourceDeadlineAt) break;
        try {
          const res = await textSearch(term, campaign.city, {
            max: Math.min(20, want - out.length),
            ...(token ? { pageToken: token } : {}),
          });
          for (const p of res.places) {
            if (p.placeId && !seen.has(p.placeId)) {
              seen.add(p.placeId);
              out.push(p);
            }
          }
          token = res.nextPageToken ?? null;
          if (!token) break;
        } catch {
          summary.errors++;
          token = null; // توکن کهنه: رهایش کن و برو عبارت بعدی
          break;
        }
      }
    }
    return {
      places: out,
      placesTermIndex: (termIdx + consumedTerms) % Math.max(1, terms.length),
      placesPageToken: token,
    };
  };

  const webSource = async () => {
    if (!isWebSearchConfigured()) {
      return {
        places: [] as DiscoveredPlace[],
        searchesUsed: 0,
        nextIndex: cursor.webPlan,
        planLength: 0,
        wrapped: false,
      };
    }
    return discoverViaWebSearch(
      queryTermsFor(campaign.market),
      campaign.city,
      Math.min(want, WEB_SEARCH.maxLeadsPerRun),
      sourceDeadlineAt,
      cursor.webPlan
    );
  };

  const googleSource = async () => {
    if (!isGoogleSearchConfigured()) {
      return {
        places: [] as DiscoveredPlace[],
        searchesUsed: 0,
        nextIndex: cursor.googleSearchIndex,
        planLength: 0,
        wrapped: false,
      };
    }
    return discoverViaGoogleSearch(
      queryTermsFor(campaign.market),
      campaign.city,
      Math.min(want, GOOGLE_SEARCH.maxLeadsPerRun),
      sourceDeadlineAt,
      cursor.googleSearchIndex
    );
  };

  const [mapRes, webRes, gRes] = await Promise.allSettled([
    mapSource(),
    webSource(),
    googleSource(),
  ]);

  /*
    ادغام با **کلید یکتاسازی**، نه با placeId.

    قبلاً `pushUnique` روی `placeId` مقایسه می‌کرد. کلیدهای placeId منبع‌محورند
    (`osm:node/…` در برابر `web:site:…`), پس یک کسب‌وکار که هم در OSM و هم در
    نتیجه‌ی جست‌وجوی وب بود، **دو نامزد جدا** می‌شد و دو اسلات از سقف روزانه
    می‌خورد. کلید یکتاسازی دامنه‌محور است و همان‌جا ادغامشان می‌کند.

    کلید یک‌بار از داده‌ی خودِ منبع حساب و تا لحظه‌ی درج فریز می‌شود — همان
    کلیدی که با آن فیلتر کردیم باید همان کلیدی باشد که با آن درج می‌کنیم،
    وگرنه نامزدی که «تازه» تشخیص داده‌ایم ممکن است زیر کلید دیگری تکراری باشد.
  */
  type Candidate = { place: DiscoveredPlace; key: string };
  const keyOf = (p: DiscoveredPlace) =>
    computeDedupKey({
      businessName: p.name,
      phone: p.phone,
      website: p.website,
      placeId: p.placeId,
      city: campaign.city,
      channels: p.seedChannels ?? {},
      businessStatus: p.businessStatus,
    });

  const candidates: Candidate[] = [];
  const seenKeysInRun = new Set<string>();
  const pushUnique = (p: DiscoveredPlace, fromWeb: boolean) => {
    const key = keyOf(p);
    if (seenKeysInRun.has(key)) {
      summary.duplicatesInRun++;
      return;
    }
    seenKeysInRun.add(key);
    candidates.push({ place: p, key });
    if (fromWeb) summary.webLeads++;
  };

  let osmInfo: Awaited<ReturnType<typeof discoverViaOsm>> | null = null;
  let nextPlacesTerm = cursor.placesTermIndex;
  let nextPlacesToken = cursor.placesPageToken;

  if (mapRes.status === "fulfilled") {
    for (const p of mapRes.value.places) pushUnique(p, false);
    osmInfo = mapRes.value.osm ?? null;
    if (mapRes.value.placesTermIndex !== undefined) nextPlacesTerm = mapRes.value.placesTermIndex;
    if (mapRes.value.placesPageToken !== undefined) nextPlacesToken = mapRes.value.placesPageToken;
  } else {
    summary.errors++;
    summary.notes.push(
      `منبع نقشه ناموفق بود: ${
        mapRes.reason instanceof Error ? mapRes.reason.message : String(mapRes.reason)
      }`
    );
  }

  let nextWebPlan = cursor.webPlan;
  let webWrapped = false;
  if (webRes.status === "fulfilled") {
    summary.webSearches = webRes.value.searchesUsed;
    nextWebPlan = webRes.value.nextIndex;
    webWrapped = webRes.value.wrapped;
    for (const p of webRes.value.places) pushUnique(p, true);
  } else {
    summary.errors++;
    summary.notes.push("جست‌وجوی وب ناموفق بود.");
  }

  let nextGoogleIndex = cursor.googleSearchIndex;
  if (gRes.status === "fulfilled") {
    summary.googleSearches = gRes.value.searchesUsed;
    nextGoogleIndex = gRes.value.nextIndex;
    for (const p of gRes.value.places) pushUnique(p, true);
  } else {
    summary.errors++;
    summary.notes.push("جست‌وجوی گوگل ناموفق بود.");
  }

  summary.found = candidates.length;

  /*
    ۱-ب) **فیلتر «از قبل می‌شناسیم» — پیش از مرتب‌سازی و پیش از برش.**

    این هسته‌ی رفع باگ است. تا امروز `slice(0, limit)` اول اجرا می‌شد و بررسی
    تکراری‌بودن ۸۰ خط پایین‌تر. یعنی ۲۰ اسلات روزانه را همان ۲۰ کسب‌وکارِ
    از قبل شناخته‌شده پر می‌کردند و ~۶۰ نامزد دیگر **دیده‌نشده** دور ریخته
    می‌شدند. مالک هر بار «۲۰ تکراری، ۰ تازه» می‌دید.

    یک رفت‌وبرگشت دسته‌ای به‌جای N کوئری سریالی — که در بودجه‌ی ۴۵ ثانیه‌ای
    روی ۸۰ نامزد اصلاً جا نمی‌شد.
  */
  const known = await store.findExistingDedupKeys(candidates.map((c) => c.key));
  const freshPool = candidates.filter(({ key }) => {
    const hit = known.get(key);
    if (!hit) return true;
    summary.alreadyKnown++;
    if (hit.deletedAt) summary.knownTrashed++;
    return false;
  });
  summary.fresh = freshPool.length;
  summary.duplicates = summary.alreadyKnown + summary.duplicatesInRun;

  /*
    ۱-پ) مرتب‌سازی استخر تازه.

    tiebreak روی placeId عمدی است: بدون آن، نامزدهای هم‌امتیاز به ترتیب ورودِ
    منابع می‌مانند که به زمان‌بندی شبکه وابسته است. یعنی دو اجرا با داده‌ی
    یکسان می‌توانستند ۲۰ تای متفاوتی انتخاب کنند و بازتولید باگ غیرممکن شود.
  */
  // امتیاز یک‌بار حساب می‌شود، نه داخل مقایسه‌گر: مقایسه‌گر O(n log n) بار صدا
  // زده می‌شود و preRankPlace روی چند آرایه پیمایش می‌کند.
  const rank = new Map(freshPool.map((c) => [c.place.placeId, preRankPlace(c.place)]));
  freshPool.sort((a, b) => {
    const d = (rank.get(b.place.placeId) ?? 0) - (rank.get(a.place.placeId) ?? 0);
    return d !== 0 ? d : a.place.placeId.localeCompare(b.place.placeId);
  });

  // ۲) استخراج کانال‌ها به‌صورت موازی و دسته‌ای (تا در محیط serverless معلق نماند)
  const igOn = isInstagramConfigured();
  const chosen = freshPool.slice(0, limit);
  const target = chosen.map((c) => c.place);
  const keyByPlaceId = new Map(chosen.map((c) => [c.place.placeId, c.key]));

  type Prepared = {
    place: DiscoveredPlace;
    candidate: LeadCandidate;
    extracted: Awaited<ReturnType<typeof extractContactChannels>>;
    /** سایتی که فقط از اینستاگرام درآمد — عمداً بیرون از کلید یکتاسازی */
    igWebsite: string | null;
  };
  const prepared: Prepared[] = [];

  /*
    همزمانی از config می‌آید و عمداً پایین است.

    اندازه‌گیری روی ۷۱ سایت واقعی: با ۱۰ درخواست هم‌زمان فقط ۴ تا جواب گرفتند،
    با ۳ تا ۳۹ تا. موازی‌سازی زیاد روی لینک باریک، خودِ درخواست‌ها را خفه می‌کند
    و همه با تایم‌اوت برمی‌گردند — که بعد به‌اشتباه «سایت خراب است» تفسیر می‌شد.
  */
  const CONCURRENCY = EXTRACTION.concurrency;
  for (let i = 0; i < target.length; i += CONCURRENCY) {
    // اگر وقت تمام شد، بقیه‌ی لیدها **بدون** خواندن سایتشان پردازش می‌شوند:
    // کانال‌های پایه (تلفن/ایمیل از تگ‌های OSM) را دارند، فقط غنی‌سازی از
    // صفحه‌ی وب انجام نمی‌شود. لید ناقص خیلی بهتر از لید ازدست‌رفته است.
    const skipHtml = timeLeft() < EXTRACTION.pageTimeoutMs + 2_000;
    const batch = target.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p): Promise<Prepared | null> => {
        try {
          const extracted = await extractContactChannels({
            skipHtml,
            // مسیر جایگزین (گونه‌ی www) فقط اگر بودجه اجازه دهد امتحان می‌شود
            deadlineAt,
            website: p.website,
            phone: p.phone,
            instagramHandle: p.instagramHandle ?? null,
            seedChannels: p.seedChannels,
            priority: CHANNEL_PRIORITY,
          });
          for (const step of extracted.trace) {
            // «مسیری که ورودی نداشت» شکست نیست؛ فقط شکست واقعی شمرده می‌شود
            if (!step.ok && step.reason && step.reason !== "no_input") {
              bump(summary.extractionFailures, `${step.path}:${step.reason}`);
            }
          }
          /*
            غنی‌سازی اختیاری اینستاگرام (best-effort؛ فقط اگر هندل و کلید باشد).

            ⚠️ عمداً `p.website` را **نمی‌نویسد**. قبلاً می‌نوشت و این یک باگ
            واقعی می‌ساخت: `computeDedupKey` دامنه را بر `placeId` مقدم
            می‌داند، پس همان کسب‌وکار وقتی IG جواب می‌داد کلید `site:…` و
            وقتی جواب نمی‌داد کلید `place:…` می‌گرفت. اینستاگرام یک وابستگی
            بیرونی ناپایدار است، پس یک کسب‌وکار بین دو اجرا کلید عوض می‌کرد و
            **دوباره درج می‌شد**.

            بهایش: لیدی که فقط از اینستاگرام آمده با نسخه‌ی OSM همان کسب‌وکار
            ادغام نمی‌شود. در عوض هیچ‌وقت به‌خاطر در دسترس نبودن یک API بیرونی
            دو ردیف نمی‌سازد. تکرارپذیری بر ادغامِ شانسی مقدم است.
          */
          let igWebsite: string | null = null;
          if (igOn && extracted.instagramHandle) {
            const ig = await businessDiscovery(extracted.instagramHandle);
            if (ig?.website && !p.website) igWebsite = ig.website;
          }
          const candidate: LeadCandidate = {
            businessName: p.name,
            phone: p.phone,
            website: p.website,
            placeId: p.placeId,
            city: campaign.city,
            channels: extracted.channels,
            businessStatus: p.businessStatus,
          };
          return { place: p, candidate, extracted, igWebsite };
        } catch {
          summary.errors++;
          return null;
        }
      })
    );
    for (const r of results) if (r) prepared.push(r);
  }

  // ۳) اعتبارسنجی + حذف تکراری (درون‌اجرا و دیتابیس) + درج — سریالی و سریع
  //
  // نام همه‌ی نامزدها لازم است تا affluence بتواند چندشعبه‌ای‌بودن را ببیند.
  const allNames = prepared.map((x) => x.place.name);
  const seenKeys = new Set<string>();
  for (const { place: p, candidate, extracted, igWebsite } of prepared) {
    const check = validateCandidate(candidate);
    if (!check.valid) {
      summary.invalid++;
      for (const r of check.reasons) bump(summary.rejectReasons, r);
      continue;
    }
    /*
      کلید **همانی است که با آن فیلتر کردیم**، نه محاسبه‌ی دوباره.

      اگر اینجا دوباره حساب می‌شد، استخراج کانال‌ها (که ممکن است سایت یا تلفن
      تازه‌ای پیدا کرده باشد) کلید را جابه‌جا می‌کرد و نامزدی که «تازه» تشخیص
      داده بودیم زیر کلید دیگری تکراری می‌شد — یا بدتر، ردیف دوم می‌ساخت.
    */
    const dedupKey = keyByPlaceId.get(p.placeId) ?? computeDedupKey(candidate);
    if (seenKeys.has(dedupKey)) {
      summary.duplicatesInRun++;
      summary.duplicates++;
      continue;
    }
    seenKeys.add(dedupKey);
    /*
      گاردِ کمربند و ساسپندر: پیش‌فیلتر بالا این کلید را «تازه» دیده بود، ولی
      بین آن لحظه و اینجا ممکن است ورود CSV یا اجرای هم‌زمانی چیزی درج کرده
      باشد. اگر این گارد چیزی بگیرد یعنی پیش‌فیلتر و درج با هم اختلاف دارند —
      پس جدا شمرده می‌شود تا در گزارش دیده شود، نه اینکه بی‌صدا رد شود.
    */
    const existing = await store.findLeadByDedupKey(dedupKey);
    if (existing) {
      summary.alreadyKnown++;
      summary.duplicates++;
      summary.raceDuplicates++;
      continue;
    }

    const now = new Date().toISOString();
    const lead: Lead = {
      id: randomUUID(),
      campaignId,
      businessName: p.name,
      industry: p.typeLabel ?? market?.title ?? null,
      city: campaign.city,
      address: p.address,
      phone: p.phone,
      // سایتِ اینستاگرام فقط اینجا می‌نشیند — نه در کلید یکتاسازی (بالاتر شرحش هست)
      website: p.website ?? igWebsite,
      instagramHandle: extracted.instagramHandle,
      contactChannels: extracted.channels,
      preferredChannel: extracted.preferredChannel,
      source: p.source ?? source,
      sourceUrl: p.mapsUri ?? p.website ?? igWebsite,
      placeId: p.placeId,
      rating: p.rating,
      reviewsCount: p.reviewsCount,
      status: "NEW",
      score: null,
      confidence: null,
      affluenceScore: null, // چند خط پایین‌تر محاسبه می‌شود (به خود lead نیاز دارد)
      affluenceSignals: [],
      igNote: null,
      igNoteAt: null,
      shortlisted: false,
      shortlistedAt: null,
      doNotContact: false,
      dedupKey,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedBatch: null,
    };
    // تخمین توان مالی — صفر توکن، از همان داده‌ی عمومی که همین حالا داریم.
    // اینجا محاسبه می‌شود (نه بعداً) تا صف لیدها از همان لحظه‌ی کشف مرتب باشد.
    const aff = scoreAffluence(lead, { siblingNames: allNames });
    lead.affluenceScore = aff.score;
    lead.affluenceSignals = aff.signals;

    await store.createLead(lead);
    summary.inserted++;
    summary.leadIds.push(lead.id);
  }

  /*
    ۳-الف) ذخیره‌ی مکان‌نما — تا اجرای بعدی از همین‌جا ادامه دهد.

    هیچ قفلی روی این نیست: کشف یک دکمه است که یک نفر می‌زند. اگر روزی دو اجرای
    هم‌زمان شد، آخری برنده می‌شود و پیشرفت یکی از دو اجرا گم می‌شود — که در
    بدترین حالت یعنی چند کاشی دوباره گشته می‌شوند، نه اینکه چیزی خراب شود.
  */
  const lapAdvanced = (osmInfo?.wrapped ?? false) || webWrapped;
  const cursorSaved = await store.saveDiscoveryCursor(campaignId, {
    ...cursor,
    bbox: osmInfo?.bbox ?? cursor.bbox,
    osmTile: osmInfo?.nextTile ?? cursor.osmTile,
    webPlan: nextWebPlan,
    placesTermIndex: nextPlacesTerm,
    placesPageToken: nextPlacesToken,
    googleSearchIndex: nextGoogleIndex,
    laps: cursor.laps + (lapAdvanced ? 1 : 0),
    lastRunAt: new Date().toISOString(),
  });
  if (!cursorSaved) {
    summary.notes.push(
      "مکان‌نمای کشف ذخیره نشد — مهاجرت ۰۰۷ هنوز اجرا نشده. تا آن موقع پیشرفت از " +
        "روی تعداد اجراهای قبلی تخمین زده می‌شود و ممکن است بعضی بخش‌ها دو بار گشته شوند."
    );
  }

  /*
    شکست Overpass **باید دیده شود**.

    در چهار اجرای پیاپی روی پروداکشن، منبع نقشه صفر نتیجه داد و `errors: 0`
    گزارش شد، چون شکست کوئری به آرایه‌ی خالی تبدیل می‌شد. نتیجه‌اش این بود که
    کشف روی ۲۰ آدرس خام جست‌وجوی وب می‌ماند — و چون آن‌ها فقط URL‌اند و باید
    سایتشان خوانده شود، ۱۲ تا ۱۶ تای‌شان بدون راه تماس رد می‌شدند. مالک عدد
    «۱۶ نامعتبر» را می‌دید و علت واقعی (نقشه اصلاً جواب نداده) هیچ‌جا نبود.
  */
  if (osmInfo && osmInfo.tilesFailed > 0) {
    summary.notes.push(
      `منبع نقشه (Overpass) به ${fa(osmInfo.tilesFailed)} کاشی جواب نداد` +
        (osmInfo.tilesQueried === 0
          ? " — این اجرا هیچ نتیجه‌ای از نقشه نداشت و فقط به جست‌وجوی وب تکیه کرد،" +
            " که چون نتایجش فقط آدرس سایت‌اند، نرخ ردشدن بالا می‌رود."
          : ".") +
        " این کاشی‌ها رد نشدند و اجرای بعد دوباره سراغشان می‌رود؛ چند دقیقه بعد دوباره «کشف لید» را بزن."
    );
  }

  // پوشش این اجرا — بدون این، «۰ لید تازه» از «کل شهر را گشتیم» قابل تفکیک نیست
  const coverage: string[] = [];
  if (osmInfo && osmInfo.tilesQueried > 0) {
    /*
      بازه بر اساس کاشی‌های **امتحان‌شده** نوشته می‌شود، نه فقط موفق‌ها.
      اگر کاشی وسط شکست بخورد، `tilesQueried` تنها تعداد موفق‌هاست و نوشتن
      «کاشی‌های ۱ تا ۲» وقتی ۱ و ۳ گشته شده‌اند، گزارش را نادرست می‌کند.
    */
    const attempted = osmInfo.tilesQueried + osmInfo.tilesFailed;
    const from = cursor.osmTile + 1;
    const to = cursor.osmTile + attempted;
    const answered =
      osmInfo.tilesFailed > 0 ? ` (${fa(osmInfo.tilesQueried)} تا جواب داد)` : "";
    coverage.push(
      `کاشی‌های ${fa(from)} تا ${fa(to)} از ${fa(osmInfo.tileCount)} مرز شهر${answered}`
    );
  }
  if (summary.webSearches > 0 && webRes.status === "fulfilled" && webRes.value.planLength > 0) {
    // دور زدن نقشه باید در متن دیده شود، وگرنه «جست‌وجوهای ۵۷ تا ۶۴ از ۶۰»
    // می‌نویسد که بی‌معنی است
    const len = webRes.value.planLength;
    const from = (cursor.webPlan % len) + 1;
    const end = cursor.webPlan + summary.webSearches;
    const to = end > len ? `${fa(len)} و از ابتدا تا ${fa(end - len)}` : fa(end);
    coverage.push(`جست‌وجوهای وب ${fa(from)} تا ${to} از ${fa(len)}`);
  }
  if (coverage.length > 0) {
    summary.notes.push(`این اجرا ${coverage.join(" و ")} را پوشش داد.`);
  }
  if (lapAdvanced) {
    summary.notes.push(
      `یک دور کامل فضای جست‌وجو تمام شد (دور ${fa(cursor.laps + 1)}). ` +
        "از این پس فقط کسب‌وکارهایی اضافه می‌شوند که تازه در منابع ثبت شده باشند."
    );
  }

  /*
    ۳-ب) تشخیص «چرا چیزی پیدا نشد».

    بدون این، خروجی `found: 0, errors: 0` بود و مالک فقط می‌دید دکمه را زده و
    هیچ اتفاقی نیفتاده. علت‌های واقعی کاملاً متفاوت‌اند و راه‌حلشان هم فرق دارد.
  */
  if (summary.found === 0) {
    summary.notes.push(
      `هیچ کسب‌وکاری پیدا نشد. محتمل‌ترین علت‌ها: نام شهر «${campaign.city}» روی نقشه شناخته نشد، ` +
        `یا برای بازار «${marketLabel(campaign.market)}» در این شهر داده‌ی ثبت‌شده‌ای نیست.`
    );
    /*
      وضعیت منابع — بر اساس **نتیجه‌ی همین اجرا**، نه وجود متغیر محیطی.

      نسخه‌ی اول این بلوک فقط می‌گفت کلید هست یا نه و بر آن اساس «فعال»
      می‌نوشت. این دقیقاً همان اشتباهی است که در `doctor` ابزار Agent-Reach دیده
      شد: کانال وبش را ✅ گزارش می‌کرد در حالی که هر درخواست ۴۰۱ برمی‌گرداند —
      چون تابع check اصلاً چیزی را امتحان نمی‌کرد. گزارش سبزِ نادرست از نبودِ
      گزارش بدتر است، چون جست‌وجوی علت را به مسیر غلط می‌برد.

      پس اینجا فقط چیزی گزارش می‌شود که در همین اجرا مشاهده شده: منبع نقشه چه
      چیزی برگرداند، چند جست‌وجوی وب واقعاً مصرف شد و چند نتیجه داد.
    */
    const mapObserved =
      mapRes.status === "fulfilled"
        ? `${fa(mapRes.value.places.length)} نتیجه` +
          (mapRes.value.osm
            ? ` از ${fa(mapRes.value.osm.tilesQueried)} کاشی` +
              (mapRes.value.osm.tilesFailed > 0
                ? ` (+${fa(mapRes.value.osm.tilesFailed)} کاشی بی‌جواب)`
                : "")
            : "")
        : "اجرا نشد (خطا)";
    const webObserved = !isWebSearchConfigured()
      ? "TAVILY_API_KEY تنظیم نشده"
      : webRes.status === "rejected"
        ? "اجرا نشد (خطا)"
        : `${fa(summary.webSearches)} جست‌وجو، ${fa(webRes.value.places.length)} نتیجه`;
    const googleObserved = !isGoogleSearchConfigured()
      ? "GOOGLE_SEARCH_API_KEY تنظیم نشده"
      : gRes.status === "rejected"
        ? "اجرا نشد (خطا)"
        : `${fa(summary.googleSearches)} جست‌وجو، ${fa(gRes.value.places.length)} نتیجه`;
    summary.notes.push(
      `وضعیت منابع در همین اجرا — ` +
        `نقشه (${useGoogle ? "Google Places" : "OpenStreetMap"}): ${mapObserved} · ` +
        `جست‌وجوی گوگل: ${googleObserved} · ` +
        `جست‌وجوی وب: ${webObserved} · ` +
        `اینستاگرام: ${isInstagramConfigured() ? "کلید هست (فقط برای غنی‌سازی)" : "کلید نیست"}.`
    );
  } else if (summary.inserted === 0) {
    summary.notes.push(
      `${fa(summary.found)} کسب‌وکار پیدا شد ولی هیچ‌کدام تازه نبودند ` +
        `(${fa(summary.duplicates)} تکراری، ${fa(summary.invalid)} بدون راه تماس معتبر).`
    );
  } else if (summary.invalid > summary.inserted) {
    // در تست زنده ۷ از ۸ لید بی‌صدا رد شدند؛ بدون این هشدار، مالک فقط
    // «۱ لید جدید» می‌دید و نمی‌فهمید چرا این‌قدر کم است.
    summary.notes.push(`${fa(summary.invalid)} کسب‌وکار در اعتبارسنجی رد شدند.`);
  }

  /*
    ۳-ج) دلیل واقعی رد شدن — نه حدس.

    قبلاً اینجا نوشته می‌شد «احتمالاً سایت‌هایشان باز نشده‌اند». آن «احتمالاً»
    بی‌دلیل بود: `validateCandidate` و مسیرهای استخراج هر دو دلیل دقیق را
    برمی‌گردانند. تفاوتش عملی است — «تایم‌اوت» یعنی بودجه کم است، «دامنه‌ی مرده»
    یعنی منبع داده بی‌کیفیت است، و این دو راه‌حل کاملاً متفاوتی دارند.
  */
  if (Object.keys(summary.rejectReasons).length > 0) {
    const list = Object.entries(summary.rejectReasons)
      .sort((a, b) => b[1] - a[1])
      // دلیل‌های validateCandidate با نقطه تمام می‌شوند؛ اینجا وسط جمله‌اند
      .map(([k, n]) => `${k.replace(/[.،]\s*$/, "")} (${fa(n)})`)
      .join("، ");
    summary.notes.push(`دلیل رد: ${list}.`);
  }
  if (Object.keys(summary.extractionFailures).length > 0) {
    const LABELS: Record<string, string> = {
      timeout: "در مهلت باز نشد",
      network: "دامنه/شبکه جواب نداد",
      http_error: "سرور خطا داد",
      not_html: "محتوای صفحه HTML نبود",
      bad_url: "آدرس سایت نامعتبر بود",
      no_time: "بودجه‌ی زمانی تمام شد",
    };
    const readable = Object.entries(summary.extractionFailures)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, n]) => {
        const [path, reason] = k.split(":");
        return `${path} — ${LABELS[reason] ?? reason} (${fa(n)})`;
      })
      .join("، ");
    summary.notes.push(`شکست خواندن سایت‌ها: ${readable}.`);
  }
  if (Date.now() >= deadlineAt) {
    summary.notes.push(
      "بودجه‌ی زمانی کشف تمام شد؛ نتیجه ناقص است. دوباره «کشف لید» را بزن تا ادامه پیدا کند."
    );
  }

  // ۴) ثبت اجرای کشف (قابل‌دیباگ؛ صفر توکن)
  await store.addAgentRun({
    id: randomUUID(),
    leadId: null,
    // بدون این، رکورد کشف (که leadId ندارد) به هیچ کمپینی قابل‌نسبت‌دادن نبود
    campaignId,
    agentName: "discovery",
    status: summary.errors > 0 && summary.inserted === 0 ? "error" : "done",
    summary: `کشف (${source}) «${summary.query}»: ${summary.found} یافت، ${summary.inserted} جدید، ${summary.duplicates} تکراری، ${summary.invalid} نامعتبر · ${summary.webSearches} جست‌وجوی وب`,
    output: summary,
    tokenInput: 0,
    tokenOutput: 0,
    cost: 0,
    durationMs: Date.now() - started,
    stopReason: "completed",
    errorCode: null,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    deletedBatch: null,
  });

  await recordDecision({
    entityType: "campaign",
    entityId: campaignId,
    action: "discovery.run",
    reason: `کشف لید برای «${campaign.name}»: ${summary.inserted} لید جدید از ${summary.found} یافته (${summary.duplicates} تکراری، ${summary.webSearches} جست‌وجوی وب).`,
    afterData: summary,
  });

  return summary;
}
