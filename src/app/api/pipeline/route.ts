import { NextRequest } from "next/server";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { isConfigured } from "@/lib/ai";
import { runLeadPipeline, runLeadStep } from "@/lib/agents/orchestrator";
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

    // حالت کمپین — **یک گام** در هر درخواست.
    //
    // چرا گام‌به‌گام: اجرای کل یک لید ~۳۵ ثانیه است و درخواست HTTP آن‌قدر باز
    // می‌ماند که شبکه‌های کند/پروکسی قطعش می‌کنند (NetworkError) یا به سقف
    // ۶۰ ثانیه‌ای تابع می‌خورد (504). هر گام ~۱۰ ثانیه است و کلاینت گام‌ها را
    // پشت‌سرهم می‌زند تا همه‌ی لیدها تمام شوند.
    if (typeof body.campaignId === "string" && body.campaignId) {
      const store = getStore();

      // لیدهای نیمه‌تمام اولویت دارند تا کار رهاشده نماند:
      //   SCORED            → گام خدمت/نمونه‌کار مانده
      //   READY_FOR_MESSAGE → گام تولید پیام مانده (فاز ۴)
      // بعد سراغ لید تحلیل‌نشده‌ی بعدی می‌رویم.
      const scored = await store.listLeads({
        campaignId: body.campaignId,
        status: "SCORED",
        limit: 1,
      });
      const readyForMessage = scored.length
        ? []
        : await store.listLeads({
            campaignId: body.campaignId,
            status: "READY_FOR_MESSAGE",
            limit: 1,
          });
      const fresh = await store.listLeads({
        campaignId: body.campaignId,
        status: "NEW",
        limit: 500,
      });

      const target = scored[0] ?? readyForMessage[0] ?? fresh[0];
      if (!target) {
        return Response.json({ step: null, remaining: 0, done: true });
      }

      const step = await runLeadStep(target.id);
      // «باقی‌مانده» = لیدهایی که هنوز تحلیل نشده‌اند (برای نمایش پیشرفت)
      const remaining = step.ran === "analysis" ? fresh.length - 1 : fresh.length;

      return Response.json({
        step,
        businessName: target.businessName,
        remaining,
        done: false,
      });
    }

    return Response.json({ error: "leadId یا campaignId لازم است." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
