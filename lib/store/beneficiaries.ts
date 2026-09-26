/**
 * Beneficiary records: who someone is, what they were recommended, what they
 * chose, and everything that has happened since, as one timeline.
 *
 * The interview writes here after every turn, so a dropped call loses nothing
 * and the person can pick up where they left off. Officers, Saathis and
 * centres add to the same timeline, which is what lets each of them see the
 * others' work — the coordination problem the problem statement names.
 */

import { randomUUID } from "node:crypto";
import type { SlotId } from "../livelihood/extract";
import type { InterviewEvent, InterviewState, Stage } from "../livelihood/interview";
import type { Profile } from "../livelihood/types";
import { createCollection } from "./collection";
import type { FollowupEvent } from "../livelihood/followup";
import type { HelpdeskEvent } from "../livelihood/helpdesk";
import { openTask, setTaskStatus, tasks, type Actor } from "./tasks";
import { recordUnknown } from "./unknown-words";

/** The pipeline, in order. Placement and retention come after certification. */
export const STATUSES = [
  "profiling",
  "recommended",
  "interested",
  "enrolled",
  "training",
  "certified",
  "placed",
  "self_employed",
  "retained",
] as const;

export type BeneficiaryStatus = (typeof STATUSES)[number] | "dropped";

export type TimelineEntry = {
  at: number;
  type: string;
  by: Actor;
  note?: string;
  data?: Record<string, unknown>;
};

export type SavedRecommendation = {
  courseId: string;
  centreId: string;
  score: number;
  distanceKm: number;
  reasons: string[];
  have: string[];
  need: string[];
  rpl: boolean;
  consultantId?: string;
  /** The model's estimate of finishing, with the factors behind it. */
  completion?: { p: number; factors: { en: string; direction: "up" | "down" }[] };
};

export type Beneficiary = {
  id: string;
  phone?: string;
  createdAt: number;
  updatedAt: number;
  district?: string;
  block?: string;
  language: Profile["language"];
  profile: Partial<Profile>;
  status: BeneficiaryStatus;
  /** Where the interview got to — enough to resume it on the next call. */
  interview: { stage: Stage; answered: SlotId[]; llmCalls: number };
  recommendations: SavedRecommendation[];
  chosen?: { courseId: string; centreId: string; consultantId?: string; at: number };
  /** When certification was recorded — the clock for follow-ups and the 60-day check. */
  certifiedAt?: number;
  /** Uploaded certificate, awaiting or past officer verification. */
  certificate?: { file: string; contentType: string; uploadedAt: number; verified: boolean };
  timeline: TimelineEntry[];
  callIds: string[];
  /** Quality signals for the Flagged calls view. */
  flags: string[];
};

export const beneficiaries = createCollection<Beneficiary>("beneficiaries", { max: 5000 });

const rank = (s: BeneficiaryStatus) => STATUSES.indexOf(s as (typeof STATUSES)[number]);

/**
 * Move forward only.
 *
 * Someone already certified who calls again and says "I'm interested" in a
 * new course must not be dragged back to "interested" by the bot. Officers
 * can set any status explicitly (setStatus), the bot cannot.
 */
function advance(current: BeneficiaryStatus, next: BeneficiaryStatus): BeneficiaryStatus {
  if (current === "dropped") return next;
  return rank(next) > rank(current) ? next : current;
}

export function newBeneficiary(input: { phone?: string; language?: Profile["language"] }): Beneficiary {
  const now = Date.now();
  return {
    id: randomUUID(),
    phone: input.phone,
    createdAt: now,
    updatedAt: now,
    language: input.language ?? "hi",
    profile: {},
    status: "profiling",
    interview: { stage: "consent", answered: [], llmCalls: 0 },
    recommendations: [],
    timeline: [],
    callIds: [],
    flags: [],
  };
}

export async function getByPhone(phone: string): Promise<Beneficiary | null> {
  return beneficiaries.findOne({ phone });
}

/** Attach a call to a beneficiary, creating the record on first contact. */
export async function startCallFor(
  id: string,
  callId: string,
  seed: Beneficiary,
): Promise<Beneficiary | null> {
  return beneficiaries.update(id, (b) => {
    const doc = b ?? seed;
    return {
      ...doc,
      updatedAt: Date.now(),
      callIds: [...doc.callIds, callId],
      timeline: [...doc.timeline, { at: Date.now(), type: "call_started", by: "beneficiary", data: { callId } }],
    };
  });
}

