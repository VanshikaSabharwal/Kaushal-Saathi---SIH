/**
 * The static catalogue: courses, centres, districts, trades, consultants and
 * schemes, read from data/*.json.
 *
 * Bundled as JSON imports rather than read at runtime so the Next build, the
 * voice server (tsx) and the verify scripts all resolve the same files without
 * caring about the working directory. Moving these into MongoDB later only
 * changes this module.
 */

import coursesFile from "../../data/courses.json";
import centresFile from "../../data/centres.json";
import districtsFile from "../../data/districts.json";
import tradesFile from "../../data/trades.json";
import skillsFile from "../../data/skills.json";
import consultantsFile from "../../data/consultants.json";
import schemesFile from "../../data/schemes.json";
import type {
  Block,
  Centre,
  Consultant,
  Course,
  District,
  Scheme,
  Trade,
} from "./types";

export const COURSES = coursesFile.courses as Course[];
export const CENTRES = centresFile.centres as Centre[];
export const DISTRICTS = districtsFile.districts as District[];
export const TRADES = tradesFile.trades as Record<string, Trade>;
export const SKILLS = skillsFile.skills as Record<
  string,
  { hi: string; en: string; foundation?: boolean }
>;
export const CONSULTANTS = consultantsFile.consultants as Consultant[];
export const SCHEMES = schemesFile.schemes as Scheme[];

const courseById = new Map(COURSES.map((c) => [c.id, c]));
const districtById = new Map(DISTRICTS.map((d) => [d.id, d]));

export function getCourse(id: string): Course | undefined {
  return courseById.get(id);
}

export function getDistrict(id: string): District | undefined {
  return districtById.get(id);
}

export function getBlock(districtId: string, blockName: string): Block | undefined {
  return getDistrict(districtId)?.blocks.find(
    (b) => b.name.toLowerCase() === blockName.toLowerCase(),
  );
}

export function skillLabel(id: string, lang: "hi" | "en"): string {
  return SKILLS[id]?.[lang] ?? id;
}

/**
 * Straight-line distance in km.
 *
 * Roads are longer than this, which is why every distance spoken to a person
 * is prefixed "लगभग" (about). Good enough to rank centres and to apply a
 * travel limit; not good enough to promise a journey time.
 */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
