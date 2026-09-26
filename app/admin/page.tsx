"use client";

/** Overview: the pipeline, the queue, quality signals and where people drop off. */

import Link from "next/link";
import { Bar, DistrictPicker, ErrorNote, PageTitle, useDistrict, useJson } from "../components/ks/admin";
import { Card, Stat, STATUS_EN } from "../components/ks/ui";

type Stats = {
  total: number;
  byStatus: Record<string, number>;
  openTasks: number;
  overdueTasks: number;
  openByType: Record<string, number>;
  flagged: { handoff: number; misheard: number; llmUsed: number; notPlaced: number };
  dropOff: Record<string, number>;
  model?: { source: string; trainedAt: string; auc: number; baselineAuc: number };
};

const QUESTION_EN: Record<string, string> = {
  district: "District", block: "Block", education: "Education", currentWork: "Current work", familyTrade: "Family trade",
  continueFamilyTrade: "Continue family trade?", interests: "Interests", preference: "Job or own work", travel: "Travel",
  hours: "Hours", learning: "Learning style", familySupport: "Family support", constraints: "Physical constraints",
  assets: "Assets", aspiration: "Aspiration", summary: "Summary",
};

export default function Overview() {
  const [district, setDistrict, options] = useDistrict();
  const { data, error } = useJson<Stats>(`/api/stats${district ? `?district=${district}` : ""}`);

  const s = data;
  const working = s ? (s.byStatus.placed ?? 0) + (s.byStatus.self_employed ?? 0) + (s.byStatus.retained ?? 0) : 0;
  const drop = s ? Object.entries(s.dropOff).sort((a, b) => b[1] - a[1]) : [];
  const funnel = ["profiling", "recommended", "interested", "enrolled", "training", "certified", "placed", "self_employed", "retained", "dropped"];

  return (
    <div>
      <PageTitle title="Overview" sub="Beneficiaries from first conversation to work." right={<DistrictPicker value={district} onChange={setDistrict} options={options} />} />
      <ErrorNote error={error} />

      {s && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label="People interviewed" value={s.total} />
            <Stat label="Chose a course" value={s.total - (s.byStatus.profiling ?? 0) - (s.byStatus.recommended ?? 0)} />
            <Stat label="In training" value={(s.byStatus.enrolled ?? 0) + (s.byStatus.training ?? 0)} />
            <Stat label="Certified" value={s.byStatus.certified ?? 0} />
            <Stat label="Working" value={working} tone="good" />
            <Stat label="Dropped out" value={s.byStatus.dropped ?? 0} tone={s.byStatus.dropped ? "warn" : undefined} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Pipeline">
              <div className="space-y-1.5">
                {funnel.map((k) => (
                  <Bar key={k} label={STATUS_EN[k]} value={s.byStatus[k] ?? 0} max={Math.max(1, ...Object.values(s.byStatus))} tone={k === "dropped" ? "var(--danger)" : undefined} />
                ))}
              </div>
            </Card>

            <Card title="Needs attention" action={<Link href="/admin/tasks" className="text-xs underline">Open queue →</Link>}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Open tasks" value={s.openTasks} />
                <Stat label="Overdue" value={s.overdueTasks} tone={s.overdueTasks ? "warn" : undefined} />
              </div>
              <ul className="mt-3 space-y-1 text-xs">
                {Object.entries(s.openByType).map(([t, n]) => (
                  <li key={t} className="flex justify-between"><span className="capitalize">{t.replace("_", " ")}</span><span className="tabular-nums">{n}</span></li>
                ))}
              </ul>
            </Card>

            <Card title="Call quality (flagged)">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Handed to a person" value={s.flagged.handoff} />
                <Stat label="Misheard at least once" value={s.flagged.misheard} />
                <Stat label="Needed the LLM" value={s.flagged.llmUsed} />
                <Stat label="Not working after follow-up" value={s.flagged.notPlaced} tone={s.flagged.notPlaced ? "warn" : undefined} />
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                Misheard answers feed the <Link href="/admin/words" className="underline">dialect words</Link> queue.
              </p>
            </Card>

            <Card title="Where unfinished interviews stopped">
              {drop.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No unfinished interviews.</p>
              ) : (
                <div className="space-y-1.5">
                  {drop.map(([q, n]) => <Bar key={q} label={QUESTION_EN[q] ?? q} value={n} max={drop[0][1]} tone="var(--ks-accent)" />)}
                </div>
              )}
            </Card>
          </div>

          {s.model && (
            <Card title="Completion model">
              <p className="text-xs">
                AUC <b>{s.model.auc}</b> vs rules-only <b>{s.model.baselineAuc}</b> · trained on <b>{s.model.source}</b> data · {new Date(s.model.trainedAt).toLocaleDateString("en-IN")}
              </p>
              {s.model.source === "synthetic" && (
                <p className="mt-1 text-[11px] text-[var(--warning)]">
                  Bootstrapped on synthetic data. Retrain with real outcomes: <code>npm run ml:train -- --with-records</code>.
                </p>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
