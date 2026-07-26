import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentRun,
  Campaign,
  ContactChannels,
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
    do_not_contact: l.doNotContact,
    dedup_key: l.dedupKey,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
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
    doNotContact: r.do_not_contact,
    dedupKey: r.dedup_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
    sent_at: m.sentAt,
    created_at: m.createdAt,
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
    sentAt: r.sent_at,
    createdAt: r.created_at,
  };
}

/* ── ثبت اجرای ایجنت ────────────────────────────────────── */

function agentRunToRow(r: AgentRun) {
  return {
    id: r.id,
    lead_id: r.leadId,
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
  };
}
function agentRunFromRow(r: any): AgentRun {
  return {
    id: r.id,
    leadId: r.lead_id,
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
  async findLeadByDedupKey(dedupKey: string) {
    const { data } = await client()
      .from("leads")
      .select("*")
      .eq("dedup_key", dedupKey)
      .maybeSingle();
    return data ? leadFromRow(data) : null;
  }
  async listLeads(opts?: { campaignId?: string; status?: LeadStatus; limit?: number }) {
    let q = client().from("leads").select("*").order("created_at", { ascending: false });
    if (opts?.campaignId) q = q.eq("campaign_id", opts.campaignId);
    if (opts?.status) q = q.eq("status", opts.status);
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
  async listMessages(opts?: { leadId?: string; status?: MessageStatus }) {
    let q = client().from("messages").select("*").order("created_at", { ascending: false });
    if (opts?.leadId) q = q.eq("lead_id", opts.leadId);
    if (opts?.status) q = q.eq("status", opts.status);
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
    });
    if (error) throw new Error(`ثبت درس ناموفق بود: ${error.message}`);
  }
  async listLessons(opts?: { agent?: string; activeOnly?: boolean }) {
    let q = client().from("lessons").select("*").order("created_at", { ascending: false });
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
}
