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
  leadIds: string[];
};

export async function runDiscovery(campaignId: string): Promise<DiscoverySummary> {
  const started = Date.now();
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
    leadIds: [],
  };

  // ۱) جمع‌آوری کسب‌وکارها از منبع
  let discovered: DiscoveredPlace[] = [];
  if (useGoogle) {
    const terms = queryTermsFor(campaign.market);
    const seen = new Set<string>();
    for (const term of terms) {
      if (discovered.length >= limit) break;
      try {
        const { places } = await textSearch(term, campaign.city, {
          max: Math.min(20, limit - discovered.length),
        });
        for (const p of places) {
          if (p.placeId && !seen.has(p.placeId)) {
            seen.add(p.placeId);
            discovered.push(p);
          }
        }
      } catch {
        summary.errors++;
      }
    }
  } else {
    discovered = await discoverViaOsm(osmTagsFor(campaign.market), campaign.city, limit);
  }

  // منبع مکمل — جست‌وجوی وب، **در همان دکمه‌ی کشف** (نه دکمه‌ی جدا).
  // فقط اگر TAVILY_API_KEY تنظیم شده باشد؛ نتایج با OSM ترکیب می‌شوند.
  if (isWebSearchConfigured()) {
    const web = await discoverViaWebSearch(
      queryTermsFor(campaign.market),
      campaign.city,
      Math.min(limit, WEB_SEARCH.maxLeadsPerRun)
    );
    summary.webSearches = web.searchesUsed;
    const seenIds = new Set(discovered.map((p) => p.placeId));
    for (const wp of web.places) {
      if (!seenIds.has(wp.placeId)) {
        seenIds.add(wp.placeId);
        discovered.push(wp);
        summary.webLeads++;
      }
    }
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
    const batch = target.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p): Promise<Prepared | null> => {
        try {
          const extracted = await extractContactChannels({
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

  // ۴) ثبت اجرای کشف (قابل‌دیباگ؛ صفر توکن)
  await store.addAgentRun({
    id: randomUUID(),
    leadId: null,
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

  return summary;
}
