/**
 * k-means over beneficiary profiles, to describe a district's people as a few
 * recognisable groups ("कम पढ़े, घर के पास, अपना काम") for the perspective
 * plan: how many batches of what, and where.
 *
 * Seeded, so the same records always give the same groups and a report does
 * not reshuffle on refresh.
 */

import type { Profile } from "../livelihood/types";

export type Cluster = {
  size: number;
  centroid: number[];
  label: { en: string; hi: string };
};

export const CLUSTER_DIMENSIONS = ["education", "travel", "hours", "selfEmployed", "female", "hasAssets"] as const;

export function profileVector(p: Partial<Profile>): number[] {
  return [
    Math.min((p.education ?? 0) / 15, 1),
    Math.min((p.maxTravelKm ?? 15) / 50, 1),
    Math.min((p.hoursPerDay ?? 6) / 8, 1),
    p.preference === "self" ? 1 : p.preference === "wage" ? 0 : 0.5,
    p.gender === "female" ? 1 : 0,
    (p.assets?.length ?? 0) > 0 ? 1 : 0,
  ];
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

/** Describe a group by what sets its centre apart. */
export function labelFor(c: number[]): { en: string; hi: string } {
  const [edu, travel, hours, self, female, assets] = c;
  const en: string[] = [];
  const hi: string[] = [];

  if (female > 0.6) { en.push("mostly women"); hi.push("ज़्यादातर महिलाएँ"); }
  en.push(edu < 0.45 ? "little schooling" : edu > 0.7 ? "10th pass or more" : "middle school");
  hi.push(edu < 0.45 ? "कम पढ़े" : edu > 0.7 ? "दसवीं या ज़्यादा" : "आठवीं तक");
  if (travel < 0.3) { en.push("need training near home"); hi.push("घर के पास ट्रेनिंग"); }
  if (hours < 0.6) { en.push("few free hours"); hi.push("कम समय"); }
  en.push(self > 0.65 ? "want own business" : self < 0.35 ? "want a job" : "open to job or business");
  hi.push(self > 0.65 ? "अपना काम" : self < 0.35 ? "नौकरी" : "नौकरी या अपना काम");
  if (assets > 0.6) { en.push("have land/animals/tools"); hi.push("साधन पास में"); }

  return { en: en.join(", "), hi: hi.join(", ") };
}

export function kmeans(points: number[][], k: number, seed = 7, iterations = 50): Cluster[] {
  if (points.length === 0) return [];
  const K = Math.min(k, points.length);
  const rand = rng(seed);

  // k-means++ start: spread the first centres out.
  const centres: number[][] = [points[Math.floor(rand() * points.length)]];
  while (centres.length < K) {
    const d = points.map((p) => Math.min(...centres.map((c) => dist2(p, c))));
    const total = d.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    const i = d.findIndex((v) => (r -= v) <= 0);
    centres.push(points[i >= 0 ? i : points.length - 1]);
  }

  let assign: number[] = [];

  for (let it = 0; it < iterations; it++) {
    assign = points.map((p) => {
      let best = 0;
      for (let c = 1; c < K; c++) if (dist2(p, centres[c]) < dist2(p, centres[best])) best = c;
      return best;
    });

    for (let c = 0; c < K; c++) {
      const members = points.filter((_, i) => assign[i] === c);
      if (members.length) centres[c] = centres[c].map((_, j) => members.reduce((s, m) => s + m[j], 0) / members.length);
    }
  }

  return centres
    .map((centroid, c) => ({
      size: assign.filter((a) => a === c).length,
      centroid: centroid.map((v) => Math.round(v * 100) / 100),
      label: labelFor(centroid),
    }))
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size);
}
