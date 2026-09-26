/**
 * Recommender checks against hand-written personas. Pure computation — no
 * provider calls, no API keys, no database. Run: npm run verify:recommender
 *
 * Each persona encodes an expectation a counsellor would agree with, plus the
 * invariants that must hold for everyone: never a course above the person's
 * schooling, never a centre beyond their reach, never heavy work they ruled
 * out, never the family trade after they said they want to leave it.
 */

import { COURSES, TRADES } from "../lib/livelihood/catalog";
import { recommend } from "../lib/livelihood/recommender";
import type { Profile, RecommendResult } from "../lib/livelihood/types";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

const base: Profile = {
  district: "jhansi",
  block: "Jhansi City",
  language: "hi",
  education: 8,
  interestSectors: [],
  skills: [],
  preference: "either",
  maxTravelKm: 30,
  canRelocate: false,
  constraints: [],
  assets: [],
};

const ids = (r: RecommendResult) => r.picks.map((p) => p.course.id);

/** Invariants every result must satisfy, whoever asked. */
function invariants(label: string, p: Profile, r: RecommendResult): void {
  const all = [...r.picks, ...r.more];

  check(
    `${label}: no course above schooling`,
    all.every((x) => x.course.minEducation <= p.education),
  );

  const limit = p.canRelocate ? 300 : p.maxTravelKm;
  check(
    `${label}: every centre within reach`,
    all.every((x) => x.distanceKm <= limit),
    all.map((x) => `${x.course.id}@${x.distanceKm}km`).join(", "),
  );

  check(
    `${label}: at most one pick per sector`,
    new Set(r.picks.map((x) => x.course.sector)).size === r.picks.length,
  );

  check(
    `${label}: every pick explains itself`,
    r.picks.every((x) => x.reasons.length > 0),
    r.picks.filter((x) => x.reasons.length === 0).map((x) => x.course.id).join(", "),
  );

  // A self-employment pick must come with a consultant from the person's own
  // district, or with none at all — never someone from elsewhere.
  check(
    `${label}: consultants are local`,
    r.picks.every((x) => !x.consultant || x.consultant.district === p.district),
  );
}

// ---------------------------------------------------------------------------

console.log("Recommender\n");

/* Ramesh: 8th pass, father repaired cycles, wants his own workshop near home. */
{
  const p: Profile = {
    ...base,
    block: "Babina",
    familyTrade: "cycle_repair",
    continueFamilyTrade: true,
    interestSectors: ["automotive"],
    preference: "self",
    assets: ["tools"],
  };
  const r = recommend(p);
  const top = r.picks[0];

  invariants("Ramesh", p, r);
  check("Ramesh: top pick is two-wheeler service", top?.course.id === "c_2w_service", ids(r).join(", "));
  check(
    "Ramesh: technician course excluded (needs 10th)",
    ![...r.picks, ...r.more].some((x) => x.course.id === "c_2w_tech"),
  );
  check(
    "Ramesh: gap lists engine and electricals",
    ["engine_basics", "auto_electrical"].every((s) => top?.skillGap.need.includes(s)),
    JSON.stringify(top?.skillGap),
  );
  check(
    "Ramesh: gap does not list skills he has",
    !["tools_handling", "brake_repair", "tyre_repair"].some((s) => top?.skillGap.need.includes(s)),
  );
  check("Ramesh: not sent to RPL (core skills missing)", top?.skillGap.rpl === false);
  check("Ramesh: matched to his block's consultant", top?.consultant?.id === "fc_j1", top?.consultant?.id);
  check(
    "Ramesh: loan scheme mentioned",
    Boolean(top?.schemes.some((s) => s.id === "enterprise_loans")),
  );
}

/* Kamla: potter family, no schooling, wants to grow the craft. */
{
  const p: Profile = {
    ...base,
    block: "Moth",
    education: 0,
    familyTrade: "pottery",
    continueFamilyTrade: true,
    interestSectors: ["handicrafts"],
    preference: "self",
    maxTravelKm: 20,
    gender: "female",
  };
  const r = recommend(p);
  const top = r.picks[0];

  invariants("Kamla", p, r);
  check("Kamla: top pick is terracotta", top?.course.id === "c_terracotta", ids(r).join(", "));
  check("Kamla: routed to RPL (already has the craft)", top?.skillGap.rpl === true, JSON.stringify(top?.skillGap));
  check("Kamla: RPL scheme attached", Boolean(top?.schemes.some((s) => s.id === "rpl")));
  // Consultant B covers Moth but is full; C covers Moth but is unverified.
  check(
    "Kamla: skips full and unverified consultants",
    top?.consultant?.id === "fc_j1",
    top?.consultant?.id,
  );
  check("Kamla: women-only batch mentioned", Boolean(top?.reasons.some((x) => x.code === "women_batch")));
}

/* Sunita: 10th pass, 4 free hours a day, wants tailoring or beauty close by. */
{
  const p: Profile = {
    ...base,
    district: "gaya",
    block: "Bodh Gaya",
    education: 10,
    familyTrade: "farming",
    interestSectors: ["apparel", "beauty"],
    preference: "self",
    maxTravelKm: 15,
    hoursPerDay: 4,
    gender: "female",
  };
  const r = recommend(p);
  const top = r.picks[0];

  invariants("Sunita", p, r);
  check(
    "Sunita: top pick is in her interests",
    Boolean(top && p.interestSectors.includes(top.course.sector)),
    ids(r).join(", "),
  );
  check("Sunita: top pick is part-time", top?.course.mode === "part_time", top?.course.id);
}

/* Imran: 10th pass, family did leatherwork, wants out — into electronics. */
{
  const p: Profile = {
    ...base,
    district: "nashik",
    block: "Nashik City",
    language: "mr",
    education: 10,
    familyTrade: "leatherwork",
    continueFamilyTrade: false,
    interestSectors: ["electronics_repair"],
    preference: "wage",
    maxTravelKm: 25,
  };
  const r = recommend(p);
  const all = [...r.picks, ...r.more];

  invariants("Imran", p, r);
  check("Imran: leather never suggested", !all.some((x) => x.course.sector === "leather"));
  check(
    "Imran: top pick is electronics",
    r.picks[0]?.course.sector === "electronics_repair",
    ids(r).join(", "),
  );
  check("Imran: no consultant for a wage job", r.picks.every((x) => !x.consultant));
}

/* Geeta: back problem, no heavy work; farming family, open to anything. */
{
  const p: Profile = {
    ...base,
    district: "gaya",
    block: "Tekari",
    education: 8,
    familyTrade: "farming",
    constraints: ["no_heavy_work"],
    maxTravelKm: 40,
  };
  const r = recommend(p);
  const all = [...r.picks, ...r.more];

  invariants("Geeta", p, r);
  check("Geeta: nothing physically demanding", all.every((x) => !x.course.physicallyDemanding));
  check("Geeta: still gets options", r.picks.length === 3, ids(r).join(", "));
}

/* An unknown block has no location, so nothing can be placed — never a guess. */
{
  const r = recommend({ ...base, block: "Nowhere" });
  check("Unknown block: no recommendations", r.picks.length === 0);
}

// Catalogue integrity: every pathway and trade points at something real.
{
  const courseIds = new Set(COURSES.map((c) => c.id));
  const broken = Object.entries(TRADES).flatMap(([k, t]) =>
    t.pathway.filter((id) => !courseIds.has(id)).map((id) => `${k}->${id}`),
  );
  check("Catalogue: all trade pathways resolve", broken.length === 0, broken.join(", "));
}

console.log(failures === 0 ? "\nAll recommender checks pass." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
