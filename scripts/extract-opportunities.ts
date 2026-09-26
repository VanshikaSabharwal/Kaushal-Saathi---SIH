/**
 * Extract opportunity cards from the ingested district documents.
 *
 *   npm run extract:opportunities            # every district with documents
 *   npm run extract:opportunities -- jhansi  # one district
 *
 * One-time and offline, so it can afford the larger model. Every card must
 * quote its evidence word for word from the passage it cites (see
 * opportunity-extract.ts); the rest are dropped and counted. Cards go to the
 * store the voice server reads — they are live on its next sync.
 */

import { loadEnv } from "../lib/env";

loadEnv();

import { extractCards } from "../lib/livelihood/opportunity-extract";
import { loadRegion } from "../lib/rag/region";
import { opportunities } from "../lib/store/opportunities";

const BATCH = 4;
const only = process.argv[2];

async function main(): Promise<void> {
  const store = await loadRegion();
  const chunks = (store?.chunks ?? []).filter((c) => !only || c.district === only);

  if (chunks.length === 0) {
    console.log("No district chunks. Run `npm run ingest:regions` first.");
    return;
  }

  let kept = 0;
  let dropped = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);

    try {
      const { cards, rejected } = await extractCards(batch);
      for (const c of cards) await opportunities.upsert(c);
      kept += cards.length;
      dropped += rejected;
      console.log(`${batch[0].district} ${i + batch.length}/${chunks.length}: +${cards.length} card(s)${rejected ? `, ${rejected} dropped (quote not in text)` : ""}`);
    } catch (err) {
      console.error(`batch ${i}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n${kept} card(s) stored, ${dropped} dropped.`);
  process.exit(0);
}

void main();
