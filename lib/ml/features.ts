/**
 * Person × course features for the completion-likelihood model.
 *
 * Each feature is something a counsellor would name when asked "will this
 * person finish this course?" — how far the centre is, whether a full-time
 * course fits a few free hours, whether the family is behind it. Every value
 * is scaled to roughly 0–1 so the learned weights read as relative importance.
 */

import type { Course, Profile, Sector } from "../livelihood/types";

export const FEATURES = [
  "distance",
  "fullTimeShortHours",
  "hoursLow",
  "eduStretch",
  "interest",
  "familyTrade",
  "demand",
  "preference",
  "assetMatch",
  "femaleFar",
  "womenBatch",
  "learningMismatch",
  "familySupport",
  "familyAgainst",
  "partTime",
  "durationLong",
] as const;

export type FeatureName = (typeof FEATURES)[number];

/** Plain-language names, for the reasons shown next to every score. */
export const FEATURE_LABELS: Record<FeatureName, { en: string; hi: string }> = {
  distance: { en: "centre distance", hi: "सेंटर की दूरी" },
  fullTimeShortHours: { en: "full-time course, few free hours", hi: "पूरे दिन का कोर्स, पर समय कम" },
  hoursLow: { en: "little free time", hi: "कम समय" },
  eduStretch: { en: "just meets the schooling minimum", hi: "पढ़ाई की शर्त मुश्किल से पूरी" },
  interest: { en: "matches their interest", hi: "रुचि से मेल" },
  familyTrade: { en: "builds on known work", hi: "पहले के काम से जुड़ा" },
  demand: { en: "local demand", hi: "ज़िले में माँग" },
  preference: { en: "fits job/own-business preference", hi: "नौकरी/अपने काम की पसंद से मेल" },
  assetMatch: { en: "has a helpful asset", hi: "काम का साधन पास में" },
  femaleFar: { en: "long travel for a woman", hi: "महिला के लिए लंबी दूरी" },
  womenBatch: { en: "women-only batch", hi: "महिलाओं का अलग बैच" },
  learningMismatch: { en: "teaching style does not suit them", hi: "पढ़ाने का तरीका मेल नहीं खाता" },
  familySupport: { en: "family supports it", hi: "घर वालों का साथ" },
  familyAgainst: { en: "family not supportive", hi: "घर वालों का साथ नहीं" },
  partTime: { en: "part-time course", hi: "कम घंटों का कोर्स" },
  durationLong: { en: "long course", hi: "लंबा कोर्स" },
};

/** Sectors taught mostly in a classroom rather than at a bench or in a field. */
const CLASSROOM: Set<Sector> = new Set(["it_ites", "retail", "healthcare", "hospitality"]);

export type FeatureInput = {
  profile: Profile;
  course: Course;
  distanceKm: number;
  womenOnlyBatch: boolean;
  components: { interest: number; familyTrade: number; demand: number; preference: number };
};

export function featuresOf({ profile: p, course: c, distanceKm, womenOnlyBatch, components }: FeatureInput): number[] {
  const hours = p.hoursPerDay;
  const female = p.gender === "female";
  const classroom = CLASSROOM.has(c.sector);

  const values: Record<FeatureName, number> = {
    distance: Math.min(distanceKm / 50, 1),
    fullTimeShortHours: hours !== undefined && hours <= 4 && c.mode === "full_time" ? 1 : 0,
    hoursLow: hours === undefined ? 0.3 : Math.max(0, (6 - hours) / 6),
    eduStretch: Math.max(0, 1 - (p.education - c.minEducation) / 5),
    interest: components.interest,
    familyTrade: components.familyTrade,
    demand: components.demand,
    preference: components.preference,
    assetMatch: c.helpfulAssets.some((a) => p.assets.includes(a)) ? 1 : 0,
    femaleFar: female && distanceKm > 15 ? 1 : 0,
    womenBatch: female && womenOnlyBatch ? 1 : 0,
    learningMismatch:
      p.learning === "hands_on" && classroom ? 1 : p.learning === "classroom" && !classroom ? 0.5 : 0,
    familySupport: p.familySupport === true ? 1 : 0,
    familyAgainst: p.familySupport === false ? 1 : 0,
    partTime: c.mode === "part_time" ? 1 : 0,
    durationLong: c.durationDays / 120,
  };

  return FEATURES.map((f) => values[f]);
}
