"use client";

/**
 * The training centre's desk: people who chose this centre, and the three
 * updates only the centre can make — enrolled, in training, certified (or
 * dropped). Each update lands on the person's timeline for everyone to see.
 */

import { getCourse } from "../../lib/livelihood/catalog";
import type { Beneficiary } from "../../lib/store/beneficiaries";
import { ErrorNote, PageTitle, useJson } from "../components/ks/admin";
import { useStaff } from "../components/ks/StaffShell";
import { api, Button, Card, fmtDate, StatusPill } from "../components/ks/ui";

const NEXT: Record<string, { status: string; label: string }[]> = {
  interested: [{ status: "enrolled", label: "Enrolled" }],
  enrolled: [{ status: "training", label: "Started training" }],
  training: [{ status: "certified", label: "Certified" }],
};

export default function CentreDesk() {
  const user = useStaff();
  const { data, error, reload } = useJson<{ beneficiaries: Beneficiary[] }>("/api/beneficiaries?limit=500");

  async function set(id: string, status: string) {
    await api("/api/beneficiaries/status", { body: { id, status } });
    void reload();
  }

  const people = data?.beneficiaries ?? [];

  return (
    <div>
      <PageTitle title="Centre desk" sub={`${user?.name ?? ""} · ${people.length} people chose this centre`} />
      <ErrorNote error={error} />

      <div className="space-y-2">
        {people.map((b) => (
          <Card key={b.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{b.phone ?? b.id.slice(0, 6)} · {getCourse(b.chosen?.courseId ?? "")?.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{b.block} · chose on {fmtDate(b.chosen?.at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={b.status} />
                {(NEXT[b.status] ?? []).map((n) => (
                  <Button key={n.status} onClick={() => set(b.id, n.status)}>{n.label}</Button>
                ))}
                {["interested", "enrolled", "training"].includes(b.status) && (
                  <Button variant="ghost" onClick={() => set(b.id, "dropped")}>Dropped</Button>
                )}
              </div>
            </div>
          </Card>
        ))}
        {data && people.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-muted)]">No one has chosen this centre yet.</p>}
      </div>
    </div>
  );
}
