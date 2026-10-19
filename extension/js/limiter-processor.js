/**
 * @file AudioWorkletProcessor implementing a real lookahead brickwall limiter,
 * running entirely on the audio rendering thread (no main-thread jank, no
 * setInterval polling). The node sits directly in the audio graph — it reads
 * the input, delays it by a few milliseconds, and writes the gain-adjusted
 * result to the output — instead of just reporting numbers for a separate
 * GainNode to apply later.
 *
 * Why lookahead: a limiter that reacts only *after* seeing a loud sample
 * always lets that sample through at full volume before the gain catches up
 * (that's the "gets loud, then quickly backs off" feeling). By buffering a
 * few milliseconds of audio and computing the required gain from the
 * upcoming (already-buffered-but-not-yet-emitted) block, the gain reduction
 * is fully ramped in *before* the loud part ever reaches the output.
 * @module LimiterProcessor
 */

/** Release speed (dB/s) per strength — mirrors presets.js (worklet scope can't load it). */
const LIMITER_PRESETS = Object.freeze({
  soft: { releaseDbPerSec: 15 },
  normal: { releaseDbPerSec: 8 },
  strong: { releaseDbPerSec: 4 }
});

/** Render quanta (blocks) of lookahead delay. ~10.7ms @48kHz — enough to fully duck before a transient hits. */
const LOOKAHEAD_BLOCKS = 4;

/**
 * Resolves the effective limiter parameters, falling back to the named
 * preset when explicit values aren't provided.
 * @param {Object} config
 * @param {number} sampleRateHz
 * @param {number} [blockSize=128]
 * @returns {{ceilingLin:number, releaseDbPerBlock:number}}
 */
function resolveLimiterParams(config, sampleRateHz, blockSize = 128) {
  const preset = LIMITER_PRESETS[config.limiterStrength] ?? LIMITER_PRESETS.normal;
  const limitDB = Number.isFinite(config.limitDB) ? config.limitDB : -20;
  // `limiterRelease` is expressed in dB/sec (how fast gain recovers after ducking).
  const releaseDbPerSec = Number.isFinite(config.limiterRelease) ? config.limiterRelease : preset.releaseDbPerSec;
  return {
    ceilingLin: Math.pow(10, limitDB / 20),
    releaseDbPerBlock: releaseDbPerSec * (blockSize / sampleRateHz)
  };
}

/**
 * True lookahead brickwall limiter, operating on fixed-size blocks
 * (AudioWorklet render quanta). Pure/side-effect-free besides its own
 * internal buffers, so it's directly unit-testable in plain Node.
 */
class LookaheadLimiter {
  /** @param {number} [lookaheadBlocks] */
  constructor(lookaheadBlocks = LOOKAHEAD_BLOCKS) {
    this.lookaheadBlocks = lookaheadBlocks;
    /** Recycled slots — the audio thread must not allocate per block (GC pauses = clicks). */
    this.pool = [];
    this.reset();
  }

  reset() {
    /** @type {Array<{block: Float32Array[], targetGain: number}>} */
    this.pending = [];
    this.emitted = null;
    this.activeGain = 1;
    this.lastAppliedGain = 1;
    this.hasEmitted = false;
    this.lastDb = -Infinity;
  }

