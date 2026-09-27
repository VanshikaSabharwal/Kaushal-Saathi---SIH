/**
 * Which words to say, in which language.
 *
 * Every spoken line lives in data/i18n/<lang>.json, key for key. A key missing
 * from a language falls back to Hindi rather than failing the call, so a
 * half-translated file degrades to understandable speech, not silence.
 *
 * The language is per conversation, not per deployment: a caller who answers
 * in Marathi — or asks for it — is switched mid-call, and the switch is kept
 * on their record for next time.
 */

import as from "../../data/i18n/as.json";
import bn from "../../data/i18n/bn.json";
import en from "../../data/i18n/en.json";
import hi from "../../data/i18n/hi.json";
import kok from "../../data/i18n/kok.json";
import mr from "../../data/i18n/mr.json";
import te from "../../data/i18n/te.json";
import synonyms from "../../data/synonyms.json";
import { skillLabel, TRADES } from "./catalog";
import { findPhrase, hasAny, tokens } from "./text";
import { asLanguage, type Language, type Reason, type Sector } from "./types";

export type Tpl = {
  greeting: string;
  welcomeBack: string;
  consentDeclined: string;
  switched: string;
  ask: Record<string, string>;
  choices: Record<string, string>;
  ack: Record<string, string>;
  ordinals: string[];
  education: Record<string, string>;
  preferenceText: Record<string, string>;
  units: { days: string; months: string; oneAndHalf: string };
  sectors: Record<string, string>;
  trades?: Record<string, string>;
  reasons?: Record<string, string>;
  assets?: Record<string, string>;
  helpdesk: Record<string, unknown>;
  followup: Record<string, string>;
  [key: string]: unknown;
};

const HI = hi as unknown as Tpl;

// Marathi is hand-written; the rest are machine-translated from Hindi by
// scripts/translate-voice-lines.ts.
const TPL: Record<Language, Tpl> = {
  hi: HI,
  mr: mr as unknown as Tpl,
  en: en as unknown as Tpl,
  kok: kok as unknown as Tpl,
  te: te as unknown as Tpl,
  as: as as unknown as Tpl,
  bn: bn as unknown as Tpl,
};

export function tpl(lang?: string): Tpl {
  return TPL[asLanguage(lang) ?? "hi"];
}

export function fill(template: string, vars: Record<string, string | number | undefined> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** A top-level line, falling back to Hindi when a language lacks it. */
export function line(t: Tpl, key: string, vars?: Record<string, string | number | undefined>): string {
  return fill((t[key] ?? HI[key]) as string, vars);
}

export function tradeName(key: string | undefined, t: Tpl): string {
  if (!key) return "";
  return t.trades?.[key] ?? TRADES[key]?.hi ?? key;
}

export function sectorName(s: Sector, t: Tpl): string {
  return t.sectors[s] ?? HI.sectors[s] ?? s;
}

export function skillName(id: string, lang?: string): string {
  // Skill labels exist in Hindi and English only; Hindi is the nearer
  // fallback for the Indian languages.
  return skillLabel(id, lang === "en" ? "en" : "hi");
}

export function durationText(days: number, t: Tpl): string {
  if (days < 30) return fill(t.units.days, { n: days });
  const months = days / 30;
  if (months === 1.5) return t.units.oneAndHalf;
  return fill(t.units.months, { n: Math.round(months) });
}

export function educationText(n: number | undefined, t: Tpl): string {
  if (n === undefined) return "";
  return t.education[String(n)] ?? fill(t.education.other, { n });
}

/** A recommendation's reason in the conversation's language. */
export function reasonText(r: Reason | undefined, t: Tpl, lang?: string): string {
  if (!r) return "";
  if (!lang || lang === "hi") return r.hi;

  const template = t.reasons?.[r.code];
  if (!template) return r.hi;

  const asset = r.vars?.asset ? t.assets?.[String(r.vars.asset)] ?? String(r.vars.asset) : undefined;
  return fill(template, { ...r.vars, asset });
}

const L = (synonyms as unknown as { language: Record<string, string[]> }).language;

/**
 * Should the conversation change language after this utterance?
 *
 * An explicit request ("मराठीत बोला", "हिंदी में") always switches. Otherwise
 * it takes at least two marker words of the other language, outnumbering the
 * current one's — a single borrowed word ("नाही" in a Hindi sentence) must
 * not flip the whole call.
 */
export function detectSwitch(text: string, current: Language): Language | undefined {
  const toks = tokens(text);

  if (current !== "mr" && hasAny(toks, L.askMr, { includeNegated: true })) return "mr";
  if (current !== "hi" && hasAny(toks, L.askHi, { includeNegated: true })) return "hi";

  const count = (words: string[]) => words.reduce((n, w) => n + findPhrase(toks, w).length, 0);
  const mrCount = count(L.mr);
  const hiCount = count(L.hi);

  if (current === "hi" && mrCount >= 2 && mrCount > hiCount) return "mr";
  if (current === "mr" && hiCount >= 2 && hiCount > mrCount) return "hi";
  return undefined;
}
