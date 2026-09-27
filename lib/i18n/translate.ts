/**
 * Machine translation for the website, with a cache so each sentence is paid
 * for once per language.
 *
 * Providers, tried in order until one succeeds — so a provider out of credits
 * or rate-limited simply hands over to the next:
 *   - Bodhan `indic-translate` (BODHAN_TRANSLATE_API_KEY — its own key; the
 *     speech keys cannot call it) — English and the 22 Eighth Schedule
 *     languages, other pairs through English;
 *   - Bhashini (MeitY; BHASHINI_USER_ID + BHASHINI_API_KEY) — all 22
 *     Eighth Schedule languages, free for registered users;
 *   - Google Cloud Translation v2 (GOOGLE_TRANSLATE_API_KEY);
 *   - Sarvam Translate (`sarvam-translate:v1`, SARVAM_API_KEY);
 *   - MyMemory (no key; set MYMEMORY_EMAIL for a higher daily limit) — free
 *     and good for the major languages, weak or missing for some (Konkani,
 *     Bodo, Sanskrit). The last resort, not the answer.
 * If all fail, translate() returns the input unchanged and says so, and the
 * site stays in its original language rather than breaking.
 *
 * Translations are machine output. The scripted lines the voice assistant
 * speaks (data/i18n) are reviewed by hand; this is for reading the website.
 */

import { createHash } from "node:crypto";
import STATIC from "../../data/i18n/static.json";
import { createCollection } from "../store/collection";
import { LANGUAGE_CODES, languageOf } from "./languages";

/**
 * Translations shipped with the app ("hi>en" -> source text -> translation),
 * exported from the paid cache by `npm run i18n:export`. Checked first, so a
 * sentence is paid for once, ever — not once per database or deployment.
 */
const SHIPPED = STATIC as Record<string, Record<string, string>>;

type Cached = { id: string; lang: string; text: string; translated: string; provider: string; at: number };

const store = createCollection<Cached>("translations", { max: 200000 });
const memory = new Map<string, { translated: string; provider: string }>();
const MEMORY_MAX = 20000;

/** The free last resort: its output is replaced as soon as a better provider is working. */
const FALLBACK = "mymemory";

/**
 * Providers that failed for the whole account (bad key, out of credits, rate
 * limited) sit out a while, so every batch does not first wait on a call that
 * cannot succeed. A language one provider lacks does not count.
 */
const cooling = new Map<string, number>();
const COOL_MS = 10 * 60 * 1000;
const ACCOUNT_ERROR = /\b(401|402|403|429)\b/;

/** One call's worth of text, to keep a page load from becoming a bill. */
export const MAX_TEXTS = 200;
export const MAX_CHARS = 1000;

export type Translator = (texts: string[], target: string, source: string) => Promise<string[]>;

const keyOf = (target: string, source: string, text: string) =>
  createHash("sha1").update(`${source}>${target}|${text}`).digest("hex");

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Bodhan's `indic-translate` (AI4Bharat, IIT Madras), OpenAI-style chat
 * completions, one text per request. Bodhan keys are scoped to one model, so
 * this needs its own key — the speech keys are refused. It documents English
 * to and from each language; a pair it refuses directly (Hindi to Tamil, say)
 * goes through English, and is remembered so later texts go straight there.
 */
const BODHAN_CODE: Record<string, string> = { od: "or" };
const bodhanViaEnglish = new Set<string>();

/** Bodhan rejected the request itself (bad language pair), as opposed to the key, credits or rate limit. */
class BodhanRefused extends Error {}

async function bodhanOne(input: string, source: string, target: string): Promise<string> {
  const res = await fetch("https://api.bodhan.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.BODHAN_TRANSLATE_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: "indic-translate",
      messages: [{ role: "user", content: input }],
      source_language_code: source,
      target_language_code: target,
    }),
  });
  if (!res.ok) {
    const detail = `Bodhan translate ${res.status}: ${(await res.text()).slice(0, 200)}`;
    throw res.status === 400 || res.status === 422 ? new BodhanRefused(detail) : new Error(detail);
  }
  const out = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim();
  // An empty answer must not be cached as the translation.
  if (!out) throw new Error("Bodhan translate returned no text");
  return out;
}