  #takeSlot(channels, frames) {
    const slot = this.pool.pop();
    if (slot && slot.block.length === channels && slot.block[0].length === frames) return slot;
    return { block: Array.from({ length: channels }, () => new Float32Array(frames)), targetGain: 1 };
  }

  /**
   * @param {Float32Array[]} block - one render quantum, one Float32Array per channel (same length)
   * @param {{ceilingLin:number, releaseDbPerBlock:number}} params
   * @returns {Float32Array[]|null} the delayed, gain-adjusted block to emit — valid only until the
   *   next call (its buffers are recycled) — or null while the lookahead buffer is still filling
   *   (caller should emit silence)
   */
  process(block, { ceilingLin, releaseDbPerBlock }) {
    let peak = 0;
    for (const channel of block) {
      for (let i = 0; i < channel.length; i++) {
        const abs = Math.abs(channel[i]);
        if (abs > peak) peak = abs;
      }
    }
    this.lastDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

    if (this.emitted) {
      this.pool.push(this.emitted);
      this.emitted = null;
    }
    // Copy the block before buffering: the audio thread reuses input buffers
    // between process() calls, so holding the reference would read NEW audio
    // instead of the retained samples when the block is finally emitted.
    const slot = this.#takeSlot(block.length, block[0].length);
    for (let ch = 0; ch < block.length; ch++) slot.block[ch].set(block[ch]);
    slot.targetGain = peak > 0 ? Math.min(1, ceilingLin / peak) : 1;
    this.pending.push(slot);

    // The gain applied to whichever block we emit must already account for
    // every louder block still waiting in the lookahead window — that's what
    // lets the reduction ramp in *before* the loud block is actually output.
    let requiredGain = 1;
    for (const item of this.pending) if (item.targetGain < requiredGain) requiredGain = item.targetGain;

    const currentDB = 20 * Math.log10(this.activeGain);
    const requiredDB = 20 * Math.log10(requiredGain);
    this.activeGain = requiredDB < currentDB
      ? requiredGain // ATTACK: never overshoot — drop instantly to the safe level.
      : Math.pow(10, Math.min(requiredDB, currentDB + releaseDbPerBlock) / 20); // RELEASE: ramp up slowly.

    if (this.pending.length <= this.lookaheadBlocks) return null; // still filling the lookahead buffer at startup

    const out = this.pending.shift();
    // Avoid a unity-gain leak on the first emitted block after startup/reset.
    const startGain = this.hasEmitted ? this.lastAppliedGain : this.activeGain;
    const endGain = this.activeGain;
    this.lastAppliedGain = endGain;
    this.hasEmitted = true;

    const frames = out.block[0].length;
    for (const channel of out.block) {
      for (let i = 0; i < frames; i++) {
        // Linear ramp across the block: click-free, and by now (thanks to the
        // lookahead) startGain and endGain are usually already very close.
        channel[i] *= startGain + (endGain - startGain) * (i / frames);
      }
    }
    this.emitted = out;
    return out.block;
  }
}

// Exported for the plain-Node unit test. Harmless in the AudioWorkletGlobalScope.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LIMITER_PRESETS, LOOKAHEAD_BLOCKS, resolveLimiterParams, LookaheadLimiter };
}
if (typeof globalThis !== 'undefined') {
  globalThis.DLLimiterProcessor = { LIMITER_PRESETS, LOOKAHEAD_BLOCKS, resolveLimiterParams, LookaheadLimiter };
}

// `AudioWorkletProcessor`/`registerProcessor`/`sampleRate` only exist inside an
// AudioWorkletGlobalScope — guard so this file can also be `require()`d by tests.
if (typeof AudioWorkletProcessor !== 'undefined') {
  class LimiterProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.config = { enabled: false };
      this.params = resolveLimiterParams(this.config, sampleRate);
      this.limiter = new LookaheadLimiter();
      this.blockCounter = 0;
      // Report metering/gain back to the main thread roughly every 25ms (~40Hz),
      // fast enough for a smooth level meter in the popup.
      this.reportEveryNBlocks = Math.max(1, Math.round((sampleRate / 128) * 0.025));

      this.port.onmessage = event => {
        if (event.data?.type === 'config') {
          const wasEnabled = this.config.enabled;
          this.config = { ...this.config, ...event.data.config };
          this.params = resolveLimiterParams(this.config, sampleRate);
          // Dropping any buffered lookahead audio on enable/disable avoids a
          // stale chunk suddenly flushing out with the wrong gain applied.
          if (wasEnabled !== this.config.enabled) this.limiter.reset();
        }
      };
    }

    process(inputs, outputs) {
      const input = inputs[0];
      const output = outputs[0];
      if (!input || !input.length || !output || !output.length) return true;

      const outBlock = this.config.enabled ? this.limiter.process(input, this.params) : null;

      for (let ch = 0; ch < output.length; ch++) {
        if (outBlock) {
          output[ch].set(outBlock[ch] ?? outBlock[0]);
        } else if (!this.config.enabled) {
          // Bypass: passthrough at unity gain while disabled.
          output[ch].set(input[ch] ?? input[0]);
        } else {
          output[ch].fill(0); // still filling the lookahead buffer at startup
        }
      }

      if (++this.blockCounter >= this.reportEveryNBlocks) {
        this.blockCounter = 0;
        // Report the level of what actually reaches the listener (post-gain output),
        // not the raw input peak — that's what the popup's meter should reflect.
        let meterPeak = 0;
        for (const channel of output) {
          for (let i = 0; i < channel.length; i++) {
            const abs = Math.abs(channel[i]);
            if (abs > meterPeak) meterPeak = abs;
          }
        }
        const meterDb = meterPeak > 0 ? 20 * Math.log10(meterPeak) : -Infinity;
        this.port.postMessage({ db: meterDb, gain: this.limiter.lastAppliedGain });
      }

      return true;
    }
  }

  registerProcessor('limiter-processor', LimiterProcessor);
}
