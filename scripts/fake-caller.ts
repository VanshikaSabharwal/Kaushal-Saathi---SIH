/**
 * A headless caller, for testing the engine without a browser.
 *
 * Connects to the voice server exactly as the harness does, speaks by sending
 * TTS-generated mu-law frames, and reports what it hears back. Because it
 * drives the same protocol, a bug found here is an engine bug rather than an
 * AudioWorklet one — which is the whole reason it exists.
 *
 *   npx tsx scripts/fake-caller.ts "what is the status of S R one two three four"
 *
 * Several turns, separated by "|" — each is spoken once the agent has replied
 * to the previous one, which is how a whole interview is driven:
 *
 *   npm run call -- "हाँ जी | मैं बबीना से हूँ | आठवीं तक पढ़ा हूँ"
 */

import WebSocket from "ws";
import { loadEnv } from "../lib/env";

loadEnv();

import { speak } from "../lib/agent/tts";
import { FRAME_BYTES, silenceFrame } from "../lib/audio/mulaw";
import { DEFAULT_CONFIG } from "../app/lib/types";

const UTTERANCES = (process.argv[2] ?? "हाँ जी")
  .split("|")
  .map((u) => u.trim())
  .filter(Boolean);
const BARGE_IN = process.argv.includes("--barge-in");
const AGENT = process.env.AGENT_ID ?? "kaushal-saathi";
const STT = process.env.STT_PROVIDER ?? "";
const LLM = process.env.LLM_PROVIDER ?? "";
const TTS = process.env.TTS_PROVIDER ?? "";
const URL =
  `${process.env.VOICE_WS ?? "ws://localhost:3001/ws/call"}?agentId=${AGENT}` +
  (STT ? `&stt=${STT}` : "") +
  (LLM ? `&llm=${LLM}` : "") +
  (TTS ? `&tts=${TTS}` : "");

/** Generate mu-law frames for a phrase, using the same TTS the agent uses. */
/**
 * The caller's own voice.
 *
 * Devanagari and other Indic scripts are detected from the text itself and
 * routed to Sarvam, because Cartesia's English models pronounce them as
 * nonsense — which then transcribes as nonsense and makes a perfectly healthy
 * agent look broken. Set CALLER_LANG to override.
 */
function callerLanguage(text: string): string {
  if (process.env.CALLER_LANG) return process.env.CALLER_LANG;

  // Devanagari, Tamil, Telugu, Bengali, Marathi share these blocks.
  return /[ऀ-ॿ஀-௿ఀ-౿ঀ-৿]/.test(text)
    ? "hi"
    : "en";
}

async function synthesize(text: string): Promise<Uint8Array[]> {
  const language = callerLanguage(text);
  const indic = language !== "en";

  const cfg = {
    ...DEFAULT_CONFIG,
    language,
    tts: indic
      ? process.env.BODHAN_TTS_API_KEY || process.env.BODHAN_API_KEY
        ? { ...DEFAULT_CONFIG.tts, provider: "bodhan", model: "indic-speak", voice: "Amit" }
        : { ...DEFAULT_CONFIG.tts, provider: "sarvam", model: "bulbul:v3", voice: "aditya" }
      : { ...DEFAULT_CONFIG.tts, provider: "cartesia", model: "sonic-2", voice: "Marcus" },
  };

  const frames: Uint8Array[] = [];

  for await (const f of speak(cfg, text, AbortSignal.timeout(30000))) {
    frames.push(f);
  }

  return frames;
}

