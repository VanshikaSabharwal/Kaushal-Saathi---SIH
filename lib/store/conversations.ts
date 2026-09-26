/**
 * Opening a conversation for a person: find or create their record, decide
 * which mode fits where they are, and wire its events to storage.
 *
 * Shared by the voice server's calls and its text chat, so both channels make
 * the same decision — someone with a course gets the help desk whether they
 * phone or type.
 */

import { Conversation, type ConversationEvent, type Opening } from "../livelihood/conversation";
import type { Answerer, HelpdeskContext, RegionSearch } from "../livelihood/helpdesk";
import { searchRegion } from "../rag/region";
import { canResume } from "../livelihood/interview";
import type { LlmExtractor } from "../livelihood/llm-extract";
import { getCourse } from "../livelihood/catalog";
import type { Profile } from "../livelihood/types";
import {
  applyInterviewEvents,
  applyServiceEvents,
  beneficiaries,
  getByPhone,
  newBeneficiary,
  startCallFor,
  type Beneficiary,
} from "./beneficiaries";
import { appendMessage } from "./messages";
import { tasks } from "./tasks";

/** Statuses at which a person has a course, and so gets the help desk. */
const HAS_COURSE = new Set(["interested", "enrolled", "training", "certified", "placed", "self_employed", "retained"]);

const INTERVIEW_EVENTS = new Set(["recommended", "interest", "unknown", "profile"]);

export async function helpdeskContextFor(b: Beneficiary): Promise<HelpdeskContext> {
  const tickets = await tasks.list({ beneficiaryId: b.id, type: "ticket" }, { sortBy: "createdAt", desc: true });
  const rec = b.recommendations.find((r) => r.courseId === b.chosen?.courseId);

  return {
    status: b.status,
    language: b.profile.language ?? b.language,
    district: b.district,
    courseId: b.chosen?.courseId,
    centreId: b.chosen?.centreId,
    consultantId: b.chosen?.consultantId,
    distanceKm: rec?.distanceKm,
    tickets: tickets.map((t) => ({ id: t.id, status: t.status, dueAt: t.dueAt })),
  };
}

export async function openingFor(b: Beneficiary, purpose?: "followup"): Promise<Opening> {
  const course = b.chosen ? getCourse(b.chosen.courseId) : undefined;

  if (purpose === "followup" && course) {
    return { mode: "followup", courseHi: course.nameHi, language: b.profile.language ?? b.language };
  }

  if (HAS_COURSE.has(b.status) || (b.status === "dropped" && b.chosen)) {
    return { mode: "helpdesk", ctx: await helpdeskContextFor(b) };
  }

  return canResume(b.interview.stage, b.interview.answered)
    ? { mode: "interview", resume: { profile: b.profile, answered: b.interview.answered } }
    : { mode: "interview" };
}

/** District documents for open help-desk questions; empty until ingested. */
const defaultRegionSearch: RegionSearch = async (question, district, signal) => {
  try {
    return await searchRegion(question, district, 3, signal);
  } catch {
    // No embeddings key, or no documents yet: answer from the record alone.
    return [];
  }
};

/**
 * In-flight saves per person, chained so one person's writes land in order.
 * Anything that must see a settled record — erasing it above all — waits here
 * first, or a save still in flight could recreate data after it was deleted.
 */
const pending = new Map<string, Promise<void>>();

export function whenSaved(beneficiaryId: string): Promise<void> {
  return pending.get(beneficiaryId) ?? Promise.resolve();
}

/** Every save in flight, for tests and shutdown. */
export async function allSaved(): Promise<void> {
  while (pending.size) await Promise.all(pending.values());
}

/** Route each event to the store that understands it. Never throws. */
export function persistTo(beneficiaryId: string, label: string) {
  return (events: ConversationEvent[], snapshot: { mode: string; interview?: import("../livelihood/interview").InterviewState }) => {
    const interviewTurn = snapshot.mode === "interview" && snapshot.interview;

    const forInterview = events.filter(
      (e) => INTERVIEW_EVENTS.has(e.type) || (e.type === "handoff" && interviewTurn),
    );
    const forService = events.filter((e) => !forInterview.includes(e));

    const work = async () => {
      if (interviewTurn) {
        await applyInterviewEvents(beneficiaryId, forInterview as never, snapshot.interview!);
      }
      if (forService.length) await applyServiceEvents(beneficiaryId, forService as never);
    };

    queue(beneficiaryId, label, work);
  };
}

/** Run a save after any already queued for this person. Not awaited by callers. */
function queue(beneficiaryId: string, label: string, work: () => Promise<void>): void {
  // Persistence must never hold up a reply.
  const next = (pending.get(beneficiaryId) ?? Promise.resolve())
    .then(work)
    .catch((err) => console.error(`[${label}] save failed:`, err));

  pending.set(beneficiaryId, next);
  void next.finally(() => {
    if (pending.get(beneficiaryId) === next) pending.delete(beneficiaryId);
  });
}

export async function openConversation(opts: {
  phone?: string;
  beneficiaryId?: string;
  purpose?: "followup";
  language?: Profile["language"];
  channelId: string;
  llm?: LlmExtractor;
  answer?: Answerer;
  region?: RegionSearch;
}): Promise<{ conversation: Conversation; beneficiary: Beneficiary }> {
  const existing =
    (opts.beneficiaryId ? await beneficiaries.get(opts.beneficiaryId) : null) ??
    (opts.phone ? await getByPhone(opts.phone) : null);

  const seed = existing ?? newBeneficiary({ phone: opts.phone, language: opts.language });
  const channel = opts.channelId.startsWith("chat-") ? "chat" : "voice";
  const beneficiary = (await startCallFor(seed.id, opts.channelId, seed)) ?? seed;

  const conversation = new Conversation(await openingFor(beneficiary, opts.purpose), {
    // A person's own language (switched to on an earlier call) beats the
    // deployment's default.
    language: existing ? beneficiary.profile.language ?? beneficiary.language : opts.language,
    llm: opts.llm,
    answer: opts.answer,
    region: opts.region ?? defaultRegionSearch,
    onEvents: persistTo(beneficiary.id, `conversation ${opts.channelId.slice(0, 8)}`),
    onTurn: (role, text) =>
      queue(beneficiary.id, "messages", () => appendMessage({ beneficiaryId: beneficiary.id, role, text, channel })),
  });

  queue(beneficiary.id, "messages", () =>
    appendMessage({ beneficiaryId: beneficiary.id, role: "assistant", text: conversation.greeting.replace(/\n+/g, " "), channel }),
  );

  return { conversation, beneficiary };
}
