import Link from "next/link";
import { Trash } from "@/components/studio/Trash";

export const metadata = {
  title: "سطل زباله",
  description: "موارد حذف‌شده‌ی LeadBridge مهدیار و بازگرداندنشان",
};

export const dynamic = "force-dynamic";

/** سطل زباله — هرچه حذف شده، با امکان بازگرداندن */
export default function TrashPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-black text-ink sm:text-3xl">سطل زباله</h1>
        <p className="mt-2 text-sm leading-7 text-ink-muted">
          هیچ‌چیز واقعاً پاک نمی‌شود. هر حذف یک دسته می‌سازد که می‌توانی کاملش را برگردانی.
        </p>
        <nav aria-label="بخش‌های دیگر" className="mt-3 text-sm">
          <ul className="flex flex-wrap gap-4">
            <li>
              <Link
                href="/studio"
                className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
              >
                داشبورد لید
              </Link>
            </li>
            <li>
              <Link
                href="/studio/crm"
                className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
              >
                CRM — دفترچه‌ی تصمیم، پیگیری و آمار تبدیل
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <Trash />
    </main>
  );
}
