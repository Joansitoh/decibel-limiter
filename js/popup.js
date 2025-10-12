/**
 * @file Popup UI controller for Decibel Limiter extension
 * @module Popup
 */

(() => {
  /**
   * Main popup controller class managing UI state, configuration, and real-time audio metrics.
   */
  class Popup {
    /** @type {number|null} - Current tab ID */
    #tabId = null;
    
    /** @type {{enabled: boolean, limitDB: number}} - Limiter configuration */
    #config = { enabled: false, limitDB: -20 };
    
    /** @type {boolean} - Enhanced capture mode state */
    #captureEnabled = false;
    
    /** @type {number|null} - Current decibel level (null = no data; -Infinity = silence) */
    #currentDB = null;
    
    /** @type {number|null} - Average decibel level */
    #averageDB = null;
    
    /** @type {number} - Timestamp of last render for UI throttling */
    #lastRender = 0;
    
    /** @type {Object.<string, HTMLElement>} - Cached DOM element references */
    #elements = {};

    constructor() {
      document.addEventListener('DOMContentLoaded', () => this.init());
      window.addEventListener('unload', () => this.cleanup());
    }

    /**
     * Main initialization method - sets up all popup functionality.
     * @returns {Promise<void>}
     */
    async init() {
      this.#cacheElements();
      this.#localize();
      this.#setupThemeWatcher();
      this.#bindUIEvents();
      this.#listenBackground();
      await this.#identifyTab();
      await this.#loadConfig();
      this.#requestCurrentDB();
    }

    /**
     * Caches references to frequently accessed DOM elements for performance.
     * @private
     */
    #cacheElements() {
      const qs = sel => document.getElementById(sel);
      this.#elements = {
        averageDB: qs('averageDB'),
        meterFill: qs('meterFill'),
        limitSlider: qs('limitSlider'),
        limitValue: qs('limitValue'),
        toggleButton: qs('toggleButton'),
        captureButton: qs('captureButton'),
        toggleIcon: qs('toggleButton')?.querySelector('.material-icons'),
        toggleText: qs('toggleText'),
        darkModeStatus: qs('darkModeStatus'),
      };
    }

    /**
     * Localizes all UI elements using Chrome i18n API.
     * @private
     */
    #localize() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        el.textContent = chrome.i18n.getMessage(key) || el.textContent;
      });
      document.title = chrome.i18n.getMessage('extensionName');
    }

    /**
     * Sets up dark/light theme detection and applies theme changes.
     * @private
     */
    #setupThemeWatcher() {
      const apply = () => {
        const isDark = getComputedStyle(this.#elements.darkModeStatus).display === 'block';
        document.body.classList.toggle('dark', isDark);
      };
      apply();
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', apply);
    }

    /**
     * Binds event listeners to UI controls (slider, buttons).
     * @private
     */
    #bindUIEvents() {
      this.#elements.limitSlider.addEventListener('input', e => {
        this.#config.limitDB = +e.target.value;
        this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;
        this.#saveConfig();
      });
      this.#elements.toggleButton.addEventListener('click', () => {
        this.#config.enabled = !this.#config.enabled;
        this.#elements.toggleButton.classList.toggle('enabled', this.#config.enabled);
        this.#elements.toggleText.textContent = chrome.i18n.getMessage(
          this.#config.enabled ? 'disable' : 'enable'
        );
        this.#saveConfig();
      });
      this.#elements.captureButton.addEventListener('click', () => {
        this.#config.captureEnabled = !this.#config.captureEnabled;
        this.#elements.captureButton.classList.toggle('enabled', this.#config.captureEnabled);

        if (this.#config.captureEnabled) {
          this.#elements.captureButton.querySelector('.material-icons').textContent = 'mic';
          chrome.runtime.sendMessage({ type: 'startTabCapture', tabId: this.#tabId });
        } else {
          this.#elements.captureButton.querySelector('.material-icons').textContent = 'mic_off';
          chrome.runtime.sendMessage({ type: 'stopTabCapture', tabId: this.#tabId });
        }
        this.#saveConfig();
      });
    }


    /**
     * Listens for decibel updates from background script.
     * @private
     */
    #listenBackground() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'updateDB' && msg.tabId === this.#tabId) {
          this.#currentDB = (typeof msg.db === 'number') ? msg.db : this.#currentDB;
          this.#averageDB = (typeof msg.averageDB === 'number') ? msg.averageDB : this.#averageDB;
          this.#render();
        }
        sendResponse({ received: true });
        return true;
      });
    }

    /**
     * Identifies the current active tab and stores its ID.
     * @private
     * @returns {Promise<void>}
     * @throws {Error} If no active tab is found
     */
    async #identifyTab() {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs.length) throw new Error('No active tab');
      this.#tabId = tabs[0].id;
    }

    /**
     * Loads configuration from storage and initializes UI controls.
     * @private
     * @returns {Promise<void>}
     */
    async #loadConfig() {
      const data = await chrome.storage.local.get(this.#tabId.toString());
      const cfg = data[this.#tabId] || {};
      this.#config.enabled = !!cfg.enabled;
      this.#config.limitDB = Number.isFinite(cfg.limitDB) ? cfg.limitDB : this.#config.limitDB;
      // Initialize UI controls with loaded configuration
      this.#elements.limitSlider.value = this.#config.limitDB;
      this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;
      this.#elements.toggleButton.classList.toggle('enabled', this.#config.enabled);
      this.#elements.toggleText.textContent = chrome.i18n.getMessage(
        this.#config.enabled ? 'disable' : 'enable'
      );
      this.#elements.captureButton.classList.toggle('enabled', this.#config.captureEnabled);
      // Update mic icon based on capture state
      this.#elements.captureButton.querySelector('.material-icons').textContent =
        this.#config.captureEnabled ? 'mic' : 'mic_off';
    }

    /**
     * Saves current configuration to storage and notifies background script.
     * @private
     */
    #saveConfig() {
      chrome.storage.local.set({
        [this.#tabId]: {
          enabled: this.#config.enabled,
          limitDB: this.#config.limitDB,
          captureEnabled: this.#config.captureEnabled
        }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving config:', chrome.runtime.lastError);
        }
      });
      chrome.runtime.sendMessage({ type: 'setConfig', ...this.#config });
    }

    /**
     * Requests current decibel level from background script.
     * @private
     * @returns {Promise<void>}
     */
    async #requestCurrentDB() {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'getCurrentDB', tabId: this.#tabId },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });

        if (response) {
          this.#currentDB = typeof response.db === 'number' ? response.db : null;
          this.#averageDB = typeof response.averageDB === 'number' ? response.averageDB : null;
          this.#render();
        }
      } catch (error) {
        console.warn('Error requesting current decibel level:', error);
      }
    }

    /**
     * Renders the UI with current decibel values.
     * Throttled to approximately 60 FPS for performance.
     * Both number display and meter bar now use the same value for consistency.
     * @private
     */
    #render() {
      const now = performance.now();
      if (now - this.#lastRender < 16) return; // Throttle to ≈60 FPS
      this.#lastRender = now;

      // Use current DB for both display and meter (synchronized)
      const displayDB = this.#currentDB;

      // Update decibel display (using current value, not average)
      if (this.#elements.averageDB) {
        this.#elements.averageDB.textContent =
          (displayDB === null || !isFinite(displayDB)) ?
            '-∞ dBFS' :
            `${Math.round(displayDB * 10) / 10} dBFS`;
      }

      // Update visual meter bar (using same current value)
      if (this.#elements.meterFill) {
        if (typeof displayDB === 'number' && isFinite(displayDB)) {
          // Normalize to range [-60, 0] dBFS
          const normalizedDB = Math.max(-60, Math.min(0, displayDB));
          const pct = ((normalizedDB + 60) / 60) * 100;
          this.#elements.meterFill.style.width = `${pct}%`;

          // Apply color based on decibel level
          this.#elements.meterFill.style.backgroundColor =
            displayDB > -10 ? 'var(--danger-color)' :
              displayDB > this.#config.limitDB ? 'var(--success-color)' :
                'var(--primary-color)';
        } else {
          // No audio signal detected
          this.#elements.meterFill.style.width = '0%';
        }
      }
    }

    /**
     * Cleanup method called on popup unload.
     * @private
     */
    cleanup() {
      // No cleanup required - no persistent intervals
    }
  }

  new Popup();
})();
