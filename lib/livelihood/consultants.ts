/**
 * Matching people who choose self-employment to a financial consultant —
 * someone who helps with the project report, loan papers and subsidy claims.
 *
 * Only verified consultants with free capacity are ever matched: handing a
 * first-time entrepreneur to an unvetted or overloaded adviser is worse than
 * telling the officer no one is available, which the dashboard then shows as
 * a coverage gap.
 */

import { CONSULTANTS } from "./catalog";
import type { Consultant, Course, Profile } from "./types";

export function needsConsultant(profile: Profile, course: Course): boolean {
  return profile.preference !== "wage" && course.outcome !== "wage";
}

/**
 * The live registry — verification and current load come from storage, so
 * the voice server replaces this whenever either changes. Until then, the
 * shipped sample list.
 */
let registry: Consultant[] = CONSULTANTS;

export function setConsultantRegistry(list: Consultant[]): void {
  registry = list;
}

export function consultantRegistry(): Consultant[] {
  return registry;
}

export function matchConsultant(profile: Profile): Consultant | undefined {
  const candidates = registry.filter(
    (c) =>
      c.district === profile.district &&
      c.verified &&
      c.activeCases < c.capacity &&
      c.languages.includes(profile.language),
  );

  const rank = (c: Consultant) =>
    // Covering the person's own block beats everything: it is who can
    // actually visit. Spare capacity breaks ties.
    (c.blocks.includes(profile.block) ? 2 : 0) + (c.capacity - c.activeCases) / c.capacity;

  return candidates.sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))[0];
}
