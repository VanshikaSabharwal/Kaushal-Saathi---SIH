"use client";

/**
 * The talk screen: one very large button, a plain word for what the assistant
 * is doing, and big captions of the last few lines — everything a person
 * needs, nothing they have to read to use it.
 */

import { useEffect, useRef } from "react";
import { FiMic, FiSquare } from "react-icons/fi";
import { useVoiceCall, type CallState } from "../../lib/useVoiceCall";
import { useTranslation } from "./Translate";

const STATE_HI: Record<CallState, { text: string; tone: string }> = {
  idle: { text: "बात शुरू करने के लिए बटन दबाइए", tone: "bg-[var(--ks-primary)]" },
  greeting: { text: "नमस्ते…", tone: "bg-[var(--ks-primary)]" },
  listening: { text: "बोलिए, मैं सुन रही हूँ…", tone: "bg-[var(--success)]" },
  capturing: { text: "सुन रही हूँ…", tone: "bg-[var(--success)]" },
  thinking: { text: "सोच रही हूँ…", tone: "bg-[var(--ks-accent)]" },
  speaking: { text: "बोल रही हूँ… (बीच में भी बोल सकते हैं)", tone: "bg-[var(--ks-primary)]" },
  ended: { text: "बात पूरी हुई", tone: "bg-[var(--text-muted)]" },
};

const ERRORS: Record<string, string> = {
  mic: "माइक की अनुमति चाहिए। ब्राउज़र में माइक 'Allow' करें।",
  worklet: "आवाज़ शुरू नहीं हो पाई। पेज फिर से खोलें।",
  unreachable: "सर्वर से जुड़ नहीं पाए। थोड़ी देर में फिर कोशिश करें।",
};

/** Speech provider failures (credits, rate limits) — not the person's fault, and not for them to read. */
function providerDown(error: string): boolean {
  return /\b(402|429|5\d\d)\b|credits|quota|rate limit|Sarvam|Bodhan|ElevenLabs|Cartesia/i.test(error);
}

export default function TalkPanel({
  getTicket,
  agentId,
  onEnded,
  onUseBrowser,
}: {
  /** Returns a signed call ticket to talk as a known person, or undefined for anonymous. */
  getTicket?: () => Promise<string | undefined>;
  agentId?: string;
  onEnded?: () => void;
  /** Offered when the speech provider is down: switch to the browser's voice. */
  onUseBrowser?: () => void;
}) {
  const voice = useVoiceCall();
  const pageLang = useTranslation()?.lang.code;
  const { state, entries, connected, level, speech } = voice;
  const wasConnected = useRef(false);

  useEffect(() => {
    if (connected) wasConnected.current = true;
    if (!connected && wasConnected.current && state === "ended") {
      wasConnected.current = false;
      onEnded?.();
    }
  }, [connected, state, onEnded]);

  async function start() {
    const ticket = getTicket ? await getTicket() : undefined;
    await voice.call({ agentId, ticket, lang: pageLang });
  }

  const s = STATE_HI[connected ? state : state === "ended" ? "ended" : "idle"];
  const lines = entries.filter((e) => e.role !== "system").slice(-3);
  const pulse = Math.min(1.35, 1 + Math.sqrt(level) * 3);

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <p className="text-center text-xl font-semibold" aria-live="polite">{s.text}</p>

      <button
        onClick={connected ? voice.hangUp : start}
        aria-label={connected ? "बात खत्म करें" : "बात शुरू करें"}
        className={`relative flex h-44 w-44 cursor-pointer items-center justify-center rounded-full text-6xl text-white shadow-xl transition ${connected ? s.tone : "bg-[var(--ks-primary)]"}`}
        style={{ transform: connected && speech ? `scale(${pulse})` : undefined }}
      >
        {connected ? <FiSquare aria-hidden /> : <FiMic aria-hidden />}
        {connected && (state === "listening" || state === "capturing") && (
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--success)] opacity-20" />
        )}
      </button>

      <p className="text-base text-[var(--text-muted)]">{connected ? "बात खत्म करने के लिए दबाइए" : "दबाइए और बोलिए"}</p>

      {voice.error && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-center text-[var(--danger)]">
          <p>
            {ERRORS[voice.error] ??
              (providerDown(voice.error) ? "आवाज़ सेवा अभी उपलब्ध नहीं है।" : "कुछ गड़बड़ हुई। थोड़ी देर में फिर कोशिश करें।")}
          </p>
          {onUseBrowser && (
            <button onClick={onUseBrowser} className="cursor-pointer rounded-lg bg-[var(--ks-primary)] px-4 py-2 text-white">
              मुफ़्त ब्राउज़र आवाज़ से बात करें
            </button>
          )}
        </div>
      )}

      <div className="w-full space-y-3">
        {lines.map((e, i) => (
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
