"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

/**
 * احراز هویت سمت کلاینت برای داشبورد — مشترک بین /studio و /studio/crm.
 *
 * چرا این فایل ساخته شد: تا پیش از این، رمز فقط از `localStorage` خوانده می‌شد
 * و **هیچ رابطی برای واردکردنش وجود نداشت**. یعنی اگر STUDIO_PASSWORD روی سرور
 * تنظیم می‌شد، مالک از داشبورد خودش بیرون می‌ماند و تنها راه ورود، تایپ‌کردن
 * دستی در کنسول مرورگر بود. عملاً همین باعث شده بود رمز اصلاً تنظیم نشود و کل
 * سیستم — با نام و تلفن و ایمیل کسب‌وکارها و دکمه‌هایی که سهمیه‌ی مدل را خرج
 * می‌کنند — روی اینترنت باز بماند.
 *
 * این یک session امضاشده نیست و ادعای امنیت قوی هم ندارد؛ یک قفل ساده است که
 * جلوی دسترسی عمومی را می‌گیرد. رمز فقط در همین مرورگر می‌ماند.
 */

const KEY = "studioPassword";

export function readPassword(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

/** هدرهای درخواست — رمز فقط اگر ذخیره شده باشد اضافه می‌شود */
export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const pw = readPassword();
  if (pw) h["x-studio-password"] = pw;
  return h;
}

/** خطای ۴۰۱ که کامپوننت‌ها با آن فرم ورود را نشان می‌دهند */
export class UnauthorizedError extends Error {
  constructor() {
    super("رمز استودیو نادرست است یا وارد نشده.");
    this.name = "UnauthorizedError";
  }
}

/** fetch با هدر رمز + تشخیص ۴۰۱ */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { ...authHeaders(), ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `خطای ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * فرم ورود — وقتی سرور ۴۰۱ داده باشد نمایش داده می‌شود.
 *
 * a11y: فرم واقعی با label صریح، ورودی type=password با autoComplete
 * درست، و خطای متصل با aria-describedby که همیشه رندر می‌شود تا هدف
 * پایداری باشد.
 */
export function StudioLogin({
  onSaved,
  /** آیا این فرم بعد از رد شدن یک نشست آمده یا اولین بار است؟ */
  rejected = false,
}: {
  onSaved: () => void;
  rejected?: boolean;
}) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  /*
    فوکوس روی **عنوان**، نه روی فیلد رمز.

    اگر فوکوس مستقیم روی input برود، صفحه‌خوان وارد حالت فرم می‌شود و فقط
    «رمز استودیو، edit, protected» را می‌خواند — کاربر هیچ‌وقت نمی‌فهمد چرا
    وسط کار به فرم ورود پرت شده. عنوان و پاراگراف زیرش همان توضیح‌اند.
  */
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  /**
   * رمز **قبل از پذیرفتن** با یک درخواست واقعی سنجیده می‌شود.
   *
   * باگی که این رفع می‌کند — و از هر باگ دکمه‌ای که پیدا شد بدتر بود: نسخه‌ی
   * قبلی رمز را بی‌قیدوشرط در localStorage می‌نوشت و `onSaved()` می‌زد. با رمز
   * اشتباه چرخه این می‌شد: فرم → داشبورد → اولین درخواست ۴۰۱ → فرم خالی →
   * دوباره از اول. **هیچ پیام خطایی هیچ‌وقت نمایش داده نمی‌شد** و مالک برای
   * همیشه بیرون می‌ماند بدون اینکه بفهمد چرا. تنها راه خروج، پاک‌کردن
   * localStorage از کنسول بود.
   */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const pw = value.trim();
    if (!pw) {
      setErr("رمز را وارد کن.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/campaigns", {
        cache: "no-store",
        headers: { "Content-Type": "application/json", "x-studio-password": pw },
      });
      if (res.status === 401) {
        setErr("رمز درست نیست. دوباره امتحان کن.");
        return;
      }
      if (!res.ok) {
        setErr(`سرور جواب نداد (خطای ${res.status}). چند لحظه بعد دوباره امتحان کن.`);
        return;
      }
      window.localStorage.setItem(KEY, pw);
      onSaved();
    } catch {
      setErr("اتصال برقرار نشد. اینترنت را چک کن و دوباره بزن.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-md">
      <h2
        id="login-heading"
        ref={headingRef}
        tabIndex={-1}
        className="mb-2 text-lg font-extrabold text-ink focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brass-dark"
      >
        ورود به داشبورد
      </h2>
      <p className="mb-4 text-sm leading-7 text-ink-muted">
        {rejected
          ? "نشست منقضی شد یا رمز پذیرفته نشد. برای ادامه رمز را دوباره وارد کن."
          : "این داشبورد اطلاعات تماس کسب‌وکارها را نشان می‌دهد و دکمه‌هایش سهمیه‌ی مدل را خرج می‌کنند، پس با رمز محافظت می‌شود."}
      </p>
      <form
        onSubmit={submit}
        className="space-y-4 rounded-xl border border-surface-line bg-surface p-5 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="studio-pw" className="text-sm font-medium text-ink">
            رمز استودیو
          </label>
          <input
            id="studio-pw"
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby="studio-pw-err"
            className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
          />
          {/*
            role="alert" **همیشه** روی عنصر است، نه اینکه هم‌زمان با آمدن متن
            روشن شود. افزودن role به عنصر موجود در همان لحظه‌ی تغییر متن، در
            Chrome/NVDA غیرقابل‌اتکا اعلام می‌شود.
          */}
          <p
            id="studio-pw-err"
            role="alert"
            className={err ? "text-sm text-danger" : "sr-only"}
          >
            {err}
          </p>
        </div>
        <button
          type="submit"
          aria-disabled={busy}
          className="w-full rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
        >
          {busy ? "در حال بررسی…" : "ورود"}
        </button>
      </form>
    </section>
  );
}

/**
 * وضعیت ورود را نگه می‌دارد.
 *
 * `needsLogin` را هر کامپوننتی که از apiFetch استفاده می‌کند، هنگام گرفتن
 * UnauthorizedError روشن می‌کند.
 */
export function useStudioAuth() {
  const [needsLogin, setNeedsLogin] = useState(false);
  /**
   * آیا فرم ورود به‌خاطر **رد شدن** آمده یا اولین بازدید است؟
   *
   * متن فرم بین این دو حالت فرق می‌کند: «نشست منقضی شد» در برابر توضیح اینکه
   * اصلاً چرا رمز لازم است. بدون تفکیک، کاربری که وسط کار پرت شده همان متن
   * خوش‌آمد اولیه را می‌بیند و فکر می‌کند چیزی خراب نشده.
   */
  const [rejected, setRejected] = useState(false);
  const [ready, setReady] = useState(false);

  // localStorage فقط در مرورگر هست؛ تا اولین رندر سمت کلاینت صبر می‌کنیم تا
  // خروجی سرور و کلاینت یکی بماند (جلوگیری از hydration mismatch).
  useEffect(() => setReady(true), []);

  const onUnauthorized = useCallback(() => {
    setNeedsLogin(true);
    setRejected(true);
  }, []);
  const onLoggedIn = useCallback(() => {
    setNeedsLogin(false);
    setRejected(false);
  }, []);

  return { needsLogin, rejected, ready, onUnauthorized, onLoggedIn };
}
