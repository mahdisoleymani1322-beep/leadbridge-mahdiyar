/**
 * تایپ‌های مشترک لایه‌ی ذخیره‌سازی CRM — «LeadBridge مهدیار».
 *
 * نکته‌ی معماری (حفظ‌شده از نسخه‌ی بلاگ): کل سیستم فقط با interface
 * `LeadStore` کار می‌کند (الگوی Adapter). دو پیاده‌سازی داریم: Supabase
 * (پروداکشن، طبق نقشه‌راه §9) و حافظه‌ی موقت (اجرای محلی/تست بدون تنظیمات).
 * ایجنت‌ها و ارکستریتور هیچ‌وقت مستقیم به دیتابیس وصل نمی‌شوند.
 *
 * تایپ‌ها camelCase‌اند و ستون‌های دیتابیس snake_case؛ تبدیل در supabase.ts.
 */

/* ── کمپین ───────────────────────────────────────────────── */

export type CampaignStatus = "active" | "paused";

/** یک کمپین = یک بازار هدف + شهر + خدمت اصلی + سقف‌های روزانه */
export type Campaign = {
  id: string;
  name: string;
  /** شناسه‌ی بازار هدف (ICP) — از config.MARKETS */
  market: string;
  /** شهر هدف (پیش‌فرض تهران) */
  city: string;
  /**
   * خدمت اصلی کمپین — یکی از ۷ خدمت مهدیار، یا `all`.
   *
   * ⚠️ این فیلد عمداً **بی‌اثر** است و هیچ ایجنتی نمی‌خواندش: `service-match`
   * همیشه آزادانه از هر ۷ خدمت انتخاب می‌کند، چون آزادی انتخاب همان چیزی است
   * که شخصی‌سازی را ممکن می‌کند. اینجا فقط به‌عنوان یادداشت کمپین می‌ماند.
   */
  primaryService: string;
  dailyDiscoveryLimit: number;
  dailyMessageLimit: number;
  status: CampaignStatus;
  createdAt: string;
};

/* ── لید ─────────────────────────────────────────────────── */

/** وضعیت لید — دقیقاً State Machine نقشه‌راه §10 */
export type LeadStatus =
  | "NEW"
  | "VALIDATING"
  | "INVALID"
  | "DUPLICATE"
  | "ANALYZING"
  /**
   * دروازه‌ی توان مالی نگه‌اش داشت — **هیچ توکنی خرج نشده**.
   * جدا از NURTURE است: NURTURE نتیجه‌ی یک تحلیل واقعی است، این یعنی هنوز
   * تحلیل نشده و سهمیه‌ی مدل صرف لیدهای بهتر شده. همیشه قابل تحلیل دستی است.
   */
  | "LOW_VALUE"
  | "SCORED"
  | "REJECTED"
  | "NURTURE"
  | "READY_FOR_MESSAGE"
  | "MESSAGE_DRAFTED"
  | "MESSAGE_REVIEW"
  | "APPROVED"
  | "SENT"
  | "REPLIED"
  | "HANDOVER_READY"
  | "HANDED_OVER";

/** راه‌های ارتباط مجازی استخراج‌شده از داده‌ی عمومی لید */
export type ContactChannels = {
  instagram?: string;
  whatsapp?: string;
  telegram?: string;
  email?: string;
  siteForm?: string;
  phone?: string;
};

/** کانالی که پیام از آن می‌رود — کلید ContactChannels */
export type ChannelKey = keyof ContactChannels;

