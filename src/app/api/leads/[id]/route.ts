import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/leads/[id] — جزئیات یک لید + تحلیل + تاریخچه‌ی گام‌ها */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const store = getStore();
  const lead = await store.getLead(params.id);
  if (!lead) return Response.json({ error: "لید یافت نشد." }, { status: 404 });

  const [analysis, runs] = await Promise.all([
    store.getAnalysis(params.id),
    store.listAgentRuns(params.id, 20),
  ]);

  return Response.json({ lead, analysis, runs });
}
