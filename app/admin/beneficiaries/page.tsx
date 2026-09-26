"use client";

/** Every beneficiary in scope, filterable, newest activity first. */

import Link from "next/link";
import { useMemo, useState } from "react";
import { getCourse, getDistrict } from "../../../lib/livelihood/catalog";
import type { Beneficiary } from "../../../lib/store/beneficiaries";
import { DistrictPicker, ErrorNote, PageTitle, TableRowsSkeleton, useDistrict, useJson } from "../../components/ks/admin";
import { Card, fmtDateTime, STATUS_EN, StatusPill } from "../../components/ks/ui";

export default function Beneficiaries() {
  const [district, setDistrict, options] = useDistrict();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const params = new URLSearchParams({ limit: "500" });
  if (district) params.set("district", district);
  if (status) params.set("status", status);

  const { data, error, loading } = useJson<{ beneficiaries: Beneficiary[] }>(`/api/beneficiaries?${params}`);

  const rows = useMemo(() => {
    const list = data?.beneficiaries ?? [];
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter((b) => [b.phone, b.block, b.id].some((v) => v?.toLowerCase().includes(needle)))
      : list;
  }, [data, q]);

  return (
    <div>
      <PageTitle
        title="Beneficiaries"
        sub={data ? `${rows.length} shown` : undefined}
        loading={loading}
        right={
          <div className="flex flex-wrap gap-2">
            <input placeholder="Search phone / block" value={q} onChange={(e) => setQ(e.target.value)} className="rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm">
              <option value="">All statuses</option>
              {Object.entries(STATUS_EN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <DistrictPicker value={district} onChange={setDistrict} options={options} />
          </div>
        }
      />
      <ErrorNote error={error} />

      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Place</th>
              <th className="px-3 py-2 font-medium">Education</th>
              <th className="px-3 py-2 font-medium">Course</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Flags</th>
              <th className="px-3 py-2 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody className={`transition-opacity ${data && loading ? "opacity-50" : ""}`}>
            {!data && loading && <TableRowsSkeleton cols={7} />}
            {rows.map((b) => {
              const course = getCourse(b.chosen?.courseId ?? b.recommendations[0]?.courseId ?? "");
              return (
                <tr key={b.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-muted)]">
                  <td className="px-3 py-2">
                    <Link href={`/admin/b?id=${b.id}`} className="font-medium text-[var(--ks-primary)] underline">
                      {b.phone ?? `anonymous ${b.id.slice(0, 6)}`}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{[b.block, getDistrict(b.district ?? "")?.name].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-3 py-2">{b.profile.education !== undefined ? `${b.profile.education} yrs` : "—"}</td>
                  <td className="px-3 py-2">
                    {course ? <>{course.name}{!b.chosen && <span className="text-xs text-[var(--text-subtle)]"> (top pick)</span>}</> : "—"}
                  </td>
                  <td className="px-3 py-2"><StatusPill status={b.status} /></td>
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)]">{b.flags.join(", ")}</td>
                  <td className="px-3 py-2 text-xs">{fmtDateTime(b.updatedAt)}</td>
                </tr>
              );
            })}
            {data && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">No beneficiaries yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
