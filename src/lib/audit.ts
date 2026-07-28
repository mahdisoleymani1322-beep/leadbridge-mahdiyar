import "server-only";
import { randomUUID } from "crypto";
import { getStore } from "@/lib/store";
import type { AuditAction, AuditEntry } from "@/lib/store/types";

/**
 * دفترچه‌ی تصمیم — **تنها راه نوشتن در `audit_log`**.
 *
 * چرا یک نقطه‌ی واحد: رکوردهای پخش‌شده در پنج فایل مختلف خیلی زود شکل‌های
 * ناهمگون پیدا می‌کنند و صفحه‌ی CRM دیگر نمی‌تواند یکدست نمایششان دهد.
 *
 * چرا اصلاً لازم است: تا فاز ۵، تصمیم‌های انسان هیچ ردِ زمانی نداشتند.
 * `messages.approved_by` ثبت می‌شد ولی «کِی» جایی نبود. `agent_runs` فقط
 * کارِ **ایجنت‌ها** را ثبت می‌کند، نه کار انسان.
 *
 * ⚠️ ثبت تصمیم هرگز نباید کار اصلی را بشکند: اگر نوشتن در دفترچه خطا بدهد،
 * خطا بلعیده می‌شود. از دست رفتن یک ردیف لاگ خیلی بهتر از این است که تأیید
 * یک پیام به‌خاطر مشکل لاگ شکست بخورد.
 */
export async function recordDecision(input: {
  entityType: AuditEntry["entityType"];
  entityId: string | null;
  action: AuditAction;
  /** توضیح خوانا — همان چیزی که در دفترچه به مالک نشان داده می‌شود */
  reason?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}): Promise<void> {
  try {
    await getStore().addAudit({
      id: randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      reason: input.reason ?? null,
      beforeData: input.beforeData ?? null,
      afterData: input.afterData ?? null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      deletedBatch: null,
    });
  } catch {
    /* ثبت تصمیم best-effort است — کار اصلی نباید به‌خاطرش شکست بخورد */
  }
}

/** برچسب فارسی هر نوع تصمیم — برای نمایش در دفترچه */
export const AUDIT_LABELS: Record<AuditAction, string> = {
  "campaign.created": "کمپین ساخته شد",
  "discovery.run": "کشف لید اجرا شد",
  "lead.shortlisted": "به فهرست منتخب اضافه شد",
  "lead.unshortlisted": "از فهرست منتخب برداشته شد",
  "lead.replied": "پاسخ بیزینس ثبت شد",
  "lead.converted": "تبدیل شد (تحویل نهایی)",
  "message.edited": "متن پیام ویرایش شد",
  "message.approved": "پیام تأیید شد",
  "message.rejected": "پیام رد شد",
  "message.sent": "پیام ارسال شد",
};
