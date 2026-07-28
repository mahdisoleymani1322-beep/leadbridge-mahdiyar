import { randomUUID } from "crypto";
import { PORTFOLIO_SEED } from "@/lib/brand";
import type {
  AgentRun,
  AuditEntry,
  Campaign,
  Conversation,
  DateRange,
  DeleteResult,
  Lead,
  LeadAnalysis,
  LeadFeedback,
  LeadStatus,
  LeadStore,
  Lesson,
  Message,
  MessageStatus,
  PortfolioItem,
  SoftDeleteFields,
  TrashBatch,
  TrashKind,
} from "./types";

/** فیلتر بازه روی یک تاریخ ISO — مشترک بین همه‌ی کوئری‌های صفحه‌ی CRM */
function inRange(at: string | null | undefined, r: DateRange): boolean {
  if (!at) return false;
  if (r.from && at < r.from) return false;
  if (r.to && at > r.to) return false;
  return true;
}

/** فقط ردیف‌های حذف‌نشده — قرینه‌ی `.is("deleted_at", null)` در SupabaseStore */
function live<T extends SoftDeleteFields>(rows: T[]): T[] {
  return rows.filter((r) => !r.deletedAt);
}

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
  audit: AuditEntry[];
  conversations: Map<string, Conversation>; // key = leadId
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
      audit: [],
      conversations: new Map(),
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
    return live([...state().campaigns.values()]).sort((a, b) =>
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
  async listLeads(opts?: {
    campaignId?: string;
    status?: LeadStatus;
    limit?: number;
    from?: string;
    to?: string;
  }) {
    let all = live([...state().leads.values()]);
    if (opts?.campaignId) all = all.filter((l) => l.campaignId === opts.campaignId);
    if (opts?.status) all = all.filter((l) => l.status === opts.status);
    if (opts?.from || opts?.to) all = all.filter((l) => inRange(l.createdAt, opts));
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
  async listMessages(opts?: { leadId?: string; status?: MessageStatus; from?: string; to?: string }) {
    let all = live([...state().messages.values()]);
    if (opts?.leadId) all = all.filter((m) => m.leadId === opts.leadId);
    if (opts?.status) all = all.filter((m) => m.status === opts.status);
    if (opts?.from || opts?.to) all = all.filter((m) => inRange(m.createdAt, opts));
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /* ── ثبت اجرای ایجنت ── */
  async addAgentRun(run: AgentRun) {
    state().agentRuns.push(run);
  }
  async listAgentRuns(leadId?: string, limit = 100) {
    const rows = live(state().agentRuns);
    const all = leadId ? rows.filter((r) => r.leadId === leadId) : rows;
    return [...all]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /* ── درس‌ها ── */
  async addLesson(lesson: Lesson) {
    state().lessons.set(lesson.id, lesson);
  }
  async listLessons(opts?: { agent?: string; activeOnly?: boolean }) {
    let all = live([...state().lessons.values()]);
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

  /* ── اجراهای یک بازه ── */
  async listAgentRunsBetween(opts: DateRange & { campaignId?: string; limit?: number }) {
    let all = live(state().agentRuns).filter((r) => inRange(r.createdAt, opts));
    if (opts.campaignId) all = all.filter((r) => r.campaignId === opts.campaignId);
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit ?? 500);
  }

  /* ── دفترچه‌ی تصمیم ── */
  async addAudit(entry: AuditEntry) {
    state().audit.push(entry);
  }
  async listAudit(opts: DateRange & { entityType?: AuditEntry["entityType"]; limit?: number }) {
    let all = live(state().audit).filter((a) => inRange(a.createdAt, opts));
    if (opts.entityType) all = all.filter((a) => a.entityType === opts.entityType);
    return all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit ?? 500);
  }

  /* ── گفت‌وگو / پیگیری ── */
  async upsertConversation(c: Conversation) {
    state().conversations.set(c.leadId, c);
  }
  async getConversation(leadId: string) {
    return state().conversations.get(leadId) ?? null;
  }
  async listConversations(opts?: DateRange & { leadId?: string; limit?: number }) {
    let all = live([...state().conversations.values()]);
    if (opts?.leadId) all = all.filter((c) => c.leadId === opts.leadId);
    if (opts?.from || opts?.to) all = all.filter((c) => inRange(c.updatedAt, opts));
    return all
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, opts?.limit ?? 500);
  }

  /* ── حذف نرم، بازگردانی، سطل زباله ── */

  async softDelete(kind: TrashKind, ids: string[]): Promise<DeleteResult> {
    const st = state();
    const batch = randomUUID();
    const at = new Date().toISOString();
    const counts: DeleteResult["counts"] = {};

    const stampAll = <T extends SoftDeleteFields>(rows: T[]): number => {
      let n = 0;
      for (const r of rows) {
        if (r.deletedAt) continue;
        r.deletedAt = at;
        r.deletedBatch = batch;
        n++;
      }
      return n;
    };
    const runsOf = (leadIds: string[], campaignIds: string[] = []) =>
      st.agentRuns.filter(
        (r) =>
          (r.leadId && leadIds.includes(r.leadId)) ||
          (r.campaignId && campaignIds.includes(r.campaignId))
      );
    const auditOf = (entityIds: string[]) =>
      st.audit.filter((a) => a.entityId && entityIds.includes(a.entityId));

    if (kind === "campaign") {
      const camps = ids.map((id) => st.campaigns.get(id)).filter((c): c is Campaign => !!c && !c.deletedAt);
      const campIds = camps.map((c) => c.id);
      const leads = live([...st.leads.values()]).filter((l) => l.campaignId && campIds.includes(l.campaignId));
      const leadIds = leads.map((l) => l.id);
      const msgs = live([...st.messages.values()]).filter((m) => leadIds.includes(m.leadId));
      const convs = live([...st.conversations.values()]).filter((c) => leadIds.includes(c.leadId));

      counts.messages = stampAll(msgs);
      counts.conversations = stampAll(convs);
      counts.leads = stampAll(leads);
      counts.campaigns = stampAll(camps);
      counts.agentRuns = stampAll(runsOf(leadIds, campIds));
      counts.audit = stampAll(auditOf([...campIds, ...leadIds, ...msgs.map((m) => m.id)]));
      return { batch, counts, missing: ids.filter((id) => !campIds.includes(id)) };
    }

    if (kind === "lead") {
      const leads = ids.map((id) => st.leads.get(id)).filter((l): l is Lead => !!l && !l.deletedAt);
      const leadIds = leads.map((l) => l.id);
      const msgs = live([...st.messages.values()]).filter((m) => leadIds.includes(m.leadId));
      const convs = live([...st.conversations.values()]).filter((c) => leadIds.includes(c.leadId));

      counts.messages = stampAll(msgs);
      counts.conversations = stampAll(convs);
      counts.leads = stampAll(leads);
      counts.agentRuns = stampAll(runsOf(leadIds));
      counts.audit = stampAll(auditOf([...leadIds, ...msgs.map((m) => m.id)]));
      return { batch, counts, missing: ids.filter((id) => !leadIds.includes(id)) };
    }

    if (kind === "message") {
      const msgs = ids.map((id) => st.messages.get(id)).filter((m): m is Message => !!m && !m.deletedAt);
      counts.messages = stampAll(msgs);
      counts.audit = stampAll(auditOf(msgs.map((m) => m.id)));
      const found = msgs.map((m) => m.id);
      return { batch, counts, missing: ids.filter((id) => !found.includes(id)) };
    }

    if (kind === "conversation") {
      // کلیدِ Map شناسه‌ی لید است، نه شناسه‌ی خود گفت‌وگو
      const convs = live([...st.conversations.values()]).filter((c) => ids.includes(c.id));
      counts.conversations = stampAll(convs);
      const found = convs.map((c) => c.id);
      return { batch, counts, missing: ids.filter((id) => !found.includes(id)) };
    }

    const lessons = ids.map((id) => st.lessons.get(id)).filter((l): l is Lesson => !!l && !l.deletedAt);
    counts.lessons = stampAll(lessons);
    const foundLessons = lessons.map((l) => l.id);
    return { batch, counts, missing: ids.filter((id) => !foundLessons.includes(id)) };
  }

  async restoreBatch(batch: string): Promise<DeleteResult> {
    const st = state();
    const counts: DeleteResult["counts"] = {};
    const undo = <T extends SoftDeleteFields>(rows: T[]): number => {
      let n = 0;
      for (const r of rows) {
        if (r.deletedBatch !== batch) continue;
        r.deletedAt = null;
        r.deletedBatch = null;
        n++;
      }
      return n;
    };
    counts.campaigns = undo([...st.campaigns.values()]);
    counts.leads = undo([...st.leads.values()]);
    counts.messages = undo([...st.messages.values()]);
    counts.conversations = undo([...st.conversations.values()]);
    counts.lessons = undo([...st.lessons.values()]);
    counts.agentRuns = undo(st.agentRuns);
    counts.audit = undo(st.audit);
    return { batch, counts, missing: [] };
  }

  async listTrash(limit = 100): Promise<TrashBatch[]> {
    const st = state();
    const groups = new Map<string, TrashBatch>();
    const nameOfLead = (id: string) => st.leads.get(id)?.businessName ?? null;

    const take = <T extends SoftDeleteFields>(
      rows: T[],
      kind: TrashKind,
      countKey: keyof DeleteResult["counts"],
      label: (r: T) => string | null
    ) => {
      for (const r of rows) {
        if (!r.deletedBatch || !r.deletedAt) continue;
        let g = groups.get(r.deletedBatch);
        if (!g) {
          g = { batch: r.deletedBatch, deletedAt: r.deletedAt, kind, counts: {}, labels: [] };
          groups.set(r.deletedBatch, g);
        }
        g.counts[countKey] = (g.counts[countKey] ?? 0) + 1;
        if (kind === "campaign" || (kind === "lead" && g.kind !== "campaign")) g.kind = kind;
        const l = label(r);
        if (l && g.labels.length < 4 && !g.labels.includes(l)) g.labels.push(l.slice(0, 60));
      }
    };

    take([...st.campaigns.values()], "campaign", "campaigns", (c) => c.name);
    take([...st.leads.values()], "lead", "leads", (l) => l.businessName);
    take([...st.conversations.values()], "conversation", "conversations", (c) => c.summary);
    take([...st.lessons.values()], "lesson", "lessons", (l) => l.lesson);
    take([...st.messages.values()], "message", "messages", (m) => nameOfLead(m.leadId));

    return [...groups.values()]
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
      .slice(0, limit);
  }
}
