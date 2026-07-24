import "server-only";
import type { LeadStore } from "./types";
import { MemoryStore } from "./memory";
import { SupabaseStore } from "./supabase";

export * from "./types";

/**
 * انتخاب خودکار لایه‌ی ذخیره‌سازی:
 * - اگر Supabase تنظیم شده باشد → دیتابیس واقعی (پروداکشن مهدیار)
 * - وگرنه → حافظه‌ی موقت (فقط توسعه‌ی محلی/تست)
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

let cached: LeadStore | null = null;

export function getStore(): LeadStore {
  if (!cached) {
    cached = isSupabaseConfigured() ? new SupabaseStore() : new MemoryStore();
  }
  return cached;
}
