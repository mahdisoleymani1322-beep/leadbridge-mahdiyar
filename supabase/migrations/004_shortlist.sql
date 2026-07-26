-- مهاجرت: فهرست منتخب — انتخاب دستی انسان
--
-- چرا ستون جدا و نه یک وضعیت در status: انتخاب انسانی یک **بُعد مستقل** از
-- وضعیت پردازش است. یک لید می‌تواند هم‌زمان منتخب باشد و در هر مرحله‌ای از خط
-- تولید (تحلیل‌نشده، امتیازگرفته، پیام‌دار). اگر آن را وارد State Machine
-- می‌کردیم، هر انتخاب یا لغو انتخاب مسیر پردازش لید را به‌هم می‌ریخت.
--
-- یک‌بار در Supabase SQL Editor اجرا کنید. اجرای دوباره خطا نمی‌دهد.

alter table leads add column if not exists shortlisted    boolean not null default false;
alter table leads add column if not exists shortlisted_at timestamptz;

-- فهرست منتخب همیشه با همین دو شرط خوانده می‌شود
create index if not exists leads_shortlist_idx on leads (shortlisted, affluence_score desc nulls last);
