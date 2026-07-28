"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch, UnauthorizedError } from "./auth-client";
import type { DeleteResult, TrashKind } from "@/lib/store/types";

/**
 * حذف انتخابی — هوک و کامپوننت مشترک شش بخش داشبورد.
 *
 * چرا مشترک: شش پیاده‌سازی جدا یعنی شش فرصت برای شکستن قراردادهای دسترس‌پذیری
 * این پروژه (بدون `disabled`، تنها یک live region، فوکوس بعد از تغییر DOM).
 * اینجا هر قاعده یک بار نوشته می‌شود.
 *
 * ⚠️ خطری که هیچ‌کدام از عملیات قبلی داشبورد نداشتند: بعد از حذف، **عنصری که
 * فوکوس رویش است از DOM می‌رود**. بدون برگرداندن فوکوس به سرتیتر بخش، کاربر
 * صفحه‌خوان به `body` پرت می‌شود و جایش را گم می‌کند.
 */

const fa = (n: number | string) => new Intl.NumberFormat("fa-IR").format(Number(n));

/* ── نام‌گذاری فارسی ─────────────────────────────────────── */

const KIND_LABEL: Record<TrashKind, string> = {
  campaign: "کمپین",
  lead: "لید",
  message: "پیام",
  conversation: "رکورد پیگیری",
  lesson: "درس",
};

const COUNT_LABEL: Record<string, string> = {
  campaigns: "کمپین",
  leads: "لید",
  messages: "پیام",
  conversations: "رکورد پیگیری",
  lessons: "درس",
  agentRuns: "اجرای ایجنت",
  audit: "ردیف دفترچه‌ی تصمیم",
};

/** «۳ لید، ۲ پیام و ۱ رکورد پیگیری» — صفرها حذف می‌شوند */
export function describeCounts(counts: DeleteResult["counts"]): string {
  const parts = Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${fa(n ?? 0)} ${COUNT_LABEL[k] ?? k}`);
  if (parts.length === 0) return "چیزی";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join("، ")} و ${parts[parts.length - 1]}`;
}

/* ── انتخاب گروهی ────────────────────────────────────────── */

export type BulkSelect = {
  selected: Set<string>;
  toggle: (id: string) => void;
  /** انتخاب/لغو همه‌ی موارد **دیده‌شده** (نه کل داده) */
  toggleAll: (visibleIds: string[]) => void;
  clear: () => void;
  /** فقط شناسه‌هایی که هنوز روی صفحه‌اند — پایه‌ی هر عملیات گروهی */
  visibleSelected: (visibleIds: string[]) => string[];
};

