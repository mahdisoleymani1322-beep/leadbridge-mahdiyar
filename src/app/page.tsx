import { SERVICES } from "@/lib/brand";
import { MARKETS } from "@/lib/config";

/**
 * صفحه‌ی خانه (موقت — فاز ۱).
 * زیرساخت LeadBridge مهدیار ساخته شده؛ داشبورد لید و کشف در فازهای بعد.
 * این صفحه داده‌های برند (۷ خدمت) و بازارهای هدف را از همان منابع کد می‌خواند
 * تا اتصال درست زیرساخت هم دیده شود.
 */
export default function HomePage() {
  const markets = [...MARKETS].sort((a, b) => a.priority - b.priority);

  return (
    <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <section className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700">
          فاز ۱ — زیرساخت آماده شد
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-3xl font-black leading-tight text-ink sm:text-4xl">
          LeadBridge AI — بازوی هوشمند جذب مشتری مهدیار
        </h1>
        <p className="mx-auto mt-4 max-w-2xl leading-8 text-ink-muted">
          سیستم مولتی‌ایجنتی که کسب‌وکارهای هدف را پیدا می‌کند، درد اصلی‌شان را
          تحلیل می‌کند و یک پیام شخصی‌سازی‌شده — بر پایه‌ی هویت برند مهدیار — آماده
          می‌کند تا پس از تأیید شما ارسال شود.
        </p>
      </section>

      {/* ۷ خدمت رسمی مهدیار */}
      <section className="mt-14" aria-labelledby="services-heading">
        <h2 id="services-heading" className="text-xl font-extrabold text-ink">
          هفت خدمت مهدیار
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-surface-line bg-surface p-5 shadow-card"
            >
              <h3 className="flex items-center gap-2 font-bold text-ink">
                {s.title}
                {s.flagship && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    تخصص ویژه ⭐
                  </span>
                )}
              </h3>
              <p className="mt-1 text-sm leading-6 text-ink-muted">{s.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* بازارهای هدف */}
      <section className="mt-14" aria-labelledby="markets-heading">
        <h2 id="markets-heading" className="text-xl font-extrabold text-ink">
          بازارهای هدف (به‌ترتیب اولویت)
        </h2>
        <ol className="mt-5 space-y-3">
          {markets.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-4 rounded-xl border border-surface-line bg-surface p-4 shadow-card"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white"
                aria-hidden="true"
              >
                {m.priority}
              </span>
              <div>
                <h3 className="font-bold text-ink">{m.title}</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  نمونه جست‌وجو: {m.queryTerms.join("، ")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 rounded-xl2 bg-pine px-6 py-8 text-center text-bone">
        <h2 className="text-lg font-extrabold text-white">مرحله‌ی بعد</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-bone/80">
          فاز ۲: کشف خودکار لید از Google Maps و اینستاگرام + استخراج راه‌های
          ارتباط، و داشبورد لیدها.
        </p>
      </section>
    </main>
  );
}
