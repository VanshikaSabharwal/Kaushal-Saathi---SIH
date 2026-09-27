/**
 * The interview: a state machine that decides what to say next.
 *
 * Code owns the conversation. It picks the next question, speaks pre-written
 * lines, and only asks a model to *understand* an answer when the phrase table
 * cannot — so a full interview costs a few hundred tokens at most, and nothing
 * spoken is ever invented.
 *
 * Understanding is checked, not assumed:
 *  - each answer is echoed back inside the next question ("आठवीं, ठीक है।
 *    आजकल आप क्या काम करते हैं?"), which costs no extra turn;
 *  - an answer that cannot be placed gets simple choices, then either a safe
 *    default (optional questions) or a hand-off to a person (required ones);
 *  - the whole profile is read back and confirmed before any recommendation.
 *
 * Pure apart from the optional LLM extractor, so the verify script can drive a
 * whole conversation as text with no keys and no network.
 */

import { getDistrict } from "./catalog";
import {
  extractSlot,
  genderOf,
  intentOf,
  ordinalOf,
  yesNo,
  type SlotId,
  type SlotValue,
} from "./extract";
import {
  detectSwitch,
  durationText,
  educationText,
  fill,
  line,
  reasonText,
  sectorName,
  skillName,
  tpl,
  tradeName,
} from "./i18n";
import type { LlmExtractor } from "./llm-extract";
import { recommend } from "./recommender";
import { hasAny, tokens } from "./text";
import type { Profile, Recommendation, RecommendResult } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Stage =
  | "consent"
  | "slot"
  | "summary"
  | "summaryFix"
  | "clarify"
  | "stretch"
  | "results"
  | "detail"
  | "done"
  | "handoff";

export type InterviewEvent =
  | { type: "interest"; courseId: string; centreId: string }
  | { type: "handoff"; reason: string }
  | { type: "unknown"; slot: SlotId; text: string }
  | { type: "profile"; profile: Partial<Profile> }
  | { type: "recommended"; courseIds: string[] };

export type InterviewState = {
  stage: Stage;
  slot?: SlotId;
  /** Failed tries on the current question. */
  attempts: number;
  profile: Partial<Profile>;
  answered: SlotId[];
  /** Set while re-asking one slot from the summary, to return there after. */
  fixing?: boolean;
  lastSay: string;
  result?: RecommendResult;
  /** Options currently on offer, and which page of "और विकल्प" they are. */
  shown: Recommendation[];
  page: number;
  selected?: number;
  llmCalls: number;
};

export type StepResult = {
  state: InterviewState;
  say: string;
  events: InterviewEvent[];
  /** The conversation is over; the caller may hang up after speaking. */
  end: boolean;
};

export type StepOptions = { llm?: LlmExtractor; signal?: AbortSignal };

// ---------------------------------------------------------------------------
// Question order
// ---------------------------------------------------------------------------

const ORDER: SlotId[] = [
  "district",
  "block",
  "education",
  "currentWork",
  "familyTrade",
  "continueFamilyTrade",
  "interests",
  "preference",
  "travel",
  "hours",
  "learning",
  "familySupport",
  "constraints",
  "assets",
  "aspiration",
];

/** Without these no recommendation is possible, so failure means a person. */
const REQUIRED = new Set<SlotId>(["district", "block", "education"]);

/** What an unanswerable optional question falls back to. */
const DEFAULTS: Partial<Record<SlotId, SlotValue>> = {
  currentWork: { answeredNone: true },
  familyTrade: { answeredNone: true },
  continueFamilyTrade: {},
  interests: { interestSectors: [], answeredNone: true },
  preference: { preference: "either" },
  travel: { maxTravelKm: 15, canRelocate: false },
  hours: {},
  learning: {},
  familySupport: {},
  constraints: { constraints: [] },
  assets: { assets: [] },
  aspiration: {},
};

function skip(slot: SlotId, s: InterviewState): boolean {
  if (slot === "block") return Boolean(s.profile.block);
  if (slot === "continueFamilyTrade") return !s.profile.familyTrade;
  return false;
}

