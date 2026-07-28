import Link from "next/link";
import { Crm } from "@/components/studio/Crm";

export const metadata = {
  title: "CRM — دفترچه‌ی تصمیم",
  description: "تاریخچه، پیگیری و آمار تبدیل لیدهای LeadBridge مهدیار",
};

export const dynamic = "force-dynamic";

/** صفحه‌ی CRM (فاز ۶) — دفترچه‌ی تصمیم، پیگیری و قیف تبدیل */
export default function CrmPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <nav aria-label="بخش‌های دیگر" className="mb-3 text-sm">
          <ul className="flex flex-wrap gap-4">
            <li>
              <Link
                href="/studio"
                className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
              >
                بازگشت به داشبورد لید
              </Link>
            </li>
            <li>
              <Link
                href="/studio/trash"
                className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
              >
                سطل زباله — بازگرداندن موارد حذف‌شده
              </Link>
            </li>
          </ul>
        </nav>
        <h1 className="text-2xl font-black text-ink sm:text-3xl">CRM — دفترچه‌ی تصمیم</h1>
        <p className="mt-2 text-sm leading-7 text-ink-muted">
          بازه‌ی تاریخ را انتخاب کن تا ببینی چه کمپین‌هایی ساخته شد، روی هر لید چه اقدامی انجام شد،
          کدام‌ها منتخب شدند و به کدام‌ها پیام رفت. پاسخ بیزینس‌ها را همین‌جا ثبت کن.
        </p>
      </header>
      <Crm />
    </main>
  );
}
