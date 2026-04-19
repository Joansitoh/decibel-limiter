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
      const q = sel => document.querySelector(sel);

      this.#elements = {
        averageDB: qs('averageDB'),
        meterFill: qs('meterFill'),
        limitSlider: qs('limitSlider'),
        limitValue: qs('limitValue'),
        mainToggle: qs('mainToggle'),
        micToggle: qs('micToggle'),
        toggleText: qs('toggleText'),
        infoButton: qs('infoButton'),
        enhancedInfo: qs('enhancedInfo'),
        closeInfo: qs('closeInfo'),
        headerIconWrap: q('.header-icon-wrap'),
      };
    }

    #localize() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        el.textContent = chrome.i18n.getMessage(key) || el.textContent;
      });

      // Attributes: title and aria-label via data-i18n-title / data-i18n-aria
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.dataset.i18nTitle;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.title = msg;
      });

      document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.dataset.i18nAria;
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.setAttribute('aria-label', msg);
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

      // Enable/disable limiter (main button)
      this.#elements.mainToggle.addEventListener('click', (e) => {
        // If the mic toggle was clicked, ignore (mic has its own handler)
        if (e.target.closest && e.target.closest('.mic-toggle')) return;

        this.#config.enabled = !this.#config.enabled;
        this.#elements.mainToggle.classList.toggle('enabled', this.#config.enabled);
        this.#elements.toggleText.textContent = chrome.i18n.getMessage(
          this.#config.enabled ? 'disable' : 'enable'
        );
        this.#elements.headerIconWrap?.classList.toggle('active', this.#config.enabled);
        this.#saveConfig();
      });

      // Mic toggle (inside main button) - toggles enhanced capture
      this.#elements.micToggle.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent main button click
        this.#config.captureEnabled = !this.#config.captureEnabled;

        this.#elements.micToggle.classList.toggle('enabled', this.#config.captureEnabled);
        this.#elements.micToggle.setAttribute('aria-pressed', String(!!this.#config.captureEnabled));

        const icon = this.#elements.micToggle.querySelector('.material-icons');
        icon.textContent = this.#config.captureEnabled ? 'mic' : 'mic_off';

        chrome.runtime.sendMessage({
          type: this.#config.captureEnabled ? 'startTabCapture' : 'stopTabCapture',
          tabId: this.#tabId
        });

        this.#saveConfig();
      });

      // Enhanced mode info toggle
      this.#elements.infoButton?.addEventListener('click', () => {
        const info = this.#elements.enhancedInfo;
        if (!info) return;
        const isHidden = info.hasAttribute('hidden');
        if (isHidden) info.removeAttribute('hidden');
        else info.setAttribute('hidden', '');
      });

      this.#elements.closeInfo?.addEventListener('click', () => {
        this.#elements.enhancedInfo?.setAttribute('hidden', '');
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

      this.#elements.mainToggle.classList.toggle('enabled', this.#config.enabled);
      this.#elements.toggleText.textContent = chrome.i18n.getMessage(
        this.#config.enabled ? 'disable' : 'enable'
      );
      this.#elements.headerIconWrap?.classList.toggle('active', this.#config.enabled);

      this.#elements.micToggle.classList.toggle('enabled', this.#config.captureEnabled);
      const micIcon = this.#elements.micToggle.querySelector('.material-icons');
      if (micIcon) micIcon.textContent = this.#config.captureEnabled ? 'mic' : 'mic_off';
      this.#elements.micToggle?.setAttribute('aria-pressed', String(!!this.#config.captureEnabled));
    }

    #saveConfig() {
      chrome.storage.local.set({
        [this.#tabId]: {
          enabled: this.#config.enabled,
          limitDB: this.#config.limitDB,
          captureEnabled: this.#config.captureEnabled
        }
      });

      // Include the tabId so the background service worker knows which tab this applies to
      chrome.runtime.sendMessage({ type: 'setConfig', tabId: this.#tabId, ...this.#config });
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

          // Color logic:
          // - danger when above a hard threshold (very loud)
          // - warn when above the configured limit (approaching/exceeding limit)
          // - normal primary otherwise
          const warnStart = this.#config.limitDB - 6; // 6 dB window before limit

          if (displayDB > -10) {
            // Very loud: red gradient
            this.#elements.meterFill.style.background =
              'linear-gradient(90deg, var(--danger-color), #ff6b6b)';
          } else if (displayDB > this.#config.limitDB) {
            // Above limit: warn -> red gradient
            this.#elements.meterFill.style.background =
              'linear-gradient(90deg, var(--warn-color), var(--danger-color))';
          } else if (displayDB > warnStart) {
            // Approaching limit: subtle warn (primary -> warn)
            this.#elements.meterFill.style.background =
              'linear-gradient(90deg, var(--primary), var(--warn-color))';
          } else {
            // Normal: primary gradient
            this.#elements.meterFill.style.background =
              'linear-gradient(90deg, var(--primary), var(--primary-light))';
          }
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

