"use client";

/**
 * Which voice engine a talk screen uses.
 *
 *  - browser (default): the browser's own speech recognition and voices —
 *    free, no provider keys, and only a few KB per turn (text to /api/chat,
 *    speech made on the device). The right engine for 2G/3G.
 *  - server: the telephony engine (Sarvam / Bodhan STT and TTS over the voice
 *    server) — what a phone call uses. Set NEXT_PUBLIC_VOICE_ENGINE=server.
 *    It streams ~64 kbps each way for the whole call, so it is only chosen on
 *    a fast connection; on a slow one the browser engine is used instead.
 *
 * If the server engine's speech provider fails (no credits, rate limit), the
 * person is offered the browser voice instead of an error.
 */

import { useState, useSyncExternalStore } from "react";
import BrowserTalk, { browserVoiceSupported } from "./BrowserTalk";
import TalkPanel from "./TalkPanel";

const noop = () => () => {};

type Connection = { effectiveType?: string; saveData?: boolean };

/**
 * Too slow (or too costly) for streaming call audio. Read once when the screen
 * opens: switching engines mid-call would drop the call.
 */
function slowNetwork(): boolean {
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  if (!c) return false; // Firefox/Safari do not say; assume it is fine.
  return Boolean(c.saveData) || ["slow-2g", "2g", "3g"].includes(c.effectiveType ?? "");
}

export default function VoiceTalk(props: {
  getTicket?: () => Promise<string | undefined>;
  onEnded?: () => void;
}) {
  const supported = useSyncExternalStore(noop, browserVoiceSupported, () => false);
  const slow = useSyncExternalStore(noop, slowNetwork, () => false);
  const [engine, setEngine] = useState<"browser" | "server" | null>(null);

  const preferServer = process.env.NEXT_PUBLIC_VOICE_ENGINE === "server" && !slow;
  const chosen = engine ?? (preferServer || !supported ? "server" : "browser");

  if (chosen === "browser") return <BrowserTalk {...props} />;

  return <TalkPanel {...props} onUseBrowser={supported ? () => setEngine("browser") : undefined} />;
}
