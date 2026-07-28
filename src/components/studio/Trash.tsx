"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, StudioLogin, UnauthorizedError, useStudioAuth } from "./auth-client";
import { describeCounts } from "./bulk-delete";
import type { TrashBatch, TrashKind } from "@/lib/store/types";

/**
 * سطل زباله — هرچه از داشبورد حذف شده، با امکان بازگرداندن.
 *
 * چرا «خالی‌کردن دائمی» ندارد: پاک‌کردن واقعیِ یک لید، کلید یکتای `dedup_key`
 * را آزاد می‌کند و کشف بعدی همان کسب‌وکار را دوباره می‌آورد — یعنی همان باگی
 * که این مکانیزم برای جلوگیری از آن ساخته شد. چند صد ردیف مرده در این مقیاس
 * هزینه‌ای ندارد، پس معامله‌ی روشنی است.
 */

const fa = (n: number | string) => new Intl.NumberFormat("fa-IR").format(Number(n));

const when = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const KIND_TITLE: Record<TrashKind, string> = {
  campaign: "حذف کمپین",
  lead: "حذف لید",
  message: "حذف پیام",
  conversation: "حذف پیگیری",
  lesson: "حذف درس",
};

/**
 * لفاف احراز هویت — عمداً فقط یک هوک دارد و بعد از `return` شرطی هیچ هوکی
 * نیست. این همان الگویی است که کرش «Rendered fewer hooks than expected» را
 * رفع کرد؛ صفحه‌ی تازه باید از روز اول رعایتش کند.
 */
export function Trash() {
  const { needsLogin, ready, onUnauthorized, onLoggedIn } = useStudioAuth();
  if (ready && needsLogin) return <StudioLogin onSaved={onLoggedIn} />;
  return <TrashInner onUnauthorized={onUnauthorized} />;
}

function TrashInner({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [batches, setBatches] = useState<TrashBatch[] | null>(null);
  const [error, setError] = useState("");
  const [busyBatch, setBusyBatch] = useState<string | null>(null);
  const [status, setStatusState] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // nonce لازم است: اگر متن دقیقاً تکراری باشد، React گره‌ی متنی را عوض
  // نمی‌کند و صفحه‌خوان چیزی اعلام نمی‌کند.
  const say = useCallback(
    (text: string) => setStatusState((p) => ({ text, n: p.n + 1 })),
    []
  );

  const load = useCallback(async () => {
    try {
      const j = await apiFetch<{ batches: TrashBatch[] }>("/api/trash");
      setBatches(j.batches);
      setError("");
    } catch (e) {
      if (e instanceof UnauthorizedError) onUnauthorized();
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (b: TrashBatch) => {
    if (busyBatch) return;
    setBusyBatch(b.batch);
    try {
      const res = await apiFetch<{ counts: TrashBatch["counts"] }>("/api/trash", {
        method: "POST",
        body: JSON.stringify({ batch: b.batch }),
      });
      say(`${describeCounts(res.counts)} برگردانده شد.`);
      await load();
      // ردیفی که دکمه‌اش را زدی از فهرست می‌رود؛ بدون این، فوکوس به body می‌افتد
      headingRef.current?.focus();
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      say(`بازگردانی ناموفق بود: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyBatch(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* تنها live region صفحه */}
      <p key={status.n} role="status" aria-live="polite" className="sr-only">
        {status.text}
      </p>

      <section aria-labelledby="trash-heading">
        <h2
          id="trash-heading"
          ref={headingRef}
          tabIndex={-1}
          className="mb-2 text-lg font-extrabold text-ink"
        >
          موارد حذف‌شده {batches ? `(${fa(batches.length)} دسته)` : ""}
        </h2>
        <p className="mb-4 text-xs leading-6 text-ink-muted">
          هر بار که چیزی حذف می‌کنی یک دسته اینجا ثبت می‌شود. بازگرداندن، همه‌ی موارد همان دسته را
          با هم برمی‌گرداند — مثلاً یک کمپین به‌همراه لیدها و پیام‌هایش. کسب‌وکاری که اینجاست با
          «کشف لید» دوباره پیدا نمی‌شود؛ اگر دوباره می‌خواهیش، از همین‌جا برش گردان.
        </p>
        <p className={error ? "mb-3 text-sm text-danger" : "sr-only"} role={error ? "alert" : undefined}>
          {error}
        </p>

        {batches === null ? (
          <p className="rounded-xl border border-dashed border-surface-line bg-surface-dim p-6 text-center text-sm text-ink-muted">
            در حال بارگذاری…
          </p>
        ) : batches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-line bg-surface-dim p-6 text-center text-sm text-ink-muted">
            سطل زباله خالی است.
          </p>
        ) : (
          <ul className="space-y-3">
            {batches.map((b) => {
              const headId = `trash-h-${b.batch}`;
              const busy = busyBatch === b.batch;
              return (
                <li key={b.batch}>
                  <article
                    aria-labelledby={headId}
                    className="rounded-xl border border-surface-line bg-surface p-5 shadow-card"
                  >
                    <h3 id={headId} className="text-sm font-extrabold text-ink">
                      {KIND_TITLE[b.kind]} — {when(b.deletedAt)}
                    </h3>
                    <p className="mt-1 text-sm leading-7 text-ink-muted">
                      {describeCounts(b.counts)}
                    </p>
                    {b.labels.length > 0 && (
                      <p className="mt-1 text-xs leading-6 text-ink-muted">
                        {b.labels.join("، ")}
                        {/* شمارنده‌ها بالا آمده‌اند؛ اینجا فقط نمونه‌ی نام‌هاست */}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void restore(b)}
                      aria-disabled={busy}
                      className={
                        busy
                          ? "mt-3 rounded-lg border border-ink-muted bg-surface px-4 py-2 text-sm font-bold text-ink-muted"
                          : "mt-3 rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
                      }
                    >
                      {busy ? "در حال بازگرداندن…" : "بازگرداندن این دسته"}
                    </button>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
