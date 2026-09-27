/**
 * Turning one spoken answer into one slot value — dictionary first.
 *
 * Most answers to a narrow question are a handful of predictable words
 * ("आठवीं", "खेती", "अपना काम"), so a phrase table resolves them for free and
 * instantly. The LLM is only consulted when the table misses (see
 * llm-extract.ts), and whatever it returns is validated against the same
 * allowed values, so a model can never put an invented value into a profile.
 */

import synonyms from "../../data/synonyms.json";
import { DISTRICTS, TRADES } from "./catalog";
import {
  allKeys,
  bestKey,
  editDistance,
  findPhrase,
  hasAny,
  normalize as normalizeWord,
  numbersIn,
  tokens,
} from "./text";
import { learnedValue } from "./learned";
import type { Asset, Constraint, Preference, Profile, Sector } from "./types";

export type SlotId =
  | "district"
  | "block"
  | "education"
  | "currentWork"
  | "familyTrade"
  | "continueFamilyTrade"
  | "interests"
  | "preference"
  | "travel"
  | "hours"
  | "learning"
  | "familySupport"
  | "constraints"
  | "assets"
  | "aspiration";

/** What an answer contributes to the profile. "none" answers are still answers. */
export type SlotValue = Partial<Profile> & {
  answeredNone?: boolean;
  /** The district answer named a real place outside the districts we cover. */
  outsidePlace?: string;
};

const S = synonyms as unknown as {
  yes: string[];
  no: string[];
  intents: Record<string, string[]>;
  education: Record<string, string[]>;
  trades: Record<string, string[]>;
  sectors: Record<string, string[]>;
  continueTrade: Record<string, string[]>;
  preference: Record<string, string[]>;
  travel: Record<string, string[]>;
  relocate: string[];
  hours: Record<string, string[]>;
  learning: Record<string, string[]>;
  constraints: Record<string, string[]>;
  assets: Record<string, string[]>;
  gender: Record<string, string[]> & { selfMarking: Record<string, string[]> };
};

export const SECTOR_IDS = Object.keys(S.sectors) as Sector[];
export const TRADE_IDS = Object.keys(TRADES);

// ---------------------------------------------------------------------------
// Yes / no and intents
// ---------------------------------------------------------------------------

/**
 * Yes, no, or unclear.
 *
 * Decided by whichever comes FIRST, not whichever exists: "हाँ, कोई दिक्कत
 * नहीं" is a yes, while "जी नहीं" is a no — so "जी नहीं" is listed as its own
 * phrase and the longer match wins at the same position.
 */
export function yesNo(text: string): boolean | undefined {
  const toks = tokens(text);
  const hits: { at: number; len: number; yes: boolean }[] = [];

  const collect = (phrases: string[], yes: boolean) => {
    for (const ph of phrases) {
      for (const m of findPhrase(toks, ph)) {
        hits.push({ at: m.start, len: m.end - m.start, yes });
      }
    }
  };

  collect([...S.no, "जी नहीं", "जी ना"], false);
  collect(S.yes, true);

  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  return hits[0]?.yes;
}

export type Intent = "repeat" | "human" | "more" | "why";

export function intentOf(text: string): Intent | undefined {
  const toks = tokens(text);
  return bestKey(toks, S.intents) as Intent | undefined;
}

/** "पहला" / "दूसरा" / "तीसरा" / "1" -> 0-based index. */
export function ordinalOf(text: string): number | undefined {
  const toks = tokens(text);
  const table: Record<string, string[]> = {
    "0": ["पहला", "पहले", "पहली", "एक नंबर", "1", "पहिला", "पहिली", "first", "पयलो", "पयली", "మొదటి", "మొదటిది", "প্রথম", "প্ৰথম"],
    "1": ["दूसरा", "दूसरे", "दूसरी", "दो नंबर", "2", "दुसरा", "दुसरी", "second", "दुसरो", "రెండవ", "రెండవది", "দ্বিতীয়", "দুই নম্বর"],
    "2": ["तीसरा", "तीसरे", "तीसरी", "तीन नंबर", "3", "तिसरा", "तिसरी", "third", "तिसरो", "మూడవ", "మూడవది", "তৃতীয়"],
  };
  const key = bestKey(toks, table);
  return key === undefined ? undefined : Number(key);
}

/**
 * Speaker gender from first-person verb endings — never asked outright.
 * Only read from first-person sentences, so talk about a parent does not count.
 */
