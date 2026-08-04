import "server-only";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { AI_LIMITS } from "@/lib/config";

/**
 * هسته‌ی AI — همان الگوی فاز ۲: همه‌ی مدل‌ها از طریق OpenRouter.
 *
 * دو کمکی اصلی این فایل، سنگ‌بنای همه‌ی ایجنت‌ها هستند:
 * - runAgentText: خروجی متنی آزاد (برای نویسنده)
 * - runAgentJSON: خروجی ساخت‌یافته + اعتبارسنجی Zod + یک بار تلاش مجدد
 *
 * نکته‌ی آموزشی: به‌جای اتکا به JSON mode مدل‌ها (که بین مدل‌های مختلف
 * OpenRouter ناسازگار است)، خودمان JSON را از پاسخ استخراج و با Zod
 * اعتبارسنجی می‌کنیم و اگر خراب بود، خطا را به مدل برمی‌گردانیم تا اصلاح کند.
 * این الگوی «validate + retry» در هر سیستم ایجنتی واقعی لازم است.
 */

export function getOpenRouter() {
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    headers: {
      "HTTP-Referer": "https://mahdiyar.ai",
      // فقط ASCII: هدرهای HTTP کاراکتر غیر-Latin1 (مثل — یا فارسی) را نمی‌پذیرند
      "X-Title": "LeadBridge AI - Mahdiyar",
    },
    // محدودکردن reasoning به سطح پایین (همان درسِ فاز ۲):
    // برخی مدل‌ها استدلال اجباری دارند و ممکن است کل بودجه‌ی توکن را صرف آن کنند.
    fetch: (async (url: string, options: RequestInit | undefined) => {
      if (options?.body && typeof options.body === "string") {
        try {
          const body = JSON.parse(options.body);
          body.reasoning = { effort: "low" };
          options = { ...options, body: JSON.stringify(body) };
        } catch {
          /* اگر بدنه JSON نبود، دست‌نخورده بماند */
        }
      }
      return fetch(url, options);
    }) as typeof fetch,
  });
}

export function isConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * مدل پیش‌فرض همه‌ی ایجنت‌ها — رایگان‌محور (تصمیم مالک: فعلاً همه رایگان).
 * با تنظیم PIPELINE_MODEL می‌توان به مدل پولی سوییچ کرد، بدون تغییر کد.
 */
/**
 * مدل پیش‌فرض: gpt-oss-20b رایگان — با تست واقعی روی لیدهای فارسی انتخاب شد
 * (فارسی روان، JSON پایدار). مدل‌های دیگر یا JSON نمی‌دادند یا فارسی را با
 * کلمات انگلیسی/چینی قاطی می‌کردند.
 */
export function defaultModel(): string {
  return process.env.PIPELINE_MODEL || "openai/gpt-oss-20b:free";
}

export function writerModel(): string {
  return process.env.WRITER_MODEL || defaultModel();
}

/**
 * زنجیره‌ی مدل‌های جایگزین برای rate-limit (429) یا خطای موقت.
 * مدل‌های رایگان OpenRouter سقف ~۲۰ req/min و ۲۰۰ req/day دارند؛ اگر یکی
 * پر شد، بعدی امتحان می‌شود تا اجرا نشکند.
 */
export function modelFallbacks(): string[] {
  const fromEnv = process.env.MODEL_FALLBACKS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (fromEnv?.length) return fromEnv;
  // فهرست از مدل‌های رایگانِ واقعاً موجود روی OpenRouter (تأییدشده با API).
  // اگر یکی حذف/پر شد، بعدی امتحان می‌شود.
  // ترتیب بر اساس تست واقعی: اول آن‌هایی که JSON فارسی سالم دادند.
  return [
    "openai/gpt-oss-20b:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  ];
}

/** آیا این خطا با مدل دیگر قابل جبران است؟ (rate-limit / در دسترس نبودن) */
function isRetriableModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|quota|503|502|overloaded|unavailable|timeout/i.test(msg);
}

/**
 * بودجه‌ی درخواستِ یک فراخوان **منطقی** ایجنت.
 *
 * چرا لازم شد: تا امروز دو لایه‌ی تلاش مجدد وجود داشت که **در هم ضرب
 * می‌شدند** و هیچ‌کدام از دیگری خبر نداشت — زنجیره‌ی ۳ مدل در `runAgentText`
 * ضربدر حلقه‌ی ۲ تلاشی JSON در `runAgentJSON` = تا **۶ درخواست upstream برای
 * یک فراخوان منطقی**. روی لیدی که یک دور بازنویسی بخورد (۹ فراخوان ایجنت)،
 * سقف نظری ۵۴ درخواست می‌شد؛ یعنی **یک لید می‌توانست کل سهمیه‌ی روز را
 * بسوزاند**. این تنها جای سیستم بود که هیچ سقفی نداشت، در حالی که همه‌جای
 * دیگر با گاردهای سفت بسته شده بود.
 *
 * بودجه یک‌بار در بالاترین سطح ساخته و بین لایه‌ها به اشتراک گذاشته می‌شود،
 * پس سقف روی **کل** فراخوان اعمال می‌شود نه روی هر لایه جدا.
 */
export type CallBudget = {
  /** چند درخواست upstream تا الان مصرف شده */
  used: number;
  /** سقف کل */
  max: number;
  /**
   * آخرین مدلی که واقعاً جواب داد.
   *
   * تلاش دوم JSON از همین‌جا شروع می‌کند، نه از اول زنجیره. قبلاً `runAgentJSON`
   * برای هر تلاش `runAgentText` تازه صدا می‌زد و زنجیره از مدل اول شروع می‌شد —
   * یعنی مدلی که همین چند ثانیه پیش ۴۲۹ داده بود دوباره امتحان می‌شد.
   */
  lastGoodModel: string | null;
};

