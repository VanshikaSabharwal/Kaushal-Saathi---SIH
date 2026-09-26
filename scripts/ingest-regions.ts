/**
 * Build the district knowledge store from knowledge/<state>/<district>/.
 *
 *   npm run ingest:regions
 *
 * Reads .md/.txt directly and .pdf through `pdftotext` (poppler-utils), page
 * by page so every chunk keeps its page number for citation. Embeds with
 * Gemini when GOOGLE_API_KEY is set; otherwise stores text only and search
 * falls back to word overlap. Either way, every chunk is tagged with its
 * district, and search never crosses districts.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadEnv } from "../lib/env";

loadEnv();

import { keyFor } from "../app/lib/providers/env";
import { getDistrict } from "../lib/livelihood/catalog";
import { chunkDocument } from "../lib/rag/chunk";
import { embed, EMBED_DIM, EMBED_MODEL } from "../lib/rag/embed";
import { REGION_STORE_PATH, sourceTypeOf, splitPages, type RegionChunk, type RegionFile } from "../lib/rag/region";

const run = promisify(execFile);
const ROOT = path.resolve("knowledge");

async function pagesOf(file: string): Promise<{ page?: number; text: string }[]> {
  if (file.toLowerCase().endsWith(".pdf")) {
    const { stdout } = await run("pdftotext", ["-layout", file, "-"], { maxBuffer: 64 * 1024 * 1024 });
    return splitPages(stdout);
  }
  return [{ text: await readFile(file, "utf8") }];
}

async function main(): Promise<void> {
  const chunks: RegionChunk[] = [];

  for (const state of await readdir(ROOT, { withFileTypes: true }).catch(() => [])) {
    if (!state.isDirectory()) continue;

    for (const dir of await readdir(path.join(ROOT, state.name), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;

      const district = getDistrict(dir.name);
      if (!district) {
        console.warn(`skip knowledge/${state.name}/${dir.name}: not a district id in data/districts.json`);
        continue;
      }

      for (const f of await readdir(path.join(ROOT, state.name, dir.name))) {
        if (!/\.(pdf|md|txt)$/i.test(f)) continue;

        const file = path.join(ROOT, state.name, dir.name, f);
        const pages = await pagesOf(file);
        let n = 0;

        for (const p of pages) {
          for (const c of chunkDocument(f, p.text)) {
            chunks.push({
              id: `${district.id}/${f}#${p.page ?? 0}.${n++}`,
              text: c.text,
              state: district.state,
              district: district.id,
              sourceType: sourceTypeOf(f),
              document: f,
              page: p.page,
            });
          }
        }

        console.log(`${district.id}: ${f} — ${pages.length} page(s), ${n} chunk(s)`);
      }
    }
  }

  if (chunks.length === 0) {
    console.log("No documents found. See knowledge/README.md for what to put where.");
    return;
  }

  const file: RegionFile = { createdAt: Date.now(), chunks };

  if (keyFor("gemini")) {
    const vectors = new Float32Array(chunks.length * EMBED_DIM);
    for (let i = 0; i < chunks.length; i++) {
      vectors.set(await embed(chunks[i].text, "RETRIEVAL_DOCUMENT"), i * EMBED_DIM);
      if ((i + 1) % 25 === 0) console.log(`embedded ${i + 1}/${chunks.length}`);
    }
    file.vectors = Buffer.from(vectors.buffer).toString("base64");
    file.model = EMBED_MODEL;
    file.dim = EMBED_DIM;
  } else {
    console.log("No GOOGLE_API_KEY: stored without embeddings (search uses word overlap).");
  }

  await mkdir(path.dirname(REGION_STORE_PATH), { recursive: true });
  await writeFile(REGION_STORE_PATH, JSON.stringify(file));
  console.log(`\n${chunks.length} chunk(s) written to ${path.relative(process.cwd(), REGION_STORE_PATH)}`);
}

void main();
