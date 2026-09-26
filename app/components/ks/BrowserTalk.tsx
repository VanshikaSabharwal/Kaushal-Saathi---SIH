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
  speaking: "बोल रही हूँ… (बीच में बोलना हो तो बटन दबाइए)",
  listening: "बोलिए, मैं सुन रही हूँ…",
  thinking: "सोच रही हूँ…",
  ended: "बात पूरी हुई",
};

const BCP47: Record<string, string> = { hi: "hi-IN", mr: "mr-IN" };
const MAX_SILENT_TRIES = 3;

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
  const lang = useRef("hi");
  const recog = useRef<Recognition | null>(null);
  const silent = useRef(0);
  const active = useRef(false);

  const stopAll = useCallback(() => {
    window.speechSynthesis?.cancel();
    recog.current?.abort();
    recog.current = null;
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
            if (!active.current) return;
            if (end) finish();
            else listen();
          };
        }
        window.speechSynthesis.speak(u);
      });
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
    [getTicket, say, finish],
  );

  function listen() {
    const R = recognitionClass();
    if (!R || !active.current) return;

    const r = new R();
    r.lang = BCP47[lang.current] ?? "hi-IN";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    recog.current = r;

    let final = "";
    setHeard("");
    setPhase("listening");

    r.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      setHeard(final || interim);
    };

    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("माइक की अनुमति चाहिए। ब्राउज़र में माइक 'Allow' करें।");
        finish();
      }
      // "no-speech" and "aborted" are handled in onend.
    };

    r.onend = () => {
      recog.current = null;
      if (!active.current) return;

      const text = final.trim();
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
      window.speechSynthesis.cancel();
      listen();
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
