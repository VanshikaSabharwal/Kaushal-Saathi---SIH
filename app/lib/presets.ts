/**
 * Built-in configurations. These ship in code and are read-only.
 *
 * Every preset must validate clean — "Hindi Support" in particular doubles as a
 * fixture proving the Indic path works end to end (Hindi-capable STT model,
 * multilingual TTS model, and a voice that actually speaks Hindi).
 */

import { DEFAULT_CONFIG, type AgentConfig } from "./types";

export type SavedConfig = {
  id: string;
  name: string;
  config: AgentConfig;
  /** Built-ins cannot be edited or deleted. */
  builtin: boolean;
  updatedAt: number;
};

/**
 * Tuned for phone calls, where latency is the feature.
 *
 * Measured, same prompt with tool schemas attached:
 *   Groq openai/gpt-oss-20b   ~0.6s
 *   Gemini gemini-3.6-flash  ~18.7s
 *
 * A voice agent needs at least two LLM round-trips for a tool call (request,
 * then answer), so Gemini's latency is not a slow call — it is a dead line.
 * Cartesia is likewise the faster TTS to first byte (~200ms vs ~800ms), which
 * is what the caller actually perceives.
 */
const customerSupport: AgentConfig = {
  ...DEFAULT_CONFIG,
  name: "Customer Support",
  llm: { ...DEFAULT_CONFIG.llm, provider: "groq", model: "openai/gpt-oss-20b" },
  tts: { ...DEFAULT_CONFIG.tts, provider: "cartesia", model: "sonic-2", voice: "Sophie" },
};

const hindiSupport: AgentConfig = {
  ...DEFAULT_CONFIG,
  name: "Hindi Support",
  language: "hi",
  systemPrompt:
    "आप हमारी कंपनी के लिए एक सहायक सेवा एजेंट हैं। ग्राहकों की सेवा अनुरोधों में मदद करें, स्थिति बताएं और सवालों के जवाब दें। हमेशा विनम्र और स्पष्ट रहें।",
  // saaras:v3 covers the Indic set; wav is within its accepted formats.
  stt: { provider: "sarvam", model: "saaras:v3", language: "hi" },
  // Groq for the same latency reason as Customer Support — Gemini's ~18s with
  // tools attached is unusable on a call regardless of language.
  llm: { ...DEFAULT_CONFIG.llm, provider: "groq", model: "openai/gpt-oss-20b" },
  // bulbul:v3 speaks Hindi and "priya" is a Hindi-capable speaker.
  tts: {
    provider: "sarvam",
    model: "bulbul:v3",
    voice: "priya",
    stability: 0.5,
    similarityBoost: 0.75,
  },
  general: { ...DEFAULT_CONFIG.general, recordingFormat: "wav" },
};

/**
 * The PM-AJAY livelihood interview.
 *
 * `mode: "livelihood"` hands the conversation to the interview state machine,
 * so the LLM settings here are unused on normal turns — answers the phrase
 * table cannot place go to a small Groq model instead (lib/livelihood/
 * llm-extract.ts).
 *
 * Speech is Bodhan (AI4Bharat, IIT Madras): indic-transcribe to listen and
 * indic-speak to talk, both covering 22 Indian languages. The voices are
 * female — Kavya (Hindi), Anagha (Marathi) — which is why every scripted line
 * uses feminine verb forms. Verified live: round trip Hindi TTS -> STT.
 */
const kaushalSaathi: AgentConfig = {
  ...hindiSupport,
  name: "Kaushal Saathi",
  mode: "livelihood",
  stt: { provider: "bodhan", model: "indic-transcribe", language: "hi" },
  tts: {
    ...hindiSupport.tts,
    provider: "bodhan",
    model: "indic-speak",
    voice: "Kavya",
    voiceByLanguage: { hi: "Kavya", mr: "Anagha" },
  },
  systemPrompt:
    "You are Kaushal Saathi, a respectful livelihood counsellor for PM-AJAY beneficiaries. Speak simple Hindi.",
  // Tools belong to the LLM agent; the interview calls its own code directly.
  tools: DEFAULT_CONFIG.tools.map((t) => ({ ...t, enabled: false })),
  advanced: {
    ...DEFAULT_CONFIG.advanced,
    fallbackMessage: "माफ़ कीजिए, मैं सुन नहीं पाई। क्या आप फिर से बोलेंगे?",
    // Rural callers, speakerphones, shared rooms: only a sustained voice
    // should stop the assistant, not a cough or a passing vehicle.
    bargeInMs: 400,
  },
};

/**
 * The same interview for Marathi-first districts (Nashik). Callers can still
 * switch to Hindi mid-call, and vice versa on the Hindi preset.
 */
const kaushalSaathiMarathi: AgentConfig = {
  ...kaushalSaathi,
  name: "Kaushal Saathi (Marathi)",
  language: "mr",
  stt: { ...kaushalSaathi.stt, language: "mr" },
  tts: { ...kaushalSaathi.tts, voice: "Anagha" },
  advanced: {
    ...kaushalSaathi.advanced,
    fallbackMessage: "माफ करा, मला ऐकू आलं नाही. पुन्हा सांगाल का?",
  },
};

// const lowLatency: AgentConfig = {
//   ...DEFAULT_CONFIG,
//   name: "Low Latency Test",
//   llm: {
//     ...DEFAULT_CONFIG.llm,
//     model: "gpt-4o-mini",
//     maxTokens: 300,
//     temperature: 0.2,
//   },
//   tts: {
//     ...DEFAULT_CONFIG.tts,
//     model: "eleven_flash_v2_5",
//   },
//   general: { ...DEFAULT_CONFIG.general, silenceTimeout: 1.0 },
//   advanced: { ...DEFAULT_CONFIG.advanced, endpointingMs: 300 },
// };

// const devTest: AgentConfig = {
//   ...DEFAULT_CONFIG,
//   name: "Dev Test Config",
//   llm: { ...DEFAULT_CONFIG.llm, model: "gpt-4o-mini", temperature: 0 },
//   tools: DEFAULT_CONFIG.tools.map((t) => ({ ...t, enabled: false })),
// };

export const PRESETS: SavedConfig[] = [
  {
    id: "kaushal-saathi",
    name: "Kaushal Saathi",
    config: kaushalSaathi,
    builtin: true,
    updatedAt: 0,
  },
  {
    id: "kaushal-saathi-mr",
    name: "Kaushal Saathi (Marathi)",
    config: kaushalSaathiMarathi,
    builtin: true,
    updatedAt: 0,
  },
  {
    id: "customer-support",
    name: "Customer Support",
    config: customerSupport,
    builtin: true,
    updatedAt: 0,
  },
  {
    id: "hindi-support",
    name: "Hindi Support",
    config: hindiSupport,
    builtin: true,
    updatedAt: 0,
  },
  // {
  //   id: "low-latency",
  //   name: "Low Latency Test",
  //   config: lowLatency,
  //   builtin: true,
  //   updatedAt: 0,
  // },
  // {
  //   id: "dev-test",
  //   name: "Dev Test Config",
  //   config: devTest,
  //   builtin: true,
  //   updatedAt: 0,
  // },
];

export function findPreset(id: string): SavedConfig | undefined {
  return PRESETS.find((p) => p.id === id);
}
