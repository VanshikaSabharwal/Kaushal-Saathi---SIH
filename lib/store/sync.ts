/**
 * Keeping the in-memory views the recommender reads in step with storage:
 * the consultant registry (verification, load), opportunity cards, taught
 * words, and measured placement rates by course. Plus the one scheduled check
 * that needs no one to trigger it — people certified 60 days ago and still not
 * working go to the Needs attention queue.
 *
 * Run at voice-server start and every few minutes; each part is independent,
 * so one failing does not stop the rest.
 */

import { setConsultantRegistry } from "../livelihood/consultants";
import { setLearned } from "../livelihood/learned";
import { setOpportunities } from "../livelihood/opportunities";
import { setOutcomeRates } from "../livelihood/recommender";
import { beneficiaries, type Beneficiary } from "./beneficiaries";
import { liveRegistry, seedConsultants } from "./consultants";
import { opportunities } from "./opportunities";
import { openTask } from "./tasks";
import { loadLearned } from "./unknown-words";

const DAY = 24 * 60 * 60 * 1000;
const WORKING = new Set(["placed", "self_employed", "retained"]);
const FINISHED = new Set(["certified", ...WORKING]);

/** Share of each course's certified graduates who are working. */
export function outcomeRates(all: Beneficiary[]): Record<string, { rate: number; n: number }> {
  const by: Record<string, { working: number; n: number }> = {};

  for (const b of all) {
    if (!b.chosen || !FINISHED.has(b.status)) continue;
    const c = (by[b.chosen.courseId] ??= { working: 0, n: 0 });
    c.n++;
    if (WORKING.has(b.status)) c.working++;
  }

  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { rate: v.working / v.n, n: v.n }]));
}

export async function syncAll(): Promise<void> {
  const parts: [string, () => Promise<void>][] = [
    ["consultants", async () => {
      await seedConsultants();
      setConsultantRegistry(await liveRegistry());
    }],
    ["opportunities", async () => setOpportunities(await opportunities.list({}, { limit: 20000 }))],
    ["learned", async () => setLearned(await loadLearned())],
    ["outcomes", async () => {
      const all = await beneficiaries.list({}, { limit: 100000 });
      setOutcomeRates(outcomeRates(all));

      for (const b of all) {
        if (b.status === "certified" && b.certifiedAt && Date.now() - b.certifiedAt > 60 * DAY) {
          await openTask({
            type: "callback",
            key: "not_placed_60",
            beneficiaryId: b.id,
            reason: "certified 60+ days ago, not yet working",
            district: b.district,
            block: b.block,
          });
        }
      }
    }],
  ];

  for (const [name, run] of parts) {
    try {
      await run();
    } catch (err) {
      console.error(`[sync] ${name} failed:`, err);
    }
  }
}