export type Lead = {
  id: string;
  campaignId: string | null;
  businessName: string;
  industry: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  instagramHandle: string | null;
  contactChannels: ContactChannels;
  preferredChannel: ChannelKey | null;
  /** منبع کشف: google_places | manual | ... */
  source: string;
  sourceUrl: string | null;
  /** شناسه‌ی Google Places (برای حذف تکراری و Place Details) */
  placeId: string | null;
  rating: number | null;
  reviewsCount: number | null;
  status: LeadStatus;
  /** امتیاز نهایی (۰ تا ۱۰۰) پس از Scoring */
  score: number | null;
  confidence: number | null;
  /**
   * تخمین توان مالی (۰ تا ۱۰۰) از نشانه‌های عمومی — agents/affluence.ts.
   * فقط برای اولویت‌بندی صف کار؛ **هرگز وارد متن پیام نمی‌شود** چون درآمد
   * واقعی از داده‌ی عمومی قابل‌دانستن نیست.
   */
  affluenceScore: number | null;
  /** توضیح خوانای سیگنال‌هایی که به affluenceScore رسیدند */
  affluenceSignals: string[];
  /**
   * یافته‌ی **دستی** بررسی پیج اینستاگرام.
   * تحلیل خودکار پیج به IG_ACCESS_TOKEN نیاز دارد که هنوز ست نشده؛ تا آن
   * موقع این فیلد جای رسمی ثبت مشاهده‌ی انسانی است و مثل «مشاهده‌ی قطعی»
   * وارد پرامپت تحلیل و نویسنده می‌شود.
   */
  igNote: string | null;
  igNoteAt: string | null;
  /**
   * لید را انسان دستی به «فهرست منتخب» فرستاده.
   *
   * چرا جدا از status: انتخاب انسانی یک **بُعد مستقل** از وضعیت پردازش است.
   * یک لید می‌تواند هم‌زمان منتخب و در هر مرحله‌ای از خط تولید باشد. اگر آن را
   * وارد State Machine می‌کردیم، هر انتخاب یا لغو انتخاب مسیر پردازش را
   * به‌هم می‌ریخت.
   */
  shortlisted: boolean;
  shortlistedAt: string | null;
  doNotContact: boolean;
  /** کلید یکتاسازی برای حذف تکراری (place_id یا تلفن نرمال‌شده) */
  dedupKey: string;
  createdAt: string;
  updatedAt: string;
};

/* ── تحلیل لید (خروجی ایجنت Lead Analysis) ────────────────── */

export type LeadAnalysis = {
  id: string;
  leadId: string;
  businessSummary: string;
  targetCustomer: string;
  /** درد اصلی و مشخص همان کسب‌وکار — قلب شخصی‌سازی پیام */
  painPoint: string;
  needSignals: string[];
  evidence: string[];
  uncertainties: string[];
  brandTone: string;
  /** خدمت پیشنهادی — یکی از ۷ خدمت مهدیار */
  recommendedService: string;
  riskFlags: string[];
  confidence: number;
  agentVersion: string;
  createdAt: string;
};

/* ── نمونه‌کار (مخزن انتخاب برای اتچ) ─────────────────────── */

export type PortfolioItem = {
  id: string;
  title: string;
  industry: string;
  /** خدمت مرتبط — یکی از ۷ خدمت مهدیار */
  service: string;
  style: string;
  publicUrl: string;
  approved: boolean;
  shareAllowed: boolean;
  tags: string[];
  createdAt: string;
};

/* ── پیام ────────────────────────────────────────────────── */

export type MessageStatus = "draft" | "approved" | "rejected" | "sent";