const bodhan: Translator = async (texts, target, source) => {
  const src = BODHAN_CODE[source] ?? source;
  const tgt = BODHAN_CODE[target] ?? target;
  const pair = `${src}>${tgt}`;
  const pivots = src !== "en" && tgt !== "en";
  const viaEnglish = async (text: string) => bodhanOne(await bodhanOne(text, src, "en"), "en", tgt);

  const one = async (text: string): Promise<string> => {
    if (pivots && bodhanViaEnglish.has(pair)) return viaEnglish(text);
    try {
      return await bodhanOne(text, src, tgt);
    } catch (err) {
      if (!pivots || !(err instanceof BodhanRefused)) throw err;
      bodhanViaEnglish.add(pair);
      return viaEnglish(text);
    }
  };

  const out: string[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < texts.length; i += CONCURRENCY) out.push(...(await Promise.all(texts.slice(i, i + CONCURRENCY).map(one))));
  return out;
};

/** Sarvam takes one text per request; a few in parallel keeps pages quick without tripping limits. */
const sarvam: Translator = async (texts, target, source) => {
  const key = process.env.SARVAM_API_KEY!;
  const out: string[] = [];
  const CONCURRENCY = 4;

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      texts.slice(i, i + CONCURRENCY).map(async (input) => {
        const res = await fetch("https://api.sarvam.ai/translate", {
          method: "POST",
          headers: { "api-subscription-key": key, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            input,
            source_language_code: languageOf(source).bcp47,
            target_language_code: languageOf(target).bcp47,
            model: "sarvam-translate:v1",
          }),
        });
        if (!res.ok) throw new Error(`Sarvam translate ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return ((await res.json()) as { translated_text?: string }).translated_text ?? input;
      }),
    );
    out.push(...batch);
  }

  return out;
};

/** Google's codes differ for a few languages. */
const GOOGLE_CODE: Record<string, string> = { od: "or", mni: "mni-Mtei" };

const google: Translator = async (texts, target, source) => {
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(process.env.GOOGLE_TRANSLATE_API_KEY!)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        q: texts,
        target: GOOGLE_CODE[target] ?? target,
        source: GOOGLE_CODE[source] ?? source,
        format: "text",
      }),
    },
  );
  if (!res.ok) throw new Error(`Google translate ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data: { translations: { translatedText: string }[] } };
  return data.data.translations.map((t) => t.translatedText);
};

/**
 * Bhashini's ULCA pipeline: one call to find the translation service for a
 * language pair (cached), then batched inference against it.
 */
const bhashiniServices = new Map<string, { url: string; auth: [string, string]; serviceId: string }>();

const BHASHINI_CODE: Record<string, string> = { od: "or" };

const bhashini: Translator = async (texts, target, source) => {
  const src = BHASHINI_CODE[source] ?? source;
  const tgt = BHASHINI_CODE[target] ?? target;
  const pairKey = `${src}>${tgt}`;
  let svc = bhashiniServices.get(pairKey);

  if (!svc) {
    const res = await fetch("https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        userID: process.env.BHASHINI_USER_ID!,
        ulcaApiKey: process.env.BHASHINI_API_KEY!,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        pipelineTasks: [{ taskType: "translation", config: { language: { sourceLanguage: src, targetLanguage: tgt } } }],
        pipelineRequestConfig: { pipelineId: process.env.BHASHINI_PIPELINE_ID ?? "64392f96daac500b55c543cd" },
      }),
    });
    if (!res.ok) throw new Error(`Bhashini config ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const cfg = (await res.json()) as {
      pipelineInferenceAPIEndPoint: { callbackUrl: string; inferenceApiKey: { name: string; value: string } };
      pipelineResponseConfig: { config: { serviceId: string }[] }[];
    };
    svc = {
      url: cfg.pipelineInferenceAPIEndPoint.callbackUrl,
      auth: [cfg.pipelineInferenceAPIEndPoint.inferenceApiKey.name, cfg.pipelineInferenceAPIEndPoint.inferenceApiKey.value],
      serviceId: cfg.pipelineResponseConfig[0].config[0].serviceId,
    };
    bhashiniServices.set(pairKey, svc);
  }

  const res = await fetch(svc.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [svc.auth[0]]: svc.auth[1] },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      pipelineTasks: [{ taskType: "translation", config: { language: { sourceLanguage: src, targetLanguage: tgt }, serviceId: svc.serviceId } }],
      inputData: { input: texts.map((source) => ({ source })) },
    }),
  });
  if (!res.ok) throw new Error(`Bhashini ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as { pipelineResponse: { output: { target: string }[] }[] };
  return data.pipelineResponse[0].output.map((o, i) => o.target ?? texts[i]);
};