const flag = (b: Beneficiary, f: string) => (b.flags.includes(f) ? b.flags : [...b.flags, f]);

/**
 * Fold one interview step into the record, then raise whatever follow-up work
 * it implies. Called after every turn; cheap when nothing new happened.
 */
export async function applyInterviewEvents(
  id: string,
  events: InterviewEvent[],
  state: InterviewState,
): Promise<Beneficiary | null> {
  const now = Date.now();

  const updated = await beneficiaries.update(id, (b) => {
    if (!b) return null;

    const next: Beneficiary = {
      ...b,
      updatedAt: now,
      // Merged, not replaced: a new course search in the help desk starts a
      // fresh interview, and must not erase what an earlier one learned.
      profile: { ...b.profile, ...state.profile },
      district: state.profile.district ?? b.district,
      block: state.profile.block ?? b.block,
      interview: { stage: state.stage, answered: state.answered, llmCalls: state.llmCalls },
      timeline: [...b.timeline],
    };

    if (state.stage === "summary" && b.interview.stage === "slot") {
      next.timeline.push({ at: now, type: "profile_completed", by: "bot" });
    }

    for (const e of events) {
      switch (e.type) {
        case "recommended":
          next.status = advance(next.status, "recommended");
          next.recommendations = state.shown.map((r) => ({
            courseId: r.course.id,
            centreId: r.centre.id,
            score: r.score,
            distanceKm: r.distanceKm,
            reasons: r.reasons.map((x) => x.code),
            have: r.skillGap.have,
            need: r.skillGap.need,
            rpl: r.skillGap.rpl,
            consultantId: r.consultant?.id,
            completion: r.completion && {
              p: r.completion.p,
              factors: r.completion.factors.map((f) => ({ en: f.en, direction: f.direction })),
            },
          }));
          next.timeline.push({ at: now, type: "recommended", by: "bot", data: { courseIds: e.courseIds } });
          break;

        case "interest": {
          const rec = state.shown.find((r) => r.course.id === e.courseId);
          next.status = advance(next.status, "interested");
          next.chosen = {
            courseId: e.courseId,
            centreId: e.centreId,
            consultantId: rec?.consultant?.id,
            at: now,
          };
          next.timeline.push({ at: now, type: "interested", by: "beneficiary", data: { ...e } });
          break;
        }

        case "handoff":
          next.flags = flag(next, "handoff");
          next.timeline.push({ at: now, type: "handoff", by: "bot", note: e.reason });
          break;

        case "unknown":
          next.flags = flag(next, "misheard");
          break;

        case "profile":
          break;
      }
    }

    if (state.llmCalls > 0) next.flags = flag(next, "llm_used");

    return next;
  });

  if (!updated) return null;

  // Follow-up work lives in the task queue, where someone owns it.
  for (const e of events) {
    if (e.type === "handoff") {
      await openTask({
        type: "callback",
        beneficiaryId: id,
        reason: e.reason,
        district: updated.district,
        block: updated.block,
      });
    }

    if (e.type === "interest") {
      await openTask({
        type: "enrol",
        beneficiaryId: id,
        reason: `interested in ${e.courseId}`,
        district: updated.district,
        block: updated.block,
        data: { courseId: e.courseId, centreId: e.centreId },
      });

      // Self-employment comes with a consultant; they need to know too.
      if (updated.chosen?.consultantId) {
        await openTask({
          type: "consult",
          beneficiaryId: id,
          reason: `new self-employment case: ${e.courseId}`,
          district: updated.district,
          block: updated.block,
          data: { consultantId: updated.chosen.consultantId, courseId: e.courseId },
        });
      }
    }

    if (e.type === "unknown") {
      await recordUnknown(e.slot, e.text, updated.district);
    }
  }

  return updated;
}

const DAY = 24 * 60 * 60 * 1000;

