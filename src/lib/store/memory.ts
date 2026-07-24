import { randomUUID } from "crypto";
import { PORTFOLIO_SEED } from "@/lib/brand";
import type {
  AgentRun,
  Campaign,
  Lead,
  LeadAnalysis,
  LeadFeedback,
  LeadStatus,
  LeadStore,
  Lesson,
  Message,
  MessageStatus,
  PortfolioItem,
} from "./types";

/**
 * ذخیره‌سازی در حافظه — برای اجرای محلی/تست بدون Supabase.
 *
 * هشدار: داده‌ها با ری‌استارت سرور پاک می‌شوند و روی Vercel قابل اتکا نیست.
 * پروداکشن مهدیار روی Supabase است (طبق تصمیم پروژه). این فقط fallback است.
 *
 * نکته: در dev، ماژول‌ها با هر hot-reload دوباره ساخته می‌شوند؛ state را روی
 * globalThis نگه می‌داریم تا بین رفرش‌ها زنده بماند.
 */

type MemoryState = {
  campaigns: Map<string, Campaign>;
  leads: Map<string, Lead>;
  analyses: Map<string, LeadAnalysis>; // key = leadId
  portfolio: Map<string, PortfolioItem>;
  messages: Map<string, Message>;
  agentRuns: AgentRun[];
  lessons: Map<string, Lesson>;
  feedback: LeadFeedback[];
};

const g = globalThis as typeof globalThis & { __mahdiyarCrmMemory?: MemoryState };

function state(): MemoryState {
  if (!g.__mahdiyarCrmMemory) {
    const portfolio = new Map<string, PortfolioItem>();
    // seed نمونه‌کارهای مهدیار (منبع واحد: brand.PORTFOLIO_SEED)
    for (const p of PORTFOLIO_SEED) {
      const id = randomUUID();
      portfolio.set(id, { ...p, id, createdAt: new Date().toISOString() });
    }
    g.__mahdiyarCrmMemory = {
      campaigns: new Map(),
      leads: new Map(),
      analyses: new Map(),
      portfolio,
      messages: new Map(),
      agentRuns: [],
      lessons: new Map(),
      feedback: [],
    };
  }
  return g.__mahdiyarCrmMemory;
}

export class MemoryStore implements LeadStore {
  /* ── کمپین‌ها ── */
  async createCampaign(c: Campaign) {
    state().campaigns.set(c.id, c);
  }
  async updateCampaign(id: string, patch: Partial<Campaign>) {
    const cur = state().campaigns.get(id);
    if (cur) state().campaigns.set(id, { ...cur, ...patch });
  }
  async getCampaign(id: string) {
    return state().campaigns.get(id) ?? null;
  }
  async listCampaigns() {
    return [...state().campaigns.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  /* ── لیدها ── */
  async createLead(lead: Lead) {
    state().leads.set(lead.id, lead);
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    const cur = state().leads.get(id);
    if (cur) state().leads.set(id, { ...cur, ...patch, updatedAt: new Date().toISOString() });
  }
  async getLead(id: string) {
    return state().leads.get(id) ?? null;
  }
  async findLeadByDedupKey(dedupKey: string) {
    for (const l of state().leads.values()) if (l.dedupKey === dedupKey) return l;
    return null;
  }
  async listLeads(opts?: { campaignId?: string; status?: LeadStatus; limit?: number }) {
    let all = [...state().leads.values()];
    if (opts?.campaignId) all = all.filter((l) => l.campaignId === opts.campaignId);
    if (opts?.status) all = all.filter((l) => l.status === opts.status);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts?.limit ? all.slice(0, opts.limit) : all;
  }

  /* ── تحلیل ── */
  async upsertAnalysis(analysis: LeadAnalysis) {
    state().analyses.set(analysis.leadId, analysis);
  }
  async getAnalysis(leadId: string) {
    return state().analyses.get(leadId) ?? null;
  }

  /* ── نمونه‌کار ── */
  async listPortfolio(opts?: { service?: string; approvedOnly?: boolean }) {
    let all = [...state().portfolio.values()];
    if (opts?.service) all = all.filter((p) => p.service === opts.service);
    if (opts?.approvedOnly) all = all.filter((p) => p.approved && p.shareAllowed);
    return all.sort((a, b) => a.title.localeCompare(b.title));
  }
  async getPortfolioItem(id: string) {
    return state().portfolio.get(id) ?? null;
  }
  async createPortfolioItem(item: PortfolioItem) {
    state().portfolio.set(item.id, item);
  }

  /* ── پیام‌ها ── */
  async createMessage(msg: Message) {
    state().messages.set(msg.id, msg);
  }
  async updateMessage(id: string, patch: Partial<Message>) {
    const cur = state().messages.get(id);
    if (cur) state().messages.set(id, { ...cur, ...patch });
  }
  async getMessage(id: string) {
    return state().messages.get(id) ?? null;
  }
  async listMessages(opts?: { leadId?: string; status?: MessageStatus }) {
    let all = [...state().messages.values()];
    if (opts?.leadId) all = all.filter((m) => m.leadId === opts.leadId);
    if (opts?.status) all = all.filter((m) => m.status === opts.status);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /* ── ثبت اجرای ایجنت ── */
  async addAgentRun(run: AgentRun) {
    state().agentRuns.push(run);
  }
  async listAgentRuns(leadId?: string, limit = 100) {
    const all = leadId
      ? state().agentRuns.filter((r) => r.leadId === leadId)
      : state().agentRuns;
    return [...all]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /* ── درس‌ها ── */
  async addLesson(lesson: Lesson) {
    state().lessons.set(lesson.id, lesson);
  }
  async listLessons(opts?: { agent?: string; activeOnly?: boolean }) {
    let all = [...state().lessons.values()];
    if (opts?.agent) all = all.filter((l) => l.agent === opts.agent);
    if (opts?.activeOnly) all = all.filter((l) => l.active);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async deactivateLesson(id: string) {
    const cur = state().lessons.get(id);
    if (cur) state().lessons.set(id, { ...cur, active: false });
  }

  /* ── بازخورد ── */
  async addFeedback(fb: LeadFeedback) {
    state().feedback.push(fb);
  }
  async listFeedback(leadId?: string) {
    const all = leadId
      ? state().feedback.filter((f) => f.leadId === leadId)
      : state().feedback;
    return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
