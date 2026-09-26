/**
 * Synthesize the lines every call says, before any call needs them.
 *
 * The greeting and the "sorry, I did not catch that" fallback are identical on
 * every call for a given config, yet each is generated from scratch while the
 * caller waits. Producing them at startup moves that cost off the call
 * entirely: the first caller hears the greeting as fast as the hundredth.
 *
 * Warming is always best-effort. A provider that is down, rate limited, or
 * missing a key must not stop the server starting or a call connecting — the
 * only consequence of a failure here is that the line is synthesized on demand,
 * exactly as it was before.
 */

import { speak } from "./tts";
import { cacheKey, has } from "./tts-cache";
import { defaultGreetingFor } from "../call/session";
import type { AgentConfig } from "../../app/lib/types";
import { staticLines } from "../livelihood/interview";
import { activeCount } from "../call/registry";

/** Cap on a warm-up request, kept short so startup is not held up. */
const WARM_TIMEOUT_MS = 20000;

/** Drain a TTS stream purely for its side effect of filling the cache. */
async function synthesize(cfg: AgentConfig, text: string): Promise<void> {
  const signal = AbortSignal.timeout(WARM_TIMEOUT_MS);

  // The stream must be consumed to completion: the cache only commits a fully
  // generated utterance, so stopping early would warm nothing.
  for await (const _frame of speak(cfg, text, signal)) {
    void _frame;
  }
}

/**
 * The lines worth warming for one config.
 *
 * Both greeting directions are included because a config can be used for
 * either, and the inbound and outbound wordings differ.
 */
function linesFor(cfg: AgentConfig): string[] {
  // The livelihood interview speaks its own greeting, never the engine's.
  const lines =
    cfg.mode === "livelihood"
      ? []
      : [defaultGreetingFor(cfg, "inbound"), defaultGreetingFor(cfg, "outbound")];

  const fallback = cfg.advanced?.fallbackMessage?.trim();
  if (fallback) lines.push(fallback);

  // The interview's fixed lines — greeting, every question, the simple
  // choices, help-desk and follow-up lines. Replies are spoken as a live
  // acknowledgement plus one of these, so with them cached a reply starts in
  // well under a second instead of waiting on the provider. The cache is on
  // disk, so this is paid once, not per restart. WARM_ALL_LINES=0 limits it
  // to the greeting.
  if (cfg.mode === "livelihood") {
    const fixed = staticLines(cfg.language === "mr" ? "mr" : "hi");
    lines.push(...(process.env.WARM_ALL_LINES === "0" ? fixed.slice(0, 1) : fixed));
  }

  return lines;
}

export type WarmResult = { warmed: number; skipped: number; failed: number };

/**
 * Warm one config's stock lines.
 *
 * Sequential rather than parallel: several providers rate limit aggressively
 * (Bodhan allows 4-8 requests a minute), and warming is not urgent enough to
 * risk tripping that and poisoning the first real call.
 */
export async function warmConfig(cfg: AgentConfig): Promise<WarmResult> {
  const result: WarmResult = { warmed: 0, skipped: 0, failed: 0 };

  // Rate-limited providers (Bodhan allows a handful of requests a minute) are
  // warmed slowly, and never while a call is using the same quota.
  const pace = Number(process.env.WARM_PACE_MS ?? (cfg.tts.provider === "bodhan" ? 15000 : 0));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const line of linesFor(cfg)) {
    if (has(cacheKey(cfg, line))) {
      result.skipped++;
      continue;
    }

    while (activeCount() > 0) await sleep(5000);

    try {
      await synthesize(cfg, line);
      result.warmed++;
    } catch {
      result.failed++;
    }

    if (pace) await sleep(pace);
  }

  return result;
}

/**
 * Warm one specific greeting, for a call that is about to start.
 *
 * Covers the case startup warming cannot: a config saved since the server
 * booted, or an outbound call carrying its own greeting text. Returns quickly
 * when the line is already cached, which is the common path.
 */
export async function warmGreeting(
  cfg: AgentConfig,
  direction: "inbound" | "outbound",
  greeting?: string,
): Promise<boolean> {
  const text = greeting?.trim() || defaultGreetingFor(cfg, direction);

  if (has(cacheKey(cfg, text))) return true;

  try {
    await synthesize(cfg, text);
    return true;
  } catch {
    return false;
  }
}

/** Warm several configs, tolerating failures in any of them. */
export async function warmAll(configs: AgentConfig[]): Promise<WarmResult> {
  const total: WarmResult = { warmed: 0, skipped: 0, failed: 0 };

  for (const cfg of configs) {
    const r = await warmConfig(cfg);
    total.warmed += r.warmed;
    total.skipped += r.skipped;
    total.failed += r.failed;
  }

  return total;
}
