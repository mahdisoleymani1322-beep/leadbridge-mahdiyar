# سند مادر اجرایی سیستم چندایجنتی جذب مشتری و تحویل لید

**نام پروژه:** LeadBridge AI  
**نسخه:** 1.0  
**وضعیت:** آماده شروع توسعه پایلوت  
**هدف نهایی:** پیدا کردن کسب‌وکار مناسب، تحلیل نیاز، ارسال پیام شخصی‌سازی‌شده همراه نمونه‌کار مرتبط و تحویل مخاطب علاقه‌مند به مالک کسب‌وکار برای ادامه گفت‌وگوی انسانی.

---

# 1. خلاصه مدیریتی

این پروژه یک ربات ارسال پیام انبوه نیست. محصول نهایی یک سیستم فروش هوشمند، کنترل‌شده و قابل ارزیابی است که از Workflowهای قطعی، Agentهای تخصصی، یک Orchestrator، لایه ارزیابی، کنترل بودجه و تأیید انسانی تشکیل می‌شود.

سیستم باید کسب‌وکارهای مناسب را پیدا کند، اطلاعات عمومی آن‌ها را اعتبارسنجی کند، نیازهای محتمل را با شواهد واقعی تشخیص دهد، بهترین خدمت و نمونه‌کار را انتخاب کند، یک پیام کوتاه و طبیعی بنویسد، پیام را از نظر کیفیت و ریسک بررسی کند و فقط پس از عبور از معیارهای پذیرش وارد صف ارسال کند.

پس از دریافت پاسخ، سیستم باید پاسخ را دسته‌بندی کند و گفت‌وگو را فقط تا نقطه‌ای ادامه دهد که مخاطب آمادگی ارتباط مستقیم با مالک کسب‌وکار را نشان دهد. در این نقطه، سیستم متوقف می‌شود و لید را به انسان تحویل می‌دهد.

سیستم حق ندارد قیمت بدهد، تخفیف پیشنهاد کند، قرارداد ببندد، تعهد ایجاد کند، نتیجه تضمین کند، اطلاعات بسازد یا از طرف مالک کسب‌وکار مذاکره نهایی انجام دهد.

> هر کاری که با قانون ثابت و Workflow قابل انجام است، نباید به Agent سپرده شود. Agent فقط زمانی استفاده می‌شود که کار به تحلیل، انتخاب، مقایسه یا قضاوت نیاز دارد.

---

# 2. مسئله کسب‌وکار

## 2.1 خدمات قابل عرضه

- تولید محتوای حرفه‌ای با هوش مصنوعی
- تولید تصویر و ویدیو با هوش مصنوعی
- طراحی و پیاده‌سازی CRM
- ساخت اتوماسیون‌های هوشمند
- طراحی سایت و لندینگ‌پیج با کمک هوش مصنوعی
- یکپارچه‌سازی ابزارها و فرآیندها
- بهبود جذب، پاسخ‌گویی و پیگیری مشتری

## 2.2 مشکل اصلی

مشکل اصلی نبود مهارت نیست؛ نبود یک کانال منظم، قابل‌اندازه‌گیری و تکرارپذیر برای جذب مشتری جدید است.

وضعیت فعلی:

- بیشتر مشتریان از ارتباطات قدیمی آمده‌اند.
- کانال پایداری برای جذب مشتری جدید وجود ندارد.
- معرفی خدمات پراکنده و کلی است.
- فرآیند استانداردی برای پیدا کردن لید، امتیازدهی، پیام‌دهی، پیگیری و تحویل وجود ندارد.
- نتایج در یک CRM واحد ثبت نمی‌شوند.
- یادگیری از پیام‌های موفق و ناموفق سیستماتیک نیست.

## 2.3 فرصت

این سیستم ابتدا برای جذب مشتری شخصی ساخته می‌شود و بعد می‌تواند به محصول یا خدمت قابل ارائه به کسب‌وکارهای دیگر تبدیل شود.

---

# 3. هدف، خروجی و مرز مسئولیت

## 3.1 هدف اصلی

تولید «لید آماده گفت‌وگوی انسانی».

لید آماده گفت‌وگو یعنی:

- کسب‌وکار واقعی و معتبر است.
- نیاز قابل مشاهده‌ای به یکی از خدمات وجود دارد.
- پیام را دریافت کرده است.
- علاقه یا کنجکاوی واقعی نشان داده است.
- درخواست اطلاعات بیشتر، تماس، جلسه یا ارتباط مستقیم داده است.
- آماده ادامه ارتباط با مالک کسب‌وکار است.

