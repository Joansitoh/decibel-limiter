/**
 * Popup app orchestrator — wires events; UI/config live in sibling modules.
 */
import { readTheme } from './theme.js';
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
    this.hqTabId = null;
    this.config = migrateConfig({});
    this.currentDB = null;
    this.currentGainDB = null;
    this.lastRender = 0;
    this.displayedDB = null;
    this.dragging = false;
    this.elements = {};
    this.coachmarkStepIndex = 0;
    this.gainVisible = { value: false };
    this.saving = null;
    this.saveQueued = false;

    document.addEventListener('DOMContentLoaded', () => this.init());
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
    // Opening the popup invokes the extension on this tab, which is exactly what
    // tabCapture needed when the SW tried HQ on its own (site memory, tab switch).
    if (this.hqState() === 'unavailable') this.saveConfig();
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
      hq: this.hqState()
    };
  }

  /** 'off' | 'active' (this tab) | 'elsewhere' (another tab really holds it) | 'unavailable' */
  hqState() {
    if (!wantsCapture(this.config)) return 'off';
    if (this.captureActive) return 'active';
    return this.hqTabId != null && this.hqTabId !== this.tabId ? 'elsewhere' : 'unavailable';
  }

  /** Runtime capture fields from a SW tab-state response. */
  applyCaptureState(resp) {
    this.captureActive = !!resp.captureActive;
    this.hqTabId = resp.hqTabId ?? null;
  }

  statusArgs() {
    return {
      enabled: this.config.enabled,
      levelingEnabled: this.config.levelingEnabled,
      hq: this.hqState()
    };
  }

  refreshUI() {
    syncAllUI(this.uiCtx());
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
    const cfg = await readStoredConfig(this.tabId, this.host);
    this.config = migrateConfig(cfg);
    this.host = cfg.host || this.host || null;
    this.domainSaved = !!cfg.domainSaved;
    this.applyCaptureState(cfg);
    this.refreshUI();
  }

  /**
   * Coalesced save: one SW round-trip in flight, only the latest state queued.
   * Fader/slider drags fire per pixel; each save rebalances every tab in the SW.
   */
  saveConfig() {
    if (this.saving) {
      this.saveQueued = true;
      return this.saving;
    }
    this.saving = (async () => {
      try {
        do {
          this.saveQueued = false;
          this.config = migrateConfig(this.config);
          const resp = await persistConfig(this.tabId, this.config, this.host);
          // A newer edit is queued — this response is already stale.
          if (resp && !this.saveQueued) this.applySaveResponse(resp);
        } while (this.saveQueued);
      } finally {
        this.saving = null;
      }
    })();
    return this.saving;
  }

  applySaveResponse(resp) {
    this.host = resp.host || this.host;
    this.domainSaved = !!resp.domainSaved;
    this.applyCaptureState(resp);
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
    applyPathUI(this.elements, this.config, this.hqState());
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
      const prefersHq = this.config.audioPath !== 'element';
      // HQ preferred but not running here (another tab / unavailable): clicking claims or
      // retries HQ instead of switching it off.
      const waiting = ['elsewhere', 'unavailable'].includes(this.hqState());
      this.config.audioPath = prefersHq && !waiting ? 'element' : 'capture';
      this.config.captureEnabled = wantsCapture(this.config);
      applyPathUI(el, this.config, this.hqState());
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
      this.config = applyScenario(this.config, btn.dataset.scenario);
      this.refreshUI();
      punch(btn, el.limitTab, 1.03);
      const g = gsapRef();
      if (g && motionOk() && el.limitTab) {
        g.fromTo(el.limitTab, { autoAlpha: 0.55 }, { autoAlpha: 1, duration: 0.25, ease: 'power2.out' });
      }
      this.saveConfig();
    });

    const setTheme = choice => {
      try { localStorage.setItem(THEME_KEY, choice); } catch (_) { /* ignore */ }
      applyTheme(choice);
      updateThemeButtons(el);
    };
    el.themeSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-theme-choice]');
      if (btn) setTheme(btn.dataset.themeChoice);
    });

    el.pathSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-path]');
      if (!btn) return;
      // Path is independent of the scenario (same as the footer chip).
      this.config.audioPath = btn.dataset.path;
      this.config.captureEnabled = wantsCapture(this.config);
      updatePathSelector(el, this.config.audioPath);
      applyPathUI(el, this.config, this.hqState());
      applyStatusLine(el, this.statusArgs(), true);
      this.saveConfig();
    });

    el.presetSelector?.addEventListener('click', e => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      this.config = migrateConfig({ ...this.config, limiterStrength: btn.dataset.preset, scenario: 'custom' });
      updatePresetButtons(el, this.config.limiterStrength);
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

    el.evenVolumeToggle?.addEventListener('click', () => this.toggleLeveling());

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
          theme: readTheme(),
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
        // SW validates, writes storage and pushes the result to open tabs.
        const resp = await chrome.runtime.sendMessage({ type: 'importSettings', payload });
        if (!resp?.success) throw new Error(resp?.error || 'Import failed');
        if (['auto', 'light', 'dark'].includes(payload.theme)) setTheme(payload.theme);
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
    // Listen only — never sendResponse: the popup also sees content/offscreen traffic
    // (pageReady, start-capture…) and answering first would hijack the SW's reply.
    chrome.runtime.onMessage.addListener(msg => {
      if (msg.type !== 'updateDB' || msg.tabId !== this.tabId) return;
      if (typeof msg.db === 'number') this.currentDB = msg.db;
      if (typeof msg.gainDB === 'number') this.currentGainDB = msg.gainDB;
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
    const response = await requestCurrentDB(this.tabId);
    if (typeof response?.db === 'number') this.currentDB = response.db;
  }

  startMeterLoop() {
    const step = (now) => {
      requestAnimationFrame(step);
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
        currentGainDB: this.currentGainDB,
        setGainVisible: show => setGainVisible(this.elements, this.gainVisible, show)
      });
    };
    requestAnimationFrame(step);
  }
}

new Popup();
