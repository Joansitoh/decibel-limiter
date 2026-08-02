/**
 * Minimal, framework-free self-check for the pure lookahead limiter (js/limiter-processor.js).
 * Run with: node js/limiter-processor.test.js
 */
const assert = require('assert');
const { LookaheadLimiter, resolveLimiterParams } = require('./limiter-processor.js');

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 128;

/** Builds a single-channel block filled with a constant amplitude. */
function makeBlock(amplitude) {
  return [new Float32Array(BLOCK_SIZE).fill(amplitude)];
}

/** Runs a sequence of amplitudes through the limiter, collecting every emitted block. */
function run(limiter, amplitudes, params) {
  const emitted = [];
  for (const amp of amplitudes) {
    const out = limiter.process(makeBlock(amp), params);
    if (out) emitted.push(out[0]);
  }
  return emitted;
}

// --- The core guarantee: output must NEVER exceed the ceiling, even right at a sudden peak ---
{
  const limiter = new LookaheadLimiter(4);
  const params = resolveLimiterParams({ limitDB: -20, limiterStrength: 'normal' }, SAMPLE_RATE, BLOCK_SIZE);

  // Quiet audio, then a sudden loud spike well above the ceiling, then quiet again.
  const amplitudes = [0.05, 0.05, 0.05, 0.05, 0.05, 0.9, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
  const emitted = run(limiter, amplitudes, params);

  let maxOutput = 0;
  for (const block of emitted) {
    for (let i = 0; i < block.length; i++) maxOutput = Math.max(maxOutput, Math.abs(block[i]));
  }
  assert.ok(maxOutput <= params.ceilingLin + 1e-6, `output must never exceed the ceiling (${params.ceilingLin}), got ${maxOutput}`);
}

// --- Lookahead actually pre-ducks: gain during the spike's own block must already be near target ---
{
  const limiter = new LookaheadLimiter(4);
  const params = resolveLimiterParams({ limitDB: -20, limiterStrength: 'normal' }, SAMPLE_RATE, BLOCK_SIZE);
  const targetGainForSpike = Math.max(params.floor, Math.min(1, params.ceilingLin / 0.9));

  const amplitudes = [0.05, 0.05, 0.05, 0.05, 0.05, 0.9, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
  for (const amp of amplitudes) limiter.process(makeBlock(amp), params);

  // Because of the lookahead, the gain should have been clamped near the
  // spike's required value for several blocks — not just reacting afterwards.
  assert.ok(Math.abs(limiter.activeGain - targetGainForSpike) < 0.05,
    `lookahead should pre-duck to close to the spike's target gain (${targetGainForSpike}), got ${limiter.activeGain}`);
}

// --- Quiet audio under the ceiling passes through essentially untouched (gain stays at 1) ---
{
  const limiter = new LookaheadLimiter(4);
  const params = resolveLimiterParams({ limitDB: -20, limiterStrength: 'normal' }, SAMPLE_RATE, BLOCK_SIZE);
  const emitted = run(limiter, new Array(20).fill(0.02), params);
  for (const block of emitted) {
    for (let i = 0; i < block.length; i++) assert.ok(Math.abs(block[i] - 0.02) < 1e-6, 'quiet audio under the ceiling must not be attenuated');
  }
}

// --- Gain never drops below the configured floor, even for extreme peaks ---
{
  const limiter = new LookaheadLimiter(4);
  const params = resolveLimiterParams({ limitDB: -20, limiterStrength: 'strong' }, SAMPLE_RATE, BLOCK_SIZE);
  run(limiter, [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0], params);
  assert.ok(limiter.activeGain >= params.floor - 1e-6, `gain must never go below the configured floor (${params.floor}), got ${limiter.activeGain}`);
}

// --- Silence produces silence, unity gain ---
{
  const limiter = new LookaheadLimiter(4);
  const params = resolveLimiterParams({ limitDB: -20, limiterStrength: 'normal' }, SAMPLE_RATE, BLOCK_SIZE);
  const emitted = run(limiter, new Array(10).fill(0), params);
  for (const block of emitted) for (let i = 0; i < block.length; i++) assert.strictEqual(block[i], 0);
  assert.strictEqual(limiter.activeGain, 1, 'silence must not trigger any gain reduction');
}

console.log('limiter-processor.test.js: all checks passed');
