/**
 * Turning district documents into opportunity cards — once, offline.
 *
 * A model reads a few chunks at a time and proposes cards. Each card must
 * quote its evidence from the chunk it cites; a card whose quote is not in the
 * text is dropped, not repaired. That is what lets a card be spoken to a
 * beneficiary later as "according to the district's report": the words are
 * provably in the report, on the page given.
 */

import { createHash } from "node:crypto";
import { keyFor } from "../../app/lib/providers/env";
import { quoted, type RegionChunk } from "../rag/region";
import type { OpportunityCard } from "./opportunities";
import type { Sector } from "./types";

const MODEL = process.env.GROQ_EXTRACT_CARDS_MODEL ?? "llama-3.3-70b-versatile";

export const CARD_SECTORS: Sector[] = [
  "automotive", "electrical", "solar", "electronics_repair", "plumbing", "construction", "furniture",
  "apparel", "handicrafts", "leather", "beauty", "dairy_livestock", "agriculture", "food_processing",
  "retail", "logistics", "healthcare", "it_ites", "hospitality",
];

const SYSTEM =
  "You extract livelihood opportunities from Indian district planning documents. " +
  "From the passages given, list concrete opportunities for small enterprises or local jobs that low-income " +
  "people could train for. Reply as JSON: {\"cards\": [{\"chunkId\", \"sector\", \"kind\" (enterprise|employment), " +
  "\"idea\" (short English), \"ideaHi\" (short simple Hindi), \"evidence\" (an EXACT quote, 15-200 characters, copied " +
  `from that passage), \"capitalMin\", \"capitalMax\" (rupees, only if the passage states them), \"employers\" (names stated)}]}. ` +
  `sector must be one of: ${CARD_SECTORS.join(", ")}. Only use what the passages say. If nothing fits, reply {"cards": []}.`;

type RawCard = {
  chunkId?: unknown;
  sector?: unknown;
  kind?: unknown;
  idea?: unknown;
  ideaHi?: unknown;
  evidence?: unknown;
  capitalMin?: unknown;
  capitalMax?: unknown;
  employers?: unknown;
};

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Keep only cards that cite a real passage, name an allowed sector, and quote
 * that passage word for word. Everything else is dropped.
 */
export function validateCards(raw: unknown, chunks: RegionChunk[]): { cards: OpportunityCard[]; rejected: number } {
  const list = (raw as { cards?: RawCard[] })?.cards;
  if (!Array.isArray(list)) return { cards: [], rejected: 0 };

  const cards: OpportunityCard[] = [];
  let rejected = 0;

  for (const r of list) {
    const chunk = chunks.find((c) => c.id === s(r.chunkId));
    const sector = s(r.sector) as Sector;
    const evidence = s(r.evidence);

    if (!chunk || !CARD_SECTORS.includes(sector) || !s(r.idea) || !s(r.ideaHi) || !quoted(evidence, chunk.text)) {
      rejected++;
      continue;
    }

    // Amounts are kept only when the quoted passage itself contains them.
    const min = Number(r.capitalMin);
    const max = Number(r.capitalMax);
    const statesAmount = (n: number) => Number.isFinite(n) && n > 0 && chunk.text.replace(/,/g, "").includes(String(n));

    cards.push({
      id: createHash("sha1").update(`${chunk.id}|${sector}|${s(r.idea)}`).digest("hex").slice(0, 16),
      district: chunk.district,
      block: chunk.block,
      sector,
      kind: s(r.kind) === "employment" ? "employment" : "enterprise",
      idea: s(r.idea),
      ideaHi: s(r.ideaHi),
      evidence,
      capitalRange: statesAmount(min) && statesAmount(max) ? [min, max] : undefined,
      employers: Array.isArray(r.employers)
        ? r.employers.map(String).filter((e) => chunk.text.includes(e))
        : [],
      source: { document: chunk.document, page: chunk.page, sourceType: chunk.sourceType },
      createdAt: Date.now(),
    });
  }

  return { cards, rejected };
}

export async function extractCards(chunks: RegionChunk[]): Promise<{ cards: OpportunityCard[]; rejected: number }> {
  const key = keyFor("groq", "llm");
  if (!key) throw new Error("GROQ_API_KEY is needed to extract opportunity cards.");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: chunks.map((c) => `[chunkId: ${c.id}]\n${c.text}`).join("\n\n---\n\n") },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  try {
    return validateCards(JSON.parse(data.choices?.[0]?.message?.content ?? "{}"), chunks);
  } catch {
    return { cards: [], rejected: 1 };
  }
}
