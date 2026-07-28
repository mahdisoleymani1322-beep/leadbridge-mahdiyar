"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, StudioLogin, UnauthorizedError, useStudioAuth } from "./auth-client";

/**
 * صفحه‌ی CRM — دفترچه‌ی تصمیم، تاریخچه، قیف تبدیل و پیگیری‌ها.
 *
 * صفحه‌ی جدا از Studio.tsx است (نه یک بخش تازه در آن): آن فایل بالای ۲۶۰۰ خط
 * است و بزرگ‌ترکردنش نگهداری را سخت‌تر می‌کند.
 *
 * صفر توکن LLM — همه‌ی داده از /api/crm می‌آید که فقط کوئری دیتابیس است.
 */

const fa = (n: number | string) => new Intl.NumberFormat("fa-IR").format(Number(n));

/**
 * تاریخ شمسی — با Intl خودِ مرورگر، بدون هیچ وابستگی.
 *
 * چرا input بومی type=date و نه تقویم سفارشی: دسترس‌پذیری، ناوبری با کیبورد و
 * پشتیبانی اسکرین‌ریدر رایگان به دست می‌آید. چون آن input تاریخ میلادی نشان
 * می‌دهد، معادل شمسی کنارش نوشته می‌شود.
 */
const jalali = (iso: string, withTime = false) => {
  try {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric",
      month: "long",
      day: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const clock = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso)
    );
  } catch {
    return "";
  }
};

/** «YYYY-MM-DD» محلی — نه ISO/UTC، وگرنه مرز روز یک روز جابه‌جا می‌شود */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** ابتدای روز محلی به ISO */
const startIso = (s: string) => new Date(`${s}T00:00:00`).toISOString();
/** انتهای روز محلی به ISO */
const endIso = (s: string) => new Date(`${s}T23:59:59.999`).toISOString();

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

type CrmEvent = {
  id: string;
  at: string;
  kind: "decision" | "agent" | "campaign" | "lead";
  action: string;
  label: string;
  subject: string | null;
  detail: string;
  ok: boolean;
};

type FollowUp = {
  leadId: string;
  businessName: string;
  status: string;
  channel: string | null;
  conversationState: string | null;
  sentiment: string | null;
  summary: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  overdue: boolean;
  awaitingReply: boolean;
};

type CrmData = {
  funnel: { key: string; label: string; count: number }[];
  totals: {
    events: number;
    campaigns: number;
    newLeads: number;
    awaitingReply: number;
    overdue: number;
  };
  campaigns: {
    id: string;
    name: string;
    market: string;
    city: string;
    createdAt: string;
    leads: number;
    shortlisted: number;
    sent: number;
    converted: number;
  }[];
  events: CrmEvent[];
  followUps: FollowUp[];
  allCampaigns: { id: string; name: string }[];
};

const KIND_LABELS: Record<CrmEvent["kind"], string> = {
  decision: "تصمیم",
  agent: "اجرای ایجنت",
  campaign: "کمپین",
  lead: "لید",
};

const SENTIMENT_LABELS: Record<string, string> = {
  positive: "مثبت",
  neutral: "خنثی",
  negative: "منفی",
};

const STATE_LABELS: Record<string, string> = {
  no_reply: "بدون پاسخ",
  replied: "پاسخ داد",
  meeting: "قرار گذاشته شد",
  closed: "بسته شد",
};

