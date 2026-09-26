/**
 * Profile -> ranked, explained course recommendations.
 *
 * Pure code, no model calls: the same profile always gets the same answer,
 * every number spoken to the person comes from the catalogue, and each pick
 * carries the reasons that produced it. The LLM only ever phrases what this
 * returns.
 *
 * Two stages. Hard filters remove what the person cannot do (schooling below
 * the minimum, heavy work they have ruled out, no centre within reach). The
 * survivors are scored on five weighted components and diversified to at most
 * one course per sector, so the three options are genuinely different paths
 * rather than three variants of one.
 */

import {
  CENTRES,
  COURSES,
  SCHEMES,
  TRADES,
  distanceKm,
  getBlock,
  getDistrict,
} from "./catalog";
import { completionFor } from "../ml/model";
import { matchConsultant, needsConsultant } from "./consultants";
import { opportunitiesFor } from "./opportunities";
import { skillGap } from "./skill-gap";
import type {
  Centre,
  Course,
  Profile,
  Reason,
  Recommendation,
  RecommendResult,
} from "./types";

/**
 * How much the completion model moves the final score. Kept modest: the rules
 * encode what the person asked for, the model how likely they are to finish,
 * and the first must not be overruled by a model trained on synthetic data.
 */
const MODEL_WEIGHT = 0.15;

/** Measured placement rates by course, once enough outcomes exist (see setOutcomeRates). */
let outcomeRates: Record<string, { rate: number; n: number }> = {};
const MIN_OUTCOMES = 5;

/**
 * Feed back real results: courses whose graduates rarely find work rank lower.
 * Only applied with at least MIN_OUTCOMES outcomes, so one unlucky batch does
 * not bury a course.
 */
export function setOutcomeRates(rates: Record<string, { rate: number; n: number }>): void {
  outcomeRates = rates;
}

export type RecommendOptions = { useModel?: boolean };

export const WEIGHTS = {
  interest: 0.35,
  familyTrade: 0.2,
  demand: 0.25,
  preference: 0.15,
  level: 0.05,
} as const;

/** How far someone willing to relocate can be sent. */
const RELOCATE_KM = 300;

/** Top-two gap below which the interview asks one more question. */
const CLARIFY_MARGIN = 0.05;

/** Full-time courses for someone with only a few free hours are discounted. */
const SHORT_ON_TIME_HOURS = 4;
const FULL_TIME_PENALTY = 0.85;

/** Demand used when a district has no figure for a sector yet. */
const UNKNOWN_DEMAND = 0.3;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function familySector(profile: Profile) {
  return profile.familyTrade ? TRADES[profile.familyTrade]?.sector ?? null : null;
}

function passesFilters(profile: Profile, course: Course): boolean {
  if (course.minEducation > profile.education) return false;

  const avoidsHeavyWork =
    profile.constraints.includes("no_heavy_work") ||
    profile.constraints.includes("limited_mobility");
  if (avoidsHeavyWork && course.physicallyDemanding) return false;

  // Someone who wants to leave the family trade is not shown it again unless
  // they named it as an interest themselves.
  if (
    profile.continueFamilyTrade === false &&
    course.sector === familySector(profile) &&
    !profile.interestSectors.includes(course.sector)
  ) {
    return false;
  }

  return true;
}

/** How far to look when offering a farther course the person asked for. */
const STRETCH_KM = 150;

