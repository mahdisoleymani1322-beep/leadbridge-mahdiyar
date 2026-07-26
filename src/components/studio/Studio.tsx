"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
  MESSAGE_RULES,
  type ScoringCriterion,
} from "@/lib/config";
import { SERVICES } from "@/lib/brand";

/** ارقام فارسی در متن کاربرپسند (طبق قرارداد پروژه) */
const fa = (n: number | string) => new Intl.NumberFormat("fa-IR").format(Number(n));

/** برچسب فارسی وضعیت لید — به‌جای نمایش خام enum */
const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "جدید",
  VALIDATING: "در حال اعتبارسنجی",
  INVALID: "نامعتبر",
  DUPLICATE: "تکراری",
  ANALYZING: "در حال تحلیل",
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

/* ── کمکی fetch با هدر رمز استودیو (در صورت وجود) ─────────── */

function authHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const pw = window.localStorage.getItem("studioPassword");
    if (pw) h["x-studio-password"] = pw;
  }
  return h;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `خطای ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/* ── برچسب کانال‌های ارتباط ───────────────────────────────── */

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  instagram: "اینستاگرام",
  whatsapp: "واتساپ",
  telegram: "تلگرام",
  email: "ایمیل",
  siteForm: "فرم سایت",
  phone: "تلفن",
};

function Channels({ channels }: { channels: ContactChannels }) {
  const keys = (Object.keys(CHANNEL_LABELS) as ChannelKey[]).filter((k) => channels[k]);
  if (keys.length === 0) return <span className="text-ink-muted">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <li
          key={k}
          className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
        >
          {CHANNEL_LABELS[k]}
          {/* مقدار واقعی برای screen reader — title روی li خوانده نمی‌شود */}
          <span className="sr-only">: {String(channels[k])}</span>
        </li>
      ))}
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

type MsgFilter = "all" | "draft" | "approved" | "sent";

const MSG_FILTERS: { id: MsgFilter; label: string }[] = [
  { id: "all", label: "همه" },
  { id: "draft", label: "فقط پیش‌نویس‌ها" },
  { id: "approved", label: "فقط تأییدشده‌ها" },
  { id: "sent", label: "فقط ارسال‌شده‌ها" },
];

/* ── پنل جزئیات لید (تحلیل + ریز امتیاز + تایم‌لاین) ───────── */

type LeadDetail = { lead: Lead; analysis: LeadAnalysis | null; runs: AgentRun[] };

function LeadPanel({ lead, detail, onClose }: { lead: Lead; detail: LeadDetail | null; onClose: () => void }) {
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

/* ── کامپوننت اصلی ────────────────────────────────────────── */

export function Studio() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<null | "load" | "create" | "discover" | "manual" | "csv">(null);

  // تحلیل لید (فاز ۳)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
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

  // فوکوس روی دکمه‌ی تأیید نهایی — همین جابه‌جایی خودش «اعلانِ» مسلح‌شدن است
  useEffect(() => {
    if (armed) confirmRefs.current[`${armed.id}:${armed.action}`]?.focus();
  }, [armed]);

  /** لغو حالت مسلح + بازگرداندن فوکوس به دکمه‌ی آغازگر */
  const disarm = useCallback(() => {
    setArmed((cur) => {
      if (cur) actionRefs.current[`${cur.id}:${cur.action}`]?.focus();
      return null;
    });
  }, []);

  // فرم کمپین جدید
  const [name, setName] = useState("");
  const [market, setMarket] = useState("all"); // پیش‌فرض: همه‌ی بازارها ترکیبی
  const [city, setCity] = useState("تهران");
  const [service, setService] = useState(SERVICES[0]?.id ?? "");

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
    setLeads(leads);
    // شمارنده‌ی «تحلیل‌نشده» از همین داده محاسبه می‌شود (بدون درخواست اضافه)
    setRemaining(leads.filter((l) => l.status === "NEW").length);
  }, []);

  /** پیام‌های کمپین انتخابی + نتیجه‌ی زنده‌ی نگهبان سیاست (صفر توکن) */
  const loadMessages = useCallback(async (campaignId: string) => {
    const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    const { messages } = await api<{ messages: MessageView[] }>(`/api/messages${q}`);
    setMessages(messages);
  }, []);

  useEffect(() => {
    (async () => {
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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    })();
  }, [loadCampaigns, loadLeads, loadMessages]);

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
      const { summary } = await api<{ summary: { found: number; inserted: number; duplicates: number; invalid: number } }>(
        "/api/discovery",
        { method: "POST", body: JSON.stringify({ campaignId: selectedId }) }
      );
      setNotice(
        `کشف انجام شد: ${summary.found} یافت، ${summary.inserted} جدید، ${summary.duplicates} تکراری، ${summary.invalid} نامعتبر.`
      );
      await loadLeads(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** اجرای خط تولید تحلیل روی یک لید (ایجنت‌های فاز ۳) */
  async function analyze(lead: Lead) {
    if (analyzingId || batchRunning) return; // گارد: یکی در یک زمان (rate-limit مدل)
    setAnalyzingId(lead.id);
    setError("");
    setTaskStatus(`تحلیل «${lead.businessName}» شروع شد. این کار ممکن است تا یک دقیقه طول بکشد.`);
    try {
      const res = await api<{ results: { finalStatus: LeadStatus; score: number | null }[] }>(
        "/api/pipeline",
        { method: "POST", body: JSON.stringify({ leadId: lead.id }) }
      );
      const r = res.results[0];
      setTaskStatus(
        `تحلیل «${lead.businessName}» کامل شد. امتیاز ${r?.score != null ? fa(r.score) : "—"} از ۱۰۰ — وضعیت: ${
          r ? LEAD_STATUS_LABELS[r.finalStatus] : "نامشخص"
        }.`
      );
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
      "تحلیل گروهی شروع شد. لیدها یکی‌یکی و پشت‌سرهم تحلیل می‌شوند تا همه تمام شوند. " +
        "دکمه‌های «تحلیل لید» در جدول تا پایان کار غیرفعال هستند."
    );

    let analyzed = 0; // تعداد لیدهایی که تحلیلشان کامل شد
    let drafted = 0; // تعداد پیام‌هایی که پیش‌نویس شد
    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        const res = await api<{
          step: { ran: string; status: string; score: number | null } | null;
          businessName?: string;
          remaining: number;
          done: boolean;
        }>("/api/pipeline", {
          method: "POST",
          body: JSON.stringify({ campaignId: selectedId }),
        });

        if (res.done || !res.step) break; // چیزی برای پردازش نمانده

        setRemaining(res.remaining);

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

        // پیام پیش‌نویس شد (فاز ۴) — لید واجد شرایط بوده و متن آماده است
        if (res.step.ran === "message") {
          drafted++;
          setTaskStatus(
            `برای «${res.businessName ?? "لید"}» پیش‌نویس پیام ساخته شد و در بخش پیام‌ها منتظر تأیید توست. در حال ادامه…`
          );
          await loadMessages(selectedId).catch(() => {});
        }
      }

      await loadLeads(selectedId);
      await loadMessages(selectedId).catch(() => {});
      setTaskStatus(
        `تحلیل گروهی تمام شد. ${fa(analyzed)} لید تحلیل شد و ${fa(drafted)} پیش‌نویس پیام ساخته شد. جدول لیدها و بخش پیام‌ها به‌روزرسانی شد.`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        analyzed > 0
          ? `${fa(analyzed)} لید تحلیل شد، سپس خطا رخ داد: ${msg} — می‌توانید دوباره دکمه را بزنید تا ادامه دهد.`
          : `تحلیل گروهی ناموفق بود: ${msg}`
      );
      setTaskStatus("");
      await loadLeads(selectedId).catch(() => {});
    } finally {
      setBatchRunning(false);
    }
  }

  /* ── عملیات پیام (فاز ۴ — تأیید انسانی اجباری) ─────────── */

  /** ذخیره‌ی متن ویرایش‌شده؛ سرور دوباره نگهبان سیاست را روی متن جدید اجرا می‌کند */
  async function saveEdit(m: MessageView) {
    const text = (drafts[m.id] ?? currentText(m)).trim();
    if (!text) {
      setCardError((p) => ({ ...p, [m.id]: "متن پیام نمی‌تواند خالی باشد." }));
      return;
    }
    setMsgBusyId(m.id);
    setCardError((p) => ({ ...p, [m.id]: "" }));
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
      setCardError((p) => ({ ...p, [m.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setMsgBusyId(null);
    }
  }

  /** تأیید / رد / ثبت ارسال — همیشه پس از یک گام تأیید دوم (بدون confirm مرورگر) */
  async function runAction(m: MessageView, action: "approve" | "reject" | "sent") {
    const key = `${m.id}:${action}`;
    setMsgBusyId(m.id);
    setCardError((p) => ({ ...p, [m.id]: "" }));
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
      setCardError((p) => ({ ...p, [m.id]: e instanceof Error ? e.message : String(e) }));
      setArmed(null);
    } finally {
      setMsgBusyId(null);
      actionRefs.current[key]?.focus(); // فوکوس به دکمه‌ی آغازگر برمی‌گردد
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

  function togglePanel(leadId: string) {
    if (openId === leadId) {
      setOpenId(null);
      triggerRefs.current[leadId]?.focus(); // بازگرداندن فوکوس
      return;
    }
    setOpenId(leadId);
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

  /* ── مقادیر مشتق‌شده‌ی پیام‌ها ─────────────────────────── */
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
      <span id="policy-block-note" className="sr-only">
        نگهبان سیاست این پیام را مسدود کرده است؛ سرور تأیید آن را نمی‌پذیرد. ابتدا متن را ویرایش و
        ذخیره کنید تا دوباره بررسی شود.
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
              className="rounded-lg border border-surface-line bg-white px-3 py-2 text-sm text-ink"
            >
              {SERVICES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
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
              aria-disabled={!selectedId || busy === "discover" || batchRunning}
              onClickCapture={(e) => {
                if (!selectedId || busy === "discover" || batchRunning) e.preventDefault();
              }}
              className={
                !selectedId || busy === "discover" || batchRunning
                  ? "rounded-lg bg-surface-dim px-5 py-2.5 text-sm font-bold text-ink-muted"
                  : "rounded-lg bg-pine px-5 py-2.5 text-sm font-bold text-bone shadow-card transition-colors hover:bg-pine-dark"
              }
            >
              {busy === "discover" ? "در حال کشف لید…" : "کشف لید برای کمپین انتخابی 🔎"}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!selectedId || batchRunning || analyzingId) return;
                void analyzeBatch();
              }}
              aria-disabled={!selectedId || batchRunning || analyzingId !== null}
              aria-describedby="batch-remaining"
              className={
                !selectedId || batchRunning || analyzingId
                  ? "rounded-lg bg-surface-dim px-5 py-2.5 text-sm font-bold text-ink-muted"
                  : "rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-card transition-colors hover:bg-brand-700"
              }
            >
              {batchRunning ? "در حال تحلیل گروهی…" : "تحلیل لیدهای کمپین انتخابی 🧠"}
            </button>
          </div>
        </div>

        {/* وضعیت ماندگار (نه اعلان زنده) — با aria-describedby روی دکمه خوانده می‌شود */}
        <p id="batch-remaining" className="mb-4 text-xs text-ink-muted">
          {!selectedId
            ? "ابتدا یک کمپین انتخاب کنید."
            : remaining === null
              ? "همه‌ی لیدها یکی‌یکی و پشت‌سرهم تحلیل می‌شوند (هر لید حدود نیم دقیقه)."
              : `${fa(remaining)} لید تحلیل‌نشده باقی مانده. با یک بار زدن، همه یکی‌یکی تا آخر تحلیل می‌شوند (هر لید حدود نیم دقیقه).`}
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
        <h2 id="leads-heading" className="mb-4 text-lg font-extrabold text-ink">
          لیدها ({leads.length})
        </h2>

        {leads.length === 0 ? (
          <p className="rounded-xl border border-dashed border-surface-line bg-surface-dim p-6 text-center text-sm text-ink-muted">
            {busy === "load" ? "در حال بارگذاری…" : "لیدی نیست. «کشف لید» را بزن."}
          </p>
        ) : (
          <div
            role="region"
            aria-label="جدول لیدها"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border border-surface-line shadow-card"
          >
            <table className="w-full min-w-[860px] border-collapse text-start text-sm">
              <caption className="sr-only">فهرست لیدهای کشف‌شده‌ی کمپین</caption>
              <thead className="bg-surface-dim text-xs text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">کسب‌وکار</th>
                  <th scope="col" className="px-4 py-3 font-semibold">صنعت</th>
                  <th scope="col" className="px-4 py-3 font-semibold">شهر</th>
                  <th scope="col" className="px-4 py-3 font-semibold">تلفن</th>
                  <th scope="col" className="px-4 py-3 font-semibold">کانال‌های ارتباط</th>
                  <th scope="col" className="px-4 py-3 font-semibold">امتیاز</th>
                  <th scope="col" className="px-4 py-3 font-semibold">وضعیت</th>
                  <th scope="col" className="px-4 py-3 font-semibold">تحلیل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line bg-surface">
                {leads.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="align-top">
                      <th scope="row" className="px-4 py-3 text-start font-medium text-ink">
                        <button
                          type="button"
                          ref={(el) => {
                            triggerRefs.current[l.id] = el;
                          }}
                          aria-expanded={openId === l.id}
                          aria-controls={`lead-panel-${l.id}`}
                          onClick={() => togglePanel(l.id)}
                          className="rounded px-1 py-1 text-start text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                        >
                          {l.businessName}
                        </button>
                        {l.website && (
                          <a
                            href={l.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ms-2 inline-block px-1 py-1 text-xs text-ink-muted underline underline-offset-2 hover:text-brand-600"
                          >
                            سایت
                            <span className="sr-only"> {l.businessName} (در تب جدید باز می‌شود)</span>
                          </a>
                        )}
                      </th>
                      <td className="px-4 py-3 text-ink-muted">{l.industry ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{l.city ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted" dir="ltr">{l.phone ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Channels channels={l.contactChannels} />
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {l.score != null ? <bdi>{fa(l.score)}</bdi> : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-surface-dim px-2 py-0.5 text-xs font-medium text-ink">
                          {LEAD_STATUS_LABELS[l.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          aria-label={`تحلیل لید ${l.businessName}`}
                          aria-disabled={batchRunning || analyzingId !== null}
                          aria-describedby={batchRunning ? "batch-block-note" : undefined}
                          onClick={() => {
                            if (batchRunning || analyzingId) return;
                            void analyze(l);
                          }}
                          className={
                            batchRunning || analyzingId !== null
                              ? "rounded-lg bg-surface-dim px-3 py-2 text-sm font-bold text-ink-muted"
                              : "rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-700"
                          }
                        >
                          {analyzingId === l.id ? "در حال تحلیل…" : "تحلیل لید"}
                        </button>
                      </td>
                    </tr>

                    {/* پنل جزئیات — همیشه رندر، فقط hidden جابه‌جا می‌شود */}
                    <tr id={`lead-panel-${l.id}`} hidden={openId !== l.id}>
                      <td colSpan={8} className="bg-surface-dim px-4 py-5">
                        <LeadPanel
                          lead={l}
                          detail={details[l.id] ?? null}
                          onClose={() => togglePanel(l.id)}
                        />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                <span key={f.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    id={`msg-filter-${f.id}`}
                    name="msg-filter"
                    value={f.id}
                    checked={msgFilter === f.id}
                    onChange={() => setMsgFilter(f.id)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <label htmlFor={`msg-filter-${f.id}`} className="text-sm text-ink">
                    {f.label}
                  </label>
                </span>
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
              const blocked = m.policy.verdict === "BLOCK";
              const passed = m.policy.checks.filter((c) => c.pass).length;
              const busyHere = msgBusyId === m.id;
              const isArmed = (a: "approve" | "reject") => armed?.id === m.id && armed.action === a;

              return (
                <li key={m.id}>
                  <article
                    aria-labelledby={`msg-h-${m.id}`}
                    className="rounded-xl border border-surface-line bg-surface p-5 shadow-card"
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && armed?.id === m.id) {
                        e.stopPropagation();
                        disarm();
                      }
                    }}
                  >
                    {/* عنوان کارت: هرچه برای تصمیم لازم است در خود متن عنوان */}
                    <h3 id={`msg-h-${m.id}`} className="text-base font-extrabold leading-7 text-ink">
                      {m.businessName} — کانال: {m.targetChannel ? CHANNEL_LABELS[m.targetChannel] : "نامشخص"} —
                      وضعیت: {MSG_STATUS_LABELS[m.status]} — {VERDICT_LABELS[m.policy.verdict]}
                    </h3>

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
                    <dl aria-labelledby={`pol-h-${m.id}`} className="mt-2 space-y-1">
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
                        aria-describedby={`msg-meta-${m.id}`}
                        onChange={(e) => setDrafts((p) => ({ ...p, [m.id]: e.target.value }))}
                        rows={7}
                        className="mt-2 w-full rounded-lg border border-surface-line bg-white px-3 py-2 text-sm leading-7 text-ink"
                      />
                      {/* وضعیت ماندگار (نه live region) — با aria-describedby خوانده می‌شود */}
                      <p id={`msg-meta-${m.id}`} className="mt-1 text-xs text-ink-muted">
                        {fa(words)} کلمه (مجاز: {fa(MESSAGE_RULES.minWords)} تا {fa(MESSAGE_RULES.maxWords)}).{" "}
                        {dirty
                          ? "تغییرات ذخیره نشده است؛ دکمه‌ی «ذخیره‌ی متن» را بزن."
                          : savedAt[m.id]
                            ? "آخرین تغییر ذخیره شده است."
                            : "متن تغییری نکرده است."}
                      </p>
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
                          className="rounded-lg border border-surface-line bg-surface-dim px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
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

                    {cardError[m.id] && (
                      <p
                        role="alert"
                        className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                      >
                        {cardError[m.id]}
                      </p>
                    )}

                    {/* عملیات */}
                    <div
                      role="group"
                      aria-label={`عملیات پیام ${m.businessName}`}
                      className="mt-4 flex flex-wrap gap-3"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (busyHere || !dirty) return;
                          void saveEdit(m);
                        }}
                        aria-disabled={busyHere || !dirty}
                        aria-label={`ذخیره‌ی متن پیام ${m.businessName}`}
                        className={
                          busyHere || !dirty
                            ? "rounded-lg bg-surface-dim px-4 py-2 text-sm font-bold text-ink-muted"
                            : "rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
                        }
                      >
                        ذخیره‌ی متن
                      </button>

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
                            className="rounded-lg border border-danger/40 bg-surface px-4 py-2 text-sm font-bold text-danger transition-colors hover:bg-danger-soft"
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
                          aria-label={`ثبت ارسال پیام ${m.businessName}`}
                          className="rounded-lg bg-pine px-4 py-2 text-sm font-bold text-bone transition-colors hover:bg-pine-dark"
                        >
                          ثبت ارسال (خودم فرستادم)
                        </button>
                      )}

                    </div>

                    {m.status === "draft" && (
                      <p className="mt-2 text-xs text-ink-muted">
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
                          className="rounded-lg border border-surface-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-dim"
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
                          className="rounded-lg border border-surface-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-dim"
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
    </div>
  );
}
