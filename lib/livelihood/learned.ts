/**
 * Phrases people have taught the interview, from the unknown-word queue.
 *
 * Held in memory and replaced wholesale by the voice server whenever a mapping
 * changes, so extraction stays synchronous and never waits on storage. Kept
 * separate from data/synonyms.json on purpose: the shipped dictionary is
 * reviewed code, these are field corrections — and a bad mapping can be
 * undone in the dashboard without a deploy.
 */

import type { SlotId } from "./extract";
import { findPhrase, tokens } from "./text";

export type LearnedPhrase = { slot: SlotId; phrase: string; value: string };

let learned: LearnedPhrase[] = [];

export function setLearned(list: LearnedPhrase[]): void {
  // Longest first, so "टोकरी बनाते हैं" wins over a shorter overlapping phrase.
  learned = [...list].sort((a, b) => tokens(b.phrase).length - tokens(a.phrase).length);
}

export function learnedCount(): number {
  return learned.length;
}

/** The taught value for an answer, when one of the taught phrases is in it. */
export function learnedValue(slot: SlotId, text: string): string | undefined {
  const toks = tokens(text);
  return learned.find(
    (l) => l.slot === slot && findPhrase(toks, l.phrase).some((m) => !m.negated),
  )?.value;
}
