import { NextRequest } from "next/server";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { runDiscovery } from "@/lib/discovery";

export const dynamic = "force-dynamic";
// کشف ممکن است چند ثانیه طول بکشد (چند فراخوان Places + خواندن سایت‌ها)
export const maxDuration = 60;

/** POST /api/discovery { campaignId } — اجرای یک دور کشف لید */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  if (!campaignId) {
    return Response.json({ error: "campaignId لازم است." }, { status: 400 });
  }

  try {
    const summary = await runDiscovery(campaignId);
    return Response.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
