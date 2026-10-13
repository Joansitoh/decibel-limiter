/**
 * Popup app orchestrator — wires events; UI/config live in sibling modules.
 */
import './theme.js';
import {
  THEME_KEY,
  applyTheme,
  clampDB,
  METER_MIN_DB,
  METER_MAX_DB,
  WHATS_NEW_VERSION,
  WHATS_NEW_STORAGE_KEY,
  cacheElements,
  localize,
  playIntro,
  punch,
  setPathHelpOpen,
  setSettingsOpen,
  buildScale,
  paintScenarioLimits,
  paintCeiling,
  applyCeilingHint,
  applyEnableUI,
  applyPathUI,
  applyDomainChip,
  applyStatusLine,
  applyGlobalToggleUI,
  applyLevelingUI,
  updateThemeButtons,
  updatePresetButtons,
  updateScenarioButtons,
  updatePathSelector,
  syncSlidersFromPreset,
  syncAllUI,
  bindTooltips,
  bindFadeScrollbars,
  showCoachmarkStep,
  positionCoachmark,
  renderMeter,
  setGainVisible,
  gsapRef,
  motionOk
} from './ui.js';
import {
  identifyActiveTab,
  readStoredConfig,
  persistConfig,
  requestCurrentDB
} from './config.js';

const {
  applyScenario,
  migrateConfig,
  wantsCapture
} = self.DLPresets;

class Popup {
  constructor() {
    this.tabId = null;
    this.host = null;
    this.domainSaved = false;
    this.captureActive = false;
    this.config = migrateConfig({});
    this.currentDB = null;
    this.averageDB = null;
    this.currentGainDB = null;
    this.lastRender = 0;
    this.meterAnimId = null;
    this.displayedDB = null;
    this.dragging = false;
    this.elements = {};
    this.coachmarkStepIndex = 0;
    this.gainVisible = { value: false };

    document.addEventListener('DOMContentLoaded', () => this.init());
    window.addEventListener('unload', () => this.cleanup());
  }

  async init() {
    this.elements = cacheElements();
    localize(this.elements);
    buildScale(this.elements);
    paintScenarioLimits();
    updateThemeButtons(this.elements);
    this.bindUIEvents();
    this.bindFader();
    this.listenBackground();
    await this.identifyTab();
    await this.loadConfig();
    this.requestDB();
    this.startMeterLoop();
    playIntro(this.elements);
    this.checkWhatsNew();
    this.maybeShowReview();
  }

  uiCtx() {
    return {
      elements: this.elements,
      config: this.config,
      host: this.host,
      domainSaved: this.domainSaved,
      captureActive: this.captureActive
    };
  }

  statusArgs() {
    return {
      enabled: this.config.enabled,
      levelingEnabled: this.config.levelingEnabled,
      wantsHq: wantsCapture(this.config),
      captureActive: this.captureActive
    };
  }

  refreshUI(animateStatus = false) {
    syncAllUI(this.uiCtx());
    if (animateStatus) applyStatusLine(this.elements, this.statusArgs(), true);
  }

  async identifyTab() {
    const { tabId, host } = await identifyActiveTab();
    this.tabId = tabId;
    this.host = host;
    applyDomainChip(this.elements, {
      host: this.host,
      domainSaved: this.domainSaved,
      global: this.config.global
    });
  }

  async loadConfig() {
    const cfg = await readStoredConfig(this.tabId);
    this.config = migrateConfig(cfg);
    this.host = cfg.host || this.host || null;
    this.domainSaved = !!cfg.domainSaved;
    this.captureActive = !!cfg.captureActive;
    this.refreshUI();
    if (cfg.captureError && this.elements.captureError) {
      this.elements.captureError.hidden = false;
      this.elements.captureError.textContent = chrome.i18n.getMessage('captureFallback') || cfg.captureError;
    }
  }

  async saveConfig() {
    this.config = migrateConfig(this.config);
    const resp = await persistConfig(this.tabId, this.config, this.host);
    if (!resp) return;
    this.host = resp.host || this.host;
    this.domainSaved = !!resp.domainSaved;
    this.captureActive = !!resp.captureActive;
    applyDomainChip(this.elements, {
      host: this.host,
      domainSaved: this.domainSaved,
      global: this.config.global
    });
    applyStatusLine(this.elements, this.statusArgs(), true);
    if (resp.audioPath && resp.audioPath !== this.config.audioPath) {
      this.config.audioPath = resp.audioPath;
      this.config.captureEnabled = !!resp.captureEnabled;
      updatePathSelector(this.elements, this.config.audioPath);
    }
    applyPathUI(this.elements, this.config, this.captureActive);
  }

