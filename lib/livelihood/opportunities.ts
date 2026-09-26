/**
 * Region-specific opportunity cards: what the district's own planning
 * documents say is in demand — a business idea or a kind of job, the evidence,
 * and the document and page it came from.
 *
 * Cards are extracted once, offline, from real district documents
 * (scripts/ingest-regions.ts); at call time they are a lookup, not a model
 * call. Held in memory and replaced by the voice server when the store
 * changes, so the recommender stays synchronous.
 */

import type { Sector } from "./types";

export type OpportunityCard = {
  id: string;
  district: string;
  block?: string;
  sector: Sector;
  kind: "enterprise" | "employment";
  idea: string;
  ideaHi: string;
  evidence: string;
  capitalRange?: [number, number];
  employers: string[];
  source: { document: string; page?: number; sourceType: string };
  createdAt: number;
};

let cards: OpportunityCard[] = [];

export function setOpportunities(list: OpportunityCard[]): void {
  cards = list;
}

export function opportunitiesFor(district: string, sector: Sector, block?: string, limit = 2): OpportunityCard[] {
  return cards
    .filter((c) => c.district === district && c.sector === sector)
    // Cards for the person's own block first; district-wide after.
    .sort((a, b) => Number(b.block === block) - Number(a.block === block))
    .slice(0, limit);
}

export function allOpportunities(district?: string): OpportunityCard[] {
  return district ? cards.filter((c) => c.district === district) : cards;
}
