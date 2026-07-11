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

const LIMITER_PRESETS = Object.freeze({
  soft: { floor: 0.05, release: 1.06 },
  normal: { floor: 0.01, release: 1.03 },
  strong: { floor: 0.003, release: 1.015 }
});

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
  
  /** @type {AnalyserNode|null} - Audio analyser for RMS calculation */
  #analyser = null;
  
  /** @type {WeakMap<HTMLElement, GainNode>} - Maps media elements to their gain nodes */
  #gainMap = new WeakMap();
  
  /** @type {WeakSet<HTMLElement>} - Tracks already processed media elements */
  #processed = new WeakSet();
  
  /** @type {number} - Current global gain value */
  #globalGain = 1;
  
  /** @type {{enabled: boolean, limitDB: number}} - Limiter configuration */
  #config = { enabled: false, limitDB: -20, limiterStrength: 'normal' };
  
  /** @type {MutationObserver|null} - DOM mutation observer */
  #observer = null;
  
  /** @type {number} - Timestamp of last decibel update sent */
  #lastSendTs = 0;
  
  /** @type {number|null} - Current tab ID */
  #tabId = null;
  
  /** @type {boolean} - Flag to prevent duplicate gesture listeners */
  #gestureListenersAdded = false;

  /**
   * Initializes the limiter: sets up listeners, scans DOM, and starts processing.
   */
  init() {
    if (this.#state !== State.IDLE) return;
    this.#state = State.INITIALIZING;

    this.#attachGestureListeners();
    this.#setupMessaging();
    this.#requestConfig(() => {
      // After config is loaded, scan DOM and start observer
      this.#scanDom(document);
      this.#setupObserver();
      this.#startMeterLoop();
      this.#state = State.READY;
    });
  }

  /**
   * Updates the limiter configuration.
   * Called when background storage changes.
   * @param {Object} config - Configuration object
   * @param {boolean} [config.enabled] - Whether limiting is enabled
   * @param {number} [config.limitDB] - Decibel limit threshold
   */
  updateConfig({ enabled, limitDB, limiterStrength, limiterFloor, limiterRelease }) {
    if (typeof enabled === 'boolean') this.#config.enabled = enabled;
    if (typeof limitDB === 'number') this.#config.limitDB = limitDB;
    if (limiterStrength in LIMITER_PRESETS || limiterStrength === 'custom') this.#config.limiterStrength = limiterStrength;
    if (Number.isFinite(limiterFloor)) this.#config.limiterFloor = limiterFloor;
    if (Number.isFinite(limiterRelease)) this.#config.limiterRelease = limiterRelease;
  }

  /**
   * Creates and configures the Web Audio API context and analyser.
   * @private
   * @returns {AudioContext|null}
   */
  #createAudioContext() {
    if (this.#audioCtx || this.#state === State.FAILED) return this.#audioCtx;
    try {
      this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.#analyser = this.#audioCtx.createAnalyser();
      this.#analyser.fftSize = 2048;
      this.#analyser.smoothingTimeConstant = 0; // No smoothing for accurate RMS
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
   * Connects a media element to the Web Audio API processing chain.
   * @private
   * @param {HTMLMediaElement} el - Audio or video element to connect
   */
  #connectElement(el) {
    if (!el || this.#processed.has(el)) return;
    if (!this.#createAudioContext()) return; // Failed to create context

    try {
      const source = this.#audioCtx.createMediaElementSource(el);
      const gain = this.#audioCtx.createGain();
      source.connect(gain);
      gain.connect(this.#audioCtx.destination);
      source.connect(this.#analyser);
      this.#gainMap.set(el, gain);
      this.#processed.add(el);
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
      this.#connectElement(el);
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
   * Calculates RMS (Root Mean Square) from audio analyser data.
   * @private
   * @returns {number} RMS value
   */
  #calcRms() {
    if (!this.#analyser) return 0;
    const buffer = new Float32Array(this.#analyser.fftSize);
    this.#analyser.getFloatTimeDomainData(buffer);
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
    return Math.sqrt(sumSq / buffer.length);
  }

  /**
   * Calculates and applies gain limiting to all connected media elements.
   * Sends decibel updates to background script.
   * Uses professional attack/release times matching offscreen.js behavior.
   * @private
   */
  #applyGain() {
    const rms = this.#calcRms();
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    // Calculate target gain based on configuration with attack/release
    if (this.#config.enabled) {
      const limitRms = Math.pow(10, this.#config.limitDB / 20);
      const floor = Number.isFinite(this.#config.limiterFloor) ? this.#config.limiterFloor : (LIMITER_PRESETS[this.#config.limiterStrength]?.floor ?? 0.01);
      const release = Number.isFinite(this.#config.limiterRelease) ? this.#config.limiterRelease : (LIMITER_PRESETS[this.#config.limiterStrength]?.release ?? 1.03);
      
      if (rms > limitRms) {
        // ATTACK: Audio exceeds limit - reduce gain immediately (fast attack)
        this.#globalGain = Math.max(floor, limitRms / rms);
      } else {
        // RELEASE: Audio under limit - restore gain gradually
        // Release time: ~100ms for perceptible but smooth recovery
        // At 30 FPS (33ms per frame), increment by ~3% per frame
        this.#globalGain = Math.min(1.0, this.#globalGain * release);
      }
    } else {
      this.#globalGain = 1;
    }

    // Apply calculated gain to all connected media elements
    document.querySelectorAll('audio, video').forEach(el => {
      if (el.isConnected) {
        const gain = this.#gainMap.get(el);
        if (gain) gain.gain.value = this.#globalGain;
      }
    });

    const now = performance.now();
    if (now - this.#lastSendTs > 50) {
      this.#lastSendTs = now;
      safe(() => chrome.runtime?.sendMessage({
        type: 'updateDB',
        db,
        // Ensure decibel value is finite before sending
        averageDB: isFinite(db) ? db : -Infinity
      }));
    }
  }

  /**
   * Starts the audio processing loop at approximately 30 FPS.
   * @private
   */
  #startMeterLoop() {
    setInterval(() => {
      if (this.#state !== State.READY) return;
      this.#applyGain();
    }, 33); // ~30 FPS
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