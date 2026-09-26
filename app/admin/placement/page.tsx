"use client";

/** Placement: the pipeline after certification, and certified people matched to local employers. */

import Link from "next/link";
import { getCourse } from "../../../lib/livelihood/catalog";
import { Bar, CardSkeleton, DistrictPicker, ErrorNote, PageTitle, Refreshing, useDistrict, useJson } from "../../components/ks/admin";
import { Card, STATUS_EN } from "../../components/ks/ui";

type Placement = {
  pipeline: Record<string, number>;
  employers: { id: string; name: string; block: string; sectors: string[]; openings: number; sample: boolean; shortlist: { id: string; block?: string; courseId?: string; phone?: string }[] }[];
  outcomes: Record<string, { rate: number; n: number }>;
};

export default function PlacementPage() {
  const [district, setDistrict, options] = useDistrict();
  const { data, error, loading } = useJson<Placement>(`/api/placement${district ? `?district=${district}` : ""}`);
  const max = Math.max(1, ...Object.values(data?.pipeline ?? { x: 1 }));

  return (
    <div>
      <PageTitle title="Placement" sub="Certified → working, measured by 30- and 90-day follow-up calls." loading={loading} right={<DistrictPicker value={district} onChange={setDistrict} options={options} />} />
      <ErrorNote error={error} />

      {!data && loading && (
        <div className="grid gap-5 lg:grid-cols-2">
          <CardSkeleton rows={5} />
          <CardSkeleton rows={4} />
          <CardSkeleton rows={6} variant="lines" className="lg:col-span-2" />
        </div>
      )}

      {data && (
        <Refreshing busy={loading}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="After training">
            <div className="space-y-1.5">
              {["certified", "placed", "self_employed", "retained", "dropped"].map((k) => (
                <Bar key={k} label={STATUS_EN[k]} value={data.pipeline[k] ?? 0} max={max} tone={k === "dropped" ? "var(--danger)" : "var(--success)"} />
              ))}
            </div>
          </Card>

          <Card title="Placement rate by course">
            {Object.keys(data.outcomes).length === 0 && <p className="text-xs text-[var(--text-muted)]">No certified graduates yet.</p>}
            <div className="space-y-1.5">
              {Object.entries(data.outcomes).map(([id, o]) => (
                <Bar key={id} label={`${getCourse(id)?.name ?? id} (n=${o.n})`} value={Math.round(o.rate * 100)} max={100} suffix="%" tone="var(--success)" />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-subtle)]">Courses with ≥5 outcomes feed back into ranking — poor placement ranks a course lower.</p>
          </Card>

          <Card title="Employers and shortlists" className="lg:col-span-2">
            <ul className="space-y-3">
              {data.employers.map((e) => (
                <li key={e.id} className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-sm font-semibold">{e.name} {e.sample && <span className="text-xs font-normal text-[var(--text-subtle)]">(sample)</span>}</p>
                  <p className="text-xs text-[var(--text-muted)]">{e.block} · {e.sectors.join(", ")} · {e.openings} openings</p>
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {e.shortlist.length === 0 && <li className="text-[var(--text-subtle)]">No certified matches yet.</li>}
                    {e.shortlist.map((s) => (
                      <li key={s.id}>
                        <Link href={`/admin/b?id=${s.id}`} className="rounded-full bg-[var(--success-soft)] px-2.5 py-1 underline">
                          {s.phone ?? s.id.slice(0, 6)} · {getCourse(s.courseId ?? "")?.name} · {s.block}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        </Refreshing>
      )}
    </div>
  );
}
