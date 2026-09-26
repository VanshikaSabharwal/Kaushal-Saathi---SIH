/**
 * Carries a call over a Twilio Media Stream — a real phone line, so feature
 * phone users can reach the assistant by dialling a number.
 *
 * A protocol translation of the browser transport, as TELEPHONY.md planned:
 * the same 8 kHz mu-law, carried in JSON envelopes with base64 payloads.
 *
 *   in:  start (streamSid, callSid, customParameters) · media · mark · dtmf · stop
 *   out: media · clear (barge-in) · mark (tell me when this has played)
 *
 * Nothing is ready until `start` arrives: the streamSid it carries has to be
 * on every outgoing message, and the custom parameters say who is calling.
 */

import type { WebSocket } from "ws";
import { FRAME_BYTES } from "../audio/mulaw";
import type { MediaTransport, TransportKind } from "./transport";

export type TwilioStart = {
  streamSid: string;
  callSid: string;
  customParameters: Record<string, string>;
};

export class TwilioTransport implements MediaTransport {
  readonly kind: TransportKind = "twilio";

  private audioCb: ((frame: Uint8Array) => void) | null = null;
  private closeCb: (() => void) | null = null;
  private markCb: ((name: string) => void) | null = null;
  private dtmfCb: ((digit: string) => void) | null = null;
  private streamSid = "";
  private closed = false;
  /** Carrier chunks are not guaranteed to be whole frames; re-frame them. */
  private pending = new Uint8Array(0);

  /** Resolves with the stream's details once Twilio's `start` arrives. */
  readonly started: Promise<TwilioStart>;

  constructor(
    readonly id: string,
    private readonly ws: WebSocket,
  ) {
    let resolveStart: (s: TwilioStart) => void = () => {};
    this.started = new Promise((r) => (resolveStart = r));

    ws.on("message", (data: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      switch (msg.event) {
        case "start": {
          const start = msg.start as { streamSid: string; callSid: string; customParameters?: Record<string, string> };
          this.streamSid = start.streamSid;
          resolveStart({ streamSid: start.streamSid, callSid: start.callSid, customParameters: start.customParameters ?? {} });
          break;
        }
        case "media": {
          const media = msg.media as { track?: string; payload: string };
          // Only the caller's own voice; never our audio echoed back.
          if (media.track && media.track !== "inbound") return;
          this.receive(Buffer.from(media.payload, "base64"));
          break;
        }
        case "mark": {
          const name = (msg.mark as { name?: string })?.name;
          if (name) this.markCb?.(name);
          break;
        }
        case "dtmf": {
          const digit = (msg.dtmf as { digit?: string })?.digit;
          if (digit) this.dtmfCb?.(digit);
          break;
        }
        case "stop":
          this.handleClose();
          break;
      }
    });

    ws.on("close", () => this.handleClose());
    ws.on("error", () => this.handleClose());
  }

  private receive(bytes: Uint8Array): void {
    const all = new Uint8Array(this.pending.length + bytes.length);
    all.set(this.pending);
    all.set(bytes, this.pending.length);

    let i = 0;
    for (; i + FRAME_BYTES <= all.length; i += FRAME_BYTES) {
      this.audioCb?.(all.slice(i, i + FRAME_BYTES));
    }
    this.pending = all.slice(i);
  }

  private send(message: Record<string, unknown>): void {
    if (this.closed || !this.streamSid || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ ...message, streamSid: this.streamSid }));
  }

  onAudio(cb: (frame: Uint8Array) => void): void {
    this.audioCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  onMark(cb: (name: string) => void): void {
    this.markCb = cb;
  }

  onDtmf(cb: (digit: string) => void): void {
    this.dtmfCb = cb;
  }

  sendAudio(frame: Uint8Array): void {
    this.send({ event: "media", media: { payload: Buffer.from(frame).toString("base64") } });
  }

  clearBuffer(): void {
    this.send({ event: "clear" });
  }

  mark(name: string): void {
    this.send({ event: "mark", mark: { name } });
  }

  /** A carrier has no side channel for transcripts; state stays server-side. */
  sendControl(): void {}

  hangup(): void {
    if (this.closed) return;
    this.closed = true;

    // Closing the stream ends <Connect>; with no TwiML after it, the call ends.
    try {
      this.ws.close();
    } catch {
      // Already gone.
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCb?.();
  }
}
