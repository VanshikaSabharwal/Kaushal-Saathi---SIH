/**
 * One-time: machine-translate the voice assistant's Hindi lines
 * (data/i18n/hi.json) into the other voice languages with Bodhan
 * indic-translate, writing data/i18n/<lang>.json.
 *
 * Lines already present in a target file are kept, so a rerun only fills what
 * is missing (or new) and never re-pays for, or overwrites, a hand-fixed line.
 * Trade names are translated too, since tradeName() reads t.trades.
 *
 *   npx tsx scripts/translate-voice-lines.ts            # all targets
 *   npx tsx scripts/translate-voice-lines.ts te bn      # just these
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env";

loadEnv();

const TARGETS = ["en", "kok", "te", "as", "bn"];
const CONCURRENCY = 3;

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const key = process.env.BODHAN_TRANSLATE_API_KEY;
if (!key) throw new Error("Set BODHAN_TRANSLATE_API_KEY.");

// Bodhan allows 120 requests per key per window (X-Ratelimit headers); stay
// under it by spacing request starts rather than bursting into 429s.
const GAP_MS = 570;
let nextSlot = 0;
async function paced(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

class BodhanError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function bodhan(text: string, source: string, target: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await paced();
    const res = await fetch("https://api.bodhan.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: "indic-translate",
        messages: [{ role: "user", content: text }],
        source_language_code: source,
        target_language_code: target,
      }),
    });
    if (res.ok) {
      const out = (await res.json()).choices?.[0]?.message?.content?.trim();
      if (out) return out;
    }
    // The limit is per model, shared with everyone: on 429 wait as long as
    // Bodhan asks (Retry-After), and hold every worker back, not just this one.
    if (res.status === 429 && attempt < 20) {
      const wait = (Number(res.headers.get("retry-after")) || 30) * 1000 + 1000;
      nextSlot = Math.max(nextSlot, Date.now() + wait);
      continue;
    }
    if (attempt >= 2 || res.status === 400 || res.status === 422 || res.status === 403 || res.status === 429) {
      throw new BodhanError(res.status, `Bodhan ${source}->${target} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

/** The assistant's name is a name: sent as a placeholder, put back in each script. */
const BRAND_HI = "कौशल साथी";
const BRAND: Record<string, string> = {
  en: "Kaushal Saathi", kok: "कौशल साथी", te: "కౌశల్ సాథీ", as: "কৌশল সাথী", bn: "কৌশল সাথী",
};

/**
 * One line, keeping {placeholders} and line breaks; via English if the direct
 * pair fails. Placeholders go to Bodhan as neutral tokens (Zq1, Zq2, …): it
 * translates the word inside "{district}" but leaves "Zq1" alone.
 */
async function translateLine(original: string, target: string): Promise<string> {
  const hi = original.replaceAll(BRAND_HI, "{brand}");
  const names = [...new Set(hi.match(/\{\w+\}/g) ?? [])];
  const token = (i: number) => `Zq${i + 1}`;
  const masked = names.reduce((s, n, i) => s.replaceAll(n, token(i)), hi);

  const parts = await Promise.all(
    masked.split("\n").map(async (part) => {
      // Nothing but placeholders ("{consultant} {schemes}"): nothing to translate.
      if (!part.replace(/Zq\d+/g, "").replace(/[\s.,।!?—-]/g, "")) return part;
      const lead = part.match(/^\s*/)![0];
      const trail = part.match(/\s*$/)![0];
      let out: string;
      try {
        out = await bodhan(part.trim(), "hi", target);
      } catch (err) {
        // Only a refused language pair is worth routing through English.
        if (!(err instanceof BodhanError) || (err.status !== 400 && err.status !== 422)) throw err;
        out = await bodhan(await bodhan(part.trim(), "hi", "en"), "en", target);
      }
      return lead + out + trail;
    }),
  );
  // Highest index first, so Zq1 does not eat the front of Zq10.
  const out = names.reduceRight((s, n, i) => s.replaceAll(token(i), n), parts.join("\n"));
  if (placeholders(out) !== placeholders(hi)) throw new Error(`placeholders changed: ${hi} => ${out}`);
  return out.replaceAll("{brand}", BRAND[target] ?? BRAND_HI);
}

