/**
 * The languages the website can be read in — the ones the project serves.
 *
 * `voice` marks the languages the voice assistant itself speaks today (its
 * scripted lines are hand-written, not machine-translated); every language can
 * read the website and use the text chat.
 */

export type UiLanguage = {
  code: string;
  /** English name, for staff screens and logs. */
  name: string;
  /** The language's own name, in its own script — what the picker shows. */
  native: string;
  /** BCP-47 tag for speech (read-aloud) and translation providers. */
  bcp47: string;
  rtl?: boolean;
  voice?: boolean;
};

export const LANGUAGES: UiLanguage[] = [
  { code: "hi", name: "Hindi", native: "हिन्दी", bcp47: "hi-IN", voice: true },
  { code: "en", name: "English", native: "English", bcp47: "en-IN", voice: true },
  { code: "kok", name: "Konkani", native: "कोंकणी", bcp47: "kok-IN", voice: true },
  { code: "te", name: "Telugu", native: "తెలుగు", bcp47: "te-IN", voice: true },
  { code: "as", name: "Assamese", native: "অসমীয়া", bcp47: "as-IN", voice: true },
  { code: "bn", name: "Bengali", native: "বাংলা", bcp47: "bn-IN", voice: true },
];

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

export function languageOf(code: string | undefined): UiLanguage {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
