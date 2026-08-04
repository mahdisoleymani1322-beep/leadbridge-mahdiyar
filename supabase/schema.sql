-- ───────────────────────────────────────────────
-- LeadBridge AI — مهدیار هوش‌افزا | اسکیمای CRM (نقشه‌راه §9)
-- این فایل را در SQL Editor داشبورد Supabase اجرا کنید.
-- ───────────────────────────────────────────────

-- کمپین‌ها: هر کمپین = یک بازار هدف + شهر + خدمت اصلی + سقف‌های روزانه
create table if not exists campaigns (
  id                    uuid primary key,
  name                  text not null,
  market                text not null,
  city                  text not null default 'تهران',
  primary_service       text not null,
  daily_discovery_limit int  not null default 20,
  daily_message_limit   int  not null default 5,
  status                text not null default 'active' check (status in ('active','paused')),
  -- مکان‌نمای پیشرفت کشف (مهاجرت ۷) — بدون آن هر «کشف لید» دقیقاً همان ۲۰
  -- کسب‌وکار قبلی را برمی‌گرداند. شکل داده: DiscoveryCursor در store/types.ts.
  -- دلیل کامل در supabase/migrations/007_discovery_cursor.sql.
  discovery_cursor      jsonb,
  created_at            timestamptz not null default now()
);