  setLimit(db) {
    const next = Math.round(clampDB(db));
    if (next === this.config.limitDB) return;
    this.config.limitDB = next;
    this.config.scenario = 'custom';
    paintCeiling(this.elements, this.config.limitDB);
    updateScenarioButtons(this.elements, 'custom');
    this.saveConfig();
  }

  toggleLeveling() {
    this.config.levelingEnabled = !this.config.levelingEnabled;
    this.config.scenario = 'custom';
    applyLevelingUI(this.elements, this.config.levelingEnabled);
    applyCeilingHint(this.elements, this.config.levelingEnabled);
    applyStatusLine(this.elements, this.statusArgs(), true);
    updateScenarioButtons(this.elements, 'custom');
    this.saveConfig();
  }

  bindFader() {
    const { fader, meterTube, limitHandle } = this.elements;
    if (!fader || !meterTube || !limitHandle) return;

    const setFromY = clientY => {
      const r = meterTube.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
      this.setLimit(METER_MIN_DB + frac * (METER_MAX_DB - METER_MIN_DB));
    };

    fader.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.dragging = true;
      fader.setPointerCapture(e.pointerId);
      limitHandle.focus({ preventScroll: true });
      setFromY(e.clientY);
      punch(this.elements.limitTab, this.elements.limitTab, 1.12);
      e.preventDefault();
    });
    fader.addEventListener('pointermove', e => {
      if (this.dragging) setFromY(e.clientY);
    });
    const end = e => {
      if (!this.dragging) return;
      this.dragging = false;
      try { fader.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    fader.addEventListener('pointerup', end);
    fader.addEventListener('pointercancel', end);

    limitHandle.addEventListener('keydown', e => {
      const cur = this.config.limitDB;
      const step = e.shiftKey ? 5 : 1;
      let next = null;
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight': next = cur + step; break;
        case 'ArrowDown':
        case 'ArrowLeft': next = cur - step; break;
        case 'PageUp': next = cur + 5; break;
        case 'PageDown': next = cur - 5; break;
        case 'Home': next = METER_MIN_DB; break;
        case 'End': next = METER_MAX_DB; break;
      }
      if (next === null) return;
      e.preventDefault();
      this.setLimit(next);
    });
  }

  bindUIEvents() {
    const el = this.elements;

    el.mainToggle.addEventListener('click', () => {
      this.config.enabled = !this.config.enabled;
      this.config.captureEnabled = wantsCapture(this.config);
      applyEnableUI(el, this.config.enabled, true);
      applyStatusLine(el, this.statusArgs(), true);
      this.saveConfig();
    });

    el.pathToggle.addEventListener('click', e => {
      e.stopPropagation();
      if (wantsCapture(this.config) && !this.captureActive) {
        // Tab wants HQ but another tab holds it. Clicking claims HQ for this tab!
        this.config.audioPath = 'capture';
      } else {
        const hq = wantsCapture(this.config);
        this.config.audioPath = hq ? 'element' : 'capture';
      }
      this.config.captureEnabled = wantsCapture(this.config);
      applyPathUI(el, this.config, this.captureActive);
      updatePathSelector(el, this.config.audioPath);
      applyStatusLine(el, this.statusArgs(), true);
      punch(el.pathToggle, el.limitTab);
      this.saveConfig();
    });

    el.infoButton?.addEventListener('click', () => setSettingsOpen(el, true));
    el.closeSettings?.addEventListener('click', () => setSettingsOpen(el, false));

    const closePathHelp = () => setPathHelpOpen(el, false);
    el.pathHelpBtn?.addEventListener('click', () => setPathHelpOpen(el, true));
    el.pathHelpClose?.addEventListener('click', closePathHelp);
    el.pathHelpGotIt?.addEventListener('click', closePathHelp);
    el.pathHelpScrim?.addEventListener('click', closePathHelp);

    el.coachmarkNext?.addEventListener('click', () => this.advanceCoachmark());
    window.addEventListener('resize', () => positionCoachmark(el, this.coachmarkStepIndex));

    el.scenarioSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-scenario]');
      if (!btn) return;
      const scen = applyScenario(btn.dataset.scenario);
      const enabled = this.config.enabled;
      const global = this.config.global;
      this.config = migrateConfig({ ...scen, enabled, global });
      this.refreshUI();
      punch(btn, el.limitTab, 1.03);
      const g = gsapRef();
      if (g && motionOk() && el.limitTab) {
        g.fromTo(el.limitTab, { autoAlpha: 0.55 }, { autoAlpha: 1, duration: 0.25, ease: 'power2.out' });
      }
      this.saveConfig();
    });

    el.themeSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-theme-choice]');
      if (!btn) return;
      const choice = btn.dataset.themeChoice;
      try { localStorage.setItem(THEME_KEY, choice); } catch (_) { /* ignore */ }
      applyTheme(choice);
      updateThemeButtons(el);
    });

    el.pathSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-path]');
      if (!btn) return;
      this.config.audioPath = btn.dataset.path;
      this.config.captureEnabled = wantsCapture(this.config);
      this.config.scenario = 'custom';
      updatePathSelector(el, this.config.audioPath);
      applyPathUI(el, this.config, this.captureActive);
      updateScenarioButtons(el, 'custom');
      this.saveConfig();
    });

    el.presetSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      const preset = btn.dataset.preset;
      if (preset !== 'custom') syncSlidersFromPreset(el, this.config, preset);
      this.config.limiterStrength = preset;
      this.config.scenario = 'custom';
      updatePresetButtons(el, preset);
      updateScenarioButtons(el, 'custom');
      this.saveConfig();
    });

    el.floorSlider?.addEventListener('input', e => {
      const val = +e.target.value / 1000;
      this.config.limiterFloor = val;
      if (el.floorValue) el.floorValue.textContent = val.toFixed(3);
      this.config.limiterStrength = 'custom';
      this.config.scenario = 'custom';
      updatePresetButtons(el, 'custom');
      updateScenarioButtons(el, 'custom');
      this.saveConfig();
    });

    el.releaseSlider?.addEventListener('input', e => {
      const val = +e.target.value;
      this.config.limiterRelease = val;
      if (el.releaseValue) el.releaseValue.textContent = `${val} dB/s`;
      this.config.limiterStrength = 'custom';
      this.config.scenario = 'custom';
      updatePresetButtons(el, 'custom');
      updateScenarioButtons(el, 'custom');
      this.saveConfig();
    });

    el.globalToggle?.addEventListener('click', () => {
      this.config.global = !this.config.global;
      applyGlobalToggleUI(el, this.config.global);
      applyDomainChip(el, {
        host: this.host,
        domainSaved: this.domainSaved,
        global: this.config.global
      });
      this.saveConfig();
    });

    [el.evenVolumeToggle, el.levelingToggle].filter(Boolean).forEach(btn => {
      btn.addEventListener('click', () => this.toggleLeveling());
    });

    el.forgetDomain?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'forgetDomain', tabId: this.tabId, host: this.host });
      await this.loadConfig();
    });

    const flashBtn = (btn, ok, detail) => {
      if (!btn) return;
      const prev = btn.dataset.labelPrev || btn.textContent;
      btn.dataset.labelPrev = prev;
      btn.title = detail || '';
      btn.textContent = ok ? '✓' : '!';
      btn.disabled = !!ok;
      setTimeout(() => {
        btn.textContent = prev;
        btn.disabled = false;
      }, 1400);
    };

    el.exportBtn?.addEventListener('click', async () => {
      const btn = el.exportBtn;
      try {
        // Popup can read storage directly — no dependency on the service worker.
        const data = await chrome.storage.local.get(['global_config', 'domain_configs']);
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          global_config: data.global_config ?? null,
          domain_configs: data.domain_configs ?? {}
        };
        const json = JSON.stringify(payload, null, 2);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `decibel-limiter-settings-${stamp}.json`;
        const url =
          'data:application/json;charset=utf-8,' + encodeURIComponent(json);

        if (chrome.downloads?.download) {
          await new Promise((resolve, reject) => {
            chrome.downloads.download(
              { url, filename, saveAs: true },
              id => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else if (id == null) reject(new Error('Download blocked'));
                else resolve(id);
              }
            );
          });
        } else {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        flashBtn(btn, true);
      } catch (err) {
        console.warn('Export failed', err);
        flashBtn(btn, false, String(err?.message || err));
      }
    });

    el.importBtn?.addEventListener('click', () => el.importFile?.click());
    el.importFile?.addEventListener('change', async () => {
      const file = el.importFile.files?.[0];
      if (!file) return;
      const btn = el.importBtn;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object') throw new Error('Invalid file');
        const writes = {};
        if (payload.global_config && typeof payload.global_config === 'object') {
          writes.global_config = payload.global_config;
        }
        if (payload.domain_configs && typeof payload.domain_configs === 'object') {
          writes.domain_configs = payload.domain_configs;
        }
        if (Object.keys(writes).length) await chrome.storage.local.set(writes);
        if (!payload.global_config) await chrome.storage.local.remove('global_config');
        // Ask SW to push config to open tabs (best-effort).
        try {
          await chrome.runtime.sendMessage({ type: 'importSettings', payload });
        } catch (_) { /* storage already written */ }
        await this.loadConfig();
        flashBtn(btn, true);
      } catch (err) {
        console.warn('Import failed', err);
        flashBtn(btn, false, String(err?.message || err));
      }
      el.importFile.value = '';
    });

    const dismissReview = () => {
      chrome.runtime.sendMessage({ type: 'markReviewSeen' });
      if (el.reviewPrompt) el.reviewPrompt.hidden = true;
    };
    el.reviewDismiss?.addEventListener('click', dismissReview);
    document.getElementById('reviewDismissBackdrop')?.addEventListener('click', dismissReview);
    el.reviewLink?.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'markReviewSeen' });
    });

    bindTooltips();
    bindFadeScrollbars();
  }

  listenBackground() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'updateDB' && msg.tabId === this.tabId) {
        if (typeof msg.db === 'number') this.currentDB = msg.db;
        if (typeof msg.averageDB === 'number') this.averageDB = msg.averageDB;
        if (typeof msg.gainDB === 'number') this.currentGainDB = msg.gainDB;
      }
      sendResponse({ received: true });
      return true;
    });
  }

  async checkWhatsNew() {
    const data = await chrome.storage.local.get(WHATS_NEW_STORAGE_KEY);
    if (data[WHATS_NEW_STORAGE_KEY] === WHATS_NEW_VERSION) return;
    setSettingsOpen(this.elements, false);
    this.coachmarkStepIndex = -1;
    this.showCoachmark();
  }

  async maybeShowReview() {
    const resp = await chrome.runtime.sendMessage({ type: 'getReviewState' });
    if (!resp || resp.seen || (resp.enableCount || 0) < 5) return;
    if (this.elements.reviewPrompt) this.elements.reviewPrompt.hidden = false;
  }

  showCoachmark() {
    showCoachmarkStep({
      elements: this.elements,
      coachmarkStepIndex: this.coachmarkStepIndex,
      setSettingsOpenFn: open => setSettingsOpen(this.elements, open)
    });
    if (this.coachmarkStepIndex >= 0) {
      requestAnimationFrame(() => positionCoachmark(this.elements, this.coachmarkStepIndex));
    }
  }

  advanceCoachmark() {
    this.coachmarkStepIndex += 1;
    this.showCoachmark();
  }

  async requestDB() {
    try {
      const response = await requestCurrentDB(this.tabId);
      if (response) {
        this.currentDB = typeof response.db === 'number' ? response.db : null;
        this.averageDB = typeof response.averageDB === 'number' ? response.averageDB : null;
      }
    } catch (err) {
      console.warn('Error requesting current DB:', err);
    }
  }

  startMeterLoop() {
    const step = (now) => {
      this.meterAnimId = requestAnimationFrame(step);
      const isActive = this.config.enabled;
      const raw = isActive ? this.currentDB : null;
      let target = (raw === null || !isFinite(raw)) ? null : raw;
      if (target === null) this.displayedDB = null;
      else if (this.displayedDB === null || !isFinite(this.displayedDB)) this.displayedDB = target;
      else if (target > this.displayedDB) this.displayedDB = target;
      else {
        const dt = now - (this.lastRender || now);
        this.displayedDB = Math.max(target, this.displayedDB - (dt / 1000) * 45);
      }
      this.lastRender = now;
      renderMeter(this.elements, {
        displayDB: this.displayedDB,
        isActive,
        limitDB: this.config.limitDB,
        currentGainDB: this.currentGainDB,
        gainVisible: this.gainVisible.value,
        setGainVisible: show => setGainVisible(this.elements, this.gainVisible, show)
      });
    };
    this.meterAnimId = requestAnimationFrame(step);
  }

  cleanup() {
    if (this.meterAnimId) cancelAnimationFrame(this.meterAnimId);
  }
}

new Popup();
