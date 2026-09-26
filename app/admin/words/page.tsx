"use client";

/**
 * Dialect words: answers the interview did not understand, most frequent
 * first. Mapping one teaches the assistant — the very next call understands it.
 */

import { allowedValues, type SlotId } from "../../../lib/livelihood/extract";
import type { UnknownWord } from "../../../lib/store/unknown-words";
import { ErrorNote, PageTitle, useJson } from "../../components/ks/admin";
import { api, Button, Card, fmtDate } from "../../components/ks/ui";

export default function WordsPage() {
  const { data, error, reload } = useJson<{ words: UnknownWord[] }>("/api/unknown-words?status=new");
  const mapped = useJson<{ words: UnknownWord[] }>("/api/unknown-words?status=mapped");

  async function map(id: string, mappedTo: string | null) {
    await api("/api/unknown-words/map", { body: { id, mappedTo } });
    void reload();
    void mapped.reload();
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Dialect words" sub="What callers said that the assistant did not understand. Teach it once; every later call understands." />
      <ErrorNote error={error} />

      <Card title="To review">
        <ul className="divide-y divide-[var(--border)]">
          {(data?.words ?? []).map((w) => {
            const allowed = allowedValues(w.slot as SlotId);
            return (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-base">“{w.text}”</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    question: <b>{w.slot}</b> · heard {w.count}× · {w.districts.join(", ")} · last {fmtDate(w.lastAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {Array.isArray(allowed) ? (
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && map(w.id, e.target.value)}
                      className="rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="">It means…</option>
                      {allowed.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-[var(--text-subtle)]">free answer — not mappable</span>
                  )}
                  <Button variant="ghost" onClick={() => map(w.id, null)}>Ignore</Button>
                </div>
              </li>
            );
          })}
          {data && data.words.length === 0 && <li className="py-6 text-center text-sm text-[var(--text-muted)]">Nothing to review.</li>}
        </ul>
      </Card>

      <Card title="Taught so far">
        <ul className="space-y-1 text-sm">
          {(mapped.data?.words ?? []).map((w) => (
            <li key={w.id} className="flex justify-between gap-2">
              <span>“{w.text}” → <b>{w.mappedTo}</b> <span className="text-xs text-[var(--text-muted)]">({w.slot})</span></span>
              <button className="cursor-pointer text-xs underline" onClick={() => map(w.id, null)}>undo</button>
            </li>
          ))}
          {mapped.data && mapped.data.words.length === 0 && <li className="text-xs text-[var(--text-muted)]">None yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
