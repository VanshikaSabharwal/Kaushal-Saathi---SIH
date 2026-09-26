/**
 * Train the completion-likelihood model and write data/ml/completion-model.json.
 *
 *   npm run ml:train                    # synthetic bootstrap only
 *   npm run ml:train -- --with-records  # plus real outcomes from the store
 *
 * Real outcomes are the chosen course of anyone who has either finished it
 * (certified or beyond) or dropped out; everyone still in progress is left out
 * rather than guessed. They are weighted above synthetic rows, so as the pilot
 * produces data the model moves toward what actually happens.
 *
 * Reports test AUC against the rules-only baseline. A model that cannot beat
 * the rules is not written.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "../lib/env";

loadEnv();

import { FEATURES, featuresOf } from "../lib/ml/features";
import { auc, predict, train } from "../lib/ml/logistic";
import { rng, syntheticRows, type Row } from "../lib/ml/synthetic";

const WITH_RECORDS = process.argv.includes("--with-records");
const REAL_WEIGHT = 3;

async function recordRows(): Promise<Row[]> {
  const { beneficiaries } = await import("../lib/store/beneficiaries");
  const { recommend } = await import("../lib/livelihood/recommender");
  const { completeProfile } = await import("../lib/livelihood/interview");

  const finished = new Set(["certified", "placed", "self_employed", "retained"]);
  const rows: Row[] = [];

  for (const b of await beneficiaries.list({}, { limit: 100000 })) {
    if (!b.chosen || !(finished.has(b.status) || b.status === "dropped")) continue;

    const profile = completeProfile(b.profile);
    const r = [...recommend(profile, 3, { useModel: false }).picks, ...recommend(profile, 3, { useModel: false }).more]
      .find((x) => x.course.id === b.chosen!.courseId);
    if (!r) continue;

    const x = featuresOf({ profile, course: r.course, distanceKm: r.distanceKm, womenOnlyBatch: r.centre.womenOnlyBatch, components: r.components });
    for (let i = 0; i < REAL_WEIGHT; i++) rows.push({ x, y: b.status === "dropped" ? 0 : 1, ruleScore: r.score, source: "record" });
  }

  return rows;
}

async function main(): Promise<void> {
  const synthetic = syntheticRows(4000);
  const real = WITH_RECORDS ? await recordRows() : [];
  const rows = [...synthetic, ...real];

  // Seeded shuffle, then 80/20.
  const rand = rng(1);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const cut = Math.floor(rows.length * 0.8);
  const trainSet = rows.slice(0, cut);
  const test = rows.slice(cut);

  const model = train(trainSet.map((r) => r.x), trainSet.map((r) => r.y), FEATURES);

  const modelAuc = auc(test.map((r) => predict(model, r.x)), test.map((r) => r.y));
  const baselineAuc = auc(test.map((r) => r.ruleScore), test.map((r) => r.y));

  console.log(`rows: ${synthetic.length} synthetic + ${real.length / REAL_WEIGHT} real (x${REAL_WEIGHT})`);
  console.log(`test AUC  model ${modelAuc.toFixed(3)}  vs  rules-only ${baselineAuc.toFixed(3)}  (n=${test.length})`);

  console.log("\nweights (standardised — bigger means more influence):");
  FEATURES.map((f, j) => ({ f, w: model.weights[j] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .forEach(({ f, w }) => console.log(`  ${w >= 0 ? "+" : ""}${w.toFixed(2)}  ${f}`));

  if (modelAuc <= baselineAuc) {
    console.log("\nModel does not beat the rules; not written.");
    process.exit(1);
  }

  const file = {
    trained: true,
    _note: "Completion-likelihood model. Bootstrapped on SYNTHETIC data (lib/ml/synthetic.ts) — retrain with --with-records as real outcomes arrive.",
    trainedAt: new Date().toISOString(),
    source: real.length ? "synthetic+records" : "synthetic",
    n: rows.length,
    metrics: { auc: Math.round(modelAuc * 1000) / 1000, baselineAuc: Math.round(baselineAuc * 1000) / 1000, nTest: test.length },
    ...model,
    features: [...FEATURES],
  };

  const out = path.join(__dirname, "..", "data", "ml", "completion-model.json");
  await writeFile(out, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nwritten: ${path.relative(process.cwd(), out)}`);
}

void main();