export function genderOf(text: string): Profile["gender"] | undefined {
  const toks = tokens(text);

  const { selfMarking, ...plain } = S.gender;
  const own = bestKey(toks, selfMarking);
  if (own) return own as Profile["gender"];

  // "मैं" is often dropped ("आठवीं तक पढ़ा हूँ"), but "हूँ" is first person on
  // its own; talk about others uses "था/थे/है" instead.
  const firstPerson = toks.some(
    (t) => t === "मैं" || t === "मैंने" || t === normalizeWord("हूँ") || t === "मी",
  );
  if (!firstPerson) return undefined;
  return bestKey(toks, plain as Record<string, string[]>) as Profile["gender"] | undefined;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

function placeMatch(toks: string[], name: string): boolean {
  const target = tokens(name);
  if (target.length === 0) return false;

  if (findPhrase(toks, name).length > 0) return true;

  // Single-word names tolerate one slip of STT spelling ("बबिना" for "बबीना"),
  // but only for names long enough that one edit is not a different word.
  if (target.length === 1 && target[0].length >= 4) {
    return toks.some((t) => editDistance(t, target[0]) <= 1);
  }

  return false;
}

/**
 * District, and the block too when the person named it directly — "बबीना
 * से हूँ" answers both questions at once, and asking again would be a wasted
 * turn.
 */
function extractDistrict(text: string): SlotValue | undefined {
  const toks = tokens(text);

  for (const d of DISTRICTS) {
    for (const b of d.blocks) {
      // A block named after its district ("झांसी शहर") is only a block match
      // when said in full; the bare district name is ambiguous.
      if (placeMatch(toks, b.nameHi) || placeMatch(toks, b.name)) {
        const bare = tokens(b.nameHi)[0] === tokens(d.nameHi)[0];
        if (!bare || findPhrase(toks, b.nameHi).length > 0) {
          return { district: d.id, block: b.name };
        }
      }
    }
  }

  for (const d of DISTRICTS) {
    if (placeMatch(toks, d.nameHi) || placeMatch(toks, d.name)) {
      return { district: d.id };
    }
  }

  return undefined;
}

function extractBlock(text: string, districtId: string | undefined): SlotValue | undefined {
  const d = DISTRICTS.find((x) => x.id === districtId);
  if (!d) return undefined;

  const toks = tokens(text);

  for (const b of d.blocks) {
    if (placeMatch(toks, b.nameHi) || placeMatch(toks, b.name)) return { block: b.name };
  }

  // "शहर में" / "शहर" alone means the block named after the district's town.
  if (hasAny(toks, ["शहर", "शहर में"])) {
    const town = d.blocks.find((b) => tokens(b.nameHi)[0] === tokens(d.nameHi)[0]);
    if (town) return { block: town.name };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

function extractEducation(text: string): SlotValue | undefined {
  const toks = tokens(text);
  const key = bestKey(toks, S.education);
  if (key !== undefined) return { education: Number(key) };

  // "कक्षा 7", "7 तक", "12th" — a bare number in a schooling answer is a class.
  const n = numbersIn(text).find((x) => x >= 0 && x <= 16);
  if (n !== undefined) return { education: n > 12 ? 15 : n };

  return undefined;
}

function extractTrade(text: string, slot: "currentWork" | "familyTrade"): SlotValue | undefined {
  const toks = tokens(text);

  // A named trade beats "no work" whatever the phrase lengths: in "मैं खेती
  // करता हूँ, कोई और काम नहीं" the longer "काम नहीं" must not erase the farming.
  const { none, ...named } = S.trades;
  const key = bestKey(toks, named);
  if (key !== undefined) return { [slot]: key } as SlotValue;

  return hasAny(toks, none) ? { answeredNone: true } : undefined;
}

function extractContinue(text: string): SlotValue | undefined {
  const key = bestKey(tokens(text), S.continueTrade);
  if (key !== undefined) return { continueFamilyTrade: key === "true" };

  const yn = yesNo(text);
  return yn === undefined ? undefined : { continueFamilyTrade: yn };
}

function extractInterests(text: string): SlotValue | undefined {
  const toks = tokens(text);
  const sectors = allKeys(toks, S.sectors) as Sector[];
  if (sectors.length > 0) return { interestSectors: sectors };

  // "कुछ भी", "पता नहीं" — an honest answer; show a broad set instead.
  if (hasAny(toks, S.preference.either)) return { interestSectors: [], answeredNone: true };
  return undefined;
}

function extractPreference(text: string): SlotValue | undefined {
  const key = bestKey(tokens(text), S.preference);
  return key ? { preference: key as Preference } : undefined;
}

function extractTravel(text: string): SlotValue | undefined {
  const toks = tokens(text);

  if (hasAny(toks, S.relocate)) return { maxTravelKm: 50, canRelocate: true };

  const n = numbersIn(text).find((x) => x > 0 && x <= 200);
  if (n !== undefined) return { maxTravelKm: n, canRelocate: false };

  const key = bestKey(toks, S.travel);
  return key ? { maxTravelKm: Number(key), canRelocate: false } : undefined;
}

function extractHours(text: string): SlotValue | undefined {
  const n = numbersIn(text).find((x) => x > 0 && x <= 12);
  if (n !== undefined) return { hoursPerDay: n };

  const key = bestKey(tokens(text), S.hours);
  return key ? { hoursPerDay: Number(key) } : undefined;
}

function extractLearning(text: string): SlotValue | undefined {
  const key = bestKey(tokens(text), S.learning);
  return key ? { learning: key as Profile["learning"] } : undefined;
}

function extractFamilySupport(text: string): SlotValue | undefined {
  const yn = yesNo(text);
  return yn === undefined ? undefined : { familySupport: yn };
}

function extractConstraints(text: string): SlotValue | undefined {
  const toks = tokens(text);
  const found = allKeys(toks, S.constraints) as Constraint[];
  if (found.length > 0) return { constraints: found };

  const yn = yesNo(text);
  if (yn === false) return { constraints: [], answeredNone: true };
  // A bare "yes" without saying what: be protective and avoid heavy work.
  if (yn === true) return { constraints: ["no_heavy_work"] };
  return undefined;
}

function extractAssets(text: string): SlotValue | undefined {
  const toks = tokens(text);
  const found = allKeys(toks, S.assets) as Asset[];
  if (found.length > 0) return { assets: found };

  if (yesNo(text) === false || hasAny(toks, ["कुछ नहीं", "कुछ भी नहीं"])) {
    return { assets: [], answeredNone: true };
  }
  return undefined;
}

function extractAspiration(text: string): SlotValue | undefined {
  if (!text.trim()) return undefined;
  const income = numbersIn(text).find((x) => x >= 1000);
  return { aspiration: { goal: text.trim(), targetMonthlyIncome: income } };
}

export function extractSlot(
  slot: SlotId,
  text: string,
  profile: Partial<Profile>,
): SlotValue | undefined {
  const fromDictionary = extractFromDictionary(slot, text, profile);
  if (fromDictionary) return fromDictionary;

  // Words people taught the system from the unknown-word queue — dialect the
  // shipped dictionary does not know yet. Validated like any other answer.
  const learned = learnedValue(slot, text);
  return learned === undefined ? undefined : slotValueFrom(slot, learned);
}

function extractFromDictionary(
  slot: SlotId,
  text: string,
  profile: Partial<Profile>,
): SlotValue | undefined {
  switch (slot) {
    case "district":
      return extractDistrict(text);
    case "block":
      return extractBlock(text, profile.district);
    case "education":
      return extractEducation(text);
    case "currentWork":
    case "familyTrade":
      return extractTrade(text, slot);
    case "continueFamilyTrade":
      return extractContinue(text);
    case "interests":
      return extractInterests(text);
    case "preference":
      return extractPreference(text);
    case "travel":
      return extractTravel(text);
    case "hours":
      return extractHours(text);
    case "learning":
      return extractLearning(text);
    case "familySupport":
      return extractFamilySupport(text);
    case "constraints":
      return extractConstraints(text);
    case "assets":
      return extractAssets(text);
    case "aspiration":
      return extractAspiration(text);
  }
}

/**
 * The values a slot may take — the only answers an LLM fallback is allowed to
 * return, so its output can be checked rather than trusted.
 */
export function allowedValues(slot: SlotId): string[] | "number" | "free" {
  switch (slot) {
    case "district":
      return DISTRICTS.map((d) => d.id);
    case "currentWork":
    case "familyTrade":
      return [...TRADE_IDS, "none"];
    case "interests":
      return SECTOR_IDS;
    case "preference":
      return ["self", "wage", "either"];
    case "continueFamilyTrade":
    case "familySupport":
      return ["true", "false"];
    case "learning":
      return ["hands_on", "classroom", "either"];
    case "constraints":
      return ["no_heavy_work", "limited_mobility", "visual", "hearing", "none"];
    case "assets":
      return ["land", "livestock", "shop_space", "tools", "savings", "none"];
    case "education":
    case "travel":
    case "hours":
      return "number";
    case "block":
    case "aspiration":
      return "free";
  }
}

/**
 * A raw value (from the LLM, or an officer's mapping of an unknown word) as
 * profile fields — or undefined unless it is one of the slot's allowed values.
 * The single gate every non-dictionary answer passes through.
 */
export function slotValueFrom(slot: SlotId, raw: unknown): SlotValue | undefined {
  const allowed = allowedValues(slot);

  if (allowed === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    if (slot === "education" && n <= 16) return { education: n > 12 ? 15 : n };
    if (slot === "travel" && n <= 200) return { maxTravelKm: n, canRelocate: false };
    if (slot === "hours" && n <= 12) return { hoursPerDay: n };
    return undefined;
  }

  if (allowed === "free") return undefined;

  const list = (Array.isArray(raw) ? raw : [raw]).map(String).filter((v) => allowed.includes(v));
  if (list.length === 0) return undefined;

  switch (slot) {
    case "district":
      return { district: list[0] };
    case "currentWork":
    case "familyTrade":
      return list[0] === "none" ? { answeredNone: true } : ({ [slot]: list[0] } as SlotValue);
    case "interests":
      return { interestSectors: list as Sector[] };
    case "preference":
      return { preference: list[0] as Preference };
    case "continueFamilyTrade":
      return { continueFamilyTrade: list[0] === "true" };
    case "familySupport":
      return { familySupport: list[0] === "true" };
    case "learning":
      return { learning: list[0] as Profile["learning"] };
    case "constraints": {
      const c = list.filter((v) => v !== "none") as Constraint[];
      return { constraints: c, answeredNone: c.length === 0 };
    }
    case "assets": {
      const a = list.filter((v) => v !== "none") as Asset[];
      return { assets: a, answeredNone: a.length === 0 };
    }
    default:
      return undefined;
  }
}
