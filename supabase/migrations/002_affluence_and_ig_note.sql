-- مهاجرت فاز ۵ — ستون‌های جدید جدول leads
--
-- چرا فایل جدا: schema.sql از `create table if not exists` استفاده می‌کند، پس
-- روی دیتابیسی که جدول leads را از قبل دارد هیچ ستونی اضافه نمی‌کند. این فایل
-- را یک‌بار در Supabase SQL Editor اجرا کنید.
--
-- همه‌ی دستورها idempotent هستند؛ اجرای دوباره خطا نمی‌دهد.

-- تخمین توان مالی از نشانه‌های عمومی (src/lib/agents/affluence.ts).
-- فقط برای اولویت‌بندی صف کار استفاده می‌شود و هرگز وارد متن پیام نمی‌شود،
-- چون درآمد واقعی از داده‌ی عمومی قابل‌دانستن نیست.
alter table leads add column if not exists affluence_score   int;
alter table leads add column if not exists affluence_signals jsonb not null default '[]';

-- یافته‌ی دستی بررسی پیج اینستاگرام.
-- تحلیل خودکار پیج به IG_ACCESS_TOKEN + IG_BUSINESS_ID نیاز دارد که هنوز روی
-- Vercel ست نشده‌اند؛ تا آن موقع این فیلد جای رسمی ثبت مشاهده‌ی انسانی است.
alter table leads add column if not exists ig_note    text;
alter table leads add column if not exists ig_note_at timestamptz;

-- مرتب‌سازی صف کار بر اساس توان مالی (نزولی) در داشبورد
create index if not exists leads_affluence_idx on leads (affluence_score desc nulls last);
