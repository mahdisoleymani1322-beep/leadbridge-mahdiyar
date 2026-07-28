import "server-only";
import { randomUUID } from "crypto";
import { getStore } from "@/lib/store";
import { CRITIC_RUBRIC, CRITIC_THRESHOLDS } from "@/lib/config";
import type { Lesson } from "@/lib/store/types";
import type { MessageCriticOutput } from "./types";

/**
 * نوشتن «درس» در حافظه‌ی بلندمدت — **سرویس قطعی، صفر توکن LLM**.
 *
 * تا پیش از این، `addLesson` در قرارداد store وجود داشت ولی **هیچ کدی صدایش
 * نمی‌زد**؛ یعنی حلقه‌ی خودبهبودی نیمه‌کاره بود: `lessonsBlockFor` درس‌ها را
 * می‌خواند و به پرامپت تزریق می‌کرد، ولی هیچ‌وقت درسی نوشته نمی‌شد.
 *
 * چرا سرویس و نه ایجنت: منتقد از قبل `rubric` و `violations` را تولید کرده و
 * Policy Guard هم نقض‌های قطعی را داده. فراخوانی دوباره‌ی مدل برای «استخراج
 * درس» یعنی خرج سهمیه برای چیزی که همین حالا در دست داریم — خلاف اصل
 * «سرویس قطعی هرجا ممکن» نقشه‌راه.
 *
 * چرا از `revisionInstructions` درس ساخته نمی‌شود: آن‌ها عمداً **مختص همان
 * لید**اند («جمله‌ی دوم را با اشاره به فلان محصول عوض کن»). درسی که به پرامپت
 * همه‌ی لیدهای بعدی تزریق شود باید عام باشد، وگرنه نویسنده را گمراه می‌کند.
 * پس درس از **معیارِ ضعیف** ساخته می‌شود، نه از متن اصلاح.
 */

/**
 * درسِ عام متناظر با هر معیار روبریک که مکرراً پایین می‌آید.
 * متن‌ها عمداً دستورالعملی و کوتاه‌اند چون مستقیم داخل system prompt می‌روند.
 */
const LESSON_BY_CRITERION: Record<keyof MessageCriticOutput["rubric"], string> = {
  accuracy:
    "هر جمله‌ای که به‌عنوان واقعیت می‌نویسی باید در شواهد داده‌شده قابل‌ردیابی باشد. اگر چیزی در شواهد نیست، یا ننویسش یا با زبان محتاطانه بگو.",
  personalization:
    "جمله‌ی اول باید یک جزئیات مشخص و واقعی از همین کسب‌وکار داشته باشد، نه تعریف کلی. «صفحه‌تون رو دیدم» بدون گفتن چه چیزی دیده‌ای، شخصی‌سازی نیست.",
  clarity:
    "جمله‌ها را کوتاه‌تر کن و هر جمله یک ایده بگوید. اگر خواننده باید جمله را دوباره بخواند، بلند است.",
  naturalness:
    "از عبارت‌های قالبی و ساختار سه‌تایی پرهیز کن. طول جمله‌ها را عوض کن و یک مفهوم را هر بار با مترادف تازه نگو.",
  serviceFit:
    "خدمت‌های معرفی‌شده باید یک نتیجه‌ی مشترک بدهند و به درد همین کسب‌وکار وصل باشند. فهرست‌کردن توانایی‌ها نمره را پایین می‌آورد.",
  cta:
    "پایان پیام باید دعوت نرم و بدون فشار باشد. «همین امروز تماس بگیرید» یا هر عبارت فوریت‌ساز ممنوع است.",
  constraints:
    "قیمت، تخفیف، قرارداد، تضمین نتیجه و ادعای بدون سند ممنوع‌اند. پیشنهاد را هرگز به‌شکل مشکل قطعیِ کسب‌وکار بیان نکن.",
};

/** نسبت نمره به وزن که زیر آن، معیار «ضعیف» حساب می‌شود */
const WEAK_RATIO = 0.6;

/**
 * درس را ثبت می‌کند مگر اینکه متن یکسانی از قبل فعال باشد.
 *
 * چرا dedup لازم است: بدون آن، هر اجرای ضعیف یک ردیف تکراری می‌سازد و بعد از
 * چند روز `lessonsBlockFor` پنج نسخه از یک جمله را به پرامپت تزریق می‌کند —
 * هم توکن هدر می‌رود هم مدل گیج می‌شود.
 */
async function addLessonOnce(agent: string, text: string, source: Lesson["source"]): Promise<boolean> {
  const store = getStore();
  const existing = await store.listLessons({ agent, activeOnly: true });
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  if (existing.some((l) => norm(l.lesson) === norm(text))) return false;

  await store.addLesson({
    id: randomUUID(),
    agent,
    lesson: text.trim(),
    source,
    active: true,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    deletedBatch: null,
  });
  return true;
}

/**
 * از نتیجه‌ی نقد، درس می‌سازد.
 *
 * فقط وقتی کار می‌کند که نمره زیر آستانه‌ی قبولی باشد: پیامی که قبول شده چیزی
 * برای یادگرفتن ندارد و ثبت درس از آن، پرامپت را با نکات بی‌مورد شلوغ می‌کند.
 *
 * @returns متن درس‌هایی که واقعاً تازه بودند و ثبت شدند
 */
export async function recordLessonsFromCritic(critic: MessageCriticOutput): Promise<string[]> {
  if (critic.score >= CRITIC_THRESHOLDS.pass) return [];

  const added: string[] = [];
  for (const [key, weight] of Object.entries(CRITIC_RUBRIC) as [
    keyof MessageCriticOutput["rubric"],
    number,
  ][]) {
    const got = critic.rubric[key];
    if (typeof got !== "number") continue;
    if (got / weight >= WEAK_RATIO) continue;

    const text = LESSON_BY_CRITERION[key];
    if (text && (await addLessonOnce("message-writer", text, "critic"))) added.push(text);
  }
  return added;
}

/**
 * بازخورد انسانی را به درس تبدیل می‌کند.
 *
 * متن انسان عیناً ثبت می‌شود و بازنویسی نمی‌شود: وقتی مالک می‌نویسد «این پیام
 * زیادی رسمی بود»، همان جمله دقیق‌ترین شکل درس است. خلاصه‌کردنش با مدل هم
 * سهمیه می‌خورد هم منظور را تغییر می‌دهد.
 */
export async function recordLessonFromHuman(agent: string, comment: string): Promise<boolean> {
  const text = comment.trim();
  // خیلی کوتاه («بد بود») دستورالعمل قابل‌اجرا نیست و فقط پرامپت را شلوغ می‌کند
  if (text.length < 15) return false;
  return addLessonOnce(agent, text, "human");
}
