/**
 * @file Content script — element-path limiting (Fullscreen-friendly fallback)
 * @module ContentScript
 */

const State = Object.freeze({
  IDLE: 0,
  INITIALIZING: 1,
  READY: 2,
  FAILED: 3
});

const SAFETY_COMPRESSOR = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });

/** Mirrors presets.js LEVELING_PROFILES (content cannot importScripts). */
const LEVELING_PROFILES = Object.freeze({
  night: { threshold: -35, knee: 6, ratio: 8, attack: 0.005, release: 0.5, makeup: 1.5 },
  balanced: { threshold: -28, knee: 12, ratio: 4, attack: 0.02, release: 0.3, makeup: 1.2 },
  social: { threshold: -45, knee: 4, ratio: 12, attack: 0.003, release: 0.2, makeup: 2.2 }
});

function safe(fn) {
  try { fn(); } catch (err) { console.error(err); }
}

class Limiter {
  static #instance = null;

  static get() {
    if (!Limiter.#instance) Limiter.#instance = new Limiter();
    return Limiter.#instance;
  }

  #state = State.IDLE;
  #audioCtx = null;
  #workletReady = null;
  /** @type {Set<{limiter: AudioWorkletNode, leveling: DynamicsCompressorNode|null, makeup: GainNode|null}>} */
  #graphs = new Set();
  #processed = new WeakSet();
  #config = {
    enabled: false,
    limitDB: -20,
    limiterStrength: 'normal',
    levelingEnabled: false,
    levelingProfile: null
  };
  #observer = null;
  #tabId = null;
  #gestureListenersAdded = false;
  /** User preference / config: wants Best quality path. */
  #captureEnabled = false;
  /** Runtime: this tab currently owns tabCapture. Soft-handoff uses element when false. */
  #captureActive = false;
  #toastTimer = null;

