/**
 * The last check before model-written text is spoken.
 *
 * Interview lines are templates filled from the catalogue and never need this.
 * It exists for the places an LLM phrases an answer — follow-up questions and
 * the help desk — where a fluent model can state a course, a centre or a
 * rupee amount that is not true. A beneficiary who cannot read has no way to
 * catch that, so the rule is strict: every catalogue entity and every number
 * in the reply must be among the facts that turn actually produced.
 *
 * It cannot recognise an invented course name that resembles nothing in the
 * catalogue; that is why the prompts that feed it never ask the model to name
 * courses on its own, only to phrase ones it was given.
 */

import { CENTRES, COURSES } from "./catalog";
import { consultantRegistry } from "./consultants";
import { normalize, numbersIn } from "./text";

export type Facts = {
  courseIds: string[];
  centreIds: string[];
  consultantIds: string[];
  /** Every number the facts contain: durations, km, income bounds, counts. */
  numbers: number[];
};

export type GuardResult = { ok: boolean; violations: string[] };

/** Numbers that carry no factual claim ("पहला", "दो रास्ते"). */
const HARMLESS_NUMBERS = new Set([0, 1, 2, 3]);

const mentions = (text: string, name: string) => normalize(text).includes(normalize(name));

export function checkReply(text: string, facts: Facts): GuardResult {
  const violations: string[] = [];

  for (const c of COURSES) {
    if ((mentions(text, c.nameHi) || mentions(text, c.name)) && !facts.courseIds.includes(c.id)) {
      violations.push(`course not in this turn's facts: ${c.id}`);
    }
  }

  for (const c of CENTRES) {
    if (mentions(text, c.name) && !facts.centreIds.includes(c.id)) {
      violations.push(`centre not in this turn's facts: ${c.id}`);
    }
  }

  for (const c of consultantRegistry()) {
    if (mentions(text, c.name) && !facts.consultantIds.includes(c.id)) {
      violations.push(`consultant not in this turn's facts: ${c.id}`);
    }
  }

  for (const n of numbersIn(text)) {
    if (!HARMLESS_NUMBERS.has(n) && !facts.numbers.includes(n)) {
      violations.push(`number not in this turn's facts: ${n}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/** The reply if it passes, otherwise the safe template built from the facts. */
export function guardReply(text: string, facts: Facts, fallback: string): {
  text: string;
  replaced: boolean;
  violations: string[];
} {
  const r = checkReply(text, facts);
  return r.ok
    ? { text, replaced: false, violations: [] }
    : { text: fallback, replaced: true, violations: r.violations };
}