/** MyMemory's codes: region-tagged, and a few it names differently. */
const MYMEMORY_CODE: Record<string, string | undefined> = {
  hi: "hi-IN", en: "en-GB", bn: "bn-IN", ta: "ta-IN", te: "te-IN", mr: "mr-IN", gu: "gu-IN", kn: "kn-IN",
  ml: "ml-IN", pa: "pa-IN", ur: "ur-PK", as: "as-IN", od: "or-IN", ne: "ne-NP", sa: "sa-IN", sd: "sd",
  mai: "mai", doi: "doi", mni: "mni-Mtei", ks: "ks", sat: "sat",
  // Not offered by MyMemory: left untranslated rather than guessed.
  kok: undefined, brx: undefined,
};

/** MyMemory takes up to 500 bytes per request: send long texts in sentence pieces. */
function pieces(text: string, maxBytes = 450): string[] {
  if (Buffer.byteLength(text) <= maxBytes) return [text];
  const out: string[] = [];
  let cur = "";
  for (const s of text.match(/[^।.?!]+[।.?!]?\s*/g) ?? [text]) {
    if (cur && Buffer.byteLength(cur + s) > maxBytes) {
      out.push(cur);
      cur = "";
    }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
}

const mymemory: Translator = async (texts, target, source) => {
  const src = MYMEMORY_CODE[source];
  const tgt = MYMEMORY_CODE[target];
  if (!src || !tgt) throw new Error(`MyMemory does not offer ${target}.`);

  const one = async (q: string): Promise<string> => {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", q);
    url.searchParams.set("langpair", `${src}|${tgt}`);
    url.searchParams.set("mt", "1");
    if (process.env.MYMEMORY_EMAIL) url.searchParams.set("de", process.env.MYMEMORY_EMAIL);

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const d = (await res.json()) as {
      responseStatus: number | string;
      responseDetails?: string;
      responseData?: { translatedText?: string };
      matches?: { translation: string; "created-by"?: string }[];
    };
    if (Number(d.responseStatus) !== 200) throw new Error(`MyMemory ${d.responseStatus}: ${d.responseDetails ?? ""}`.slice(0, 200));

    // Prefer the machine translation over a translation-memory match: memory
    // matches can be confidently wrong ("courses for you" -> "curriculum vitae").
    const machine = d.matches?.find((m) => m["created-by"] === "MT!")?.translation;
    return machine ?? d.responseData?.translatedText ?? q;
  };

  const out: string[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    out.push(
      ...(await Promise.all(
        texts.slice(i, i + CONCURRENCY).map(async (t) => (await Promise.all(pieces(t).map(one))).join(" ")),
      )),
    );
  }
  return out;
};

let override: { name: string; fn: Translator } | undefined;

/** Swap the provider — for tests, or a future one such as Bhashini. */
export function setTranslator(name: string, fn: Translator | undefined): void {
  override = fn ? { name, fn } : undefined;
}

/** Every configured provider, best first. MyMemory needs no key, so it is always last in line. */
export function providers(): { name: string; fn: Translator }[] {
  if (override) return [override];

  const list: { name: string; fn: Translator }[] = [];
  if (process.env.BODHAN_TRANSLATE_API_KEY?.trim()) list.push({ name: "bodhan", fn: bodhan });
  if (process.env.BHASHINI_USER_ID?.trim() && process.env.BHASHINI_API_KEY?.trim()) list.push({ name: "bhashini", fn: bhashini });
  if (process.env.GOOGLE_TRANSLATE_API_KEY?.trim()) list.push({ name: "google", fn: google });
  if (process.env.SARVAM_API_KEY?.trim()) list.push({ name: "sarvam", fn: sarvam });
  if (process.env.TRANSLATE_FREE_FALLBACK !== "0") list.push({ name: "mymemory", fn: mymemory });
  return list;
}

export function activeProvider(): { name: string; fn: Translator } | undefined {
  return providers()[0];
}

// ---------------------------------------------------------------------------

export type TranslateResult = {
  translations: string[];
  provider?: string;
  cached: number;
  error?: string;
  /** Some of these came from the free fallback: fine to show, not worth keeping on the device. */
  fallback?: boolean;
};

/**
 * Translate texts into `target`. Cached sentences cost nothing; only new
 * ones reach the provider, in one batch. On any failure the originals come
 * back, so a page is never left half-blank.
 */
export async function translate(texts: string[], target: string, source = "hi"): Promise<TranslateResult> {
  if (!LANGUAGE_CODES.has(target) || !LANGUAGE_CODES.has(source)) {
    return { translations: texts, cached: 0, error: "Unknown language." };
  }
  if (target === source) return { translations: texts, cached: texts.length };

  const clean = texts.slice(0, MAX_TEXTS).map((t) => t.slice(0, MAX_CHARS));
  const result: (string | undefined)[] = new Array(clean.length);
  const missing: number[] = [];
  let cached = 0;
  let fallback = false;

  const configured = providers();
  const now = Date.now();
  const ready = configured.filter((p) => (cooling.get(p.name) ?? 0) < now);
  // Every provider cooling down: try them all rather than none.
  const chain = ready.length ? ready : configured;
  // A better provider is working: what the fallback translated earlier gets redone.
  const upgrade = chain[0] !== undefined && chain[0].name !== FALLBACK;

  await Promise.all(
    clean.map(async (text, i) => {
      if (!text.trim()) {
        result[i] = text;
        return;
      }
      const shipped = SHIPPED[`${source}>${target}`]?.[text];
      if (shipped) {
        result[i] = shipped;
        cached++;
        return;
      }

      const id = keyOf(target, source, text);
      let hit = memory.get(id);
      if (!hit) {
        const stored = await store.get(id);
        if (stored) hit = { translated: stored.translated, provider: stored.provider };
      }
      if (hit && !(upgrade && hit.provider === FALLBACK)) {
        memory.set(id, hit);
        result[i] = hit.translated;
        if (hit.provider === FALLBACK) fallback = true;
        cached++;
      } else {
        missing.push(i);
      }
    }),
  );

  if (missing.length && chain.length === 0) {
    return { translations: clean, cached, error: "No translation provider configured." };
  }

  let used: string | undefined;
  const errors: string[] = [];

  for (const provider of missing.length ? chain : []) {
    try {
      const fresh = await provider.fn(missing.map((i) => clean[i]), target, source);
      used = provider.name;
      cooling.delete(provider.name);
      if (provider.name === FALLBACK) fallback = true;

      await Promise.all(
        missing.map(async (i, j) => {
          const translated = fresh[j] ?? clean[i];
          const id = keyOf(target, source, clean[i]);
          result[i] = translated;

          if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
          memory.set(id, { translated, provider: provider.name });
          await store.upsert({ id, lang: target, text: clean[i], translated, provider: provider.name, at: Date.now() });
        }),
      );
      break;
    } catch (err) {
      // Out of credits, rate-limited, or no such language: try the next one.
      const message = err instanceof Error ? err.message : `${provider.name} failed`;
      if (ACCOUNT_ERROR.test(message)) cooling.set(provider.name, Date.now() + COOL_MS);
      errors.push(message);
    }
  }

  if (missing.length && !used) {
    return {
      translations: clean.map((t, i) => result[i] ?? t),
      provider: chain.at(-1)?.name,
      cached,
      error: errors.join(" · ") || "Translation failed.",
    };
  }

  return { translations: result.map((t, i) => t ?? clean[i]), provider: used ?? chain[0]?.name, cached, fallback };
}
