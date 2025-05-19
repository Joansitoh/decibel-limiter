// Enumerated internal state
const State = Object.freeze({
  IDLE: 0,
  INITIALIZING: 1,
  READY: 2,
  FAILED: 3
});

/**
 * Tiny helper to execute a function and swallow/log errors
 * @param {Function} fn
 */
function safe(fn) {
  try { fn(); } catch (err) { console.error(err); }
}

class Limiter {
  /** @type {Limiter|null} */
  static #instance = null;
  static get() {
    if (!Limiter.#instance) Limiter.#instance = new Limiter();
    return Limiter.#instance;
  }

  /* --- private fields --- */
  #state = State.IDLE;
  #audioCtx = null;
  #analyser = null;
  #gainMap = new WeakMap();          // HTMLElement → GainNode
  #processed = new WeakSet();        // HTMLElement already wired
  #globalGain = 1;
  #config = { enabled: false, limitDB: -20 };
  #observer = null;
  #lastSendTs = 0;
  #tabId = null;
  #gestureListenersAdded = false;

  /* ---------------------- public API ---------------------- */
  init() {
    if (this.#state !== State.IDLE) return;
    this.#state = State.INITIALIZING;

    this.#attachGestureListeners();
    this.#setupMessaging();
    this.#requestConfig(() => {
      // After config, scan DOM & start observer
      this.#scanDom(document);
      this.#setupObserver();
      this.#startMeterLoop();
      this.#state = State.READY;
    });
  }

  /** Update config (called from background storage change) */
  updateConfig({ enabled, limitDB }) {
    if (typeof enabled === 'boolean') this.#config.enabled = enabled;
    if (typeof limitDB === 'number') this.#config.limitDB = limitDB;
  }

  /* ---------------------- private helpers ---------------------- */
  #createAudioContext() {
    if (this.#audioCtx || this.#state === State.FAILED) return this.#audioCtx;
    try {
      this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.#analyser = this.#audioCtx.createAnalyser();
      this.#analyser.fftSize = 2048;
    } catch (err) {
      console.error('AudioContext error', err);
      this.#state = State.FAILED;
    }
    return this.#audioCtx;
  }

  #resumeContextOnGesture = () => {
    safe(() => {
      if (!this.#audioCtx) this.#createAudioContext();
      if (this.#audioCtx?.state === 'suspended') {
        this.#audioCtx.resume();
      }
    });
  };

  #attachGestureListeners() {
    if (this.#gestureListenersAdded) return;
    window.addEventListener('click', this.#resumeContextOnGesture, true);
    window.addEventListener('keydown', this.#resumeContextOnGesture, true);
    this.#gestureListenersAdded = true;
  }

  #connectElement(el) {
    if (!el || this.#processed.has(el)) return;
    if (!this.#createAudioContext()) return; // failed

    try {
      const source = this.#audioCtx.createMediaElementSource(el);
      const gain = this.#audioCtx.createGain();
      source.connect(gain);
      gain.connect(this.#audioCtx.destination);
      source.connect(this.#analyser);
      this.#gainMap.set(el, gain);
      this.#processed.add(el);
    } catch (err) {
      // can throw if element already connected → ignore subsequent attempts
    }
  }

  #scanDom(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => (node.nodeName === 'AUDIO' || node.nodeName === 'VIDEO') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    while (walker.nextNode()) {
      this.#connectElement(/** @type {HTMLMediaElement} */(walker.currentNode));
    }
    // shadow DOM recursion
    if (root.shadowRoot) safe(() => this.#scanDom(root.shadowRoot));
    [...root.children].forEach(child => safe(() => this.#scanDom(child)));
  }

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

  #calcRms() {
    if (!this.#analyser) return 0;
    const buffer = new Float32Array(this.#analyser.fftSize);
    this.#analyser.getFloatTimeDomainData(buffer);
    let sumSq = 0;
    for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
    return Math.sqrt(sumSq / buffer.length);
  }

  #applyGain() {
    const rms = this.#calcRms();
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    // Update gain according to configuration
    if (this.#config.enabled) {
      const limitRms = Math.pow(10, this.#config.limitDB / 20);
      this.#globalGain = rms > limitRms ?
        Math.max(0.01, limitRms / rms) :
        Math.min(1, this.#globalGain * 1.01);
    } else {
      this.#globalGain = 1;
    }

    // Apply gain to media elements
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
        // Ensure the value is finite
        averageDB: isFinite(db) ? db : -Infinity
      }));
    }
  }

  #startMeterLoop() {
    setInterval(() => {
      if (this.#state !== State.READY) return;
      this.#applyGain();
    }, 33); // ≈30 FPS
  }

  // ---------------- messaging ----------------
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
    chrome.runtime.sendMessage({ type: 'getConfig' }, resp => {
      if (resp) {
        this.#tabId = resp.tabId;
        this.updateConfig(resp);
      }
      cb();
    });
  }
}

// Bootstrap immediately
Limiter.get().init();