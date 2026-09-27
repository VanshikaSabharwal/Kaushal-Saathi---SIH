"use client";

/**
 * The voice assistant with the browser's own speech engines — free, no keys.
 *
 * Listening is the Web Speech API (Chrome, Edge, Android Chrome); speaking is
 * speechSynthesis. The conversation itself is the same as on a phone call:
 * each utterance goes to /api/chat, which runs the interview / help desk and
 * saves to the person's record. Only the ears and the voice are the browser's.
 *
 * Note for privacy notices: Chrome's recognition sends audio to Google's
 * servers. The server engine (Sarvam / Bhashini) does not have that property.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FiMic, FiSquare } from "react-icons/fi";
import { PiHandPalm } from "react-icons/pi";
import { useTranslation } from "./Translate";

type Phase = "idle" | "speaking" | "listening" | "thinking" | "ended";

type Line = { role: "user" | "assistant"; text: string };

// Minimal typing for the Web Speech API, which TypeScript's DOM lib omits.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function browserVoiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && Boolean(recognitionClass());
}

const PHASE_HI: Record<Phase, string> = {
  idle: "बात शुरू करने के लिए बटन दबाइए",
  speaking: "बोल रही हूँ… (बीच में भी बोल सकते हैं)",
  listening: "बोलिए, मैं सुन रही हूँ…",
  thinking: "सोच रही हूँ…",
  ended: "बात पूरी हुई",
};

const BCP47: Record<string, string> = {
  hi: "hi-IN", mr: "mr-IN", en: "en-IN", kok: "kok-IN", te: "te-IN", as: "as-IN", bn: "bn-IN",
};
const MAX_SILENT_TRIES = 3;
/** Quiet this long after the assistant stops (or after the last word) ends the turn. */
const SILENCE_MS = 7000;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[.,!?;:।॥"'`—-]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Is the person talking over the assistant, rather than the mic hearing the
 * assistant's own voice? Without headphones the speaker reaches the mic and
 * the recogniser transcribes it, so words the assistant is saying right now
 * do not count. A single stray word does not either, unless it is final.
 */
function talkingOver(heard: string, spoken: string, final: boolean): boolean {
  const said = new Set(words(spoken));
  const all = words(heard);
  const fresh = all.filter((w) => !said.has(w));
  return fresh.length >= (final ? 1 : 2) && fresh.length * 2 >= all.length;
}

/**
 * One recognition session. "watch" runs while the assistant speaks, only to
 * notice being talked over; "listen" is taking the person's answer. The same
 * session carries on from one to the other, so the first words of an
 * interruption are not lost to a restart.
 */
type Ear = {
  r: Recognition;
  mode: "watch" | "listen";
  /** Results before this index are the assistant's own voice; ignored. */
  from: number;
  count: number;
  final: string;
  interim: string;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
};

/** Chrome drops long utterances; speak sentence by sentence. */
function sentences(text: string): string[] {
  return text.match(/[^।.?!]+[।.?!]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  // Marathi voices are rare; a Hindi voice reads Devanagari Marathi acceptably.
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(lang.slice(0, 2))) ?? voices.find((v) => v.lang === "hi-IN");
}

export default function BrowserTalk({
  getTicket,
  onEnded,
}: {
  getTicket?: () => Promise<string | undefined>;
  onEnded?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);

  const session = useRef<string | null>(null);
  // Starts in the website's language; the server may switch it mid-call.
  const pageLang = useTranslation()?.lang.code;
  const lang = useRef(pageLang ?? "hi");
  const ear = useRef<Ear | null>(null);
  const silent = useRef(0);
  const active = useRef(false);
  /** What is being said now; the id changes when speech is cut short, so stale end events are ignored. */
  const speech = useRef({ id: 0, text: "", on: false });

  const stopAll = useCallback(() => {
    speech.current = { id: speech.current.id + 1, text: "", on: false };
    window.speechSynthesis?.cancel();
    const e = ear.current;
    ear.current = null;
    if (e) {
      clearTimeout(e.timer);
      e.r.abort();
    }
  }, []);

  useEffect(() => () => {
    active.current = false;
    stopAll();
  }, [stopAll]);

  const finish = useCallback(() => {
    active.current = false;
    stopAll();
    setPhase("ended");
    onEnded?.();
  }, [stopAll, onEnded]);

  /** Speak a reply, then either listen for the answer or end. */
  const say = useCallback(
    (text: string, end: boolean) => {
      setLines((l) => [...l, { role: "assistant", text }]);
      setPhase("speaking");

      const id = speech.current.id + 1;
      speech.current = { id, text, on: true };

      const parts = sentences(text);
      const bcp = BCP47[lang.current] ?? "hi-IN";
      const voice = voiceFor(bcp);

      parts.forEach((part, i) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = bcp;
        if (voice) u.voice = voice;
        u.rate = 0.95;
        if (i === parts.length - 1) {
          u.onend = () => {
            if (!active.current || speech.current.id !== id) return;
            speech.current.on = false;
            if (end) finish();
            else hearAnswer();
          };
        }
        window.speechSynthesis.speak(u);
      });

      // A goodbye is not interrupted; anything else can be talked over.
      if (!end) startEar("watch");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finish],
  );

  const send = useCallback(
    async (text?: string) => {
      setPhase("thinking");
      const body: Record<string, unknown> = { sessionId: session.current };
      if (text) body.text = text;
      if (!session.current && getTicket) body.ticket = await getTicket();
      if (!session.current && pageLang) body.language = pageLang;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;

      if (!active.current) return;
      if (!res?.ok || !data?.reply) {
        setError("सर्वर से जवाब नहीं मिला। थोड़ी देर में फिर कोशिश करें।");
        finish();
        return;
      }

      session.current = data.sessionId;
      if (data.language) lang.current = data.language;
      say(data.reply, Boolean(data.end));
    },
    [getTicket, pageLang, say, finish],
  );

  /** Listening for an answer, ending the turn after a stretch of quiet. */
  function toListen(e: Ear, from: number) {
    e.mode = "listen";
    e.from = from;
    setHeard("");
    setPhase("listening");
    armSilence(e);
  }

  function armSilence(e: Ear) {
    clearTimeout(e.timer);
    e.timer = setTimeout(() => e.r.stop(), SILENCE_MS);
  }

  /** The assistant has finished (or been stopped by the button): take the answer. */
  function hearAnswer() {
    const e = ear.current;
    // Everything the watch heard so far was the assistant itself.
    if (e) toListen(e, e.count);
    else startEar("listen");
  }

  /** Talked over: stop speaking at once and keep what was said. */
  function bargeIn(e: Ear) {
    speech.current = { id: speech.current.id + 1, text: "", on: false };
    window.speechSynthesis.cancel();
    toListen(e, e.from);
  }

  function startEar(mode: Ear["mode"]) {
    const R = recognitionClass();
    if (!R || !active.current || ear.current) return;

    const r = new R();
    r.lang = BCP47[lang.current] ?? "hi-IN";
    r.interimResults = true;
    // Continuous so one session spans the assistant speaking and the answer;
    // the turn ends on the first final result or on SILENCE_MS of quiet.
    r.continuous = true;
    r.maxAlternatives = 1;

    const e: Ear = { r, mode, from: 0, count: 0, final: "", interim: "", startedAt: Date.now() };
    ear.current = e;
    if (mode === "listen") toListen(e, 0);

    r.onresult = (ev) => {
      if (ear.current !== e) return;
      e.count = ev.results.length;

      let final = "";
      let interim = "";
      for (let i = e.from; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) final += res[0].transcript + " ";
        else interim += res[0].transcript;
      }

      if (e.mode === "watch") {
        if (!talkingOver(final + interim, speech.current.text, Boolean(final.trim()))) {
          // The assistant's own voice, finalised: skip past it.
          if (final.trim()) e.from = ev.results.length;
          return;
        }
        bargeIn(e);
      }

      e.final = final.trim();
      e.interim = interim.trim();
      setHeard(e.final || e.interim);
      armSilence(e);
      if (e.final) r.stop();
    };

    r.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setError("माइक की अनुमति चाहिए। ब्राउज़र में माइक 'Allow' करें।");
        finish();
      }
      // "no-speech" and "aborted" are handled in onend.
    };

    r.onend = () => {
      if (ear.current !== e) return;
      clearTimeout(e.timer);
      ear.current = null;
      if (!active.current) return;

      if (e.mode === "watch") {
        // The browser closed the session while the assistant was still talking
        // (a long reply, a network blip): watch again, unless it is failing
        // outright, in which case the button still interrupts.
        if (speech.current.on && Date.now() - e.startedAt > 1000) startEar("watch");
        return;
      }

      const text = (e.final || e.interim).trim();
      if (text) {
        silent.current = 0;
        setHeard("");
        setLines((l) => [...l, { role: "user", text }]);
        void send(text);
        return;
      }

      // Heard nothing: nudge, and after a few tries let the person go.
      if (++silent.current >= MAX_SILENT_TRIES) {
        say("मुझे कुछ सुनाई नहीं दिया। जब आप तैयार हों, दोबारा बात कीजिए।", true);
      } else {
        say("माफ़ कीजिए, मैं सुन नहीं पाई। क्या आप फिर से बोलेंगे?", false);
      }
    };

    try {
      r.start();
    } catch {
      // Already started (double tap); ignore.
    }
  }

  async function start() {
    setError(null);
    setLines([]);
    session.current = null;
    silent.current = 0;
    active.current = true;
    // Voices load lazily in Chrome; asking once warms the list.
    window.speechSynthesis.getVoices();
    await send();
  }

  /** The big button: start; while speaking, interrupt and listen; otherwise end. */
  function press() {
    if (phase === "idle" || phase === "ended") return void start();
    if (phase === "speaking") {
      speech.current = { id: speech.current.id + 1, text: "", on: false };
      window.speechSynthesis.cancel();
      hearAnswer();
      return;
    }
    finish();
  }

  const running = phase !== "idle" && phase !== "ended";
  const tone =
    phase === "listening" ? "bg-[var(--success)]" : phase === "thinking" ? "bg-[var(--ks-accent)]" : "bg-[var(--ks-primary)]";

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <p className="text-center text-xl font-semibold" aria-live="polite">{PHASE_HI[phase]}</p>

      <button
        onClick={press}
        aria-label={running ? "बात खत्म करें" : "बात शुरू करें"}
        className={`relative flex h-44 w-44 cursor-pointer items-center justify-center rounded-full text-6xl text-white shadow-xl transition ${tone}`}
      >
        {phase === "speaking" ? <PiHandPalm aria-hidden /> : running ? <FiSquare aria-hidden /> : <FiMic aria-hidden />}
        {phase === "listening" && <span className="absolute inset-0 animate-ping rounded-full bg-[var(--success)] opacity-20" />}
      </button>

      <p className="text-base text-[var(--text-muted)]">
        {phase === "speaking" ? "दबाकर बीच में बोल सकते हैं" : running ? "बात खत्म करने के लिए दबाइए" : "दबाइए और बोलिए"}
      </p>

      {heard && <p className="rounded-xl bg-[var(--surface-muted)] px-4 py-2 text-lg italic">“{heard}”</p>}

      {error && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-2 text-center text-[var(--danger)]">{error}</p>}

      <div className="w-full space-y-3">
        {lines.slice(-3).map((e, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-lg ${
              e.role === "user" ? "ml-8 bg-[var(--ks-primary)] text-white" : "mr-8 border border-[var(--border)] bg-white"
            }`}
          >
            <p className="flex-1">{e.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
