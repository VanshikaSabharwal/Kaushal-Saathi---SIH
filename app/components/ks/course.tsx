"use client";

/**
 * Course pieces shared by the beneficiary's dashboard and the course page:
 * a compact course card that links to the full details, the reasons in words,
 * and the conversation panel.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FiCheckCircle, FiChevronRight, FiClock, FiMapPin, FiMessageSquare, FiMic } from "react-icons/fi";
import { CENTRES, getCourse } from "../../../lib/livelihood/catalog";
import { durationText, fill, tpl } from "../../../lib/livelihood/i18n";
import type { Beneficiary, SavedRecommendation } from "../../../lib/store/beneficiaries";
import type { Message } from "../../../lib/store/messages";
import {api} from "./ui";

const T = tpl("hi");

/** A saved reason code, in words — with the asset it refers to, from their own answers. */
export function reasonHi(code: string, rec: SavedRecommendation, b: Beneficiary): string {
  const course = getCourse(rec.courseId);
  const asset = course?.helpfulAssets.find((a) => b.profile.assets?.includes(a));
  return fill(T.reasons?.[code] ?? "", {
    km: Math.max(1, Math.round(rec.distanceKm)),
    asset: asset ? (T.assets as Record<string, string>)[asset] : "",
  });
}

export function courseHref(courseId: string, centreId?: string): string {
  return `/course?id=${encodeURIComponent(courseId)}${centreId ? `&centre=${encodeURIComponent(centreId)}` : ""}`;
}

/** One recommended course: the essentials, why, and a link to everything else. */
export function CourseCard({
  rec,
  b,
  index,
}: {
  rec: SavedRecommendation;
  b: Beneficiary;
  index: number;
}) {
  const c = getCourse(rec.courseId);
  const centre = CENTRES.find((x) => x.id === rec.centreId);
  if (!c) return null;

  const chosen = b.chosen?.courseId === rec.courseId;
  const reasons = rec.reasons.map((code) => reasonHi(code, rec, b)).filter(Boolean);

  return (
    <li className={`rounded-2xl border-2 bg-white p-4 ${chosen ? "border-[var(--success)]" : "border-[var(--border)]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {chosen && (
            <p className="mb-1 flex items-center gap-1 text-sm font-semibold text-[var(--success)]">
              <FiCheckCircle aria-hidden /> आपने यह कोर्स चुना है
            </p>
          )}
          <p className="text-xl font-bold">
            {index + 1}. {c.nameHi}
          </p>
          <p className="text-sm text-[var(--text-muted)]" translate="no">{c.name}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-base text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><FiClock aria-hidden /> {durationText(c.durationDays, T)}</span>
        <span className="flex items-center gap-1"><FiMapPin aria-hidden /> {centre?.name} · लगभग {Math.max(1, Math.round(rec.distanceKm))} किमी</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {reasons.slice(0, 3).map((x) => (
          <span key={x} className="rounded-full bg-[var(--ks-accent-soft)] px-2.5 py-0.5 text-sm">{x}</span>
        ))}
      </div>

      <Link
        href={courseHref(rec.courseId, rec.centreId)}
        className="mt-4 inline-flex items-center gap-1 rounded-xl bg-[var(--ks-primary)] px-4 py-2 text-base font-semibold text-white"
      >
        पूरी जानकारी देखें <FiChevronRight aria-hidden />
      </Link>
    </li>
  );
}

/** The conversation so far, voice and chat, newest at the bottom. */
export function ConversationPanel({ url }: { url: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ messages: Message[] }>(url).then((r) => {
      if (!cancelled) setMessages(r.ok ? r.data.messages : []);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages]);

  return (
    <section className="flex max-h-[75vh] flex-col rounded-2xl border border-[var(--border)] bg-white">
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-base font-semibold">आपकी बातचीत</h2>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages === null && <p className="text-sm text-[var(--text-muted)]">…</p>}
        {messages?.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]">अभी कोई बातचीत नहीं हुई।</p>
        )}
        {messages?.map((m) => (
          <div
            key={m.id}
            className={`max-w-[90%] rounded-2xl px-3 py-2 text-base ${
              m.role === "user" ? "ml-auto bg-[var(--ks-primary)] text-white" : "mr-auto bg-[var(--surface-muted)]"
            }`}
          >
            <p className="whitespace-pre-wrap">{m.text}</p>
            <p className={`mt-1 flex items-center gap-1 text-[11px] ${m.role === "user" ? "text-white/70" : "text-[var(--text-subtle)]"}`}>
              {m.channel === "voice" ? <FiMic aria-hidden /> : <FiMessageSquare aria-hidden />}
              <span translate="no">
                {new Date(m.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </section>
  );
}
