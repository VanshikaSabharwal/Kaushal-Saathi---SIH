"use client";

/**
 * The Saathi's desk: register someone in a few seconds, hand them the phone
 * for the voice interview (recorded against their record), and work the
 * call-back queue — the ground-level support the problem statement asks for.
 */

import Link from "next/link";
import { useState } from "react";
import { getDistrict } from "../../lib/livelihood/catalog";
import type { Beneficiary } from "../../lib/store/beneficiaries";
import type { Task } from "../../lib/store/tasks";
import { ErrorNote, PageTitle, useJson } from "../components/ks/admin";
import { useStaff } from "../components/ks/StaffShell";
import VoiceTalk from "../components/ks/VoiceTalk";
import { api, Button, Card, fmtDate } from "../components/ks/ui";

export default function SaathiDesk() {
  const user = useStaff();
  const district = getDistrict(user?.district ?? "");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [block, setBlock] = useState("");
  const [person, setPerson] = useState<Beneficiary | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const queue = useJson<{ tasks: Task[] }>("/api/tasks?type=callback&status=open");

  async function register() {
    const r = await api<{ beneficiary: Beneficiary; existing: boolean }>("/api/beneficiaries", {
      body: { phone, name, district: user?.district, block: block || undefined },
    });
    if (!r.ok) return setMsg(r.data.error ?? "Failed.");
    setPerson(r.data.beneficiary);
    setMsg(r.data.existing ? "Already registered — continuing their record." : "Registered.");
  }

  async function ticket(): Promise<string | undefined> {
    if (!person) return undefined;
    const r = await api<{ ticket: string }>("/api/beneficiaries/call-token", { body: { id: person.id } });
    return r.ok ? r.data.ticket : undefined;
  }

  async function done(id: string) {
    await api("/api/tasks/status", { body: { id, status: "done" } });
    void queue.reload();
  }

  const field = "min-h-11 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-base";

  return (
    <div className="space-y-5">
      <PageTitle title="Saathi desk" sub={district ? `${district.name} · register, interview, call back` : undefined} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="1. Quick register">
          <div className="space-y-2">
            <input className={`${field} w-full`} inputMode="numeric" placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className={`${field} w-full`} placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            {district && (
              <select className={`${field} w-full`} value={block} onChange={(e) => setBlock(e.target.value)}>
                <option value="">Block (optional)</option>
                {district.blocks.map((b) => <option key={b.name} value={b.name}>{b.name} · {b.nameHi}</option>)}
              </select>
            )}
            <Button className="w-full py-2.5" disabled={phone.replace(/\D/g, "").length < 10} onClick={register}>Register</Button>
            {msg && <p className="text-sm">{msg}</p>}
          </div>
        </Card>

        <Card title="2. Hand over the phone — voice interview">
          {person ? (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                Talking as <b>{person.phone}</b>. <Link href={`/admin/b?id=${person.id}`} className="underline">Open record</Link>
              </p>
              <VoiceTalk key={person.id} getTicket={ticket} />
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Register someone first; the conversation is saved to their record.</p>
          )}
        </Card>
      </div>

      <Card title="Call-back queue">
        <ErrorNote error={queue.error} />
        <ul className="divide-y divide-[var(--border)]">
          {(queue.data?.tasks ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <b>{t.reason}</b> · {t.block ?? ""} · due {fmtDate(t.dueAt)}
              </span>
              <span className="flex gap-2">
                <Link href={`/admin/b?id=${t.beneficiaryId}`} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5">Open</Link>
                <Button onClick={() => done(t.id)}>Called</Button>
              </span>
            </li>
          ))}
          {queue.data && queue.data.tasks.length === 0 && <li className="py-4 text-center text-xs text-[var(--text-muted)]">No one waiting.</li>}
        </ul>
      </Card>
    </div>
  );
}