## 3.2 خروجی تحویل لید

برای هر لید تحویلی این موارد ثبت شود:

- نام کسب‌وکار و مخاطب
- اطلاعات تماس و منبع لید
- خلاصه کسب‌وکار
- نیاز تشخیص‌داده‌شده و شواهد
- خدمت پیشنهادی
- نمونه‌کار ارسال‌شده
- تاریخچه پیام‌ها
- خلاصه پاسخ مخاطب
- دلیل آماده بودن برای تحویل
- پیشنهاد اقدام بعدی
- سطح اطمینان

## 3.3 کارهای ممنوع

- اعلام قیمت یا تخفیف
- مذاکره نهایی یا قرارداد
- تضمین نتیجه
- ادعای ساختگی
- ارسال انبوه و کورکورانه
- دور زدن محدودیت پلتفرم‌ها
- جمع‌آوری داده غیرعمومی
- ادامه پیام پس از درخواست توقف
- استفاده از نمونه‌کار بدون مجوز
- تغییر مستقیم Prompt در Production
- مصرف نامحدود Token یا API
- پنهان کردن شکست یا کمبود داده

---

# 4. معیارهای موفقیت

## 4.1 KPIهای کسب‌وکار

- تعداد لید معتبر
- نرخ قبولی لید
- نرخ تأیید پیام توسط انسان
- نرخ تحویل پیام
- نرخ پاسخ
- نرخ پاسخ مثبت
- نرخ تبدیل پاسخ مثبت به تماس یا جلسه
- تعداد لید تحویلی
- نرخ تبدیل لید تحویلی به مشتری
- هزینه هر لید تحویلی
- زمان متوسط کشف تا تحویل
- نرخ Opt-out، Block یا شکایت
- میانگین هزینه AI برای هر لید

## 4.2 KPIهای فنی

- نرخ موفقیت Workflow و Agent
- میانگین Tool Call و Token
- نرخ Timeout و Loop
- نرخ خروجی ردشده توسط Evaluator
- نرخ Rollback Prompt
- درصد Runهای دارای Log کامل
- درصد تحلیل‌های دارای Evidence

## 4.3 هدف پایلوت

- روزانه 10 تا 20 لید خام
- روزانه حداکثر 5 پیام تأییدشده
- حداقل 80٪ صحت اطلاعات
- حداقل 90٪ پیام بدون ادعای ساختگی
- حداقل 70٪ تأیید انسانی پیام
- نرخ پاسخ هدف اولیه 10 تا 20٪
- نرخ گفت‌وگوی واقعی 3 تا 8٪
- شکایت و Opt-out نزدیک به صفر

اعداد پس از دو تا چهار هفته با داده واقعی اصلاح شوند.

---

# 5. بازارهای هدف

## 5.1 کلینیک‌های زیبایی و دندان‌پزشکی

دلایل انتخاب:

- نیاز دائمی به تصویر و ویدیو
- اهمیت کیفیت بصری
- فعالیت بالا در Instagram
- امکان تشخیص سریع ضعف محتوا
- نیاز به رزرو، CRM و پیگیری
- امکان ارسال نمونه‌کار ملموس

خدمات مناسب:

- Reels و ویدیوی کوتاه AI
- محتوای تصویری
- تقویم محتوایی
- لندینگ‌پیج
- اتوماسیون رزرو و پاسخ‌گویی
- CRM مراجعان

## 5.2 کارخانه‌ها و شرکت‌های تولیدی

دلایل انتخاب:

- ارزش قرارداد بالاتر
- نیاز به CRM و اتوماسیون
- ضعف رایج در معرفی دیجیتال
- نیاز به ویدیو، کاتالوگ و سایت
- امکان بهبود فروش B2B

## 5.3 کسب‌وکارهای خدماتی با قراردادهای ارزشمند

نمونه‌ها:

- شرکت‌های ساختمانی و معماری
- مشاوران املاک
- مراکز آموزشی
- شرکت‌های مهاجرتی
- شرکت‌های B2B
- مراکز تخصصی سلامت

## 5.4 تصمیم اجرایی

پایلوت فقط روی یک بازار اجرا شود.

**پیشنهاد:** کلینیک‌های زیبایی و دندان‌پزشکی. ورود به بازار دوم فقط پس از حداقل 30 گفت‌وگوی واقعی و 5 لید تحویلی بررسی شود.

---

# 6. اصل انتخاب Agent یا Workflow

## Workflow مناسب است اگر

- قانون ثابت وجود دارد.
- نتیجه قابل محاسبه است.
- عملیات تکراری و ساختاریافته است.
- تصمیم‌گیری معنایی لازم نیست.

