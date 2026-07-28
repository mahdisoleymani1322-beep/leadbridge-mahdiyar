"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type React from "react";
import type {
  Campaign,
  Lead,
  ContactChannels,
  ChannelKey,
  LeadStatus,
  LeadAnalysis,
  AgentRun,
  AgentRunStatus,
} from "@/lib/store/types";
import {
  MARKETS,
  SCORING_WEIGHTS,
  CRITIC_THRESHOLDS,
  AFFLUENCE_THRESHOLDS,
  messageLengthFor,
  type ScoringCriterion,
} from "@/lib/config";
import {
  SERVICES,
  ALL_SERVICES_ID,
  MESSAGE_TEMPLATES,
  MESSAGE_SIGNATURE,
  withSignature,
} from "@/lib/brand";
import { apiFetch, StudioLogin, UnauthorizedError, useStudioAuth } from "./auth-client";

/** ارقام فارسی در متن کاربرپسند (طبق قرارداد پروژه) */
const fa = (n: number | string) => new Intl.NumberFormat("fa-IR").format(Number(n));

/** برچسب فارسی وضعیت لید — به‌جای نمایش خام enum */
const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "جدید",
  VALIDATING: "در حال اعتبارسنجی",
  INVALID: "نامعتبر",
  DUPLICATE: "تکراری",
  ANALYZING: "در حال تحلیل",
  LOW_VALUE: "کم‌ارزش — تحلیل نشد",
  SCORED: "امتیازدهی‌شده",
  REJECTED: "رد شده",
  NURTURE: "نگه‌داری",
  READY_FOR_MESSAGE: "آماده‌ی پیام",
  MESSAGE_DRAFTED: "پیش‌نویس پیام",
  MESSAGE_REVIEW: "بازبینی پیام",
  APPROVED: "تأییدشده",
  SENT: "ارسال‌شده",
  REPLIED: "پاسخ داده",
  HANDOVER_READY: "آماده‌ی تحویل",
  HANDED_OVER: "تحویل‌شده",
};

const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  running: "در حال اجرا",
  done: "موفق",
  error: "خطا",
};

const CRITERION_LABELS: Record<ScoringCriterion, string> = {
  marketFit: "تناسب با بازار هدف",
  visibleNeed: "نیاز آشکار",
  infoCredibility: "اعتبار اطلاعات",
  onlineActivity: "فعالیت آنلاین",
  portfolioFit: "تناسب نمونه‌کار",
  decisionMakerAccess: "دسترسی به تصمیم‌گیرنده",
  lowRisk: "ریسک پایین",
};

/* ── کمکی fetch با هدر رمز استودیو ────────────────────────── */

// منطق رمز و فرم ورود در auth-client.tsx مشترک است (بین /studio و /studio/crm).
// تا پیش از این، رمز فقط از localStorage خوانده می‌شد و هیچ راهی برای واردکردنش
// نبود — یعنی تنظیم‌کردن STUDIO_PASSWORD عملاً مالک را از داشبورد بیرون می‌کرد.
const api = apiFetch;

/* ── برچسب کانال‌های ارتباط ───────────────────────────────── */

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  instagram: "اینستاگرام",
  whatsapp: "واتساپ",
  telegram: "تلگرام",
  email: "ایمیل",
  siteForm: "فرم سایت",
  phone: "تلفن",
};