export function Crm() {
  const { needsLogin, ready, onUnauthorized, onLoggedIn } = useStudioAuth();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(ymd(new Date()));
  const [campaignId, setCampaignId] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | CrmEvent["kind"]>("all");
  const [data, setData] = useState<CrmData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // تنها live region صفحه — همان الگوی داشبورد لید. کلید nonce دارد تا پیام
  // تکراری هم دوباره اعلام شود.
  const [status, setStatusState] = useState<{ text: string; n: number }>({ text: "", n: 0 });
  const setStatus = useCallback(
    (text: string) => setStatusState((p) => ({ text, n: p.n + 1 })),
    []
  );

  const load = useCallback(
    async (announce: boolean) => {
      setBusy(true);
      setError("");
      try {
        const q = new URLSearchParams({ from: startIso(from), to: endIso(to) });
        if (campaignId) q.set("campaignId", campaignId);
        // قبلاً fetch خام بود و هدر رمز نمی‌فرستاد؛ یعنی لحظه‌ای که
        // STUDIO_PASSWORD تنظیم می‌شد، کل صفحه‌ی CRM با ۴۰۱ می‌مرد.
        const json = await apiFetch<CrmData>(`/api/crm?${q}`);
        setData(json);
        if (announce) {
          setStatus(
            `${fa(json.totals.events)} رویداد در بازه‌ی ${jalali(startIso(from))} تا ${jalali(
              startIso(to)
            )} یافت شد.`
          );
        }
      } catch (e) {
        // ۴۰۱ یعنی «هنوز وارد نشده‌ای»، نه خطای صفحه
        if (e instanceof UnauthorizedError) onUnauthorized();
        else setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [from, to, campaignId, setStatus, onUnauthorized]
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ready && needsLogin) {
    return (
      <StudioLogin
        onSaved={() => {
          onLoggedIn();
          void load(false);
        }}
      />
    );
  }

  const shown = useMemo(
    () => (data ? data.events.filter((e) => kindFilter === "all" || e.kind === kindFilter) : []),
    [data, kindFilter]
  );

  /** رویدادها گروه‌بندی‌شده بر اساس روز — ترتیب زمانی معنای ذاتی لیست است */
  const byDay = useMemo(() => {
    const groups = new Map<string, CrmEvent[]>();
    for (const e of shown) {
      const key = e.at.slice(0, 10);
      const arr = groups.get(key);
      if (arr) arr.push(e);
      else groups.set(key, [e]);
    }
    return [...groups.entries()];
  }, [shown]);

  const preset = (days: number) => {
    setFrom(daysAgo(days));
    setTo(ymd(new Date()));
  };
  const activePreset = (days: number) => from === daysAgo(days) && to === ymd(new Date());

  return (
    <div className="space-y-10">
      {/* تنها live region صفحه */}
      <p key={status.n} role="status" aria-live="polite" className="sr-only">
        {status.text}
      </p>

      {/* ── بازه‌ی زمانی ── */}
      <section aria-labelledby="range-heading">
        <h2 id="range-heading" className="mb-4 text-lg font-extrabold text-ink">
          بازه‌ی زمانی
        </h2>
        <fieldset className="rounded-xl border border-surface-line bg-surface p-5 shadow-card">
          <legend className="px-2 text-sm font-bold text-ink">انتخاب تاریخ</legend>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="crm-from" className="text-sm font-medium text-ink">
                از تاریخ
              </label>
              <input
                id="crm-from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                aria-describedby="crm-from-fa"
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              />
              <p id="crm-from-fa" className="text-xs text-ink-muted">
                {jalali(startIso(from))}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="crm-to" className="text-sm font-medium text-ink">
                تا تاریخ
              </label>
              <input
                id="crm-to"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                aria-describedby="crm-to-fa"
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              />
              <p id="crm-to-fa" className="text-xs text-ink-muted">
                {jalali(startIso(to))}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="crm-campaign" className="text-sm font-medium text-ink">
                کمپین
              </label>
              <select
                id="crm-campaign"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              >
                <option value="">همه‌ی کمپین‌ها</option>
                {(data?.allCampaigns ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  if (busy) return;
                  void load(true);
                }}
                aria-disabled={busy}
                className={
                  busy
                    ? "w-full rounded-lg bg-surface-dim px-4 py-2 text-sm font-bold text-ink-muted"
                    : "w-full rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
                }
              >
                {busy ? "در حال خواندن…" : "نمایش بازه"}
              </button>
            </div>
          </div>

          <div role="group" aria-label="بازه‌های آماده" className="mt-4 flex flex-wrap gap-2">
            {[
              { label: "امروز", days: 0 },
              { label: "۷ روز گذشته", days: 7 },
              { label: "۳۰ روز گذشته", days: 30 },
              { label: "۹۰ روز گذشته", days: 90 },
            ].map((p) => (
              <button
                key={p.days}
                type="button"
                aria-pressed={activePreset(p.days)}
                onClick={() => preset(p.days)}
                className={
                  activePreset(p.days)
                    ? "rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-bone"
                    : "rounded-lg border border-brand-400 bg-surface px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>

        <p
          className={
            error
              ? "mt-3 rounded-lg border border-danger/70 bg-danger-soft px-3 py-2 text-sm text-danger"
              : "sr-only"
          }
        >
          {error}
        </p>
      </section>

      {/* ── آمار و قیف ── */}
      {data && (
        <section aria-labelledby="funnel-heading">
          <h2 id="funnel-heading" className="mb-4 text-lg font-extrabold text-ink">
            آمار بازه
          </h2>

          <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "رویداد ثبت‌شده", v: data.totals.events },
              { t: "کمپین ساخته‌شده", v: data.totals.campaigns },
              { t: "لید جدید", v: data.totals.newLeads },
              { t: "منتظر پاسخ", v: data.totals.awaitingReply },
            ].map((c) => (
              <div
                key={c.t}
                className="rounded-xl border border-surface-line bg-surface p-4 shadow-card"
              >
                <dt className="text-xs font-medium text-ink-muted">{c.t}</dt>
                <dd className="mt-1 text-2xl font-black text-ink">{fa(c.v)}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mb-2 text-sm font-extrabold text-ink">قیف تبدیل</h3>
          <ol className="space-y-2">
            {data.funnel.map((s, i) => {
              const prev = i > 0 ? data.funnel[i - 1].count : null;
              const total = data.funnel[0].count || 1;
              const pctTotal = Math.round((s.count / total) * 100);
              const pctPrev = prev ? Math.round((s.count / (prev || 1)) * 100) : null;
              return (
                <li
                  key={s.key}
                  className="rounded-lg border border-surface-line bg-surface px-4 py-3 shadow-card"
                >
                  {/* عدد و درصد در خودِ متن‌اند؛ نوار فقط تزیین است */}
                  <p className="text-sm text-ink">
                    <span className="font-bold">{s.label}:</span> {fa(s.count)} لید — {fa(pctTotal)}٪
                    از کل
                    {pctPrev != null ? ` · ${fa(pctPrev)}٪ از پله‌ی قبل` : ""}
                  </p>
                  <div aria-hidden="true" className="mt-2 h-2 w-full rounded-full bg-surface-dim">
                    <div
                      className="h-2 rounded-full bg-brass-dark"
                      style={{ width: `${pctTotal}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ── کمپین‌های بازه ── */}
      {data && data.campaigns.length > 0 && (
        <section aria-labelledby="camp-heading">
          <h2 id="camp-heading" className="mb-4 text-lg font-extrabold text-ink">
            کمپین‌های ساخته‌شده در این بازه
          </h2>
          <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface shadow-card">
            <table className="w-full text-right text-sm">
              <caption className="sr-only">
                کمپین‌های ساخته‌شده در بازه‌ی انتخابی، با آمار لید و تبدیل هرکدام
              </caption>
              <thead className="bg-sand text-xs text-ink">
                <tr>
                  <th scope="col" className="px-4 py-3 font-bold">نام کمپین</th>
                  <th scope="col" className="px-4 py-3 font-bold">بازار</th>
                  <th scope="col" className="px-4 py-3 font-bold">تاریخ ساخت</th>
                  <th scope="col" className="px-4 py-3 font-bold">لید</th>
                  <th scope="col" className="px-4 py-3 font-bold">منتخب</th>
                  <th scope="col" className="px-4 py-3 font-bold">ارسال‌شده</th>
                  <th scope="col" className="px-4 py-3 font-bold">تبدیل‌شده</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c) => (
                  <tr key={c.id} className="border-t border-surface-line">
                    <th scope="row" className="px-4 py-3 text-right font-bold text-ink">
                      {c.name}
                    </th>
                    <td className="px-4 py-3 text-ink-muted">{c.market}</td>
                    <td className="px-4 py-3 text-ink-muted">{jalali(c.createdAt)}</td>
                    <td className="px-4 py-3 text-ink">{fa(c.leads)}</td>
                    <td className="px-4 py-3 text-ink">{fa(c.shortlisted)}</td>
                    <td className="px-4 py-3 text-ink">{fa(c.sent)}</td>
                    <td className="px-4 py-3 font-bold text-ink">{fa(c.converted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── پیگیری‌ها ── */}
      {data && (
        <section aria-labelledby="follow-heading">
          <h2 id="follow-heading" className="mb-2 text-lg font-extrabold text-ink">
            پیگیری‌ها ({fa(data.followUps.length)} لید ارسال‌شده)
          </h2>
          <p className="mb-4 text-xs leading-6 text-ink-muted">
            هر لیدی که پیامش ارسال شده اینجاست. پاسخ بیزینس را ثبت کن تا در قیف تبدیل و دفترچه‌ی
            تصمیم دیده شود.
          </p>
          {data.followUps.length === 0 ? (
            <p className="rounded-xl border border-surface-line bg-surface p-5 text-sm text-ink-muted shadow-card">
              هنوز پیامی ارسال نشده است. بعد از زدن «ارسال شد» در پنل پیام‌ها، لید اینجا می‌آید.
            </p>
          ) : (
            <ul className="space-y-4">
              {data.followUps.map((f) => (
                <FollowUpCard key={f.leadId} f={f} onSaved={() => void load(false)} say={setStatus} />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── درس‌های آموخته‌شده ── */}
      <Lessons say={setStatus} />

      {/* ── دفترچه‌ی تصمیم ── */}
      {data && (
        <section aria-labelledby="log-heading">
          <h2 id="log-heading" className="mb-2 text-lg font-extrabold text-ink">
            دفترچه‌ی تصمیم
          </h2>
          <p className="mb-4 text-xs leading-6 text-ink-muted">
            هر اتفاقی که در این بازه افتاده — تصمیم‌های تو و اجراهای سیستم — به‌ترتیب زمانی.
          </p>

          <div role="group" aria-label="فیلتر نوع رویداد" className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ["all", "همه"],
                ["decision", "تصمیم‌های من"],
                ["agent", "اجرای ایجنت"],
                ["campaign", "کمپین"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={kindFilter === k}
                onClick={() => setKindFilter(k)}
                className={
                  kindFilter === k
                    ? "rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-bone"
                    : "rounded-lg border border-brand-400 bg-surface px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
                }
              >
                {label}
              </button>
            ))}
          </div>

          {byDay.length === 0 ? (
            <p className="rounded-xl border border-surface-line bg-surface p-5 text-sm text-ink-muted shadow-card">
              در این بازه رویدادی ثبت نشده است. بازه را بازتر کن یا فیلتر نوع رویداد را روی «همه»
              بگذار.
            </p>
          ) : (
            <div className="space-y-6">
              {byDay.map(([day, items]) => (
                <div key={day}>
                  <h3 className="mb-2 text-sm font-extrabold text-ink">
                    {jalali(startIso(day))} — {fa(items.length)} رویداد
                  </h3>
                  <ol className="space-y-2">
                    {items.map((e) => (
                      <li
                        key={e.id}
                        className="rounded-lg border border-surface-line bg-surface px-4 py-3 shadow-card"
                      >
                        <p className="text-sm text-ink">
                          <span className="text-ink-muted">{clock(e.at)}</span>{" "}
                          <span className="font-bold">{e.label}</span>
                          {e.subject ? <> — {e.subject}</> : null}
                          {!e.ok ? (
                            <span className="mr-2 rounded bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">
                              ناموفق
                            </span>
                          ) : null}
                        </p>
                        {e.detail ? (
                          <p className="mt-1 text-xs leading-6 text-ink-muted">{e.detail}</p>
                        ) : null}
                        <p className="sr-only">نوع: {KIND_LABELS[e.kind]}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

type LessonRow = {
  id: string;
  agent: string;
  lesson: string;
  source: "critic" | "human";
  createdAt: string;
};

/**
 * درس‌های آموخته‌شده — خروجی قابل‌مشاهده‌ی حلقه‌ی خودبهبودی.
 *
 * بدون این بخش، سیستم بی‌سروصدا روی پیام‌های بعدی اثر می‌گذاشت و مالک نه
 * می‌دید چه یاد گرفته شده و نه می‌توانست درسِ غلط را پس بگیرد.
 */
function Lessons({ say }: { say: (t: string) => void }) {
  const [rows, setRows] = useState<LessonRow[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const j = await apiFetch<{ lessons: LessonRow[] }>("/api/lessons");
      setRows(j.lessons);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disable = async (l: LessonRow) => {
    try {
      await apiFetch("/api/lessons", {
        method: "PATCH",
        body: JSON.stringify({ id: l.id, active: false }),
      });
      say("درس غیرفعال شد و دیگر به پرامپت تزریق نمی‌شود.");
      await load();
    } catch (e) {
      say(`غیرفعال‌کردن درس ناموفق بود: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section aria-labelledby="lessons-heading">
      <h2 id="lessons-heading" className="mb-2 text-lg font-extrabold text-ink">
        درس‌های آموخته‌شده {rows ? `(${fa(rows.length)})` : ""}
      </h2>
      <p className="mb-4 text-xs leading-6 text-ink-muted">
        این جمله‌ها به پرامپت نویسنده‌ی پیام تزریق می‌شوند و روی همه‌ی پیام‌های بعدی اثر می‌گذارند.
        منبعشان یا نمره‌ی پایین منتقد است یا بازخورد خودت. اگر درسی اشتباه بود، غیرفعالش کن.
      </p>
      <p className={err ? "mb-3 text-sm text-danger" : "sr-only"}>{err}</p>

      {rows && rows.length === 0 ? (
        <p className="rounded-xl border border-surface-line bg-surface p-5 text-sm text-ink-muted shadow-card">
          هنوز درسی ثبت نشده. وقتی منتقد به پیامی نمره‌ی پایین بدهد، یا در کارت پیام «ایراد داشت» را
          با توضیح بزنی، اینجا پر می‌شود.
        </p>
      ) : (
        <ul className="space-y-2">
          {(rows ?? []).map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-surface-line bg-surface px-4 py-3 shadow-card"
            >
              <p className="text-sm leading-7 text-ink">{l.lesson}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-xs text-ink-muted">
                  منبع: {l.source === "critic" ? "منتقد" : "بازخورد تو"} · ایجنت: {l.agent} ·{" "}
                  {jalali(l.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => void disable(l)}
                  aria-label={`غیرفعال‌کردن درس: ${l.lesson.slice(0, 40)}`}
                  className="rounded-lg border border-danger/70 bg-surface px-3 py-1 text-xs font-bold text-danger hover:bg-danger-soft"
                >
                  غیرفعال کن
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** کارت یک پیگیری + فرم ثبت پاسخ */
function FollowUpCard({
  f,
  onSaved,
  say,
}: {
  f: FollowUp;
  onSaved: () => void;
  say: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(f.conversationState ?? "no_reply");
  const [sentiment, setSentiment] = useState(f.sentiment ?? "neutral");
  const [summary, setSummary] = useState(f.summary ?? "");
  const [nextAction, setNextAction] = useState(f.nextAction ?? "");
  const [nextAt, setNextAt] = useState(f.nextActionAt ? f.nextActionAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // بعد از ثبت موفق، فوکوس به سرنویس کارت می‌رود — چون فرم بسته می‌شود و
  // عنصر فوکوس‌شده از DOM حذف می‌گردد (درسی که در پنل پیام‌ها گرفته شد).
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const save = async (converted: boolean) => {
    setBusy(true);
    setErr("");
    try {
      const json = await apiFetch<{ leadStatus: string }>("/api/conversations", {
        method: "PUT",
        body: JSON.stringify({
          leadId: f.leadId,
          conversationState: state,
          sentiment,
          summary,
          nextAction,
          nextActionAt: nextAt ? new Date(`${nextAt}T09:00:00`).toISOString() : null,
          handoverRequired: state === "meeting",
          converted,
        }),
      });
      say(
        converted
          ? `«${f.businessName}» به‌عنوان تبدیل‌شده ثبت شد.`
          : `پاسخ «${f.businessName}» ثبت شد. وضعیت لید: ${json.leadStatus}.`
      );
      setOpen(false);
      headingRef.current?.focus();
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const panelId = `fu-panel-${f.leadId}`;
  const headId = `fu-h-${f.leadId}`;

  return (
    <li>
      <article
        aria-labelledby={headId}
        className="rounded-xl border border-surface-line bg-surface p-5 shadow-card"
      >
        <h3
          id={headId}
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-extrabold text-ink outline-none"
        >
          {f.businessName}
        </h3>

        <p className="mt-1 text-xs leading-6 text-ink-muted">
          وضعیت: {f.status}
          {f.conversationState ? ` · ${STATE_LABELS[f.conversationState] ?? f.conversationState}` : ""}
          {f.sentiment ? ` · لحن پاسخ: ${SENTIMENT_LABELS[f.sentiment] ?? f.sentiment}` : ""}
          {f.overdue ? " · پیگیری سررسید شده" : ""}
        </p>
        {f.summary ? <p className="mt-2 text-sm leading-7 text-ink">{f.summary}</p> : null}
        {f.nextAction ? (
          <p className="mt-1 text-xs text-ink-muted">
            اقدام بعدی: {f.nextAction}
            {f.nextActionAt ? ` — ${jalali(f.nextActionAt)}` : ""}
          </p>
        ) : null}

        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="mt-3 rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
        >
          {open ? "بستن فرم" : `ثبت پاسخ ${f.businessName}`}
        </button>

        <div id={panelId} hidden={!open} className="mt-4 space-y-4 border-t border-surface-line pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`st-${f.leadId}`} className="text-sm font-medium text-ink">
                وضعیت گفت‌وگو
              </label>
              <select
                id={`st-${f.leadId}`}
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              >
                <option value="no_reply">بدون پاسخ</option>
                <option value="replied">پاسخ داد</option>
                <option value="meeting">قرار گذاشته شد</option>
                <option value="closed">بسته شد</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`se-${f.leadId}`} className="text-sm font-medium text-ink">
                لحن پاسخ
              </label>
              <select
                id={`se-${f.leadId}`}
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value)}
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              >
                <option value="positive">مثبت</option>
                <option value="neutral">خنثی</option>
                <option value="negative">منفی</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`sm-${f.leadId}`} className="text-sm font-medium text-ink">
              خلاصه‌ی پاسخ
            </label>
            <textarea
              id={`sm-${f.leadId}`}
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="چه گفتند؟"
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm leading-7 text-ink"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`na-${f.leadId}`} className="text-sm font-medium text-ink">
                اقدام بعدی
              </label>
              <input
                id={`na-${f.leadId}`}
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="مثلاً: ارسال نمونه‌کار"
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`nd-${f.leadId}`} className="text-sm font-medium text-ink">
                تاریخ پیگیری
              </label>
              <input
                id={`nd-${f.leadId}`}
                type="date"
                value={nextAt}
                onChange={(e) => setNextAt(e.target.value)}
                aria-describedby={`nd-fa-${f.leadId}`}
                className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              />
              <p id={`nd-fa-${f.leadId}`} className="text-xs text-ink-muted">
                {nextAt ? jalali(startIso(nextAt)) : "تاریخی انتخاب نشده"}
              </p>
            </div>
          </div>

          <p
            id={`fu-err-${f.leadId}`}
            className={
              err
                ? "rounded-lg border border-danger/70 bg-danger-soft px-3 py-2 text-sm text-danger"
                : "sr-only"
            }
          >
            {err}
          </p>

          <div role="group" aria-label={`ثبت نتیجه برای ${f.businessName}`} className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                void save(false);
              }}
              aria-disabled={busy}
              aria-describedby={`fu-err-${f.leadId}`}
              className={
                busy
                  ? "rounded-lg bg-surface-dim px-4 py-2 text-sm font-bold text-ink-muted"
                  : "rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone hover:bg-pine-dark"
              }
            >
              ثبت پاسخ
            </button>
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                void save(true);
              }}
              aria-disabled={busy}
              aria-label={`ثبت ${f.businessName} به‌عنوان تبدیل‌شده`}
              className={
                busy
                  ? "rounded-lg bg-surface-dim px-4 py-2 text-sm font-bold text-ink-muted"
                  : "rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50"
              }
            >
              تبدیل شد ✓
            </button>
          </div>
        </div>
      </article>
    </li>
  );
}
