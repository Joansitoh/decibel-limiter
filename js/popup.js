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
      captureEnabled: false,
      limiterStrength: 'normal',
      limiterFloor: 0.01,
      limiterRelease: 1.03
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
        settingsView: qs('settingsView'),
        closeSettings: qs('closeSettings'),
        presetSelector: qs('presetSelector'),
        floorSlider: qs('floorSlider'),
        floorValue: qs('floorValue'),
        releaseSlider: qs('releaseSlider'),
        releaseValue: qs('releaseValue'),
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
        this.#render();
      });

      // Mic toggle (inside main button) - toggles enhanced capture
      this.#elements.micToggle.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent main button click
        this.#config.captureEnabled = !this.#config.captureEnabled;

        this.#elements.micToggle.classList.toggle('enabled', this.#config.captureEnabled);
        this.#elements.micToggle.setAttribute('aria-pressed', String(!!this.#config.captureEnabled));

        const icon = this.#elements.micToggle.querySelector('.material-icons');
        icon.textContent = this.#config.captureEnabled ? 'mic' : 'mic_off';

        this.#saveConfig();
        this.#render();
      });

      // Enhanced mode info toggle
      this.#elements.infoButton?.addEventListener('click', () => {
        this.#elements.settingsView?.classList.add('visible');
      });

      this.#elements.closeInfo?.addEventListener('click', () => {
        this.#elements.enhancedInfo?.setAttribute('hidden', '');
      });

      this.#elements.closeSettings?.addEventListener('click', () => {
        this.#elements.settingsView?.classList.remove('visible');
      });

      this.#elements.presetSelector?.addEventListener('click', e => {
        const btn = e.target.closest('[data-preset]');
        if (!btn) return;
        const preset = btn.dataset.preset;
        if (preset !== 'custom') {
          this.#syncSlidersFromPreset(preset);
        }
        this.#config.limiterStrength = preset;
        this.#updatePresetButtons(preset);
        this.#saveLimiterConfig();
      });

      this.#elements.floorSlider?.addEventListener('input', e => {
        const val = +e.target.value / 1000;
        this.#config.limiterFloor = val;
        if (this.#elements.floorValue) this.#elements.floorValue.textContent = val.toFixed(3);
        this.#config.limiterStrength = 'custom';
        this.#updatePresetButtons('custom');
        this.#saveLimiterConfig();
      });

      this.#elements.releaseSlider?.addEventListener('input', e => {
        const val = +e.target.value / 1000;
        this.#config.limiterRelease = val;
        if (this.#elements.releaseValue) this.#elements.releaseValue.textContent = val.toFixed(3);
        this.#config.limiterStrength = 'custom';
        this.#updatePresetButtons('custom');
        this.#saveLimiterConfig();
      });

      // Reposition tooltips so they never overflow the popup bounds
      document.querySelectorAll('.info-icon').forEach(icon => {
        icon.addEventListener('mouseenter', () => {
          const tooltip = icon.querySelector('.tooltip');
          if (!tooltip) return;

          // Reset styles so CSS hover layout is applied before measuring
          tooltip.style.left = '50%';
          tooltip.style.right = 'auto';
          tooltip.style.transform = 'translateX(-50%)';

          // Force layout calc with tooltip effectively visible
          const savedVis = tooltip.style.visibility;
          tooltip.style.visibility = 'visible';
          tooltip.getBoundingClientRect();

          const tRect = tooltip.getBoundingClientRect();
          const pRect = document.body.getBoundingClientRect();
          const pad = 8;

          const desiredRight = pRect.right - pad;
          const desiredLeft = pRect.left + pad;

          if (tRect.right > desiredRight) {
            const iconRect = icon.getBoundingClientRect();
            const newLeft = desiredRight - tRect.width - iconRect.left;
            tooltip.style.left = `${newLeft}px`;
            tooltip.style.transform = 'none';
          } else if (tRect.left < desiredLeft) {
            const iconRect = icon.getBoundingClientRect();
            const newLeft = desiredLeft - iconRect.left;
            tooltip.style.left = `${newLeft}px`;
            tooltip.style.transform = 'none';
          }

          tooltip.style.visibility = savedVis;
        });
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
      const cfg = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'getConfig', tabId: this.#tabId }, response => {
          resolve(response || {});
        });
      });

      this.#config.enabled = !!cfg.enabled;
      this.#config.limitDB = Number.isFinite(cfg.limitDB) ? cfg.limitDB : this.#config.limitDB;
      this.#config.captureEnabled = !!cfg.captureEnabled;
      this.#config.limiterStrength = ['soft', 'normal', 'strong', 'custom'].includes(cfg.limiterStrength) ? cfg.limiterStrength : 'normal';
      this.#config.limiterFloor = Number.isFinite(cfg.limiterFloor) ? cfg.limiterFloor : 0.01;
      this.#config.limiterRelease = Number.isFinite(cfg.limiterRelease) ? cfg.limiterRelease : 1.03;

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

      // Settings sync
      const isKnownPreset = ['soft', 'normal', 'strong'].includes(this.#config.limiterStrength);
      if (isKnownPreset) {
        this.#syncSlidersFromPreset(this.#config.limiterStrength);
      } else {
        if (this.#elements.floorSlider) {
          this.#elements.floorSlider.value = Math.round(this.#config.limiterFloor * 1000);
          if (this.#elements.floorValue) this.#elements.floorValue.textContent = this.#config.limiterFloor.toFixed(3);
        }
        if (this.#elements.releaseSlider) {
          this.#elements.releaseSlider.value = Math.round(this.#config.limiterRelease * 1000);
          if (this.#elements.releaseValue) this.#elements.releaseValue.textContent = this.#config.limiterRelease.toFixed(3);
        }
      }
      this.#updatePresetButtons(isKnownPreset ? this.#config.limiterStrength : 'custom');

      this.#render();
    }

    #saveConfig() {
      chrome.runtime.sendMessage({ type: 'setConfig', tabId: this.#tabId, ...this.#config });
    }

    #saveLimiterConfig() {
      const { enabled, limitDB, captureEnabled, limiterStrength, limiterFloor, limiterRelease } = this.#config;
      chrome.runtime.sendMessage({ type: 'setConfig', tabId: this.#tabId, enabled, limitDB, captureEnabled, limiterStrength, limiterFloor, limiterRelease });
    }

    #updatePresetButtons(activePreset) {
      this.#elements.presetSelector?.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === activePreset);
      });
    }

    #syncSlidersFromPreset(preset) {
      const presets = {
        soft: { floor: 0.05, release: 1.06 },
        normal: { floor: 0.01, release: 1.03 },
        strong: { floor: 0.003, release: 1.015 }
      };
      const p = presets[preset];
      if (!p) return;
      this.#config.limiterFloor = p.floor;
      this.#config.limiterRelease = p.release;
      if (this.#elements.floorSlider) {
        this.#elements.floorSlider.value = Math.round(p.floor * 1000);
        if (this.#elements.floorValue) this.#elements.floorValue.textContent = p.floor.toFixed(3);
      }
      if (this.#elements.releaseSlider) {
        this.#elements.releaseSlider.value = Math.round(p.release * 1000);
        if (this.#elements.releaseValue) this.#elements.releaseValue.textContent = p.release.toFixed(3);
      }
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

      const displayDB = (this.#config.enabled || this.#config.captureEnabled) ? this.#currentDB : null;

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