نمونه: ثبت رکورد، حذف Duplicate، زمان‌بندی، کنترل سقف روزانه، تغییر Status، محاسبه هزینه و ارسال هشدار.

## Agent مناسب است اگر

- تحلیل معنایی لازم است.
- مقایسه یا انتخاب وجود دارد.
- داده ناقص یا مبهم است.
- شخصی‌سازی یا قضاوت کیفی لازم است.

نمونه: تحلیل صفحه، تشخیص نیاز، انتخاب خدمت، انتخاب نمونه‌کار، نوشتن پیام، تحلیل پاسخ و ارزیابی کیفیت.

## دروازه ساخت Agent

پیش از ساخت هر Agent پاسخ این سؤال‌ها ثبت شود:

1. آیا Rule کافی است؟
2. آیا Workflow کافی است؟
3. آیا یک LLM Call ساده کافی است؟
4. آیا Agent واقعاً لازم است؟
5. آیا کار باید بین چند Agent تقسیم شود؟
6. آیا خروجی قابل ارزیابی است؟
7. آیا شکست قابل جبران است؟
8. آیا هزینه قابل کنترل است؟

---

# 7. اصول معماری

## 7.1 جبران‌پذیری

- پیش‌نویس پیام قبل از ارسال ذخیره شود.
- ارسال در پایلوت تأیید انسانی داشته باشد.
- تغییر Prompt ابتدا در Sandbox انجام شود.
- هر نسخه Prompt قابل Rollback باشد.
- حذف داده نرم باشد.
- هر تصمیم مهم در Audit Log ثبت شود.

## 7.2 توقف به‌موقع

Agent نباید دنبال خروجی بی‌نقص باشد. با رسیدن به Evidence کافی و معیار پذیرش باید متوقف شود.

Statusهای مجاز:

- `SUCCESS`
- `PARTIAL_SUCCESS`
- `INSUFFICIENT_DATA`
- `BLOCKED`
- `BUDGET_EXCEEDED`
- `HUMAN_REVIEW_REQUIRED`
- `OUT_OF_SCOPE`
- `FAILED`

## 7.3 صداقت و Evidence

- اطلاعات ساخته نشود.
- Fact، Assumption و Uncertainty جدا ثبت شوند.
- هر ادعای تحلیلی به شواهد متصل شود.
- اگر داده کافی نیست، Agent صادقانه متوقف شود.

## 7.4 عدم وابستگی به مدل

Model Provider پشت یک Interface قرار گیرد تا تغییر مدل معماری را نشکند.

---

# 8. معماری کلان سیستم

## لایه 1: منابع داده

Google Maps، Instagram، وب‌سایت رسمی، دایرکتوری عمومی، اطلاعات تماس عمومی، مخزن نمونه‌کار و CRM.

## لایه 2: Workflow Engine

پیشنهاد: n8n برای Trigger، Queue، State، Retry، اتصال سرویس‌ها و ثبت Log.

## لایه 3: Data Layer

پیشنهاد: Supabase/PostgreSQL برای Leads، Messages، Conversations، Agent Runs، Prompt Versions، Evaluations، Costs و Audit Logs.

## لایه 4: Agent Layer

Agentهای تخصصی برای تحلیل و تصمیم‌گیری.

## لایه 5: Orchestration

ایجنت مادر مسیر هر Lead را مدیریت می‌کند.

## لایه 6: Governance

Budget Controller، Policy Guard، Human Approval، Versioning و Rollback.

## لایه 7: Evaluation and Learning

Evaluator، Prompt Optimizer، Experiment Manager و Lesson Store.

## لایه 8: Dashboard

وضعیت لید، پیام، پاسخ، هزینه، کیفیت، خطا و سلامت Agentها.

---

# 9. مدل داده CRM

## Leads

```sql
id, business_name, industry, city, address, phone, website,
instagram_handle, source, source_url, contact_name, contact_role,
status, score, confidence, do_not_contact, created_at, updated_at
```

## Lead_Analysis

```sql
id, lead_id, business_summary, brand_tone, need_signals, evidence,
best_service, risk_flags, confidence, agent_version, prompt_version, created_at
```

## Portfolio_Items

```sql
id, title, industry, service, style, language, format, public_url,
approved, share_allowed, confidentiality_level, tags, created_at
```

## Messages

```sql
id, lead_id, message_type, channel, draft_text, final_text, status,
approved_by, sent_at, delivery_status, reply_received,
agent_version, prompt_version, cost, created_at
```

## Conversations

