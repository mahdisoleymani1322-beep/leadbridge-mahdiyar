import type { Metadata } from "next";
import Link from "next/link";
import localFont from "next/font/local";
import "./globals.css";

/**
 * فونت‌های برند آرکان — دقیقاً همان فایل‌های self-hosted سایت اصلی
 * (استعداد برای عناوین، وزیرمتن برای بدنه) تا استودیو و سایت یکدست باشند.
 */
const estedad = localFont({
  src: [
    { path: "../../public/fonts/Estedad-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Estedad-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Estedad-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/Estedad-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-estedad",
  display: "swap",
  preload: true,
});

const vazirmatn = localFont({
  src: [
    { path: "../../public/fonts/Vazirmatn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-vazirmatn",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: {
    default: "LeadBridge — مهدیار هوش‌افزا",
    template: "%s | مهدیار هوش‌افزا",
  },
  description:
    "سیستم مولتی‌ایجنت جذب و تحویل لید مهدیار هوش‌افزا — بازوی هوشمند رشد کسب‌وکار شما.",
};

/** نشان برند مهدیار هوش‌افزا */
function BrandMark() {
  return (
    <span className="inline-flex select-none items-center gap-2.5" aria-label="مهدیار هوش‌افزا">
      <svg width="30" height="30" viewBox="0 0 40 40" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="6" y="6" width="28" height="28" rx="8" fill="#0F2D55" />
        <circle cx="20" cy="20" r="7" fill="none" stroke="#1A7FA0" strokeWidth="2.4" />
        <circle cx="20" cy="20" r="2.4" fill="#D4A017" />
      </svg>
      <span className="font-heading text-xl font-bold leading-none tracking-tight text-pine">
        مهدیار هوش‌افزا
      </span>
    </span>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={`${estedad.variable} ${vazirmatn.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <header className="sticky top-0 z-40 border-b border-surface-line bg-bone/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5" aria-label="مهدیار هوش‌افزا — خانه">
              <BrandMark />
              <span className="hidden text-xs font-medium text-ink-muted sm:inline">
                بازوی هوشمند رشد کسب‌وکار
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/studio"
                className="rounded-btn bg-pine px-4 py-2 font-medium text-bone shadow-card transition-colors hover:bg-pine-dark"
              >
                داشبورد لید
              </Link>
            </nav>
          </div>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-surface-line bg-pine text-bone">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-bone/70 sm:flex-row sm:px-6">
            <span>© مهدیار هوش‌افزا — بازوی اجرایی هوش مصنوعی برای رشد کسب‌وکارها</span>
            <span>LeadBridge AI · سیستم مولتی‌ایجنت جذب و تحویل لید</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
