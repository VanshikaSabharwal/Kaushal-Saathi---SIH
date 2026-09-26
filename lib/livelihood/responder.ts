/**
 * A Conversation as a call-engine Responder.
 *
 * One per call. The conversation owns the state and commits it only once a
 * step completes, so a caller interrupting mid-step (an aborted model call)
 * leaves it exactly where it was.
 */

import type { Responder } from "../call/session";
import type { Conversation } from "./conversation";

export class ConversationResponder implements Responder {
  constructor(private readonly conversation: Conversation) {}

  get greeting(): string {
    return this.conversation.greeting;
  }

  language(): string {
    return this.conversation.language;
  }

  async respond(text: string, _history: unknown, signal: AbortSignal) {
    const started = Date.now();
    const r = await this.conversation.respond(text, signal);

    // A model call is reported like a tool, so the conversations view shows
    // which turns needed one and what they cost in time.
    return {
      text: r.say,
      toolsUsed: r.usedLlm ? ["llm"] : [],
      toolMs: r.usedLlm ? Date.now() - started : undefined,
      end: r.end,
    };
  }
}
