/**
 * Ship the translations already paid for: copy the translation cache into
 * data/i18n/static.json, which translate() checks before any provider.
 *
 *   npm run i18n:export     # reads MongoDB when MONGODB_URL is set, else .data/
 *
 * Only text that appears in this codebase (page code, catalogue data, the
 * scripted lines) is exported. The cache also holds whatever was on screen
 * when someone translated their own dashboard — names, what they said — and
 * that must never end up in a file in the repo.
 *
 * Output of the free fallback (MyMemory) is left out: shipped translations are
 * final, and a weak one would block the better provider from replacing it.
 * Existing entries are kept; re-run whenever more of the site has been read.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/env";

loadEnv();

import { createCollection } from "../lib/store/collection";

type Cached = { id: string; lang: string; text: string; translated: string; provider: string; at: number };

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data/i18n/static.json");
const SOURCES = ["hi", "en"];

const keyOf = (target: string, source: string, text: string) =>
  createHash("sha1").update(`${source}>${target}|${text}`).digest("hex");

/** Every .ts/.tsx/.json file under these folders, as one searchable string. */
function corpus(dirs: string[]): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (p === OUT || name === "node_modules" || name.startsWith(".")) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(name)) parts.push(readFileSync(p, "utf8"));
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  return parts.join("\n");
}

async function main(): Promise<void> {
  const code = corpus(["app", "lib", "data"]);
  const all = await createCollection<Cached>("translations").list({}, { limit: 500000 });

  const out: Record<string, Record<string, string>> = JSON.parse(readFileSync(OUT, "utf8"));
  let added = 0;
  let personal = 0;
  let fallback = 0;

  for (const t of all) {
    const text = t.text.trim();
    if (!text || !t.translated?.trim()) continue;
    if (t.provider === "mymemory") {
      fallback++;
      continue;
    }
    if (!code.includes(text)) {
      personal++;
      continue;
    }

    // The cache key is a hash of source>target|text; recover the source from it.
    const source = SOURCES.find((s) => keyOf(t.lang, s, t.text) === t.id);
    if (!source) continue;

    const pair = (out[`${source}>${t.lang}`] ??= {});
    if (!pair[t.text]) added++;
    pair[t.text] = t.translated;
  }

  // Stable order, so re-running produces a readable diff.
  const sorted = Object.fromEntries(
    Object.keys(out).sort().map((k) => [k, Object.fromEntries(Object.entries(out[k]).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  writeFileSync(OUT, JSON.stringify(sorted, null, 1) + "\n");

  const counts = Object.entries(sorted).map(([k, v]) => `${k}: ${Object.keys(v).length}`).join(", ");
  console.log(`cache: ${all.length} entries`);
  console.log(`added ${added} · skipped ${personal} not in the code (personal or composed text) · skipped ${fallback} from the free fallback`);
  console.log(`static.json now: ${counts || "empty"}`);
  process.exit(0);
}

void main();
