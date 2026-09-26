"use client";

/** Helpers shared by the staff pages. */

import { useCallback, useEffect, useState } from "react";
import { DISTRICTS } from "../../../lib/livelihood/catalog";
import { api } from "./ui";
import { useStaff } from "./StaffShell";

/** Load JSON from an API route, with a reload() for after a change. */
export function useJson<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    api<T>(url).then((r) => {
      if (cancelled) return;
      setData(r.ok ? r.data : null);
      setError(r.ok ? null : r.data.error ?? `Failed (${r.status})`);
    });

    // A newer request (filters changed) supersedes this one.
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

/**
 * The district a staff page is about. District-level roles are fixed to their
 * own; ministry and state pick one (state from its own districts).
 */
export function useDistrict(): [string, (d: string) => void, { id: string; name: string }[]] {
  const user = useStaff();
  const options = DISTRICTS.filter((d) => user?.role !== "state" || d.state === user.state).map((d) => ({ id: d.id, name: d.name }));
  const fixed = user?.district;
  const [picked, setPicked] = useState(fixed ?? "");
  return [fixed ?? picked, setPicked, fixed ? [] : options];
}

export function DistrictPicker({
  value,
  onChange,
  options,
  allowAll = true,
}: {
  value: string;
  onChange: (d: string) => void;
  options: { id: string; name: string }[];
  allowAll?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm"
    >
      {allowAll && <option value="">All districts</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mb-4 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>;
}

/** A horizontal bar for simple in-page charts. */
export function Bar({ label, value, max, tone = "var(--ks-primary)", suffix = "" }: { label: string; value: number; max: number; tone?: string; suffix?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-40 shrink-0 truncate" title={label}>{label}</span>
      <div className="h-3 flex-1 rounded-full bg-[var(--surface-muted)]">
        <div className="h-3 rounded-full" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, background: tone }} />
      </div>
      <span className="w-12 text-right tabular-nums">{value}{suffix}</span>
    </div>
  );
}
