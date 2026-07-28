import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { isInstagramConfigured } from "@/lib/integrations/instagram";

export const dynamic = "force-dynamic";

/** GET /api/leads/[id] — جزئیات یک لید + تحلیل + تاریخچه‌ی گام‌ها */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const store = getStore();
  const lead = await store.getLead(params.id);
  if (lead?.deletedAt) return Response.json({ error: "این لید حذف شده است." }, { status: 404 });
  if (!lead) return Response.json({ error: "لید یافت نشد." }, { status: 404 });

  const [analysis, runs] = await Promise.all([
    store.getAnalysis(params.id),
    store.listAgentRuns(params.id, 20),
  ]);

  return Response.json({ lead, analysis, runs, instagramAuto: isInstagramConfigured() });
}

/**
 * PATCH /api/leads/[id] — ثبت یافته‌ی دستی اینستاگرام
 *
 * تحلیل خودکار پیج به IG_ACCESS_TOKEN + IG_BUSINESS_ID نیاز دارد که هنوز ست
 * نشده‌اند. تا آن موقع این مسیر جای رسمی ثبت مشاهده‌ی انسانی است؛ محتوایش
 * مثل «مشاهده‌ی قطعی» وارد پرامپت تحلیل و نویسنده می‌شود.
 *
 * بدنه: { igNote: string }
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  if (typeof body.igNote !== "string") {
    return Response.json({ error: "igNote لازم است." }, { status: 400 });
  }

  const store = getStore();
  const lead = await store.getLead(params.id);
  if (lead?.deletedAt) return Response.json({ error: "این لید حذف شده است." }, { status: 404 });
  if (!lead) return Response.json({ error: "لید یافت نشد." }, { status: 404 });

  const note = body.igNote.trim();
  await store.updateLead(params.id, {
    igNote: note || null,
    igNoteAt: note ? new Date().toISOString() : null,
  });

  return Response.json({ lead: await store.getLead(params.id) });
}