function nextSlot(s: InterviewState): SlotId | undefined {
  return ORDER.find((slot) => !s.answered.includes(slot) && !skip(slot, s));
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

const tOf = (s: InterviewState) => tpl(s.profile.language);

function blockChoices(districtId?: string): string {
  const d = getDistrict(districtId ?? "");
  return d ? d.blocks.map((b) => b.nameHi).join(", ") : "";
}

function blockHi(districtId?: string, block?: string): string {
  return getDistrict(districtId ?? "")?.blocks.find((b) => b.name === block)?.nameHi ?? block ?? "";
}

function question(slot: SlotId, s: InterviewState): string {
  const p = s.profile;
  const t = tOf(s);
  return fill(t.ask[slot], {
    district: getDistrict(p.district ?? "")?.nameHi ?? "",
    choices: blockChoices(p.district),
    trade: tradeName(p.familyTrade, t),
  });
}

function choicesFor(slot: SlotId, s: InterviewState): string {
  return fill(tOf(s).choices[slot], { choices: blockChoices(s.profile.district) });
}

/** The short echo of an answer that opens the next question. */
function ack(slot: SlotId, v: SlotValue, s: InterviewState): string {
  const t = tOf(s);
  const a = t.ack;
  const p = s.profile;

  switch (slot) {
    case "district":
      return fill(a.district, { district: getDistrict(p.district ?? "")?.nameHi ?? "" }) +
        (v.block ? " " + fill(a.block, { block: blockHi(p.district, p.block) }) : "");
    case "block":
      return fill(a.block, { block: blockHi(p.district, p.block) });
    case "education":
      return fill(a.education, { education: educationText(p.education, t) });
    case "currentWork":
      return v.answeredNone ? a.currentWorkNone : fill(a.currentWork, { trade: tradeName(p.currentWork, t) });
    case "familyTrade":
      return v.answeredNone ? a.familyTradeNone : fill(a.familyTrade, { trade: tradeName(p.familyTrade, t) });
    case "continueFamilyTrade":
      return p.continueFamilyTrade ? a.continueFamilyTradeYes : a.continueFamilyTradeNo;
    case "interests":
      return p.interestSectors?.length
        ? fill(a.interests, { sectors: p.interestSectors.map((x) => sectorName(x, t)).join(", ") })
        : a.interestsOpen;
    case "preference":
      return a[`preference${p.preference === "self" ? "Self" : p.preference === "wage" ? "Wage" : "Either"}`];
    case "travel":
      return p.canRelocate ? a.travelRelocate : a.travel;
    case "hours":
      return a.hours;
    case "learning":
      return a.learning;
    case "familySupport":
      return p.familySupport ? a.familySupportYes : a.familySupportNo;
    case "constraints":
      return p.constraints?.length ? a.constraints : a.constraintsNone;
    case "assets":
      return p.assets?.length ? a.assets : a.assetsNone;
    case "aspiration":
      return a.aspiration;
  }
}

function summaryLine(s: InterviewState): string {
  const p = s.profile;
  const t = tOf(s);
  const work = p.currentWork
    ? line(t, "summaryWorkCurrent", { trade: tradeName(p.currentWork, t) })
    : p.familyTrade
      ? line(t, "summaryWorkFamily", { trade: tradeName(p.familyTrade, t) })
      : "";

  return line(t, "summary", {
    block: blockHi(p.district, p.block),
    education: educationText(p.education, t),
    work,
    preference: t.preferenceText[p.preference ?? "either"],
  });
}

function resultsLine(shown: Recommendation[], s: InterviewState): string {
  const t = tOf(s);
  const items = shown.map((r, i) =>
    line(t, "resultItem", {
      ordinal: t.ordinals[i],
      course: r.course.nameHi,
      duration: durationText(r.course.durationDays, t),
      centreBlock: blockHi(r.centre.district, r.centre.block),
      km: Math.max(1, Math.round(r.distanceKm)),
      reason: reasonText(r.reasons[0], t, s.profile.language),
    }),
  );

  return [[line(t, "resultsIntro", { count: shown.length }), ...items].join(" "), line(t, "resultsAsk")].join("\n");
}

function detailLine(r: Recommendation, s: InterviewState): string {
  const t = tOf(s);
  const label = (ids: string[]) => ids.map((id) => skillName(id, s.profile.language)).join(", ");
  const parts = [
    r.skillGap.have.length
      ? line(t, "detail", { course: r.course.nameHi, have: label(r.skillGap.have), need: label(r.skillGap.need) })
      : line(t, "detailNoHave", { course: r.course.nameHi, need: label(r.skillGap.need) }),
  ];

  if (r.skillGap.rpl) parts.push(line(t, "detailRpl"));
  if (r.consultant) parts.push(line(t, "detailConsultant", { consultant: r.consultant.name }));
  // Only ever a card extracted from a real district document, never generated.
  if (r.opportunities[0]) parts.push(line(t, "detailOpportunity", { idea: r.opportunities[0].ideaHi }));
  parts.push(line(t, "detailIncome", { min: r.course.incomeMonthly[0], max: r.course.incomeMonthly[1] }));
  return `${parts.join(" ")}\n${line(t, "detailAsk")}`;
}

function whyLine(r: Recommendation, s: InterviewState): string {
  const t = tOf(s);
  return line(t, "why", {
    course: r.course.nameHi,
    reasons: r.reasons.map((x) => reasonText(x, t, s.profile.language)).join(", "),
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function apply(s: InterviewState, slot: SlotId, v: SlotValue): void {
  const fields: SlotValue = { ...v };
  delete fields.answeredNone;
  s.profile = { ...s.profile, ...fields };

  if (!s.answered.includes(slot)) s.answered.push(slot);
  // Naming a block answers the block question too.
  if (slot === "district" && v.block && !s.answered.includes("block")) s.answered.push("block");
}

/** Fill the gaps the interview left with neutral values the recommender accepts. */
export function completeProfile(p: Partial<Profile>): Profile {
  return {
    district: p.district ?? "",
    block: p.block ?? "",
    language: p.language ?? "hi",
    education: p.education ?? 0,
    familyTrade: p.familyTrade,
    continueFamilyTrade: p.continueFamilyTrade,
    currentWork: p.currentWork,
    interestSectors: p.interestSectors ?? [],
    skills: p.skills ?? [],
    preference: p.preference ?? "either",
    maxTravelKm: p.maxTravelKm ?? 15,
    canRelocate: p.canRelocate ?? false,
    constraints: p.constraints ?? [],
    assets: p.assets ?? [],
    hoursPerDay: p.hoursPerDay,
    learning: p.learning,
    familySupport: p.familySupport,
    gender: p.gender,
    age: p.age,
    aspiration: p.aspiration,
  };
}

/**
 * Lines that never vary between callers — safe to synthesise ahead of time.
 * Anything with a {placeholder} is filled per caller and cannot be.
 */
export function staticLines(language: Profile["language"] = "hi"): string[] {
  const t = tpl(language);
  const fixed = [
    t.greeting,
    t.consentDeclined,
    ...Object.values(t.ask),
    ...Object.values(t.choices),
    ...["summaryFix", "summaryFixUnclear", "noResults", "resultsAsk", "detailAsk", "noMore", "notInterested", "handoff", "outsideArea"].map(
      (k) => line(t, k),
    ),
    // The help desk's and follow-up call's fixed lines.
    ...["askMore", "unknown", "unknownDeclined", "bye", "ticketNone", "noCourse", "progressThanks"].map(
      (k) => t.helpdesk[k] as string,
    ),
    ...Object.values(t.followup).filter((l) => typeof l === "string"),
  ];

  return [...new Set(fixed)].filter((l) => !l.includes("{"));
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

export function startInterview(
  language: Profile["language"] = "hi",
  opts: { consented?: boolean; lead?: string } = {},
): StepResult {
  const state: InterviewState = {
    stage: "consent",
    attempts: 0,
    profile: { language },
    answered: [],
    lastSay: tpl(language).greeting,
    shown: [],
    page: 0,
    llmCalls: 0,
  };

  // Someone already talking to us (from the help desk) has consented; go
  // straight to the first question.
  if (opts.consented) {
    state.stage = "slot";
    state.slot = nextSlot(state);
    state.lastSay = [opts.lead?.trim(), question(state.slot!, state)].filter(Boolean).join("\n");
  }

  return { state, say: state.lastSay, events: [], end: false };
}

/**
 * Pick up an interview a dropped call left unfinished.
 *
 * Consent was already given on the earlier call, and every answer already
 * collected is kept — the person hears a welcome back and the next question
 * they have not answered, or the summary if they had answered them all.
 */
export function resumeInterview(saved: {
  profile: Partial<Profile>;
  answered: SlotId[];
}): StepResult {
  const state: InterviewState = {
    stage: "slot",
    attempts: 0,
    profile: { ...saved.profile },
    answered: [...saved.answered],
    lastSay: "",
    shown: [],
    page: 0,
    llmCalls: 0,
  };

  const next = nextSlot(state);
  let say: string;

  if (next) {
    state.slot = next;
    say = `${tOf(state).welcomeBack}\n${question(next, state)}`;
  } else {
    state.stage = "summary";
    say = `${tOf(state).welcomeBack}\n${summaryLine(state)}`;
  }

  state.lastSay = say;
  return { state, say, events: [], end: false };
}

/** Is a saved interview worth resuming rather than starting over? */
export function canResume(stage: Stage, answered: SlotId[]): boolean {
  return (stage === "slot" || stage === "summary" || stage === "summaryFix") && answered.length > 0;
}

export async function step(
  prev: InterviewState,
  text: string,
  opts: StepOptions = {},
): Promise<StepResult> {
  const s: InterviewState = structuredClone(prev);
  const events: InterviewEvent[] = [];

  // Answered in (or asked for) the other language: switch, say so, go on.
  const switched = detectSwitch(text, s.profile.language ?? "hi");
  let lead = "";
  if (switched && s.stage !== "done" && s.stage !== "handoff") {
    s.profile.language = switched;
    lead = `${tpl(switched).switched}\n`;
  }
  const t = tOf(s);

  const out = (say: string, end = false): StepResult => {
    s.lastSay = lead + say;
    return { state: s, say: s.lastSay, events, end };
  };

  const handoff = (reason: string): StepResult => {
    s.stage = "handoff";
    events.push({ type: "handoff", reason });
    return out(line(t, "handoff"), true);
  };

  if (s.stage === "done" || s.stage === "handoff") return out(s.lastSay, true);

  // Anywhere in the conversation: a person, or the last line again.
  const intent = intentOf(text);
  if (intent === "human") return handoff("asked for a person");
  if (intent === "repeat") return out(line(t, "repeatPrefix") + s.lastSay);

  // A request to change language, and nothing else: re-ask in the new one.
  if (lead && tokens(text).length <= 3 && s.stage !== "consent") {
    return out(s.stage === "slot" && s.slot ? question(s.slot, s) : s.stage === "summary" ? summaryLine(s) : line(t, "resultsAsk"));
  }

  if (!s.profile.gender) {
    const g = genderOf(text);
    if (g) s.profile.gender = g;
  }

  switch (s.stage) {
    case "consent": {
      const yn = yesNo(text);
      if (yn === false) {
        s.stage = "done";
        return out(line(t, "consentDeclined"), true);
      }
      if (yn === undefined && s.attempts++ < 1) return out(t.greeting);

      // A clear yes, or a second unclear answer from someone still on the
      // line — treat continuing to talk as consent to be asked questions.
      s.attempts = 0;
      s.stage = "slot";
      s.slot = nextSlot(s);
      return out(question(s.slot!, s));
    }

    case "slot":
      return answerSlot(s, text, opts, events, out, handoff);

    case "summary": {
      const yn = yesNo(text);
      if (yn === true) return recommendAndPresent(s, events, out, handoff);
      if (yn === false) {
        s.stage = "summaryFix";
        return out(line(t, "summaryFix"));
      }
      return out(summaryLine(s));
    }

    case "summaryFix": {
      const toks = tokens(text);
      const target: SlotId | undefined = hasAny(toks, ["जगह", "गांव", "ब्लॉक", "जिला", "जिले", "ठिकाण", "गाव", "तालुका", "जिल्हा"])
        ? "district"
        : hasAny(toks, ["पढ़ाई", "पढाई", "कक्षा", "शिक्षण"])
          ? "education"
          : hasAny(toks, ["काम", "धंधा", "व्यवसाय"])
            ? "currentWork"
            : hasAny(toks, ["पसंद", "रुचि", "आवड"])
              ? "interests"
              : undefined;

      if (!target) return out(line(t, "summaryFixUnclear"));

      // Re-ask just that question, then come back to the summary.
      s.answered = s.answered.filter((x) => x !== target && !(target === "district" && x === "block"));
      if (target === "district") {
        delete s.profile.district;
        delete s.profile.block;
      }

      s.stage = "slot";
      s.slot = target;
      s.fixing = true;
      s.attempts = 0;
      return out(question(target, s));
    }

    case "clarify": {
      const pair = s.shown;
      let chosen = ordinalOf(text);

      if (chosen === undefined) {
        const toks = tokens(text);
        chosen = pair.findIndex((r) =>
          tokens(r.course.nameHi).some((w) => w.length > 2 && toks.includes(w)),
        );
        if (chosen < 0) chosen = undefined;
      }

      if (chosen !== undefined && pair[chosen]) {
        const sector = pair[chosen].course.sector;
        const current = s.profile.interestSectors ?? [];
        s.profile.interestSectors = [sector, ...current.filter((x) => x !== sector)];
      }

      return recommendAndPresent(s, events, out, handoff, { noClarify: true });
    }

    case "stretch": {
      // Could they travel to the farther course they actually want?
      const yn = yesNo(text);
      if (yn === undefined && s.attempts++ < 1) return out(s.lastSay);
      s.attempts = 0;

      if (yn === true) {
        s.profile.maxTravelKm = Math.ceil(s.shown[0].distanceKm);
        events.push({ type: "profile", profile: s.profile });
      }
      return recommendAndPresent(s, events, out, handoff, { noStretch: true });
    }

    case "results":
    case "detail":
      return browse(s, text, events, out);
  }

  return out(s.lastSay);
}

async function answerSlot(
  s: InterviewState,
  text: string,
  opts: StepOptions,
  events: InterviewEvent[],
  out: (say: string, end?: boolean) => StepResult,
  handoff: (reason: string) => StepResult,
): Promise<StepResult> {
  const slot = s.slot!;
  let value = extractSlot(slot, text, s.profile);

  if (!value && opts.llm && text.trim()) {
    s.llmCalls++;
    try {
      value = await opts.llm(slot, text, opts.signal);
    } catch (err) {
      // An interruption must propagate; a provider failure is just "unclear".
      if ((err as Error)?.name === "AbortError") throw err;
    }
  }

  let prefix = "";

  // Somewhere we do not cover yet. Say so plainly rather than "I did not
  // understand"; the answer is logged for staff like any other unknown, and a
  // second one hands over to a person, who can still help.
  if (value?.outsidePlace !== undefined) {
    events.push({ type: "unknown", slot, text });

    if (s.attempts === 0) {
      s.attempts = 1;
      return out(line(tOf(s), "outsideArea"));
    }

    return handoff(`outside the covered districts: ${value.outsidePlace || text}`);
  }

  if (!value) {
    events.push({ type: "unknown", slot, text });

    if (s.attempts === 0) {
      s.attempts = 1;
      return out(choicesFor(slot, s));
    }

    if (REQUIRED.has(slot)) return handoff(`could not understand ${slot}`);

    // Optional question: move on with a neutral default rather than trap the
    // person on a question they cannot answer.
    value = DEFAULTS[slot] ?? {};
    apply(s, slot, value);
    prefix = tOf(s).choices.aspiration + "\n";
  } else {
    apply(s, slot, value);
    // A line break, not a space: the acknowledgement is spoken live, the
    // question after it is a fixed line the TTS cache already holds.
    prefix = ack(slot, value, s) + "\n";
  }

  if (!s.answered.includes(slot)) s.answered.push(slot);
  s.attempts = 0;
  events.push({ type: "profile", profile: s.profile });

  if (s.fixing) {
    s.fixing = false;
    // A fixed district needs its block before the summary makes sense.
    if (!s.profile.block) {
      s.slot = "block";
      return out(prefix + question("block", s));
    }
    s.stage = "summary";
    return out(prefix + summaryLine(s));
  }

  const next = nextSlot(s);

  if (!next) {
    s.stage = "summary";
    s.slot = undefined;
    return out(prefix + summaryLine(s));
  }

  s.slot = next;
  return out(prefix + question(next, s));
}

function recommendAndPresent(
  s: InterviewState,
  events: InterviewEvent[],
  out: (say: string, end?: boolean) => StepResult,
  handoff: (reason: string) => StepResult,
  opts: { noClarify?: boolean; noStretch?: boolean } = {},
): StepResult {
  const result = recommend(completeProfile(s.profile));
  s.result = result;

  if (result.farther && !opts.noStretch) {
    s.stage = "stretch";
    s.shown = [result.farther];
    const r = result.farther;
    return out(line(tOf(s), "stretch", {
      course: r.course.nameHi,
      km: Math.round(r.distanceKm),
      centreBlock: blockHi(r.centre.district, r.centre.block),
    }));
  }

  if (result.picks.length === 0) {
    events.push({ type: "handoff", reason: "no course within reach" });
    s.stage = "handoff";
    return out(line(tOf(s), "noResults"), true);
  }

  if (result.clarify && !opts.noClarify) {
    s.stage = "clarify";
    s.shown = result.picks.slice(0, 2);
    return out(line(tOf(s), "clarify", { a: s.shown[0].course.nameHi, b: s.shown[1].course.nameHi }));
  }

  s.stage = "results";
  s.page = 0;
  s.shown = result.picks;
  s.selected = undefined;
  events.push({ type: "recommended", courseIds: s.shown.map((r) => r.course.id) });

  return out(resultsLine(s.shown, s));
}

function browse(
  s: InterviewState,
  text: string,
  events: InterviewEvent[],
  out: (say: string, end?: boolean) => StepResult,
): StepResult {
  const intent = intentOf(text);
  const pick = ordinalOf(text);
  const t = tOf(s);

  if (intent === "more") {
    const more = s.result?.more ?? [];
    const page = more.slice(s.page * 3, s.page * 3 + 3);
    if (page.length === 0) return out(line(t, "noMore"));

    s.page++;
    s.shown = page;
    s.selected = undefined;
    s.stage = "results";
    events.push({ type: "recommended", courseIds: page.map((r) => r.course.id) });
    return out(resultsLine(page, s));
  }

  if (pick !== undefined && s.shown[pick]) {
    s.selected = pick;
    s.stage = "detail";
    return out(detailLine(s.shown[pick], s));
  }

  if (intent === "why") {
    return out(whyLine(s.shown[s.selected ?? 0], s));
  }

  if (s.stage === "detail" && s.selected !== undefined) {
    const yn = yesNo(text);
    const r = s.shown[s.selected];

    if (yn === true) {
      s.stage = "done";
      events.push({ type: "interest", courseId: r.course.id, centreId: r.centre.id });
      return out(line(t, "interested", { course: r.course.nameHi, centre: r.centre.name }), true);
    }

    if (yn === false) {
      s.stage = "results";
      return out(line(t, "notInterested"));
    }
  }

  return out(line(t, "resultsAsk"));
}
