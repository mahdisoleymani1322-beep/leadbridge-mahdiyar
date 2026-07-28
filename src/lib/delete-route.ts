import "server-only";
import type { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { isStudioAuthorized, unauthorized } from "@/lib/auth";
import type { TrashKind } from "@/lib/store/types";

/**
 * بدنه‌ی مشترک هر روت `DELETE` — پنج روت دقیقاً همین کار را می‌کنند و تنها
 * تفاوتشان `kind` است.
 *
 * چرا یک‌جا: پنج کپی یعنی پنج فرصت برای جاافتادن گیت احراز هویت یا برگرداندن
 * شکل متفاوتی از نتیجه. اینجا هر دو یک بار نوشته می‌شوند.
 *
 * قرارداد بدنه — `{ ids: string[] }` — همان الگوی `PATCH /api/leads` است که از
 * قبل برای فهرست منتخب کار می‌کند: کاربر چند مورد را تیک می‌زند و یک درخواست
 * می‌رود، نه بیست تا که وسطش نیمه‌کاره بماند.
 */
export async function handleBulkDelete(req: NextRequest, kind: TrashKind): Promise<Response> {
  if (!isStudioAuthorized(req)) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((x: unknown) => typeof x === "string" && x.trim())
    : [];
  if (ids.length === 0) {
    return Response.json({ error: "هیچ موردی برای حذف انتخاب نشده است." }, { status: 400 });
  }

  try {
    const result = await getStore().softDelete(kind, ids);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "حذف ناموفق بود." },
      { status: 500 }
    );
  }
}
