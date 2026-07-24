import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getStore, type Lead, type LeadStatus, type ContactChannels, type ChannelKey } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { CHANNEL_PRIORITY } from "@/lib/config";
import { computeDedupKey } from "@/lib/agents/validation";
import { pickPreferredChannel } from "@/lib/integrations/contact-channels";

export const dynamic = "force-dynamic";

/** GET /api/leads?campaignId=&status=&limit= — فهرست لیدها */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get("campaignId") || undefined;
  const status = (searchParams.get("status") as LeadStatus | null) || undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw && Number.isInteger(Number(limitRaw)) ? Number(limitRaw) : 200;

  const leads = await getStore().listLeads({ campaignId, status, limit });
  return Response.json({ leads });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** ساخت یک لید دستی از ورودی خام (فرم یا CSV) */
function buildManualLead(raw: any, campaignId: string | null): Lead | null {
  const businessName = typeof raw?.businessName === "string" ? raw.businessName.trim() : "";
  if (!businessName) return null;

  const channels: ContactChannels = {};
  const set = (k: ChannelKey, v: unknown) => {
    if (typeof v === "string" && v.trim()) channels[k] = v.trim();
  };
  // اینستاگرام را به شکل @handle نرمال کن
  if (typeof raw.instagram === "string" && raw.instagram.trim()) {
    const m = raw.instagram.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    channels.instagram = "@" + (m ? m[1] : raw.instagram.trim().replace(/^@/, ""));
  }
  set("whatsapp", raw.whatsapp);
  set("telegram", raw.telegram);
  set("email", raw.email);
  set("siteForm", raw.siteForm);
  set("phone", raw.phone);

  const website = typeof raw.website === "string" && raw.website.trim() ? raw.website.trim() : null;
  const phone = channels.phone ?? null;
  const city = typeof raw.city === "string" && raw.city.trim() ? raw.city.trim() : null;
  const dedupKey = computeDedupKey({
    businessName,
    phone,
    website,
    placeId: null,
    city,
    channels,
    businessStatus: null,
  });

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    campaignId,
    businessName,
    industry: typeof raw.industry === "string" ? raw.industry : null,
    city,
    address: typeof raw.address === "string" ? raw.address : null,
    phone,
    website,
    instagramHandle: channels.instagram ?? null,
    contactChannels: channels,
    preferredChannel: pickPreferredChannel(channels, CHANNEL_PRIORITY),
    source: "manual",
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : website,
    placeId: null,
    rating: null,
    reviewsCount: null,
    status: "NEW",
    score: null,
    confidence: null,
    doNotContact: false,
    dedupKey,
    createdAt: now,
    updatedAt: now,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * POST /api/leads — افزودن دستی لید.
 * بدنه: یک لید تکی، یا { leads: [...] } برای انبوه (CSV تبدیل‌شده).
 * فیلدها: businessName (اجباری)، city, industry, instagram, whatsapp, telegram,
 *         email, phone, website, campaignId
 */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : null;
  const items = Array.isArray(body.leads) ? body.leads : [body];

  const store = getStore();
  let inserted = 0;
  let duplicates = 0;
  let invalid = 0;
  const leadIds: string[] = [];
  const seen = new Set<string>();

  for (const raw of items) {
    const lead = buildManualLead(raw, campaignId);
    if (!lead) {
      invalid++;
      continue;
    }
    if (seen.has(lead.dedupKey)) {
      duplicates++;
      continue;
    }
    seen.add(lead.dedupKey);
    const existing = await store.findLeadByDedupKey(lead.dedupKey);
    if (existing) {
      duplicates++;
      continue;
    }
    await store.createLead(lead);
    inserted++;
    leadIds.push(lead.id);
  }

  return Response.json({ inserted, duplicates, invalid, leadIds }, { status: 201 });
}
