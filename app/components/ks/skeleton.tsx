/** Loading placeholders, shaped like what they stand in for so nothing jumps when the data lands. */

/** One grey block. Size it with className (h-*, w-*). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-[var(--border)] ${className}`} />;
}

/** A row of stat tiles. */
export function StatsSkeleton({ count = 4, className = "grid grid-cols-2 gap-3 md:grid-cols-4" }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-[var(--border)] bg-white p-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

/** A card with a title and a few bar-chart rows or text lines. */
export function CardSkeleton({ rows = 5, variant = "bars", className = "" }: { rows?: number; variant?: "bars" | "lines"; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <Skeleton className="mb-4 h-4 w-40" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, i) =>
          variant === "bars" ? (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-32 shrink-0" />
              <Skeleton className="h-3 flex-1 rounded-full" />
              <Skeleton className="h-3 w-8" />
            </div>
          ) : (
            <Skeleton key={i} className={`h-3.5 ${["w-full", "w-5/6", "w-2/3", "w-3/4"][i % 4]}`} />
          ),
        )}
      </div>
    </section>
  );
}

/** Table body rows while a table loads; goes inside <tbody>. */
export function TableRowsSkeleton({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden className="border-b border-[var(--border)]">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-3 py-3">
              <Skeleton className={`h-3.5 ${c === 0 ? "w-28" : ["w-24", "w-16", "w-32", "w-20"][(r + c) % 4]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Stacked list items (cards or rows) while a list loads. */
export function ListSkeleton({ rows = 4, card = false }: { rows?: number; card?: boolean }) {
  return (
    <div className={card ? "space-y-2" : "divide-y divide-[var(--border)]"}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className={`flex items-center justify-between gap-3 ${card ? "rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5" : "py-3"}`}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className={`h-3 ${i % 2 ? "w-2/3" : "w-1/2"}`} />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
