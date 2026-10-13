/**
 * Single source of truth for scenarios, strength presets, and config helpers.
 * Loaded via importScripts (background) or <script> (popup).
 * @module presets
 */
(function (root) {
  const STRENGTH_PRESETS = Object.freeze({
    soft: { floor: 0.05, release: 15 },
    normal: { floor: 0.01, release: 8 },
    strong: { floor: 0.003, release: 4 }
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

  const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    limitDB: -20,
    audioPath: 'capture',
    captureEnabled: false,
    scenario: 'balanced',
    limiterStrength: 'normal',
    limiterFloor: 0.01,
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
    return { ...cfg, limiterStrength: strength, limiterFloor: p.floor, limiterRelease: p.release };
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
    DEFAULT_CONFIG,
    AUDIO_PATHS,
    SCENARIOS,
    LIMITER_STRENGTHS,
    applyStrength,
    applyScenario,
    wantsCapture,
    migrateConfig,
    normalizeHost,
    hostFromUrl
  };

  root.DLPresets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
