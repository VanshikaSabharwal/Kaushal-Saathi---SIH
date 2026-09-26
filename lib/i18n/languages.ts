/**
 * The languages the website can be read in: all 22 languages of the Eighth
 * Schedule of the Constitution, plus English.
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
  { code: "en", name: "English", native: "English", bcp47: "en-IN" },
  { code: "as", name: "Assamese", native: "অসমীয়া", bcp47: "as-IN" },
  { code: "bn", name: "Bengali", native: "বাংলা", bcp47: "bn-IN" },
  { code: "brx", name: "Bodo", native: "बड़ो", bcp47: "brx-IN" },
  { code: "doi", name: "Dogri", native: "डोगरी", bcp47: "doi-IN" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", bcp47: "gu-IN" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", bcp47: "kn-IN" },
  { code: "ks", name: "Kashmiri", native: "کٲشُر", bcp47: "ks-IN", rtl: true },
  { code: "kok", name: "Konkani", native: "कोंकणी", bcp47: "kok-IN" },
  { code: "mai", name: "Maithili", native: "मैथिली", bcp47: "mai-IN" },
  { code: "ml", name: "Malayalam", native: "മലയാളം", bcp47: "ml-IN" },
  { code: "mni", name: "Manipuri", native: "ꯃꯤꯇꯩꯂꯣꯟ", bcp47: "mni-IN" },
  { code: "mr", name: "Marathi", native: "मराठी", bcp47: "mr-IN", voice: true },
  { code: "ne", name: "Nepali", native: "नेपाली", bcp47: "ne-IN" },
  { code: "od", name: "Odia", native: "ଓଡ଼ିଆ", bcp47: "od-IN" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", bcp47: "pa-IN" },
  { code: "sa", name: "Sanskrit", native: "संस्कृतम्", bcp47: "sa-IN" },
  { code: "sat", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", bcp47: "sat-IN" },
  { code: "sd", name: "Sindhi", native: "سنڌي", bcp47: "sd-IN", rtl: true },
  { code: "ta", name: "Tamil", native: "தமிழ்", bcp47: "ta-IN" },
  { code: "te", name: "Telugu", native: "తెలుగు", bcp47: "te-IN" },
  { code: "ur", name: "Urdu", native: "اردو", bcp47: "ur-IN", rtl: true },
];

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

export function languageOf(code: string | undefined): UiLanguage {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
