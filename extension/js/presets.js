/**
 * Single source of truth for scenarios, strength presets, and config helpers.
 * Loaded via importScripts (background), <script> (popup, offscreen) or as the
 * first content script.
 * @module presets
 */
(function (root) {
  /** Release speed (dB/s) per limiter character. */
  const STRENGTH_PRESETS = Object.freeze({
    soft: { release: 15 },
    normal: { release: 8 },
    strong: { release: 4 }
  });

  /** Scenario presets — product-facing. Music keeps dynamics (no leveling). */
  const SCENARIO_PRESETS = Object.freeze({
    night: {
      limitDB: -26,
      limiterStrength: 'strong',
      levelingEnabled: true,
      levelingProfile: 'night',
      audioPath: 'capture'
    },
    balanced: {
      limitDB: -20,
      limiterStrength: 'normal',
      levelingEnabled: true,
      levelingProfile: 'balanced',
      audioPath: 'capture'
    },
    social: {
      limitDB: -30,
      limiterStrength: 'strong',
      levelingEnabled: true,
      levelingProfile: 'social',
      audioPath: 'capture'
    },
    music: {
      limitDB: -12,
      limiterStrength: 'soft',
      levelingEnabled: false,
      levelingProfile: null,
      audioPath: 'element'
    }
  });

  /** DynamicsCompressor + makeup profiles for leveling (before the brickwall). */
  const LEVELING_PROFILES = Object.freeze({
    night: { threshold: -35, knee: 6, ratio: 8, attack: 0.005, release: 0.5, makeup: 1.5 },
    balanced: { threshold: -28, knee: 12, ratio: 4, attack: 0.02, release: 0.3, makeup: 1.2 },
    social: { threshold: -45, knee: 4, ratio: 12, attack: 0.003, release: 0.2, makeup: 2.2 }
  });

  /** Last-resort net after the lookahead limiter (both audio paths). */
  const SAFETY_COMPRESSOR = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });

  /** Leveling profile for a config, or null when leveling is off. */
  function levelingProfileFor(cfg) {
    return cfg?.levelingEnabled ? LEVELING_PROFILES[cfg.levelingProfile] ?? null : null;
  }

  /** Point a leveling compressor + makeup gain at a profile, or make them transparent (null). */
  function applyLeveling(compressor, makeup, profile) {
    if (!compressor || !makeup) return;
    if (!profile) {
      compressor.threshold.value = 0;
      compressor.ratio.value = 1;
      makeup.gain.value = 1;
      return;
    }
    compressor.threshold.value = profile.threshold;
    compressor.knee.value = profile.knee;
    compressor.ratio.value = profile.ratio;
    compressor.attack.value = profile.attack;
    compressor.release.value = profile.release;
    makeup.gain.value = profile.makeup;
  }

  const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    limitDB: -20,
    audioPath: 'capture',
    captureEnabled: false,
    scenario: 'balanced',
    limiterStrength: 'normal',
    limiterRelease: 8,
    levelingEnabled: true,
    levelingProfile: 'balanced',
    global: false
  });

  const AUDIO_PATHS = new Set(['capture', 'element', 'auto']);
  const SCENARIOS = new Set(['night', 'balanced', 'social', 'music', 'custom']);
  const LIMITER_STRENGTHS = new Set(['soft', 'normal', 'strong', 'custom']);

  function applyStrength(cfg, strength) {
    const p = STRENGTH_PRESETS[strength];
    if (!p) return cfg;
    return { ...cfg, limiterStrength: strength, limiterRelease: p.release };
  }

  function applyScenario(scenario) {
    const base = SCENARIO_PRESETS[scenario];
    if (!base) return { ...DEFAULT_CONFIG, scenario: 'custom' };
    let cfg = {
      ...DEFAULT_CONFIG,
      scenario,
      limitDB: base.limitDB,
      audioPath: base.audioPath,
      levelingEnabled: base.levelingEnabled,
      levelingProfile: base.levelingProfile
    };
    cfg = applyStrength(cfg, base.limiterStrength);
    return cfg;
  }

  /** Whether this config should run tabCapture (Best quality). */
  function wantsCapture(cfg) {
    if (!cfg?.enabled) return false;
    const path = cfg.audioPath || (cfg.captureEnabled ? 'capture' : 'element');
    return path === 'capture' || path === 'auto';
  }

  /** Migrate old captureEnabled-only configs to audioPath. */
  function migrateConfig(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
    const cfg = { ...DEFAULT_CONFIG, ...raw };
    delete cfg.limiterFloor; // removed setting — the brickwall ceiling always overrode it
    if (!AUDIO_PATHS.has(cfg.audioPath)) {
      cfg.audioPath = raw.captureEnabled ? 'capture' : (DEFAULT_CONFIG.audioPath);
    }
    if (!SCENARIOS.has(cfg.scenario)) cfg.scenario = 'custom';
    if (!LIMITER_STRENGTHS.has(cfg.limiterStrength)) cfg.limiterStrength = 'normal';
    if (typeof cfg.levelingEnabled !== 'boolean') {
      cfg.levelingEnabled = cfg.scenario !== 'music' && cfg.scenario !== 'custom'
        ? true
        : !!raw.levelingEnabled;
    }
    cfg.captureEnabled = wantsCapture(cfg);
    return cfg;
  }

  function normalizeHost(hostname) {
    if (!hostname) return null;
    const h = String(hostname).toLowerCase().replace(/\.$/, '');
    return h.startsWith('www.') ? h.slice(4) : h;
  }

  function hostFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return normalizeHost(u.hostname);
    } catch {
      return null;
    }
  }

  const api = {
    STRENGTH_PRESETS,
    SCENARIO_PRESETS,
    LEVELING_PROFILES,
    SAFETY_COMPRESSOR,
    DEFAULT_CONFIG,
    AUDIO_PATHS,
    SCENARIOS,
    LIMITER_STRENGTHS,
    applyStrength,
    applyScenario,
    levelingProfileFor,
    applyLeveling,
    wantsCapture,
    migrateConfig,
    normalizeHost,
    hostFromUrl
  };

  root.DLPresets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
