/**
 * A small keyed collection with the same Mongo-with-file-fallback shape as
 * lib/store/evals.ts, for the livelihood records (beneficiaries, tasks,
 * unknown words) that would otherwise each repeat it.
 *
 * Queries are top-level equality only ({ district: "jhansi" }), which both
 * MongoDB and an in-memory filter evaluate identically — the file fallback
 * must return what the database would, or local development lies.
 *
 * File writes are serialised through one promise chain per collection, so two
 * events for the same caller landing together cannot read-modify-write over
 * each other. Only the voice server writes; the Next app goes through its
 * internal routes, which is what keeps that guarantee true across processes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tryGetDb } from "../db/mongo";

const DATA_DIR = path.join(process.cwd(), ".data");

export type Keyed = { id: string };

export type ListOptions<T> = {
  sortBy?: keyof T;
  desc?: boolean;
  limit?: number;
};

export type Collection<T extends Keyed> = {
  get(id: string): Promise<T | null>;
  findOne(query: Partial<T>): Promise<T | null>;
  list(query?: Partial<T>, opts?: ListOptions<T>): Promise<T[]>;
  upsert(doc: T): Promise<boolean>;
  /** Read, change and write one document as a single serialised step. */
  update(id: string, change: (doc: T | null) => T | null): Promise<T | null>;
  remove(id: string): Promise<boolean>;
};

function matches<T>(doc: T, query: Partial<T>): boolean {
  return Object.entries(query).every(
    ([k, v]) => v === undefined || (doc as Record<string, unknown>)[k] === v,
  );
}

function sorted<T>(docs: T[], opts: ListOptions<T>): T[] {
  const out = [...docs];

  if (opts.sortBy) {
    const k = opts.sortBy;
    out.sort((a, b) => {
      const x = a[k] as unknown as number | string;
      const y = b[k] as unknown as number | string;
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return opts.desc ? -cmp : cmp;
    });
  }

  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Drop undefined fields: Mongo would store them as null, files would drop them. */
function clean<T>(q: Partial<T>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined));
}

export function createCollection<T extends Keyed>(name: string, opts: { max?: number } = {}): Collection<T> {
  const file = path.join(DATA_DIR, `${name}.json`);
  let chain: Promise<unknown> = Promise.resolve();

  const serial = <R>(work: () => Promise<R>): Promise<R> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };

  async function readAll(): Promise<T[]> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Missing file simply means nothing stored yet.
      return [];
    }
  }

  async function writeAll(docs: T[]): Promise<void> {
    const capped = opts.max ? docs.slice(0, opts.max) : docs;
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(capped, null, 2), "utf8");
  }

  async function mongo() {
    const db = await tryGetDb();
    return db ? db.collection(name) : null;
  }

  const self: Collection<T> = {
    async get(id) {
      return self.findOne({ id } as Partial<T>);
    },

    async findOne(query) {
      const col = await mongo();

      if (col) {
        try {
          return (await col.findOne(clean(query), { projection: { _id: 0 } })) as T | null;
        } catch (err) {
          console.error(`[${name}] mongo read failed:`, err);
        }
      }

      return (await readAll()).find((d) => matches(d, query)) ?? null;
    },

    async list(query = {}, listOpts = {}) {
      const col = await mongo();

      if (col) {
        try {
          let cursor = col.find(clean(query), { projection: { _id: 0 } });
          if (listOpts.sortBy) cursor = cursor.sort({ [listOpts.sortBy as string]: listOpts.desc ? -1 : 1 });
          if (listOpts.limit) cursor = cursor.limit(listOpts.limit);
          return (await cursor.toArray()) as unknown as T[];
        } catch (err) {
          console.error(`[${name}] mongo read failed:`, err);
        }
      }

      return sorted((await readAll()).filter((d) => matches(d, query)), listOpts);
    },

    async upsert(doc) {
      return serial(async () => {
        const col = await mongo();

        if (col) {
          try {
            await col.replaceOne({ id: doc.id }, doc, { upsert: true });
            return true;
          } catch (err) {
            console.error(`[${name}] mongo write failed:`, err);
            return false;
          }
        }

        try {
          const all = await readAll();
          await writeAll([doc, ...all.filter((d) => d.id !== doc.id)]);
          return true;
        } catch (err) {
          console.error(`[${name}] file write failed:`, err);
          return false;
        }
      });
    },

    async update(id, change) {
      return serial(async () => {
        const col = await mongo();

        if (col) {
          try {
            const current = (await col.findOne({ id }, { projection: { _id: 0 } })) as T | null;
            const next = change(current);
            if (next) await col.replaceOne({ id }, next, { upsert: true });
            return next;
          } catch (err) {
            console.error(`[${name}] mongo update failed:`, err);
            return null;
          }
        }

        try {
          const all = await readAll();
          const next = change(all.find((d) => d.id === id) ?? null);
          if (next) await writeAll([next, ...all.filter((d) => d.id !== id)]);
          return next;
        } catch (err) {
          console.error(`[${name}] file update failed:`, err);
          return null;
        }
      });
    },

    async remove(id) {
      return serial(async () => {
        const col = await mongo();

        if (col) {
          try {
            return (await col.deleteOne({ id })).deletedCount > 0;
          } catch (err) {
            console.error(`[${name}] mongo delete failed:`, err);
            return false;
          }
        }

        try {
          const all = await readAll();
          const rest = all.filter((d) => d.id !== id);
          await writeAll(rest);
          return rest.length < all.length;
        } catch (err) {
          console.error(`[${name}] file delete failed:`, err);
          return false;
        }
      });
    },
  };

  return self;
}