/** Pairs of [path, Hindi text] for every string leaf, skipping "_" notes. */
function leaves(node: Json, path: (string | number)[] = []): [(string | number)[], string][] {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, [...path, i]));
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => (k.startsWith("_") ? [] : leaves(v, [...path, k])));
  }
  return [];
}

function getAt(node: Json | undefined, path: (string | number)[]): Json | undefined {
  return path.reduce<Json | undefined>((n, k) => (n as Record<string | number, Json> | undefined)?.[k], node);
}

function setAt(node: Record<string, Json>, path: (string | number)[], value: string): void {
  let n: Record<string | number, Json> = node;
  path.slice(0, -1).forEach((k, i) => {
    n[k] ??= typeof path[i + 1] === "number" ? [] : {};
    n = n[k] as Record<string | number, Json>;
  });
  n[path[path.length - 1]] = value;
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

async function main() {
  const hi = JSON.parse(readFileSync("data/i18n/hi.json", "utf8")) as Record<string, Json>;
  const trades = JSON.parse(readFileSync("data/trades.json", "utf8")).trades as Record<string, { hi: string }>;

  const source: Record<string, Json> = {
    ...hi,
    trades: Object.fromEntries(Object.entries(trades).map(([k, t]) => [k, t.hi])),
  };

  const targets = process.argv.slice(2).length ? process.argv.slice(2) : TARGETS;

  for (const target of targets) {
    const file = `data/i18n/${target}.json`;
    const existing = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Json>) : {};
    const out: Record<string, Json> = {
      _note: `Machine-translated from hi.json by scripts/translate-voice-lines.ts (Bodhan indic-translate). Hand fixes are kept on rerun.`,
    };

    const todo: [(string | number)[], string][] = [];
    for (const [path, text] of leaves(source)) {
      const have = getAt(existing, path);
      // Still equal to the Hindi means it failed last time: try again.
      // So is a line whose name was translated instead of kept.
      const nameLost = text.includes(BRAND_HI) && typeof have === "string" && !have.includes(BRAND[target] ?? BRAND_HI);
      if (typeof have === "string" && have && have !== text && !nameLost) setAt(out, path, have);
      else todo.push([path, text]);
    }

    // Keep the source's key order so files diff cleanly against hi.json.
    const save = () => writeFileSync(file, JSON.stringify(mergeOrdered(source, out), null, 2) + "\n");

    let done = 0;
    const failed: string[] = [];
    await pool(todo, async ([path, text]) => {
      try {
        setAt(out, path, await translateLine(text, target));
      } catch (err) {
        failed.push(`${path.join(".")}: ${err instanceof Error ? err.message : err}`);
      }
      // Saved as it goes, so an interrupted run loses at most a few lines.
      if (++done % 10 === 0) {
        save();
        console.log(`${target}: ${done}/${todo.length}`);
      }
    });

    save();
    console.log(`${target}: ${todo.length - failed.length} translated, ${failed.length} left in Hindi -> ${file}`);
    for (const f of failed) console.log(`  ! ${f}`);
  }
}

/** `translated` laid out in `shape`'s key order; a line that failed stays in Hindi. */
function mergeOrdered(shape: Json, translated: Json | undefined): Json {
  if (Array.isArray(shape)) return shape.map((v, i) => mergeOrdered(v, (translated as Json[] | undefined)?.[i]));
  if (shape && typeof shape === "object") {
    const t = (translated ?? {}) as Record<string, Json>;
    const o: Record<string, Json> = typeof t._note === "string" ? { _note: t._note } : {};
    for (const [k, v] of Object.entries(shape)) if (!k.startsWith("_")) o[k] = mergeOrdered(v, t[k]);
    return o;
  }
  return typeof translated === "string" ? translated : shape;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
