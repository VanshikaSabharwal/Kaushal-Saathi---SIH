"use client";

/**
 * Translating a rendered page in place.
 *
 * Walks the text nodes (and placeholder / aria-label / title attributes) under
 * a root, sends the distinct strings to /api/translate in batches, and writes
 * the results back — remembering every original, so switching back, or to a
 * third language, always translates from the source text, never from a
 * translation of a translation.
 *
 * Translations are shared by every translator on the page and kept on this
 * device, so a page seen once in a language opens already translated: known
 * strings are written before the browser paints, and only new ones are fetched.
 *
 * While the reader waits (just after choosing a language or opening a page),
 * text still waiting for its translation is marked [data-ks-pending] and shown
 * as a skeleton bar instead of the source language; when the translations
 * arrive, the lines fade in from the top of the screen down. The look lives in
 * globals.css.
 *
 * The page being read comes first: the strings on screen go out in the first,
 * small batches and each batch fades in as it lands, the rest of the page
 * follows in parallel. Once the page is done, the pages it links to are
 * translated in the background (their server-rendered text), so opening them
 * next is instant.
 *
 * Anything inside [translate="no"] is left alone: phone numbers, OTP codes,
 * the language picker itself.
 */

import { PREFETCH_FRAME, sourceForPath } from "./shells";

const ATTRS = ["placeholder", "aria-label", "title"] as const;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "NOSCRIPT", "TEMPLATE"]);
const HAS_LETTER = /\p{L}/u;

/**
 * The translation service works string by string (a few at a time), so a
 * request takes as long as its batch is big: the text on screen goes in small
 * batches ahead of the rest, and a few requests run at once.
 */
const SCREEN_BATCH = 12;
const BATCH = 25;
const PARALLEL = 3;

/** Background translation of linked pages: how many per page, and how long to let the page settle first. */
const PREFETCH_PAGES = 6;
const PREFETCH_DELAY_MS = 1500;
/** A linked page gets this long to load in the hidden frame, and this long more for its data to arrive. */
const FRAME_TIMEOUT_MS = 15000;
const FRAME_SETTLE_MS = 5000;

/** After a language or page change, new text within this long is treated as awaited: skeleton, then fade in. */
const WAIT_WINDOW_MS = 4000;
/** The fade-in walks down the screen in at most this long, however many lines there are. */
const REVEAL_MS = 700;
/** Pause between two lines of the fade-in, at most. */
const LINE_GAP_MS = 55;
/** Matches the ks-in animation in globals.css. */
const FADE_MS = 400;
/** Text in the site chrome stays readable while the page body is a skeleton. */
const NO_SKELETON = "header, nav";

/**
 * idle: nothing to wait for. fetching: the page is waiting on new strings.
 * revealing: they arrived and are fading in.
 */
export type TranslatePhase = "idle" | "fetching" | "revealing";

/** Bump to forget every translation stored on devices. (2: drop what the free fallback translated.) */
const STORE = "ks_tr2";
/** Per language; the oldest strings are dropped first. */
const STORE_LIMIT = 4000;

const memory = new Map<string, Map<string, string>>();
/**
 * Strings the server's free fallback translated: shown for this visit but not
 * kept on the device, so a better translation replaces them once one is available.
 */
const provisional = new Set<string>();

/** original -> translation, for one source and target language. */
function cacheFor(source: string, lang: string): Map<string, string> {
  const key = `${STORE}:${source}:${lang}`;
  let cache = memory.get(key);
  if (!cache) {
    cache = new Map();
    try {
      const raw = localStorage.getItem(key);
      if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) cache.set(k, v);
    } catch {
      // Blocked or corrupt storage: start empty.
    }
    memory.set(key, cache);
  }
  return cache;
}

