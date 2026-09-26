/**
 * Who may see and change what.
 *
 * The Next app turns a signed session into scope headers on every request to
 * the voice server (app/lib/voice-proxy.ts); the voice server applies them
 * here. A request with no scope is internal (the voice server's own work, the
 * verify scripts) — which is why, in production, INTERNAL_TOKEN must be set so
 * that only the Next app can reach the control plane at all.
 */

import type { IncomingMessage } from "node:http";
import { DISTRICTS } from "../livelihood/catalog";
import type { Beneficiary, BeneficiaryStatus } from "./beneficiaries";
import type { Task } from "./tasks";

export type Scope = {
  role:
    | "ministry"
    | "state"
    | "district"
    | "saathi"
    | "centre"
    | "consultant"
    | "beneficiary"
    | "internal";
  state?: string;
  district?: string;
  centreId?: string;
  consultantId?: string;
  beneficiaryId?: string;
};

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return typeof v === "string" && v ? v : undefined;
};

export function scopeFrom(req: IncomingMessage): Scope {
  const role = header(req, "x-scope-role") as Scope["role"] | undefined;
  if (!role) return { role: "internal" };

  return {
    role,
    state: header(req, "x-scope-state"),
    district: header(req, "x-scope-district"),
    centreId: header(req, "x-scope-centre"),
    consultantId: header(req, "x-scope-consultant"),
    beneficiaryId: header(req, "x-scope-beneficiary"),
  };
}

/** Is the control-plane request allowed at all? */
export function authorised(req: IncomingMessage): boolean {
  const expected = process.env.INTERNAL_TOKEN?.trim();
  return !expected || header(req, "x-internal-token") === expected;
}

function districtsOfState(state?: string): string[] {
  return DISTRICTS.filter((d) => d.state === state).map((d) => d.id);
}

export function canSee(scope: Scope, b: Beneficiary): boolean {
  switch (scope.role) {
    case "internal":
    case "ministry":
      return true;
    case "state":
      return districtsOfState(scope.state).includes(b.district ?? "");
    case "district":
    case "saathi":
      return b.district === scope.district;
    case "centre":
      return b.chosen?.centreId === scope.centreId;
    case "consultant":
      return b.chosen?.consultantId === scope.consultantId;
    case "beneficiary":
      return b.id === scope.beneficiaryId;
  }
}

export function canSeeTask(scope: Scope, t: Task): boolean {
  switch (scope.role) {
    case "internal":
    case "ministry":
      return true;
    case "state":
      return districtsOfState(scope.state).includes(t.district ?? "");
    case "district":
    case "saathi":
      return t.district === scope.district;
    case "centre":
      return t.owner === "centre" && t.data?.centreId === scope.centreId;
    case "consultant":
      return t.owner === "consultant" && t.data?.consultantId === scope.consultantId;
    case "beneficiary":
      return t.beneficiaryId === scope.beneficiaryId;
  }
}

/** The statuses each role may set. Officers any; a centre only its own steps. */
export function canSetStatus(scope: Scope, status: BeneficiaryStatus): boolean {
  switch (scope.role) {
    case "internal":
    case "ministry":
    case "state":
    case "district":
      return true;
    case "centre":
      return ["enrolled", "training", "certified", "dropped"].includes(status);
    case "saathi":
      return ["placed", "self_employed", "dropped"].includes(status);
    default:
      return false;
  }
}

/** Mapping dialect words is fieldwork: officers and Saathis. */
export function canTeachWords(scope: Scope): boolean {
  return ["internal", "ministry", "state", "district", "saathi"].includes(scope.role);
}

/** Which actor a scoped write is recorded as, whatever the client claims. */
export function actorOf(scope: Scope): "officer" | "saathi" | "centre" | "consultant" | "beneficiary" | undefined {
  switch (scope.role) {
    case "ministry":
    case "state":
    case "district":
      return "officer";
    case "saathi":
    case "centre":
    case "consultant":
    case "beneficiary":
      return scope.role;
    default:
      return undefined;
  }
}
