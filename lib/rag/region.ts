/**
 * District knowledge: chunks of each district's own planning documents
 * (industrial potential surveys, credit plans, skill plans), tagged with
 * where they came from, and searchable within one district at a time.
 *
 * Separate from the original docs store (store.ts) because every search here
 * is filtered by district first — a Jhansi caller must never be told about
 * Nashik's industries because the wording happened to match.
 *
 * Vectors are optional. With GOOGLE_API_KEY the ingest embeds every chunk and
 * search is semantic; without it, search falls back to word overlap, which is
 * weaker but needs no extra key and still never crosses districts.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize, tokens } from "../livelihood/text";
import { embed, similarity } from "./embed";

export type RegionChunk = {
  id: string;
  text: string;
  state: string;
  district: string;
  block?: string;
  /** dips | odop | plp | dsdp | ncs | other — from the file name's prefix. */
  sourceType: string;
  document: string;
  page?: number;
};

export type RegionFile = {
  createdAt: number;
  model?: string;
  dim?: number;
  chunks: RegionChunk[];
  /** Flat Float32 vectors, base64 — absent when ingested without embeddings. */
  vectors?: string;
};

export type RegionHit = RegionChunk & { score: number };

export const REGION_STORE_PATH = path.join(process.cwd(), ".data", "region-chunks.json");

let cache: { chunks: RegionChunk[]; matrix?: Float32Array; dim?: number } | null = null;

export function invalidateRegion(): void {
  cache = null;
}

export async function loadRegion(): Promise<typeof cache> {
  if (cache) return cache;

  try {
    const file: RegionFile = JSON.parse(await readFile(REGION_STORE_PATH, "utf8"));
    let matrix: Float32Array | undefined;

    if (file.vectors) {
      const buf = Buffer.from(file.vectors, "base64");
      const aligned = new ArrayBuffer(buf.byteLength);
      new Uint8Array(aligned).set(buf);
      matrix = new Float32Array(aligned);
    }

    cache = { chunks: file.chunks, matrix, dim: file.dim };
  } catch {
    cache = { chunks: [] };
  }

  return cache;
}

/** Word-overlap score, for when there are no vectors. */
export function lexicalScore(query: string, text: string): number {
  const q = new Set(tokens(query).filter((t) => t.length > 2));
  if (q.size === 0) return 0;
  const t = new Set(tokens(text));
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return hit / q.size;
}

export async function searchRegion(
  query: string,
  district: string,
  k = 3,
  signal?: AbortSignal,
): Promise<RegionHit[]> {
  const store = await loadRegion();
  if (!store?.chunks.length) return [];

  const inDistrict = store.chunks
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.district === district);

  let scored: RegionHit[];

  if (store.matrix && store.dim) {
    const q = await embed(query, "RETRIEVAL_QUERY", signal);
    scored = inDistrict.map(({ c, i }) => ({
      ...c,
      score: similarity(q, store.matrix!.subarray(i * store.dim!, (i + 1) * store.dim!)),
    }));
    scored = scored.filter((h) => h.score >= 0.6);
  } else {
    scored = inDistrict.map(({ c }) => ({ ...c, score: lexicalScore(query, c.text) })).filter((h) => h.score >= 0.34);
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Split `pdftotext` output into pages (form feeds), numbered from 1. */
export function splitPages(text: string): { page: number; text: string }[] {
  return text
    .split("\f")
    .map((t, i) => ({ page: i + 1, text: t.trim() }))
    .filter((p) => p.text.length > 0);
}

/** "dips_jhansi_2023.pdf" -> "dips". Unknown prefixes are "other". */
export function sourceTypeOf(file: string): string {
  const prefix = path.basename(file).toLowerCase().split(/[_\-. ]/)[0];
  return ["dips", "odop", "plp", "dsdp", "ncs"].includes(prefix) ? prefix : "other";
}

/** Does the evidence appear in the text, allowing for spacing and case? */
export function quoted(evidence: string, text: string): boolean {
  const e = normalize(evidence);
  return e.length >= 12 && normalize(text).includes(e);
}
