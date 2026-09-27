/**
 * Voice activity detection and endpointing.
 *
 * On a phone call nobody presses a button to say "I've finished speaking" —
 * the engine has to work it out from the audio. This is that decision, and it
 * sets the felt latency of the whole product: end the turn too eagerly and you
 * cut the caller off mid-sentence, too late and the agent feels sluggish.
 *
 * Deliberately energy-based rather than a model. `node-vad` is an unmaintained
 * native addon and Silero drags in ~50 MB of onnxruntime; at 8 kHz with one
 * speaker on a phone line, RMS against an adaptive noise floor performs well
 * enough and stays comprehensible when it misbehaves — which matters, because
 * tuning this is most of the work of getting a voice agent to feel right.
 */

import { rms } from "./resample";

export type VadParams = {
  /** Frames of speech needed to declare onset. Rejects clicks and line pops. */
  onsetFrames: number;
  /** Frames of silence that end a turn. Derived from `advanced.endpointingMs`. */
  endpointFrames: number;
  /** Noise floor multiplier before a frame counts as speech. */
  thresholdRatio: number;
  /** Absolute floor, so a dead-silent line cannot make the VAD hair-trigger. */
  minThreshold: number;
};

/*
 * Tuned against fluctuating room noise rather than a steady tone.
 *
 * The distinction matters: a constant hiss trains the noise floor and never
 * false-triggers, so steady-noise testing says any threshold is fine. Real air
 * noise gusts — an AC compressor cycling, a fan sweeping, distant traffic —
 * and it is the gusts that cross the bar. Measured over 30 s of gusting noise,
 * the previous values (minThreshold 0.012, ratio 3.0, onset 3) produced 9-15
 * false onsets; these produce none while still catching real speech.
 *
 * Each false onset is not merely cosmetic: it opens a capture and spends an
 * STT request, which is how a quiet room ends up with the agent answering
 * things nobody said.
 */
export const DEFAULT_VAD_PARAMS: VadParams = {
  // 6 frames = 120 ms of sustained energy. A gust rarely holds that; a
  // syllable easily does.
  onsetFrames: 6,
  endpointFrames: 25,
  thresholdRatio: 4.0,
  // Speech into a phone sits ~0.08-0.25 RMS, so an absolute floor of 0.03
  // stays well clear of the quietest speech while rejecting room tone.
  minThreshold: 0.03,
};

export type VadEvent =
  | { type: "onset" }
  | { type: "endpoint" }
  | { type: "none" };

export type VadReading = {
  rms: number;
  threshold: number;
  speech: boolean;
  event: VadEvent["type"];
};

export class Vad {
  private noiseFloor = 0.01;
  private speechRun = 0;
  private silenceRun = 0;
  private inSpeech = false;

  constructor(private params: VadParams = DEFAULT_VAD_PARAMS) {}

  /** Retune mid-call — the harness exposes these as live sliders. */
  setParams(params: Partial<VadParams>): void {
    this.params = { ...this.params, ...params };
  }

  get speaking(): boolean {
    return this.inSpeech;
  }

  get threshold(): number {
    return Math.max(
      this.noiseFloor * this.params.thresholdRatio,
      this.params.minThreshold,
    );
  }

  /**
   * The learned noise floor itself, NOT the speech threshold.
   *
   * BargeInDetector applies its own ratio, so it needs the raw floor — handing
   * it `threshold` would apply a ratio twice and leave barge-in ~3x too deaf.
   */
  get floor(): number {
    return this.noiseFloor;
  }

  /**
   * Feed one 20 ms frame; learn whether the turn just started or ended.
   */
  push(pcm: Int16Array): VadReading {
    const level = rms(pcm);
    const threshold = this.threshold;
    const loud = level > threshold;

    let event: VadEvent["type"] = "none";

    if (loud) {
      this.speechRun++;
      this.silenceRun = 0;

      // Only declare onset once per utterance.
      if (!this.inSpeech && this.speechRun >= this.params.onsetFrames) {
        this.inSpeech = true;
        event = "onset";
      }
    } else {
      this.silenceRun++;
      this.speechRun = 0;

      // Adapt the floor on quiet frames only. Learning during speech would
      // let a long utterance drag the threshold up above the speaker's own
      // voice, and the turn would never end.
      this.noiseFloor = this.noiseFloor * 0.995 + level * 0.005;

      if (this.noiseFloor < 0.001) this.noiseFloor = 0.001;
      else if (this.noiseFloor > 0.05) this.noiseFloor = 0.05;

      if (this.inSpeech && this.silenceRun >= this.params.endpointFrames) {
        this.inSpeech = false;
        event = "endpoint";
      }
    }

    return { rms: level, threshold, speech: this.inSpeech, event };
  }

  /**
   * Forget the current utterance without touching the learned noise floor.
   *
   * Used when a turn is abandoned (barge-in, hangup): the room has not
   * changed, so the floor is still the best estimate we have.
   */
  reset(): void {
    this.speechRun = 0;
    this.silenceRun = 0;
    this.inSpeech = false;
  }
}

/**
 * A separate, deliberately trigger-happy detector for interrupting the agent.
 *
 * Barge-in asks a different question from turn-taking: not "has the caller
 * finished?" but "has the caller started?", and it must answer fast enough
 * that talking over the agent feels natural rather than like a fight. It runs
 * on its own so tuning interruption sensitivity cannot disturb endpointing.
 */
