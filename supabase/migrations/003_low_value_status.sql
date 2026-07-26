-- مهاجرت: وضعیت جدید LOW_VALUE برای دروازه‌ی توان مالی
--
-- چرا لازم است: دروازه‌ی توان مالی لیدهای ضعیف را **پیش از خرج توکن** کنار
-- می‌گذارد. این وضعیت عمداً از NURTURE جدا است: NURTURE نتیجه‌ی یک تحلیل واقعی
-- است (امتیاز ۵۰ تا ۶۹)، ولی LOW_VALUE یعنی هنوز تحلیل نشده و سهمیه‌ی مدل صرف
-- لیدهای بهتر شده. قاطی‌کردن این دو باعث می‌شد داشبورد درباره‌ی «چه چیزی تحلیل
-- شده» دروغ بگوید.
--
-- یک‌بار در Supabase SQL Editor اجرا کنید. اجرای دوباره خطا نمی‌دهد.

alter table leads drop constraint if exists leads_status_check;

alter table leads add constraint leads_status_check check (status in (
  'NEW','VALIDATING','INVALID','DUPLICATE','ANALYZING','LOW_VALUE','SCORED',
  'REJECTED','NURTURE','READY_FOR_MESSAGE','MESSAGE_DRAFTED',
  'MESSAGE_REVIEW','APPROVED','SENT','REPLIED','HANDOVER_READY','HANDED_OVER'
));
