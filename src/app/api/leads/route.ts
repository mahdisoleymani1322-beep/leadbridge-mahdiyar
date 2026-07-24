import { NextRequest } from "next/server";
import { getStore, type LeadStatus } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";

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
