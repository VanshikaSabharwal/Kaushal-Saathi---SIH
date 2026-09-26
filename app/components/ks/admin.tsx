"use client";

/** Helpers shared by the staff pages. */

import { useCallback, useEffect, useState } from "react";
import { DISTRICTS } from "../../../lib/livelihood/catalog";
import { api } from "./ui";
import { useStaff } from "./StaffShell";
import { Skeleton } from "./skeleton";

export { CardSkeleton, ListSkeleton, Skeleton, StatsSkeleton, TableRowsSkeleton } from "./skeleton";

/**
 * Load JSON from an API route, with a reload() for after a change.
 * `loading` is true while a request is in flight — the first load (no data
 * yet: show a skeleton) and later ones after a filter change (data is stale).
 */
export function useJson<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Which request the current data answers; loading until it is the latest one.
  const key = url ? `${url}#${version}` : null;
  const [doneKey, setDoneKey] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    api<T>(url).then((r) => {
      if (cancelled) return;
      setData(r.ok ? r.data : null);
      setError(r.ok ? null : r.data.error ?? `Failed (${r.status})`);
      setDoneKey(`${url}#${version}`);
    });

    // A newer request (filters changed) supersedes this one.
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload, loading: key !== null && doneKey !== key };
}

/** Content being refreshed (filter changed): keep it in place, dimmed, until the new data lands. */
export function Refreshing({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <div aria-busy={busy} className={`transition-opacity duration-200 ${busy ? "pointer-events-none opacity-50" : ""}`}>
      {children}
    </div>
  );
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

export function PageTitle({ title, sub, right, loading }: { title: string; sub?: string; right?: React.ReactNode; loading?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          {title}
          {loading && (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs font-normal text-[var(--text-muted)]">
              <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--ks-primary)]" />
              Loading…
            </span>
          )}
        </h1>
        {loading && !sub ? <Skeleton className="mt-1.5 h-3 w-48" /> : sub && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</p>}
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
