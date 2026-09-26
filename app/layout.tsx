import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import AppShell from "./components/AppShell";
import { TRANSLATE_BOOT_SCRIPT } from "./lib/shells";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const deva = Noto_Sans_Devanagari({
  variable: "--font-deva",
  subsets: ["devanagari", "latin"],
  weight: ["400", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kaushal Saathi — कौशल साथी",
  description: "Voice livelihood assistant for PM-AJAY beneficiaries",
  // The site translates itself (the language button); the browser's own
  // translation on top of it would translate a translation.
  other: { google: "notranslate" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="hi"
      className={`${geistSans.variable} ${geistMono.variable} ${deva.variable} h-full antialiased`}
      // The pre-paint script and the translator set attributes here before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: TRANSLATE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