  init() {
    if (this.#state !== State.IDLE) return;
    this.#state = State.INITIALIZING;

    this.#attachGestureListeners();
    this.#attachFullscreenListener();
    this.#setupMessaging();
    this.#requestConfig(() => {
      this.#scanDom(document);
      this.#setupObserver();
      this.#state = State.READY;
    });
  }

  updateConfig(config) {
    const {
      enabled, limitDB, limiterStrength, limiterFloor, limiterRelease,
      captureEnabled, captureActive, levelingEnabled, levelingProfile
    } = config;

    if (typeof enabled === 'boolean') this.#config.enabled = enabled;
    if (typeof limitDB === 'number') this.#config.limitDB = limitDB;
    if (typeof limiterStrength === 'string') this.#config.limiterStrength = limiterStrength;
    if (Number.isFinite(limiterFloor)) this.#config.limiterFloor = limiterFloor;
    if (Number.isFinite(limiterRelease)) this.#config.limiterRelease = limiterRelease;
    if (typeof levelingEnabled === 'boolean') this.#config.levelingEnabled = levelingEnabled;
    if (levelingProfile !== undefined) this.#config.levelingProfile = levelingProfile;
    if (typeof captureEnabled === 'boolean') this.#captureEnabled = captureEnabled;
    if (typeof captureActive === 'boolean') {
      this.#captureActive = captureActive;
    } else if (typeof captureEnabled === 'boolean') {
      // Legacy: preference was treated as runtime ownership
      this.#captureActive = captureEnabled;
    }

    // This tab owns Best quality — bypass element graphs (avoid double-limit) and skip new hooks.
    // ponytail: MediaElementSource can't be undone; leave graphs wired but transparent.
    if (this.#captureActive) {
      this.#bypassElementGraphs();
      return;
    }

    if (this.#config.enabled) {
      this.#createAudioContext();
      this.#scanDom(document);
    }

    this.#postConfig();
    this.#applyLevelingToGraphs();
  }

  /** Pass-through existing element graphs while tabCapture is active. */
  #bypassElementGraphs() {
    this.#graphs.forEach(g => {
      g.limiter.port.postMessage({
        type: 'config',
        config: { ...this.#config, enabled: false }
      });
      if (!g.leveling || !g.makeup) return;
      g.leveling.threshold.value = 0;
      g.leveling.ratio.value = 1;
      g.makeup.gain.value = 1;
    });
  }

  #postConfig() {
    this.#graphs.forEach(g => {
      g.limiter.port.postMessage({ type: 'config', config: this.#config });
    });
  }

  #applyLevelingToGraphs() {
    const profile = this.#config.levelingEnabled
      ? LEVELING_PROFILES[this.#config.levelingProfile]
      : null;
    this.#graphs.forEach(g => {
      if (!g.leveling || !g.makeup) return;
      if (!profile) {
        g.leveling.threshold.value = 0;
        g.leveling.ratio.value = 1;
        g.makeup.gain.value = 1;
        return;
      }
      g.leveling.threshold.value = profile.threshold;
      g.leveling.knee.value = profile.knee;
      g.leveling.ratio.value = profile.ratio;
      g.leveling.attack.value = profile.attack;
      g.leveling.release.value = profile.release;
      g.makeup.gain.value = profile.makeup;
    });
  }

  #createAudioContext() {
    if (this.#audioCtx || this.#state === State.FAILED) return this.#audioCtx;
    try {
      this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.#workletReady = this.#audioCtx.audioWorklet
        .addModule(chrome.runtime.getURL('js/limiter-processor.js'))
        .catch(err => console.error('Failed to load limiter-processor worklet', err));
    } catch (err) {
      console.error('AudioContext error', err);
      this.#state = State.FAILED;
    }
    return this.#audioCtx;
  }

  #resumeContextOnGesture = () => {
    safe(() => {
      if (!this.#audioCtx) this.#createAudioContext();
      if (this.#audioCtx?.state === 'suspended') this.#audioCtx.resume();
    });
  };

  #attachGestureListeners() {
    if (this.#gestureListenersAdded) return;
    window.addEventListener('click', this.#resumeContextOnGesture, true);
    window.addEventListener('keydown', this.#resumeContextOnGesture, true);
    this.#gestureListenersAdded = true;
  }

  #attachFullscreenListener() {
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement && this.#captureActive) this.#showFullscreenHint();
    }, true);
  }

  #showFullscreenHint() {
    const ID = 'dl-fullscreen-hint';
    const host = document.fullscreenElement ?? document.body ?? document.documentElement;
    let toast = document.getElementById(ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = ID;
      toast.textContent = chrome.i18n.getMessage('fullscreenHint');
      toast.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:24px', 'translate:-50% 0',
        'margin:0', 'padding:12px 18px', 'border:none', 'border-radius:10px',
        'max-width:min(420px, 90vw)', 'background:#191a20', 'color:#eef0f5',
        'font:500 13px/1.45 system-ui, sans-serif', 'text-align:center',
        'box-shadow:0 8px 28px rgba(0,0,0,0.45)', 'z-index:2147483647',
        'pointer-events:none'
      ].join(';');
    }
    if (toast.parentElement !== host) host.appendChild(toast);
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => toast.remove(), 5000);
  }

  #connectElement(el) {
    if (!el || this.#processed.has(el)) return;
    if (this.#captureActive || !this.#config.enabled) return;
    if (!this.#createAudioContext()) return;
    this.#processed.add(el);
    this.#workletReady.then(() => safe(() => this.#wireElement(el)));
  }

  #wireElement(el) {
    if (this.#captureActive || !this.#config.enabled) return;
    try {
      const source = this.#audioCtx.createMediaElementSource(el);
      const leveling = this.#audioCtx.createDynamicsCompressor();
      const makeup = this.#audioCtx.createGain();
      const limiterNode = new AudioWorkletNode(this.#audioCtx, 'limiter-processor');
      limiterNode.port.postMessage({ type: 'config', config: this.#config });
      limiterNode.port.onmessage = event => this.#handleMeter(event.data);

      const safety = this.#audioCtx.createDynamicsCompressor();
      Object.entries(SAFETY_COMPRESSOR).forEach(([k, v]) => { safety[k].value = v; });

      // source → leveling → makeup → lookahead limiter → safety → dest
      source.connect(leveling);
      leveling.connect(makeup);
      makeup.connect(limiterNode);
      limiterNode.connect(safety);
      safety.connect(this.#audioCtx.destination);

      this.#graphs.add({ limiter: limiterNode, leveling, makeup });
      this.#applyLevelingToGraphs();
    } catch (err) {
      // Element already connected
    }
  }

  #connectElementOnPlayback = event => {
    this.#connectElement(event.target);
    this.#resumeContextOnGesture();
  };

  #scanDom(root) {
    if (!root || this.#captureActive) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => (node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    while (walker.nextNode()) {
      const el = /** @type {HTMLMediaElement} */(walker.currentNode);
      this.#watchElement(el);
      if (this.#config.enabled) this.#connectElement(el);
    }
    if (root.shadowRoot) safe(() => this.#scanDom(root.shadowRoot));
    if (root.children) [...root.children].forEach(child => safe(() => this.#scanDom(child)));
  }

  #watchElement(el) {
    if (!el || this.#processed.has(el)) return;
    el.addEventListener('play', this.#connectElementOnPlayback, { once: true, capture: true });
    el.addEventListener('playing', this.#connectElementOnPlayback, { once: true, capture: true });
  }

  #setupObserver() {
    if (this.#observer) return;
    this.#observer = new MutationObserver(muts => {
      if (this.#captureActive) return;
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) this.#scanDom(/** @type {HTMLElement} */(node));
        });
      });
    });
    safe(() => this.#observer.observe(document.documentElement, { childList: true, subtree: true }));
  }

  #handleMeter({ db, gain }) {
    // Best quality owns metering via offscreen — don't pollute with passthrough element graphs.
    if (this.#captureActive) return;
    safe(() => chrome.runtime?.sendMessage({
      type: 'updateDB',
      db,
      averageDB: isFinite(db) ? db : -Infinity,
      gainDB: gain > 0 ? 20 * Math.log10(gain) : 0
    }));
  }

  #setupMessaging() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'setConfig') {
        this.updateConfig(msg);
        sendResponse({ success: true });
      }
      return true;
    });
  }

  #requestConfig(cb) {
    // Pass hostname — background often cannot read tab.url without host_permissions.
    const host = location.hostname || '';
    chrome.runtime.sendMessage({ type: 'pageReady', host }, resp => {
      if (chrome.runtime.lastError || !resp) {
        chrome.runtime.sendMessage({ type: 'getConfig', host }, resp2 => {
          if (resp2) {
            this.#tabId = resp2.tabId;
            this.updateConfig(resp2);
          }
          cb();
        });
        return;
      }
      this.#tabId = resp.tabId;
      this.updateConfig(resp);
      cb();
    });
  }
}

Limiter.get().init();