-- لیدها: State Machine در ستون status (نقشه‌راه §10)
create table if not exists leads (
  id                uuid primary key,
  campaign_id       uuid references campaigns(id) on delete set null,
  business_name     text not null,
  industry          text,
  city              text,
  address           text,
  phone             text,
  website           text,
  instagram_handle  text,
  contact_channels  jsonb not null default '{}',
  preferred_channel text,
  source            text not null default 'google_places',
  source_url        text,
  place_id          text,
  rating            real,
  reviews_count     int,
  status            text not null default 'NEW' check (status in (
                      'NEW','VALIDATING','INVALID','DUPLICATE','ANALYZING','LOW_VALUE','SCORED',
                      'REJECTED','NURTURE','READY_FOR_MESSAGE','MESSAGE_DRAFTED',
                      'MESSAGE_REVIEW','APPROVED','SENT','REPLIED','HANDOVER_READY','HANDED_OVER')),
  score             int,
  confidence        real,
  -- تخمین توان مالی از نشانه‌های عمومی (agents/affluence.ts) — فقط برای
  -- اولویت‌بندی صف کار؛ هرگز وارد متن پیام نمی‌شود.
  affluence_score   int,
  affluence_signals jsonb not null default '[]',
  -- یافته‌ی دستی بررسی پیج اینستاگرام (تا وقتی IG_ACCESS_TOKEN ست نشده)
  ig_note           text,
  ig_note_at        timestamptz,
  -- انتخاب دستی انسان برای «فهرست منتخب» — بُعدی مستقل از status
  shortlisted       boolean not null default false,
  shortlisted_at    timestamptz,
  do_not_contact    boolean not null default false,
  -- کلید یکتاسازی برای حذف تکراری قطعی (place_id یا تلفن نرمال‌شده)
  dedup_key         text not null unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- تحلیل لید (خروجی ایجنت Lead Analysis) — یک رکورد به‌ازای هر لید
create table if not exists lead_analysis (
  id                  uuid primary key,
  lead_id             uuid not null unique references leads(id) on delete cascade,
  business_summary    text not null default '',
  target_customer     text not null default '',
  pain_point          text not null default '',
  need_signals        jsonb not null default '[]',
  evidence            jsonb not null default '[]',
  uncertainties       jsonb not null default '[]',
  brand_tone          text not null default '',
  recommended_service text not null default '',
  risk_flags          jsonb not null default '[]',
  confidence          real not null default 0,
  agent_version       text not null default 'v1',
  created_at          timestamptz not null default now()
);

-- مخزن نمونه‌کارها (منبع انتخاب برای اتچ)
create table if not exists portfolio_items (
  id            uuid primary key,
  title         text not null,
  industry      text not null default '',
  service       text not null default '',
  style         text not null default '',
  public_url    text not null default '',
  approved      boolean not null default true,
  share_allowed boolean not null default true,
  tags          jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

-- پیام‌ها (پیش‌نویس → تأیید انسانی → ارسال)
create table if not exists messages (
  id                        uuid primary key,
  lead_id                   uuid not null references leads(id) on delete cascade,
  target_channel            text,
  draft_text                text not null default '',
  final_text                text,
  email_subject             text,
  email_text                text,
  status                    text not null default 'draft' check (status in ('draft','approved','rejected','sent')),
  critic_score              int,
  pain_targeted             text,
  recommended_portfolio_ids jsonb not null default '[]',
  approved_by               text,
  sent_at                   timestamptz,
  created_at                timestamptz not null default now()
);

-- ثبت اجرای هر گام ایجنت/سرویس (نمایش زنده + کنترل هزینه)
create table if not exists agent_runs (
  id           uuid primary key,
  lead_id      uuid references leads(id) on delete cascade,
  agent_name   text not null,
  status       text not null default 'running' check (status in ('running','done','error')),
  summary      text not null default '',
  output       jsonb,
  token_input  int,
  token_output int,
  cost         real,
  duration_ms  int,
  stop_reason  text,
  error_code   text,
  created_at   timestamptz not null default now()
);

-- درس‌ها = حافظه‌ی بلندمدت خودبهبودی
create table if not exists lessons (
  id          uuid primary key,
  agent       text not null,
  lesson      text not null,
  source      text not null check (source in ('critic','human')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- بازخورد انسانی روی لید/پیام (ورودی خام خودبهبودی)
create table if not exists lead_feedback (
  id          uuid primary key,
  lead_id     uuid not null references leads(id) on delete cascade,
  message_id  uuid references messages(id) on delete set null,
  rating      text not null check (rating in ('up','down')),
  comment     text not null default '',
  created_at  timestamptz not null default now()
);

-- گفت‌وگوها و Audit Log — برای فازهای بعد (Handover/Dispatch)؛ اکنون خالی می‌مانند
create table if not exists conversations (
  id                 uuid primary key,
  lead_id            uuid not null references leads(id) on delete cascade,
  channel            text,
  conversation_state text,
  summary            text,
  sentiment          text,
  intent             text,
  next_action        text,
  handover_required  boolean not null default false,
  last_message_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  reason      text,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);

-- ── حذف نرم (مهاجرت ۶) ──
--
-- ردیف حذف‌شده پاک نمی‌شود، فقط deleted_at می‌گیرد. دلیل کاملش در
-- supabase/migrations/006_soft_delete.sql است؛ خلاصه‌اش: leads.dedup_key یکتاست
-- و پاک‌کردن واقعیِ ردیف، کلید را آزاد می‌کند و کشف بعدی همان لید را دوباره
-- می‌آورد. deleted_batch دسته‌ی یک حذف آبشاری را برای بازگردانی نگه می‌دارد.
do $$
declare
  t text;
begin
  foreach t in array array['campaigns','leads','messages','conversations','lessons','agent_runs','audit_log']
  loop
    execute format('alter table %I add column if not exists deleted_at timestamptz', t);
    execute format('alter table %I add column if not exists deleted_batch uuid', t);
  end loop;
end $$;

-- ── ایندکس‌ها ──
create index if not exists idx_leads_status      on leads(status);
create index if not exists idx_leads_campaign    on leads(campaign_id);
create index if not exists idx_messages_lead     on messages(lead_id);
create index if not exists idx_messages_status   on messages(status);
create index if not exists idx_agent_runs_lead   on agent_runs(lead_id);
create index if not exists idx_lessons_agent     on lessons(agent) where active;

-- ── seed نمونه‌کارهای مهدیار ──
insert into portfolio_items (id, title, industry, service, style, public_url, approved, share_allowed, tags)
values
  (gen_random_uuid(), 'تشک مانی — سایت جدید، سئو و محتوای AI', 'مبلمان و تشک', 'seo-growth', 'فروشگاهی / سئو محلی', 'https://manymattress.com', true, true, '["سئو","تولید محتوا","طراحی سایت","افزایش بازدید"]'),
  (gen_random_uuid(), 'طلای ماهان — سایت ویترین و جستجوی محلی', 'طلا و جواهر', 'web', 'ویترین برند / لوکس', 'https://mahangold.org', true, true, '["طراحی سایت","سئو محلی","برندینگ"]'),
  (gen_random_uuid(), 'راجین کابل — سایت شرکتی B2B و محتوای صنعتی', 'صنعت کابل و برق', 'web', 'شرکتی B2B / صنعتی', 'https://rajincable.ir', true, true, '["سایت B2B","کاتالوگ دیجیتال","سئو صنعتی","محتوای تخصصی"]')
on conflict do nothing;
