import { Studio } from "@/components/studio/Studio";

export const metadata = {
  title: "داشبورد لید",
  description: "کشف و مدیریت لیدهای LeadBridge مهدیار",
};

export const dynamic = "force-dynamic";

/** داشبورد استودیو — فاز ۲: کمپین‌ها + کشف لید + جدول لیدها */
export default function StudioPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-black text-ink sm:text-3xl">داشبورد لید</h1>
        <p className="mt-2 text-sm leading-7 text-ink-muted">
          یک کمپین بساز، «کشف لید» را بزن تا کسب‌وکارهای هدف از Google Maps پیدا و
          راه‌های ارتباطشان استخراج شوند. (تحلیل و پیام در فازهای بعد.)
        </p>
      </header>
      <Studio />
    </main>
  );
}
