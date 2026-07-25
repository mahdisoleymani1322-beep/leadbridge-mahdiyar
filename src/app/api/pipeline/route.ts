import { NextRequest } from "next/server";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { isConfigured } from "@/lib/ai";
import { runLeadPipeline } from "@/lib/agents/orchestrator";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/pipeline { leadId } — اجرای خط تولید تحلیل روی یک لید
 * (تحلیل → امتیاز → انتخاب خدمت → انتخاب نمونه‌کار)
 *
 * یا { campaignId, limit } — پردازش دسته‌ای چند لید NEW همان کمپین.
 */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  if (!isConfigured()) {
    return Response.json(
      { error: "OPENROUTER_API_KEY تنظیم نشده — ایجنت‌های تحلیل نیاز به کلید دارند." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));

  try {
    // حالت تکی
    if (typeof body.leadId === "string" && body.leadId) {
      const result = await runLeadPipeline(body.leadId);
      return Response.json({ results: [result] });
    }

    // حالت کمپین — یک لید در هر درخواست پردازش می‌شود.
    //
    // چرا فقط یکی: هر لید ~۳۰ ثانیه (۳ فراخوان مدل) طول می‌کشد و سقف زمان تابع
    // روی Vercel رایگان ۶۰ ثانیه است. پردازش چند لید در یک درخواست → خطای 504.
    // کلاینت این را پشت‌سرهم صدا می‌زند تا هم تایم‌اوت نشود و هم پیشرفت واقعی
    // نمایش دهد. `remaining` تعداد باقی‌مانده پس از این لید است.
    if (typeof body.campaignId === "string" && body.campaignId) {
      const store = getStore();
      const pending = await store.listLeads({
        campaignId: body.campaignId,
        status: "NEW",
        limit: 500,
      });

      if (pending.length === 0) {
        return Response.json({ results: [], processed: 0, remaining: 0 });
      }

      const result = await runLeadPipeline(pending[0].id);
      return Response.json({
        results: [result],
        processed: 1,
        remaining: pending.length - 1,
      });
    }

    return Response.json({ error: "leadId یا campaignId لازم است." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
