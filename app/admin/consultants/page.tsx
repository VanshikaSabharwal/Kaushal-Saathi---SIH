"use client";

/**
 * Financial consultants: registry, officer verification, live load and a
 * performance score from real outcomes (loans sanctioned, businesses running).
 */

import { useState } from "react";
import { FiCheck } from "react-icons/fi";
import { getDistrict } from "../../../lib/livelihood/catalog";
import type { ConsultantRecord, ConsultantScore } from "../../../lib/store/consultants";
import { DistrictPicker, ErrorNote, PageTitle, useDistrict, useJson } from "../../components/ks/admin";
import { useStaff } from "../../components/ks/StaffShell";
import { api, Button, Card } from "../../components/ks/ui";

type Row = ConsultantRecord & { performance: ConsultantScore };

export default function ConsultantsPage() {
  const user = useStaff();
  const officer = ["ministry", "state", "district"].includes(user?.role ?? "");
  const [district, setDistrict, options] = useDistrict();
  const { data, error, reload } = useJson<{ consultants: Row[] }>(`/api/consultants${district ? `?district=${district}` : ""}`);
  const [form, setForm] = useState({ name: "", phone: "", blocks: "", specialisations: "dpr, mudra", capacity: "20", district: "" });
  const [msg, setMsg] = useState<string | null>(null);

  async function verify(id: string, verified: boolean) {
    await api("/api/consultants/verify", { body: { id, verified } });
    void reload();
  }

  async function register() {
    const r = await api("/api/consultants", {
      body: {
        name: form.name,
        phone: form.phone,
        district: form.district || district || user?.district,
        blocks: form.blocks.split(",").map((s) => s.trim()).filter(Boolean),
        specialisations: form.specialisations.split(",").map((s) => s.trim()).filter(Boolean),
        capacity: Number(form.capacity),
      },
    });
    setMsg(r.ok ? "Registered — verify to start matching." : r.data.error ?? "Failed.");
    if (r.ok) {
      setForm({ ...form, name: "", phone: "", blocks: "" });
      void reload();
    }
  }

  const field = "rounded-lg border border-[var(--border-strong)] bg-white px-2 py-1.5 text-sm";

  return (
    <div className="space-y-5">
      <PageTitle title="Financial consultants" sub="Only verified consultants with free capacity are matched to new self-employment cases." right={<DistrictPicker value={district} onChange={setDistrict} options={options} />} />
      <ErrorNote error={error} />

      <Card className="overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2">Name</th><th>District · blocks</th><th>Specialises in</th><th>Load</th>
              <th>Cases</th><th>Loans sanctioned / rejected</th><th>Running</th><th>Score</th><th>Verified</th>
            </tr>
          </thead>
          <tbody>
            {(data?.consultants ?? []).map((c) => (
              <tr key={c.id} className="border-b border-[var(--border)]">
                <td className="px-3 py-2 font-medium">{c.name}{c.sample && <span className="text-xs text-[var(--text-subtle)]"> (sample)</span>}</td>
                <td className="text-xs">{getDistrict(c.district)?.name} · {c.blocks.join(", ") || "—"}</td>
                <td className="text-xs">{c.specialisations.join(", ")}</td>
                <td className={`text-xs ${c.activeCases >= c.capacity ? "text-[var(--danger)]" : ""}`}>{c.activeCases}/{c.capacity}</td>
                <td>{c.performance.cases}</td>
                <td>{c.performance.loansSanctioned}/{c.performance.loansRejected}</td>
                <td>{c.performance.businessesRunning}</td>
                <td>{c.performance.score ?? <span className="text-xs text-[var(--text-subtle)]">needs 3+ cases</span>}</td>
                <td>
                  {officer ? (
                    <Button variant={c.verified ? "ghost" : "primary"} onClick={() => verify(c.id, !c.verified)}>{c.verified ? <span className="inline-flex items-center gap-1"><FiCheck aria-hidden /> Verified</span> : "Verify"}</Button>
                  ) : c.verified ? <FiCheck aria-label="verified" /> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {officer && (
        <Card title="Register a consultant">
          <div className="grid gap-2 md:grid-cols-3">
            <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={field} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {!user?.district && (
              <select className={field} value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })}>
                <option value="">District…</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <input className={field} placeholder="Blocks (comma separated, e.g. Moth, Babina)" value={form.blocks} onChange={(e) => setForm({ ...form, blocks: e.target.value })} />
            <input className={field} placeholder="Specialisations (dpr, mudra, nsfdc…)" value={form.specialisations} onChange={(e) => setForm({ ...form, specialisations: e.target.value })} />
            <input className={field} placeholder="Capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button disabled={!form.name.trim()} onClick={register}>Register</Button>
            {msg && <span className="text-xs">{msg}</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