```sql
id, lead_id, channel, conversation_state, last_message_at, summary,
sentiment, intent, next_action, handover_required, created_at, updated_at
```

## Evaluations

```sql
id, entity_type, entity_id, evaluator_version, score,
criteria_scores, violations, recommendations, pass, created_at
```

## Prompt_Versions

```sql
id, agent_name, version, system_prompt, status, parent_version,
change_reason, experiment_id, approved_at, created_at
```

## Agent_Runs

```sql
id, agent_name, lead_id, input_hash, status, tool_calls,
token_input, token_output, cost, duration_ms, stop_reason, error_code, created_at
```

## Audit_Log و Lessons

همه تغییرات مهم، دلیل تغییر، نسخه قبل و بعد، Evidence و Lesson ثبت شوند.

---

# 10. State Machine لید

```text
NEW → VALIDATING → INVALID | DUPLICATE | ANALYZING
ANALYZING → SCORED
SCORED → REJECTED | NURTURE | READY_FOR_MESSAGE
READY_FOR_MESSAGE → MESSAGE_DRAFTED → MESSAGE_REVIEW
MESSAGE_REVIEW → APPROVED | MESSAGE_DRAFTED | REJECTED
APPROVED → QUEUED → SENT → DELIVERED | ERROR
DELIVERED → REPLIED | FOLLOW_UP
REPLIED → INTERESTED | NOT_INTERESTED | FOLLOW_UP | HANDOVER_READY
HANDOVER_READY → HANDED_OVER
```

هیچ Agentی نباید خارج از Transitionهای مجاز Status را تغییر دهد.

---

# 11. جریان اجرایی انتها به انتها

## مرحله 0: تعریف کمپین

- بازار، شهر و خدمت اصلی را مشخص کن.
- سقف روزانه را تعیین کن.
- نمونه‌کارهای مجاز را ثبت کن.
- قواعد پیام و Follow-up را قفل کن.

```yaml
campaign_id: CLINIC-TEH-001
market: beauty_clinic
city: Tehran
daily_discovery_limit: 20
daily_message_limit: 5
primary_service: ai_video
human_approval: true
follow_up_limit: 1
```

## مرحله 1: جمع‌آوری لید

- فقط از منابع و روش‌های مجاز استفاده کن.
- برای هر Lead منبع و تاریخ ثبت کن.
- حداقل نام و یک راه تماس عمومی لازم است.

## مرحله 2: اعتبارسنجی

Duplicate، واقعی بودن کسب‌وکار، تطابق بازار، فعال بودن، Do Not Contact و سابقه تماس بررسی شود.

## مرحله 3: تحلیل

خلاصه کسب‌وکار، Need Signal، Evidence، Tone، Best Service، Risk و Confidence تولید شود.

## مرحله 4: امتیازدهی

| معیار | وزن |
|---|---:|
| تطابق بازار | 20 |
| نیاز قابل مشاهده | 20 |
| اعتبار اطلاعات | 15 |
| فعالیت آنلاین | 10 |
| تناسب نمونه‌کار | 15 |
| دسترسی به تصمیم‌گیرنده | 10 |
| ریسک پایین | 10 |

حداقل امتیاز پیشنهادی: 70.

## مرحله 5: انتخاب خدمت

برای پیام اول فقط یک خدمت انتخاب شود.

## مرحله 6: انتخاب نمونه‌کار

حداکثر دو نمونه؛ ترجیحاً یک نمونه مرتبط و مجاز.

## مرحله 7: تولید پیام

پیام کوتاه، طبیعی، مبتنی بر Evidence، بدون قیمت و دارای CTA برای شروع گفت‌وگو باشد.

## مرحله 8: نقد پیام

Message Critic صحت، شخصی‌سازی، لحن، فشار، CTA، قیمت و ادعاها را بررسی کند.

## مرحله 9: تأیید انسانی

در پایلوت تمام پیام‌ها و Follow-upها قبل از ارسال تأیید شوند.

## مرحله 10: ارسال کنترل‌شده

سقف روزانه، فاصله مناسب، Opt-out، ساعات مجاز و Log رعایت شود.

## مرحله 11: تحلیل پاسخ

پاسخ به Intentهای تعریف‌شده دسته‌بندی شود.

## مرحله 12: Follow-up

در فاز اول حداکثر یک Follow-up کوتاه.

## مرحله 13: تحویل لید

با درخواست تماس، قیمت، جلسه یا گفت‌وگوی تخصصی، سیستم متوقف و Lead به انسان تحویل شود.

## مرحله 14 تا 17: ارزیابی و یادگیری

