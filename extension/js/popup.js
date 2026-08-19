/**
 * @file Popup UI controller for Decibel Limiter extension
 * @module Popup
 */

(() => {
  // Bump this string when shipping a change worth telling existing users about
  // (shown once as a 2-step coachmark, then never again for that version).
  // Must match WHATS_NEW_VERSION in background.js, which marks fresh installs
  // as already-seen so new users never get the tour.
  const WHATS_NEW_VERSION = 'presets-2026-08';
  const WHATS_NEW_STORAGE_KEY = 'seenWhatsNew';

  const COACHMARK_STEPS = [
    { targetId: 'presetSelector', textKey: 'coachmarkPresets' },
    { targetId: 'globalToggle', textKey: 'coachmarkGlobalToggle' }
  ];

  // release is expressed in dB/sec (how fast gain recovers once no longer needed)
  const STRENGTH_PRESETS = {
    soft: { floor: 0.05, release: 15 },
    normal: { floor: 0.01, release: 8 },
    strong: { floor: 0.003, release: 4 }
  };

  class Popup {
    #tabId = null;

    #config = {
      enabled: false,
      limitDB: -20,
      captureEnabled: false,
      limiterStrength: 'normal',
      limiterFloor: 0.01,
      limiterRelease: 8,
      global: false
    };

    #currentDB = null;
    #averageDB = null;
    #currentGainDB = null;
    #lastRender = 0;
    #meterAnimId = null;
    /** @type {number|null} - Smoothed level actually shown on the meter (fast rise, slow fall) */
    #displayedDB = null;
    #elements = {};
    #coachmarkStepIndex = 0;

    constructor() {
      document.addEventListener('DOMContentLoaded', () => this.init());
      window.addEventListener('unload', () => this.cleanup());
    }

    async init() {
      this.#cacheElements();
      this.#localize();
      this.#bindUIEvents();
      this.#listenBackground();
      await this.#identifyTab();
      await this.#loadConfig();
      this.#requestCurrentDB();
      this.#startMeterLoop();
      this.#checkWhatsNew();
    }

    #cacheElements() {
      const qs = id => document.getElementById(id);
      const q = sel => document.querySelector(sel);

      this.#elements = {
        averageDB: qs('averageDB'),
        gainReadout: qs('gainReadout'),
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
        coachmark: qs('coachmark'),
        coachmarkStep: qs('coachmarkStep'),
        coachmarkText: qs('coachmarkText'),
        coachmarkNext: qs('coachmarkNext'),
        presetSelector: qs('presetSelector'),
        floorSlider: qs('floorSlider'),
        floorValue: qs('floorValue'),
        releaseSlider: qs('releaseSlider'),
        releaseValue: qs('releaseValue'),
        globalToggle: qs('globalToggle'),
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

    #bindUIEvents() {
      // Slider
      this.#elements.limitSlider.addEventListener('input', e => {
        this.#config.limitDB = +e.target.value;
        this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;
        this.#saveConfig();
      });

      // Enable/disable limiter (main button)
      this.#elements.mainToggle.addEventListener('click', (e) => {
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

        this.#saveConfig();
      });

      // Enhanced mode info toggle
      this.#elements.infoButton?.addEventListener('click', () => {
        this.#elements.settingsView?.classList.add('visible');
      });

      this.#elements.closeInfo?.addEventListener('click', () => {
        this.#elements.enhancedInfo?.setAttribute('hidden', '');
      });

      this.#elements.coachmarkNext?.addEventListener('click', () => this.#advanceCoachmark());
      window.addEventListener('resize', () => this.#positionCoachmark());

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
        this.#saveConfig();
      });

      this.#elements.floorSlider?.addEventListener('input', e => {
        const val = +e.target.value / 1000;
        this.#config.limiterFloor = val;
        if (this.#elements.floorValue) this.#elements.floorValue.textContent = val.toFixed(3);
        this.#config.limiterStrength = 'custom';
        this.#updatePresetButtons('custom');
        this.#saveConfig();
      });

      this.#elements.releaseSlider?.addEventListener('input', e => {
        const val = +e.target.value;
        this.#config.limiterRelease = val;
        if (this.#elements.releaseValue) this.#elements.releaseValue.textContent = `${val} dB/s`;
        this.#config.limiterStrength = 'custom';
        this.#updatePresetButtons('custom');
        this.#saveConfig();
      });

      // "Apply to all sites": persists globally and pushes to every open tab
      this.#elements.globalToggle?.addEventListener('click', () => {
        this.#config.global = !this.#config.global;
        this.#applyGlobalToggleUI();
        this.#saveConfig();
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
          // Just update the raw data — the rAF meter loop repaints continuously.
          if (typeof msg.db === 'number') this.#currentDB = msg.db;
          if (typeof msg.averageDB === 'number') this.#averageDB = msg.averageDB;
          if (typeof msg.gainDB === 'number') this.#currentGainDB = msg.gainDB;
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
      const cfg = await this.#readStoredConfig();

      this.#config.enabled = !!cfg.enabled;
      this.#config.limitDB = Number.isFinite(cfg.limitDB) ? cfg.limitDB : this.#config.limitDB;
      this.#config.captureEnabled = !!cfg.captureEnabled;
      this.#config.limiterStrength = ['soft', 'normal', 'strong', 'custom'].includes(cfg.limiterStrength) ? cfg.limiterStrength : 'normal';
      this.#config.limiterFloor = Number.isFinite(cfg.limiterFloor) ? cfg.limiterFloor : 0.01;
      this.#config.limiterRelease = Number.isFinite(cfg.limiterRelease) ? cfg.limiterRelease : 8;
      this.#config.global = !!cfg.global;

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
          this.#elements.releaseSlider.value = this.#config.limiterRelease;
          if (this.#elements.releaseValue) this.#elements.releaseValue.textContent = `${this.#config.limiterRelease} dB/s`;
        }
      }
      this.#updatePresetButtons(isKnownPreset ? this.#config.limiterStrength : 'custom');
      this.#applyGlobalToggleUI();
    }

    async #checkWhatsNew() {
      const data = await chrome.storage.local.get(WHATS_NEW_STORAGE_KEY);
      if (data[WHATS_NEW_STORAGE_KEY] === WHATS_NEW_VERSION) return;

      this.#elements.settingsView?.classList.add('visible');
      this.#coachmarkStepIndex = -1; // -1 = intro splash, before step 0
      this.#showCoachmarkStep();
    }

    #showCoachmarkStep() {
      // Re-trigger the CSS pop animation even though the tooltip element is reused
      const tooltip = this.#elements.coachmark?.querySelector('.coachmark-tooltip');
      if (tooltip) {
        tooltip.classList.remove('coachmark-tooltip-anim');
        void tooltip.offsetWidth; // force reflow so the class re-add restarts the animation
        tooltip.classList.add('coachmark-tooltip-anim');
      }

      if (this.#coachmarkStepIndex === -1) {
        this.#elements.coachmark?.classList.add('coachmark-intro');
        if (this.#elements.coachmarkStep) this.#elements.coachmarkStep.textContent = '';
        if (this.#elements.coachmarkText) this.#elements.coachmarkText.textContent = chrome.i18n.getMessage('coachmarkIntro');
        if (this.#elements.coachmarkNext) this.#elements.coachmarkNext.textContent = chrome.i18n.getMessage('coachmarkStart');
        this.#elements.coachmark?.querySelector('.coachmark-hole')?.remove();
        this.#elements.coachmark?.removeAttribute('hidden');
        return;
      }

      this.#elements.coachmark?.classList.remove('coachmark-intro');

      const step = COACHMARK_STEPS[this.#coachmarkStepIndex];
      if (!step) {
        this.#elements.coachmark?.setAttribute('hidden', '');
        chrome.storage.local.set({ [WHATS_NEW_STORAGE_KEY]: WHATS_NEW_VERSION });
        return;
      }

      const isLast = this.#coachmarkStepIndex === COACHMARK_STEPS.length - 1;
      if (this.#elements.coachmarkStep) {
        this.#elements.coachmarkStep.textContent = `${this.#coachmarkStepIndex + 1}/${COACHMARK_STEPS.length}`;
      }
      if (this.#elements.coachmarkText) {
        this.#elements.coachmarkText.textContent = chrome.i18n.getMessage(step.textKey);
      }
      if (this.#elements.coachmarkNext) {
        this.#elements.coachmarkNext.textContent = chrome.i18n.getMessage(isLast ? 'coachmarkDone' : 'coachmarkNext');
      }

      this.#elements.coachmark?.removeAttribute('hidden');
      this.#positionCoachmark();
    }

    #advanceCoachmark() {
      this.#coachmarkStepIndex += 1;
      this.#showCoachmarkStep();
    }

    #positionCoachmark() {
      if (this.#elements.coachmark?.hasAttribute('hidden')) return;
      const step = COACHMARK_STEPS[this.#coachmarkStepIndex];
      const target = step && document.getElementById(step.targetId);
      const tooltip = this.#elements.coachmark?.querySelector('.coachmark-tooltip');
      if (!target || !tooltip) return;

      target.scrollIntoView({ block: 'center' });

      const rect = target.getBoundingClientRect();
      const pad = 6;

      // Spotlight: a positioned box whose giant box-shadow dims everything
      // except its own rounded rect, placed over the target's real coords.
      let hole = this.#elements.coachmark.querySelector('.coachmark-hole');
      if (!hole) {
        hole = document.createElement('div');
        hole.className = 'coachmark-hole';
        this.#elements.coachmark.prepend(hole);
      }
      hole.style.top = `${rect.top - pad}px`;
      hole.style.left = `${rect.left - pad}px`;
      hole.style.width = `${rect.width + pad * 2}px`;
      hole.style.height = `${rect.height + pad * 2}px`;

      // Tooltip below the target by default, flipped above if it would overflow
      const bodyRect = document.body.getBoundingClientRect();
      const tooltipHeight = tooltip.offsetHeight || 90;
      const spaceBelow = bodyRect.bottom - rect.bottom;
      const top = spaceBelow > tooltipHeight + 16
        ? rect.bottom + 10
        : rect.top - tooltipHeight - 10;

      const left = Math.min(
        Math.max(rect.left, 12),
        bodyRect.width - tooltip.offsetWidth - 12
      );

      tooltip.style.top = `${Math.max(top, 12)}px`;
      tooltip.style.left = `${left}px`;
    }

    /**
     * Reads the effective config straight from storage rather than asking the
     * service worker: in MV3 the worker is asleep most of the time, and a
     * round-trip through it is not guaranteed to complete before the popup is
     * torn down.
     */
    async #readStoredConfig() {
      const tabKey = `tab_cfg_${this.#tabId}`;
      const data = await chrome.storage.local.get([tabKey, 'global_config']);
      const globalCfg = data.global_config;
      const perTab = data[tabKey] ?? {};

      if (globalCfg?.global) {
        return { ...globalCfg, captureEnabled: perTab.captureEnabled ?? false };
      }
      return perTab;
    }

    /**
     * Persists to storage first (survives the popup closing immediately after a
     * click), then notifies the background worker so it can apply side effects:
     * badge, content script push, and starting/stopping tab capture.
     */
    #saveConfig() {
      const cfg = { ...this.#config };
      const tabKey = `tab_cfg_${this.#tabId}`;

      const writes = { [tabKey]: cfg };
      if (cfg.global) {
        const { captureEnabled, ...globalCfg } = cfg;
        writes.global_config = globalCfg;
      }

      chrome.storage.local.set(writes);
      if (!cfg.global) chrome.storage.local.remove('global_config');

      chrome.runtime.sendMessage({ type: 'setConfig', tabId: this.#tabId, ...cfg });
    }

    #applyGlobalToggleUI() {
      this.#elements.globalToggle?.classList.toggle('active', this.#config.global);
      this.#elements.globalToggle?.setAttribute('aria-checked', String(!!this.#config.global));
    }

    #updatePresetButtons(activePreset) {
      this.#elements.presetSelector?.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === activePreset);
      });
    }

    #syncSlidersFromPreset(preset) {
      const p = STRENGTH_PRESETS[preset];
      if (!p) return;
      this.#config.limiterFloor = p.floor;
      this.#config.limiterRelease = p.release;
      if (this.#elements.floorSlider) {
        this.#elements.floorSlider.value = Math.round(p.floor * 1000);
        if (this.#elements.floorValue) this.#elements.floorValue.textContent = p.floor.toFixed(3);
      }
      if (this.#elements.releaseSlider) {
        this.#elements.releaseSlider.value = p.release;
        if (this.#elements.releaseValue) this.#elements.releaseValue.textContent = `${p.release} dB/s`;
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
      } catch (err) {
        console.warn('Error requesting current DB:', err);
      }
    }

    /**
     * Runs the level meter with requestAnimationFrame so it repaints at the
     * display's refresh rate (~60Hz) even though audio data only arrives a
     * few dozen times per second. The displayed level uses a fast-attack /
     * slow-release envelope: it jumps up instantly on peaks and falls
     * smoothly, like the meter on a mixing desk, instead of freezing between
     * message updates.
     * @private
     */
    #startMeterLoop() {
      const step = (now) => {
        this.#meterAnimId = requestAnimationFrame(step);

        const isActive = this.#config.enabled || this.#config.captureEnabled;
        const raw = isActive ? this.#currentDB : null;

        let target = (raw === null || !isFinite(raw)) ? null : raw;
        if (target === null) {
          this.#displayedDB = null;
        } else if (this.#displayedDB === null || !isFinite(this.#displayedDB)) {
          this.#displayedDB = target;
        } else if (target > this.#displayedDB) {
          this.#displayedDB = target; // fast attack: peaks show instantly
        } else {
          // slow release: fall ~45dB/s towards silence
          const dt = now - (this.#lastRender || now);
          this.#displayedDB = Math.max(target, this.#displayedDB - (dt / 1000) * 45);
        }
        this.#lastRender = now;

        this.#render(this.#displayedDB, isActive);
      };
      this.#meterAnimId = requestAnimationFrame(step);
    }

    /**
     * Paints the UI from the already-smoothed level.
     * @param {number|null} displayDB - Smoothed dB to show, or null when inactive
     * @param {boolean} isActive
     */
    #render(displayDB, isActive) {
      if (this.#elements.averageDB) {
        this.#elements.averageDB.textContent =
          (displayDB === null || !isFinite(displayDB))
            ? '-∞ dBFS'
            : `${Math.round(displayDB * 10) / 10} dBFS`;
      }

      if (this.#elements.gainReadout) {
        if (isActive && this.#config.enabled && typeof this.#currentGainDB === 'number' && isFinite(this.#currentGainDB)) {
          const sign = this.#currentGainDB >= 0 ? '+' : '';
          this.#elements.gainReadout.textContent = `${chrome.i18n.getMessage('gainLabel')}: ${sign}${this.#currentGainDB.toFixed(1)} dB`;
          this.#elements.gainReadout.hidden = false;
        } else {
          this.#elements.gainReadout.hidden = true;
        }
      }

      if (this.#elements.meterFill) {
        if (typeof displayDB === 'number' && isFinite(displayDB)) {
          const normalizedDB = Math.max(-60, Math.min(0, displayDB));
          const pct = ((normalizedDB + 60) / 60) * 100;

          this.#elements.meterFill.style.width = `${pct}%`;

          // Color logic:
          // - danger when above a hard threshold (very loud)
          // - warn when above the configured limit (approaching/exceeding limit)
          // - normal otherwise
          const warnStart = this.#config.limitDB - 6; // 6 dB window before limit

          if (displayDB > -10) {
            this.#elements.meterFill.style.background = 'linear-gradient(90deg, var(--danger-color), #ff6b6b)';
          } else if (displayDB > this.#config.limitDB) {
            this.#elements.meterFill.style.background = 'linear-gradient(90deg, var(--warn-color), var(--danger-color))';
          } else if (displayDB > warnStart) {
            this.#elements.meterFill.style.background = 'linear-gradient(90deg, var(--primary), var(--warn-color))';
          } else {
            this.#elements.meterFill.style.background = 'linear-gradient(90deg, var(--primary), var(--primary-light))';
          }
        } else {
          this.#elements.meterFill.style.width = '0%';
        }
      }
    }

    cleanup() {
      if (this.#meterAnimId) cancelAnimationFrame(this.#meterAnimId);
    }
  }

  new Popup();
})();
