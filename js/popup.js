/**
 * @file Popup UI controller for Decibel Limiter extension
 * @module Popup
 */

(() => {
  class Popup {
    #tabId = null;

    #config = {
      enabled: false,
      limitDB: -20,
      captureEnabled: false
    };

    #currentDB = null;
    #averageDB = null;
    #lastRender = 0;
    #elements = {};

    constructor() {
      document.addEventListener('DOMContentLoaded', () => this.init());
      window.addEventListener('unload', () => this.cleanup());
    }

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

    #cacheElements() {
      const qs = id => document.getElementById(id);

      this.#elements = {
        averageDB: qs('averageDB'),
        meterFill: qs('meterFill'),
        limitSlider: qs('limitSlider'),
        limitValue: qs('limitValue'),
        toggleButton: qs('toggleButton'),
        captureButton: qs('captureButton'),
        toggleText: qs('toggleText'),
      };
    }

    #localize() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        el.textContent = chrome.i18n.getMessage(key) || el.textContent;
      });
      document.title = chrome.i18n.getMessage('extensionName');
    }

    /**
     * Ensures body receives theme ('dark' class) based on system preference.
     */
    #setupThemeWatcher() {
      const apply = () => {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.toggle('dark', isDark);
      };

      apply();
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
    }

    #bindUIEvents() {
      // Slider
      this.#elements.limitSlider.addEventListener('input', e => {
        this.#config.limitDB = +e.target.value;
        this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;
        this.#saveConfig();
      });

      // Enable/disable limiter
      this.#elements.toggleButton.addEventListener('click', () => {
        this.#config.enabled = !this.#config.enabled;
        this.#elements.toggleButton.classList.toggle('enabled', this.#config.enabled);
        this.#elements.toggleText.textContent = chrome.i18n.getMessage(
          this.#config.enabled ? 'disable' : 'enable'
        );
        this.#saveConfig();
      });

      // Capture mode (mic icon)
      this.#elements.captureButton.addEventListener('click', () => {
        this.#config.captureEnabled = !this.#config.captureEnabled;

        this.#elements.captureButton.classList.toggle('enabled', this.#config.captureEnabled);

        const icon = this.#elements.captureButton.querySelector('.material-icons');
        icon.textContent = this.#config.captureEnabled ? 'mic' : 'mic_off';

        chrome.runtime.sendMessage({
          type: this.#config.captureEnabled ? 'startTabCapture' : 'stopTabCapture',
          tabId: this.#tabId
        });

        this.#saveConfig();
      });
    }

    #listenBackground() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'updateDB' && msg.tabId === this.#tabId) {
          if (typeof msg.db === 'number') this.#currentDB = msg.db;
          if (typeof msg.averageDB === 'number') this.#averageDB = msg.averageDB;
          this.#render();
        }
        sendResponse({ received: true });
        return true;
      });
    }

    async #identifyTab() {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs.length) throw new Error('No active tab found');
      this.#tabId = tabs[0].id;
    }

    async #loadConfig() {
      const data = await chrome.storage.local.get(this.#tabId.toString());
      const cfg = data[this.#tabId] || {};

      this.#config.enabled = !!cfg.enabled;
      this.#config.limitDB = Number.isFinite(cfg.limitDB) ? cfg.limitDB : this.#config.limitDB;
      this.#config.captureEnabled = !!cfg.captureEnabled;

      // UI updates
      this.#elements.limitSlider.value = this.#config.limitDB;
      this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;

      this.#elements.toggleButton.classList.toggle('enabled', this.#config.enabled);
      this.#elements.toggleText.textContent = chrome.i18n.getMessage(
        this.#config.enabled ? 'disable' : 'enable'
      );

      this.#elements.captureButton.classList.toggle('enabled', this.#config.captureEnabled);
      this.#elements.captureButton.querySelector('.material-icons').textContent =
        this.#config.captureEnabled ? 'mic' : 'mic_off';
    }

    #saveConfig() {
      chrome.storage.local.set({
        [this.#tabId]: {
          enabled: this.#config.enabled,
          limitDB: this.#config.limitDB,
          captureEnabled: this.#config.captureEnabled
        }
      });

      chrome.runtime.sendMessage({ type: 'setConfig', ...this.#config });
    }

    async #requestCurrentDB() {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'getCurrentDB', tabId: this.#tabId },
            (response) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(response);
            }
          );
        });

        if (response) {
          this.#currentDB = typeof response.db === 'number' ? response.db : null;
          this.#averageDB = typeof response.averageDB === 'number' ? response.averageDB : null;
        }

        this.#render();
      } catch (err) {
        console.warn('Error requesting current DB:', err);
      }
    }

    #render() {
      const now = performance.now();
      if (now - this.#lastRender < 16) return;
      this.#lastRender = now;

      const displayDB = this.#currentDB;

      if (this.#elements.averageDB) {
        this.#elements.averageDB.textContent =
          (displayDB === null || !isFinite(displayDB))
            ? '-∞ dBFS'
            : `${Math.round(displayDB * 10) / 10} dBFS`;
      }

      if (this.#elements.meterFill) {
        if (typeof displayDB === 'number' && isFinite(displayDB)) {
          const normalizedDB = Math.max(-60, Math.min(0, displayDB));
          const pct = ((normalizedDB + 60) / 60) * 100;

          this.#elements.meterFill.style.width = `${pct}%`;

          this.#elements.meterFill.style.backgroundColor =
            displayDB > -10 ? 'var(--danger-color)' :
            displayDB > this.#config.limitDB ? 'var(--success-color)' :
            'var(--primary-color)';
        } else {
          this.#elements.meterFill.style.width = '0%';
        }
      }
    }

    cleanup() {
    }
  }

  new Popup();
})();