export type Message = {
  id: string;
  leadId: string;
  /** کانال مجازی اولویت‌دار برای ارسال */
  targetChannel: ChannelKey | null;
  /** متن پیش‌نویس کانال مجازی */
  draftText: string;
  /** متن نهایی پس از ویرایش/تأیید انسانی */
  finalText: string | null;
  /** نسخه‌ی ایمیلی (اگر لید ایمیل داشته باشد) */
  emailSubject: string | null;
  emailText: string | null;
  status: MessageStatus;
  criticScore: number | null;
  /** درد هدف‌گرفته‌شده در پیام (برای شفافیت شخصی‌سازی) */
  painTargeted: string | null;
  /** نمونه‌کارهای پیشنهادی برای اتچ دستی کاربر */
  recommendedPortfolioIds: string[];
  approvedBy: string | null;
  /**
   * تاریخ تأیید و رد.
   *
   * تا قبل از فاز ۶ فقط `sentAt` وجود داشت و دو تصمیم دیگرِ انسان بی‌تاریخ
   * بودند — یعنی دفترچه‌ی تصمیم نمی‌توانست بگوید «کِی تأیید کردی».
   */
  approvedAt: string | null;
  rejectedAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

/* ── ثبت اجرای ایجنت/گام (برای نمایش زنده + هزینه) ─────────── */

export type AgentRunStatus = "running" | "done" | "error";

export type AgentRun = {
  id: string;
  leadId: string | null;
  /**
   * کمپین مربوطه — برای گروه‌بندی دفترچه‌ی تصمیم.
   * رکورد کشف `leadId: null` دارد (به یک لید خاص مربوط نیست)، پس بدون این
   * ستون هیچ راهی برای نسبت‌دادنش به کمپین نبود.
   */
  campaignId: string | null;
  agentName: string;
  status: AgentRunStatus;
  summary: string;
  output: unknown;
  tokenInput: number | null;
  tokenOutput: number | null;
  cost: number | null;
  durationMs: number | null;
  stopReason: string | null;
  errorCode: string | null;
  createdAt: string;
};

/* ── درس (حافظه‌ی خودبهبودی — حفظ‌شده از نسخه‌ی بلاگ) ──────── */

export type LessonSource = "critic" | "human";

export type Lesson = {
  id: string;
  /** درس برای کدام ایجنت است */
  agent: string;
  lesson: string;
  source: LessonSource;
  active: boolean;
  createdAt: string;
};

/* ── بازخورد انسانی روی لید/پیام ──────────────────────────── */

export type LeadFeedback = {
  id: string;
  leadId: string;
  messageId: string | null;
  rating: "up" | "down";
  comment: string;
  createdAt: string;
};

/* ── دفترچه‌ی تصمیم (audit_log) ────────────────────────────── */

/**
 * یک تصمیم ثبت‌شده — پایه‌ی صفحه‌ی CRM.
 *
 * جدول `audit_log` از فاز ۱ وجود داشت و تا فاز ۶ خالی ماند؛ ستون‌هایش دقیقاً
 * شکل یک دفترچه‌ی تصمیم است، پس به‌جای ساختن جدول تازه زنده شد.
 *
 * فقط از طریق `lib/audit.recordDecision()` نوشته می‌شود تا شکل رکوردها یکدست
 * بماند. تاریخچه‌ی **قبل از** فاز ۶ اینجا نیست و صفحه‌ی CRM آن را از
 * `agent_runs`/`campaigns`/`leads`/`messages` بازسازی می‌کند.
 */
export type AuditAction =
  | "campaign.created"
  | "discovery.run"
  | "lead.shortlisted"
  | "lead.unshortlisted"
  | "lead.replied"
  | "lead.converted"
  | "message.edited"
  | "message.approved"
  | "message.rejected"
  | "message.sent";

export type AuditEntry = {
  id: string;
  entityType: "campaign" | "lead" | "message";
  entityId: string | null;
  action: AuditAction;
  /** توضیح خوانا برای انسان — همان چیزی که در دفترچه نشان داده می‌شود */
  reason: string | null;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
};

/* ── گفت‌وگو / پیگیری لید ──────────────────────────────────── */

/** وضعیت گفت‌وگو با لید پس از ارسال پیام */
export type ConversationState = "no_reply" | "replied" | "meeting" | "closed";
export type ConversationSentiment = "positive" | "neutral" | "negative";

/**
 * ثبت پاسخ بیزینس و پیگیری — یک ردیف به‌ازای هر لید (upsert روی leadId).
 *
 * جدول `conversations` هم از فاز ۱ خالی مانده بود و ستون‌هایش دقیقاً همین
 * کار را می‌خواستند.
 *
 * جدا از `LeadFeedback` می‌ماند و با آن قاطی نمی‌شود: این «بیزینس چه گفت»
 * است، آن «کیفیت خودِ پیام ما چطور بود» (ورودی خام خودبهبودی).
 */
export type Conversation = {
  id: string;
  leadId: string;
  channel: ChannelKey | null;
  conversationState: ConversationState | null;
  summary: string | null;
  sentiment: ConversationSentiment | null;
  intent: string | null;
  nextAction: string | null;
  /** تاریخ پیگیری بعدی — برای بخش «پیگیری‌های سررسیدشده» */
  nextActionAt: string | null;
  handoverRequired: boolean;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** بازه‌ی تاریخ برای کوئری‌های صفحه‌ی CRM (ISO؛ هر دو اختیاری) */
export type DateRange = { from?: string; to?: string };

/* ── قرارداد لایه‌ی ذخیره‌سازی ─────────────────────────────── */

export interface LeadStore {
  // کمپین‌ها
  createCampaign(c: Campaign): Promise<void>;
  updateCampaign(id: string, patch: Partial<Campaign>): Promise<void>;
  getCampaign(id: string): Promise<Campaign | null>;
  listCampaigns(): Promise<Campaign[]>;

  // لیدها
  createLead(lead: Lead): Promise<void>;
  updateLead(id: string, patch: Partial<Lead>): Promise<void>;
  getLead(id: string): Promise<Lead | null>;
  findLeadByDedupKey(dedupKey: string): Promise<Lead | null>;
  listLeads(opts?: {
    campaignId?: string;
    status?: LeadStatus;
    limit?: number;
    /** بازه بر اساس created_at — برای صفحه‌ی CRM */
    from?: string;
    to?: string;
  }): Promise<Lead[]>;

  // تحلیل لید
  upsertAnalysis(analysis: LeadAnalysis): Promise<void>;
  getAnalysis(leadId: string): Promise<LeadAnalysis | null>;

  // نمونه‌کارها
  listPortfolio(opts?: { service?: string; approvedOnly?: boolean }): Promise<PortfolioItem[]>;
  getPortfolioItem(id: string): Promise<PortfolioItem | null>;
  createPortfolioItem(item: PortfolioItem): Promise<void>;

  // پیام‌ها
  createMessage(msg: Message): Promise<void>;
  updateMessage(id: string, patch: Partial<Message>): Promise<void>;
  getMessage(id: string): Promise<Message | null>;
  listMessages(opts?: {
    leadId?: string;
    status?: MessageStatus;
    from?: string;
    to?: string;
  }): Promise<Message[]>;

  // ثبت اجرای ایجنت
  addAgentRun(run: AgentRun): Promise<void>;
  listAgentRuns(leadId?: string, limit?: number): Promise<AgentRun[]>;
  /**
   * اجراهای یک بازه‌ی زمانی — مستقل از لید.
   *
   * جدا از `listAgentRuns` است چون آن امضای لیدمحور در چند جای ارکستریتور
   * استفاده می‌شود و عوض‌کردنش بی‌دلیل پرریسک بود.
   */
  listAgentRunsBetween(opts: DateRange & { campaignId?: string; limit?: number }): Promise<AgentRun[]>;

  // درس‌ها (خودبهبودی)
  addLesson(lesson: Lesson): Promise<void>;
  listLessons(opts?: { agent?: string; activeOnly?: boolean }): Promise<Lesson[]>;
  deactivateLesson(id: string): Promise<void>;

  // بازخورد انسانی
  addFeedback(fb: LeadFeedback): Promise<void>;
  listFeedback(leadId?: string): Promise<LeadFeedback[]>;

  // دفترچه‌ی تصمیم (فقط از lib/audit.recordDecision نوشته می‌شود)
  addAudit(entry: AuditEntry): Promise<void>;
  listAudit(opts: DateRange & { entityType?: AuditEntry["entityType"]; limit?: number }): Promise<AuditEntry[]>;

  // گفت‌وگو/پیگیری لید — یک ردیف به‌ازای هر لید
  upsertConversation(c: Conversation): Promise<void>;
  getConversation(leadId: string): Promise<Conversation | null>;
  listConversations(opts?: DateRange & { leadId?: string; limit?: number }): Promise<Conversation[]>;
}
