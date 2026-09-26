/**
 * Text handling for spoken Hindi (and Marathi) transcripts.
 *
 * STT output varies in ways that carry no meaning — "हाँ" vs "हां", "ज़मीन"
 * vs "जमीन", trailing "।" — so both the dictionary and the transcript are
 * folded to one form before matching. Matching is on whole tokens, never raw
 * substrings: "हां" must not fire inside "यहां".
 */

/** Fold spelling variants that STT produces interchangeably. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFC")
    .replace(/़/g, "") // nukta: ज़ -> ज, ड़ -> ड
    .replace(/ँ/g, "ं") // chandrabindu -> anusvara: हाँ -> हां
    .replace(/[.,!?;:।॥"'`()\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/**
 * Marathi case endings that attach to the word they follow ("गाडीचं",
 * "नाशिकचा", "शहरात"). A token equal to a dictionary word plus one of these
 * counts as that word, so the dictionary need not list every inflection.
 */
const SUFFIXES = new Set(
  ["चं", "ची", "चा", "चे", "च्या", "ला", "ना", "त", "ात", "ने", "नी", "मध्ये", "पर्यंत", "कडे", "साठी", "चाच"].map(
    (x) => x.normalize("NFC").replace(/\u0901/g, "\u0902"),
  ),
);

/**
 * Hindi verb endings that vary with gender and number but not meaning:
 * "चलाता / चलाती / चलाते / चलाना" are all "drive". A dictionary entry in any
 * one form matches the others.
 */
const VERB_ENDINGS = ["ता", "ती", "ते", "ना", "नी"].map((x) => x.normalize("NFC"));

function verbStem(w: string): string | undefined {
  const end = VERB_ENDINGS.find((e) => w.endsWith(e));
  // Long enough that the stem is still a word ("बनाती" -> "बना"), not a syllable.
  return end && w.length - end.length >= 3 ? w.slice(0, -end.length) : undefined;
}

function sameWord(token: string, word: string): boolean {
  if (token === word) return true;
  if (word.length >= 2 && token.startsWith(word) && SUFFIXES.has(token.slice(word.length))) return true;

  const a = verbStem(token);
  return a !== undefined && a === verbStem(word);
}

const NEGATIONS = new Set(["नहीं", "नही", "ना", "मत", "नाही", "नको"].map(normalize));

export type Match = { phrase: string; start: number; end: number; negated: boolean };

/**
 * Every occurrence of a phrase in the token stream.
 *
 * `negated` is set when a negation word follows within two tokens, the usual
 * Hindi order ("खेती नहीं करते", "दसवीं नहीं की"). Phrases that contain a
 * negation themselves ("नहीं पढ़ा") are never marked negated — the negation is
 * their meaning.
 */
export function findPhrase(toks: string[], phrase: string): Match[] {
  const p = tokens(phrase);
  if (p.length === 0) return [];

  const selfNegating = p.some((t) => NEGATIONS.has(t));
  const out: Match[] = [];

  for (let i = 0; i + p.length <= toks.length; i++) {
    if (!p.every((t, j) => sameWord(toks[i + j], t))) continue;

    const end = i + p.length;
    const after = toks.slice(end, end + 2);

    out.push({
      phrase,
      start: i,
      end,
      negated: !selfNegating && after.some((t) => NEGATIONS.has(t)),
    });
  }

  return out;
}

export type MatchOptions = {
  /**
   * Count negated occurrences too. For complaints and questions the negation
   * IS the content — "स्टाइपेंड नहीं आया" is about the stipend — whereas for
   * a profile answer "खेती नहीं करते" must not mean farming.
   */
  includeNegated?: boolean;
};

/** Does any phrase occur (un-negated, unless told otherwise)? */
export function hasAny(toks: string[], phrases: string[], opts: MatchOptions = {}): boolean {
  return phrases.some((ph) => findPhrase(toks, ph).some((m) => opts.includeNegated || !m.negated));
}

/**
 * The best key from a {key: phrases[]} table.
 *
 * Longest phrase wins, so "मिट्टी के बर्तन" beats "बर्तन" and "नहीं पढ़ा"
 * beats a bare "नहीं". Negated occurrences are skipped.
 */
export function bestKey(
  toks: string[],
  table: Record<string, string[]>,
  opts: MatchOptions = {},
): string | undefined {
  let best: { key: string; len: number } | undefined;

  for (const [key, phrases] of Object.entries(table)) {
    if (key.startsWith("_")) continue;

    for (const ph of phrases) {
      const len = tokens(ph).length;
      if (findPhrase(toks, ph).some((m) => opts.includeNegated || !m.negated) && (!best || len > best.len)) {
        best = { key, len };
      }
    }
  }

  return best?.key;
}

/** Every key with at least one un-negated phrase present. */
export function allKeys(toks: string[], table: Record<string, string[]>): string[] {
  return Object.entries(table)
    .filter(([key]) => !key.startsWith("_"))
    .filter(([, phrases]) => hasAny(toks, phrases))
    .map(([key]) => key);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  ग्यारह: 11, बारह: 12, पंद्रह: 15, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50,
  साठ: 60, सौ: 100, डेढ: 1.5, ढाई: 2.5,
};

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/**
 * Numbers in a transcript, in order: digits (Latin or Devanagari), number
 * words, and "हज़ार" as a multiplier on the number before it
 * ("पंद्रह हज़ार" -> 15000).
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];

  for (const raw of tokens(text)) {
    const t = [...raw]
      .map((ch) => {
        const i = DEVANAGARI_DIGITS.indexOf(ch);
        return i >= 0 ? String(i) : ch;
      })
      .join("");

    const digits = t.match(/^(\d+(?:\.\d+)?)/);

    if (digits) {
      out.push(Number(digits[1]));
    } else if (NUMBER_WORDS[t] !== undefined) {
      out.push(NUMBER_WORDS[t]);
    } else if ((t === "हजार" || t === "thousand") && out.length > 0) {
      out[out.length - 1] *= 1000;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Fuzzy place names
// ---------------------------------------------------------------------------

/** Edit distance, for place names STT spells slightly differently. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }

  return dp[a.length][b.length];
}
