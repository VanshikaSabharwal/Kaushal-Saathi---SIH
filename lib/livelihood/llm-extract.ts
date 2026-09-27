/**
 * LLM fallback for an answer the dictionary could not place.
 *
 * Kept as small as a call can be: a short English instruction (Devanagari
 * costs several times the tokens), the one slot being filled, its allowed
 * values, and the single utterance — never the conversation, never the
 * catalogue. The reply is JSON and is validated against the allowed values;
 * anything else is treated as "not understood", exactly as if the model had
 * not been asked.
 */

import { keyFor } from "../../app/lib/providers/env";
import { LLM_TIMEOUT_MS, withDeadline } from "../agent/deadline";
import { allowedValues, slotValueFrom, type SlotId, type SlotValue } from "./extract";

/** Small and fast is the point here; the task is classification, not prose. */
const MODEL = process.env.GROQ_EXTRACT_MODEL ?? "llama-3.1-8b-instant";

export type LlmExtractor = (
  slot: SlotId,
  text: string,
  signal?: AbortSignal,
) => Promise<SlotValue | undefined>;

const SLOT_HELP: Partial<Record<SlotId, string>> = {
  education: "years of schooling completed (0 if none, 15 for a graduate)",
  travel: "maximum km the person can travel daily for training",
  hours: "hours per day free for training",
  currentWork: "the person's current occupation",
  familyTrade: "the family's traditional occupation",
  interests: "kinds of work the person likes (one or more)",
  preference: "self-employment, wage job, or either",
  continueFamilyTrade: "whether they want to continue the family trade",
  constraints: "physical limits on work",
  assets: "assets they own that could support a livelihood",
  learning: "prefers learning hands-on, in a classroom, or either",
  familySupport: "whether the family will support the training",
};

function prompt(slot: SlotId, allowed: string[] | "number"): string {
  const what = SLOT_HELP[slot] ?? slot;
  const values =
    allowed === "number"
      ? 'a number, e.g. {"value": 8}'
      : `a list chosen ONLY from: ${allowed.join(", ")} — e.g. {"value": ["${allowed[0]}"]}`;

  // A place we do not cover is still an answer, and deserves a different
  // reply from "I did not understand".
  const other =
    slot === "district"
      ? ` If it clearly names some other place (a city, district, village or state), reply {"value": "other", "place": "<its name in English>"}.`
      : "";

  return (
    `Classify a spoken Hindi/Marathi answer (may be dialect or mis-transcribed). ` +
    `Field: ${what}. Reply with JSON {"value": ...} where value is ${values}.${other} ` +
    `If the answer does not clearly say, reply {"value": null}. Never guess.`
  );
}

/** A Groq-backed extractor, or undefined when no key is configured. */
export function groqExtractor(): LlmExtractor | undefined {
  const key = keyFor("groq", "llm");
  if (!key) return undefined;

  return async (slot, text, signal) => {
    const allowed = allowedValues(slot);
    if (allowed === "free") return undefined;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: withDeadline(signal, LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt(slot, allowed) },
          { role: "user", content: text },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const data = await res.json();

    try {
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
      if (slot === "district" && parsed.value === "other") {
        return { outsidePlace: typeof parsed.place === "string" ? parsed.place.trim() : "" };
      }
      return slotValueFrom(slot, parsed.value);
    } catch {
      return undefined;
    }
  };
}
