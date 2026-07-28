import "server-only";
import type { NextRequest } from "next/server";

/**
 * محافظ ساده‌ی استودیو:
 * - اگر STUDIO_PASSWORD تنظیم نشده باشد → همه‌چیز باز است (حالت توسعه).
 * - اگر تنظیم شده باشد → کلاینت باید رمز را در هدر x-studio-password بفرستد.
 *
 * برای پروژه‌ی درسی کافی است؛ برای پروداکشن واقعی از session/کوکی امضاشده
 * استفاده کنید (نمونه‌اش در فاز ۲ پیاده شده است).
 */

export function isStudioAuthorized(req: NextRequest): boolean {
  /*
    trim روی هر دو طرف عمدی است.

    مقدار متغیر محیطی خیلی راحت یک `\n` یا `\r\n` انتها می‌گیرد — بسته به
    اینکه با چه ابزاری ست شده باشد. همین یک کاراکترِ نامرئی باعث شد اولین
    بار که رمز ست شد، درخواستِ **با رمز درست** هم ۴۰۱ بگیرد و تشخیصش از
    «رمز غلط» ممکن نباشد. هدر HTTP هم ممکن است فاصله‌ی اضافی داشته باشد.
  */
  const password = process.env.STUDIO_PASSWORD?.trim();
  if (!password) return true;
  return req.headers.get("x-studio-password")?.trim() === password;
}

export function unauthorized(): Response {
  return Response.json({ error: "رمز استودیو نادرست است." }, { status: 401 });
}
