import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * سطل زباله — فهرست دسته‌های حذف‌شده و بازگردانی.
 *
 * «خالی‌کردن دائمی» عمداً وجود ندارد: پاک‌کردن واقعیِ یک لید، کلید یکتای
 * `dedup_key` را آزاد می‌کند و کشف بعدی همان کسب‌وکار را دوباره می‌آورد —
 * یعنی همان باگی که کل این مکانیزم برای جلوگیری از آن ساخته شد. چند صد ردیف
 * مرده در این مقیاس هزینه‌ای ندارد.
 */

/** GET /api/trash — دسته‌های حذف‌شده، از جدید به قدیم */
export async function GET(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();
  const batches = await getStore().listTrash(100);
  return Response.json({ batches });
}

/** POST /api/trash — بازگرداندن یک دسته. بدنه: { batch: string } */
export async function POST(req: NextRequest) {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const batch = typeof body.batch === "string" ? body.batch.trim() : "";
  if (!batch) return Response.json({ error: "شناسه‌ی دسته مشخص نشده است." }, { status: 400 });

  try {
    const result = await getStore().restoreBatch(batch);
    const total = Object.values(result.counts).reduce((a, b) => a + (b ?? 0), 0);
    if (total === 0) {
      return Response.json({ error: "این دسته دیگر در سطل زباله نیست." }, { status: 404 });
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "بازگردانی ناموفق بود." },
      { status: 500 }
    );
  }
}
