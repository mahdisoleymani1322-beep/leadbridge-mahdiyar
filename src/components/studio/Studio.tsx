"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Campaign, Lead, ContactChannels, ChannelKey } from "@/lib/store/types";
import { MARKETS } from "@/lib/config";
import { SERVICES } from "@/lib/brand";

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
          title={String(channels[k])}
        >
          {CHANNEL_LABELS[k]}
        </li>
      ))}
    </ul>
  );
}

/* ── کامپوننت اصلی ────────────────────────────────────────── */

export function Studio() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<null | "load" | "create" | "discover">(null);

  // فرم کمپین جدید
  const [name, setName] = useState("");
  const [market, setMarket] = useState(MARKETS[0]?.id ?? "");
  const [city, setCity] = useState("تهران");
  const [service, setService] = useState(SERVICES[0]?.id ?? "");

  const loadCampaigns = useCallback(async () => {
    const { campaigns } = await api<{ campaigns: Campaign[] }>("/api/campaigns");
    setCampaigns(campaigns);
    return campaigns;
  }, []);

  const loadLeads = useCallback(async (campaignId: string) => {
    const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    const { leads } = await api<{ leads: Lead[] }>(`/api/leads${q}`);
    setLeads(leads);
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
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    })();
  }, [loadCampaigns, loadLeads]);

  async function selectCampaign(id: string) {
    setSelectedId(id);
    setError("");
    setNotice("");
    try {
      await loadLeads(id);
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

  return (
    <div className="space-y-10">
      {/* پیام‌های وضعیت (زنده برای screen reader) */}
      <div aria-live="polite" className="space-y-2">
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">
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
          <button
            type="button"
            onClick={discover}
            disabled={!selectedId || busy === "discover"}
            className="rounded-lg bg-pine px-5 py-2.5 text-sm font-bold text-bone shadow-card transition-colors hover:bg-pine-dark disabled:opacity-60"
          >
            {busy === "discover" ? "در حال کشف لید…" : "کشف لید برای کمپین انتخابی 🔎"}
          </button>
        </div>

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
          <div className="overflow-x-auto rounded-xl border border-surface-line shadow-card">
            <table className="w-full min-w-[720px] border-collapse text-right text-sm">
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
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line bg-surface">
                {leads.map((l) => (
                  <tr key={l.id} className="align-top">
                    <th scope="row" className="px-4 py-3 text-right font-medium text-ink">
                      {l.website ? (
                        <a
                          href={l.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-700 underline decoration-dotted underline-offset-2 hover:text-brand-600"
                        >
                          {l.businessName}
                        </a>
                      ) : (
                        l.businessName
                      )}
                    </th>
                    <td className="px-4 py-3 text-ink-muted">{l.industry ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">{l.city ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted" dir="ltr">{l.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Channels channels={l.contactChannels} />
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{l.score ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-surface-dim px-2 py-0.5 text-xs font-medium text-ink">
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
