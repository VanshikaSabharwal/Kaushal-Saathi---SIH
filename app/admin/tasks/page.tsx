"use client";

/** The Needs attention queue: hand-offs, enrolments, tickets, verifications and follow-ups, most overdue first. */

import Link from "next/link";
import { useState } from "react";
import type { Task } from "../../../lib/store/tasks";
import { DistrictPicker, ErrorNote, PageTitle, useDistrict, useJson } from "../../components/ks/admin";
import { api, Button, Card, fmtDate } from "../../components/ks/ui";

const TYPES: Record<string, string> = {
  callback: "Call back (hand-off)",
  ticket: "Complaint / question",
  enrol: "Enrol in course",
  verify: "Verify certificate",
  follow_up: "Placement follow-up",
  consult: "Consultant case",
};

export default function Tasks() {
  const [district, setDistrict, options] = useDistrict();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("open");
  const params = new URLSearchParams({ status });
  if (district) params.set("district", district);
  if (type) params.set("type", type);

  const { data, error, reload } = useJson<{ tasks: Task[] }>(`/api/tasks?${params}`);
  // Fixed at first render: "overdue" should not flicker as the clock moves.
  const [now] = useState(() => Date.now());

  async function close(id: string, next: "done" | "open") {
    await api("/api/tasks/status", { body: { id, status: next } });
    void reload();
  }

  return (
    <div>
      <PageTitle
        title="Needs attention"
        sub="Work the bot could not finish, with an owner and a due date."
        right={
          <div className="flex flex-wrap gap-2">
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">All types</option>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="open">Open</option>
              <option value="done">Done</option>
            </select>
            <DistrictPicker value={district} onChange={setDistrict} options={options} />
          </div>
        }
      />
      <ErrorNote error={error} />

      <div className="space-y-2">
        {(data?.tasks ?? []).map((t) => {
          const overdue = t.status === "open" && t.dueAt < now;
          return (
            <Card key={t.id} className={overdue ? "border-[var(--danger)]" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{TYPES[t.type] ?? t.type}{t.type === "ticket" ? ` · #${t.id.replace(/-/g, "").slice(0, 6).toUpperCase()}` : ""}</p>
                  <p className="text-sm">{String(t.data?.text ?? t.reason)}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    owner: {t.owner} · {t.block ?? ""} {t.district ?? ""} · due{" "}
                    <span className={overdue ? "font-semibold text-[var(--danger)]" : ""}>{fmtDate(t.dueAt)}{overdue ? " (overdue)" : ""}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/admin/b?id=${t.beneficiaryId}`} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-sm">Open person</Link>
                  {t.status === "open" ? (
                    <Button onClick={() => close(t.id, "done")}>Mark done</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => close(t.id, "open")}>Reopen</Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
        {data && data.tasks.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">Nothing here.</p>}
      </div>
    </div>
  );
}