export function useBulkSelect(): BulkSelect {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((visibleIds: string[]) => {
    setSelected((prev) => {
      const allOn = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const visibleSelected = useCallback(
    (visibleIds: string[]) => visibleIds.filter((id) => selected.has(id)),
    [selected]
  );

  return { selected, toggle, toggleAll, clear, visibleSelected };
}

/**
 * چک‌باکس «انتخاب همه» با سه حالت.
 *
 * `indeterminate` یک **property** روی گره DOM است نه attribute؛ نوشتنش در JSX
 * بی‌صدا نادیده گرفته می‌شود. بدون ست‌کردنش با ref، وقتی ۳ تا از ۲۰ تیک خورده
 * این چک‌باکس «خالی» نشان می‌دهد و یک کلیک هر ۲۰ تا را انتخاب می‌کند.
 */
export function SelectAllCheckbox({
  id,
  visibleIds,
  selected,
  onToggleAll,
  label,
}: {
  id: string;
  visibleIds: string[];
  selected: Set<string>;
  onToggleAll: (ids: string[]) => void;
  /** توضیح چه چیزی انتخاب می‌شود — «هر ۱۲ لید این جدول» */
  label: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const on = visibleIds.filter((x) => selected.has(x)).length;
  const all = visibleIds.length > 0 && on === visibleIds.length;
  const some = on > 0 && !all;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <>
      <input
        ref={ref}
        type="checkbox"
        id={id}
        checked={all}
        onChange={() => onToggleAll(visibleIds)}
        className="h-6 w-6 accent-brand-600"
      />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
    </>
  );
}

/* ── نوار حذف با تأیید دومرحله‌ای ─────────────────────────── */

/**
 * دکمه‌ی حذف + ناحیه‌ی تأیید.
 *
 * چرا `window.confirm` نه: نمی‌تواند تفکیک اثر («۳ لید و ۲ پیام») را نشان دهد
 * و در یک رابط فارسی، متن دکمه‌هایش انگلیسیِ مرورگر است.
 *
 * چرا مودال نه: مودالِ بدون focus trap درست، پرخطرترین جای دسترس‌پذیری است و
 * این پروژه هیچ کامپوننت مودالی ندارد. ناحیه‌ی تأییدِ **غیرمودال** همان
 * اطلاعات را می‌دهد بدون ساختن آن سطح خطر — و دقیقاً چون مودال نیست، نقش
 * `alertdialog` هم نمی‌گیرد؛ ادعای رفتاری که وجود ندارد خودش یک باگ است.
 *
 * الگو: افشا (`aria-expanded` + `aria-controls`) — همان چیزی که برای پنل
 * جزئیات لید استفاده شده.
 */
export function DeleteBar({
  kind,
  ids,
  endpoint,
  say,
  onDone,
  refocus,
  extraWarning,
}: {
  kind: TrashKind;
  /** شناسه‌های انتخاب‌شده‌ی **دیده‌شده** */
  ids: string[];
  endpoint: string;
  /** تنها live region صفحه — از Studio/Crm پاس داده می‌شود */
  say: (t: string) => void;
  onDone: () => void | Promise<void>;
  /** بعد از حذف، فوکوس کجا برود (سرتیتر همان بخش) */
  refocus?: () => void;
  /** هشدار اختصاصی بخش — مثلاً اثر حذف پیام ارسال‌شده روی قیف */
  extraWarning?: string;
}) {
  const uid = useId();
  const panelId = `${uid}-confirm`;
  const headId = `${uid}-confirm-h`;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const headRef = useRef<HTMLParagraphElement | null>(null);

  const none = ids.length === 0;
  const blocked = none || busy;

  // انتخاب که خالی شد، ناحیه‌ی تأیید بی‌معنی است
  useEffect(() => {
    if (none) setArmed(false);
  }, [none]);

  // فوکوس به ناحیه‌ی تأیید — وگرنه کاربر صفحه‌خوان نمی‌فهمد چیزی باز شده
  useEffect(() => {
    if (armed) headRef.current?.focus();
  }, [armed]);

  const label = KIND_LABEL[kind];

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<DeleteResult>(endpoint, {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      const missing = res.missing?.length ?? 0;
      // گزارش صادقانه: اگر بخشی پیدا نشد، همان‌جا گفته می‌شود — نه «انجام شد»
      say(
        `${describeCounts(res.counts)} حذف شد.` +
          (missing > 0 ? ` ${fa(missing)} مورد پیدا نشد.` : "") +
          " از صفحه‌ی سطل زباله قابل بازگرداندن است."
      );
      setArmed(false);
      await onDone();
      refocus?.();
    } catch (e) {
      if (e instanceof UnauthorizedError) throw e;
      say(`حذف ناموفق بود: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-3">
      {/*
        دکمه هیچ‌وقت از DOM نمی‌رود و `disabled` نمی‌شود — همان قراردادی که در
        کل داشبورد هست: عنصر disabled فوکوس‌پذیر نیست و اگر همان لحظه فوکوس
        رویش باشد، به body پرت می‌شود.
      */}
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          if (blocked) return;
          setArmed(true);
        }}
        aria-disabled={blocked}
        aria-expanded={armed}
        aria-controls={panelId}
        className={
          blocked
            ? "rounded-lg border border-ink-muted bg-surface px-4 py-2 text-sm font-bold text-ink-muted"
            : "rounded-lg border border-danger/70 bg-surface px-4 py-2 text-sm font-bold text-danger transition-colors hover:bg-danger-soft"
        }
      >
        {none ? `حذف ${label}` : `حذف ${fa(ids.length)} ${label} انتخاب‌شده`}
      </button>

      {/*
        ناحیه‌ی تأیید همیشه رندر می‌شود و فقط پنهان/آشکار می‌گردد، تا هدف
        aria-controls همیشه در DOM باشد.
      */}
      <div
        id={panelId}
        role="group"
        aria-labelledby={headId}
        hidden={!armed}
        className="rounded-lg border border-danger/50 bg-danger-soft p-4"
      >
        <p
          id={headId}
          ref={headRef}
          tabIndex={-1}
          className="text-sm font-bold leading-7 text-ink focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brass"
        >
          {`تأیید حذف ${fa(ids.length)} ${label}`}
        </p>
        <p className="mt-1 text-xs leading-6 text-ink-muted">
          {extraWarning ? `${extraWarning} ` : ""}
          پاک‌شدنی نیست و از صفحه‌ی سطل زباله قابل بازگرداندن است.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void run()}
            aria-disabled={busy}
            className={
              busy
                ? "rounded-lg border border-ink-muted bg-surface px-4 py-2 text-sm font-bold text-ink-muted"
                : "rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white shadow-card transition-colors hover:opacity-90"
            }
          >
            {busy ? "در حال حذف…" : "بله، حذف کن"}
          </button>
          <button
            type="button"
            onClick={() => {
              setArmed(false);
              triggerRef.current?.focus();
            }}
            className="rounded-lg border border-surface-line bg-surface px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-surface-dim"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

/** چک‌باکس یک ردیف — برچسبش نام همان مورد است، نه کلمه‌ی «انتخاب» */
export function RowCheckbox({
  id,
  checked,
  onToggle,
  label,
}: {
  id: string;
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onToggle}
        className="h-6 w-6 shrink-0 accent-brand-600"
      />
      {/*
        نقشِ checkbox خودش «انتخاب» را می‌رساند؛ تکرارش در برچسب باعث می‌شد
        «انتخاب، انتخاب فلان» خوانده شود.
      */}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
    </>
  );
}

/** متن هشدار بخش پیام‌ها — حذف پیام ارسال‌شده آمار گذشته را عوض می‌کند */
export function useSentWarning(
  ids: string[],
  statusOf: (id: string) => string | undefined
): string | undefined {
  return useMemo(() => {
    const n = ids.filter((id) => {
      const s = statusOf(id);
      return s === "sent" || s === "approved";
    }).length;
    if (n === 0) return undefined;
    // قیف تبدیل صفحه‌ی CRM از روی messages.status ساخته می‌شود، پس حذف یک پیام
    // ارسال‌شده آمار بازه‌های گذشته را واقعاً عقب می‌برد.
    return `${fa(n)} مورد از این‌ها تأییدشده یا ارسال‌شده است و آمار قیف تبدیل بازه‌های گذشته را عقب می‌برد.`;
  }, [ids, statusOf]);
}
