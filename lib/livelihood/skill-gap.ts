/**
 * What a person already knows versus what a course needs.
 *
 * "Have" is inferred from what the interview collected — family trade,
 * current work, skills mentioned outright, and schooling — rather than tested.
 * That makes it a first estimate for counselling; the practical assessment at
 * the centre is what certifies it.
 */

import { SKILLS, TRADES } from "./catalog";
import type { Course, Preference, Profile, SkillGap } from "./types";

/**
 * Share of a course's core skills a person must already have before
 * certification of existing skills (RPL) is suggested instead of training.
 *
 * Deliberately strict. A cycle mechanic has four of the six skills a
 * two-wheeler course lists, but the two missing ones — engines and vehicle
 * electricals — are the heart of the job, so RPL would certify someone who
 * cannot yet do the work.
 */
const RPL_COVERAGE = 0.75;

/** Skills implied by who the person is, before any course is considered. */
export function skillsOf(profile: Profile): Set<string> {
  const have = new Set<string>(profile.skills);

  // A trade's skills are real whether or not the person wants to continue it.
  for (const key of [profile.familyTrade, profile.currentWork]) {
    const trade = key ? TRADES[key] : undefined;
    trade?.skills.forEach((s) => have.add(s));
  }

  if (profile.education >= 5) have.add("reading_basic");
  if (profile.education >= 8) have.add("maths_basic");

  return have;
}

/**
 * Foundation skills a course implies but does not list.
 *
 * Anyone heading for self-employment needs to run the business and take
 * payments, whatever the trade — these are the gaps that most often sink a
 * newly trained person's first shop.
 */
function foundationNeeds(course: Course, preference: Preference): string[] {
  const selfEmployed =
    course.outcome === "self" || (course.outcome === "both" && preference !== "wage");

  return selfEmployed ? ["business_basics", "digital_payments"] : [];
}

const isFoundation = (skill: string) => SKILLS[skill]?.foundation === true;

export function skillGap(profile: Profile, course: Course): SkillGap {
  const have = skillsOf(profile);

  const required = [
    ...new Set([...course.requiredSkills, ...foundationNeeds(course, profile.preference)]),
  ];

  // Coverage is judged on the trade skills alone. Foundation skills are taught
  // as short bridge modules and should not decide between RPL and training.
  const core = course.requiredSkills.filter((s) => !isFoundation(s));
  const coreHave = core.filter((s) => have.has(s));
  const coverage = core.length > 0 ? coreHave.length / core.length : 0;

  return {
    have: required.filter((s) => have.has(s)),
    need: required.filter((s) => !have.has(s)),
    coverage: Math.round(coverage * 100) / 100,
    rpl: course.rplAvailable && coverage >= RPL_COVERAGE,
  };
}
