/**
 * "सहायता": the conversation for someone who already has a course.
 *
 * Questions about their own course, centre, consultant and schemes are
 * answered from their record and the catalogue, by template. Complaints become
 * tickets with a number they can ask about later. Progress they report goes on
 * their timeline. Anything else may be answered by a model, but only from the
 * same facts and only through the guard — failing that, the question itself is
 * offered to an officer as a ticket rather than guessed at.
 *
 * Pure apart from the optional answerer, like the interview, so voice, text
 * chat and the verify script all run the same code.
 */

import synonyms from "../../data/synonyms.json";
import { CENTRES, getCourse, getDistrict, SCHEMES } from "./catalog";
import { consultantRegistry } from "./consultants";
import { intentOf, yesNo } from "./extract";
import { guardReply, type Facts } from "./guard";
import { durationText, fill, line as tline, tpl } from "./i18n";
import { bestKey, hasAny, numbersIn, tokens } from "./text";
import type { Centre, Consultant, Course } from "./types";

export type TicketCategory = "stipend" | "centre" | "travel" | "course" | "general" | "question";
export type ProgressKind = "training" | "month" | "certified" | "placed" | "self_employed" | "dropped";

export type HelpdeskEvent =
  | { type: "ticket"; category: TicketCategory; text: string }
  | { type: "progress"; kind: ProgressKind; text: string }
  | { type: "restart" }
  | { type: "handoff"; reason: string };

export type HelpdeskContext = {
  status: string;
  language?: "hi" | "mr";
  district?: string;
  courseId?: string;
  centreId?: string;
  consultantId?: string;
  distanceKm?: number;
  /** Most recent first. */
  tickets: { id: string; status: "open" | "done" | "cancelled"; dueAt: number }[];
};

export type HelpdeskState = {
  /** A question we could not answer, waiting on "shall I send it to an officer?". */
  pendingQuestion?: string;
  lastSay: string;
  llmCalls: number;
};

export type HelpdeskResult = {
  state: HelpdeskState;
  say: string;
  events: HelpdeskEvent[];
  end: boolean;
};

/** Passages from the person's own district's documents, for open questions. */
export type RegionSearch = (
  question: string,
  district: string,
  signal?: AbortSignal,
) => Promise<{ text: string; document: string; page?: number }[]>;

