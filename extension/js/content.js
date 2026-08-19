/**
 * @file Content script for decibel limiting on traditional HTML media elements
 * @module ContentScript
 */

/**
 * Enumerated internal state for the Limiter lifecycle.
 * @enum {number}
 */
const State = Object.freeze({
  IDLE: 0,
  INITIALIZING: 1,
  READY: 2,
  FAILED: 3
});

/**
 * Safety net applied after the lookahead limiter, in case a fast transient
 * still sneaks through. Native DynamicsCompressorNode — no custom DSP to maintain.
 */
const SAFETY_COMPRESSOR = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });

/**
 * Safely executes a function and logs any errors without throwing.
 * @param {Function} fn - Function to execute safely
 */
function safe(fn) {
  try { fn(); } catch (err) { console.error(err); }
}

/**
 * Singleton class that manages audio limiting for traditional HTML media elements.
 * Scans DOM for audio/video elements and applies Web Audio API processing.
 *
 * The actual limiting (lookahead peak detection + gain) happens inside an
 * AudioWorklet (js/limiter-processor.js), on the audio rendering thread, sitting
 * directly in each element's signal path — not a main-thread analysis loop
 * feeding a separate GainNode. Every element gets its own worklet instance
 * (each has independent audio), all sharing the same config.
 */
class Limiter {
  /** @type {Limiter|null} - Singleton instance */
  static #instance = null;

  /**
   * Gets the singleton instance of Limiter.
   * @returns {Limiter}
   */
  static get() {
    if (!Limiter.#instance) Limiter.#instance = new Limiter();
    return Limiter.#instance;
  }

  /** @type {number} - Current lifecycle state */
  #state = State.IDLE;

  /** @type {AudioContext|null} - Web Audio API context */
  #audioCtx = null;

  /** @type {Promise|null} - Resolves once the AudioWorklet module is loaded */
  #workletReady = null;

  /** @type {Set<AudioWorkletNode>} - Limiter node of every currently connected media element */
  #limiterNodes = new Set();

  /** @type {WeakSet<HTMLElement>} - Tracks already processed media elements */
  #processed = new WeakSet();

  /** @type {Object} - Limiter configuration */
  #config = { enabled: false, limitDB: -20, limiterStrength: 'normal' };

  /** @type {MutationObserver|null} - DOM mutation observer */
  #observer = null;

  /** @type {number|null} - Current tab ID */
  #tabId = null;

  /** @type {boolean} - Flag to prevent duplicate gesture listeners */
  #gestureListenersAdded = false;

  /** @type {boolean} - Whether enhanced (tab capture) mode is on for this tab */
  #captureEnabled = false;

  /** @type {number|null} - Timer that hides the fullscreen hint toast */
  #toastTimer = null;

  /**
   * Initializes the limiter: sets up listeners, scans DOM, and starts processing.
   */
  init() {
    if (this.#state !== State.IDLE) return;
    this.#state = State.INITIALIZING;

    this.#attachGestureListeners();
    this.#attachFullscreenListener();
    this.#setupMessaging();
    this.#requestConfig(() => {
      // After config is loaded, scan DOM and start observer
      this.#scanDom(document);
      this.#setupObserver();
      this.#state = State.READY;
    });
  }

  /**
   * Updates the limiter configuration.
   * Called when background storage changes.
   * @param {Object} config - Configuration object
   */
  updateConfig(config) {
    const wasEnabled = this.#config.enabled;
    const { enabled, limitDB, limiterStrength, limiterFloor, limiterRelease, captureEnabled } = config;
    if (typeof enabled === 'boolean') this.#config.enabled = enabled;
    if (typeof limitDB === 'number') this.#config.limitDB = limitDB;
    if (typeof limiterStrength === 'string') this.#config.limiterStrength = limiterStrength;
    if (Number.isFinite(limiterFloor)) this.#config.limiterFloor = limiterFloor;
    if (Number.isFinite(limiterRelease)) this.#config.limiterRelease = limiterRelease;
    // Kept outside #config: the worklet only cares about limiting parameters.
    if (typeof captureEnabled === 'boolean') this.#captureEnabled = captureEnabled;
    if (!wasEnabled && this.#config.enabled) this.#scanDom(document);
    this.#postConfig();
  }

  /**
   * Sends the current configuration to every connected element's limiter node.
   * @private
   */
  #postConfig() {
    this.#limiterNodes.forEach(node => node.port.postMessage({ type: 'config', config: this.#config }));
  }

  /**
   * Creates the Web Audio API context and starts loading the limiter worklet module.
   * @private
   * @returns {AudioContext|null}
   */
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

  /**
   * Resumes the audio context on user gesture (required by browser autoplay policies).
   * @private
   */
  #resumeContextOnGesture = () => {
    safe(() => {
      if (!this.#audioCtx) this.#createAudioContext();
      if (this.#audioCtx?.state === 'suspended') {
        this.#audioCtx.resume();
      }
    });
  };

