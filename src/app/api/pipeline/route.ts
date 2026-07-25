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

    // حالت دسته‌ای — «تحلیل همه‌ی لیدهای کمپین»، دسته‌دسته.
    // گاردریل: سقف هر دسته کوچک است تا (الف) در محدودیت روزانه‌ی مدل رایگان
    // بماند و (ب) از timeout تابع serverless جلوگیری شود. کاربر می‌تواند دوباره
    // بزند تا بقیه هم تحلیل شوند (remaining در پاسخ برمی‌گردد).
    if (typeof body.campaignId === "string" && body.campaignId) {
      const store = getStore();
      const batch = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 5) : 3;

      // فقط لیدهایی که هنوز تحلیل نشده‌اند (NEW)
      const pending = await store.listLeads({
        campaignId: body.campaignId,
        status: "NEW",
        limit: 500,
      });
      const slice = pending.slice(0, batch);

      const results = [];
      for (const lead of slice) {
        results.push(await runLeadPipeline(lead.id));
      }

      return Response.json({
        results,
        processed: results.length,
        remaining: Math.max(pending.length - results.length, 0),
      });
    }

    return Response.json({ error: "leadId یا campaignId لازم است." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