/** Answers a free question from the given facts, or returns undefined. */
export type Answerer = (
  question: string,
  facts: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<string | undefined>;

const D = (synonyms as unknown as { helpdesk: Record<string, unknown> }).helpdesk as {
  ticketStatus: string[];
  progress: Record<string, string[]>;
  complaint: Record<string, string[]>;
  restart: string[];
  question: Record<string, string[]>;
  status: string[];
  bye: string[];
};

/** A help-desk line in this person's language. Per call — never shared state. */
function lineFor(ctx: HelpdeskContext) {
  const H = tpl(ctx.language).helpdesk;
  return (key: string, vars?: Record<string, string | number>) => fill(H[key] as string, vars);
}

export const ticketNumber = (id: string) => id.replace(/-/g, "").slice(0, 6).toUpperCase();

type Resolved = { course?: Course; centre?: Centre; consultant?: Consultant };

function resolve(ctx: HelpdeskContext): Resolved {
  return {
    course: ctx.courseId ? getCourse(ctx.courseId) : undefined,
    centre: CENTRES.find((c) => c.id === ctx.centreId),
    consultant: consultantRegistry().find((c) => c.id === ctx.consultantId),
  };
}


function statusLine(ctx: HelpdeskContext, r: Resolved): string {
  const table = tpl(ctx.language).helpdesk.status as Record<string, string>;
  return fill(table[ctx.status] ?? "", { course: r.course?.nameHi ?? "" });
}

function schemesHi(r: Resolved): string {
  const selfEmployed = r.course && r.course.outcome !== "wage";
  return SCHEMES.filter((s) => s.id === "pmajay_gia" || (selfEmployed && s.id === "enterprise_loans"))
    .map((s) => s.hi)
    .join(" ");
}

/** The facts a model may use — nothing beyond this person's own record. */
export function factsFor(ctx: HelpdeskContext): { facts: Record<string, unknown>; guard: Facts } {
  const r = resolve(ctx);
  const km = ctx.distanceKm !== undefined ? Math.max(1, Math.round(ctx.distanceKm)) : undefined;

  const facts: Record<string, unknown> = {
    status: ctx.status,
    course: r.course && {
      name: r.course.nameHi,
      durationDays: r.course.durationDays,
      durationMonths: Math.round(r.course.durationDays / 30),
      mode: r.course.mode === "part_time" ? "part-time" : "full-time",
      typicalMonthlyIncome: r.course.incomeMonthly,
    },
    centre: r.centre && {
      name: r.centre.name,
      block: getDistrict(r.centre.district)?.blocks.find((b) => b.name === r.centre!.block)?.nameHi,
      distanceKm: km,
    },
    consultant: r.consultant?.name,
    schemes: schemesHi(r),
  };

  const numbers = [
    r.course?.durationDays,
    r.course && Math.round(r.course.durationDays / 30),
    ...(r.course?.incomeMonthly ?? []),
    km,
  ].filter((n): n is number => typeof n === "number");

  return {
    facts,
    guard: {
      courseIds: r.course ? [r.course.id] : [],
      centreIds: r.centre ? [r.centre.id] : [],
      consultantIds: r.consultant ? [r.consultant.id] : [],
      numbers,
    },
  };
}

export function startHelpdesk(ctx: HelpdeskContext): HelpdeskResult {
  const line = lineFor(ctx);
  const r = resolve(ctx);
  const say = line(r.course ? "greeting" : "greetingNoCourse", { statusLine: statusLine(ctx, r) });
  return { state: { lastSay: say, llmCalls: 0 }, say, events: [], end: false };
}

export async function helpdeskStep(
  prev: HelpdeskState,
  ctx: HelpdeskContext,
  text: string,
  opts: { answer?: Answerer; region?: RegionSearch; signal?: AbortSignal } = {},
): Promise<HelpdeskResult> {
  const line = lineFor(ctx);
  const s: HelpdeskState = { ...prev };
  const events: HelpdeskEvent[] = [];
  const r = resolve(ctx);
  const toks = tokens(text);

  const out = (say: string, end = false): HelpdeskResult => {
    s.lastSay = say;
    return { state: s, say, events, end };
  };
  const more = (say: string) => out(`${say}\n${line("askMore")}`);

  const intent = intentOf(text);
  if (intent === "human") {
    events.push({ type: "handoff", reason: "asked for a person (help desk)" });
    return out(tline(tpl(ctx.language), "handoff"), true);
  }
  if (intent === "repeat") return out(s.lastSay);

  // Waiting on "shall I pass your question to an officer?"
  if (s.pendingQuestion) {
    const question = s.pendingQuestion;
    const yn = yesNo(text);
    s.pendingQuestion = undefined;

    if (yn === true) {
      events.push({ type: "ticket", category: "question", text: question });
      return more(line("ticketOpened", { ticket: "…", days: 2 }));
    }
    if (yn === false) return out(line("unknownDeclined"));
    // Neither: treat what they said as a new request, below.
  }

  // Complaints and questions are about their subject whether or not a
  // "नहीं" follows it; progress and goodbyes keep ordinary negation.
  const any = { includeNegated: true };

  if (hasAny(toks, D.ticketStatus, any)) {
    const t = ctx.tickets[0];
    if (!t) return more(line("ticketNone"));
    return more(line(t.status === "open" ? "ticketOpen" : "ticketDone", { ticket: ticketNumber(t.id) }));
  }

  const progress = bestKey(toks, D.progress) as ProgressKind | undefined;
  if (progress) {
    events.push({ type: "progress", kind: progress, text });
    if (progress === "certified") return more(line("progressCertified"));
    if (progress === "dropped") return out(line("progressDropped"));
    return more(line("progressThanks"));
  }

  const complaint = bestKey(toks, D.complaint, any) as TicketCategory | undefined;
  if (complaint) {
    events.push({ type: "ticket", category: complaint, text });
    // The real number is assigned when the ticket is stored; the caller
    // substitutes it (see Conversation).
    return more(line("ticketOpened", { ticket: "…", days: 2 }));
  }

  if (hasAny(toks, D.restart, any)) {
    events.push({ type: "restart" });
    return out("");
  }

  const question = bestKey(toks, D.question, any);
  if (question) {
    if (!r.course && question !== "fees" && question !== "loan") return more(line("noCourse"));

    switch (question) {
      case "duration":
        return more(
          line("duration", {
            course: r.course!.nameHi,
            duration: durationText(r.course!.durationDays, tpl(ctx.language)),
            mode: line(r.course!.mode === "part_time" ? "modePart" : "modeFull"),
          }),
        );
      case "centre":
        if (!r.centre) return more(line("noCourse"));
        return more(
          line("centre", {
            centre: r.centre.name,
            block: getDistrict(r.centre.district)?.blocks.find((b) => b.name === r.centre!.block)?.nameHi ?? r.centre.block,
            km: Math.max(1, Math.round(ctx.distanceKm ?? 0)),
          }),
        );
      case "income":
        return more(line("income", { min: r.course!.incomeMonthly[0], max: r.course!.incomeMonthly[1] }));
      case "fees":
        return more(line("fees", { schemes: schemesHi(r) }));
      case "loan":
        return more(
          line("loan", {
            consultant: r.consultant ? line("loanConsultant", { consultant: r.consultant.name }) : line("loanNone"),
            schemes: schemesHi(r),
          }),
        );
    }
  }

  if (hasAny(toks, D.status, any)) return more(statusLine(ctx, r) || line("noCourse"));

  // A bare "no" to "anything else?" ends it; a "ना" at the end of a longer
  // sentence ("बताओ ना") is emphasis, not a goodbye.
  if (hasAny(toks, D.bye) || (toks.length <= 3 && yesNo(text) === false)) return out(line("bye"), true);

  // Nothing matched: a model may answer, strictly from this person's facts.
  if (opts.answer && text.trim()) {
    s.llmCalls++;
    const { facts, guard } = factsFor(ctx);

    try {
      // The district's own documents, when the question is about the area
      // rather than the person's course. Their numbers become speakable; no
      // others do.
      const notes = ctx.district && opts.region ? await opts.region(text, ctx.district, opts.signal) : [];
      if (notes.length) {
        facts.districtDocuments = notes.map((n) => ({ text: n.text.slice(0, 700), source: n.document, page: n.page }));
        guard.numbers.push(...notes.flatMap((n) => numbersIn(n.text)), ...notes.map((n) => n.page ?? 0));
      }

      const answer = await opts.answer(text, facts, opts.signal);
      if (answer) {
        const checked = guardReply(answer, guard, "");
        if (!checked.replaced) {
          const cite = notes[0] ? ` (स्रोत: ${notes[0].document}${notes[0].page ? `, पेज ${notes[0].page}` : ""})` : "";
          return more(checked.text + cite);
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
    }
  }

  s.pendingQuestion = text;
  return out(line("unknown"));
}
