import "server-only";
import { randomUUID } from "crypto";
import { getStore, type Lead } from "@/lib/store";
import {
  getMarket,
  CHANNEL_PRIORITY,
  marketLabel,
  osmTagsFor,
  queryTermsFor,
  WEB_SEARCH,
} from "@/lib/config";
import { textSearch, isPlacesConfigured } from "@/lib/integrations/google-places";
import { discoverViaOsm } from "@/lib/integrations/openstreetmap";
import { discoverViaWebSearch, isWebSearchConfigured } from "@/lib/integrations/web-search";
import type { DiscoveredPlace } from "@/lib/integrations/types";
import { extractContactChannels } from "@/lib/integrations/contact-channels";
import { businessDiscovery, isInstagramConfigured } from "@/lib/integrations/instagram";
import { computeDedupKey, validateCandidate, type LeadCandidate } from "@/lib/agents/validation";
import { scoreAffluence } from "@/lib/agents/affluence";
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
const DISCOVERY_BUDGET_MS = 45_000;

export async function runDiscovery(campaignId: string): Promise<DiscoverySummary> {
  const started = Date.now();
  const deadlineAt = started + DISCOVERY_BUDGET_MS;
  const timeLeft = () => deadlineAt - Date.now();
  const store = getStore();

  const campaign = await store.getCampaign(campaignId);
  if (!campaign) throw new Error("کمپین یافت نشد.");

  const market = getMarket(campaign.market);
  const limit = campaign.dailyDiscoveryLimit;
  const useGoogle = isPlacesConfigured();
  const source: DiscoverySource = useGoogle ? "google_places" : "openstreetmap";

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
    notes: [],
    leadIds: [],
  };

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
  const mapSource = async (): Promise<DiscoveredPlace[]> => {
    if (!useGoogle) {
      return discoverViaOsm(osmTagsFor(campaign.market), campaign.city, limit);
    }
    const out: DiscoveredPlace[] = [];
    const seen = new Set<string>();
    for (const term of queryTermsFor(campaign.market)) {
      if (out.length >= limit) break;
      if (timeLeft() < 12_000) break;
      try {
        const { places } = await textSearch(term, campaign.city, {
          max: Math.min(20, limit - out.length),
        });
        for (const p of places) {
          if (p.placeId && !seen.has(p.placeId)) {
            seen.add(p.placeId);
            out.push(p);
          }
        }
      } catch {
        summary.errors++;
      }
    }
    return out;
  };

  const webSource = async () => {
    if (!isWebSearchConfigured()) return { places: [] as DiscoveredPlace[], searchesUsed: 0 };
    return discoverViaWebSearch(
      queryTermsFor(campaign.market),
      campaign.city,
      Math.min(limit, WEB_SEARCH.maxLeadsPerRun),
      // ۱۲ ثانیه برای استخراج کانال‌ها و درج در دیتابیس کنار گذاشته می‌شود
      deadlineAt - 12_000
    );
  };

  const [mapRes, webRes] = await Promise.allSettled([mapSource(), webSource()]);

  const discovered: DiscoveredPlace[] = [];
  const seenIds = new Set<string>();
  const pushUnique = (p: DiscoveredPlace, fromWeb: boolean) => {
    if (seenIds.has(p.placeId)) return;
    seenIds.add(p.placeId);
    discovered.push(p);
    if (fromWeb) summary.webLeads++;
  };

  if (mapRes.status === "fulfilled") {
    for (const p of mapRes.value) pushUnique(p, false);
  } else {
    summary.errors++;
    summary.notes.push(
      `منبع نقشه ناموفق بود: ${
        mapRes.reason instanceof Error ? mapRes.reason.message : String(mapRes.reason)
      }`
    );
  }

  if (webRes.status === "fulfilled") {
    summary.webSearches = webRes.value.searchesUsed;
    for (const p of webRes.value.places) pushUnique(p, true);
  } else {
    summary.errors++;
    summary.notes.push("جست‌وجوی وب ناموفق بود.");
  }

  summary.found = discovered.length;

  // ۱-ب) پیش‌مرتب‌سازی بر اساس نشانه‌های توان مالیِ در دسترسِ همین لحظه.
  //
  // چرا اینجا و نه بعد از درج: سقف روزانه (limit) پایین‌تر اعمال می‌شود، پس اگر
  // مرتب نکنیم ممکن است ۲۰ لید ضعیف نگه داریم و گروه صنعتی خوب را دور بریزیم.
  // این مرتب‌سازی فقط از فیلدهای موجودِ DiscoveredPlace استفاده می‌کند
  // (تعداد نظر، دامنه)؛ نمره‌ی کامل بعد از استخراج کانال‌ها محاسبه می‌شود.
  const roughAffluence = (p: DiscoveredPlace) => {
    let s = 0;
    s += Math.min(20, (p.reviewsCount ?? 0) / 10);
    if (p.website) s += 8;
    if (p.rating != null && p.rating >= 4.3) s += 4;
    return s;
  };
  discovered.sort((a, b) => roughAffluence(b) - roughAffluence(a));

  // ۲) استخراج کانال‌ها به‌صورت موازی و دسته‌ای (تا در محیط serverless معلق نماند)
  const igOn = isInstagramConfigured();
  const target = discovered.slice(0, limit);

  type Prepared = {
    place: DiscoveredPlace;
    candidate: LeadCandidate;
    extracted: Awaited<ReturnType<typeof extractContactChannels>>;
  };
  const prepared: Prepared[] = [];

  const CONCURRENCY = 5;
  for (let i = 0; i < target.length; i += CONCURRENCY) {
    // اگر وقت تمام شد، بقیه‌ی لیدها **بدون** خواندن سایتشان پردازش می‌شوند:
    // کانال‌های پایه (تلفن/ایمیل از تگ‌های OSM) را دارند، فقط غنی‌سازی از
    // صفحه‌ی وب انجام نمی‌شود. لید ناقص خیلی بهتر از لید ازدست‌رفته است.
    const skipHtml = timeLeft() < 8_000;
    const batch = target.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p): Promise<Prepared | null> => {
        try {
          const extracted = await extractContactChannels({
            skipHtml,
            website: p.website,
            phone: p.phone,
            instagramHandle: p.instagramHandle ?? null,
            seedChannels: p.seedChannels,
            priority: CHANNEL_PRIORITY,
          });
          // غنی‌سازی اختیاری اینستاگرام (best-effort؛ فقط اگر هندل و کلید باشد)
          if (igOn && extracted.instagramHandle) {
            const ig = await businessDiscovery(extracted.instagramHandle);
            if (ig?.website && !p.website) p.website = ig.website;
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
          return { place: p, candidate, extracted };
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
  for (const { place: p, candidate, extracted } of prepared) {
    const check = validateCandidate(candidate);
    if (!check.valid) {
      summary.invalid++;
      continue;
    }
    const dedupKey = computeDedupKey(candidate);
    if (seenKeys.has(dedupKey)) {
      summary.duplicates++;
      continue;
    }
    seenKeys.add(dedupKey);
    const existing = await store.findLeadByDedupKey(dedupKey);
    if (existing) {
      summary.duplicates++;
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
      website: p.website,
      instagramHandle: extracted.instagramHandle,
      contactChannels: extracted.channels,
      preferredChannel: extracted.preferredChannel,
      source: p.source ?? source,
      sourceUrl: p.mapsUri ?? p.website,
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
    ۳-ب) تشخیص «چرا چیزی پیدا نشد».

    بدون این، خروجی `found: 0, errors: 0` بود و مالک فقط می‌دید دکمه را زده و
    هیچ اتفاقی نیفتاده. علت‌های واقعی کاملاً متفاوت‌اند و راه‌حلشان هم فرق دارد.
  */
  if (summary.found === 0) {
    summary.notes.push(
      `هیچ کسب‌وکاری پیدا نشد. محتمل‌ترین علت‌ها: نام شهر «${campaign.city}» روی نقشه شناخته نشد، ` +
        `یا برای بازار «${marketLabel(campaign.market)}» در این شهر داده‌ی ثبت‌شده‌ای نیست.`
    );
    if (!isWebSearchConfigured()) {
      summary.notes.push("TAVILY_API_KEY تنظیم نشده، پس منبع جست‌وجوی وب هم در دسترس نبود.");
    }
  } else if (summary.inserted === 0) {
    summary.notes.push(
      `${summary.found} کسب‌وکار پیدا شد ولی هیچ‌کدام تازه نبودند ` +
        `(${summary.duplicates} تکراری، ${summary.invalid} بدون راه تماس معتبر).`
    );
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
