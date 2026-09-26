/**
 * Synthetic training data for the completion model — clearly labelled as such.
 *
 * There is no historical PM-AJAY outcome data to learn from yet, so the model
 * is bootstrapped on generated people and generated outcomes, then retrained
 * on real ones as the pilot produces them (`npm run ml:train -- --with-records`).
 *
 * The hidden outcome rule below is an assumption, written down so it can be
 * argued with: it encodes what field staff report drives drop-out (distance,
 * especially for women; full-time courses for people with little time; a
 * teaching style that does not suit; no family backing). It also includes an
 * interaction the linear features cannot fully express, so the model has to
 * approximate rather than recite the answer.
 */

import { DISTRICTS, TRADES } from "../livelihood/catalog";
import { recommend } from "../livelihood/recommender";
import type { Asset, Profile, Sector } from "../livelihood/types";
import { featuresOf, FEATURES, type FeatureName } from "./features";

export type Row = { x: number[]; y: number; ruleScore: number; source: "synthetic" | "record" };

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECTORS: Sector[] = [
  "automotive", "electrical", "solar", "electronics_repair", "plumbing", "construction", "furniture",
  "apparel", "handicrafts", "beauty", "dairy_livestock", "agriculture", "food_processing", "retail",
  "logistics", "healthcare", "it_ites", "hospitality",
];

/** The assumed truth. Log-odds contributions per feature. */
const TRUTH: Partial<Record<FeatureName, number>> = {
  distance: -1.8,
  fullTimeShortHours: -1.5,
  hoursLow: -0.4,
  eduStretch: -0.6,
  interest: 1.2,
  familyTrade: 0.5,
  demand: 0.3,
  preference: 0.6,
  assetMatch: 0.3,
  femaleFar: -1.2,
  womenBatch: 0.5,
  learningMismatch: -1.0,
  familySupport: 0.8,
  familyAgainst: -0.9,
  partTime: 0.2,
  durationLong: -0.5,
};
const TRUTH_BIAS = 0.4;

export function syntheticProfile(rand: () => number): Profile {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const district = pick(DISTRICTS);
  const trades = Object.keys(TRADES);
  const familyTrade = rand() < 0.8 ? pick(trades) : undefined;
  const familySector = familyTrade ? TRADES[familyTrade].sector : null;

  const interests = new Set<Sector>();
  if (familySector && rand() < 0.4) interests.add(familySector);
  while (interests.size < 1 + Math.floor(rand() * 2)) interests.add(pick(SECTORS));

  const assets = (["land", "livestock", "shop_space", "tools", "savings"] as Asset[]).filter(() => rand() < 0.2);

  return {
    district: district.id,
    block: pick(district.blocks).name,
    language: district.defaultLanguage,
    education: pick([0, 5, 5, 8, 8, 8, 10, 10, 12, 15]),
    familyTrade,
    continueFamilyTrade: familyTrade ? rand() < 0.5 : undefined,
    currentWork: rand() < 0.5 ? pick(trades) : undefined,
    interestSectors: [...interests],
    skills: [],
    preference: pick(["self", "wage", "either"] as const),
    maxTravelKm: pick([5, 15, 15, 30, 50]),
    canRelocate: rand() < 0.1,
    constraints: rand() < 0.1 ? ["no_heavy_work"] : [],
    assets,
    hoursPerDay: pick([2, 4, 4, 6, 8, 8, undefined]),
    learning: pick(["hands_on", "hands_on", "classroom", "either"] as const),
    familySupport: rand() < 0.6 ? true : rand() < 0.4 ? false : undefined,
    gender: rand() < 0.5 ? "female" : "male",
  };
}

/** Rows for every course shown to each synthetic person, labelled by the assumed truth. */
export function syntheticRows(count: number, seed = 42): Row[] {
  const rand = rng(seed);
  const rows: Row[] = [];
  const idx = (f: FeatureName) => FEATURES.indexOf(f);

  for (let i = 0; i < count; i++) {
    const profile = syntheticProfile(rand);
    const { picks } = recommend(profile, 3, { useModel: false });

    for (const r of picks) {
      const x = featuresOf({
        profile,
        course: r.course,
        distanceKm: r.distanceKm,
        womenOnlyBatch: r.centre.womenOnlyBatch,
        components: r.components,
      });

      let z = TRUTH_BIAS;
      for (const [f, w] of Object.entries(TRUTH)) z += w! * x[idx(f as FeatureName)];
      // The interaction: long travel on a full-time course is worse for women
      // than either factor alone suggests.
      if (x[idx("femaleFar")] && r.course.mode === "full_time") z -= 0.6;
      z += (rand() - 0.5) * 1.0; // unexplained variation

      const p = 1 / (1 + Math.exp(-z));
      rows.push({ x, y: rand() < p ? 1 : 0, ruleScore: r.score, source: "synthetic" });
    }
  }

  return rows;
}
