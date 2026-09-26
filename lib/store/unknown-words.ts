/**
 * Answers the interview could not understand, grouped so the same phrase from
 * many callers is one row with a count.
 *
 * This is how the dictionary learns dialect: a Saathi or officer sees
 * "टोकरी बनाते हैं — 14 times, currentWork" in the dashboard and maps it to
 * a value. The most frequent misses are exactly the words worth adding.
 */

import type { SlotId } from "../livelihood/extract";
import { normalize } from "../livelihood/text";
import { createCollection } from "./collection";

export type UnknownWord = {
  /** "<slot>:<normalised text>", so repeats collapse into one row. */
  id: string;
  slot: SlotId;
  text: string;
  count: number;
  districts: string[];
  firstAt: number;
  lastAt: number;
  status: "new" | "mapped" | "ignored";
  /** The slot value a person chose for it, e.g. "weaving". */
  mappedTo?: string;
};

export const unknownWords = createCollection<UnknownWord>("unknown_words", { max: 2000 });

export async function recordUnknown(slot: SlotId, text: string, district?: string): Promise<void> {
  const clean = normalize(text);
  if (!clean) return;

  const id = `${slot}:${clean}`;
  const now = Date.now();

  await unknownWords.update(id, (w) => ({
    id,
    slot,
    text: w?.text ?? text.trim(),
    count: (w?.count ?? 0) + 1,
    districts: district && !w?.districts.includes(district)
      ? [...(w?.districts ?? []), district]
      : (w?.districts ?? []),
    firstAt: w?.firstAt ?? now,
    lastAt: now,
    status: w?.status ?? "new",
    mappedTo: w?.mappedTo,
  }));
}

export async function mapUnknown(
  id: string,
  mappedTo: string | null,
): Promise<UnknownWord | null> {
  return unknownWords.update(id, (w) =>
    w ? { ...w, status: mappedTo ? "mapped" : "ignored", mappedTo: mappedTo ?? undefined } : null,
  );
}

/** Every mapped word, in the shape the interview's learned layer takes. */
export async function loadLearned(): Promise<{ slot: SlotId; phrase: string; value: string }[]> {
  const mapped = await unknownWords.list({ status: "mapped" }, { limit: 2000 });
  return mapped
    .filter((w) => w.mappedTo)
    .map((w) => ({ slot: w.slot, phrase: w.text, value: w.mappedTo! }));
}
