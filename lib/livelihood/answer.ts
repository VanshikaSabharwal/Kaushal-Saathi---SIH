/**
 * The help desk's model fallback: answer a free question from one person's
 * own facts, or say it cannot.
 *
 * The model is told the facts and nothing else, and to reply UNKNOWN rather
 * than reach past them. Its answer then goes through the guard (helpdesk.ts),
 * so even an answer that ignores the instruction cannot put a course, centre
 * or number in front of the person that their record does not contain.
 */

import { keyFor } from "../../app/lib/providers/env";
import { LLM_TIMEOUT_MS, withDeadline } from "../agent/deadline";
import type { Answerer } from "./helpdesk";

/** Larger than the extraction model: this one writes Hindi a person will hear. */
const MODEL = process.env.GROQ_ANSWER_MODEL ?? "llama-3.3-70b-versatile";

const SYSTEM =
  "You help a beneficiary of a government skill-training scheme in India. " +
  "Answer their question in simple, respectful Hindi, at most two short sentences, " +
  "using ONLY the facts provided. Do not add any course, place, amount, date or promise " +
  "that is not in the facts. If the facts do not answer the question, reply exactly: UNKNOWN";

export function groqAnswerer(): Answerer | undefined {
  const key = keyFor("groq", "llm");
  if (!key) return undefined;

  return async (question, facts, signal) => {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: withDeadline(signal, LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Facts: ${JSON.stringify(facts)}\n\nQuestion: ${question}` },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    return !text || text.includes("UNKNOWN") ? undefined : text;
  };
}
