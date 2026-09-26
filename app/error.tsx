"use client";

/**
 * Shown instead of Next's generic "This page couldn't load" when a page
 * crashes in the browser. It says what went wrong in plain Hindi, offers a
 * retry, and shows the technical message small underneath — that line is what
 * lets a crash seen only on someone's phone be diagnosed from a screenshot.
 */

import Link from "next/link";
import { useEffect } from "react";

export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const detail = [error.name, error.message, error.digest && `digest ${error.digest}`].filter(Boolean).join(": ");

  return (
    <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <p className="text-xl font-semibold">यह पेज खुल नहीं पाया।</p>
      <p className="text-base text-[var(--text-muted)]">दोबारा कोशिश कीजिए। अगर फिर भी न खुले, तो पेज फिर से लोड कीजिए।</p>

      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={() => retry()} className="cursor-pointer rounded-xl bg-[var(--ks-primary)] px-5 py-3 text-lg font-semibold text-white">
          फिर कोशिश करें
        </button>
        <button onClick={() => window.location.reload()} className="cursor-pointer rounded-xl border-2 border-[var(--ks-primary)] px-5 py-3 text-lg font-semibold text-[var(--ks-primary)]">
          पेज फिर से लोड करें
        </button>
      </div>

      <Link href="/" className="block text-base underline">मुख्य पेज पर जाएँ</Link>

      <p translate="no" className="break-words rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-left font-mono text-xs text-[var(--text-muted)]">
        {detail || "Unknown error"}
      </p>
    </div>
  );
}