Run ارزیابی شود، Lesson استخراج شود، Prompt Variant در Sandbox تست شود و فقط در صورت بهبود Promotion انجام شود.


---

# 12. فهرست اجزای هوشمند

1. Orchestrator Agent
2. Market Strategy Agent
3. Lead Research Agent
4. Lead Validation Agent
5. Lead Analysis Agent
6. Lead Scoring Service
7. Service Matching Agent
8. Portfolio Selection Agent
9. Message Generation Agent
10. Message Critic Agent
11. Policy and Safety Guard
12. Dispatch Workflow
13. Response Classification Agent
14. Follow-up Decision Agent
15. Handover Agent
16. Objection Analysis Agent
17. Evaluator Agent
18. Prompt Optimizer Agent
19. Experiment Manager
20. Budget Controller
21. System Health Agent
22. Knowledge Curator Agent

بخش‌های ثابت و محاسباتی باید Service یا Workflow باشند، حتی اگر نام آن‌ها در معماری کنار Agentها قرار گرفته است.

---

# 13. استاندارد تعریف هر Agent

برای هر Agent این موارد اجباری است:

1. نام و نسخه
2. نقش
3. نوع: Mother یا Sub-Agent
4. جایگاه در فرآیند
5. Parent و مقصد Handoff
6. هدف قابل اندازه‌گیری
7. Non-Goals
8. ورودی و Schema
9. خروجی و Schema
10. ابزارهای مجاز
11. قواعد استفاده از ابزار
12. بودجه Tool Call
13. بودجه Token
14. سقف Iteration
15. شرط توقف
16. شرایط Human Approval
17. معیار موفقیت و شکست
18. Guardrail
19. Failure Behavior
20. گزارش اجباری
21. Test Cases
22. Prompt Version

---

# 14. Orchestrator Agent

## نقش

ایجنت مادر و مدیر اجرای فرآیند.

## هدف

هدایت هر Lead در مسیر مجاز، انتخاب Agent بعدی، کنترل Budget، جلوگیری از Loop، مدیریت خطا و Handoff.

## ورودی

- Campaign Config
- Lead State
- Agent Registry
- Budget
- Policy
- Previous Runs

## خروجی

```json
{
  "next_step": "",
  "assigned_agent": "",
  "reason": "",
  "budget_remaining": 0,
  "human_approval_required": false,
  "stop": false
}
```

## ابزارهای مجاز

- خواندن State
- فراخوانی Agent مجاز
- ثبت Run و Error
- تغییر Status در Transition مجاز
- درخواست Human Approval

## محدودیت‌ها

- تولید یا ارسال مستقیم پیام ممنوع است.
- تغییر Prompt Production ممنوع است.
- عبور از Budget ممنوع است.
- حداکثر 10 گام برای هر Lead در یک Run.
- تکرار یک Agent با ورودی یکسان ممنوع است.

## شرط توقف

پایان مرحله، نیاز به انسان، نبود داده، خطا، اتمام Budget، تکمیل Handover یا غیرمجاز بودن Lead.

## KPI

نرخ تکمیل، نرخ Loop، هزینه هر Lead، Escalation صحیح و درصد Transition معتبر.

---

# 15. Market Strategy Agent

## هدف

انتخاب بازار، ICP، فرضیه درد و خدمت اصلی بر اساس داده‌های واقعی.

## Non-Goals

ارسال پیام، تعیین قیمت یا انتخاب Lead تکی.

## ورودی

نتایج کمپین، نمونه‌کارها، ظرفیت اجرا، خدمات و محدودیت جغرافیایی.

## خروجی

- بازار پیشنهادی
- ICP
- فرضیه نیاز
- خدمت اصلی
- معیار ورود و حذف
- ریسک‌ها
- Confidence

## بودجه

حداکثر 3 Tool Call، دو Iteration و اجرای هفتگی یا ماهانه.

## Human Approval

هر تغییر بازار، ICP یا خدمت اصلی نیازمند تأیید انسان است.

---

# 16. Lead Research Agent و Workflow جمع‌آوری

## تصمیم معماری

جمع‌آوری داده تا حد امکان Workflow است. Agent فقط برای گسترش Query، تشخیص حوزه و تکمیل محدود داده استفاده می‌شود.

## هدف

تولید فهرست اولیه کسب‌وکارهای مطابق ICP.

## خروجی

- Lead Candidate
- Source
- Source URL
- Evidence
- Missing Fields

## Guardrail

- فقط داده عمومی
- عدم دور زدن محدودیت پلتفرم
- عدم جمع‌آوری داده شخصی غیرضروری
- عدم ثبت رکورد بدون Source
- احترام به شرایط استفاده هر منبع

