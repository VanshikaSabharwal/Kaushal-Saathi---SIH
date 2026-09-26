"use client";

/**
 * District insights — the planning view: what people here need to learn,
 * where demand, interest and training supply disagree, what kinds of people
 * are asking, where there is no consultant, what the district's own documents
 * say, and the perspective plan as a download.
 */

import { Bar, DistrictPicker, ErrorNote, PageTitle, useDistrict, useJson } from "../../components/ks/admin";
import { api, Button, Card } from "../../components/ks/ui";

type Insights = {
  district: { id: string; name: string; nameHi: string; state: string };
  people: number;
  skillGaps: { skill: string; en: string; hi: string; count: number }[];
  sectors: { sector: string; demand: number; interested: number; chosen: number; centres: number }[];
  clusters: { size: number; label: { en: string; hi: string } }[];
  consultantCoverage: { block: string; blockHi: string; consultants: number; gap: boolean }[];
  opportunities: { id: string; sector: string; idea: string; ideaHi: string; evidence: string; source: { document: string; page?: number } }[];
  outcomes: Record<string, { rate: number; n: number }>;
};

export default function InsightsPage() {
  const [district, setDistrict, options] = useDistrict();
  const effective = district || options[0]?.id || "";
  const { data, error } = useJson<Insights>(effective ? `/api/insights?district=${effective}` : null);

  async function downloadPlan() {
    const r = await api<{ csv: string; district: string }>(`/api/plan?district=${effective}`);
    if (!r.ok) return;
    const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `perspective-plan-${effective}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const d = data;
  const maxGap = Math.max(1, ...(d?.skillGaps.map((g) => g.count) ?? [1]));

  return (
    <div>
      <PageTitle
        title={`District insights${d ? ` — ${d.district.name}` : ""}`}
        sub={d ? `${d.people} people · ${d.district.state}` : undefined}
        right={
          <div className="flex gap-2">
            <DistrictPicker value={effective} onChange={setDistrict} options={options} allowAll={false} />
            <Button onClick={downloadPlan} disabled={!effective}>Export perspective plan (CSV)</Button>
          </div>
        }
      />
      <ErrorNote error={error} />

      {d && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Skill gaps to plan training for">
            {d.skillGaps.length === 0 && <p className="text-xs text-[var(--text-muted)]">No completed interviews yet.</p>}
            <div className="space-y-1.5">
              {d.skillGaps.map((g) => <Bar key={g.skill} label={`${g.en} · ${g.hi}`} value={g.count} max={maxGap} />)}
            </div>
          </Card>

          <Card title="Who is asking (profile groups)">
            {d.clusters.length === 0 && <p className="text-xs text-[var(--text-muted)]">Needs at least a few completed interviews.</p>}
            <ul className="space-y-2 text-sm">
              {d.clusters.map((c, i) => (
                <li key={i} className="rounded-lg bg-[var(--surface-muted)] p-2">
                  <b>{c.size} people</b> — {c.label.en}
                  <span className="block text-xs text-[var(--text-muted)]">{c.label.hi}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Demand vs interest vs training supply" className="lg:col-span-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-xs text-[var(--text-muted)]">
                  <tr className="text-left">
                    <th className="py-1">Sector</th><th>District demand</th><th>People interested</th><th>Chose a course</th><th>Centres</th><th />
                  </tr>
                </thead>
                <tbody>
                  {d.sectors.map((s) => {
                    const gap = s.interested > 0 && s.centres === 0;
                    return (
                      <tr key={s.sector} className="border-t border-[var(--border)]">
                        <td className="py-1.5">{s.sector.replace(/_/g, " ")}</td>
                        <td>{Math.round(s.demand * 100)}%</td>
                        <td>{s.interested}</td>
                        <td>{s.chosen}</td>
                        <td>{s.centres}</td>
                        <td className="text-xs text-[var(--danger)]">{gap ? "interest but no centre" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-subtle)]">Demand figures are illustrative until derived from the district’s DIPS/PLP documents.</p>
          </Card>

          <Card title="Financial consultant coverage">
            <ul className="space-y-1 text-sm">
              {d.consultantCoverage.map((c) => (
                <li key={c.block} className="flex justify-between">
                  <span>{c.block} · {c.blockHi}</span>
                  <span className={c.gap ? "font-semibold text-[var(--danger)]" : ""}>{c.gap ? "no consultant available" : `${c.consultants} available`}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Opportunities from district documents">
            {d.opportunities.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                None yet. Add the district’s DIPS / ODOP / NABARD PLP files under <code>knowledge/</code>, then run{" "}
                <code>npm run ingest:regions</code> and <code>npm run extract:opportunities</code>.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.opportunities.map((o) => (
                  <li key={o.id} className="rounded-lg bg-[var(--surface-muted)] p-2">
                    <b>{o.idea}</b> · {o.ideaHi}
                    <span className="block text-xs text-[var(--text-muted)]">“{o.evidence}” — {o.source.document}{o.source.page ? `, p. ${o.source.page}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
