import "server-only";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";

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
      "X-Title": "LeadBridge AI — Mahdiyar",
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
export function defaultModel(): string {
  return process.env.PIPELINE_MODEL || "meta-llama/llama-3.3-70b-instruct:free";
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
  return [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-2-9b-it:free",
    "qwen/qwen-2.5-72b-instruct:free",
  ];
}

/** آیا این خطا با مدل دیگر قابل جبران است؟ (rate-limit / در دسترس نبودن) */
function isRetriableModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|rate.?limit|quota|503|502|overloaded|unavailable|timeout/i.test(msg);
}

export type AgentCallOptions = {
  /** نام ایجنت — فقط برای پیام‌های خطای خواناتر */
  agent: string;
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

/**
 * اجرای یک ایجنت با خروجی متنی آزاد.
 * اگر مدل اصلی rate-limit/در دسترس نبود، مدل‌های جایگزین امتحان می‌شوند
 * (گاردریل: هر مدل فقط یک بار؛ خطای غیرقابل‌جبران بلافاصله پرتاب می‌شود).
 */
export async function runAgentText(opts: AgentCallOptions): Promise<string> {
  const openrouter = getOpenRouter();
  const primary = opts.model ?? defaultModel();
  const chain = [primary, ...modelFallbacks().filter((m) => m !== primary)];

  let lastError: unknown = null;
  for (const model of chain) {
    try {
      const result = await generateText({
        model: openrouter(model),
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxOutputTokens ?? 2000,
      });
      if (result.text.trim()) return result.text;
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
  /** اسکیمای Zod برای اعتبارسنجی خروجی */
  schema: z.ZodType<T>;
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

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryNote = lastError
      ? `\n\nتلاش قبلی‌ات JSON نامعتبری داشت. خطا: ${lastError}\nاین بار فقط JSON معتبر مطابق ساختار بده.`
      : "";

    const text = await runAgentText({
      ...opts,
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
  throw new Error(`ایجنت «${opts.agent}» بعد از ۲ تلاش JSON معتبر نداد: ${lastError}`);
}