## Budget

در پایلوت حداکثر 20 Lead در روز، دو Query Expansion و یک تلاش تکمیلی برای هر رکورد.

---

# 17. Lead Validation Agent

## هدف

تأیید اعتبار، تازگی و تناسب Lead.

## بررسی‌ها

- Duplicate
- وجود واقعی کسب‌وکار
- Market Fit
- اطلاعات تماس عمومی
- حضور فعال
- Do Not Contact
- سابقه Outreach

## خروجی

```json
{
  "valid": true,
  "reasons": [],
  "missing_fields": [],
  "risk_flags": [],
  "confidence": 0.0
}
```

## شرط توقف

رسیدن به Evidence کافی یا دو تلاش ناموفق.

## KPI

Precision اعتبارسنجی، نرخ Duplicate و False Positive.

---

# 18. Lead Analysis Agent

## نقش

تحلیل کسب‌وکار از چند زاویه و استخراج نیاز قابل استناد.

## سؤال‌های اجباری

- این کسب‌وکار چه می‌فروشد؟
- مشتری هدف آن کیست؟
- کیفیت حضور دیجیتال چگونه است؟
- چه مشکل قابل مشاهده‌ای وجود دارد؟
- کدام خدمت با این مشکل مرتبط است؟
- Evidence چیست؟
- چه چیزی نامطمئن است؟
- چه ادعایی نباید مطرح شود؟
- لحن مناسب چیست؟
- آیا تماس ارزش دارد؟

## خروجی

```json
{
  "business_summary": "",
  "target_customer": "",
  "need_signals": [],
  "evidence": [],
  "uncertainties": [],
  "brand_tone": "",
  "recommended_service": "",
  "risk_flags": [],
  "confidence": 0.0
}
```

## ابزارهای مجاز

اطلاعات عمومی وب‌سایت، Instagram، Google Maps و Knowledge Base.

## بودجه

حداکثر 4 Tool Call، دو Iteration و یک تلاش تکمیلی.

## شرط توقف

حداقل دو Evidence و Confidence حداقل 0.65؛ در غیر این صورت `INSUFFICIENT_DATA`.

---

# 19. Lead Scoring Service

## تصمیم معماری

محاسبه Score یک Workflow قطعی است. Agent فقط برای موارد مرزی استفاده شود.

## خروجی

```json
{
  "score": 0,
  "criteria": {},
  "decision": "PASS|NURTURE|REJECT",
  "reason": ""
}
```

Agent اجازه تغییر Weight و Threshold را ندارد. تغییر آن‌ها تأیید انسانی می‌خواهد.

---

# 20. Service Matching Agent

## هدف

انتخاب فقط یک خدمت برای پیام اول.

## قواعد

- انتخاب بر اساس Evidence
- یک خدمت، نه فهرست خدمات
- عدم Cross-sell در پیام اول
- عدم قیمت
- Reject در صورت نبود تناسب واقعی

## خروجی

Service، Reason، Evidence، Confidence و Alternative Service.

---

# 21. Portfolio Selection Agent

## هدف

انتخاب مرتبط‌ترین نمونه‌کار مجاز.

## ترتیب اولویت

1. صنعت یکسان
2. مسئله یکسان
3. سبک مشابه
4. کانال مشابه
5. زبان مشابه

## قواعد

- حداکثر دو نمونه، ترجیحاً یک نمونه
- فقط `approved=true`
- فقط `share_allowed=true`
- عدم افشای اطلاعات محرمانه
- عدم ادعای نتیجه بدون سند

## خروجی

```json
{
  "selected_items": [],
  "reason": "",
  "missing_portfolio_gap": false
}
```

---

# 22. Message Generation Agent

## نقش

نوشتن پیام کوتاه، طبیعی و شخصی‌سازی‌شده.

## هدف

ایجاد علاقه و شروع گفت‌وگو؛ سپس هدایت مخاطب به ارتباط مستقیم با مالک کسب‌وکار.

## Non-Goals

فروش کامل، قیمت، تخفیف، قرارداد، تعهد، فشار یا وعده نتیجه.

## ورودی

Lead Summary، Evidence، Service، Portfolio، Tone، Channel و Policy.

## خروجی

```json
{
  "message": "",
  "personalization_used": [],
  "claims": [],
  "cta": "",
  "confidence": 0.0
}
```

## قواعد