function persist(source: string, lang: string, cache: Map<string, string>): void {
  try {
    const kept = [...cache].filter(([k]) => !provisional.has(`${source}:${lang}:${k}`)).slice(-STORE_LIMIT);
    localStorage.setItem(`${STORE}:${source}:${lang}`, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Full or blocked storage: the translations last for this visit only.
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Linked pages already translated in the background, as "lang path" — shared, so each is fetched once per visit. */
const prefetched = new Set<string>();

/** Every translatable string in a rendered page: the same text the translator would find there. */
function stringsIn(doc: Document): string[] {
  const out = new Set<string>();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue?.trim() ?? "";
    const el = n.parentElement;
    if (!value || !HAS_LETTER.test(value) || !el || el.closest('[translate="no"]')) continue;
    if ([...SKIP_TAGS].some((tag) => el.closest(tag))) continue;
    out.add(value);
  }
  doc.body.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(",")).forEach((el) => {
    if (el.closest('[translate="no"]')) return;
    for (const a of ATTRS) {
      const value = el.getAttribute(a)?.trim();
      if (value && HAS_LETTER.test(value)) out.add(value);
    }
  });
  return [...out];
}

/**
 * Render `path` in a hidden frame and read its text once it settles — the
 * text a page fetches after loading included, which its HTML alone lacks.
 * Null if it could not be loaded, or `cancelled()` turned true meanwhile.
 */
async function renderedStrings(path: string, cancelled: () => boolean): Promise<string[] | null> {
  const frame = document.createElement("iframe");
  frame.name = PREFETCH_FRAME;
  frame.src = path;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;visibility:hidden;pointer-events:none;border:0";
  const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  document.body.appendChild(frame);

  try {
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), FRAME_TIMEOUT_MS));
    if ((await Promise.race([loaded, timeout])) === "timeout") return null;

    // Settled: the same text twice in a row (the page's own data requests have landed).
    let last = -1;
    for (let waited = 0; waited < FRAME_SETTLE_MS; waited += 400) {
      await new Promise((r) => setTimeout(r, 400));
      if (cancelled()) return null;
      const doc = frame.contentDocument;
      if (!doc?.body) return null;
      const count = stringsIn(doc).length;
      if (count === last && waited >= 800) break;
      last = count;
    }
    return frame.contentDocument ? stringsIn(frame.contentDocument) : null;
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}

/** The pre-paint skeleton set by the root layout's script; lifted once the translator has marked what is pending. */
function liftBootSkeleton(): void {
  document.documentElement.removeAttribute("data-ks-boot");
}

type Tracked = { original: string; applied?: string };

export class DomTranslator {
  private texts = new Map<Text, Tracked>();
  private attrs = new Map<Element, Partial<Record<(typeof ATTRS)[number], Tracked>>>();
  /** Strings the service could not translate this time; not retried until the language changes. */
  private failed = new Set<string>();
  /** Elements currently shown as skeleton bars. */
  private pending = new Set<Element>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private target: string;
  private running = false;
  /** Until when new text is something the reader is waiting on. */
  private waitUntil = 0;
  private phase: TranslatePhase = "idle";

  constructor(
    private readonly root: HTMLElement,
    private readonly source: string,
    private readonly onError?: (message: string) => void,
    private readonly onPhase?: (phase: TranslatePhase) => void,
  ) {
    this.target = source;
  }

  /** Switch the page to `lang`; the source language restores the originals. */
  async setLanguage(lang: string): Promise<void> {
    this.target = lang;
    this.failed.clear();
    this.unmarkAll();

    if (lang === this.source) {
      this.waitUntil = 0;
      this.stopObserving();
      this.restore();
      liftBootSkeleton();
      this.setPhase("idle");
      return;
    }

    this.waitUntil = performance.now() + WAIT_WINDOW_MS;
    this.applyKnown();
    this.startObserving();
    await this.run();
  }

  /** A new page was navigated to: its new text is awaited, so it shows as a skeleton until translated. */
  pageChanged(): void {
    if (this.target !== this.source) this.waitUntil = performance.now() + WAIT_WINDOW_MS;
  }

  dispose(): void {
    this.stopObserving();
    this.unmarkAll();
    if (this.timer) clearTimeout(this.timer);
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
  }

  private waiting(): boolean {
    return performance.now() < this.waitUntil;
  }

  private setPhase(phase: TranslatePhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.onPhase?.(phase);
  }

