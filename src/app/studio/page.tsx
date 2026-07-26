import Link from "next/link";
import { Studio } from "@/components/studio/Studio";

export const metadata = {
  title: "داشبورد لید",
  description: "کشف و مدیریت لیدهای LeadBridge مهدیار",
};

export const dynamic = "force-dynamic";

/** داشبورد استودیو — کمپین‌ها، لیدها، فهرست منتخب، پیام‌ها */
export default function StudioPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-black text-ink sm:text-3xl">داشبورد لید</h1>
        <p className="mt-2 text-sm leading-7 text-ink-muted">
          یک کمپین بساز، «کشف لید» را بزن تا کسب‌وکارهای هدف پیدا و راه‌های ارتباطشان استخراج شوند.
          بعد لیدهای خوب را منتخب کن، تحلیل بگیر و برایشان پیام بساز.
        </p>
        <nav aria-label="بخش‌های دیگر" className="mt-3 text-sm">
          <Link
            href="/studio/crm"
            className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
          >
            CRM — دفترچه‌ی تصمیم، پیگیری و آمار تبدیل
          </Link>
        </nav>
      </header>
      <Studio />
    </main>
  );
}
