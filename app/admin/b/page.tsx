"use client";

/**
 * One beneficiary: what they said, what was recommended and why (with the
 * completion model's estimate), what happened since, and the actions this
 * role may take.
 */

import { Suspense, useState } from "react";
import { FiArrowDown, FiArrowUp, FiCheckCircle } from "react-icons/fi";
import { useSearchParams } from "next/navigation";
import { CENTRES, CONSULTANTS, getCourse, getDistrict, skillLabel, TRADES } from "../../../lib/livelihood/catalog";
import type { Beneficiary } from "../../../lib/store/beneficiaries";
import type { Task } from "../../../lib/store/tasks";
import { ErrorNote, PageTitle, useJson } from "../../components/ks/admin";
import { useStaff } from "../../components/ks/StaffShell";
import { api, Button, Card, fmtDate, fmtDateTime, STATUS_EN, StatusPill } from "../../components/ks/ui";

const SETTABLE: Record<string, string[]> = {
  ministry: Object.keys(STATUS_EN),
  state: Object.keys(STATUS_EN),
  district: Object.keys(STATUS_EN),
  centre: ["enrolled", "training", "certified", "dropped"],
  saathi: ["placed", "self_employed", "dropped"],
  consultant: [],
};

function Detail() {
  const id = useSearchParams().get("id") ?? "";
  const user = useStaff();
  const { data, error, reload } = useJson<{ beneficiary: Beneficiary }>(id ? `/api/beneficiaries?id=${id}` : null);
  const tasks = useJson<{ tasks: Task[] }>(id ? `/api/tasks?beneficiaryId=${id}&status=open` : null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const b = data?.beneficiary;
  if (!b) return <><ErrorNote error={error} /><p className="text-sm text-[var(--text-muted)]">{error ? "" : "Loading…"}</p></>;

  const p = b.profile;
  const role = user?.role ?? "consultant";
  const officer = ["ministry", "state", "district"].includes(role);

  async function act(url: string, body: Record<string, unknown>, done: string) {
    const r = await api(url, { body });
    setMsg(r.ok ? done : r.data.error ?? "Failed.");
    if (r.ok) {
      void reload();
      void tasks.reload();
    }
  }

  async function viewCertificate() {
    const r = await api<{ contentType: string; dataBase64: string }>(`/api/beneficiaries/certificate?id=${b!.id}`);
    if (!r.ok) return setMsg(r.data.error ?? "No certificate.");
    const blob = await (await fetch(`data:${r.data.contentType};base64,${r.data.dataBase64}`)).blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  async function followUpCall() {
    if (!b!.phone) return setMsg("No phone number on this record.");
    const r = await api("/api/calls/outbound", { body: { to: b!.phone, agentId: "kaushal-saathi", purpose: "followup", beneficiaryId: b!.id } });
    setMsg(r.ok ? "Follow-up call placed. Answer it from the call harness (or it rings once telephony is connected)." : r.data.error ?? "Failed.");
  }

  const rows: [string, string][] = [
    ["Place", [b.block, getDistrict(b.district ?? "")?.name].filter(Boolean).join(", ")],
    ["Language", p.language === "mr" ? "Marathi" : "Hindi"],
    ["Education", p.education !== undefined ? `${p.education} years` : "—"],
    ["Current work", p.currentWork ? `${TRADES[p.currentWork]?.hi} (${p.currentWork})` : "—"],
    ["Family trade", p.familyTrade ? `${TRADES[p.familyTrade]?.hi} (${p.familyTrade})${p.continueFamilyTrade === false ? " — wants something new" : p.continueFamilyTrade ? " — wants to continue" : ""}` : "—"],
    ["Interests", p.interestSectors?.join(", ") || "—"],
    ["Preference", p.preference ?? "—"],
    ["Travel", p.canRelocate ? "can relocate" : p.maxTravelKm ? `${p.maxTravelKm} km` : "—"],
    ["Hours/day", p.hoursPerDay ? String(p.hoursPerDay) : "—"],
    ["Learning", p.learning ?? "—"],
    ["Family support", p.familySupport === undefined ? "—" : p.familySupport ? "yes" : "no"],
    ["Constraints", p.constraints?.join(", ") || "none"],
    ["Assets", p.assets?.join(", ") || "none"],
    ["Gender (inferred)", p.gender ?? "—"],
    ["Aspiration", p.aspiration?.goal ? `${p.aspiration.goal}${p.aspiration.targetMonthlyIncome ? ` (₹${p.aspiration.targetMonthlyIncome}/month)` : ""}` : "—"],
  ];

  const hasFollowUp = (tasks.data?.tasks ?? []).some((t) => t.type === "follow_up");

  return (
    <div className="space-y-5">
      <PageTitle title={b.phone ?? `Anonymous ${b.id.slice(0, 6)}`} sub={`Record ${b.id} · created ${fmtDate(b.createdAt)} · ${b.callIds.length} conversation(s)`} right={<StatusPill status={b.status} />} />
      <ErrorNote error={msg && !msg.startsWith("Follow") && msg !== "Saved." ? msg : null} />
      {msg && (msg.startsWith("Follow") || msg === "Saved.") && <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-xs text-[var(--success)]">{msg}</p>}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Profile (from the conversation)" className="xl:col-span-1">
          <dl className="space-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-[var(--border)] pb-1">
                <dt className="text-[var(--text-muted)]">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {b.flags.length > 0 && <p className="mt-3 text-xs text-[var(--warning)]">Flags: {b.flags.join(", ")}</p>}
        </Card>

        <div className="space-y-5 xl:col-span-2">
          <Card title="Recommendations">
            {b.recommendations.length === 0 && <p className="text-sm text-[var(--text-muted)]">Interview not finished yet.</p>}
            <ul className="space-y-3">
              {b.recommendations.map((r) => {
                const c = getCourse(r.courseId);
                const centre = CENTRES.find((x) => x.id === r.centreId);
                const consultant = CONSULTANTS.find((x) => x.id === r.consultantId);
                const chosen = b.chosen?.courseId === r.courseId;
                return (
                  <li key={r.courseId} className={`rounded-xl border p-3 text-sm ${chosen ? "border-[var(--success)] bg-[var(--success-soft)]" : "border-[var(--border)]"}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">{c?.name} <span className="font-normal text-[var(--text-muted)]">NSQF {c?.nsqfLevel} · {c?.durationDays} days · {c?.mode.replace("_", "-")}</span>{chosen && <span className="ml-1 inline-flex items-center gap-1 text-[var(--success)]"><FiCheckCircle aria-hidden /> chosen</span>}</p>
                      <span className="text-xs tabular-nums">score {r.score}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{centre?.name} · {r.distanceKm} km{consultant ? ` · consultant ${consultant.name}` : ""}</p>
                    <p className="mt-1 text-xs">Why: {r.reasons.join(", ")}</p>
                    {r.completion && (
                      <p className="mt-1 text-xs">
                        Likely to finish: <b>{Math.round(r.completion.p * 100)}%</b>{" "}
                        <span className="text-[var(--text-muted)]">
                          ({r.completion.factors.map((f, k) => (
                            <span key={k} className="mr-2 inline-flex items-center gap-0.5">
                              {f.direction === "up" ? <FiArrowUp aria-label="raises" /> : <FiArrowDown aria-label="lowers" />} {f.en}
                            </span>
                          ))})
                        </span>
                      </p>
                    )}
                    <p className="mt-1 text-xs">Has: {r.have.map((s) => skillLabel(s, "en")).join(", ") || "—"}</p>
                    <p className="text-xs">Needs: {r.need.map((s) => skillLabel(s, "en")).join(", ")}{r.rpl ? " · RPL route suggested" : ""}</p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Actions">
            <div className="grid gap-4 md:grid-cols-2">
              {SETTABLE[role].length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Change status</p>
                  <div className="flex gap-2">
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className="flex-1 rounded-lg border border-[var(--border-strong)] px-2 py-1.5 text-sm">
                      <option value="">Choose…</option>
                      {SETTABLE[role].map((s) => <option key={s} value={s}>{STATUS_EN[s]}</option>)}
                    </select>
                    <Button disabled={!status} onClick={() => act("/api/beneficiaries/status", { id: b.id, status, note: note || undefined }, "Saved.")}>Set</Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--text-muted)]">Add a note to the timeline</p>
                <div className="flex gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="flex-1 rounded-lg border border-[var(--border-strong)] px-2 py-1.5 text-sm" />
                  <Button variant="ghost" disabled={!note.trim()} onClick={() => act("/api/beneficiaries/note", { id: b.id, note }, "Saved.")}>Add</Button>
                </div>
              </div>

              {b.certificate && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Certificate ({b.certificate.verified ? "verified" : "awaiting verification"})</p>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={viewCertificate}>View</Button>
                    {officer && !b.certificate.verified && <Button onClick={() => act("/api/beneficiaries/verify-certificate", { id: b.id }, "Saved.")}>Verify</Button>}
                  </div>
                </div>
              )}

              {(officer || role === "consultant") && b.chosen?.consultantId && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Loan decision</p>
                  <div className="flex gap-2">
                    <Button onClick={() => act("/api/consultants/loan", { beneficiaryId: b.id, sanctioned: true }, "Saved.")}>Sanctioned</Button>
                    <Button variant="ghost" onClick={() => act("/api/consultants/loan", { beneficiaryId: b.id, sanctioned: false }, "Saved.")}>Rejected</Button>
                  </div>
                </div>
              )}

              {hasFollowUp && ["ministry", "state", "district", "saathi"].includes(role) && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Placement follow-up</p>
                  <Button onClick={followUpCall}>Place follow-up call</Button>
                </div>
              )}
            </div>
          </Card>

          <Card title="Open tasks">
            <ul className="space-y-1 text-sm">
              {(tasks.data?.tasks ?? []).map((t) => (
                <li key={t.id} className="flex justify-between gap-2 border-b border-[var(--border)] pb-1">
                  <span><b className="capitalize">{t.type.replace("_", " ")}</b> — {t.reason}</span>
                  <span className={`text-xs ${t.dueAt < now ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>due {fmtDate(t.dueAt)}</span>
                </li>
              ))}
              {(tasks.data?.tasks ?? []).length === 0 && <li className="text-xs text-[var(--text-muted)]">None.</li>}
            </ul>
          </Card>

          <Card title="Timeline (everyone's actions)">
            <ol className="space-y-1.5 text-sm">
              {[...b.timeline].reverse().map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-32 shrink-0 text-xs text-[var(--text-muted)]">{fmtDateTime(t.at)}</span>
                  <span className="w-20 shrink-0 text-xs capitalize text-[var(--text-subtle)]">{t.by}</span>
                  <span>
                    <b>{t.type.replace(/_/g, " ")}</b>
                    {t.note ? ` — ${t.note}` : ""}
                    {t.data ? <span className="text-xs text-[var(--text-muted)]"> {JSON.stringify(t.data)}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DetailPage() {
  return (
    <Suspense fallback={null}>
      <Detail />
    </Suspense>
  );
}
