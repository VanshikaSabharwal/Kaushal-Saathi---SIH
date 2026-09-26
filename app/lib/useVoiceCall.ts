"use client";

/**
 * A voice call from the browser, as a hook.
 *
 * Speaks the same protocol a phone line will: 8 kHz mu-law in 20 ms frames
 * over the voice server's WebSocket, audio in binary frames, control in text.
 * Shared by the developer harness (/dev/call) and the beneficiary's talk
 * screen (/talk), so the two cannot drift apart.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeMulaw, encodeMulaw, FRAME_BYTES } from "./mulaw-client";

export type CallState = "idle" | "greeting" | "listening" | "capturing" | "thinking" | "speaking" | "ended";

export type CallEntry = {
  role: "user" | "assistant" | "system";
  text: string;
  interrupted?: boolean;
  toolsUsed?: string[];
  sttMs?: number;
  llmMs?: number;
  toolMs?: number;
  ttsMs?: number;
};

export type CallOptions = {
  agentId?: string | null;
  /** A signed ticket (from /api/me/call-token) to call as a known person. */
  ticket?: string;
  echoCancellation?: boolean;
};

const WS_BASE = process.env.NEXT_PUBLIC_VOICE_WS_URL ?? "ws://localhost:3001/ws/call";

export function useVoiceCall() {
  const [state, setState] = useState<CallState>("idle");
  const [entries, setEntries] = useState<CallEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(null);

  // Live VAD readings, for a level meter.
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0.012);
  const [speech, setSpeech] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const hangUp = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    void ctxRef.current?.close();
    ctxRef.current = null;

    setConnected(false);
    setState("ended");
    setSpeech(false);
    setLevel(0);
  }, []);

  useEffect(() => hangUp, [hangUp]);

  const call = useCallback(
    async (opts: CallOptions = {}) => {
      setError(null);
      setEntries([]);
      setState("idle");

      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            // Without this, speakers feed the agent's own voice back into the
            // mic and it interrupts itself constantly.
            echoCancellation: opts.echoCancellation ?? true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        setError("mic");
        return;
      }

      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;

      try {
        await ctx.audioWorklet.addModule("/call-worklet.js");
      } catch {
        setError("worklet");
        hangUp();
        return;
      }

      const params = new URLSearchParams();
      if (opts.agentId) params.set("agentId", opts.agentId);
      if (opts.ticket) params.set("ticket", opts.ticket);

      const ws = new WebSocket(`${WS_BASE}?${params.toString()}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      const capture = new AudioWorkletNode(ctx, "capture-processor");
      const playback = new AudioWorkletNode(ctx, "playback-processor");

      ctx.createMediaStreamSource(stream).connect(capture);
      playback.connect(ctx.destination);

      // Mic -> mu-law -> socket.
      capture.port.onmessage = (event: MessageEvent<Int16Array>) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeMulaw(event.data));
      };

      ws.onopen = () => {
        setConnected(true);
        void ctx.resume();
      };

      ws.onmessage = (event: MessageEvent) => {
        // Binary is audio, text is control. That distinction is the protocol.
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          for (let i = 0; i + FRAME_BYTES <= bytes.length; i += FRAME_BYTES) {
            playback.port.postMessage({ type: "audio", samples: decodeMulaw(bytes.subarray(i, i + FRAME_BYTES)) });
          }
          return;
        }

        const msg = JSON.parse(event.data as string);

        switch (msg.type) {
          case "state":
            setState(msg.value as CallState);
            break;
          case "vad":
            setLevel(msg.rms);
            setThreshold(msg.threshold);
            setSpeech(msg.speech);
            break;
          case "transcript":
            setEntries((prev) => [
              ...prev,
              {
                role: msg.role,
                text: msg.text,
                interrupted: msg.interrupted,
                toolsUsed: msg.toolsUsed,
                sttMs: msg.sttMs,
                llmMs: msg.llmMs,
                toolMs: msg.toolMs,
                ttsMs: msg.ttsMs,
              },
            ]);
            break;
          case "clear":
            // Barge-in: drop audio not yet heard, instantly.
            playback.port.postMessage({ type: "clear" });
            break;
          case "mark":
            // Echo back once playback reaches it, the way Twilio does.
            ws.send(JSON.stringify({ type: "mark", name: msg.name }));
            break;
          case "connected":
            if (msg.beneficiaryId) setBeneficiaryId(msg.beneficiaryId);
            setEntries((prev) => [
              ...prev,
              {
                role: "system",
                text: `${msg.direction === "outbound" ? "Outbound" : "Inbound"} call connected to "${msg.agent}".`,
              },
            ]);
            break;
          case "hangup":
            hangUp();
            break;
          case "error":
            setError(msg.message);
            break;
        }
      };

      ws.onerror = () => setError("unreachable");

      ws.onclose = () => {
        setConnected(false);
        setState("ended");
      };
    },
    [hangUp],
  );

  /** Push a knob change to the live session. */
  const patch = useCallback((body: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "params", ...body }));
  }, []);

  return { state, entries, error, connected, beneficiaryId, level, threshold, speech, call, hangUp, patch, wsBase: WS_BASE };
}