/** فقط ارقام شماره را نگه می‌دارد (ارقام فارسی/عربی هم به لاتین تبدیل می‌شوند) */
function digitsOnly(v: string): string {
  return v
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

/** شماره‌ی ایرانی را به فرمت بین‌المللی واتساپ (98…) تبدیل می‌کند */
function toIntlPhone(v: string): string {
  const d = digitsOnly(v);
  if (d.startsWith("98")) return d;
  if (d.startsWith("0")) return "98" + d.slice(1);
  if (d.startsWith("9") && d.length === 10) return "98" + d;
  return d;
}

/**
 * لینک عملیاتی هر کانال — با کلیک، همان اپ/صفحه باز می‌شود.
 * برای تلفن `tel:` است تا روی موبایل شماره‌گیر و روی دسکتاپ شماره ظاهر شود.
 */
function channelHref(key: ChannelKey, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (key) {
    case "instagram":
      return `https://instagram.com/${v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")}`;
    case "whatsapp":
      return `https://wa.me/${toIntlPhone(v)}`;
    case "telegram":
      return v.startsWith("http") ? v : `https://t.me/${v.replace(/^@/, "")}`;
    case "email":
      return `mailto:${v}`;
    case "siteForm":
      return v.startsWith("http") ? v : `https://${v}`;
    case "phone":
      return `tel:${digitsOnly(v)}`;
    default:
      return null;
  }
}

/** آیا این کانال در تب جدید باز می‌شود؟ (tel/mailto در همان تب می‌مانند) */
const OPENS_NEW_TAB: Record<ChannelKey, boolean> = {
  instagram: true,
  whatsapp: true,
  telegram: true,
  siteForm: true,
  email: false,
  phone: false,
};

/** فعلِ هر کانال — لینک باید بگوید با کلیک چه اتفاقی می‌افتد */
const CHANNEL_VERBS: Record<ChannelKey, string> = {
  instagram: "باز کردن پیج",
  whatsapp: "شروع گفت‌وگو",
  telegram: "شروع گفت‌وگو",
  email: "نوشتن ایمیل",
  siteForm: "باز کردن فرم",
  phone: "تماس",
};

/** ارقام را جدا می‌کند تا رقم‌به‌رقم خوانده شوند، نه یک عدد ۱۱ رقمی */
const spacedDigits = (v: string) => digitsOnly(v).split("").join(" ");

/**
 * ایزوله‌ی دوجهته (FSI…PDI).
 * نام دسترس‌پذیر یک رشته‌ی تخت است، پس <bdi> آنجا کار نمی‌کند؛ این کاراکترهای
 * کنترلی همان کار را داخل attribute انجام می‌دهند.
 */
const isolate = (v: string) => `⁨${v}⁩`;

/**
 * کانال‌های ارتباط به‌صورت **لینک قابل‌کلیک**.
 * @param businessName در نام دسترس‌پذیر هر لینک می‌آید تا خارج از زمینه هم روشن باشد
 * @param labelledBy شناسه‌ی سرتیتری که این فهرست را نام‌گذاری می‌کند
 */
function Channels({
  channels,
  businessName,
  labelledBy,
}: {
  channels: ContactChannels;
  businessName?: string;
  labelledBy?: string;
}) {
  const keys = (Object.keys(CHANNEL_LABELS) as ChannelKey[]).filter((k) => channels[k]);
  if (keys.length === 0)
    return (
      <p className="text-ink-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">راه ارتباطی ثبت نشده است</span>
      </p>
    );
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-wrap gap-1">
      {keys.map((k) => {
        const value = String(channels[k]);
        const href = channelHref(k, value);
        const newTab = OPENS_NEW_TAB[k];
        // شماره رقم‌به‌رقم، بقیه ایزوله‌شده. برچسب اول می‌آید تا Label in Name حفظ شود.
        const spoken = k === "phone" || k === "whatsapp" ? spacedDigits(value) : isolate(value);
        const label =
          `${CHANNEL_LABELS[k]}${businessName ? ` ${businessName}` : ""}: ${spoken} — ` +
          `${CHANNEL_VERBS[k]}${newTab ? "، در تب جدید باز می‌شود" : ""}`;
        return (
          <li key={k}>
            {href ? (
              <a
                href={href}
                aria-label={label}
                {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="inline-block rounded-full bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 underline underline-offset-2 hover:bg-brand-100"
              >
                {CHANNEL_LABELS[k]}
              </a>
            ) : (
              <span className="inline-block rounded-full bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
                {CHANNEL_LABELS[k]}
                <span className="sr-only">: {value}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── پیام‌ها (فاز ۴) ──────────────────────────────────────── */

type PolicyCheckView = { id: string; label: string; pass: boolean; detail: string };

type MessageView = {
  id: string;
  leadId: string;
  businessName: string;
  targetChannel: ChannelKey | null;
  draftText: string;
  finalText: string | null;
  emailSubject: string | null;
  emailText: string | null;
  status: "draft" | "approved" | "rejected" | "sent";
  criticScore: number | null;
  painTargeted: string | null;
  recommendedPortfolioIds: string[];
  portfolio: { id: string; title: string; publicUrl: string; service: string }[];
  contactChannels: ContactChannels;
  policy: { verdict: "PASS" | "BLOCK" | "HUMAN_REVIEW"; checks: PolicyCheckView[]; violations: string[] };
};

const VERDICT_LABELS: Record<MessageView["policy"]["verdict"], string> = {
  PASS: "قبول نگهبان سیاست",
  HUMAN_REVIEW: "نیاز به بازبینی انسانی",
  BLOCK: "مسدود — تأیید ممکن نیست",
};

const MSG_STATUS_LABELS: Record<MessageView["status"], string> = {
  draft: "پیش‌نویس",
  approved: "تأییدشده",
  rejected: "ردشده",
  sent: "ارسال‌شده",
};

/** متن فعلیِ قابل‌ویرایش پیام (نسخه‌ی نهایی اگر ویرایش شده، وگرنه پیش‌نویس) */
const currentText = (m: MessageView) => m.finalText ?? m.draftText;

/** شمارش کلمات — همان تقریبی که policy-guard سمت سرور استفاده می‌کند */
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/**
 * معنی نمره‌ی منتقد **به کلمات**.
 * عمداً از meter/progressbar استفاده نمی‌شود: نمره بدون آستانه بی‌معناست و
 * نوار پیشرفت برای screen reader فقط یک عدد خام می‌خواند.
 */
function scoreBand(score: number | null): string {
  if (score == null) return "نمره‌ی منتقد ثبت نشده است";
  if (score >= CRITIC_THRESHOLDS.pass) return "کیفیت قابل‌قبول برای ارسال";
  if (score >= CRITIC_THRESHOLDS.revise) return "کیفیت مرزی — بازبینی انسانی لازم است";
  return "کیفیت پایین — بهتر است متن بازنویسی شود";
}

/**
 * کپی متن در کلیپ‌بورد.
 * `navigator.clipboard` روی http (غیر-https) در دسترس نیست، پس یک مسیر پشتیبان
 * با textarea موقت هم دارد تا دکمه در محیط توسعه‌ی محلی هم کار کند.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* می‌افتیم روی مسیر پشتیبان */
  }
  // مسیر پشتیبان فوکوس را می‌دزدد (select روی textarea موقت)، پس بعدش
  // فوکوس را به همان جایی برمی‌گردانیم که بود — وگرنه Tab از اول صفحه شروع می‌شود.
  const prev = document.activeElement as HTMLElement | null;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.tabIndex = -1;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  } finally {
    prev?.focus?.();
  }
}

type MsgFilter = "all" | "draft" | "approved" | "sent";

const MSG_FILTERS: { id: MsgFilter; label: string }[] = [
  { id: "all", label: "همه" },
  { id: "draft", label: "فقط پیش‌نویس‌ها" },
  { id: "approved", label: "فقط تأییدشده‌ها" },
  { id: "sent", label: "فقط ارسال‌شده‌ها" },
];

/* ── پنل جزئیات لید (تحلیل + ریز امتیاز + تایم‌لاین) ───────── */

type LeadDetail = {
  lead: Lead;
  analysis: LeadAnalysis | null;
  runs: AgentRun[];
  /** آیا تحلیل خودکار پیج اینستاگرام روی سرور فعال است؟ */
  instagramAuto?: boolean;
};

function LeadPanel({
  lead,
  detail,
  igDraft,
  onIgDraftChange,
  onSaveIgNote,
  onClose,
}: {
  lead: Lead;
  detail: LeadDetail | null;
  igDraft: string;
  onIgDraftChange: (v: string) => void;
  onSaveIgNote: (v: string) => void;
  onClose: () => void;
}) {
  if (!detail) {
    return <p className="text-sm text-ink-muted">در حال بارگذاری جزئیات…</p>;
  }
  const a = detail.analysis;

  return (
    <div className="space-y-5">
      <h3 className="text-base font-extrabold text-ink">جزئیات تحلیل — {lead.businessName}</h3>

      {!a ? (
        <p className="text-sm text-ink-muted">
          هنوز تحلیل نشده است. دکمه‌ی «تحلیل لید» را در همین ردیف بزنید.
        </p>
      ) : (
        <>
          {/* درد اصلی — یافته‌ی کلیدی */}
          <section>
            <h4 className="text-sm font-extrabold text-ink">درد اصلی</h4>
            <p className="mt-1 rounded-lg border-e-4 border-brand-600 bg-surface px-3 py-2 text-sm leading-7 text-ink">
              {a.painPoint}
            </p>
          </section>

          <section>
            <h4 className="text-sm font-extrabold text-ink">خلاصه‌ی کسب‌وکار</h4>
            <p className="mt-1 text-sm leading-7 text-ink-muted">{a.businessSummary}</p>
            <p className="mt-1 text-sm text-ink-muted">مشتری هدف: {a.targetCustomer}</p>
          </section>

          {a.evidence.length > 0 && (
            <section>
              <h4 id={`ev-h-${lead.id}`} className="text-sm font-extrabold text-ink">شواهد</h4>
              <ul aria-labelledby={`ev-h-${lead.id}`} className="mt-1 space-y-1 text-sm text-ink-muted">
                {a.evidence.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            </section>
          )}

          {a.needSignals.length > 0 && (
            <section>
              <h4 id={`ns-h-${lead.id}`} className="text-sm font-extrabold text-ink">نشانه‌های نیاز</h4>
              <ul aria-labelledby={`ns-h-${lead.id}`} className="mt-1 space-y-1 text-sm text-ink-muted">
                {a.needSignals.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </section>
          )}

          {a.uncertainties.length > 0 && (
            <section>
              <h4 id={`un-h-${lead.id}`} className="text-sm font-extrabold text-ink">موارد نامطمئن</h4>
              <ul aria-labelledby={`un-h-${lead.id}`} className="mt-1 space-y-1 text-sm text-ink-muted">
                {a.uncertainties.map((u, i) => (
                  <li key={i}>• {u}</li>
                ))}
              </ul>
            </section>
          )}

          {a.recommendedService && (
            <section>
              <h4 className="text-sm font-extrabold text-ink">خدمت پیشنهادی</h4>
              <p className="mt-1 text-sm text-ink">
                {SERVICES.find((s) => s.id === a.recommendedService)?.title ?? a.recommendedService}
              </p>
            </section>
          )}
        </>
      )}

      {/* ریز امتیاز — وزن‌های قطعی از config */}
      {lead.score != null && (
        <section>
          <h4 id={`score-h-${lead.id}`} className="text-sm font-extrabold text-ink">
            ریز امتیاز
          </h4>
          <p className="mt-1 text-sm text-ink">
            امتیاز کل: <bdi>{fa(lead.score)}</bdi> از ۱۰۰ — وضعیت: {LEAD_STATUS_LABELS[lead.status]}
          </p>
          <dl aria-labelledby={`score-h-${lead.id}`} className="mt-2 grid gap-2 sm:grid-cols-2">
            {(Object.keys(SCORING_WEIGHTS) as ScoringCriterion[]).map((k) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-ink">
                  {CRITERION_LABELS[k]}{" "}
                  <span className="text-ink-muted">
                    (وزن <bdi>{fa(SCORING_WEIGHTS[k])}</bdi>)
                  </span>
                </dt>
                <dd className="text-sm font-bold text-ink">
                  <bdi>{fa(SCORING_WEIGHTS[k])}</bdi> امتیاز ممکن
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* توان مالی — تخمین از نشانه‌های عمومی، نه درآمد واقعی */}
      {lead.affluenceScore != null && lead.affluenceSignals.length > 0 && (
        <section>
          <h4 id={`aff-h-${lead.id}`} className="text-sm font-extrabold text-ink">
            نشانه‌های توان مالی — <bdi>{fa(lead.affluenceScore)}</bdi> از ۱۰۰
          </h4>
          <p className="mt-1 text-xs text-ink-muted">
            تخمینی از روی داده‌ی عمومی (تعداد نظر، نوع دامنه، منطقه، مقیاس نام). درآمد واقعی از
            داده‌ی عمومی قابل‌دانستن نیست، پس این عدد فقط برای اولویت‌بندی صف کار است و هرگز وارد
            متن پیام نمی‌شود.
          </p>
          <ul aria-labelledby={`aff-h-${lead.id}`} className="mt-2 space-y-1 text-sm text-ink-muted">
            {lead.affluenceSignals.map((s, i) => (
              <li key={i}>
                <span aria-hidden="true">• </span>
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* شناسنامه‌ی لید — صنعت/شهر/آدرس که از جدول بیرون رفتند تا شلوغ نشود */}
      <section>
        <h4 id={`ident-h-${lead.id}`} className="text-sm font-extrabold text-ink">
          شناسنامه
        </h4>
        <dl aria-labelledby={`ident-h-${lead.id}`} className="mt-1 space-y-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">صنعت:</dt>
            <dd className="text-ink">{lead.industry ?? "ثبت نشده"}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">شهر:</dt>
            <dd className="text-ink">{lead.city ?? "ثبت نشده"}</dd>
          </div>
          {lead.address && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">آدرس:</dt>
              <dd className="text-ink">{lead.address}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* یافته‌ی دستی اینستاگرام */}
      <section>
        <h4 className="text-sm font-extrabold text-ink">بررسی دستی پیج اینستاگرام</h4>
        <p id={`ig-hint-${lead.id}`} className="mt-1 text-xs leading-6 text-ink-muted">
          {detail.instagramAuto === false
            ? "تحلیل خودکار پیج خاموش است (کلید IG_ACCESS_TOKEN روی سرور تنظیم نشده). هرچه اینجا بنویسی مثل «مشاهده‌ی قطعی» وارد تحلیل و پیام بعدی می‌شود."
            : "هرچه اینجا بنویسی، علاوه بر داده‌ی خودکار، مثل «مشاهده‌ی قطعی» وارد تحلیل و پیام بعدی می‌شود."}
        </p>
        <label htmlFor={`ig-note-${lead.id}`} className="mt-2 block text-sm font-medium text-ink">
          یافته‌ی بررسی پیج {lead.businessName}
        </label>
        <textarea
          id={`ig-note-${lead.id}`}
          value={igDraft}
          aria-describedby={`ig-hint-${lead.id}`}
          onChange={(e) => onIgDraftChange(e.target.value)}
          rows={3}
          placeholder="مثال: ۱۲ هزار فالوئر، آخرین پست ۳ ماه پیش، بایو بدون لینک، بیشتر پست‌ها عکس ساده از محصول"
          className="mt-1 w-full rounded-lg border border-brand-400 bg-white px-3 py-2 text-sm leading-7 text-ink"
        />
        <button
          type="button"
          onClick={() => onSaveIgNote(igDraft)}
          aria-label={`ذخیره‌ی یافته‌ی اینستاگرام ${lead.businessName}`}
          className="mt-2 rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
        >
          ذخیره‌ی یافته
        </button>
      </section>

      {/* تایم‌لاین اجرای ایجنت‌ها */}
      {detail.runs.length > 0 && (
        <section>
          <h4 id={`runs-h-${lead.id}`} className="text-sm font-extrabold text-ink">
            تایم‌لاین اجرای ایجنت‌ها
          </h4>
          <ol aria-labelledby={`runs-h-${lead.id}`} className="mt-2 space-y-2">
            {detail.runs.map((r) => (
              <li key={r.id} className="rounded-lg border border-surface-line bg-surface p-3">
                <p className="font-bold text-ink">
                  <bdi>{r.agentName}</bdi>
                  {" — "}
                  <span className={r.status === "error" ? "text-danger" : "text-success"}>
                    <span aria-hidden="true">{r.status === "error" ? "✕ " : "✓ "}</span>
                    {RUN_STATUS_LABELS[r.status]}
                  </span>
                </p>
                <p className="mt-1 text-sm leading-6 text-ink-muted">{r.summary}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-surface-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-dim"
      >
        بستن جزئیات
      </button>
    </div>
  );
}

/* ── جدول لیدها (مشترک بین «همه» و «منتخب») ───────────────── */

/**
 * یک جدول برای هر دو فهرست.
 *
 * ستون‌ها عمداً کم شده‌اند (از ۹ به ۶): «شهر» تقریباً همیشه تهران بود و «تلفن»
 * عیناً در ستون کانال‌ها تکرار می‌شد. «صنعت» زیر نام کسب‌وکار رفت تا ردیف
 * باریک‌تر و قابل‌مرورتر شود. باقی اطلاعات در پنل جزئیات همان ردیف هست.
 *
 * `idPrefix` لازم است چون هر دو جدول هم‌زمان روی صفحه‌اند و بدون آن شناسه‌های
 * `lead-panel-*` تکراری می‌شدند — که هم HTML نامعتبر است هم aria-controls را
 * به گره اشتباه وصل می‌کند.
 */
function LeadsTable({
  leads,
  captionText,
  regionLabel,
  emptyText,
  idPrefix,
  selectedIds,
  onToggleSelect,
  openId,
  onTogglePanel,
  triggerRefs,
  details,
  igDrafts,
  onIgDraftChange,
  onSaveIgNote,
  busyAny,
  analyzingId,
  canMessage,
  onAnalyze,
  onGenerateMessage,
}: {
  leads: Lead[];
  captionText: string;
  /** نام کوتاه ناحیه‌ی اسکرول — عمداً با caption یکی نیست تا دوبار خوانده نشود */
  regionLabel: string;
  emptyText: string;
  idPrefix: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  openId: string | null;
  onTogglePanel: (id: string, prefix: string) => void;
  triggerRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  details: Record<string, LeadDetail>;
  igDrafts: Record<string, string>;
  onIgDraftChange: (id: string, v: string) => void;
  onSaveIgNote: (lead: Lead, v: string) => void;
  busyAny: boolean;
  analyzingId: string | null;
  canMessage: (l: Lead) => boolean;
  onAnalyze: (l: Lead) => void;
  onGenerateMessage: (l: Lead) => void;
}) {
  if (leads.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-surface-line bg-surface-dim p-6 text-center text-sm text-ink-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <div
      role="region"
      aria-label={regionLabel}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-surface-line shadow-card"
    >
      <table className="w-full min-w-[720px] border-collapse text-start text-sm">
        {/*
          توضیح ستون «توان مالی» عمداً در caption است نه در <th>: محتوای th جزو
          نام دسترس‌پذیر ستون است و پیش از **هر سلول** دوباره خوانده می‌شود.
        */}
        <caption className="sr-only">{captionText}</caption>
        <thead className="bg-surface-dim text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-3 font-semibold">
              <span className="sr-only">تیک انتخاب گروهی</span>
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">کسب‌وکار</th>
            <th scope="col" className="px-4 py-3 font-semibold">کانال‌های ارتباط</th>
            <th scope="col" aria-sort="descending" className="px-4 py-3 font-semibold">
              توان مالی
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">وضعیت</th>
            <th scope="col" className="px-4 py-3 font-semibold">عملیات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-line bg-surface">
          {leads.map((l) => {
            const panelId = `${idPrefix}-panel-${l.id}`;
            const refKey = `${idPrefix}:${l.id}`;
            const open = openId === refKey;
            return (
              <Fragment key={l.id}>
                <tr className="align-top">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      id={`${idPrefix}-sel-${l.id}`}
                      checked={selectedIds.has(l.id)}
                      onChange={() => onToggleSelect(l.id)}
                      className="h-6 w-6 accent-brand-600"
                    />
                    {/* نقشِ checkbox خودش «انتخاب» را می‌رساند؛ تکرارش در برچسب
                        باعث می‌شد «انتخاب، انتخاب فلان» خوانده شود */}
                    <label htmlFor={`${idPrefix}-sel-${l.id}`} className="sr-only">
                      {l.businessName}
                    </label>
                  </td>

                  <th scope="row" className="px-4 py-3 text-start font-medium text-ink">
                    <button
                      type="button"
                      ref={(el) => {
                        triggerRefs.current[refKey] = el;
                      }}
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => onTogglePanel(l.id, idPrefix)}
                      className="rounded px-1 py-1 text-start text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                    >
                      {l.businessName}
                    </button>
                    {/*
                      صنعت دیداری زیر نام می‌ماند ولی aria-hidden است: محتوای
                      <th scope="row"> پیش از **هر ۵ سلول** ردیف دوباره خوانده
                      می‌شود و صنعت را ۵ بار تکرار می‌کرد. همین مقدار در پنل
                      جزئیات همان ردیف برای screen reader آمده، پس داده‌ای
                      از دست نمی‌رود.
                    */}
                    {l.industry && (
                      <span
                        aria-hidden="true"
                        className="mt-0.5 block px-1 text-xs font-normal text-ink-muted"
                      >
                        {l.industry}
                      </span>
                    )}
                  </th>

                  <td className="px-4 py-3">
                    <Channels channels={l.contactChannels} businessName={l.businessName} />
                  </td>

                  <td className="px-4 py-3 text-ink-muted">
                    {l.affluenceScore != null ? (
                      <>
                        <bdi className="font-bold text-ink">{fa(l.affluenceScore)}</bdi>
                        <span className="sr-only"> از ۱۰۰</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">محاسبه نشده</span>
                      </>
                    )}
                    {/* امتیاز لید (بعد از تحلیل) زیر توان مالی — نه ستون جدا */}
                    {l.score != null && (
                      <span className="mt-0.5 block text-xs">
                        امتیاز لید: <bdi>{fa(l.score)}</bdi>
                        <span className="sr-only"> از ۱۰۰</span>
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span className="rounded-full bg-surface-dim px-2 py-0.5 text-xs font-medium text-ink">
                      {LEAD_STATUS_LABELS[l.status]}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    {/*
                      group بدون نام: نام هر دکمه خودش شامل نام کسب‌وکار است،
                      پس نام‌گذاری گروه باعث می‌شد نام سه بار پشت‌سرهم خوانده شود.
                    */}
                    <div role="group" className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-label={`تحلیل لید ${l.businessName}`}
                        aria-disabled={busyAny}
                        aria-describedby={busyAny ? "busy-block-note" : undefined}
                        onClick={() => {
                          if (busyAny) return;
                          onAnalyze(l);
                        }}
                        className={
                          busyAny
                            ? "rounded-lg border border-ink-muted bg-surface px-3 py-2 text-sm font-bold text-ink-muted"
                            : "rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700"
                        }
                      >
                        {analyzingId === l.id ? "در حال تحلیل…" : "تحلیل لید"}
                      </button>

                      {/* تولید پیام فقط بعد از تحلیل و امتیازگرفتن — سرور هم چک می‌کند */}
                      <button
                        type="button"
                        aria-label={`تولید پیام اختصاصی برای ${l.businessName}`}
                        aria-disabled={busyAny || !canMessage(l)}
                        aria-describedby={
                          !canMessage(l) ? "msg-gate-note" : busyAny ? "busy-block-note" : undefined
                        }
                        onClick={() => {
                          if (busyAny || !canMessage(l)) return;
                          onGenerateMessage(l);
                        }}
                        className={
                          busyAny || !canMessage(l)
                            ? "rounded-lg border border-ink-muted bg-surface px-3 py-2 text-sm font-bold text-ink-muted"
                            : "rounded-lg bg-pine px-3 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
                        }
                      >
                        تولید پیام
                      </button>
                    </div>
                  </td>
                </tr>

                {/* پنل جزئیات — همیشه رندر، فقط hidden جابه‌جا می‌شود */}
                <tr id={panelId} hidden={!open}>
                  <td colSpan={6} className="bg-surface-dim px-4 py-5">
                    <LeadPanel
                      lead={l}
                      detail={details[l.id] ?? null}
                      igDraft={igDrafts[l.id] ?? l.igNote ?? ""}
                      onIgDraftChange={(v) => onIgDraftChange(l.id, v)}
                      onSaveIgNote={(v) => onSaveIgNote(l, v)}
                      onClose={() => onTogglePanel(l.id, idPrefix)}
                    />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── کامپوننت اصلی ────────────────────────────────────────── */

export function Studio() {
  const { needsLogin, ready, onUnauthorized, onLoggedIn } = useStudioAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<
    null | "load" | "create" | "discover" | "manual" | "csv" | "affluence" | "shortlist"
  >(null);

  // تحلیل لید (فاز ۳)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [msgGenRunning, setMsgGenRunning] = useState(false);
  const [igDrafts, setIgDrafts] = useState<Record<string, string>>({});
  // انتخاب چک‌باکسی — هر جدول Set خودش را دارد تا انتخاب‌ها قاطی نشوند
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shortSelectedIds, setShortSelectedIds] = useState<Set<string>>(new Set());
  const [remaining, setRemaining] = useState<number | null>(null);
  // کانال اعلان زنده‌ی جدا. nonce لازم است: اگر متن دقیقاً تکراری باشد، React
  // گره‌ی متنی را عوض نمی‌کند و screen reader چیزی اعلام نمی‌کند.
  const [taskStatusState, setTaskStatusState] = useState<{ text: string; n: number }>({
    text: "",
    n: 0,
  });
  const setTaskStatus = useCallback(
    (text: string) => setTaskStatusState((p) => ({ text, n: p.n + 1 })),
    []
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, LeadDetail>>({});
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // پیام‌ها (فاز ۴)
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Record<string, string>>({});
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [msgBusyId, setMsgBusyId] = useState<string | null>(null);
  const [msgFilter, setMsgFilter] = useState<MsgFilter>("all");
  const [armed, setArmed] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);
  const actionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const confirmRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const emailTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // عنوان کارت همیشه رندر است؛ بعد از تأیید/رد که دکمه‌ها unmount می‌شوند،
  // فوکوس به اینجا برمی‌گردد (وگرنه فوکوس به body می‌افتد).
  const cardHeadingRefs = useRef<Record<string, HTMLHeadingElement | null>>({});
  // سرتیتر هر بخش — بعد از جابه‌جایی انبوه، فوکوس به مقصد می‌رود
  const leadsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const shortlistHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // فوکوس روی دکمه‌ی تأیید نهایی — همین جابه‌جایی خودش «اعلانِ» مسلح‌شدن است
  useEffect(() => {
    if (armed) confirmRefs.current[`${armed.id}:${armed.action}`]?.focus();
  }, [armed]);

  /** لغو حالت مسلح + بازگرداندن فوکوس به دکمه‌ی آغازگر (اول فوکوس، بعد hidden) */
  const disarm = useCallback(() => {
    if (armed) actionRefs.current[`${armed.id}:${armed.action}`]?.focus();
    setArmed(null);
  }, [armed]);

  // Escape در هر جای صفحه حالت مسلح را لغو می‌کند — نه فقط وقتی فوکوس داخل کارت است
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") disarm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed, disarm]);

  // فرم کمپین جدید
  const [name, setName] = useState("");
  const [market, setMarket] = useState("all"); // پیش‌فرض: همه‌ی بازارها ترکیبی
  const [city, setCity] = useState("تهران");
  const [service, setService] = useState(ALL_SERVICES_ID); // پیش‌فرض: همه‌ی موارد

  // افزودن دستی لید
  const [mName, setMName] = useState("");
  const [mInstagram, setMInstagram] = useState("");
  const [mPhone, setMPhone] = useState("");
  const [mWebsite, setMWebsite] = useState("");
  const [mCity, setMCity] = useState("تهران");
  const [csv, setCsv] = useState("");

  const loadCampaigns = useCallback(async () => {
    const { campaigns } = await api<{ campaigns: Campaign[] }>("/api/campaigns");
    setCampaigns(campaigns);
    return campaigns;
  }, []);

  const loadLeads = useCallback(async (campaignId: string) => {
    const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    const { leads } = await api<{ leads: Lead[] }>(`/api/leads${q}`);
    // نزولی بر اساس توان مالی: صف کار باید از ارزشمندترین شروع شود، چون همان
    // ترتیبی است که تحلیل گروهی هم روی سرور رعایت می‌کند.
    setLeads([...leads].sort((a, b) => (b.affluenceScore ?? -1) - (a.affluenceScore ?? -1)));
    // شمارنده‌ی «تحلیل‌نشده» از همین داده محاسبه می‌شود (بدون درخواست اضافه)
    setRemaining(leads.filter((l) => l.status === "NEW").length);
  }, []);

  /** پیام‌های کمپین انتخابی + نتیجه‌ی زنده‌ی نگهبان سیاست (صفر توکن) */
  const loadMessages = useCallback(async (campaignId: string) => {
    const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    const { messages } = await api<{ messages: MessageView[] }>(`/api/messages${q}`);
    setMessages(messages);
  }, []);

  const bootstrap = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const cs = await loadCampaigns();
      if (cs[0]) {
        setSelectedId(cs[0].id);
        await loadLeads(cs[0].id);
        await loadMessages(cs[0].id);
      }
    } catch (e) {
      // ۴۰۱ خطا نیست، یعنی «هنوز وارد نشده‌ای» — فرم ورود جای پیام خطا می‌آید
      if (e instanceof UnauthorizedError) onUnauthorized();
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [loadCampaigns, loadLeads, loadMessages, onUnauthorized]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (ready && needsLogin) {
    return (
      <StudioLogin
        onSaved={() => {
          onLoggedIn();
          void bootstrap();
        }}
      />
    );
  }

  async function selectCampaign(id: string) {
    setSelectedId(id);
    setError("");
    setNotice("");
    setArmed(null);
    try {
      await loadLeads(id);
      await loadMessages(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createCampaign(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const { campaign } = await api<{ campaign: Campaign }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({ name, market, city, primaryService: service }),
      });
      setName("");
      await loadCampaigns();
      setSelectedId(campaign.id);
      await loadLeads(campaign.id);
      setNotice(`کمپین «${campaign.name}» ساخته شد.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function discover() {
    if (!selectedId) return;
    setBusy("discover");
    setError("");
    setNotice("");
    try {
      const { summary } = await api<{
        summary: {
          found: number;
          inserted: number;
          duplicates: number;
          invalid: number;
          webSearches: number;
          webLeads: number;
        };
      }>("/api/discovery", { method: "POST", body: JSON.stringify({ campaignId: selectedId }) });
      setNotice(
        `کشف انجام شد: ${fa(summary.found)} یافت، ${fa(summary.inserted)} جدید، ${fa(summary.duplicates)} تکراری، ${fa(summary.invalid)} نامعتبر — ` +
          `${fa(summary.webSearches)} جست‌وجوی وب مصرف شد و ${fa(summary.webLeads)} لید از آن آمد.`
      );
      await loadLeads(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * تحلیل یک لید — دکمه‌ی هر ردیف.
   *
   * `force: true` می‌فرستد تا **دروازه‌ی توان مالی نادیده گرفته شود**: کلیک انسان
   * روی یک ردیف مشخص اراده‌ی صریح است و بر غربال خودکار مقدم. پس با این دکمه
   * می‌توان لید «کم‌ارزش» را هم تحلیل کرد.
   */
  async function analyze(lead: Lead) {
    if (busyAny) return; // گارد: یک کار مدل‌محور در یک زمان (rate-limit مدل)
    setAnalyzingId(lead.id);
    setError("");
    setTaskStatus(`تحلیل «${lead.businessName}» شروع شد…`);
    try {
      let last = "";
      for (let i = 0; i < 8; i++) {
        const res = await api<{ step: { ran: string; status: LeadStatus; score: number | null; summary: string } | null; done: boolean }>(
          "/api/pipeline",
          { method: "POST", body: JSON.stringify({ leadId: lead.id, step: true, force: true }) }
        );
        if (!res.step) break;
        last = res.step.summary;
        setTaskStatus(`«${lead.businessName}»: ${res.step.summary}`);
        if (res.done) break;
      }
      setTaskStatus(`تحلیل «${lead.businessName}» کامل شد. ${last}`);
      if (selectedId) {
        await loadLeads(selectedId);
        await loadMessages(selectedId);
      }
      await loadDetail(lead.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`تحلیل «${lead.businessName}» ناموفق بود: ${msg}`);
      setTaskStatus("");
    } finally {
      setAnalyzingId(null);
    }
  }

  /**
   * محاسبه‌ی توان مالی همه‌ی لیدهای کمپین — **صفر توکن، یک درخواست**.
   *
   * این کار را پیش از تحلیل گروهی بزن: بعدش می‌بینی کدام لیدها ارزش خرج توکن
   * دارند و کدام‌ها نه، بدون اینکه یک درخواست هم از سهمیه رفته باشد.
   */
  async function computeAffluence() {
    if (!selectedId || busyAny || busy === "affluence") return;
    setBusy("affluence");
    setError("");
    setNotice("");
    setTaskStatus("محاسبه‌ی توان مالی شروع شد. این کار هیچ توکنی مصرف نمی‌کند.");
    try {
      const res = await api<{
        changed: number;
        total: number;
        worthAnalyzing: number;
        threshold: number;
      }>("/api/pipeline", {
        method: "POST",
        body: JSON.stringify({ campaignId: selectedId, only: "affluence" }),
      });
      await loadLeads(selectedId);
      const msg =
        `توان مالی هر ${fa(res.total)} لید از نو محاسبه شد (${fa(res.changed)} نمره عوض شد). ` +
        `${fa(res.worthAnalyzing)} لید نمره‌ی ${fa(res.threshold)} یا بالاتر دارند و ارزش تحلیل دارند؛ ` +
        `${fa(res.total - res.worthAnalyzing)} تا کم‌ارزش‌اند و تحلیل گروهی سراغشان نمی‌رود.`;
      setNotice(msg);
      setTaskStatus(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTaskStatus("");
    } finally {
      setBusy(null);
    }
  }

  /**
   * تحلیل گروهی لیدهای کمپین.
   *
   * هر درخواست فقط **یک** لید را پردازش می‌کند (هر لید ~۳۰ ثانیه؛ سقف زمان تابع
   * روی Vercel رایگان ۶۰ ثانیه است — چند لید در یک درخواست یعنی خطای 504).
   * کلاینت این درخواست‌ها را پشت‌سرهم می‌فرستد و پس از هر لید پیشرفت واقعی را
   * اعلام می‌کند. سقف هر نوبت BATCH_PER_CLICK است تا کاربر کنترل داشته باشد و
   * سهمیه‌ی روزانه‌ی مدل رایگان یک‌جا مصرف نشود.
   */
  async function analyzeBatch() {
    if (batchRunning || analyzingId || !selectedId) return;

    // سقف ایمنی فقط برای جلوگیری از حلقه‌ی بی‌پایان در صورت باگ سرور —
    // نه محدودیت کاربر. هر لید حداکثر ۳ گام دارد.
    const MAX_STEPS = 600;

    setBatchRunning(true);
    setError("");
    setNotice("");
    setTaskStatus(
      "تحلیل فهرست منتخب شروع شد. لیدهای منتخب یکی‌یکی و پشت‌سرهم تحلیل می‌شوند تا همه تمام شوند. " +
        "دکمه‌های «تحلیل لید» و «تولید پیام» در جدول‌ها تا پایان کار غیرفعال هستند."
    );

    let analyzed = 0; // تعداد لیدهایی که تحلیلشان کامل شد
    let drafted = 0; // تعداد پیام‌هایی که پیش‌نویس شد
    let skipped = 0; // لیدهایی که دروازه‌ی توان مالی کنار گذاشت (بدون مصرف توکن)
    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        const res = await api<{
          step: { ran: string; status: string; score: number | null } | null;
          businessName?: string;
          affluenceScore?: number | null;
          remaining: number;
          done: boolean;
        }>("/api/pipeline", {
          method: "POST",
          body: JSON.stringify({ campaignId: selectedId, scope: "shortlist" }),
        });

        if (res.done || !res.step) break; // چیزی برای پردازش نمانده

        setRemaining(res.remaining);

        // دروازه‌ی توان مالی — صفر توکن، لید کنار گذاشته شد
        if (res.step.ran === "affluence-gate") {
          skipped++;
          setTaskStatus(
            `«${res.businessName ?? "لید"}» با توان مالی ${fa(res.affluenceScore ?? 0)} کنار گذاشته شد (بدون مصرف توکن). ` +
              `${fa(res.remaining)} لید باقی مانده.`
          );
          await loadLeads(selectedId).catch(() => {});
        }

        // فقط وقتی یک لید تحلیل و امتیازدهی شد اعلام کن (نه هر گام ریز)
        if (res.step.ran === "analysis") {
          analyzed++;
          setTaskStatus(
            `«${res.businessName ?? "لید"}» تحلیل شد` +
              (res.step.score != null ? ` — امتیاز ${fa(res.step.score)}` : "") +
              `. ${fa(res.remaining)} لید باقی مانده. در حال ادامه…`
          );
          // جدول را در حین کار به‌روز نگه دار تا پیشرفت دیده شود
          await loadLeads(selectedId).catch(() => {});
        }

        // زیرگام‌های تولید پیام (فاز ۴) — هر کدام یک فراخوان مدل، تا از سقف
        // ۶۰ ثانیه‌ای تابع رد نشود. فقط «message» یعنی کار آن لید تمام شد.
        if (res.step.ran === "message-draft") {
          setTaskStatus(`برای «${res.businessName ?? "لید"}» پیش‌نویس پیام نوشته شد؛ حالا منتقد نمره می‌دهد…`);
        }
        if (res.step.ran === "message-revise") {
          setTaskStatus(`پیام «${res.businessName ?? "لید"}» طبق ایرادهای منتقد بازنویسی شد؛ نقد دوباره…`);
        }
        if (res.step.ran === "message") {
          drafted++;
          setTaskStatus(
            `پیام «${res.businessName ?? "لید"}» آماده شد و در بخش پیام‌ها منتظر تأیید توست. در حال ادامه…`
          );
          await loadMessages(selectedId).catch(() => {});
        }
      }

      await loadLeads(selectedId);
      await loadMessages(selectedId).catch(() => {});
      setTaskStatus(
        `تحلیل فهرست منتخب تمام شد. ${fa(analyzed)} لید تحلیل شد و ${fa(drafted)} پیش‌نویس پیام ساخته شد. ` +
          (skipped > 0
            ? `${fa(skipped)} لید کم‌ارزش بدون مصرف توکن کنار گذاشته شد. `
            : "") +
          "جدول لیدها و بخش پیام‌ها به‌روزرسانی شد."
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        analyzed > 0
          ? `${fa(analyzed)} لید تحلیل شد، سپس خطا رخ داد: ${msg} — می‌توانید دوباره دکمه را بزنید تا ادامه دهد.`
          : `تحلیل فهرست منتخب ناموفق بود: ${msg}`
      );
      setTaskStatus("");
      await loadLeads(selectedId).catch(() => {});
    } finally {
      setBatchRunning(false);
    }
  }

  /**
   * تولید پیام برای **یک** لید — دکمه‌ی هر ردیف جدول.
   *
   * گام پیام سه زیرگام دارد (نویسنده → منتقد → بازنویسی) و هر کدام یک فراخوان
   * مدل است، پس مثل تحلیل گروهی، کلاینت گام‌ها را پشت‌سرهم می‌زند تا از سقف
   * ۶۰ ثانیه‌ای تابع Vercel رد نشود.
   */
  async function generateMessageFor(lead: Lead) {
    if (analyzingId || batchRunning || msgGenRunning) return;
    setAnalyzingId(lead.id);
    setError("");
    setTaskStatus(`تولید پیام برای «${lead.businessName}» شروع شد…`);
    try {
      for (let i = 0; i < 8; i++) {
        // only:"message" → سرور اگر لید تحلیل‌نشده باشد ۴۰۹ می‌دهد و توکنی خرج نمی‌شود
        const res = await api<{ step: { ran: string; summary: string } | null; done: boolean }>(
          "/api/pipeline",
          { method: "POST", body: JSON.stringify({ leadId: lead.id, step: true, only: "message" }) }
        );
        if (!res.step) break;
        setTaskStatus(`«${lead.businessName}»: ${res.step.summary}`);
        if (res.done) break;
      }
      if (selectedId) {
        await loadLeads(selectedId);
        await loadMessages(selectedId);
      }
      setTaskStatus(`پیام «${lead.businessName}» آماده شد و در بخش پیام‌ها منتظر تأیید توست.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`تولید پیام «${lead.businessName}» ناموفق بود: ${msg}`);
      setTaskStatus("");
    } finally {
      setAnalyzingId(null);
    }
  }

  /**
   * تولید پیام برای **همه‌ی** لیدهای آماده‌ی کمپین — دقیقاً مثل تحلیل گروهی:
   * یکی‌یکی، پشت‌سرهم، تا آخر. حالت `only: "message"` باعث می‌شود سهمیه‌ی مدل
   * صرف تحلیل نشود.
   */
  async function generateAllMessages() {
    if (msgGenRunning || batchRunning || analyzingId || !selectedId) return;

    const MAX_STEPS = 800; // سقف ایمنی در برابر باگ سرور، نه محدودیت کاربر
    setMsgGenRunning(true);
    setError("");
    setNotice("");
    setTaskStatus("تولید پیام برای فهرست منتخب شروع شد. لیدها یکی‌یکی و پشت‌سرهم پیام می‌گیرند تا همه تمام شوند.");

    let made = 0;
    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        const res = await api<{
          step: { ran: string; summary: string } | null;
          businessName?: string;
          remaining: number;
          done: boolean;
        }>("/api/pipeline", {
          method: "POST",
          body: JSON.stringify({ campaignId: selectedId, only: "message", scope: "shortlist" }),
        });

        if (res.done || !res.step) break;

        if (res.step.ran === "message") {
          made++;
          setTaskStatus(
            `پیام «${res.businessName ?? "لید"}» آماده شد. ${fa(res.remaining)} لید باقی مانده. در حال ادامه…`
          );
          await loadMessages(selectedId).catch(() => {});
          await loadLeads(selectedId).catch(() => {});
        } else {
          setTaskStatus(`«${res.businessName ?? "لید"}»: ${res.step.summary}`);
        }
      }

      await loadLeads(selectedId);
      await loadMessages(selectedId);
      setTaskStatus(`تولید پیام فهرست منتخب تمام شد. ${fa(made)} پیام آماده‌ی تأیید است.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        made > 0
          ? `${fa(made)} پیام ساخته شد، سپس خطا رخ داد: ${msg} — می‌توانی دوباره دکمه را بزنی تا ادامه دهد.`
          : `تولید پیام فهرست منتخب ناموفق بود: ${msg}`
      );
      setTaskStatus("");
      await loadMessages(selectedId).catch(() => {});
    } finally {
      setMsgGenRunning(false);
    }
  }

  /* ── فهرست منتخب ────────────────────────────────────────── */

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleShortSelect = useCallback((id: string) => {
    setShortSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** لیدهای تیک‌خورده را به فهرست منتخب می‌فرستد (یک درخواست، صفر توکن) */
  async function addToShortlist() {
    if (selectedIds.size === 0 || !selectedId) return;
    setBusy("shortlist");
    setError("");
    try {
      const ids = Array.from(selectedIds);
      const res = await api<{ updated: number }>("/api/leads", {
        method: "PATCH",
        body: JSON.stringify({ ids, shortlisted: true }),
      });
      setSelectedIds(new Set());
      // پنل باز را ببند: کلیدش شامل پیشوند جدول است («all:leadX»)، و لیدی که
      // جابه‌جا می‌شود دیگر در آن جدول نیست — پس کلید هرگز دوباره جور نمی‌شود
      // و بازگرداندن فوکوس به یک گره جداشده اشاره می‌کند.
      setOpenId(null);
      await loadLeads(selectedId);
      // فوکوس به مقصد: سرتیتر «فهرست منتخب» شمارنده‌ی جدید را دارد
      shortlistHeadingRef.current?.focus();
      setTaskStatus(`${fa(res.updated)} لید به فهرست منتخب اضافه شد.`);
      setNotice(`${fa(res.updated)} لید به فهرست منتخب اضافه شد.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** لیدهای تیک‌خورده‌ی منتخب را به فهرست اصلی برمی‌گرداند */
  async function removeFromShortlist() {
    if (shortSelectedIds.size === 0 || !selectedId) return;
    setBusy("shortlist");
    setError("");
    try {
      const ids = Array.from(shortSelectedIds);
      const res = await api<{ updated: number }>("/api/leads", {
        method: "PATCH",
        body: JSON.stringify({ ids, shortlisted: false }),
      });
      setShortSelectedIds(new Set());
      setOpenId(null); // همان دلیل addToShortlist
      await loadLeads(selectedId);
      leadsHeadingRef.current?.focus();
      setTaskStatus(`${fa(res.updated)} لید به فهرست اصلی برگشت.`);
      setNotice(`${fa(res.updated)} لید به فهرست اصلی برگشت.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** ثبت یافته‌ی دستی بررسی پیج اینستاگرام */
  async function saveIgNote(leadId: string, businessName: string, note: string) {
    setError("");
    try {
      await api(`/api/leads/${leadId}`, {
        method: "PATCH",
        body: JSON.stringify({ igNote: note }),
      });
      await loadDetail(leadId);
      if (selectedId) await loadLeads(selectedId).catch(() => {});
      setTaskStatus(
        note.trim()
          ? `یافته‌ی اینستاگرام «${businessName}» ذخیره شد و در تحلیل و پیام بعدی استفاده می‌شود.`
          : `یافته‌ی اینستاگرام «${businessName}» پاک شد.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /* ── عملیات پیام (فاز ۴ — تأیید انسانی اجباری) ─────────── */

  /** ذخیره‌ی متن ویرایش‌شده؛ سرور دوباره نگهبان سیاست را روی متن جدید اجرا می‌کند */
  async function saveEdit(m: MessageView) {
    const text = (drafts[m.id] ?? currentText(m)).trim();
    if (!text) {
      setCardError((p) => ({ ...p, [m.id]: "متن پیام نمی‌تواند خالی باشد." }));
      setTaskStatus(`خطا در پیام «${m.businessName}»: متن پیام نمی‌تواند خالی باشد.`);
      document.getElementById(`msg-text-${m.id}`)?.focus();
      return;
    }
    setMsgBusyId(m.id);
    setCardError((p) => ({ ...p, [m.id]: "" }));
    setTaskStatus(`در حال ذخیره‌ی متن پیام «${m.businessName}»…`);
    try {
      await api("/api/messages", {
        method: "PATCH",
        body: JSON.stringify({ id: m.id, action: "edit", text }),
      });
      if (selectedId) await loadMessages(selectedId);
      setDrafts((p) => {
        const next = { ...p };
        delete next[m.id];
        return next;
      });
      setSavedAt((p) => ({ ...p, [m.id]: "ذخیره شد" }));
      setTaskStatus(
        `متن پیام «${m.businessName}» ذخیره و دوباره توسط نگهبان سیاست بررسی شد. نتیجه‌ی جدید در همین کارت آمده است.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardError((p) => ({ ...p, [m.id]: msg }));
      setTaskStatus(`خطا در ذخیره‌ی پیام «${m.businessName}»: ${msg}`);
    } finally {
      setMsgBusyId(null);
    }
  }

  /** تأیید / رد / ثبت ارسال — همیشه پس از یک گام تأیید دوم (بدون confirm مرورگر) */
  async function runAction(m: MessageView, action: "approve" | "reject" | "sent") {
    const key = `${m.id}:${action}`;
    setMsgBusyId(m.id);
    setCardError((p) => ({ ...p, [m.id]: "" }));
    setTaskStatus(
      action === "approve"
        ? `در حال تأیید پیام «${m.businessName}»…`
        : action === "reject"
          ? `در حال رد پیام «${m.businessName}»…`
          : `در حال ثبت ارسال پیام «${m.businessName}»…`
    );
    try {
      await api("/api/messages", {
        method: "PATCH",
        body: JSON.stringify({ id: m.id, action }),
      });
      setArmed(null);
      if (selectedId) {
        await loadMessages(selectedId);
        await loadLeads(selectedId).catch(() => {});
      }
      setTaskStatus(
        action === "approve"
          ? `پیام «${m.businessName}» تأیید شد. حالا می‌توانی متن را کپی کنی، نمونه‌کارها را اتچ کنی و بعد از ارسال، «ثبت ارسال» را بزنی.`
          : action === "reject"
            ? `پیام «${m.businessName}» رد شد و ارسال نمی‌شود.`
            : `ارسال پیام «${m.businessName}» ثبت شد.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCardError((p) => ({ ...p, [m.id]: msg }));
      setTaskStatus(`خطا در پیام «${m.businessName}»: ${msg}`);
      setArmed(null);
    } finally {
      setMsgBusyId(null);
      // بعد از موفقیت، دکمه‌ی آغازگر unmount می‌شود (وضعیت پیام عوض شده)؛
      // پس فوکوس به عنوان کارت می‌رود که همیشه هست و وضعیت جدید را دارد.
      requestAnimationFrame(() => {
        const h = cardHeadingRefs.current[m.id];
        if (h) h.focus();
        else actionRefs.current[key]?.focus();
      });
    }
  }

  /** جزئیات یک لید (تحلیل + تایم‌لاین) */
  const loadDetail = useCallback(async (leadId: string) => {
    try {
      const d = await api<LeadDetail>(`/api/leads/${leadId}`);
      setDetails((prev) => ({ ...prev, [leadId]: d }));
    } catch {
      /* جزئیات اختیاری است — سکوت */
    }
  }, []);

  /**
   * باز/بسته‌کردن پنل جزئیات.
   * کلید شامل پیشوند جدول است چون یک لید می‌تواند هم‌زمان در جدول «همه» و
   * «منتخب» نباشد ولی شناسه‌های DOM باید یکتا بمانند.
   */
  function togglePanel(leadId: string, prefix = "all") {
    const key = `${prefix}:${leadId}`;
    if (openId === key) {
      setOpenId(null);
      triggerRefs.current[key]?.focus(); // بازگرداندن فوکوس
      return;
    }
    setOpenId(key);
    if (!details[leadId]) void loadDetail(leadId);
  }

  async function addManualLead(e: FormEvent) {
    e.preventDefault();
    setBusy("manual");
    setError("");
    setNotice("");
    try {
      await api("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          campaignId: selectedId || null,
          businessName: mName,
          city: mCity,
          instagram: mInstagram,
          phone: mPhone,
          website: mWebsite,
        }),
      });
      setMName("");
      setMInstagram("");
      setMPhone("");
      setMWebsite("");
      setNotice("لید دستی اضافه شد.");
      if (selectedId) await loadLeads(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function importCsv() {
    setBusy("csv");
    setError("");
    setNotice("");
    try {
      const leads = csv
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [businessName, instagram, phone, website] = line.split(",").map((s) => (s ?? "").trim());
          return { businessName, instagram, phone, website, city: mCity };
        })
        .filter((x) => x.businessName);
      if (leads.length === 0) {
        setError("هیچ ردیف معتبری در متن CSV نبود.");
        return;
      }
      const res = await api<{ inserted: number; duplicates: number; invalid: number }>("/api/leads", {
        method: "POST",
        body: JSON.stringify({ campaignId: selectedId || null, leads }),
      });
      setCsv("");
      setNotice(`ورود CSV: ${res.inserted} افزوده، ${res.duplicates} تکراری، ${res.invalid} نامعتبر.`);
      if (selectedId) await loadLeads(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /* ── مقادیر مشتق‌شده ────────────────────────────────────── */

  /**
   * هر کار مدل‌محور در یک زمان. دلیل: سهمیه‌ی روزانه‌ی مدل رایگان محدود است و
   * چند درخواست هم‌زمان هم rate-limit می‌خورد هم پیشرفت را غیرقابل‌پیگیری می‌کند.
   */
  const busyAny = batchRunning || msgGenRunning || analyzingId !== null;

  /** پیام فقط برای لیدی معنا دارد که تحلیل و امتیازدهی شده و منتظر پیام است */
  const canMessage = (l: Lead) => l.status === "READY_FOR_MESSAGE";

  /**
   * دو فهرست جدا — تیک‌خورده‌ها از فهرست اصلی بیرون می‌روند تا شلوغ نشود.
   *
   * مرتب‌سازی نزولیِ توان مالی **اینجا** هم انجام می‌شود، نه فقط در loadLeads:
   * تضمینِ ترتیب باید کنار خودِ فهرست باشد تا اگر روزی جای دیگری هم leads
   * ست شود (مثلاً به‌روزرسانی خوش‌بینانه)، ترتیب نشکند. لید بدون نمره ته صف
   * می‌رود چون هنوز معلوم نیست چقدر می‌ارزد.
   */
  const byAffluenceDesc = (a: Lead, b: Lead) => (b.affluenceScore ?? -1) - (a.affluenceScore ?? -1);
  const shortlisted = leads.filter((l) => l.shortlisted).sort(byAffluenceDesc);
  const unshortlisted = leads.filter((l) => !l.shortlisted).sort(byAffluenceDesc);

  /*
    شمارنده‌های دکمه‌های گروهی — همه بر اساس **فهرست منتخب**، نه کل کمپین.
    جریان کار: انتخاب دستی → منتخب → تحلیل همه → پیام همه.
  */

  /** لیدهای منتخبی که هنوز تحلیل نشده‌اند */
  const shortUnanalyzed = shortlisted.filter(
    (l) => l.status === "NEW" || l.status === "LOW_VALUE" || l.status === "SCORED"
  ).length;
  /** لیدهای منتخب آماده‌ی پیام */
  const shortReadyForMessage = shortlisted.filter(canMessage).length;

  /** تحلیل گروهی وقتی معنا دارد که دست‌کم یک لید منتخبِ تحلیل‌نشده باشد */
  const canAnalyzeShortlist = shortUnanalyzed > 0;
  /**
   * پیام گروهی فقط وقتی که **همه‌ی** منتخب‌ها تحلیل شده‌اند و دست‌کم یکی
   * آماده‌ی پیام است — تا نصفه‌کاره شروع نشود.
   */
  const canGenerateAll = shortReadyForMessage > 0 && shortUnanalyzed === 0;

  const visibleMessages = msgFilter === "all" ? messages : messages.filter((m) => m.status === msgFilter);
  const blockedCount = messages.filter((m) => m.policy.verdict === "BLOCK").length;
  const reviewCount = messages.filter((m) => m.policy.verdict === "HUMAN_REVIEW").length;
  const readyCount = messages.filter(
    (m) => m.status === "draft" && m.policy.verdict === "PASS"
  ).length;

  return (
    <div className="space-y-10">
      {/* کانال اعلان کارهای پس‌زمینه — همیشه رندر؛ key باعث اعلام پیام تکراری می‌شود */}
      <div role="status" className="sr-only">
        <span key={taskStatusState.n}>{taskStatusState.text}</span>
      </div>

      {/* توضیح‌های مشترک sr-only (دلیل غیرفعال‌بودن دکمه‌ها) */}
      <span id="batch-block-note" className="sr-only">
        {batchRunning ? "تحلیل گروهی در حال اجراست؛ تا پایان آن این دکمه غیرفعال است." : ""}
      </span>
      <span id="busy-block-note" className="sr-only">
        {busyAny ? "یک کار مدل‌محور در حال اجراست؛ تا پایان آن این دکمه غیرفعال است." : ""}
      </span>
      <span id="policy-block-note" className="sr-only">
        نگهبان سیاست این پیام را مسدود کرده است؛ سرور تأیید آن را نمی‌پذیرد. ابتدا متن را ویرایش و
        ذخیره کنید تا دوباره بررسی شود.
      </span>
      <span id="msg-gate-note" className="sr-only">
        تولید پیام فقط برای لیدی ممکن است که تحلیل و امتیازدهی شده و در وضعیت «آماده‌ی پیام» است.
        ابتدا دکمه‌ی «تحلیل لید» را بزنید.
      </span>
      <span id="shortlist-gate-note" className="sr-only">
        این دکمه وقتی فعال می‌شود که در جدول «همه‌ی لیدها» دست‌کم یک لید را تیک زده باشید.
      </span>
      <span id="unshortlist-gate-note" className="sr-only">
        این دکمه وقتی فعال می‌شود که در جدول «فهرست منتخب» دست‌کم یک لید را تیک زده باشید.
      </span>
      <span id="msg-all-gate-note" className="sr-only">
        این دکمه وقتی فعال می‌شود که همه‌ی لیدهای فهرست منتخب تحلیل و امتیازدهی شده باشند و دست‌کم
        یک لید در وضعیت «آماده‌ی پیام» باشد.
      </span>
      <span id="analyze-all-gate-note" className="sr-only">
        این دکمه وقتی فعال می‌شود که در فهرست منتخب دست‌کم یک لید تحلیل‌نشده باشد.
      </span>

      {/* پیام‌های وضعیت (زنده برای screen reader) */}
      <div aria-live="polite" className="space-y-2">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg border border-success/30 bg-success-soft px-4 py-2 text-sm text-success">
            {notice}
          </p>
        )}
      </div>

      {/* ── ساخت کمپین ── */}
      <section aria-labelledby="new-campaign-heading">
        <h2 id="new-campaign-heading" className="mb-4 text-lg font-extrabold text-ink">
          کمپین جدید
        </h2>
        <form
          onSubmit={createCampaign}
          className="grid gap-4 rounded-xl border border-surface-line bg-surface p-5 shadow-card sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="c-market" className="text-sm font-medium text-ink">
              بازار هدف
            </label>
            <select
              id="c-market"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            >
              <option value="all">همه‌ی بازارها (ترکیبی)</option>
              {MARKETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="c-city" className="text-sm font-medium text-ink">
              شهر
            </label>
            <input
              id="c-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              placeholder="تهران"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="c-service" className="text-sm font-medium text-ink">
              خدمت اصلی
            </label>
            <select
              id="c-service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              aria-describedby="c-service-note"
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            >
              <option value={ALL_SERVICES_ID}>همه‌ی موارد (سیستم خودش انتخاب می‌کند)</option>
              {SERVICES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <p id="c-service-note" className="text-xs text-ink-muted">
              این فقط یک یادداشت کمپین است؛ در هر حال ایجنت متناسب‌ترین خدمت را با درد همان
              کسب‌وکار انتخاب می‌کند.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="c-name" className="text-sm font-medium text-ink">
              نام (اختیاری)
            </label>
            <input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
              placeholder="خودکار از بازار + شهر"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={busy === "create"}
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-card transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "create" ? "در حال ساخت…" : "ساخت کمپین"}
            </button>
          </div>
        </form>
      </section>

      {/* ── کمپین‌ها ── */}
      <section aria-labelledby="campaigns-heading">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="campaigns-heading" className="text-lg font-extrabold text-ink">
            کمپین‌ها ({campaigns.length})
          </h2>
          <div role="group" aria-label="عملیات کمپین انتخابی" className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={discover}
              aria-disabled={!selectedId || busy === "discover" || busyAny}
              onClickCapture={(e) => {
                if (!selectedId || busy === "discover" || busyAny) e.preventDefault();
              }}
              className={
                !selectedId || busy === "discover" || busyAny
                  ? "rounded-lg bg-surface-dim px-5 py-2.5 text-sm font-bold text-ink-muted"
                  : "rounded-lg bg-pine px-5 py-2.5 text-sm font-bold text-bone shadow-card transition-colors hover:bg-pine-dark"
              }
            >
              {busy === "discover" ? "در حال کشف لید…" : "کشف لید برای کمپین انتخابی 🔎"}
            </button>

            {/* رایگان — قبل از تحلیل گروهی بزن تا بدانی کدام لیدها ارزش توکن دارند */}
            <button
              type="button"
              onClick={() => {
                if (!selectedId || busyAny || busy === "affluence") return;
                void computeAffluence();
              }}
              aria-disabled={!selectedId || busyAny || busy === "affluence"}
              aria-describedby="affluence-note"
              className={
                !selectedId || busyAny || busy === "affluence"
                  ? "rounded-lg border border-ink-muted bg-surface px-5 py-2.5 text-sm font-bold text-ink-muted"
                  : "rounded-lg border border-brand-400 bg-surface px-5 py-2.5 text-sm font-bold text-brand-700 shadow-card transition-colors hover:bg-brand-50"
              }
            >
              {busy === "affluence" ? "در حال محاسبه…" : "محاسبه‌ی توان مالی (رایگان)"}
            </button>

          </div>
        </div>

        {/* وضعیت ماندگار (نه اعلان زنده) — با aria-describedby روی دکمه خوانده می‌شود */}
        <p id="affluence-note" className="mb-4 text-xs leading-6 text-ink-muted">
          محاسبه‌ی توان مالی هیچ توکنی مصرف نمی‌کند و روی همه‌ی لیدهای کمپین کار می‌کند. اول این را
          بزن تا ببینی کدام لیدها ارزش خرج توکن دارند؛ بعد در جدول پایین تیکشان بزن و به «فهرست
          منتخب» بفرست. تحلیل و تولید پیام فقط آنجا انجام می‌شود.
        </p>

        {campaigns.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-line bg-surface-dim p-6 text-center text-sm text-ink-muted">
            هنوز کمپینی نداری. یکی بساز تا شروع کنیم.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => {
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => selectCampaign(c.id)}
                    aria-pressed={active}
                    className={`w-full rounded-xl border p-4 text-right shadow-card transition-colors ${
                      active
                        ? "border-brand-400 bg-brand-50"
                        : "border-surface-line bg-surface hover:border-brand-300"
                    }`}
                  >
                    <span className="block font-bold text-ink">{c.name}</span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      شهر: {c.city} · سقف کشف روزانه: {c.dailyDiscoveryLimit}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── افزودن دستی / CSV ── */}
      <section aria-labelledby="manual-heading">
        <h2 id="manual-heading" className="mb-2 text-lg font-extrabold text-ink">
          افزودن دستی لید
        </h2>
        <p className="mb-4 text-xs text-ink-muted">
          کسب‌وکارهایی که خودت پیدا کرده‌ای را اینجا اضافه کن (به کمپین انتخاب‌شده وصل می‌شوند).
        </p>

        <form
          onSubmit={addManualLead}
          className="grid gap-4 rounded-xl border border-surface-line bg-surface p-5 shadow-card sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="m-name" className="text-sm font-medium text-ink">
              نام کسب‌وکار *
            </label>
            <input
              id="m-name"
              required
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="m-ig" className="text-sm font-medium text-ink">
              اینستاگرام
            </label>
            <input
              id="m-ig"
              value={mInstagram}
              onChange={(e) => setMInstagram(e.target.value)}
              placeholder="@handle یا لینک"
              dir="ltr"
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="m-phone" className="text-sm font-medium text-ink">
              تلفن
            </label>
            <input
              id="m-phone"
              value={mPhone}
              onChange={(e) => setMPhone(e.target.value)}
              dir="ltr"
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="m-web" className="text-sm font-medium text-ink">
              وب‌سایت
            </label>
            <input
              id="m-web"
              value={mWebsite}
              onChange={(e) => setMWebsite(e.target.value)}
              dir="ltr"
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={busy === "manual"}
              className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-card transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "manual" ? "در حال افزودن…" : "افزودن لید"}
            </button>
          </div>
        </form>

        <div className="mt-4 rounded-xl border border-surface-line bg-surface p-5 shadow-card">
          <label htmlFor="csv" className="text-sm font-medium text-ink">
            ورود انبوه (CSV) — هر خط یک کسب‌وکار: <span dir="ltr">نام, اینستاگرام, تلفن, سایت</span>
          </label>
          <textarea
            id="csv"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={4}
            dir="ltr"
            placeholder="کلینیک نمونه, @clinic_ig, 02112345678, https://example.com"
            className="mt-2 w-full rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
          />
          <button
            type="button"
            onClick={importCsv}
            disabled={busy === "csv" || !csv.trim()}
            className="mt-3 rounded-lg bg-pine px-5 py-2.5 text-sm font-bold text-bone shadow-card transition-colors hover:bg-pine-dark disabled:opacity-60"
          >
            {busy === "csv" ? "در حال ورود…" : "ورود انبوه از CSV"}
          </button>
        </div>
      </section>

      {/* ── لیدها ── */}
      <section aria-labelledby="leads-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="leads-heading"
            ref={leadsHeadingRef}
            tabIndex={-1}
            className="text-lg font-extrabold text-ink"
          >
            همه‌ی لیدها ({fa(unshortlisted.length)})
          </h2>
          <button
            type="button"
            onClick={() => {
              if (selectedIds.size === 0 || busy === "shortlist") return;
              void addToShortlist();
            }}
            aria-disabled={selectedIds.size === 0 || busy === "shortlist"}
            aria-describedby={
              selectedIds.size === 0 ? "shortlist-hint shortlist-gate-note" : "shortlist-hint"
            }
            className={
              selectedIds.size === 0 || busy === "shortlist"
                ? "rounded-lg border border-ink-muted bg-surface px-5 py-2.5 text-sm font-bold text-ink-muted"
                : "rounded-lg bg-brass-dark px-5 py-2.5 text-sm font-bold text-white shadow-card transition-colors hover:bg-brass"
            }
          >
            {busy === "shortlist"
              ? "در حال افزودن…"
              : `افزودن ${fa(selectedIds.size)} لید انتخاب‌شده به فهرست منتخب`}
          </button>
        </div>
        <p id="shortlist-hint" className="mb-4 text-xs leading-6 text-ink-muted">
          لیدها از بالاترین توان مالی مرتب شده‌اند. آن‌هایی را که به‌نظرت ارزش دارند تیک بزن و به
          «فهرست منتخب» بفرست؛ آنجا بدون شلوغیِ بقیه‌ی لیدها روی همان‌ها کار می‌کنی.
        </p>

        <LeadsTable
          leads={unshortlisted}
          regionLabel="جدول همه‌ی لیدها"
          captionText="همه‌ی لیدهای کشف‌شده‌ی کمپین که هنوز به فهرست منتخب نرفته‌اند، از بالاترین توان مالی به پایین‌ترین. ستون «توان مالی» تخمینی از نشانه‌های عمومی است، نه درآمد واقعی."
          emptyText={busy === "load" ? "در حال بارگذاری…" : "لیدی نیست. «کشف لید» را بزن."}
          idPrefix="all"
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          openId={openId}
          onTogglePanel={togglePanel}
          triggerRefs={triggerRefs}
          details={details}
          igDrafts={igDrafts}
          onIgDraftChange={(id, v) => setIgDrafts((p) => ({ ...p, [id]: v }))}
          onSaveIgNote={(l, v) => void saveIgNote(l.id, l.businessName, v)}
          busyAny={busyAny}
          analyzingId={analyzingId}
          canMessage={canMessage}
          onAnalyze={(l) => void analyze(l)}
          onGenerateMessage={(l) => void generateMessageFor(l)}
        />
      </section>

      {/* ── فهرست منتخب — فضای کار روی لیدهای تأییدشده‌ی انسان ── */}
      <section aria-labelledby="shortlist-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="shortlist-heading"
            ref={shortlistHeadingRef}
            tabIndex={-1}
            className="text-lg font-extrabold text-ink"
          >
            فهرست منتخب ({fa(shortlisted.length)})
          </h2>
          {/*
            بدون شرط رندر: اگر همه‌ی منتخب‌ها برگردانده شوند، این دکمه همان
            عنصری است که فوکوس رویش است. حذفش از DOM فوکوس را به body می‌اندازد.
            به‌جایش aria-disabled می‌شود — همان قراردادی که در کل این فایل هست.
          */}
          <button
            type="button"
            onClick={() => {
              if (shortSelectedIds.size === 0 || busy === "shortlist") return;
              void removeFromShortlist();
            }}
            aria-disabled={shortSelectedIds.size === 0 || busy === "shortlist"}
            aria-describedby={shortSelectedIds.size === 0 ? "unshortlist-gate-note" : undefined}
            className={
              shortSelectedIds.size === 0 || busy === "shortlist"
                ? "rounded-lg border border-ink-muted bg-surface px-4 py-2 text-sm font-bold text-ink-muted"
                : "rounded-lg border border-danger/70 bg-surface px-4 py-2 text-sm font-bold text-danger transition-colors hover:bg-danger-soft"
            }
          >
            {busy === "shortlist"
              ? "در حال برگرداندن…"
              : `برگرداندن ${fa(shortSelectedIds.size)} لید به فهرست اصلی`}
          </button>
        </div>

        {/*
          دو کار گروهی — به‌ترتیبِ همان جریان کار: اول تحلیل، بعد پیام.
          هر دو فقط روی فهرست منتخب کار می‌کنند، نه کل کمپین.
        */}
        <div role="group" aria-label="عملیات گروهی فهرست منتخب" className="mb-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              if (busyAny || !canAnalyzeShortlist) return;
              void analyzeBatch();
            }}
            aria-disabled={busyAny || !canAnalyzeShortlist}
            aria-describedby={
              canAnalyzeShortlist ? "shortlist-batch-note" : "shortlist-batch-note analyze-all-gate-note"
            }
            className={
              busyAny || !canAnalyzeShortlist
                ? "rounded-lg border border-ink-muted bg-surface px-5 py-2.5 text-sm font-bold text-ink-muted"
                : "rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-card transition-colors hover:bg-brand-700"
            }
          >
            {batchRunning ? (
              "در حال تحلیل منتخب‌ها…"
            ) : (
              <>
                تحلیل همه‌ی لیدهای منتخب <span aria-hidden="true">🧠</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (busyAny || !canGenerateAll) return;
              void generateAllMessages();
            }}
            aria-disabled={busyAny || !canGenerateAll}
            aria-describedby={
              canGenerateAll ? "shortlist-batch-note" : "shortlist-batch-note msg-all-gate-note"
            }
            className={
              busyAny || !canGenerateAll
                ? "rounded-lg border border-ink-muted bg-surface px-5 py-2.5 text-sm font-bold text-ink-muted"
                : "rounded-lg bg-pine px-5 py-2.5 text-sm font-bold text-bone shadow-card transition-colors hover:bg-pine-dark"
            }
          >
            {msgGenRunning ? (
              "در حال تولید پیام‌ها…"
            ) : (
              <>
                تولید پیام برای همه‌ی لیدهای منتخب <span aria-hidden="true">✍️</span>
              </>
            )}
          </button>
        </div>

        {/* وضعیت ماندگار (نه اعلان زنده) — با aria-describedby روی هر دو دکمه */}
        <p id="shortlist-batch-note" className="mb-4 text-xs leading-6 text-ink-muted">
          {shortlisted.length === 0
            ? "فهرست منتخب خالی است. از جدول بالا لید تیک بزن و به اینجا بفرست."
            : shortUnanalyzed > 0
              ? `${fa(shortUnanalyzed)} لید منتخب هنوز تحلیل نشده است. اول «تحلیل همه‌ی لیدهای منتخب» را بزن؛ ` +
                `بعد از تمام‌شدنش دکمه‌ی تولید پیام فعال می‌شود.`
              : `همه‌ی ${fa(shortlisted.length)} لید منتخب تحلیل شده‌اند و ${fa(shortReadyForMessage)} تا آماده‌ی پیام‌اند. ` +
                `با یک بار زدن، برای همه یکی‌یکی پیام ساخته می‌شود.`}
        </p>
        <p className="mb-4 text-xs leading-6 text-ink-muted">
          اینجا هر لید را جدا تحلیل کن و بعد پیامش را بساز. دکمه‌ی «تولید پیام» تا وقتی لید تحلیل و
          امتیازدهی نشده باشد کار نمی‌کند — سرور هم جلویش را می‌گیرد، نه فقط این صفحه.
        </p>

        <LeadsTable
          leads={shortlisted}
          regionLabel="جدول فهرست منتخب"
          captionText="لیدهای منتخب، از بالاترین توان مالی به پایین‌ترین. اینجا هر لید را جدا تحلیل و پیام‌سازی می‌کنی."
          emptyText="هنوز لیدی انتخاب نکرده‌ای. از جدول بالا تیک بزن و «افزودن به فهرست منتخب» را بزن."
          idPrefix="short"
          selectedIds={shortSelectedIds}
          onToggleSelect={toggleShortSelect}
          openId={openId}
          onTogglePanel={togglePanel}
          triggerRefs={triggerRefs}
          details={details}
          igDrafts={igDrafts}
          onIgDraftChange={(id, v) => setIgDrafts((p) => ({ ...p, [id]: v }))}
          onSaveIgNote={(l, v) => void saveIgNote(l.id, l.businessName, v)}
          busyAny={busyAny}
          analyzingId={analyzingId}
          canMessage={canMessage}
          onAnalyze={(l) => void analyze(l)}
          onGenerateMessage={(l) => void generateMessageFor(l)}
        />
      </section>

      {/* ── پیام‌ها (تأیید انسانی — فاز ۴) ── */}
      <section aria-labelledby="messages-heading">
        <h2 id="messages-heading" className="mb-2 text-lg font-extrabold text-ink">
          پیام‌ها ({fa(messages.length)})
        </h2>

        {/* خلاصه‌ی ماندگار — نه اعلان زنده؛ همیشه قابل‌مرور با screen reader */}
        <p className="mb-4 text-xs leading-6 text-ink-muted">
          هیچ پیامی خودکار ارسال نمی‌شود. هر پیام پیش‌نویس است و تا وقتی خودت تأیید نکنی جایی نمی‌رود.
          {messages.length > 0 && (
            <>
              {" "}
              از {fa(messages.length)} پیام: {fa(blockedCount)} مسدود توسط نگهبان سیاست،{" "}
              {fa(reviewCount)} نیازمند بازبینی، {fa(readyCount)} آماده‌ی تأیید.
            </>
          )}
        </p>

        {messages.length > 0 && (
          <fieldset className="mb-4 rounded-xl border border-surface-line bg-surface p-4">
            <legend className="px-1 text-sm font-medium text-ink">نمایش کدام پیام‌ها</legend>
            <div className="flex flex-wrap gap-4">
              {MSG_FILTERS.map((f) => (
                <label
                  key={f.id}
                  htmlFor={`msg-filter-${f.id}`}
                  className="flex min-h-[24px] cursor-pointer items-center gap-2 py-1 text-sm text-ink"
                >
                  <input
                    type="radio"
                    id={`msg-filter-${f.id}`}
                    name="msg-filter"
                    value={f.id}
                    checked={msgFilter === f.id}
                    onChange={() => {
                      setMsgFilter(f.id);
                      // تغییر فیلتر، فهرست را عوض می‌کند؛ بدون اعلام، کاربر
                      // screen reader نمی‌فهمد چند پیام ماند (WCAG 4.1.3)
                      const n =
                        f.id === "all"
                          ? messages.length
                          : messages.filter((x) => x.status === f.id).length;
                      setTaskStatus(`فیلتر «${f.label}» اعمال شد. ${fa(n)} پیام نمایش داده می‌شود.`);
                    }}
                    className="h-6 w-6 accent-brand-600"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {visibleMessages.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-line bg-surface-dim p-6 text-center text-sm text-ink-muted">
            {messages.length === 0
              ? "هنوز پیامی ساخته نشده. لیدها را تحلیل کن؛ برای لیدهای واجد شرایط (امتیاز ۷۰ به بالا) پیش‌نویس پیام ساخته می‌شود."
              : "با این فیلتر پیامی نیست. فیلتر را روی «همه» بگذار."}
          </p>
        ) : (
          <ul className="space-y-5">
            {visibleMessages.map((m) => {
              const text = drafts[m.id] ?? currentText(m);
              const dirty = text !== currentText(m);
              const words = wordCount(text);
              const range = messageLengthFor(m.targetChannel);
              const blocked = m.policy.verdict === "BLOCK";
              const passed = m.policy.checks.filter((c) => c.pass).length;
              const busyHere = msgBusyId === m.id;
              const isArmed = (a: "approve" | "reject") => armed?.id === m.id && armed.action === a;

              return (
                <li key={m.id}>
                  <article
                    aria-labelledby={`msg-h-${m.id}`}
                    className="rounded-xl border border-surface-line bg-surface p-5 shadow-card"
                  >
                    {/* عنوان = هویت + وضعیت؛ جزئیات متغیر در توضیح جدا (m1) */}
                    <h3
                      id={`msg-h-${m.id}`}
                      tabIndex={-1}
                      ref={(el) => {
                        cardHeadingRefs.current[m.id] = el;
                      }}
                      aria-describedby={`msg-state-${m.id}`}
                      className="text-base font-extrabold leading-7 text-ink focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-brass"
                    >
                      {m.businessName} — {MSG_STATUS_LABELS[m.status]}
                    </h3>
                    <p id={`msg-state-${m.id}`} className="mt-1 text-xs text-ink-muted">
                      کانال: {m.targetChannel ? CHANNEL_LABELS[m.targetChannel] : "نامشخص"} ·{" "}
                      {VERDICT_LABELS[m.policy.verdict]}
                    </p>

                    <p className="mt-1 text-xs text-ink-muted">
                      نمره‌ی منتقد:{" "}
                      {m.criticScore != null ? (
                        <>
                          <bdi>{fa(m.criticScore)}</bdi> از ۱۰۰ — {scoreBand(m.criticScore)}
                        </>
                      ) : (
                        scoreBand(null)
                      )}
                      {m.painTargeted && <> · درد هدف‌گرفته‌شده: {m.painTargeted}</>}
                    </p>

                    {/* بررسی‌های نگهبان سیاست — کد قطعی، صفر توکن */}
                    <h4 id={`pol-h-${m.id}`} className="mt-4 text-sm font-extrabold text-ink">
                      نگهبان سیاست — {fa(passed)} از {fa(m.policy.checks.length)} بررسی قبول شد
                    </h4>
                    <dl role="group" aria-labelledby={`pol-h-${m.id}`} className="mt-2 space-y-1">
                      {m.policy.checks.map((c) => (
                        <div key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <dt className="font-medium text-ink">
                            <span aria-hidden="true" className={c.pass ? "text-success" : "text-danger"}>
                              {c.pass ? "✓ " : "✕ "}
                            </span>
                            {c.label}:
                          </dt>
                          <dd className={c.pass ? "text-ink-muted" : "text-danger"}>
                            {c.pass ? "قبول" : "رد"} — {c.detail}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {/* متن پیام — قابل ویرایش */}
                    <div className="mt-4">
                      <label htmlFor={`msg-text-${m.id}`} className="text-sm font-medium text-ink">
                        متن پیام برای {m.businessName}
                      </label>
                      <textarea
                        id={`msg-text-${m.id}`}
                        value={text}
                        aria-invalid={cardError[m.id] ? true : undefined}
                        aria-describedby={`msg-meta-${m.id} msg-err-${m.id}`}
                        onChange={(e) => setDrafts((p) => ({ ...p, [m.id]: e.target.value }))}
                        rows={7}
                        /* border-brand-400 برای کنتراست ۳:۱ مرز فیلد (WCAG 1.4.11) */
                        className="mt-2 w-full rounded-lg border border-brand-400 bg-white px-3 py-2 text-sm leading-7 text-ink"
                      />
                      {/* وضعیت ماندگار (نه live region) — با aria-describedby خوانده می‌شود */}
                      <p id={`msg-meta-${m.id}`} className="mt-1 text-xs text-ink-muted">
                        {fa(words)} کلمه (بازه‌ی پیشنهادی این کانال: {fa(range.min)} تا {fa(range.max)}).{" "}
                        {dirty
                          ? "تغییرات ذخیره نشده است؛ دکمه‌ی «ذخیره‌ی متن» را بزن."
                          : savedAt[m.id]
                            ? "آخرین تغییر ذخیره شده است."
                            : "متن تغییری نکرده است."}
                      </p>
                    </div>

                    {/*
                      امضای پیام — محتوای ایستا و غیرقابل‌ویرایش.

                      عمداً یک بلوک متنی است و نه textarea غیرفعال: فیلد فرمی که
                      ویرایش نمی‌شود برای اسکرین‌ریدر گمراه‌کننده است.

                      امضا در دیتابیس ذخیره نمی‌شود و فقط سر کپی اضافه می‌شود —
                      برای همین اینجا نشان داده می‌شود تا مالک دقیقاً همان چیزی
                      را ببیند که کپی خواهد شد. جزئیات در brand.MESSAGE_SIGNATURE.
                    */}
                    <div className="mt-3">
                      <h4 id={`sig-h-${m.id}`} className="text-xs font-extrabold text-ink">
                        امضای پیام — خودکار به انتهای متن اضافه می‌شود
                      </h4>
                      {/*
                        role="group" (نه <p> خالی): پاراگراف نقشی ندارد که
                        aria-labelledby را بپذیرد، پس نام روی آن بی‌اثر است.
                        group نام می‌پذیرد و بلوک را یک واحد قابل‌تشخیص می‌کند.
                      */}
                      <div
                        role="group"
                        aria-labelledby={`sig-h-${m.id}`}
                        className="mt-1 whitespace-pre-line rounded-lg border border-surface-line bg-sand px-3 py-2 text-xs leading-6 text-ink-soft"
                      >
                        {MESSAGE_SIGNATURE}
                      </div>
                    </div>

                    {/* کانال‌های ارتباط این کسب‌وکار — قابل کلیک، برای ارسال دستی */}
                    <div className="mt-4">
                      <h4 id={`ch-h-${m.id}`} className="text-sm font-extrabold text-ink">
                        راه‌های ارتباط {m.businessName}
                      </h4>
                      <div className="mt-1">
                        <Channels
                          channels={m.contactChannels}
                          businessName={m.businessName}
                          labelledBy={`ch-h-${m.id}`}
                        />
                      </div>
                    </div>

                    {/* نسخه‌ی ایمیلی — disclosure، همیشه رندر و فقط hidden جابه‌جا می‌شود */}
                    {m.emailText && (
                      <div className="mt-4">
                        <button
                          type="button"
                          ref={(el) => {
                            emailTriggerRefs.current[m.id] = el;
                          }}
                          aria-expanded={openEmailId === m.id}
                          aria-controls={`msg-email-${m.id}`}
                          onClick={() => {
                            if (openEmailId === m.id) {
                              setOpenEmailId(null);
                              emailTriggerRefs.current[m.id]?.focus();
                            } else {
                              setOpenEmailId(m.id);
                            }
                          }}
                          className="rounded-lg border border-brand-400 bg-surface-dim px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
                        >
                          نسخه‌ی ایمیلی {m.businessName}
                        </button>
                        <div
                          id={`msg-email-${m.id}`}
                          hidden={openEmailId !== m.id}
                          className="mt-2 rounded-lg border border-surface-line bg-surface-dim p-3"
                        >
                          <p className="text-sm font-bold text-ink">موضوع: {m.emailSubject ?? "—"}</p>
                          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-ink-muted">
                            {m.emailText}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* نمونه‌کارهای پیشنهادی — اتچ دستی توسط خودت */}
                    {m.portfolio.length > 0 && (
                      <div className="mt-4">
                        <h4 id={`pf-h-${m.id}`} className="text-sm font-extrabold text-ink">
                          نمونه‌کارهای پیشنهادی برای اتچ دستی
                        </h4>
                        <ul aria-labelledby={`pf-h-${m.id}`} className="mt-1 space-y-1">
                          {m.portfolio.map((p) => (
                            <li key={p.id} className="text-sm">
                              <a
                                href={p.publicUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-brand-700 underline underline-offset-2 hover:text-brand-600"
                              >
                                {p.title}
                                <span className="sr-only">
                                  {" "}
                                  — نمونه‌کار پیشنهادی برای {m.businessName} (در تب جدید باز می‌شود)
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/*
                      خطای کارت همیشه رندر می‌شود تا هدفِ پایدارِ aria-describedby
                      باشد. اعلانِ صوتی از کانال مشترک setTaskStatus می‌آید، نه از
                      یک live region جدا (پیام تکراری هم دوباره اعلام می‌شود).
                    */}
                    <p
                      id={`msg-err-${m.id}`}
                      className={
                        cardError[m.id]
                          ? "mt-4 rounded-lg border border-danger/70 bg-danger-soft px-3 py-2 text-sm text-danger"
                          : "sr-only"
                      }
                    >
                      {cardError[m.id]}
                    </p>

                    {/* عملیات */}
                    <div
                      role="group"
                      aria-label={`عملیات پیام ${m.businessName}`}
                      aria-describedby={m.status === "draft" ? `msg-hint-${m.id}` : undefined}
                      className="mt-4 flex flex-wrap gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (busyHere || !dirty) return;
                          void saveEdit(m);
                        }}
                        aria-disabled={busyHere || !dirty}
                        aria-label={
                          busyHere
                            ? `در حال ذخیره‌ی متن پیام ${m.businessName}`
                            : `ذخیره‌ی متن پیام ${m.businessName}`
                        }
                        className={
                          busyHere || !dirty
                            ? "rounded-lg bg-surface-dim px-4 py-2 text-sm font-bold text-ink-muted"
                            : "rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
                        }
                      >
                        ذخیره‌ی متن
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void copyText(withSignature(text)).then((ok) =>
                            setTaskStatus(
                              ok
                                ? `متن پیام «${m.businessName}» همراه امضا کپی شد. حالا می‌توانی در ${
                                    m.targetChannel ? CHANNEL_LABELS[m.targetChannel] : "کانال انتخابی"
                                  } بفرستی.`
                                : `کپی متن پیام «${m.businessName}» ناموفق بود؛ متن را دستی انتخاب و کپی کن.`
                            )
                          );
                        }}
                        aria-label={`کپی متن پیام ${m.businessName} همراه امضا`}
                        className="rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
                      >
                        کپی متن
                      </button>

                      {m.emailText && (
                        <button
                          type="button"
                          onClick={() => {
                            const full = `${m.emailSubject ?? ""}\n\n${withSignature(
                              m.emailText ?? ""
                            )}`.trim();
                            void copyText(full).then((ok) =>
                              setTaskStatus(
                                ok
                                  ? `موضوع و متن ایمیل «${m.businessName}» همراه امضا کپی شد.`
                                  : `کپی ایمیل «${m.businessName}» ناموفق بود؛ متن را دستی انتخاب و کپی کن.`
                              )
                            );
                          }}
                          aria-label={`کپی ایمیل ${m.businessName} — موضوع و متن همراه امضا`}
                          className="rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
                        >
                          کپی ایمیل
                        </button>
                      )}

                      {m.status === "draft" && (
                        <>
                          <button
                            type="button"
                            ref={(el) => {
                              actionRefs.current[`${m.id}:approve`] = el;
                            }}
                            onClick={() => {
                              if (blocked || busyHere) return;
                              setArmed({ id: m.id, action: "approve" });
                            }}
                            aria-disabled={blocked || busyHere}
                            aria-describedby={blocked ? "policy-block-note" : undefined}
                            aria-expanded={isArmed("approve")}
                            aria-controls={`confirm-approve-${m.id}`}
                            aria-label={`تأیید پیام ${m.businessName}`}
                            className={
                              blocked || busyHere
                                ? "rounded-lg bg-surface-dim px-4 py-2 text-sm font-bold text-ink-muted"
                                : "rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700"
                            }
                          >
                            تأیید پیام
                          </button>

                          <button
                            type="button"
                            ref={(el) => {
                              actionRefs.current[`${m.id}:reject`] = el;
                            }}
                            onClick={() => {
                              if (busyHere) return;
                              setArmed({ id: m.id, action: "reject" });
                            }}
                            aria-disabled={busyHere}
                            aria-expanded={isArmed("reject")}
                            aria-controls={`confirm-reject-${m.id}`}
                            aria-label={`رد پیام ${m.businessName}`}
                            className="rounded-lg border border-danger/70 bg-surface px-4 py-2 text-sm font-bold text-danger transition-colors hover:bg-danger-soft"
                          >
                            رد پیام
                          </button>
                        </>
                      )}

                      {m.status === "approved" && (
                        <button
                          type="button"
                          ref={(el) => {
                            actionRefs.current[`${m.id}:sent`] = el;
                          }}
                          onClick={() => {
                            if (busyHere) return;
                            void runAction(m, "sent");
                          }}
                          aria-disabled={busyHere}
                          aria-label={`ثبت ارسال (خودم فرستادم) — پیام ${m.businessName}`}
                          className="rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
                        >
                          ثبت ارسال (خودم فرستادم)
                        </button>
                      )}

                    </div>

                    {m.status === "draft" && (
                      <p id={`msg-hint-${m.id}`} className="mt-2 text-xs text-ink-muted">
                        دکمه‌ی «ثبت ارسال» بعد از تأیید همین پیام در این کارت ظاهر می‌شود.
                      </p>
                    )}

                    {/* تأیید دوم — درجا، بدون مودال و بدون confirm مرورگر */}
                    <div
                      id={`confirm-approve-${m.id}`}
                      hidden={!isArmed("approve")}
                      className="mt-3 rounded-lg border border-brand-300 bg-brand-50 p-3"
                    >
                      <p className="text-sm text-ink">
                        تأیید نهایی: پیام «{m.businessName}» تأیید شود؟ پس از تأیید، خودت آن را در{" "}
                        {m.targetChannel ? CHANNEL_LABELS[m.targetChannel] : "کانال انتخابی"} می‌فرستی.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <button
                          type="button"
                          ref={(el) => {
                            confirmRefs.current[`${m.id}:approve`] = el;
                          }}
                          onClick={() => {
                            if (busyHere) return;
                            void runAction(m, "approve");
                          }}
                          aria-disabled={busyHere}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                        >
                          {busyHere ? "در حال تأیید…" : `بله، پیام ${m.businessName} را تأیید کن`}
                        </button>
                        <button
                          type="button"
                          onClick={disarm}
                          className="rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-dim"
                        >
                          انصراف
                        </button>
                      </div>
                    </div>

                    <div
                      id={`confirm-reject-${m.id}`}
                      hidden={!isArmed("reject")}
                      className="mt-3 rounded-lg border border-danger/40 bg-danger-soft p-3"
                    >
                      <p className="text-sm text-ink">
                        تأیید نهایی: پیام «{m.businessName}» رد شود؟ این پیام دیگر ارسال نمی‌شود.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <button
                          type="button"
                          ref={(el) => {
                            confirmRefs.current[`${m.id}:reject`] = el;
                          }}
                          onClick={() => {
                            if (busyHere) return;
                            void runAction(m, "reject");
                          }}
                          aria-disabled={busyHere}
                          className="rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white"
                        >
                          {busyHere ? "در حال رد…" : `بله، پیام ${m.businessName} را رد کن`}
                        </button>
                        <button
                          type="button"
                          onClick={disarm}
                          className="rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-dim"
                        >
                          انصراف
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── ۷ قالب پیام پیش‌فرض (کتابخانه‌ی مرجع، نه چیزی که سیستم بفرستد) ── */}
      <section aria-labelledby="templates-heading">
        <h2 id="templates-heading" className="mb-2 text-lg font-extrabold text-ink">
          قالب‌های پیش‌فرض ({fa(MESSAGE_TEMPLATES.length)} خدمت)
        </h2>
        <p className="mb-4 text-xs leading-6 text-ink-muted">
          یک قالب برای هر خدمت مهدیار، برای وقتی که خودت دستی پیام می‌نویسی یا سهمیه‌ی مدل تمام شده
          است. جای خالی‌ها را حتماً پر کن:{" "}
          <bdi className="font-bold">{"{نام}"}</bdi> نام کسب‌وکار و{" "}
          <bdi className="font-bold">{"{مشاهده}"}</bdi> یک جزئیات واقعی که خودت دیده‌ای. قالبِ
          پرنشده پیام عمومی است و جواب نمی‌دهد.
        </p>

        <ul className="grid gap-4 lg:grid-cols-2">
          {MESSAGE_TEMPLATES.map((t) => {
            const svc = SERVICES.find((s) => s.id === t.serviceId);
            return (
              <li key={t.serviceId}>
                <article
                  aria-labelledby={`tpl-h-${t.serviceId}`}
                  className="h-full rounded-xl border border-surface-line bg-surface p-5 shadow-card"
                >
                  <h3 id={`tpl-h-${t.serviceId}`} className="text-sm font-extrabold text-ink">
                    {svc?.title ?? t.serviceId}
                  </h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-ink-muted">{t.text}</p>
                  <h4 id={`tpl-sig-${t.serviceId}`} className="mt-3 text-xs font-extrabold text-ink">
                    امضا — خودکار به کپی اضافه می‌شود
                  </h4>
                  <div
                    role="group"
                    aria-labelledby={`tpl-sig-${t.serviceId}`}
                    className="mt-1 whitespace-pre-line rounded-lg border border-surface-line bg-sand px-3 py-2 text-xs leading-6 text-ink-soft"
                  >
                    {MESSAGE_SIGNATURE}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void copyText(withSignature(t.text)).then((ok) =>
                        setTaskStatus(
                          ok
                            ? `قالب «${svc?.title ?? t.serviceId}» همراه امضا کپی شد. یادت باشد جای خالی نام و مشاهده را پر کنی.`
                            : `کپی قالب «${svc?.title ?? t.serviceId}» ناموفق بود؛ متن را دستی انتخاب و کپی کن.`
                        )
                      );
                    }}
                    aria-label={`کپی قالب ${svc?.title ?? t.serviceId} همراه امضا`}
                    className="mt-3 rounded-lg border border-brand-400 bg-surface px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-50"
                  >
                    کپی قالب
                  </button>
                </article>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