- پیام اول حداکثر 80 تا 120 کلمه
- یک مشاهده واقعی
- یک خدمت
- یک CTA
- یک نمونه‌کار اصلی
- بدون عبارت تبلیغاتی کلی
- بدون تظاهر به آشنایی قبلی
- بدون ساخت نام مخاطب
- بدون قیمت

## بودجه

حداکثر دو Draft و یک Revision. پس از عبور از معیارها متوقف شود.

---

# 23. Message Critic Agent

## نقش

ارزیابی مستقل پیام پیش از ارسال.

## معیارها

| معیار | امتیاز |
|---|---:|
| صحت و Evidence | 20 |
| شخصی‌سازی | 15 |
| وضوح | 15 |
| طبیعی بودن | 10 |
| تناسب خدمت | 10 |
| CTA | 10 |
| رعایت محدودیت‌ها | 20 |

حداقل قبولی: 85 از 100.

## چرخه اصلاح

- Score بین 75 و 84: یک Revision
- کمتر از 75: Reject
- حداکثر دو دور
- دو دور ناموفق: Human Review

## خروجی

```json
{
  "score": 0,
  "pass": false,
  "violations": [],
  "revision_instructions": [],
  "human_review": false
}
```

---

# 24. Policy and Safety Guard

## هدف

کنترل حریم خصوصی، Opt-out، ادعا، نمونه‌کار، قیمت، قرارداد و ریسک پلتفرم.

## خروجی

`PASS`، `BLOCK` یا `HUMAN_REVIEW`.

## اصل

Policy Guard حق کاهش محدودیت‌ها را ندارد. فقط انسان می‌تواند Policy را با ثبت دلیل تغییر دهد.

---

# 25. Dispatch Workflow

ارسال پیام Agent نیست و باید با Workflow کنترل شود.

## مسئولیت‌ها

- تأیید انسانی
- سقف روزانه
- فاصله ارسال
- ساعات مجاز
- Idempotency
- Delivery Log
- Opt-out Check
- Error Handling

## محدودیت پایلوت

حداکثر پنج پیام در روز و توقف خودکار در صورت افزایش خطا یا شکایت.

---

# 26. Response Classification Agent

## Intentها

- `INTERESTED`
- `REQUEST_CALL`
- `REQUEST_PORTFOLIO`
- `REQUEST_PRICE`
- `ASK_QUESTION`
- `NOT_NOW`
- `NOT_INTERESTED`
- `DO_NOT_CONTACT`
- `WRONG_PERSON`
- `AUTOMATED_REPLY`
- `UNCLEAR`

## قواعد

- درخواست قیمت: قیمت نده؛ Handover کن.
- درخواست تماس: Handover.
- Do Not Contact: توقف فوری.
- پاسخ مبهم یا حساس: Human Review.
- سؤال تخصصی یا قراردادی: Handover.

---

# 27. Follow-up Decision Agent

## هدف

تصمیم درباره یک Follow-up کوتاه و کم‌فشار.

## شروط

- پیام تحویل شده باشد.
- پاسخی نیامده باشد.
- فاصله لازم گذشته باشد.
- Opt-out وجود نداشته باشد.
- سقف Follow-up پر نشده باشد.

در پایلوت حداکثر یک Follow-up مجاز است و آن نیز تأیید انسانی می‌خواهد.

---

# 28. Handover Agent

## Trigger

درخواست تماس، جلسه، قیمت، جزئیات تخصصی یا نشان دادن علاقه روشن.

## خروجی

```json
{
  "lead_id": "",
  "contact": {},
  "conversation_summary": "",
  "interest_signal": "",
  "recommended_next_action": "",
  "questions_to_answer": [],
  "risk_flags": [],
  "urgency": "LOW|MEDIUM|HIGH"
}
```

پس از Handover، Agent بدون دستور انسان حق ادامه گفت‌وگو ندارد.

---

# 29. Objection Analysis Agent

این Agent به مخاطب پاسخ نمی‌دهد. پاسخ‌های منفی را دسته‌بندی و علت ریشه‌ای را استخراج می‌کند.

دسته‌ها:

- بودجه
- زمان
- عدم نیاز
- بی‌اعتمادی
- نمونه‌کار نامرتبط
- پیام نامناسب
- شخص اشتباه
- کانال اشتباه
- زمان‌بندی اشتباه
- پیشنهاد مبهم

خروجی شامل Category، Root Cause، Evidence، Lesson و Experiment پیشنهادی است.

---

# 30. Evaluator Agent

## نقش

منتقد مستقل کل سیستم و خروجی Agentها.

## زمان اجرا

- پس از Leadهای مهم
- روزانه روی Sample
- پس از هر چرخه کمپین
- هفتگی برای گزارش کامل

