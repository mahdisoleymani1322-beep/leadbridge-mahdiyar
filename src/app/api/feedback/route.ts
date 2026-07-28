import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { getStore } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { recordLessonFromHuman } from "@/lib/agents/lesson-writer";

export const dynamic = "force-dynamic";

/**
 * بازخورد انسانی روی کیفیت پیام — دومین منبع خودبهبودی.
 *
 * جدا از `/api/conversations` است و با آن قاطی نمی‌شود:
 *   • این: «پیامی که **ما** نوشتیم چطور بود» → درس برای نویسنده
 *   • آن: «بیزینس چه گفت» → پیگیری و قیف تبدیل
 *
 * جدول `lead_feedback` از فاز ۱ وجود داشت و تا امروز هیچ نویسنده‌ای نداشت.
 */

/** GET /api/feedback?leadId= — بازخوردهای ثبت‌شده */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId") || undefined;
  return Response.json({ feedback: await getStore().listFeedback(leadId) });
}

/**
 * POST /api/feedback { leadId, messageId?, rating: "up"|"down", comment? }
 *
 * بازخورد منفیِ همراه با توضیح، به درس تبدیل می‌شود و از اجرای بعدی به پرامپت
 * نویسنده تزریق می‌گردد. بازخورد مثبت فقط ثبت می‌شود: «خوب بود» چیزی برای
 * اصلاح نمی‌گوید و اضافه‌کردنش به پرامپت فقط توکن خرج می‌کند.
 */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const rating = body.rating === "up" || body.rating === "down" ? body.rating : null;
  if (!leadId || !rating) {
    return Response.json({ error: "leadId و rating (up یا down) لازم است." }, { status: 400 });
  }

  const store = getStore();
  const lead = await store.getLead(leadId);
  if (!lead) return Response.json({ error: "لید یافت نشد." }, { status: 404 });

  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  await store.addFeedback({
    id: randomUUID(),
    leadId,
    messageId: typeof body.messageId === "string" ? body.messageId : null,
    rating,
    comment,
    createdAt: new Date().toISOString(),
  });

  const learned = rating === "down" && comment ? await recordLessonFromHuman("message-writer", comment) : false;

  return Response.json({
    ok: true,
    lessonRecorded: learned,
    note: learned
      ? "بازخورد ثبت شد و به‌عنوان درس به پرامپت نویسنده اضافه شد."
      : rating === "down" && !comment
        ? "بازخورد ثبت شد. برای تبدیل‌شدن به درس، توضیح بنویس."
        : "بازخورد ثبت شد.",
  });
}
