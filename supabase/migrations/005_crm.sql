-- ───────────────────────────────────────────────
-- مهاجرت ۵ — پایه‌ی صفحه‌ی CRM (دفترچه‌ی تصمیم، تاریخچه، آمار تبدیل)
-- در SQL Editor داشبورد Supabase اجرا کنید. idempotent است.
-- ───────────────────────────────────────────────

-- ── ۱) تاریخِ تصمیم‌های انسانی ──
--
-- بزرگ‌ترین شکاف دفترچه‌ی تصمیم: تا امروز فقط «ارسال شد» تاریخ داشت (sent_at).
-- تأیید و رد — یعنی دو تا از سه تصمیم اصلی انسان — هیچ ردِ زمانی نداشتند؛
-- approved_by ثبت می‌شد ولی approved_at اصلاً وجود نداشت.
alter table messages add column if not exists approved_at timestamptz;
alter table messages add column if not exists rejected_at timestamptz;

-- ── ۲) اتصال اجرای ایجنت به کمپین ──
--
-- رکورد کشف با lead_id = null ثبت می‌شود (چون به یک لید خاص مربوط نیست)، پس
-- شناسه‌ی کمپین فقط داخل output (jsonb) بود و گروه‌بندی لاگ بر اساس کمپین
-- ناممکن می‌شد. ستون صریح این را حل می‌کند.
alter table agent_runs
  add column if not exists campaign_id uuid references campaigns(id) on delete set null;

-- ── ۳) ایندکس‌های بازه‌ی تاریخ ──
--
-- صفحه‌ی CRM همه‌چیز را با بازه‌ی «از/تا» می‌خواند. تا امروز هیچ ایندکسی روی
-- created_at هیچ جدولی نبود.
create index if not exists idx_agent_runs_created  on agent_runs(created_at desc);
create index if not exists idx_agent_runs_campaign on agent_runs(campaign_id);
create index if not exists idx_leads_created       on leads(created_at desc);
create index if not exists idx_leads_shortlisted   on leads(shortlisted_at desc) where shortlisted;
create index if not exists idx_messages_created    on messages(created_at desc);
create index if not exists idx_campaigns_created   on campaigns(created_at desc);

-- ── ۴) دفترچه‌ی تصمیم و گفت‌وگوها ──
--
-- هر دو جدول در فاز ۱ ساخته شدند و تا امروز یک ردیف هم ندارند. ستون‌هایشان
-- دقیقاً همان چیزی است که این فاز لازم دارد، پس ساخته نمی‌شوند — فقط ایندکس
-- می‌گیرند و conversations یک قید یکتایی می‌گیرد تا هر لید یک ردیف داشته باشد
-- (upsert روی lead_id).
create index if not exists idx_audit_created on audit_log(created_at desc);
create index if not exists idx_audit_entity  on audit_log(entity_type, entity_id);

create unique index if not exists idx_conversations_lead on conversations(lead_id);
create index if not exists idx_conversations_updated on conversations(updated_at desc);

-- ── ۵) دامنه‌ی مقادیر گفت‌وگو ──
--
-- ستون‌ها از فاز ۱ بدون check ساخته شده بودند. چون از حالا واقعاً پر می‌شوند،
-- دامنه‌شان قفل می‌شود تا با تایپ‌های TypeScript یکی بماند (همان قاعده‌ای که
-- برای leads.status رعایت شده).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_state_check') then
    alter table conversations add constraint conversations_state_check
      check (conversation_state is null or conversation_state in ('no_reply','replied','meeting','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_sentiment_check') then
    alter table conversations add constraint conversations_sentiment_check
      check (sentiment is null or sentiment in ('positive','neutral','negative'));
  end if;
end $$;

-- تاریخ پیگیری بعدی — برای بخش «پیگیری‌های سررسیدشده»ی صفحه‌ی CRM
alter table conversations add column if not exists next_action_at timestamptz;
create index if not exists idx_conversations_next_action on conversations(next_action_at)
  where next_action_at is not null;