/** The closest centre running this course within the person's reach. */
function nearestCentre(
  profile: Profile,
  course: Course,
  limitOverride?: number,
): { centre: Centre; distanceKm: number } | undefined {
  const home = getBlock(profile.district, profile.block);
  if (!home) return undefined;

  const limit = limitOverride ?? (profile.canRelocate ? RELOCATE_KM : profile.maxTravelKm);
  const needsAccess = profile.constraints.includes("limited_mobility");

  let best: { centre: Centre; distanceKm: number } | undefined;

  for (const centre of CENTRES) {
    if (!centre.courses.includes(course.id)) continue;
    if (needsAccess && !centre.accessible) continue;

    const d = distanceKm(home, centre);
    if (d > limit) continue;

    if (!best || d < best.distanceKm) best = { centre, distanceKm: d };
  }

  return best;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function familyTradeScore(profile: Profile, course: Course): number {
  const fit = (key: string | undefined) => {
    const trade = key ? TRADES[key] : undefined;
    if (!trade) return 0;
    if (trade.pathway.includes(course.id)) return 1;
    return trade.sector === course.sector ? 0.7 : 0;
  };

  // Not yet asked counts half: a trade is a strong hint, but only the person
  // can say whether they want to stay in it.
  const familyWeight =
    profile.continueFamilyTrade === true ? 1 : profile.continueFamilyTrade === false ? 0 : 0.5;

  // Current work is what they do today, by their own account, so it counts in
  // full.
  return Math.max(fit(profile.familyTrade) * familyWeight, fit(profile.currentWork));
}

function preferenceScore(profile: Profile, course: Course): number {
  const table: Record<string, Record<string, number>> = {
    self: { self: 1, both: 0.7, wage: 0.1 },
    wage: { wage: 1, both: 0.7, self: 0.1 },
    either: { self: 0.7, both: 0.7, wage: 0.7 },
  };

  let score = table[profile.preference][course.outcome];

  // Land, animals or a shop space make self-employment in the matching trade
  // far more realistic — the asset is often the missing half of the business.
  if (course.outcome !== "wage" && hasHelpfulAsset(profile, course)) {
    score = Math.min(1, score + 0.3);
  }

  return score;
}

function hasHelpfulAsset(profile: Profile, course: Course): boolean {
  return course.helpfulAssets.some((a) => profile.assets.includes(a));
}

/** The NSQF level a person's schooling most naturally leads into. */
function expectedLevel(education: number): number {
  if (education >= 15) return 5;
  if (education >= 12) return 4.5;
  if (education >= 10) return 4;
  return 3;
}

function levelScore(profile: Profile, course: Course): number {
  return Math.max(0, 1 - Math.abs(course.nsqfLevel - expectedLevel(profile.education)) / 2);
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

const ASSET_HI: Record<string, string> = {
  land: "ज़मीन",
  livestock: "पशु",
  shop_space: "दुकान की जगह",
  tools: "औज़ार",
  savings: "कुछ बचत",
};

function reasonsFor(
  profile: Profile,
  course: Course,
  rec: Omit<Recommendation, "reasons" | "schemes" | "consultant" | "completion" | "opportunities">,
): Reason[] {
  const out: Reason[] = [];
  const km = Math.round(rec.distanceKm);

  if (rec.components.interest > 0) {
    out.push({ code: "interest", hi: "आपकी रुचि इसी काम में है", en: "Matches your interest" });
  }

  if (rec.components.familyTrade >= 0.7) {
    out.push({
      code: "family_trade",
      hi: "आपके पहले के काम से आगे बढ़ने का रास्ता",
      en: "Builds on work you already know",
    });
  }

  if (rec.skillGap.rpl) {
    out.push({
      code: "rpl",
      hi: "आपको काम पहले से आता है — छोटे आकलन से सीधा प्रमाणपत्र मिल सकता है",
      en: "You already know most of this — you may be certified through RPL",
    });
  }

  if (rec.components.demand >= 0.7) {
    out.push({
      code: "demand",
      hi: "आपके ज़िले में इस काम की माँग है",
      en: "In demand in your district",
    });
  } else if (rec.components.demand >= 0.5) {
    out.push({
      code: "demand_moderate",
      hi: "आपके ज़िले में इस काम की ठीक-ठाक माँग है",
      en: "Moderate demand in your district",
    });
  }

  if (rec.components.level === 1) {
    out.push({
      code: "level",
      hi: "आपकी पढ़ाई के हिसाब से सही स्तर का कोर्स है",
      en: "Right level for your schooling",
    });
  }

  const asset = course.helpfulAssets.find((a) => profile.assets.includes(a));
  if (asset && course.outcome !== "wage") {
    out.push({
      code: "asset",
      hi: `आपके पास पहले से ${ASSET_HI[asset]} है`,
      en: `You already have ${asset.replace("_", " ")}`,
      vars: { asset },
    });
  }

  if (km <= 15) {
    out.push({
      code: "near",
      hi: `सेंटर पास में है, लगभग ${km} किलोमीटर`,
      en: `Centre is nearby, about ${km} km`,
      vars: { km },
    });
  }

  const shortOnTime =
    profile.hoursPerDay !== undefined && profile.hoursPerDay <= SHORT_ON_TIME_HOURS;
  if (shortOnTime && course.mode === "part_time") {
    out.push({ code: "part_time", hi: "कम समय में भी कर सकते हैं", en: "Fits a few hours a day" });
  }

  if (course.homeBased && (profile.maxTravelKm <= 10 || profile.constraints.includes("limited_mobility"))) {
    out.push({ code: "home_based", hi: "बाद में घर से काम हो सकता है", en: "Can be done from home" });
  }

  if (profile.gender === "female" && rec.centre.womenOnlyBatch) {
    out.push({ code: "women_batch", hi: "महिलाओं के लिए अलग बैच है", en: "Women-only batch available" });
  }

  return out;
}

// ---------------------------------------------------------------------------

function score(profile: Profile, course: Course, opts: RecommendOptions): Recommendation | undefined {
  if (!passesFilters(profile, course)) return undefined;

  const reach = nearestCentre(profile, course);
  if (!reach) return undefined;

  const district = getDistrict(profile.district);

  const components = {
    interest: profile.interestSectors.includes(course.sector) ? 1 : 0,
    familyTrade: familyTradeScore(profile, course),
    demand: district?.demand[course.sector] ?? UNKNOWN_DEMAND,
    preference: preferenceScore(profile, course),
    level: levelScore(profile, course),
  };

  let total =
    WEIGHTS.interest * components.interest +
    WEIGHTS.familyTrade * components.familyTrade +
    WEIGHTS.demand * components.demand +
    WEIGHTS.preference * components.preference +
    WEIGHTS.level * components.level;

  if (
    profile.hoursPerDay !== undefined &&
    profile.hoursPerDay <= SHORT_ON_TIME_HOURS &&
    course.mode === "full_time"
  ) {
    total *= FULL_TIME_PENALTY;
  }

  const completion =
    opts.useModel === false
      ? undefined
      : completionFor({
          profile,
          course,
          distanceKm: reach.distanceKm,
          womenOnlyBatch: reach.centre.womenOnlyBatch,
          components,
        });

  if (completion) total = (1 - MODEL_WEIGHT) * total + MODEL_WEIGHT * completion.p;

  const outcome = outcomeRates[course.id];
  if (outcome && outcome.n >= MIN_OUTCOMES) total *= 0.8 + 0.4 * outcome.rate;

  const base = {
    course,
    score: Math.round(total * 1000) / 1000,
    components,
    centre: reach.centre,
    distanceKm: Math.round(reach.distanceKm * 10) / 10,
    skillGap: skillGap(profile, course),
    completion,
  };

  const consultant = needsConsultant(profile, course) ? matchConsultant(profile) : undefined;

  const schemes = SCHEMES.filter(
    (s) =>
      s.id === "pmajay_gia" ||
      (s.id === "rpl" && base.skillGap.rpl) ||
      (s.id === "enterprise_loans" && needsConsultant(profile, course)),
  );

  return {
    ...base,
    reasons: reasonsFor(profile, course, base),
    consultant,
    schemes,
    opportunities: opportunitiesFor(profile.district, course.sector, profile.block),
  };
}

export function recommend(profile: Profile, limit = 3, opts: RecommendOptions = {}): RecommendResult {
  const ranked = COURSES.map((c) => score(profile, c, opts))
    .filter((r): r is Recommendation => r !== undefined)
    // Id as tie-break so equal scores never reorder between runs.
    .sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id));

  const picks: Recommendation[] = [];
  const sectors = new Set<string>();

  for (const r of ranked) {
    if (picks.length >= limit) break;
    if (sectors.has(r.course.sector)) continue;

    picks.push(r);
    sectors.add(r.course.sector);
  }

  const more = ranked.filter((r) => !picks.includes(r));

  const clarify =
    picks.length >= 2 && picks[0].score - picks[1].score < CLARIFY_MARGIN;

  // Nothing they asked for is within reach: find the nearest thing that is.
  const wanted = profile.interestSectors;
  const served = picks.some((p) => wanted.includes(p.course.sector));
  let farther: Recommendation | undefined;

  if (wanted.length > 0 && !served && !profile.canRelocate) {
    const stretched = { ...profile, maxTravelKm: STRETCH_KM };
    farther = COURSES.filter((c) => wanted.includes(c.sector))
      .map((c) => score(stretched, c, opts))
      .filter((r): r is Recommendation => r !== undefined)
      .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)[0];
  }

  return { picks, more, clarify, farther };
}
