"use client";

/**
 * The website in any language of India: a provider that translates whatever
 * is on screen into the chosen language, and the picker that chooses it.
 *
 * The choice is remembered on this device (a convenience; it is fine if the
 * browser forgets it) and shared by every page, beneficiary and staff alike.
 */

import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { FiGlobe, FiLoader, FiMic, FiX } from "react-icons/fi";
import { LANGUAGES, languageOf, type UiLanguage } from "../../../lib/i18n/languages";
import { DomTranslator, STATIC_LANGUAGES, type TranslatePhase } from "../../lib/dom-translate";
import { PREFETCH_FRAME } from "../../lib/shells";

const KEY = "ks_lang";
const EVENT = "ks-lang-change";

function readChoice(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function writeChoice(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

type TranslateState = {
  /** The language the page is being shown in. */
  lang: UiLanguage;
  /** The language the page is written in. */
  source: string;
  setLang: (code: string) => void;
};

const TranslateContext = createContext<TranslateState | null>(null);

export function useTranslation(): TranslateState | null {
  return useContext(TranslateContext);
}

export function TranslateProvider({ source, children }: { source: "hi" | "en"; children: React.ReactNode }) {
  // "" on the server and before a choice: show the source language.
  const chosen = useSyncExternalStore(subscribe, readChoice, () => "");
  // Staff screens offer only their dictionary's languages; any other choice (made on a beneficiary screen) shows the source.
  const offered = STATIC_LANGUAGES[source];
  const lang = languageOf(chosen && (!offered || offered.includes(chosen)) ? chosen : source);

  const root = useRef<HTMLDivElement | null>(null);
  const translator = useRef<DomTranslator | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<TranslatePhase>("idle");
  const path = usePathname();

  // Layout effects, so translations this device already has are written before the first paint.
  useLayoutEffect(() => {
    // The hidden frame that reads a page's text ahead of time wants the originals.
    if (!root.current || window.name === PREFETCH_FRAME) return;
    translator.current = new DomTranslator(root.current, source, (m) => setNotice(m), setPhase);
    return () => {
      translator.current?.dispose();
      translator.current = null;
      setPhase("idle");
    };
  }, [source]);

  useLayoutEffect(() => {
    document.documentElement.lang = lang.code;
    document.documentElement.dir = lang.rtl ? "rtl" : "ltr";
    void translator.current?.setLanguage(lang.code);
  }, [lang.code, lang.rtl, source]);

  useLayoutEffect(() => {
    translator.current?.pageChanged();
  }, [path]);

  return (
    <TranslateContext.Provider value={{ lang, source, setLang: writeChoice }}>
      <div ref={root} className="contents" aria-busy={phase !== "idle"}>
        {children}
      </div>
      {phase === "fetching" && (
        <p
          role="status"
          translate="no"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--ks-primary)] px-4 py-2 text-sm text-white shadow-lg"
        >
          <FiLoader className="animate-spin" aria-hidden />
          <span>{lang.native}</span>
          <span className="sr-only">Translating the page to {lang.name}</span>
        </p>
      )}
      {notice && lang.code !== source && (
        <p translate="no" className="fixed bottom-2 left-2 right-2 z-50 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-center text-xs text-[var(--warning)]">
          Translation unavailable right now — showing the original. ({notice})
          <button className="ml-2 inline-flex align-middle" onClick={() => setNotice(null)} aria-label="Close"><FiX aria-hidden /></button>
        </p>
      )}
    </TranslateContext.Provider>
  );
}

/** The language button and the grid of languages, each in its own script. */
export function LanguagePicker({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  if (!t) return null;

  return (
    <div translate="no" className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="भाषा चुनें / Choose language"
        className={`flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm ${
          tone === "light" ? "hover:bg-white/10" : "border border-[var(--border-strong)] bg-white hover:bg-[var(--surface-muted)]"
        }`}
      >
        <FiGlobe aria-hidden /> <span>{t.lang.native}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-4 text-[var(--foreground)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-lg font-semibold">भाषा चुनें · Choose your language</p>
              <button className="cursor-pointer text-xl" onClick={() => setOpen(false)} aria-label="Close"><FiX aria-hidden /></button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.filter((l) => !STATIC_LANGUAGES[t.source] || STATIC_LANGUAGES[t.source].includes(l.code)).map((l) => (
                <button
                  key={l.code}
                  dir={l.rtl ? "rtl" : "ltr"}
                  onClick={() => {
                    t.setLang(l.code);
                    setOpen(false);
                  }}
                  className={`min-h-14 cursor-pointer rounded-xl border-2 px-3 py-2 text-left ${
                    l.code === t.lang.code ? "border-[var(--ks-primary)] bg-[var(--ks-primary-soft)]" : "border-[var(--border)] hover:border-[var(--ks-primary)]"
                  }`}
                >
                  <span className="block text-lg font-semibold">{l.native}</span>
                  <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    {l.name}
                    {l.voice && <FiMic aria-label="voice" />}
                  </span>
                </button>
              ))}
            </div>

            {!STATIC_LANGUAGES[t.source] && (
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Pages are machine-translated and may contain mistakes. The microphone mark means the voice assistant speaks
                this language; in the others, use the written chat (सहायता).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