/** An explicit status change by a person, recorded on the timeline. */
export async function setStatus(
  id: string,
  status: BeneficiaryStatus,
  by: Actor,
  note?: string,
): Promise<Beneficiary | null> {
  const now = Date.now();

  const b = await beneficiaries.update(id, (doc) =>
    doc
      ? {
          ...doc,
          status,
          updatedAt: now,
          certifiedAt: status === "certified" && !doc.certifiedAt ? now : doc.certifiedAt,
          timeline: [...doc.timeline, { at: now, type: "status", by, note, data: { from: doc.status, to: status } }],
        }
      : null,
  );

  // Certification starts the placement clock: follow-up calls at 30 and 90
  // days are what turn "trained" into a measured outcome.
  if (b && status === "certified") await scheduleFollowups(b);

  return b;
}

async function scheduleFollowups(b: Beneficiary): Promise<void> {
  const from = b.certifiedAt ?? Date.now();

  for (const day of [30, 90]) {
    await openTask({
      type: "follow_up",
      key: `day${day}`,
      beneficiaryId: b.id,
      reason: `${day}-day follow-up after certification`,
      district: b.district,
      block: b.block,
      dueAt: from + day * DAY,
      data: { day },
    });
  }
}

/** Help-desk and follow-up call events, folded into the record. */
export async function applyServiceEvents(
  id: string,
  events: (HelpdeskEvent & { id?: string } | FollowupEvent)[],
): Promise<Beneficiary | null> {
  let b = await beneficiaries.get(id);
  if (!b) return null;

  const at = Date.now();
  const log = (entry: Omit<TimelineEntry, "at">) =>
    beneficiaries.update(id, (d) => (d ? { ...d, updatedAt: at, timeline: [...d.timeline, { at, ...entry }] } : null));
  const bump = (status: BeneficiaryStatus) =>
    beneficiaries.update(id, (d) => (d ? { ...d, status: advance(d.status, status), updatedAt: at } : null));
  const where = { district: b.district, block: b.block };

  for (const e of events) {
    switch (e.type) {
      case "ticket":
        await openTask({
          type: "ticket",
          id: e.id,
          key: e.id,
          beneficiaryId: id,
          reason: e.category,
          data: { category: e.category, text: e.text },
          ...where,
        });
        await log({ type: "ticket", by: "beneficiary", note: e.text, data: { category: e.category, ticketId: e.id } });
        break;

      case "progress":
        await log({ type: "progress_reported", by: "beneficiary", note: e.text, data: { kind: e.kind } });

        if (e.kind === "training" || e.kind === "placed" || e.kind === "self_employed") {
          await bump(e.kind);
        } else if (e.kind === "certified") {
          // A spoken claim is not a certificate: an officer confirms it.
          await openTask({ type: "verify", beneficiaryId: id, reason: "says certified — verify", ...where });
        } else if (e.kind === "dropped") {
          await setStatus(id, "dropped", "beneficiary", e.text);
        }
        break;

      case "restart":
        await log({ type: "new_search", by: "beneficiary" });
        break;

      case "handoff":
        await beneficiaries.update(id, (d) => (d ? { ...d, flags: flag(d, "handoff") } : null));
        await log({ type: "handoff", by: "bot", note: e.reason });
        await openTask({ type: "callback", beneficiaryId: id, reason: e.reason, ...where });
        break;

      case "followup": {
        const due = (await tasks.list({ beneficiaryId: id, type: "follow_up", status: "open" }, { sortBy: "dueAt" }))[0];
        const day = (due?.data?.day as number | undefined) ?? 30;

        await log({
          type: "followup",
          by: "beneficiary",
          data: { working: e.working, kind: e.kind, monthlyIncome: e.monthlyIncome, day },
        });

        if (e.working) {
          await bump(e.kind === "self" ? "self_employed" : "placed");
          if (day >= 90) await bump("retained");
        } else {
          await beneficiaries.update(id, (d) => (d ? { ...d, flags: flag(d, "not_placed") } : null));
        }

        if (due) await setTaskStatus(due.id, "done");
        break;
      }
    }
  }

  b = await beneficiaries.get(id);
  return b;
}

export async function addNote(id: string, by: Actor, note: string): Promise<Beneficiary | null> {
  return beneficiaries.update(id, (b) =>
    b
      ? { ...b, updatedAt: Date.now(), timeline: [...b.timeline, { at: Date.now(), type: "note", by, note }] }
      : null,
  );
}
