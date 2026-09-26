"use client";

/**
 * "मेरे कोर्स" — the beneficiary's dashboard.
 *
 * Left: the courses the assistant recommended (the chosen one first), each
 * with the essentials and a link to its full details. Right: the conversation
 * that led to them, voice and chat. Everything else about the person lives on
 * /me/profile.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiChevronRight, FiMic, FiUser } from "react-icons/fi";
import type { Beneficiary } from "../../lib/store/beneficiaries";
import { ConversationPanel, CourseCard } from "../components/ks/course";
import {api, Card, STATUS_HI, StatusPill} from "../components/ks/ui";

export default function MePage() {
  const router = useRouter();
  const [b, setB] = useState<Beneficiary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ beneficiary: Beneficiary }>("/api/me").then((r) => {
      if (cancelled) return;
      if (r.status === 401) return router.replace("/");
      setB(r.data.beneficiary ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!b) return <p className="py-10 text-center text-[var(--text-muted)]">…</p>;

  // The chosen course first, then the rest in the order they were offered.
  const recs = [...b.recommendations].sort(
    (x, y) => Number(y.courseId === b.chosen?.courseId) - Number(x.courseId === b.chosen?.courseId),
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Link href="/talk" className="inline-flex items-center gap-2 rounded-xl bg-[var(--ks-primary)] px-4 py-2.5 text-base font-semibold text-white">
        <FiMic aria-hidden /> बात करें
      </Link>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--ks-primary)]">मेरे कोर्स</h1>
          <StatusPill status={b.status} lang="hi" />
        </div>
        {actions}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="space-y-4 lg:col-span-3">
          {recs.length === 0 ? (
            <Card>
              <div className="flex items-start gap-3">
                <p className="flex-1 text-xl font-semibold">
                  अभी आपके लिए कोर्स नहीं चुने गए हैं। कौशल साथी से बात कीजिए — 5 मिनट में आपके लिए सही कोर्स मिलेंगे।
                </p>
              </div>
              <Link href="/talk" className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-[var(--ks-primary)] px-4 py-5 text-xl font-bold text-white">
                <FiMic aria-hidden /> बात शुरू करें
              </Link>
            </Card>
          ) : (
            <>
              <ul className="space-y-4">
                {recs.map((r, i) => (
                  <CourseCard key={r.courseId} rec={r} b={b} index={i} />
                ))}
              </ul>
              {!b.chosen && (
                <p className="text-base">
                  कोई कोर्स चुनने के लिए <Link href="/talk" className="font-semibold underline">कौशल साथी से बात करें</Link> और “पहला”, “दूसरा” या
                  “तीसरा” बोलें।
                </p>
              )}
            </>
          )}

          <Link
            href="/me/profile"
            className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-base"
          >
            <span className="flex items-center gap-2"><FiUser aria-hidden /> मेरी जानकारी, शिकायतें और प्रमाणपत्र</span>
            <FiChevronRight aria-hidden />
          </Link>
          <p className="sr-only">{STATUS_HI[b.status]}</p>
        </section>

        <aside className="lg:col-span-2 lg:sticky lg:top-4 lg:self-start">
          <ConversationPanel url="/api/me/messages" />
        </aside>
      </div>
    </div>
  );
}
