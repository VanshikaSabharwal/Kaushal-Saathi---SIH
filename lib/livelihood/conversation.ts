/**
 * One conversation with one person, whatever channel carries it.
 *
 * Three modes over the same record:
 *  - interview: finding the right course (new, or resumed after a dropped call);
 *  - helpdesk:  questions, complaints and progress once a course is chosen;
 *  - followup:  the 30/90-day "are you working?" call.
 *
 * The voice responder and the text chat both drive this, so a person gets the
 * same answers whether they speak or type. Persistence is a callback: this
 * module decides what happened, the caller decides where it is written.
 */

import { randomUUID } from "node:crypto";
import { followupStep, startFollowup, type FollowupEvent, type FollowupState } from "./followup";
import {
  helpdeskStep,
  startHelpdesk,
  ticketNumber,
  type Answerer,
  type RegionSearch,
  type HelpdeskContext,
  type HelpdeskEvent,
  type HelpdeskState,
} from "./helpdesk";
import {
  resumeInterview,
  startInterview,
  step,
  type InterviewEvent,
  type InterviewState,
} from "./interview";
import type { SlotId } from "./extract";
import { line, tpl } from "./i18n";
import type { LlmExtractor } from "./llm-extract";
import type { Profile } from "./types";

export type Mode = "interview" | "helpdesk" | "followup";

/** Help-desk events carry ids minted here, so nothing waits on storage. */
export type ConversationEvent =
  | InterviewEvent
  | (HelpdeskEvent & { id?: string })
  | FollowupEvent;

export type Opening =
  | { mode: "interview"; resume?: { profile: Partial<Profile>; answered: SlotId[] } }
  | { mode: "helpdesk"; ctx: HelpdeskContext }
  | { mode: "followup"; courseHi: string; language?: Profile["language"] };

export type ConversationDeps = {
  language?: Profile["language"];
  llm?: LlmExtractor;
  answer?: Answerer;
  region?: RegionSearch;
  onEvents?: (events: ConversationEvent[], snapshot: { mode: Mode; interview?: InterviewState }) => void;
  /** Every line said, both sides — for the person's conversation history. */
  onTurn?: (role: "user" | "assistant", text: string) => void;
};

export type Reply = { say: string; end: boolean; usedLlm: boolean };

const TICKET_DUE_MS = 48 * 60 * 60 * 1000;

export class Conversation {
  mode: Mode;
  readonly greeting: string;

  private interview?: InterviewState;
  private helpdesk?: HelpdeskState;
  private followup?: FollowupState;
  private ctx?: HelpdeskContext;

  constructor(opening: Opening, private readonly deps: ConversationDeps = {}) {
    this.mode = opening.mode;

    switch (opening.mode) {
      case "interview": {
        const r = opening.resume ? resumeInterview(opening.resume) : startInterview(deps.language);
        this.interview = r.state;
        this.greeting = r.say;
        break;
      }
      case "helpdesk": {
        this.ctx = { ...opening.ctx, tickets: [...opening.ctx.tickets] };
        const r = startHelpdesk(this.ctx);
        this.helpdesk = r.state;
        this.greeting = r.say;
        break;
      }
      case "followup": {
        const r = startFollowup(opening.courseHi, opening.language ?? deps.language);
        this.followup = r.state;
        this.greeting = r.say;
        break;
      }
    }
  }

  async respond(text: string, signal?: AbortSignal): Promise<Reply> {
    const reply = await this.turn(text, signal);
    this.deps.onTurn?.("user", text);
    // Lines are joined with breaks for speech (cached parts); read as one.
    this.deps.onTurn?.("assistant", reply.say.replace(/\n+/g, " "));
    return reply;
  }

  private async turn(text: string, signal?: AbortSignal): Promise<Reply> {
    switch (this.mode) {
      case "interview":
        return this.interviewTurn(text, signal);
      case "helpdesk":
        return this.helpdeskTurn(text, signal);
      case "followup": {
        const r = followupStep(this.followup!, text);
        this.followup = r.state;
        this.emit(r.events);
        return { say: r.say, end: r.end, usedLlm: false };
      }
    }
  }

  private async interviewTurn(text: string, signal?: AbortSignal): Promise<Reply> {
    const before = this.interview!.llmCalls;
    const r = await step(this.interview!, text, { llm: this.deps.llm, signal });
    this.interview = r.state;
    // Every turn, events or not: the stage alone is what makes a call resumable.
    this.emit(r.events);
    return { say: r.say, end: r.end, usedLlm: r.state.llmCalls > before };
  }

  private async helpdeskTurn(text: string, signal?: AbortSignal): Promise<Reply> {
    const before = this.helpdesk!.llmCalls;
    const r = await helpdeskStep(this.helpdesk!, this.ctx!, text, {
      answer: this.deps.answer,
      region: this.deps.region,
      signal,
    });
    this.helpdesk = r.state;

    let say = r.say;
    const events: ConversationEvent[] = [];

    for (const e of r.events) {
      if (e.type === "ticket") {
        const id = randomUUID();
        events.push({ ...e, id });
        this.ctx!.tickets.unshift({ id, status: "open", dueAt: Date.now() + TICKET_DUE_MS });
        say = say.replace("…", ticketNumber(id));
      } else if (e.type === "restart") {
        // A new course search, in the same call, without asking consent again.
        const start = startInterview(this.language, { consented: true, lead: line(tpl(this.language), "restartLead") });
        this.mode = "interview";
        this.interview = start.state;
        say = start.say;
        events.push(e);
      } else {
        events.push(e);
      }
    }

    this.emit(events);
    return { say, end: r.end, usedLlm: r.state.llmCalls > before };
  }

  private emit(events: ConversationEvent[]): void {
    this.deps.onEvents?.(events, { mode: this.mode, interview: this.interview });
  }

  get interviewState(): InterviewState | undefined {
    return this.interview;
  }

  /** The language the next reply is in — the call's TTS and STT follow it. */
  get language(): Profile["language"] {
    if (this.mode === "interview") return this.interview?.profile.language ?? this.deps.language ?? "hi";
    if (this.mode === "helpdesk") return this.ctx?.language ?? this.deps.language ?? "hi";
    return this.followup?.language ?? this.deps.language ?? "hi";
  }
}
