"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PiHandshake } from "react-icons/pi";
import { LanguagePicker, TranslateProvider } from "./Translate";

/** Pages with a side-by-side layout get the full width. */
const WIDE = ["/me", "/course"];

/** The beneficiary's frame: one plain header, big type, nothing to get lost in. */
export default function BeneficiaryShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const width = WIDE.some((w) => path === w || path.startsWith(`${w}/`)) ? "max-w-6xl" : "max-w-3xl";

  return (
    <TranslateProvider source="hi">
    <div className="ks-body flex min-h-screen flex-col">
      <header className="bg-[var(--ks-primary)] text-white">
        <div className={`mx-auto flex ${width} items-center justify-between px-4 py-3`}>
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ks-accent)] text-xl text-[var(--ks-primary)]">
              <PiHandshake aria-hidden />
            </span>
            <span className="text-lg font-bold">कौशल साथी</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/me" className="rounded-lg px-2 py-1 hover:bg-white/10">मेरी प्रगति</Link>
            <LanguagePicker />
          </nav>
        </div>
      </header>

      <main className={`mx-auto w-full ${width} flex-1 px-4 py-5`}>{children}</main>

      <footer className="border-t border-[var(--border)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
        SIH 2026 प्रोटोटाइप (PM-AJAY, समस्या 26097) — सरकारी सेवा नहीं ·{" "}
        <Link href="/login" className="underline">अधिकारी लॉगिन</Link>
      </footer>
    </div>
    </TranslateProvider>
  );
}
