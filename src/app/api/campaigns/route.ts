import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getStore, type Campaign } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { DEFAULT_CITY, DEFAULT_MARKET_ID, LIMITS, getMarket } from "@/lib/config";
import { SERVICES } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** GET /api/campaigns — فهرست کمپین‌ها */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();
  const campaigns = await getStore().listCampaigns();
  return Response.json({ campaigns });
}

/** POST /api/campaigns — ساخت کمپین جدید (با پیش‌فرض‌های config) */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const market = typeof body.market === "string" && getMarket(body.market) ? body.market : DEFAULT_MARKET_ID;
  const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : DEFAULT_CITY;
  const primaryService =
    typeof body.primaryService === "string" && SERVICES.some((s) => s.id === body.primaryService)
      ? body.primaryService
      : SERVICES[0].id;
  const marketTitle = getMarket(market)?.title ?? market;

  const campaign: Campaign = {
    id: randomUUID(),
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : `${marketTitle} — ${city}`,
    market,
    city,
    primaryService,
    dailyDiscoveryLimit:
      Number.isInteger(body.dailyDiscoveryLimit) && body.dailyDiscoveryLimit > 0
        ? Math.min(body.dailyDiscoveryLimit, 60)
        : LIMITS.dailyDiscovery,
    dailyMessageLimit:
      Number.isInteger(body.dailyMessageLimit) && body.dailyMessageLimit > 0
        ? Math.min(body.dailyMessageLimit, 20)
        : LIMITS.dailyMessage,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  await getStore().createCampaign(campaign);
  return Response.json({ campaign }, { status: 201 });
}