  /**
   * Attaches gesture listeners to resume audio context on user interaction.
   * @private
   */
  #attachGestureListeners() {
    if (this.#gestureListenersAdded) return;
    window.addEventListener('click', this.#resumeContextOnGesture, true);
    window.addEventListener('keydown', this.#resumeContextOnGesture, true);
    this.#gestureListenersAdded = true;
  }

  /**
   * While a tab is being captured, the page's fullscreen request still
   * succeeds — but the browser keeps its tab-sharing chrome on screen, so the
   * video never really fills the display. There is no `fullscreenerror` to
   * hook here (the call resolves fine); the cue is entering fullscreen at all
   * while capture is on, so point the user at F11, which does work.
   * @private
   */
  #attachFullscreenListener() {
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement && this.#captureEnabled) this.#showFullscreenHint();
    }, true);
  }

  /**
   * Shows a self-contained toast. Styles are inlined so page CSS cannot
   * restyle it, and it is mounted inside the fullscreen element when there is
   * one — anything outside it is simply not painted while fullscreen is on.
   * @private
   */
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

  /**
   * Connects a media element to the Web Audio API processing chain.
   * Marks the element as processed synchronously to avoid duplicate
   * MediaElementSource creation while the worklet module is still loading.
   * @private
   * @param {HTMLMediaElement} el - Audio or video element to connect
   */
  #connectElement(el) {
    if (!el || this.#processed.has(el)) return;
    if (!this.#createAudioContext()) return; // Failed to create context
    this.#processed.add(el);
    this.#workletReady.then(() => safe(() => this.#wireElement(el)));
  }

  /**
   * Builds the actual audio graph for a media element once the worklet is ready.
   * @private
   * @param {HTMLMediaElement} el
   */
  #wireElement(el) {
    try {
      const source = this.#audioCtx.createMediaElementSource(el);
      const limiterNode = new AudioWorkletNode(this.#audioCtx, 'limiter-processor');
      limiterNode.port.postMessage({ type: 'config', config: this.#config });
      limiterNode.port.onmessage = event => this.#handleMeter(event.data);

      const safety = this.#audioCtx.createDynamicsCompressor();
      Object.entries(SAFETY_COMPRESSOR).forEach(([k, v]) => { safety[k].value = v; });

      source.connect(limiterNode);
      limiterNode.connect(safety);
      safety.connect(this.#audioCtx.destination);

      this.#limiterNodes.add(limiterNode);
    } catch (err) {
      // Element already connected - ignore subsequent attempts
    }
  }

  #connectElementOnPlayback = event => {
    this.#connectElement(event.target);
    this.#resumeContextOnGesture();
  };

  /**
   * Recursively scans DOM for audio/video elements and connects them.
   * Includes shadow DOM traversal.
   * @private
   * @param {Document|HTMLElement|ShadowRoot} root - Root element to scan from
   */
  #scanDom(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => (node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    while (walker.nextNode()) {
      const el = /** @type {HTMLMediaElement} */(walker.currentNode);
      this.#watchElement(el);
      if (this.#config.enabled) this.#connectElement(el);
    }
    // Recursively scan shadow DOM
    if (root.shadowRoot) safe(() => this.#scanDom(root.shadowRoot));
    [...root.children].forEach(child => safe(() => this.#scanDom(child)));
  }

  #watchElement(el) {
    if (!el || this.#processed.has(el)) return;
    el.addEventListener('play', this.#connectElementOnPlayback, { once: true, capture: true });
    el.addEventListener('playing', this.#connectElementOnPlayback, { once: true, capture: true });
  }

  /**
   * Sets up MutationObserver to detect dynamically added media elements.
   * @private
   */
  #setupObserver() {
    if (this.#observer) return;
    this.#observer = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) this.#scanDom(/** @type {HTMLElement} */(node));
        });
      });
    });
    safe(() => this.#observer.observe(document.documentElement, { childList: true, subtree: true }));
  }

  /**
   * Forwards the decibel/gain reading reported by a limiter node to the background script.
   * The worklet already throttles its own reports (~40Hz); forwarding each one
   * keeps the popup's meter smooth instead of relying on a second throttle here.
   * @private
   * @param {{db: number, gain: number}} analysis
   */
  #handleMeter({ db, gain }) {
    safe(() => chrome.runtime?.sendMessage({
      type: 'updateDB',
      db,
      averageDB: isFinite(db) ? db : -Infinity,
      gainDB: gain > 0 ? 20 * Math.log10(gain) : 0
    }));
  }

  /**
   * Sets up message listener for communication with background script.
   * @private
   */
  #setupMessaging() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'setConfig') {
        this.updateConfig(msg);
        sendResponse({ success: true });
      }
      return true;
    });
  }

  /**
   * Requests initial configuration from background script.
   * @private
   * @param {Function} cb - Callback to execute after config is loaded
   */
  #requestConfig(cb) {
    chrome.runtime.sendMessage({ type: 'getConfig' }, resp => {
      if (resp) {
        this.#tabId = resp.tabId;
        this.updateConfig(resp);
      }
      cb();
    });
  }
}

// Initialize limiter immediately on script load
Limiter.get().init();