export class BargeInDetector {
  private run = 0;

  /*
   * Tuned against the corrected units. The call site previously passed the
   * VAD's already-scaled threshold instead of the noise floor, which applied
   * the ratio twice and left the effective trigger 2-3x higher than these
   * numbers suggest; the values below are what that accidentally produced,
   * made explicit.
   *
   * Erring deaf is deliberate. A missed barge-in costs the caller one repeat;
   * a false one cuts the agent off mid-sentence for a passing truck, which is
   * the failure people actually notice. 6 frames = 120 ms of sustained energy,
   * which room noise rarely holds but a voice trivially does.
   */
  constructor(
    private readonly frames: number = 6,
    private readonly ratio: number = 8.0,
    private readonly minThreshold: number = 0.045,
    /**
     * Ceiling on the adaptive threshold.
     *
     * Without it a noisy line raises the floor until nothing can clear the bar
     * and the caller becomes unable to interrupt at all — the failure mode is
     * silent, and worse than an occasional false trigger. Speech into a phone
     * sits around 0.08-0.25 RMS, so capping here keeps barge-in reachable
     * however loud the room gets.
     */
    private readonly maxThreshold: number = 0.09,
  ) {}

  /**
   * @param noiseFloor shared with the main VAD, which learns it during silence
   * @param echo how loud the agent's own voice is likely to be in this frame
   *   (EchoGate.expected); the caller must be clearly louder than that. Not
   *   capped by maxThreshold: a loud speaker is not a noisy room, and letting
   *   the agent's voice through is exactly how it interrupts itself.
   * @returns true when the caller is talking over the agent
   */
  push(pcm: Int16Array, noiseFloor: number, echo = 0): boolean {
    const threshold = Math.max(
      Math.min(Math.max(noiseFloor * this.ratio, this.minThreshold), this.maxThreshold),
      echo,
    );

    if (rms(pcm) > threshold) {
      this.run++;
      return this.run >= this.frames;
    }

    this.run = 0;
    return false;
  }

  reset(): void {
    this.run = 0;
  }
}

/**
 * The agent hearing itself.
 *
 * On a speakerphone (a laptop, a phone on the table) the agent's voice comes
 * back into the microphone, and whatever echo cancellation the device has
 * leaves some through — often plenty to pass a loudness test. We know what we
 * played, so we can tell echo from a person: echo is the played audio, delayed
 * (network + the listener's buffers, well under a second) and scaled by how
 * much of it the room lets back in. A caller talking over the agent is louder
 * than that.
 *
 * Two readings per frame: `played` for each frame we send, `heard` for each
 * frame the microphone sends while we are speaking. The coupling (mic level
 * per unit of played level) is learned from what is heard: mostly echo, since
 * a real interruption ends the speech within a fraction of a second.
 */
export class EchoGate {
  /** Loudness of the frames we sent recently, one per 20 ms frame. */
  private readonly recent: Float32Array;
  private index = 0;
  /** Mic level per unit of played level. Starts high: deaf before it has learned, not self-interrupting. */
  private coupling: number;

  constructor(
    /** How far back echo can arrive: network round trip plus the listener's buffers. */
    windowFrames = 50,
    /** A person must be this much louder than the expected echo. */
    private readonly margin = 1.6,
    initialCoupling = 1.0,
    /** Played frames quieter than this cannot produce echo worth gating. */
    private readonly minPlayed = 0.01,
    /** Longest likely echo delay: until then, a quiet microphone proves nothing. */
    private readonly settleFrames = 25,
  ) {
    this.recent = new Float32Array(windowFrames);
    this.coupling = initialCoupling;
  }

  /** A frame we sent to the caller. */
  played(pcm: Int16Array): void {
    this.recent[this.index] = rms(pcm);
    this.index = (this.index + 1) % this.recent.length;
  }

  /** The loudest thing we played within the echo window. */
  private reference(): number {
    let max = 0;
    for (const v of this.recent) if (v > max) max = v;
    return max;
  }

  /** How loud the echo of our own voice could be right now, with the margin applied. */
  expected(): number {
    const ref = this.reference();
    return ref < this.minPlayed ? 0 : ref * this.coupling * this.margin;
  }

  /**
   * A microphone frame heard while we were speaking: learns the coupling.
   *
   * Only lowered once the echo has had time to arrive: the first moments of
   * each stretch of speech are quiet at the microphone because the sound is
   * still on its way, not because the room is quiet — learning from them
   * would drop the guard just before the echo lands.
   */
  heard(pcm: Int16Array): void {
    const ref = this.reference();
    if (ref < this.minPlayed) return;
    this.stretch++;
    const ratio = Math.min(2, rms(pcm) / ref);
    const falling = ratio < this.coupling;
    if (falling && this.stretch < this.settleFrames) return;
    // Rising slowly, so a caller talking over us is not quickly learned as echo.
    this.coupling += (ratio - this.coupling) * (falling ? 0.05 : 0.02);
  }

  /** Frames heard in the current stretch of our speech. */
  private stretch = 0;

  /** Nothing is playing any more (interrupted, or the turn ended). The learned coupling is kept: same room, same call. */
  silence(): void {
    this.stretch = 0;
    this.recent.fill(0);
  }
}