export function newCallBudget(max = AI_LIMITS.maxUpstreamRequestsPerCall): CallBudget {
  return { used: 0, max, lastGoodModel: null };
}

export type AgentCallOptions = {
  /** نام ایجنت — فقط برای پیام‌های خطای خواناتر */
  agent: string;
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * بودجه‌ی مشترک. اگر داده نشود، یک بودجه‌ی تازه ساخته می‌شود — یعنی فراخوان
   * تک‌مرحله‌ای هم سقف دارد.
   */
  budget?: CallBudget;
};

/**
 * اجرای یک ایجنت با خروجی متنی آزاد.
 *
 * زنجیره‌ی مدل‌ها فقط تا جایی جلو می‌رود که بودجه اجازه دهد. خطای
 * غیرقابل‌جبران (مثل کلید نامعتبر) بلافاصله پرتاب می‌شود و بودجه را هدر نمی‌دهد.
 */
export async function runAgentText(opts: AgentCallOptions): Promise<string> {
  const openrouter = getOpenRouter();
  const primary = opts.model ?? defaultModel();
  const budget = opts.budget ?? newCallBudget();

  /*
    ترتیب زنجیره: اگر تلاش قبلی روی مدلی موفق بوده، از همان شروع کن.
    بازگشت به ابتدای زنجیره یعنی دوباره کوبیدن به مدلی که تازه رد کرده است.
  */
  const base = [primary, ...modelFallbacks().filter((m) => m !== primary)];
  const chain =
    budget.lastGoodModel && base.includes(budget.lastGoodModel)
      ? [budget.lastGoodModel, ...base.filter((m) => m !== budget.lastGoodModel)]
      : base;

  let lastError: unknown = null;
  for (const model of chain) {
    if (budget.used >= budget.max) {
      lastError = new Error(
        `سقف ${budget.max} درخواست برای این فراخوان پر شد؛ برای صرفه‌جویی سهمیه متوقف شد.`
      );
      break;
    }
    budget.used++;
    try {
      const result = await generateText({
        model: openrouter(model),
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxOutputTokens ?? AI_LIMITS.defaultMaxOutputTokens,
      });
      if (result.text.trim()) {
        budget.lastGoodModel = model;
        return result.text;
      }
      // پاسخ خالی: مدل بعدی می‌ارزد، ولی مثل هر درخواست دیگری از بودجه کم شد
      lastError = new Error("پاسخ خالی بود");
    } catch (err) {
      lastError = err;
      // خطای غیرقابل‌جبران (مثل کلید نامعتبر) → همان‌جا متوقف شو
      if (!isRetriableModelError(err)) break;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`ایجنت «${opts.agent}» خروجی نداد: ${msg}`);
}

/** استخراج اولین شیء JSON از متن (مدل‌ها گاهی دور آن توضیح یا ``` می‌گذارند) */
function extractJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("هیچ شیء JSON در پاسخ پیدا نشد.");
  }
  return cleaned.slice(start, end + 1);
}

export type AgentJSONOptions<T> = AgentCallOptions & {
  /**
   * اسکیمای Zod برای اعتبارسنجی خروجی.
   *
   * ورودی عمداً `unknown` است (نه `T`): با `.default()` نوع ورودی و خروجی
   * اسکیما یکی نیستند — فیلدِ دارای default در ورودی اختیاری و در خروجی
   * قطعی است. اگر ورودی را به `T` گره بزنیم، TypeScript همان فیلد را در
   * خروجی هم اختیاری می‌بیند و هر مصرف‌کننده باید بی‌دلیل چکِ undefined بزند.
   */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** نمونه‌ی شکل خروجی که داخل پرامپت به مدل نشان داده می‌شود */
  shapeHint: string;
};

/**
 * اجرای یک ایجنت با خروجی JSON اعتبارسنجی‌شده.
 * اگر بار اول JSON نامعتبر بود، یک بار دیگر با پیام خطا تلاش می‌کند.
 */
export async function runAgentJSON<T>(opts: AgentJSONOptions<T>): Promise<T> {
  const jsonInstruction =
    `\n\n— قالب خروجی —\n` +
    `خروجی تو باید «فقط» یک شیء JSON معتبر باشد؛ بدون هیچ توضیح، مقدمه یا \`\`\`.\n` +
    `دقیقاً با این ساختار:\n${opts.shapeHint}`;

  // بودجه یک‌بار ساخته می‌شود و بین همه‌ی تلاش‌ها مشترک است — وگرنه سقف روی هر
  // تلاش جدا اعمال می‌شد و دوباره ضرب می‌شدند.
  const budget = opts.budget ?? newCallBudget();

  let lastError = "";
  let attempts = 0;
  for (let attempt = 1; attempt <= AI_LIMITS.maxJsonAttempts; attempt++) {
    if (budget.used >= budget.max) break;
    attempts = attempt;
    const retryNote = lastError
      ? `\n\nتلاش قبلی‌ات JSON نامعتبری داشت. خطا: ${lastError}\nاین بار فقط JSON معتبر مطابق ساختار بده.`
      : "";

    const text = await runAgentText({
      ...opts,
      budget,
      prompt: opts.prompt + jsonInstruction + retryNote,
      // خروجی ساخت‌یافته با دمای پایین‌تر پایدارتر است
      temperature: opts.temperature ?? 0.4,
    });

    try {
      const parsed = JSON.parse(extractJson(text));
      return opts.schema.parse(parsed);
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 500) : String(err);
    }
  }
  throw new Error(
    `ایجنت «${opts.agent}» بعد از ${attempts} تلاش (${budget.used} درخواست) JSON معتبر نداد: ${lastError}`
  );
}