  private skipped(node: Node): boolean {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.getAttribute("translate") === "no") return true;
      if (el === this.root) return false;
    }
    return false;
  }

  /** Find everything translatable, noting new originals as React changes text. */
  private collect(): void {
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT);

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const node = n as Text;
      const value = node.nodeValue ?? "";
      if (!HAS_LETTER.test(value) || this.skipped(node)) continue;

      const t = this.texts.get(node);
      // React replaced the text since we translated it: that is a new original.
      if (!t || (value !== t.applied && value !== t.original)) this.texts.set(node, { original: value });
    }

    this.root.querySelectorAll<HTMLElement>(ATTRS.map((a) => `[${a}]`).join(",")).forEach((el) => {
      if (el.closest('[translate="no"]')) return;
      const entry = this.attrs.get(el) ?? {};
      for (const a of ATTRS) {
        const value = el.getAttribute(a);
        if (!value || !HAS_LETTER.test(value)) continue;
        const t = entry[a];
        if (!t || (value !== t.applied && value !== t.original)) entry[a] = { original: value };
      }
      this.attrs.set(el, entry);
    });

    // Forget nodes React has removed.
    for (const node of this.texts.keys()) if (!node.isConnected) this.texts.delete(node);
    for (const el of this.attrs.keys()) if (!el.isConnected) this.attrs.delete(el);
    for (const el of [...this.pending]) if (!el.isConnected) this.unmark(el);
  }

  /**
   * Write every translation already known and, if the reader is waiting, turn
   * the rest into skeleton bars — called before paint (from a layout effect or
   * a mutation callback), so the source language never flashes.
   */
  private applyKnown(): void {
    this.collect();
    this.apply(this.target);
    if (this.waiting() && this.markMissing()) this.setPhase("fetching");
    liftBootSkeleton();
  }

  /** Mark the elements whose text has no translation yet; returns how many are marked. */
  private markMissing(): number {
    const cache = cacheFor(this.source, this.target);
    for (const [node, t] of this.texts) {
      const core = t.original.trim();
      if (!core || cache.has(core) || this.failed.has(core)) continue;
      const el = node.parentElement;
      if (!el || this.pending.has(el) || el.closest(NO_SKELETON)) continue;
      el.setAttribute("data-ks-pending", "");
      this.pending.add(el);
    }
    if (this.pending.size) document.documentElement.setAttribute("data-ks-skeleton", "");
    return this.pending.size;
  }

  private unmark(el: Element): void {
    el.removeAttribute("data-ks-pending");
    this.pending.delete(el);
    if (!this.pending.size) document.documentElement.removeAttribute("data-ks-skeleton");
  }

  private unmarkAll(): void {
    for (const el of [...this.pending]) this.unmark(el);
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.schedule();
      return;
    }
    this.running = true;
    const lang = this.target;
    const cache = cacheFor(this.source, lang);
    const awaited = this.waiting();
    let fetched = false;

    try {
      this.collect();

      const originals = new Set<string>();
      for (const t of this.texts.values()) originals.add(t.original.trim());
      for (const e of this.attrs.values()) for (const t of Object.values(e)) if (t) originals.add(t.original.trim());

      const missing = [...originals].filter((o) => o && !cache.has(o) && !this.failed.has(o));
      if (!missing.length) {
        this.apply(lang);
        return;
      }
      if (awaited && this.markMissing()) this.setPhase("fetching");

      // What the reader can see goes first, in small batches; the rest of the page after it.
      const onScreen = this.onScreenStrings();
      const queue = [
        ...chunks(missing.filter((o) => onScreen.has(o)), SCREEN_BATCH),
        ...chunks(missing.filter((o) => !onScreen.has(o)), BATCH),
      ];

      // Each batch is shown as soon as it lands, one fade-in after another.
      let shown = Promise.resolve();
      const show = () => {
        shown = shown.then(() => {
          if (this.target !== lang) return;
          if (awaited && !prefersReducedMotion()) return this.reveal(lang);
          this.apply(lang);
        });
      };

      const worker = async () => {
        for (let chunk = queue.shift(); chunk && this.target === lang; chunk = queue.shift()) {
          if (await this.fetchInto(chunk, lang, cache)) fetched = true;
          if (this.target === lang) show();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
      await shown;
    } catch {
      this.onError?.("could not reach the translation service");
    } finally {
      this.running = false;
      if (fetched) persist(this.source, lang, cache);
      // Switched language mid-way: the newer run owns the skeleton and the phase.
      if (this.target === lang) {
        this.unmarkAll();
        // Text that arrived while we fetched is still awaited: keep it as skeleton for the next run.
        if (this.waiting() && this.markMissing()) this.schedule();
        else {
          this.setPhase("idle");
          this.prefetchSoon();
        }
      }
    }
  }

  /**
   * Translate `chunk` into the cache; false if the service failed (those
   * strings are not retried until the language changes). `quiet` for
   * background work, which the reader should not hear about.
   */
  private async fetchInto(chunk: string[], lang: string, cache: Map<string, string>, quiet = false): Promise<boolean> {
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: chunk, target: lang, source: this.source }),
      });
      const data = (await res.json().catch(() => ({}))) as { translations?: string[]; error?: string; fallback?: boolean };
      if (data.error && !quiet) this.onError?.(data.error);
      // On failure the service echoes the originals; never store those as translations, they would stick on this device.
      if (!data.error && data.translations?.length === chunk.length) {
        data.translations.forEach((tr, j) => {
          cache.set(chunk[j], tr);
          const key = `${this.source}:${lang}:${chunk[j]}`;
          if (data.fallback) provisional.add(key);
          else provisional.delete(key);
        });
        return true;
      }
    } catch {
      if (!quiet) this.onError?.("could not reach the translation service");
    }
    chunk.forEach((c) => this.failed.add(c));
    return false;
  }

  /** The strings currently inside the viewport. */
  private onScreenStrings(): Set<string> {
    const out = new Set<string>();
    const height = window.innerHeight;
    for (const [node, t] of this.texts) {
      const box = node.parentElement?.getBoundingClientRect();
      if (box && box.bottom > 0 && box.top < height) out.add(t.original.trim());
    }
    return out;
  }

  /** Once the page has settled, translate the pages it links to in the background. */
  private prefetchSoon(): void {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      const go = () => void this.prefetchLinked(this.target);
      if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 3000 });
      else go();
    }, PREFETCH_DELAY_MS);
  }

  /**
   * Render the pages this page links to (same shell, so same source language)
   * in a hidden frame, one at a time, and translate their text into the cache.
   * Stops as soon as the page being read needs the service, or the language
   * changes; the next quiet moment picks up again. Skipped on Data Saver.
   */
  private async prefetchLinked(lang: string): Promise<void> {
    if (lang === this.source) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const cache = cacheFor(this.source, lang);
    const here = location.pathname + location.search;

    const pages = [...this.root.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
      .map((a) => new URL(a.href))
      .filter((u) => u.origin === location.origin && sourceForPath(u.pathname) === this.source)
      .map((u) => u.pathname + u.search)
      .filter((p, i, all) => p !== here && all.indexOf(p) === i && !prefetched.has(`${lang} ${p}`))
      .slice(0, PREFETCH_PAGES);

    const busy = () => this.target !== lang || this.running || this.phase !== "idle";

    for (const path of pages) {
      if (busy()) return;
      const strings = await renderedStrings(path, busy);
      if (busy()) return; // not marked done: tried again at the next quiet moment
      if (!strings) {
        prefetched.add(`${lang} ${path}`);
        continue;
      }

      const missing = strings.filter((s) => !cache.has(s) && !this.failed.has(s));
      let fetched = false;
      for (const chunk of chunks(missing, BATCH)) {
        if (busy()) {
          if (fetched) persist(this.source, lang, cache);
          return;
        }
        if (await this.fetchInto(chunk, lang, cache, true)) fetched = true;
      }
      if (fetched) persist(this.source, lang, cache);
      prefetched.add(`${lang} ${path}`);
    }
  }

  /** The text `original` should show in `lang`; spaces around it are layout, not language. */
  private translated(original: string, cache: Map<string, string>): string {
    const core = original.trim();
    const tr = cache.get(core);
    return tr === undefined ? original : original.replace(core, tr);
  }

  private writeText(node: Text, t: Tracked, cache: Map<string, string>): void {
    const next = this.translated(t.original, cache);
    if (node.nodeValue !== next) node.nodeValue = next;
    t.applied = next;
  }

  private writeAttrs(cache: Map<string, string>): void {
    for (const [el, entry] of this.attrs) {
      for (const a of ATTRS) {
        const t = entry[a];
        if (!t) continue;
        const next = this.translated(t.original, cache);
        if (el.getAttribute(a) !== next) el.setAttribute(a, next);
        t.applied = next;
      }
    }
  }

  private apply(lang: string): void {
    if (lang === this.source) return;
    const cache = cacheFor(this.source, lang);

    this.stopObserving();
    for (const [node, t] of this.texts) this.writeText(node, t, cache);
    this.writeAttrs(cache);
    this.startObserving();
  }

  /**
   * Write the translations in line by line from the top of the screen down,
   * each line fading in as it changes. Text off screen changes at once.
   */
  private reveal(lang: string): Promise<void> {
    const cache = cacheFor(this.source, lang);
    this.stopObserving();
    this.writeAttrs(cache);

    // The text that changes, grouped by the element that shows it.
    const groups = new Map<Element, [Text, Tracked][]>();
    for (const [node, t] of this.texts) {
      const el = node.parentElement;
      // React changed this text since we collected it: leave it for the next run.
      if (!el || (node.nodeValue !== t.original && node.nodeValue !== t.applied)) continue;
      if (node.nodeValue === this.translated(t.original, cache)) continue;
      groups.set(el, [...(groups.get(el) ?? []), [node, t]]);
    }

    const height = window.innerHeight;
    const rows: { el: Element; nodes: [Text, Tracked][]; top: number }[] = [];
    for (const [el, nodes] of groups) {
      const box = el.getBoundingClientRect();
      if (box.bottom > 0 && box.top < height) {
        rows.push({ el, nodes, top: box.top });
      } else {
        for (const [node, t] of nodes) this.writeText(node, t, cache);
        this.unmark(el);
      }
    }

    // Elements whose tops are within a few pixels share a line and fade in together.
    rows.sort((a, b) => a.top - b.top);
    const lines: (typeof rows)[] = [];
    for (const row of rows) {
      const line = lines.at(-1);
      if (line && row.top - line[0].top < 8) line.push(row);
      else lines.push([row]);
    }

    const gap = Math.min(LINE_GAP_MS, REVEAL_MS / Math.max(1, lines.length));

    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (this.target !== lang) return resolve();
        if (i === lines.length) {
          this.startObserving();
          this.schedule(); // pick up anything that changed while we were not watching
          return resolve();
        }
        for (const { el, nodes } of lines[i++]) {
          for (const [node, t] of nodes) this.writeText(node, t, cache);
          this.unmark(el);
          el.setAttribute("data-ks-in", "");
          setTimeout(() => el.removeAttribute("data-ks-in"), FADE_MS + 50);
        }
        setTimeout(next, gap);
      };
      next();
    });
  }

  private restore(): void {
    for (const [node, t] of this.texts) if (node.isConnected && node.nodeValue === t.applied) node.nodeValue = t.original;
    for (const [el, entry] of this.attrs) {
      for (const a of ATTRS) {
        const t = entry[a];
        if (t && el.getAttribute(a) === t.applied) el.setAttribute(a, t.original);
      }
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), 250);
  }

  private startObserving(): void {
    if (this.observer || this.target === this.source) return;
    // Mutation callbacks run before paint: known strings are swapped in (or shown as skeleton) at once, new ones fetched shortly.
    this.observer = new MutationObserver(() => {
      this.applyKnown();
      this.schedule();
    });
    this.observer.observe(this.root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

/** Translate a few strings directly (e.g. a chat message into Hindi for the bot). */
export async function translateTexts(texts: string[], target: string, source: string): Promise<string[]> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, target, source }),
  });
  const data = (await res.json().catch(() => ({}))) as { translations?: string[] };
  return data.translations ?? texts;
}
