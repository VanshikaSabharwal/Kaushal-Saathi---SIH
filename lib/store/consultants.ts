/**
 * The financial consultant registry: who is registered, who an officer has
 * verified, how loaded they are, and how their cases turn out.
 *
 * The score is what makes "identification of trained and skilled financial
 * consultants" (a GIA issue in the problem statement) a measurement rather
 * than a list: loans actually sanctioned, and businesses still running.
 */

import { CONSULTANTS } from "../livelihood/catalog";
import type { Consultant, Language } from "../livelihood/types";
import { beneficiaries } from "./beneficiaries";
import { createCollection } from "./collection";
import { tasks } from "./tasks";

export type ConsultantRecord = Consultant & {
  phone?: string;
  certifications: string[];
  verifiedBy?: string;
  createdAt: number;
};

export type ConsultantScore = {
  cases: number;
  loansSanctioned: number;
  loansRejected: number;
  businessesRunning: number;
  /** 0–100 once there are enough cases to judge; null before. */
  score: number | null;
};

export const consultants = createCollection<ConsultantRecord>("consultants");

const MIN_CASES_FOR_SCORE = 3;

/** First boot: the shipped sample list becomes the editable registry. */
export async function seedConsultants(): Promise<void> {
  if ((await consultants.list({}, { limit: 1 })).length > 0) return;

  for (const c of CONSULTANTS) {
    await consultants.upsert({ ...c, certifications: [], createdAt: Date.now() });
  }
}

/** The registry with live load: open cases counted from the task queue. */
export async function liveRegistry(): Promise<ConsultantRecord[]> {
  const [all, open] = await Promise.all([
    consultants.list({}, { limit: 5000 }),
    tasks.list({ type: "consult", status: "open" }, { limit: 50000 }),
  ]);

  const load = new Map<string, number>();
  for (const t of open) {
    const id = t.data?.consultantId as string | undefined;
    if (id) load.set(id, (load.get(id) ?? 0) + 1);
  }

  // Stored activeCases is caseload from outside this system (the sample
  // data's existing clients); open consult tasks are ours on top of it.
  return all.map((c) => ({ ...c, activeCases: c.activeCases + (load.get(c.id) ?? 0) }));
}

export async function scoreOf(consultantId: string): Promise<ConsultantScore> {
  const cases = (await beneficiaries.list({}, { limit: 100000 })).filter(
    (b) => b.chosen?.consultantId === consultantId,
  );

  const loansSanctioned = cases.filter((b) => b.timeline.some((t) => t.type === "loan" && t.data?.sanctioned === true)).length;
  const loansRejected = cases.filter((b) => b.timeline.some((t) => t.type === "loan" && t.data?.sanctioned === false)).length;
  const businessesRunning = cases.filter((b) => b.status === "self_employed" || b.status === "retained").length;

  const score =
    cases.length >= MIN_CASES_FOR_SCORE
      ? Math.round(100 * (0.5 * (loansSanctioned / cases.length) + 0.5 * (businessesRunning / cases.length)))
      : null;

  return { cases: cases.length, loansSanctioned, loansRejected, businessesRunning, score };
}

export async function registerConsultant(input: {
  id: string;
  name: string;
  district: string;
  blocks: string[];
  languages: Language[];
  specialisations: string[];
  capacity: number;
  phone?: string;
  certifications?: string[];
}): Promise<ConsultantRecord> {
  const record: ConsultantRecord = {
    ...input,
    certifications: input.certifications ?? [],
    // New registrations are never matched until an officer verifies them.
    verified: false,
    activeCases: 0,
    sample: false,
    createdAt: Date.now(),
  };

  await consultants.upsert(record);
  return record;
}
