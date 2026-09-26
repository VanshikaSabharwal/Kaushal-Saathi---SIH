"use client";

/**
 * Which voice engine a talk screen uses.
 *
 *  - browser (default): the browser's own speech recognition and voices —
 *    free, no provider keys; the web and kiosk demo path.
 *  - server: the telephony engine (Sarvam / Bhashini STT and TTS over the
 *    voice server) — what a phone call uses. Set NEXT_PUBLIC_VOICE_ENGINE=server.
 *
 * If the server engine's speech provider fails (no credits, rate limit), the
 * person is offered the browser voice instead of an error.
 */

import { useState, useSyncExternalStore } from "react";
import BrowserTalk, { browserVoiceSupported } from "./BrowserTalk";
import TalkPanel from "./TalkPanel";

const noop = () => () => {};

export default function VoiceTalk(props: {
  getTicket?: () => Promise<string | undefined>;
  onEnded?: () => void;
}) {
  const supported = useSyncExternalStore(noop, browserVoiceSupported, () => false);
  const [engine, setEngine] = useState<"browser" | "server" | null>(null);

  const preferServer = process.env.NEXT_PUBLIC_VOICE_ENGINE === "server";
  const chosen = engine ?? (preferServer || !supported ? "server" : "browser");

  if (chosen === "browser") return <BrowserTalk {...props} />;

  return <TalkPanel {...props} onUseBrowser={supported ? () => setEngine("browser") : undefined} />;
}
