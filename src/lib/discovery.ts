import "server-only";
import { randomUUID } from "crypto";
import { getStore, type Lead } from "@/lib/store";
import { getMarket, CHANNEL_PRIORITY } from "@/lib/config";
import { textSearch, isPlacesConfigured, type PlaceResult } from "@/lib/integrations/google-places";
import { extractContactChannels } from "@/lib/integrations/contact-channels";
import { businessDiscovery, isInstagramConfigured } from "@/lib/integrations/instagram";
import { computeDedupKey, validateCandidate, type LeadCandidate } from "@/lib/agents/validation";

/**
 * جریان کشف لید (کمپین‌محور) — سرویس قطعی، صفر توکن LLM.
 *
 * Places Text Search → استخراج کانال‌های ارتباط (سایت/IG) → حذف تکراری (dedup) →
 * درج لید با status=NEW. هر گام در agent_runs ثبت می‌شود.
 *
 * فقط APIهای رسمی و داده‌ی عمومی. ارسال هیچ پیامی اینجا رخ نمی‌دهد.
 */

export type DiscoverySummary = {
  campaignId: string;
  query: string;
  found: number;
  inserted: number;
  duplicates: number;
  invalid: number;
  errors: number;
  leadIds: string[];
};

export async function runDiscovery(campaignId: string): Promise<DiscoverySummary> {
  const started = Date.now();
  const store = getStore();

  const campaign = await store.getCampaign(campaignId);
  if (!campaign) throw new Error("کمپین یافت نشد.");
  if (!isPlacesConfigured()) {
    throw new Error("GOOGLE_MAPS_API_KEY تنظیم نشده — کشف لید نیاز به کلید Places دارد.");
  }

  const market = getMarket(campaign.market);
  const terms = market?.queryTerms ?? [campaign.market];
  const limit = campaign.dailyDiscoveryLimit;

  const summary: DiscoverySummary = {
    campaignId,
    query: `${terms.join(" | ")} — ${campaign.city}`,
    found: 0,
    inserted: 0,
    duplicates: 0,
    invalid: 0,
    errors: 0,
    leadIds: [],
  };

  // ۱) جمع‌آوری نتایج Places تا سقف روزانه (چند عبارت جست‌وجو)
  const places: PlaceResult[] = [];
  const seenPlaceIds = new Set<string>();
  for (const term of terms) {
    if (places.length >= limit) break;
    try {
      const { places: batch } = await textSearch(term, campaign.city, {
        max: Math.min(20, limit - places.length),
      });
      for (const p of batch) {
        if (p.placeId && !seenPlaceIds.has(p.placeId)) {
          seenPlaceIds.add(p.placeId);
          places.push(p);
        }
      }
    } catch {
      summary.errors++;
    }
  }
  summary.found = places.length;

  // ۲) استخراج کانال‌ها به‌صورت موازی و دسته‌ای (تا در محیط serverless معلق نماند)
  const igOn = isInstagramConfigured();
  const target = places.slice(0, limit);

  type Prepared = { place: PlaceResult; candidate: LeadCandidate; extracted: Awaited<ReturnType<typeof extractContactChannels>> };
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
      source: "google_places",
      sourceUrl: p.mapsUri ?? p.website,
      placeId: p.placeId,
      rating: p.rating,
      reviewsCount: p.reviewsCount,
      status: "NEW",
      score: null,
      confidence: null,
      doNotContact: false,
      dedupKey,
      createdAt: now,
      updatedAt: now,
    };
    await store.createLead(lead);
    summary.inserted++;
    summary.leadIds.push(lead.id);
  }

  // ۳) ثبت اجرای کشف (قابل‌دیباگ؛ صفر توکن)
  await store.addAgentRun({
    id: randomUUID(),
    leadId: null,
    agentName: "discovery",
    status: summary.errors > 0 && summary.inserted === 0 ? "error" : "done",
    summary: `کشف «${summary.query}»: ${summary.found} یافت، ${summary.inserted} جدید، ${summary.duplicates} تکراری، ${summary.invalid} نامعتبر`,
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
