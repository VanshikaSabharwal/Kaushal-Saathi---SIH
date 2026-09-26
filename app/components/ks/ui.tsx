"use client";

/**
 * Small shared pieces for the Kaushal Saathi screens: cards, pills, buttons.
 */


export const STATUS_HI: Record<string, string> = {
  profiling: "बातचीत अधूरी",
  recommended: "कोर्स बताए गए",
  interested: "कोर्स चुना",
  enrolled: "दाखिला हुआ",
  training: "ट्रेनिंग चल रही",
  certified: "प्रमाणपत्र मिला",
  placed: "नौकरी मिली",
  self_employed: "अपना काम शुरू",
  retained: "काम पर टिके",
  dropped: "बीच में छोड़ा",
};

export const STATUS_EN: Record<string, string> = {
  profiling: "Profiling",
  recommended: "Recommended",
  interested: "Interested",
  enrolled: "Enrolled",
  training: "Training",
  certified: "Certified",
  placed: "Placed",
  self_employed: "Self-employed",
  retained: "Retained (90 d)",
  dropped: "Dropped",
};

/** The pipeline shown as a stepper. */
export const PIPELINE = ["interested", "enrolled", "training", "certified", "placed"] as const;

export function pipelineIndex(status: string): number {
  if (status === "self_employed" || status === "retained") return PIPELINE.length - 1;
  return PIPELINE.indexOf(status as (typeof PIPELINE)[number]);
}

export function StatusPill({ status, lang = "en" }: { status: string; lang?: "en" | "hi" }) {
  const tone =
    status === "dropped"
      ? "bg-[var(--danger-soft)] text-[var(--danger)]"
      : ["placed", "self_employed", "retained", "certified"].includes(status)
        ? "bg-[var(--success-soft)] text-[var(--success)]"
        : status === "profiling"
          ? "bg-[var(--surface-muted)] text-[var(--text-muted)]"
          : "bg-[var(--ks-primary-soft)] text-[var(--ks-primary)]";

  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {(lang === "hi" ? STATUS_HI : STATUS_EN)[status] ?? status}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "good" }) {
  const color = tone === "warn" ? "text-[var(--warning)]" : tone === "good" ? "text-[var(--success)]" : "";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-3">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  big,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "accent"; big?: boolean }) {
  const styles = {
    primary: "bg-[var(--ks-primary)] text-white hover:opacity-90",
    accent: "bg-[var(--ks-accent)] text-[#1e2139] hover:opacity-90",
    ghost: "border border-[var(--border-strong)] bg-white hover:bg-[var(--surface-muted)]",
    danger: "bg-[var(--danger)] text-white hover:opacity-90",
  }[variant];

  return (
    <button
      {...rest}
      className={`cursor-pointer rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        big ? "min-h-14 px-6 py-3 text-lg" : "px-3 py-1.5 text-sm"
      } ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function fmtDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(ms?: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** fetch JSON with the error message surfaced, for simple pages. */
export async function api<T = Record<string, unknown>>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}
