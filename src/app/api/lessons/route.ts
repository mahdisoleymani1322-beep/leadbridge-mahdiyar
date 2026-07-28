import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import { handleBulkDelete } from "@/lib/delete-route";

export const dynamic = "force-dynamic";

/**
 * درس‌های آموخته‌شده — خواندن و غیرفعال‌کردن.
 *
 * چرا لازم است: بدون این مسیر، حلقه‌ی خودبهبودی **نامرئی** بود. درس نوشته
 * می‌شد و بی‌سروصدا به پرامپت هر اجرای بعدی تزریق می‌گردید، ولی مالک هیچ راهی
 * نداشت ببیند سیستم چه یاد گرفته — و مهم‌تر، اگر درسِ غلطی ثبت شده بود
 * (مثلاً بازخوردی که بعداً معلوم شد اشتباه بوده) راهی برای پس‌گرفتنش نبود.
 *
 * یک درس بد بی‌صدا روی همه‌ی پیام‌های بعدی اثر می‌گذارد؛ پس امکان حذف، بخشی
 * از خودِ مکانیزم است نه یک قابلیت اضافه.
 */

/** GET /api/lessons?agent= — فهرست درس‌های فعال */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent") || undefined;
  const all = searchParams.get("all") === "1";
  const lessons = await getStore().listLessons({ agent, activeOnly: !all });
  return Response.json({ lessons });
}

/**
 * PATCH /api/lessons { id, active: false } — غیرفعال‌کردن یک درس.
 *
 * درس پاک نمی‌شود بلکه غیرفعال می‌گردد: تاریخچه‌ی اینکه سیستم روزی چه چیزی
 * یاد گرفته بود، خودش داده‌ی باارزشی است.
 */
export async function PATCH(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return Response.json({ error: "id لازم است." }, { status: 400 });
  if (body.active !== false) {
    return Response.json({ error: "فقط غیرفعال‌کردن پشتیبانی می‌شود (active: false)." }, { status: 400 });
  }
  await getStore().deactivateLesson(id);
  return Response.json({ ok: true });
}

/**
 * DELETE — حذف نرم انبوه. بدنه: { ids: string[] }
 * حذف می‌شود: درس آموخته‌شده.
 *
 * ردیف واقعاً پاک نمی‌شود (`deleted_at` می‌گیرد) و از صفحه‌ی سطل زباله قابل
 * بازگرداندن است. دلیلش در `store/types.ts → SoftDeleteFields`.
 */
export async function DELETE(req: NextRequest) {
  return handleBulkDelete(req, "lesson");
}
