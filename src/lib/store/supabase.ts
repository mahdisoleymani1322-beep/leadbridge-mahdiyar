import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentRun,
  AuditEntry,
  Campaign,
  ContactChannels,
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
  TrashBatch,
  TrashKind,
} from "./types";

/**
 * ذخیره‌سازی Supabase — پروداکشن مهدیار. اسکیمای جدول‌ها در supabase/schema.sql.
 * ستون‌ها snake_case و تایپ‌ها camelCase؛ توابع toRow/fromRow تبدیل را یک‌جا انجام می‌دهند.
 */

function client(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      // fetch سوپابیس را no-store می‌کنیم تا کش Next عکس لحظه‌ای قدیمی نگه ندارد.
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    }
  );
}

/** پارشیال camelCase → پارشیال snake_case (فقط کلیدهای موجود در patch) */
function partialToRow<T>(
  patch: Partial<T>,
  mapper: (full: T) => Record<string, unknown>
): Record<string, unknown> {
  const fullRow = mapper(patch as T);
  const camelKeys = Object.keys(patch as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [snake, value] of Object.entries(fullRow)) {
    const camel = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camelKeys.includes(camel)) out[snake] = value;
  }
  return out;
}

/* ── کمپین ─────────────────────────────────────────────── */

function campaignToRow(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    market: c.market,
    city: c.city,
    primary_service: c.primaryService,
    daily_discovery_limit: c.dailyDiscoveryLimit,
    daily_message_limit: c.dailyMessageLimit,
    status: c.status,
    created_at: c.createdAt,
    deleted_at: c.deletedAt,
    deleted_batch: c.deletedBatch,
  };
}
function campaignFromRow(r: any): Campaign {
  return {
    id: r.id,
    name: r.name,
    market: r.market,
    city: r.city,
    primaryService: r.primary_service,
    dailyDiscoveryLimit: r.daily_discovery_limit,
    dailyMessageLimit: r.daily_message_limit,
    status: r.status,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

/* ── لید ───────────────────────────────────────────────── */

function leadToRow(l: Lead) {
  return {
    id: l.id,
    campaign_id: l.campaignId,
    business_name: l.businessName,
    industry: l.industry,
    city: l.city,
    address: l.address,
    phone: l.phone,
    website: l.website,
    instagram_handle: l.instagramHandle,
    contact_channels: l.contactChannels,
    preferred_channel: l.preferredChannel,
    source: l.source,
    source_url: l.sourceUrl,
    place_id: l.placeId,
    rating: l.rating,
    reviews_count: l.reviewsCount,
    status: l.status,
    score: l.score,
    confidence: l.confidence,
    affluence_score: l.affluenceScore,
    affluence_signals: l.affluenceSignals,
    ig_note: l.igNote,
    ig_note_at: l.igNoteAt,
    shortlisted: l.shortlisted,
    shortlisted_at: l.shortlistedAt,
    do_not_contact: l.doNotContact,
    dedup_key: l.dedupKey,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
    deleted_at: l.deletedAt,
    deleted_batch: l.deletedBatch,
  };
}
function leadFromRow(r: any): Lead {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    businessName: r.business_name,
    industry: r.industry,
    city: r.city,
    address: r.address,
    phone: r.phone,
    website: r.website,
    instagramHandle: r.instagram_handle,
    contactChannels: (r.contact_channels ?? {}) as ContactChannels,
    preferredChannel: r.preferred_channel,
    source: r.source,
    sourceUrl: r.source_url,
    placeId: r.place_id,
    rating: r.rating,
    reviewsCount: r.reviews_count,
    status: r.status,
    score: r.score,
    confidence: r.confidence,
    affluenceScore: r.affluence_score ?? null,
    affluenceSignals: (r.affluence_signals ?? []) as string[],
    igNote: r.ig_note ?? null,
    igNoteAt: r.ig_note_at ?? null,
    shortlisted: r.shortlisted ?? false,
    shortlistedAt: r.shortlisted_at ?? null,
    doNotContact: r.do_not_contact,
    dedupKey: r.dedup_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

/* ── تحلیل لید ──────────────────────────────────────────── */

function analysisToRow(a: LeadAnalysis) {
  return {
    id: a.id,
    lead_id: a.leadId,
    business_summary: a.businessSummary,
    target_customer: a.targetCustomer,
    pain_point: a.painPoint,
    need_signals: a.needSignals,
    evidence: a.evidence,
    uncertainties: a.uncertainties,
    brand_tone: a.brandTone,
    recommended_service: a.recommendedService,
    risk_flags: a.riskFlags,
    confidence: a.confidence,
    agent_version: a.agentVersion,
    created_at: a.createdAt,
  };
}
function analysisFromRow(r: any): LeadAnalysis {
  return {
    id: r.id,
    leadId: r.lead_id,
    businessSummary: r.business_summary,
    targetCustomer: r.target_customer,
    painPoint: r.pain_point,
    needSignals: r.need_signals ?? [],
    evidence: r.evidence ?? [],
    uncertainties: r.uncertainties ?? [],
    brandTone: r.brand_tone,
    recommendedService: r.recommended_service,
    riskFlags: r.risk_flags ?? [],
    confidence: r.confidence,
    agentVersion: r.agent_version,
    createdAt: r.created_at,
  };
}

/* ── نمونه‌کار ──────────────────────────────────────────── */

function portfolioToRow(p: PortfolioItem) {
  return {
    id: p.id,
    title: p.title,
    industry: p.industry,
    service: p.service,
    style: p.style,
    public_url: p.publicUrl,
    approved: p.approved,
    share_allowed: p.shareAllowed,
    tags: p.tags,
    created_at: p.createdAt,
  };
}
function portfolioFromRow(r: any): PortfolioItem {
  return {
    id: r.id,
    title: r.title,
    industry: r.industry,
    service: r.service,
    style: r.style,
    publicUrl: r.public_url,
    approved: r.approved,
    shareAllowed: r.share_allowed,
    tags: r.tags ?? [],
    createdAt: r.created_at,
  };
}

/* ── پیام ───────────────────────────────────────────────── */

function messageToRow(m: Message) {
  return {
    id: m.id,
    lead_id: m.leadId,
    target_channel: m.targetChannel,
    draft_text: m.draftText,
    final_text: m.finalText,
    email_subject: m.emailSubject,
    email_text: m.emailText,
    status: m.status,
    critic_score: m.criticScore,
    pain_targeted: m.painTargeted,
    recommended_portfolio_ids: m.recommendedPortfolioIds,
    approved_by: m.approvedBy,
    approved_at: m.approvedAt,
    rejected_at: m.rejectedAt,
    sent_at: m.sentAt,
    created_at: m.createdAt,
    deleted_at: m.deletedAt,
    deleted_batch: m.deletedBatch,
  };
}
function messageFromRow(r: any): Message {
  return {
    id: r.id,
    leadId: r.lead_id,
    targetChannel: r.target_channel,
    draftText: r.draft_text,
    finalText: r.final_text,
    emailSubject: r.email_subject,
    emailText: r.email_text,
    status: r.status,
    criticScore: r.critic_score,
    painTargeted: r.pain_targeted,
    recommendedPortfolioIds: r.recommended_portfolio_ids ?? [],
    approvedBy: r.approved_by,
    approvedAt: r.approved_at ?? null,
    rejectedAt: r.rejected_at ?? null,
    sentAt: r.sent_at,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

/* ── ثبت اجرای ایجنت ────────────────────────────────────── */

function agentRunToRow(r: AgentRun) {
  return {
    id: r.id,
    lead_id: r.leadId,
    campaign_id: r.campaignId,
    agent_name: r.agentName,
    status: r.status,
    summary: r.summary,
    output: r.output,
    token_input: r.tokenInput,
    token_output: r.tokenOutput,
    cost: r.cost,
    duration_ms: r.durationMs,
    stop_reason: r.stopReason,
    error_code: r.errorCode,
    created_at: r.createdAt,
    deleted_at: r.deletedAt,
    deleted_batch: r.deletedBatch,
  };
}
function agentRunFromRow(r: any): AgentRun {
  return {
    id: r.id,
    leadId: r.lead_id,
    campaignId: r.campaign_id ?? null,
    agentName: r.agent_name,
    status: r.status,
    summary: r.summary,
    output: r.output,
    tokenInput: r.token_input,
    tokenOutput: r.token_output,
    cost: r.cost,
    durationMs: r.duration_ms,
    stopReason: r.stop_reason,
    errorCode: r.error_code,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

function lessonFromRow(r: any): Lesson {
  return {
    id: r.id,
    agent: r.agent,
    lesson: r.lesson,
    source: r.source,
    active: r.active,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

function feedbackFromRow(r: any): LeadFeedback {
  return {
    id: r.id,
    leadId: r.lead_id,
    messageId: r.message_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

/* ── دفترچه‌ی تصمیم و گفت‌وگو ─────────────────────────────── */

function auditToRow(a: AuditEntry) {
  return {
    id: a.id,
    entity_type: a.entityType,
    entity_id: a.entityId,
    action: a.action,
    reason: a.reason,
    before_data: a.beforeData ?? null,
    after_data: a.afterData ?? null,
    created_at: a.createdAt,
    deleted_at: a.deletedAt,
    deleted_batch: a.deletedBatch,
  };
}
function auditFromRow(r: any): AuditEntry {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    reason: r.reason,
    beforeData: r.before_data,
    afterData: r.after_data,
    createdAt: r.created_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

function conversationToRow(c: Conversation) {
  return {
    id: c.id,
    lead_id: c.leadId,
    channel: c.channel,
    conversation_state: c.conversationState,
    summary: c.summary,
    sentiment: c.sentiment,
    intent: c.intent,
    next_action: c.nextAction,
    next_action_at: c.nextActionAt,
    handover_required: c.handoverRequired,
    last_message_at: c.lastMessageAt,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    deleted_at: c.deletedAt,
    deleted_batch: c.deletedBatch,
  };
}
function conversationFromRow(r: any): Conversation {
  return {
    id: r.id,
    leadId: r.lead_id,
    channel: r.channel,
    conversationState: r.conversation_state,
    summary: r.summary,
    sentiment: r.sentiment,
    intent: r.intent,
    nextAction: r.next_action,
    nextActionAt: r.next_action_at ?? null,
    handoverRequired: r.handover_required ?? false,
    lastMessageAt: r.last_message_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
    deletedBatch: r.deleted_batch ?? null,
  };
}

/* ── پیاده‌سازی ─────────────────────────────────────────── */

export class SupabaseStore implements LeadStore {
  /* کمپین‌ها */
  async createCampaign(c: Campaign) {
    const { error } = await client().from("campaigns").insert(campaignToRow(c));
    if (error) throw new Error(`ثبت کمپین ناموفق بود: ${error.message}`);
  }
  async updateCampaign(id: string, patch: Partial<Campaign>) {
    const row = partialToRow(patch, campaignToRow as any);
    const { error } = await client().from("campaigns").update(row).eq("id", id);
    if (error) throw new Error(`به‌روزرسانی کمپین ناموفق بود: ${error.message}`);
  }
  async getCampaign(id: string) {
    const { data } = await client().from("campaigns").select("*").eq("id", id).maybeSingle();
    return data ? campaignFromRow(data) : null;
  }
  async listCampaigns() {
    const { data, error } = await client()
      .from("campaigns")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`خواندن کمپین‌ها ناموفق بود: ${error.message}`);
    return (data ?? []).map(campaignFromRow);
  }

  /* لیدها */
  async createLead(lead: Lead) {
    const { error } = await client().from("leads").insert(leadToRow(lead));
    if (error) throw new Error(`ثبت لید ناموفق بود: ${error.message}`);
  }
  async updateLead(id: string, patch: Partial<Lead>) {
    const row = partialToRow({ ...patch, updatedAt: new Date().toISOString() }, leadToRow as any);
    const { error } = await client().from("leads").update(row).eq("id", id);
    if (error) throw new Error(`به‌روزرسانی لید ناموفق بود: ${error.message}`);
  }
  async getLead(id: string) {
    const { data } = await client().from("leads").select("*").eq("id", id).maybeSingle();
    return data ? leadFromRow(data) : null;
  }
  /**
   * ⚠️ اینجا عمداً `deleted_at is null` **نیست** — و این یک باگ نیست.
   *
   * این تنها جایی است که مکانیزم ضدرستاخیز کار می‌کند: `discovery.ts` پیش از
   * درج هر لید این را صدا می‌زند. اگر لید حذف‌شده را برنگردانیم، `createLead`
   * روی کلید یکتای `dedup_key` شکست می‌خورد یا — بدتر — همان کسب‌وکارِ
   * حذف‌شده دوباره وارد فهرست می‌شود. با برگرداندنش، discovery آن را «تکراری»
   * می‌شمارد و رد می‌کند؛ یعنی حذف واقعاً معنا پیدا می‌کند.
   *
   * اگر روزی این را «درست» کردی و فیلتر اضافه کردی، حذف لید بی‌اثر می‌شود.
   */
  async findLeadByDedupKey(dedupKey: string) {
    const { data } = await client()
      .from("leads")
      .select("*")
      .eq("dedup_key", dedupKey)
      .maybeSingle();
    return data ? leadFromRow(data) : null;
  }
  async listLeads(opts?: {
    campaignId?: string;
    status?: LeadStatus;
    limit?: number;
    from?: string;
    to?: string;
  }) {
    let q = client()
      .from("leads")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (opts?.campaignId) q = q.eq("campaign_id", opts.campaignId);
    if (opts?.status) q = q.eq("status", opts.status);
    if (opts?.from) q = q.gte("created_at", opts.from);
    if (opts?.to) q = q.lte("created_at", opts.to);
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`خواندن لیدها ناموفق بود: ${error.message}`);
    return (data ?? []).map(leadFromRow);
  }

  /* تحلیل */
  async upsertAnalysis(analysis: LeadAnalysis) {
    const { error } = await client()
      .from("lead_analysis")
      .upsert(analysisToRow(analysis), { onConflict: "lead_id" });
    if (error) throw new Error(`ثبت تحلیل ناموفق بود: ${error.message}`);
  }
  async getAnalysis(leadId: string) {
    const { data } = await client()
      .from("lead_analysis")
      .select("*")
      .eq("lead_id", leadId)
      .maybeSingle();
    return data ? analysisFromRow(data) : null;
  }

  /* نمونه‌کار */
  async listPortfolio(opts?: { service?: string; approvedOnly?: boolean }) {
    let q = client().from("portfolio_items").select("*").order("title", { ascending: true });
    if (opts?.service) q = q.eq("service", opts.service);
    if (opts?.approvedOnly) q = q.eq("approved", true).eq("share_allowed", true);
    const { data, error } = await q;
    if (error) throw new Error(`خواندن نمونه‌کارها ناموفق بود: ${error.message}`);
    return (data ?? []).map(portfolioFromRow);
  }
  async getPortfolioItem(id: string) {
    const { data } = await client()
      .from("portfolio_items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? portfolioFromRow(data) : null;
  }
  async createPortfolioItem(item: PortfolioItem) {
    const { error } = await client().from("portfolio_items").insert(portfolioToRow(item));
    if (error) throw new Error(`ثبت نمونه‌کار ناموفق بود: ${error.message}`);
  }

  /* پیام‌ها */
  async createMessage(msg: Message) {
    const { error } = await client().from("messages").insert(messageToRow(msg));
    if (error) throw new Error(`ثبت پیام ناموفق بود: ${error.message}`);
  }
  async updateMessage(id: string, patch: Partial<Message>) {
    const row = partialToRow(patch, messageToRow as any);
    const { error } = await client().from("messages").update(row).eq("id", id);
    if (error) throw new Error(`به‌روزرسانی پیام ناموفق بود: ${error.message}`);
  }
  async getMessage(id: string) {
    const { data } = await client().from("messages").select("*").eq("id", id).maybeSingle();
    return data ? messageFromRow(data) : null;
  }
  async listMessages(opts?: { leadId?: string; status?: MessageStatus; from?: string; to?: string }) {
    let q = client()
      .from("messages")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (opts?.leadId) q = q.eq("lead_id", opts.leadId);
    if (opts?.status) q = q.eq("status", opts.status);
    if (opts?.from) q = q.gte("created_at", opts.from);
    if (opts?.to) q = q.lte("created_at", opts.to);
    const { data, error } = await q;
    if (error) throw new Error(`خواندن پیام‌ها ناموفق بود: ${error.message}`);
    return (data ?? []).map(messageFromRow);
  }

  /* ثبت اجرای ایجنت */
  async addAgentRun(run: AgentRun) {
    const { error } = await client().from("agent_runs").insert(agentRunToRow(run));
    if (error) throw new Error(`ثبت اجرای ایجنت ناموفق بود: ${error.message}`);
  }
  async listAgentRuns(leadId?: string, limit = 100) {
    let q = client()
      .from("agent_runs")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (leadId) q = q.eq("lead_id", leadId);
    const { data } = await q;
    return (data ?? []).map(agentRunFromRow);
  }

  /* درس‌ها */
  async addLesson(lesson: Lesson) {
    const { error } = await client().from("lessons").insert({
      id: lesson.id,
      agent: lesson.agent,
      lesson: lesson.lesson,
      source: lesson.source,
      active: lesson.active,
      created_at: lesson.createdAt,
      deleted_at: lesson.deletedAt,
      deleted_batch: lesson.deletedBatch,
    });
    if (error) throw new Error(`ثبت درس ناموفق بود: ${error.message}`);
  }
  async listLessons(opts?: { agent?: string; activeOnly?: boolean }) {
    let q = client()
      .from("lessons")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (opts?.agent) q = q.eq("agent", opts.agent);
    if (opts?.activeOnly) q = q.eq("active", true);
    const { data } = await q;
    return (data ?? []).map(lessonFromRow);
  }
  async deactivateLesson(id: string) {
    await client().from("lessons").update({ active: false }).eq("id", id);
  }

  /* بازخورد */
  async addFeedback(fb: LeadFeedback) {
    const { error } = await client().from("lead_feedback").insert({
      id: fb.id,
      lead_id: fb.leadId,
      message_id: fb.messageId,
      rating: fb.rating,
      comment: fb.comment,
      created_at: fb.createdAt,
    });
    if (error) throw new Error(`ثبت بازخورد ناموفق بود: ${error.message}`);
  }
  async listFeedback(leadId?: string) {
    let q = client().from("lead_feedback").select("*").order("created_at", { ascending: false });
    if (leadId) q = q.eq("lead_id", leadId);
    const { data } = await q;
    return (data ?? []).map(feedbackFromRow);
  }

  /* اجراهای یک بازه — مستقل از لید (صفحه‌ی CRM) */
  async listAgentRunsBetween(opts: DateRange & { campaignId?: string; limit?: number }) {
    let q = client()
      .from("agent_runs")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(opts.limit ?? 500);
    if (opts.from) q = q.gte("created_at", opts.from);
    if (opts.to) q = q.lte("created_at", opts.to);
    if (opts.campaignId) q = q.eq("campaign_id", opts.campaignId);
    const { data, error } = await q;
    if (error) throw new Error(`خواندن اجراهای ایجنت ناموفق بود: ${error.message}`);
    return (data ?? []).map(agentRunFromRow);
  }

  /* دفترچه‌ی تصمیم */
  async addAudit(entry: AuditEntry) {
    const { error } = await client().from("audit_log").insert(auditToRow(entry));
    if (error) throw new Error(`ثبت تصمیم ناموفق بود: ${error.message}`);
  }
  async listAudit(opts: DateRange & { entityType?: AuditEntry["entityType"]; limit?: number }) {
    let q = client()
      .from("audit_log")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(opts.limit ?? 500);
    if (opts.from) q = q.gte("created_at", opts.from);
    if (opts.to) q = q.lte("created_at", opts.to);
    if (opts.entityType) q = q.eq("entity_type", opts.entityType);
    const { data, error } = await q;
    if (error) throw new Error(`خواندن دفترچه‌ی تصمیم ناموفق بود: ${error.message}`);
    return (data ?? []).map(auditFromRow);
  }

  /* گفت‌وگو / پیگیری — یک ردیف به‌ازای هر لید */
  async upsertConversation(c: Conversation) {
    const { error } = await client()
      .from("conversations")
      .upsert(conversationToRow(c), { onConflict: "lead_id" });
    if (error) throw new Error(`ثبت گفت‌وگو ناموفق بود: ${error.message}`);
  }
  async getConversation(leadId: string) {
    const { data } = await client()
      .from("conversations")
      .select("*")
      .eq("lead_id", leadId)
      .maybeSingle();
    return data ? conversationFromRow(data) : null;
  }
  async listConversations(opts?: DateRange & { leadId?: string; limit?: number }) {
    let q = client()
      .from("conversations")
      .select("*")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(opts?.limit ?? 500);
    if (opts?.leadId) q = q.eq("lead_id", opts.leadId);
    if (opts?.from) q = q.gte("updated_at", opts.from);
    if (opts?.to) q = q.lte("updated_at", opts.to);
    const { data, error } = await q;
    if (error) throw new Error(`خواندن گفت‌وگوها ناموفق بود: ${error.message}`);
    return (data ?? []).map(conversationFromRow);
  }

  /* ── حذف نرم، بازگردانی، سطل زباله ────────────────────── */

  async softDelete(kind: TrashKind, ids: string[]): Promise<DeleteResult> {
    const c = client();
    const batch = randomUUID();
    const at = new Date().toISOString();
    const stamp = { deleted_at: at, deleted_batch: batch };
    const counts: DeleteResult["counts"] = {};

    // فقط شناسه‌های واقعاً موجود و هنوز حذف‌نشده — تا گزارش «۱۷ حذف شد، ۳ پیدا
    // نشد» راست باشد و نه صرفاً تعداد ورودی
    const alive = async (table: string, col: string, values: string[]) => {
      if (values.length === 0) return [] as string[];
      const { data } = await c.from(table).select("id").in(col, values).is("deleted_at", null);
      return (data ?? []).map((r: any) => r.id as string);
    };
    const mark = async (table: string, col: string, values: string[]) => {
      if (values.length === 0) return 0;
      const { data, error } = await c
        .from(table)
        .update(stamp)
        .in(col, values)
        .is("deleted_at", null)
        .select("id");
      if (error) throw new Error(`حذف از ${table} ناموفق بود: ${error.message}`);
      return (data ?? []).length;
    };
    /** شناسه‌های زنده‌ی یک جدول که به مجموعه‌ای از والدها وصل‌اند */
    const childIds = async (table: string, col: string, parents: string[]) => {
      if (parents.length === 0) return [] as string[];
      const { data } = await c.from(table).select("id").in(col, parents).is("deleted_at", null);
      return (data ?? []).map((r: any) => r.id as string);
    };

    if (kind === "campaign") {
      const campaignIds = await alive("campaigns", "id", ids);
      // لیدهای کمپین را باید **قبل** از علامت‌زدن پیدا کرد، وگرنه فیلتر
      // deleted_at آن‌ها را رد می‌کند و آبشار نیمه‌کاره می‌ماند
      const leadIds = await childIds("leads", "campaign_id", campaignIds);
      const msgIds = await childIds("messages", "lead_id", leadIds);
      const convIds = await childIds("conversations", "lead_id", leadIds);

      counts.messages = await mark("messages", "id", msgIds);
      counts.conversations = await mark("conversations", "id", convIds);
      counts.leads = await mark("leads", "id", leadIds);
      counts.campaigns = await mark("campaigns", "id", campaignIds);
      counts.agentRuns =
        (await mark("agent_runs", "lead_id", leadIds)) +
        (await mark("agent_runs", "campaign_id", campaignIds));
      counts.audit =
        (await mark("audit_log", "entity_id", [...campaignIds, ...leadIds, ...msgIds]));
      return { batch, counts, missing: ids.filter((id) => !campaignIds.includes(id)) };
    }

    if (kind === "lead") {
      const leadIds = await alive("leads", "id", ids);
      const msgIds = await childIds("messages", "lead_id", leadIds);
      const convIds = await childIds("conversations", "lead_id", leadIds);

      counts.messages = await mark("messages", "id", msgIds);
      counts.conversations = await mark("conversations", "id", convIds);
      counts.leads = await mark("leads", "id", leadIds);
      counts.agentRuns = await mark("agent_runs", "lead_id", leadIds);
      counts.audit = await mark("audit_log", "entity_id", [...leadIds, ...msgIds]);
      return { batch, counts, missing: ids.filter((id) => !leadIds.includes(id)) };
    }

    const table = kind === "message" ? "messages" : kind === "conversation" ? "conversations" : "lessons";
    const key = kind === "message" ? "messages" : kind === "conversation" ? "conversations" : "lessons";
    const found = await alive(table, "id", ids);
    counts[key] = await mark(table, "id", found);
    if (kind === "message") counts.audit = await mark("audit_log", "entity_id", found);
    return { batch, counts, missing: ids.filter((id) => !found.includes(id)) };
  }

  async restoreBatch(batch: string): Promise<DeleteResult> {
    const c = client();
    const clear = { deleted_at: null, deleted_batch: null };
    const counts: DeleteResult["counts"] = {};
    const undo = async (table: string) => {
      const { data, error } = await c.from(table).update(clear).eq("deleted_batch", batch).select("id");
      if (error) throw new Error(`بازگردانی ${table} ناموفق بود: ${error.message}`);
      return (data ?? []).length;
    };
    counts.campaigns = await undo("campaigns");
    counts.leads = await undo("leads");
    counts.messages = await undo("messages");
    counts.conversations = await undo("conversations");
    counts.lessons = await undo("lessons");
    counts.agentRuns = await undo("agent_runs");
    counts.audit = await undo("audit_log");
    return { batch, counts, missing: [] };
  }

  /**
   * دسته‌های حذف‌شده — گروه‌بندی در JS انجام می‌شود، نه با کوئری گروهی.
   * تعداد دسته‌ها در این سیستم ده‌هاست نه ده‌هزارتا، پس ساده‌ترین راهِ درست
   * بهتر از یک view یا RPC است که باید جدا نگه‌داری شود.
   */
  async listTrash(limit = 100): Promise<TrashBatch[]> {
    const c = client();
    const groups = new Map<string, TrashBatch>();

    const take = async (
      table: string,
      kind: TrashKind,
      labelCol: string | null,
      countKey: keyof DeleteResult["counts"],
      extraCols = ""
    ) => {
      const cols = ["id", labelCol, "deleted_at", "deleted_batch", extraCols]
        .filter(Boolean)
        .join(", ");
      const { data } = await c
        .from(table)
        .select(cols)
        .not("deleted_batch", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(2000);
      const rows = (data ?? []) as any[];
      for (const r of rows) {
        const b = r.deleted_batch as string;
        let g = groups.get(b);
        if (!g) {
          g = { batch: b, deletedAt: r.deleted_at, kind, counts: {}, labels: [] };
          groups.set(b, g);
        }
        g.counts[countKey] = (g.counts[countKey] ?? 0) + 1;
        // نوع دسته را والدترین موجودیتِ داخلش تعیین می‌کند: دسته‌ای که کمپین
        // دارد «حذف کمپین» است، نه «حذف پیام»
        if (kind === "campaign" || (kind === "lead" && g.kind !== "campaign")) g.kind = kind;
        if (labelCol && g.labels.length < 4 && r[labelCol]) {
          g.labels.push(String(r[labelCol]).slice(0, 60));
        }
      }
      return rows;
    };

    await take("campaigns", "campaign", "name", "campaigns");
    await take("leads", "lead", "business_name", "leads");
    await take("conversations", "conversation", "summary", "conversations");
    await take("lessons", "lesson", "lesson", "lessons");
    // پیام برچسب خواندنی خودش را ندارد؛ نامش نام همان کسب‌وکار است که روی لید
    // نشسته. یک کوئری دوم به‌جای join، چون رابطه‌ی FK در PostgREST نام‌گذاری
    // ضمنی دارد و به تغییر اسکیما حساس است.
    const msgRows = await take("messages", "message", null, "messages", "lead_id");
    const needName = [...groups.values()].filter((g) => g.labels.length === 0);
    if (needName.length > 0 && msgRows.length > 0) {
      const leadIds = [...new Set(msgRows.map((r) => r.lead_id).filter(Boolean))];
      const { data: leadRows } = await c
        .from("leads")
        .select("id, business_name")
        .in("id", leadIds as string[]);
      const nameOf = new Map((leadRows ?? []).map((r: any) => [r.id, r.business_name]));
      for (const r of msgRows) {
        const g = groups.get(r.deleted_batch);
        const name = nameOf.get(r.lead_id);
        if (g && name && g.labels.length < 4 && !g.labels.includes(name)) g.labels.push(name);
      }
    }

    return [...groups.values()]
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
      .slice(0, limit);
  }
}
