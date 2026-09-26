/**
 * The follow-up call, 30 and 90 days after certification: three questions —
 * working? job or own business? roughly what income? — and an offer of help
 * if not. This is where placement is measured rather than assumed.
 */

import synonyms from "../../data/synonyms.json";
import { intentOf, yesNo } from "./extract";
import { tpl } from "./i18n";
import { bestKey, numbersIn, tokens } from "./text";

export type FollowupEvent =
  | { type: "followup"; working: boolean; kind?: "wage" | "self"; monthlyIncome?: number }
  | { type: "handoff"; reason: string };

export type FollowupState = {
  step: "working" | "kind" | "income" | "offer" | "done";
  kind?: "wage" | "self";
  language?: "hi" | "mr";
  attempts: number;
  lastSay: string;
};

export type FollowupResult = { state: FollowupState; say: string; events: FollowupEvent[]; end: boolean };

const K = (synonyms as unknown as { followup: Record<string, string[]> }).followup;

const fill = (t: string, v: Record<string, string> = {}) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

export function startFollowup(courseHi: string, language: "hi" | "mr" = "hi"): FollowupResult {
  const say = fill(tpl(language).followup.greeting, { course: courseHi });
  return { state: { step: "working", attempts: 0, language, lastSay: say }, say, events: [], end: false };
}

export function followupStep(prev: FollowupState, text: string): FollowupResult {
  const s: FollowupState = { ...prev };
  const events: FollowupEvent[] = [];
  const F = tpl(s.language).followup;
  const out = (say: string, end = false): FollowupResult => {
    s.lastSay = say;
    return { state: s, say, events, end };
  };

  if (intentOf(text) === "repeat") return out(s.lastSay);

  // After two unclear answers, stop asking: a person will follow up instead.
  const unclear = (): FollowupResult => {
    if (++s.attempts >= 2) {
      events.push({ type: "handoff", reason: "follow-up call unclear" });
      s.step = "done";
      return out(F.helpYes, true);
    }
    return out(F.unclear);
  };

  switch (s.step) {
    case "working": {
      const kind = bestKey(tokens(text), K) as "wage" | "self" | undefined;
      const yn = yesNo(text);

      // "हाँ, अपनी दुकान चलाता हूँ" answers two questions at once.
      if (kind) {
        s.kind = kind;
        s.step = "income";
        s.attempts = 0;
        return out(F.income);
      }
      if (yn === true) {
        s.step = "kind";
        s.attempts = 0;
        return out(F.kind);
      }
      if (yn === false) {
        s.step = "offer";
        s.attempts = 0;
        events.push({ type: "followup", working: false });
        return out(F.offerHelp);
      }
      return unclear();
    }

    case "kind": {
      const kind = bestKey(tokens(text), K) as "wage" | "self" | undefined;
      if (!kind) return unclear();
      s.kind = kind;
      s.step = "income";
      s.attempts = 0;
      return out(F.income);
    }

    case "income": {
      // Any answer ends the call; a number is recorded when there is one.
      const income = numbersIn(text).find((n) => n >= 500);
      events.push({ type: "followup", working: true, kind: s.kind, monthlyIncome: income });
      s.step = "done";
      return out(F.thanks, true);
    }

    case "offer": {
      const yn = yesNo(text);
      if (yn === undefined) return unclear();
      if (yn) events.push({ type: "handoff", reason: "wants help finding work after training" });
      s.step = "done";
      return out(yn ? F.helpYes : F.helpNo, true);
    }

    case "done":
      return out(s.lastSay, true);
  }
}