## موارد ارزیابی

کیفیت Lead، صحت تحلیل، تناسب خدمت و نمونه‌کار، کیفیت پیام، نتیجه ارسال، پاسخ، هزینه، Loop، Policy و Handover.

## خروجی

```json
{
  "overall_score": 0,
  "agent_scores": {},
  "violations": [],
  "lessons": [],
  "prompt_change_candidates": [],
  "workflow_change_candidates": [],
  "rollback_recommended": false
}
```

## استقلال

Evaluator نباید همان Prompt و Context محدود Agent تولیدکننده را داشته باشد.

## بودجه

حداکثر 5 Tool Call و یک Re-evaluation. برای کنترل هزینه، ارزیابی کامل روی Sample و Runهای مهم اجرا شود.

---

# 31. Prompt Optimizer Agent

## هدف

بهبود Promptها بر اساس Lessonهای دارای Evidence.

## فرآیند

1. Lessonها را جمع‌آوری کند.
2. Evidence را بررسی کند.
3. Root Cause را تعیین کند.
4. فقط اگر مشکل Prompt بود، تغییر پیشنهاد دهد.
5. نسخه جدید و Changelog بسازد.
6. Test Case تولید کند.
7. نسخه را در Sandbox اجرا کند.
8. با نسخه پایدار مقایسه کند.
9. در صورت بهبود، درخواست Promotion بدهد.

## محدودیت‌ها

- تغییر مستقیم Production ممنوع
- حذف Guardrail ممنوع
- افزایش Budget بدون Approval ممنوع
- تغییر هدف Agent ممنوع
- تغییر Schema بدون Migration ممنوع

## قانون Promotion

- کیفیت حداقل 5٪ بهتر شود.
- نرخ خطا و Policy Violation افزایش نیابد.
- هزینه بیش از 10٪ افزایش نیابد، مگر با Approval.
- حداقل 20 Test Case اجرا شده باشد.
- Rollback آماده باشد.

---

# 32. Budget Controller

بخش اصلی این نقش Rule Engine است. Agent فقط مصرف غیرعادی را تحلیل می‌کند.

## وظایف

- کنترل Tool Call، Token، هزینه روزانه و هزینه کمپین
- توقف Run پرهزینه
- ثبت Budget Breach
- هشدار به انسان

## بودجه اولیه پیشنهادی

| Agent | Tool Call | Iteration | Token تقریبی |
|---|---:|---:|---:|
| Lead Analysis | 4 | 2 | 3000 |
| Service Match | 1 | 1 | 1000 |
| Portfolio Select | 2 | 1 | 1200 |
| Message Generation | 2 | 2 | 1500 |
| Message Critic | 1 | 2 | 1500 |
| Response Classification | 1 | 1 | 800 |
| Evaluator | 5 | 1 | 4000 |

## توقف اجباری

اتمام Budget، دو خطای متوالی، نتیجه تکراری Tool، دو Iteration بدون پیشرفت، Timeout یا رسیدن به Evidence کافی.

---

# 33. System Health Agent

## سیگنال‌های سلامت

- افزایش هزینه یا خطا
- افت نرخ پاسخ
- افزایش Reject یا Loop
- افزایش Opt-out
- خرابی Integration
- افت کیفیت پیام
- Queue Backlog

## اقدامات مجاز

هشدار، کاهش Limit، Pause کمپین، درخواست Human Review و پیشنهاد Rollback.

توقف اضطراری مجاز است؛ شروع دوباره به تأیید انسان نیاز دارد.

---

# 34. Knowledge Curator Agent

## هدف

مدیریت دانش معتبر و جلوگیری از Memory Pollution.

## منابع

Lessons، الگوهای پیام تأییدشده، Insight بازار، اعتراضات، Portfolio Metadata، Decision Log و Policy.

## قواعد

- هر Knowledge Item باید Source و Confidence داشته باشد.
- Lesson بدون Evidence وارد حافظه بلندمدت نشود.
- موارد قدیمی Archive شوند.
- Duplicateها ادغام شوند.
- داده بازارهای مختلف بدون برچسب با هم مخلوط نشوند.

---

# 35. Experiment Manager

## هدف

اجرای A/B Test کنترل‌شده.

## متغیرهای قابل آزمایش

Hook، CTA، طول پیام، نمونه‌کار، Tone، ساعت ارسال و Segment.

## اصل

در هر آزمایش فقط یک متغیر اصلی تغییر کند.

## خروجی

Hypothesis، Control، Variant، Sample Size، Metric، Result و Decision.

