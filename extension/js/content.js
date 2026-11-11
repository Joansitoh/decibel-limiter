/**
 * @file Content script — element-path limiting (Fullscreen-friendly fallback)
 * Runs after presets.js (see manifest content_scripts).
 * @module ContentScript
 */

const { SAFETY_COMPRESSOR, applyLeveling, levelingProfileFor } = self.DLPresets;

/**
 * Gecko: createMediaElementSource() marks the element audio-captured and
 * HTMLMediaElement.setMediaKeys() then throws NotSupportedError, so DRM players
 * (Prime Video, Netflix…) fail to start. Capturing after keys are attached is allowed.
 * getBrowserInfo is Firefox-only.
 */
const CAPTURE_BLOCKS_EME = typeof browser !== 'undefined'
  && typeof browser.runtime?.getBrowserInfo === 'function';

/** Media events that (re)try wiring a not-yet-wired element. */
const WIRE_EVENTS = CAPTURE_BLOCKS_EME
  ? ['play', 'playing', 'canplay', 'timeupdate']
  : ['play', 'playing'];

const State = Object.freeze({
  IDLE: 0,
  INITIALIZING: 1,
  READY: 2,
  FAILED: 3
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
  /** @type {Set<{limiter: AudioWorkletNode, leveling: DynamicsCompressorNode, makeup: GainNode}>} */
  #graphs = new Set();
  #processed = new WeakSet();
  /** Elements that fired `encrypted` (DRM) — Gecko-only bookkeeping. */
  #encrypted = new WeakSet();
  /** Any `encrypted` seen on this page: elements without MediaKeys may get them later. */
  #emePage = false;
  #config = {
    enabled: false,
    limitDB: -20,
    limiterStrength: 'normal',
    levelingEnabled: false,
    levelingProfile: null
  };
  #observer = null;
  /** Runtime: this tab currently owns tabCapture. Soft-handoff uses element when false. */
  #captureActive = false;
  #toastTimer = null;

  init() {
    if (this.#state !== State.IDLE) return;
    this.#state = State.INITIALIZING;

    window.addEventListener('click', this.#resumeContextOnGesture, true);
    window.addEventListener('keydown', this.#resumeContextOnGesture, true);
    // `encrypted` doesn't bubble; capture phase still sees it (light DOM only — see #watchElement).
    if (CAPTURE_BLOCKS_EME) window.addEventListener('encrypted', this.#onEncrypted, true);
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
      enabled, limitDB, limiterStrength, limiterRelease,
      captureActive, levelingEnabled, levelingProfile
    } = config;

    if (typeof enabled === 'boolean') this.#config.enabled = enabled;
    if (typeof limitDB === 'number') this.#config.limitDB = limitDB;
    if (typeof limiterStrength === 'string') this.#config.limiterStrength = limiterStrength;
    if (Number.isFinite(limiterRelease)) this.#config.limiterRelease = limiterRelease;
    if (typeof levelingEnabled === 'boolean') this.#config.levelingEnabled = levelingEnabled;
    if (levelingProfile !== undefined) this.#config.levelingProfile = levelingProfile;
    if (typeof captureActive === 'boolean') this.#captureActive = captureActive;

    // This tab owns Best quality — bypass element graphs (avoid double-limit) and skip new hooks.
    // ponytail: MediaElementSource can't be undone; leave graphs wired but transparent.
    if (this.#captureActive) {
      this.#applyToGraphs({ ...this.#config, enabled: false }, null);
      return;
    }

    if (this.#config.enabled) {
      this.#createAudioContext();
      this.#scanDom(document);
    }

    this.#applyToGraphs(this.#config, levelingProfileFor(this.#config));
  }

  #applyToGraphs(config, profile) {
    this.#graphs.forEach(g => {
      g.limiter.port.postMessage({ type: 'config', config });
      applyLeveling(g.leveling, g.makeup, profile);
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
    if (!this.#safeToCapture(el)) return; // WIRE_EVENTS retry later
    if (!this.#createAudioContext()) return;
    this.#processed.add(el);
    this.#workletReady.then(() => safe(() => this.#wireElement(el)));
  }

  #wireElement(el) {
    if (this.#captureActive || !this.#config.enabled || !this.#safeToCapture(el)) {
      // State flipped while the worklet loaded: un-mark so a later enable / HQ release can still wire it.
      this.#processed.delete(el);
      this.#watchElement(el);
      return;
    }
    try {
      const source = this.#audioCtx.createMediaElementSource(el);
      const leveling = this.#audioCtx.createDynamicsCompressor();
      const makeup = this.#audioCtx.createGain();
      const limiterNode = new AudioWorkletNode(this.#audioCtx, 'limiter-processor');
      limiterNode.port.onmessage = event => this.#handleMeter(event.data);

      const safety = this.#audioCtx.createDynamicsCompressor();
      Object.entries(SAFETY_COMPRESSOR).forEach(([k, v]) => { safety[k].value = v; });

      // source → leveling → makeup → lookahead limiter → safety → dest
      source.connect(leveling);
      leveling.connect(makeup);
      makeup.connect(limiterNode);
      limiterNode.connect(safety);
      safety.connect(this.#audioCtx.destination);

      limiterNode.port.postMessage({ type: 'config', config: this.#config });
      applyLeveling(leveling, makeup, levelingProfileFor(this.#config));
      this.#graphs.add({ limiter: limiterNode, leveling, makeup });
      this.#unwatchElement(el);
    } catch (err) {
      // Element already connected
    }
  }

  /**
   * Gecko only: is capturing `el` now guaranteed not to break a later setMediaKeys()?
   * - MediaKeys already attached → yes (Gecko allows audio capture of EME media).
   * - DRM seen on the element or page → wait for its MediaKeys.
   * - HAVE_FUTURE_DATA without `encrypted` → clear media. Gecko dispatches `encrypted`
   *   right after `loadedmetadata`, so HAVE_METADATA alone is too early to tell.
   */
  #safeToCapture(el) {
    if (!CAPTURE_BLOCKS_EME || el.mediaKeys) return true;
    if (this.#emePage || this.#encrypted.has(el)) return false;
    return el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
  }

  #onEncrypted = event => {
    this.#emePage = true;
    if (event.target instanceof HTMLMediaElement) this.#encrypted.add(event.target);
  };

  #connectElementOnPlayback = event => {
    this.#connectElement(event.target);
    this.#resumeContextOnGesture();
  };

  /** One pass over the subtree; descends into open shadow roots. */
  #scanDom(root) {
    if (!root || this.#captureActive) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let node = root; node; node = walker.nextNode()) {
      if (node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO') {
        this.#watchElement(node);
        this.#connectElement(node);
      }
      if (node.shadowRoot) safe(() => this.#scanDom(node.shadowRoot));
    }
  }

  #watchElement(el) {
    if (this.#processed.has(el)) return;
    // Same listener reference → re-watching is a no-op. Removed once wired.
    WIRE_EVENTS.forEach(t => el.addEventListener(t, this.#connectElementOnPlayback, true));
    // Window capture misses `encrypted` inside shadow roots; listen on the element too.
    if (CAPTURE_BLOCKS_EME) el.addEventListener('encrypted', this.#onEncrypted, true);
  }

  #unwatchElement(el) {
    WIRE_EVENTS.forEach(t => el.removeEventListener(t, this.#connectElementOnPlayback, true));
    if (CAPTURE_BLOCKS_EME) el.removeEventListener('encrypted', this.#onEncrypted, true);
  }

  #setupObserver() {
    if (this.#observer) return;
    this.#observer = new MutationObserver(muts => {
      if (this.#captureActive) return;
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) this.#scanDom(node);
        });
      });
    });
    safe(() => this.#observer.observe(document.documentElement, { childList: true, subtree: true }));
  }

  #handleMeter({ db, gain }) {
    // Best quality owns metering via offscreen; nothing to show while disabled.
    if (this.#captureActive || !this.#config.enabled) return;
    safe(() => chrome.runtime?.sendMessage({
      type: 'updateDB',
      db,
      gainDB: gain > 0 ? 20 * Math.log10(gain) : 0
    }));
  }

  #setupMessaging() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type !== 'setConfig') return;
      this.updateConfig(msg);
      sendResponse({ success: true });
    });
  }

  #requestConfig(cb) {
    // Pass hostname — background often cannot read tab.url without host_permissions.
    const host = location.hostname || '';
    chrome.runtime.sendMessage({ type: 'pageReady', host }, resp => {
      if (chrome.runtime.lastError || !resp?.success) {
        chrome.runtime.sendMessage({ type: 'getConfig', host }, resp2 => {
          if (!chrome.runtime.lastError && resp2 && !resp2.error) this.updateConfig(resp2);
          cb();
        });
        return;
      }
      this.updateConfig(resp);
      cb();
    });
  }
}

Limiter.get().init();