async function main(): Promise<void> {
  const speeches: Uint8Array[][] = [];

  for (const u of UTTERANCES) {
    console.log(`caller: synthesizing "${u}"`);
    speeches.push(await synthesize(u));
  }

  const total = speeches.reduce((n, sp) => n + sp.length, 0);
  console.log(`caller: ${UTTERANCES.length} turn(s), ${(total * 0.02).toFixed(1)}s of speech ready\n`);

  /** Index of the next utterance to speak. */
  let turn = 0;
  /** We have spoken and are waiting for the agent's answer. */
  let awaitingReply = false;

  const ws = new WebSocket(URL);

  let heardFrames = 0;
  let agentState = "";
  let interrupted = false;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let bargeInWhenSpeaking: (() => void) | null = null;

  const finish = (): void => {
    if (ticker) clearInterval(ticker);
    try { ws.close(); } catch { /* already closed */ }
    setTimeout(() => process.exit(0), 300);
  };

  ws.on("open", () => {
    console.log("caller: connected\n");

    // Send a steady stream at real time, exactly as a phone would: silence
    // while listening, speech when it is our turn.
    let queue: Uint8Array[] = [];

    ticker = setInterval(() => {
      const frame = queue.shift() ?? silenceFrame();
      if (ws.readyState === 1) ws.send(frame, { binary: true });
    }, 20);

    const say = (frames: Uint8Array[]): void => {
      queue = [...frames];
    };

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        heardFrames += Math.floor(data.length / FRAME_BYTES);

        // Interrupt once enough of the greeting has genuinely been heard —
        // roughly 20 frames, or 0.4 seconds of speech.
        if (bargeInWhenSpeaking && heardFrames >= 20) {
          const fire = bargeInWhenSpeaking;
          bargeInWhenSpeaking = null;
          fire();
        }

        return;
      }

      const msg = JSON.parse(data.toString());

      if (msg.type === "state") {
        if (msg.value !== agentState) {
          agentState = msg.value;
          console.log(`  [state] ${msg.value}`);
        }

        // Speak whenever the agent hands the turn back and we have not yet
        // had an answer to our last line — the greeting first, then each reply.
        if (msg.value === "listening" && !awaitingReply && turn < UTTERANCES.length) {
          console.log(`  caller speaks: "${UTTERANCES[turn]}"`);
          say(speeches[turn]);
          turn++;
          awaitingReply = true;
        }
      }

      if (msg.type === "mark") {
        ws.send(JSON.stringify({ type: "mark", name: msg.name }));
      }

      if (msg.type === "clear") {
        console.log("  [clear] agent audio flushed (barge-in worked)");
      }

      if (msg.type === "transcript") {
        const tag = msg.role === "user" ? "heard from caller" : "agent says";
        const timing = [
          msg.sttMs ? `stt ${msg.sttMs}ms` : "",
          msg.llmMs ? `llm ${msg.llmMs}ms` : "",
          msg.ttsMs ? `tts ${msg.ttsMs}ms` : "",
        ].filter(Boolean).join(" ");

        console.log(
          `  [${tag}] ${JSON.stringify(msg.text)}` +
          (msg.interrupted ? " (INTERRUPTED)" : "") +
          (msg.toolsUsed?.length ? ` tools=${msg.toolsUsed.join(",")}` : "") +
          (timing ? `  ${timing}` : ""),
        );

        if (msg.role === "assistant" && msg.interrupted) {
          interrupted = true;
          return;
        }

        // Done once the agent has answered what the caller actually said. In
        // barge-in mode that means waiting for the reply *after* the
        // interruption, not the truncated greeting.
        const answered = msg.role === "assistant" && turn > 0;
        if (answered) awaitingReply = false;

        const lastAnswered = answered && turn >= UTTERANCES.length;

        if (lastAnswered && (!BARGE_IN || interrupted)) {
          console.log(`\ncaller: heard ${heardFrames} frames of agent audio total`);
          if (BARGE_IN) {
            console.log(
              interrupted
                ? "caller: barge-in CONFIRMED — greeting was cut short"
                : "caller: barge-in did NOT fire",
            );
          }
          finish();
        }
      }

      if (msg.type === "connected") {
        console.log(`  [connected] ${msg.direction} call to agent "${msg.agent}"`);
      }

      if (msg.type === "error") {
        console.log(`  [error] ${msg.message}`);
      }
    });

    // Barge-in mode: talk over the greeting rather than waiting it out.
    // Triggered off real received audio, because interrupting before the
    // agent has actually said anything is not barge-in — it is just talking.
    if (BARGE_IN) {
      bargeInWhenSpeaking = () => {
        console.log("  caller INTERRUPTS mid-greeting");
        say(speeches[0]);
        turn = 1;
        awaitingReply = true;
      };
    }
  });

  ws.on("error", (err) => {
    console.error("caller: socket error —", err.message);
    process.exit(1);
  });

  // The agent may end the call itself (a goodbye, a hand-off).
  ws.on("close", () => {
    if (ticker) clearInterval(ticker);
    console.log(`\ncaller: call closed by the agent after ${turn} turn(s)`);
    setTimeout(() => process.exit(0), 300);
  });

  // Each turn needs room for STT, a reply and its playback.
  const timeoutMs = 45000 + UTTERANCES.length * 20000;

  // Do not hang forever if something upstream stalls. Report where it stopped
  // — a bare "timed out" leaves you guessing which leg of the pipeline failed.
  setTimeout(() => {
    console.log(`\ncaller: timed out after ${timeoutMs / 1000}s while agent was "${agentState}"`);

    if (agentState === "thinking") {
      console.log(
        "  The LLM did not answer in time. Free-tier Gemini is often the cause;\n" +
        "  try:  LLM_PROVIDER=groq npm run call",
      );
    } else if (agentState === "speaking") {
      console.log("  TTS stalled — the reply never finished generating.");
    } else if (agentState === "capturing") {
      console.log("  The turn never ended. Endpointing may be too long.");
    }

    finish();
  }, timeoutMs);
}

void main();
