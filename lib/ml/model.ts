/**
 * The trained completion-likelihood model, as the recommender uses it.
 *
 * Read from data/ml/completion-model.json (written by `npm run ml:train`).
 * When the file holds no trained model, predictions are simply absent and the
 * recommender falls back to its rules — the model refines ranking, it is never
 * required for one.
 */

import modelFile from "../../data/ml/completion-model.json";
import { FEATURE_LABELS, FEATURES, featuresOf, type FeatureInput, type FeatureName } from "./features";
import { contributions, predict, type LogisticModel } from "./logistic";

export type CompletionModelFile = LogisticModel & {
  trained: true;
  trainedAt: string;
  source: string;
  n: number;
  metrics: { auc: number; baselineAuc: number; nTest: number };
};

export type Completion = {
  /** Estimated chance of finishing the course, 0–1. */
  p: number;
  /** The factors that moved this estimate most, strongest first. */
  factors: { feature: FeatureName; direction: "up" | "down"; en: string; hi: string }[];
};

function usable(m: unknown): m is CompletionModelFile {
  const f = m as CompletionModelFile;
  return Boolean(f?.trained && Array.isArray(f.weights) && f.features?.join() === FEATURES.join());
}

let current: CompletionModelFile | undefined = usable(modelFile) ? (modelFile as CompletionModelFile) : undefined;

/** Swap the model at runtime (after retraining), or remove it with undefined. */
export function setCompletionModel(m: CompletionModelFile | undefined): void {
  current = m && usable(m) ? m : undefined;
}

export function completionModel(): CompletionModelFile | undefined {
  return current;
}

export function completionFor(input: FeatureInput): Completion | undefined {
  if (!current) return undefined;

  const x = featuresOf(input);
  const p = predict(current, x);

  const factors = contributions(current, x)
    .filter((c) => Math.abs(c.value) > 0.15)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((c) => ({
      feature: c.feature as FeatureName,
      direction: c.value > 0 ? ("up" as const) : ("down" as const),
      ...FEATURE_LABELS[c.feature as FeatureName],
    }));

  return { p: Math.round(p * 100) / 100, factors };
}
