-- ───────────────────────────────────────────────
-- مهاجرت ۶ — حذف نرم + سطل زباله (فاز ۷)
-- در SQL Editor داشبورد Supabase اجرا کنید. idempotent است.
-- ───────────────────────────────────────────────
--
-- چرا حذف نرم و نه `delete from`:
--
-- ستون leads.dedup_key روی `not null unique` است و discovery.ts پیش از درج هر
-- لید، findLeadByDedupKey می‌زند. اگر ردیف واقعاً پاک شود، کلید آزاد می‌شود و
-- **کشف بعدی همان کسب‌وکار را دوباره می‌آورد**. یعنی مالک ۲۰ لید آشغال را پاک
-- می‌کند، «کشف لید» می‌زند، و همه برمی‌گردند.
--
-- با علامت‌گذاری deleted_at، ردیف سر جایش می‌ماند، کلید یکتا اشغال می‌ماند، و
-- findLeadByDedupKey همان لید حذف‌شده را برمی‌گرداند → discovery آن را «تکراری»
-- می‌شمارد و رد می‌کند. بدون یک خط کد اضافه.
--
-- ⚠️ به همین دلیل، سطل زباله عمداً «خالی‌کردن دائمی» ندارد. پاک‌کردن واقعیِ
-- ردیف دقیقاً همان باگ را برمی‌گرداند.

-- ── ۱) دو ستونِ حذف روی هفت جدول ──
--
-- deleted_batch چرا لازم است: حذف یک کمپین ده‌ها ردیف را در شش جدول علامت
-- می‌زند. بازگردانی باید دقیقاً همان دسته را برگرداند، نه هر چیزی که «حدوداً
-- همان موقع» حذف شده. تکیه بر برابری deleted_at شکننده است چون now() سطربه‌سطر
-- فرق می‌کند؛ یک uuid که یک‌بار در JS ساخته و به همه‌ی آپدیت‌ها داده می‌شود،
-- قطعی است.
--
-- agent_runs و audit_log هم ستون می‌گیرند تا همراه دسته بروند و همراه دسته
-- برگردند. اگر واقعاً پاک می‌شدند، بازگردانیِ کمپین یک کمپین بی‌تاریخچه
-- تحویل می‌داد.
--
-- lead_analysis عمداً ستون نمی‌گیرد: فقط با getAnalysis(leadId) از پنل جزئیات
-- همان لید خوانده می‌شود، و وقتی لید پنهان است دسترسی‌ای به آن نیست.
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

-- ── ۲) ایندکس‌ها ──
--
-- ایندکس‌های جزئی برای فهرست‌های «زنده» (که ۹۹٪ کوئری‌ها همین‌اند)، و ایندکس
-- deleted_batch برای بازگردانی یک دسته.
--
-- صادقانه: در حجم فعلی داده (چند صد ردیف) هیچ‌کدام اثر سنجش‌پذیری ندارند.
-- برای بعد گذاشته شده‌اند.
create index if not exists idx_leads_live    on leads(created_at desc)    where deleted_at is null;
create index if not exists idx_messages_live on messages(created_at desc) where deleted_at is null;

create index if not exists idx_campaigns_batch     on campaigns(deleted_batch)     where deleted_batch is not null;
create index if not exists idx_leads_batch         on leads(deleted_batch)         where deleted_batch is not null;
create index if not exists idx_messages_batch      on messages(deleted_batch)      where deleted_batch is not null;
create index if not exists idx_conversations_batch on conversations(deleted_batch) where deleted_batch is not null;
create index if not exists idx_lessons_batch       on lessons(deleted_batch)       where deleted_batch is not null;
create index if not exists idx_agent_runs_batch    on agent_runs(deleted_batch)    where deleted_batch is not null;
create index if not exists idx_audit_batch         on audit_log(deleted_batch)     where deleted_batch is not null;
