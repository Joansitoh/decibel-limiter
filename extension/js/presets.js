/**
 * Single source of truth for scenarios, strength presets, and config helpers.
 * Loaded via importScripts (background), <script> (popup, offscreen) or as the
 * first content script.
 * @module presets
 */
(function (root) {
  /**
   * Recovery speed after a peak (dB/s). Keys are stored in configs; the UI calls
   * them Fast (soft) / Normal / Slow (strong).
   */
  const STRENGTH_PRESETS = Object.freeze({
    soft: { release: 15 },
    normal: { release: 8 },
    strong: { release: 4 }
  });

  /**
   * Scenario presets — sound only. Power, global scope and the audio path stay the
   * user's choice (the path depends on their player/fullscreen needs, not the content).
   * Music keeps dynamics (no leveling).
   */
  const SCENARIO_PRESETS = Object.freeze({
    night: { limitDB: -26, limiterStrength: 'strong', levelingEnabled: true, levelingProfile: 'night' },
    balanced: { limitDB: -20, limiterStrength: 'normal', levelingEnabled: true, levelingProfile: 'balanced' },
    social: { limitDB: -30, limiterStrength: 'strong', levelingEnabled: true, levelingProfile: 'social' },
    music: { limitDB: -12, limiterStrength: 'soft', levelingEnabled: false, levelingProfile: null }
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

  const AUDIO_PATHS = new Set(['capture', 'element']);
  const SCENARIOS = new Set(['night', 'balanced', 'social', 'music', 'custom']);

  /** Preset whose release is closest to a (legacy custom) release value. */
  function nearestStrength(release) {
    if (!Number.isFinite(release)) return 'normal';
    return Object.keys(STRENGTH_PRESETS).reduce((best, k) =>
      Math.abs(STRENGTH_PRESETS[k].release - release) < Math.abs(STRENGTH_PRESETS[best].release - release) ? k : best,
    'normal');
  }

  /** Apply a scenario's sound settings over cfg; power, scope and audio path stay as they are. */
  function applyScenario(cfg, scenario) {
    const base = SCENARIO_PRESETS[scenario];
    return migrateConfig(base ? { ...cfg, ...base, scenario } : { ...cfg, scenario: 'custom' });
  }

  /** Whether this config should run tabCapture (Best quality). */
  function wantsCapture(cfg) {
    if (!cfg?.enabled) return false;
    return (cfg.audioPath || (cfg.captureEnabled ? 'capture' : 'element')) !== 'element';
  }

  /** Normalize any stored/incoming config (also migrates removed options). */
  function migrateConfig(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
    const cfg = { ...DEFAULT_CONFIG, ...raw };
    delete cfg.limiterFloor; // removed setting — the brickwall ceiling always overrode it
    // Ceiling must stay a real dBFS value in range: imported files and old storage are untrusted,
    // and anything above 0 dBFS would silently switch protection off.
    cfg.limitDB = Number.isFinite(cfg.limitDB) ? Math.max(-60, Math.min(0, cfg.limitDB)) : DEFAULT_CONFIG.limitDB;
    // Unknown or removed paths ('auto' always behaved like capture) → Best quality.
    if (!AUDIO_PATHS.has(cfg.audioPath)) cfg.audioPath = 'capture';
    if (!SCENARIOS.has(cfg.scenario)) cfg.scenario = 'custom';
    // Recovery is preset-only now; legacy 'custom' maps to the closest preset.
    if (!Object.hasOwn(STRENGTH_PRESETS, cfg.limiterStrength)) {
      cfg.limiterStrength = nearestStrength(cfg.limiterRelease);
    }
    cfg.limiterRelease = STRENGTH_PRESETS[cfg.limiterStrength].release;
    if (typeof cfg.levelingEnabled !== 'boolean') {
      cfg.levelingEnabled = cfg.scenario !== 'music' && cfg.scenario !== 'custom'
        ? true
        : !!raw.levelingEnabled;
    }
    // Leveling on needs a real profile (Music stores null) — otherwise the switch does nothing.
    if (cfg.levelingEnabled && !Object.hasOwn(LEVELING_PROFILES, cfg.levelingProfile)) {
      cfg.levelingProfile = 'balanced';
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
