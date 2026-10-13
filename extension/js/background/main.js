/**
 * @file Background service worker — messaging, metering, tab lifecycle
 * @module BackgroundScript
 */
importScripts('../presets.js', 'storage.js', 'capture.js');

const {
  DEFAULT_CONFIG,
  STRENGTH_PRESETS,
  LIMITER_STRENGTHS,
  SCENARIOS,
  AUDIO_PATHS,
  wantsCapture,
  migrateConfig,
  hostFromUrl,
  applyScenario
} = self.DLPresets;

// Expose on self so importScripts modules always resolve these (const is script-local).
Object.assign(self, { wantsCapture, migrateConfig, hostFromUrl, applyScenario });

const LIMITER_PRESETS = STRENGTH_PRESETS;

const currentDB = new Map();
const currentGainDB = new Map();
const historyDB = new Map();
const peakDB = new Map();
const lastPopupNotify = new Map();

function calcAverage(list = []) {
  const validValues = list.filter(v => isFinite(v));
  if (!validValues.length) return -Infinity;
  const alpha = 0.3;
  let ema = validValues[0];
  for (let i = 1; i < validValues.length; i++) {
    ema = alpha * validValues[i] + (1 - alpha) * ema;
  }
  return isFinite(ema) ? ema : -Infinity;
}

const WHATS_NEW_VERSION = 'comfort-2026-10';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ seenWhatsNew: WHATS_NEW_VERSION });
  }
  pruneOrphanTabConfigs().catch(() => { });
});

chrome.runtime.onStartup.addListener(() => {
  pruneOrphanTabConfigs().catch(() => { });
});

/** When the SW wakes, re-apply the focused tab so badge/capture aren't stuck until popup. */
async function hydrateActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await applyConfigToTab(tab.id);
  } catch (err) {
    console.warn('hydrateActiveTab', err);
  }
}

hydrateActiveTab();

function sanitizeIncoming(msg) {
  let cfg = migrateConfig({
    enabled: !!msg.enabled,
    limitDB: Number.isFinite(msg.limitDB) ? msg.limitDB : DEFAULT_CONFIG.limitDB,
    audioPath: AUDIO_PATHS.has(msg.audioPath) ? msg.audioPath : undefined,
    captureEnabled: !!msg.captureEnabled,
    scenario: SCENARIOS.has(msg.scenario) ? msg.scenario : 'custom',
    limiterStrength: LIMITER_STRENGTHS.has(msg.limiterStrength) ? msg.limiterStrength : 'normal',
    limiterFloor: Number.isFinite(msg.limiterFloor) ? msg.limiterFloor : undefined,
    limiterRelease: Number.isFinite(msg.limiterRelease) ? msg.limiterRelease : undefined,
    levelingEnabled: typeof msg.levelingEnabled === 'boolean' ? msg.levelingEnabled : undefined,
    levelingProfile: msg.levelingProfile ?? undefined,
    global: !!msg.global
  });

  // Legacy: if only captureEnabled flipped without audioPath
  if (!AUDIO_PATHS.has(msg.audioPath) && typeof msg.captureEnabled === 'boolean') {
    cfg.audioPath = msg.captureEnabled ? 'capture' : 'element';
    cfg = migrateConfig(cfg);
  }

  if (!Number.isFinite(cfg.limiterFloor)) {
    cfg.limiterFloor = LIMITER_PRESETS[cfg.limiterStrength]?.floor ?? 0.01;
  }
  if (!Number.isFinite(cfg.limiterRelease)) {
    cfg.limiterRelease = LIMITER_PRESETS[cfg.limiterStrength]?.release ?? 8;
  }
  cfg.captureEnabled = wantsCapture(cfg);
  return cfg;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // Prefer explicit tabId (popup / tests). Action popups have no sender.tab;
      // opening popup.html as a tab would otherwise steal the id.
      const tabId = msg.tabId != null ? msg.tabId : sender.tab?.id;
      switch (msg.type) {
        case 'getConfig': {
          const hostHint = msg.host || null;
          const cfg = await getTabConfig(tabId ?? -1, { host: hostHint });
          const host =
            resolveHost(hostHint, null) ||
            (tabId != null ? await tabHost(tabId) : null);
          const domains = await getDomainConfigs();
          // Pin domain memory onto this tab — tabs.url is often opaque without host_permissions,
          // so without this, Enable only "appears" after the popup grants activeTab.
          if (tabId != null && (cfg.enabled || wantsCapture(cfg))) {
            await setTabConfig(tabId, cfg);
          }
          sendResponse({
            tabId,
            ...cfg,
            host,
            domainSaved: !!(host && domains[host]),
            captureActive: tabId != null && activeCaptures.has(tabId)
          });
          break;
        }
        case 'pageReady': {
          // Content script always knows its host; use that to restore domain memory immediately.
          if (tabId == null) {
            sendResponse({ success: false });
            break;
          }
          const hostHint = msg.host || null;
          const cfg = await getTabConfig(tabId, { host: hostHint });
          const host =
            resolveHost(hostHint, null) || (await tabHost(tabId));
          const domains = await getDomainConfigs();
          if (cfg.enabled || wantsCapture(cfg)) {
            await setTabConfig(tabId, cfg);
          }
          sendResponse({
            success: true,
            tabId,
            ...cfg,
            host,
            domainSaved: !!(host && domains[host]),
            captureActive: activeCaptures.has(tabId)
          });
          // Badge + capture/element after responding (avoid racing the content getConfig path)
          applyConfigToTab(tabId).catch(err =>
            console.warn('pageReady apply failed', err)
          );
          break;
        }
        case 'forgetDomain': {
          const host = msg.host || (tabId != null ? await tabHost(tabId) : null);
          await clearDomainConfig(host);
          if (tabId != null) await applyConfigToTab(tabId);
          sendResponse({ success: true, host });
          break;
        }
        case 'exportSettings': {
          // Use storage helpers — const KEYS in storage.js are not visible here (importScripts).
          const [global_config, domain_configs] = await Promise.all([
            getGlobalConfig(),
            getDomainConfigs()
          ]);
          sendResponse({
            success: true,
            payload: {
              version: 1,
              exportedAt: new Date().toISOString(),
              global_config,
              domain_configs
            }
          });
          break;
        }
        case 'importSettings': {
          const p = msg.payload;
          if (!p || typeof p !== 'object') {
            sendResponse({ success: false, error: 'Invalid payload' });
            break;
          }
          if (p.global_config && typeof p.global_config === 'object') {
            await setGlobalConfig(p.global_config);
          } else {
            await clearGlobalConfig();
          }
          if (p.domain_configs && typeof p.domain_configs === 'object') {
            await setDomainConfigs(p.domain_configs);
          }
          const tabs = await chrome.tabs.query({});
          await Promise.all(tabs.map(t => applyConfigToTab(t.id).catch(() => { })));
          sendResponse({ success: true });
          break;
        }
        case 'markReviewSeen': {
          await chrome.storage.local.set({
            [self.REVIEW_STORAGE_KEY]: { seen: true, at: Date.now() }
          });
          sendResponse({ success: true });
          break;
        }
        case 'getReviewState': {
          const reviewKey = self.REVIEW_STORAGE_KEY;
          const data = await chrome.storage.local.get([reviewKey, 'enableCount']);
          sendResponse({
            seen: !!data[reviewKey]?.seen,
            enableCount: data.enableCount || 0
          });
          break;
        }
        case 'updateDB': {
          if (tabId == null) break;
          const db = msg.db;
          currentDB.set(tabId, db);
          if (typeof msg.gainDB === 'number') currentGainDB.set(tabId, msg.gainDB);
          const hist = historyDB.get(tabId) ?? [];
          if (hist.length >= 30) hist.shift();
          if (isFinite(db)) hist.push(db);
          historyDB.set(tabId, hist);
          const oldPeak = peakDB.get(tabId) ?? -Infinity;
          peakDB.set(tabId, isFinite(db) && db > oldPeak ? db : oldPeak);
          const now = Date.now();
          if (now - (lastPopupNotify.get(tabId) ?? 0) > 33) {
            lastPopupNotify.set(tabId, now);
            chrome.runtime.sendMessage({
              type: 'updateDB', tabId, db,
              averageDB: calcAverage(hist),
              peakDB: peakDB.get(tabId),
              gainDB: currentGainDB.get(tabId)
            }).catch(() => { });
          }
          sendResponse({ success: true });
          break;
        }
        case 'startTabCapture': {
          if (tabId == null) break;
          await startTabCapture(tabId);
          sendResponse({ success: true });
          break;
        }
        case 'stopTabCapture': {
          if (tabId == null) break;
          await stopTabCapture(tabId);
          sendResponse({ success: true });
          break;
        }
        case 'getCurrentDB': {
          const db = currentDB.get(tabId) ?? -Infinity;
          const hist = historyDB.get(tabId) ?? [];
          const gainDB = currentGainDB.get(tabId) ?? 0;
          sendResponse({
            db,
            averageDB: calcAverage(hist),
            peakDB: peakDB.get(tabId) ?? -Infinity,
            gainDB
          });
          break;
        }
        case 'setConfig': {
          try {
            const nextConfig = sanitizeIncoming(msg);
            if (tabId == null) {
              sendResponse({ success: false });
              break;
            }

            // Track enables for soft review prompt
            const prev = await getTabConfig(tabId);
            if (!prev.enabled && nextConfig.enabled) {
              const { enableCount = 0 } = await chrome.storage.local.get('enableCount');
              await chrome.storage.local.set({ enableCount: enableCount + 1 });
            }

            await setTabConfig(tabId, nextConfig);

            if (nextConfig.global) {
              const { captureEnabled: _c, ...globalCfg } = nextConfig;
              await setGlobalConfig({ ...globalCfg, global: true });
              await rebalanceCaptures(tabId);
              const tabs = await chrome.tabs.query({});
              await Promise.all(tabs.map(async t => {
                if (t.id === tabId) return;
                const tabCfg = await getTabConfig(t.id);
                // Owner / soft-handoff already handled by rebalance; refresh others' badges/content
                if (!wantsCapture(tabCfg)) {
                  applyBadge(t.id, tabCfg, activeCaptures.has(t.id));
                  await pushConfigToTab(t.id, tabCfg);
                }
              }));
            } else {
              await clearGlobalConfig();
              const host =
                resolveHost(msg.host, null) || (await tabHost(tabId));
              if (host) await setDomainConfig(host, nextConfig);
              if (wantsCapture(nextConfig)) {
                await rebalanceCaptures(tabId);
              } else {
                if (activeCaptures.has(tabId)) {
                  try { await stopTabCapture(tabId); } catch (_) { /* ignore */ }
                }
                applyBadge(tabId, nextConfig, false);
                await pushConfigToTab(tabId, nextConfig);
                await rebalanceCaptures(null);
              }
            }
          } catch (err) {
            console.warn('setConfig handler error', err);
          }
          sendResponse({ success: true });
          break;
        }
        case 'resetPeak': {
          if (tabId != null) {
            peakDB.set(tabId, -Infinity);
            sendResponse({ success: true });
          }
          break;
        }
        case 'cycleScenario': {
          if (tabId == null) break;
          const order = ['night', 'balanced', 'social', 'music'];
          const cfg = await getTabConfig(tabId);
          const idx = order.indexOf(cfg.scenario);
          const next = order[(idx + 1) % order.length];
          const scen = applyScenario(next);
          const merged = migrateConfig({ ...cfg, ...scen, enabled: cfg.enabled, global: cfg.global });
          await setTabConfig(tabId, merged);
          if (!merged.global) {
            const host = await tabHost(tabId);
            if (host) await setDomainConfig(host, merged);
          }
          await applyConfigToTab(tabId);
          sendResponse({ success: true, scenario: next });
          break;
        }
        case 'toggleEnabled': {
          if (tabId == null) break;
          const cfg = await getTabConfig(tabId);
          cfg.enabled = !cfg.enabled;
          const next = migrateConfig(cfg);
          await setTabConfig(tabId, next);
          if (!next.global) {
            const host = await tabHost(tabId);
            if (host) await setDomainConfig(host, next);
          } else {
            const { captureEnabled: _c, ...g } = next;
            await setGlobalConfig({ ...g, global: true });
          }
          await applyConfigToTab(tabId);
          sendResponse({ success: true, enabled: next.enabled });
          break;
        }
      }
    } catch (err) {
      console.error('bg message handler', err);
      sendResponse({ error: err.message });
    }
  })();
  return true;
});

chrome.commands?.onCommand?.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const tabId = tab.id;
  if (command === 'toggle-enabled') {
    const cfg = await getTabConfig(tabId);
    cfg.enabled = !cfg.enabled;
    const next = migrateConfig(cfg);
    await setTabConfig(tabId, next);
    if (!next.global) {
      const host = await tabHost(tabId);
      if (host) await setDomainConfig(host, next);
    } else {
      const { captureEnabled: _c, ...g } = next;
      await setGlobalConfig({ ...g, global: true });
    }
    await applyConfigToTab(tabId);
  } else if (command === 'cycle-scenario') {
    const order = ['night', 'balanced', 'social', 'music'];
    const cfg = await getTabConfig(tabId);
    const idx = order.indexOf(cfg.scenario);
    const nextScen = order[(idx + 1) % order.length];
    const scen = applyScenario(nextScen);
    const merged = migrateConfig({ ...cfg, ...scen, enabled: cfg.enabled, global: cfg.global });
    await setTabConfig(tabId, merged);
    if (!merged.global) {
      const host = await tabHost(tabId);
      if (host) await setDomainConfig(host, merged);
    }
    await applyConfigToTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const wasCapturing = activeCaptures.has(tabId);
  currentDB.delete(tabId);
  historyDB.delete(tabId);
  peakDB.delete(tabId);
  captureStarting.delete(tabId);
  lastPopupNotify.delete(tabId);
  await removeTabConfig(tabId);
  if (wasCapturing) {
    try { await stopTabCapture(tabId); } catch (_) { /* ignore */ }
    await rebalanceCaptures(null);
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  const tabId = activeInfo.tabId;
  (async () => {
    const cfg = await getTabConfig(tabId);
    // Materialize domain memory onto this tab so Enable/HQ follows without opening the popup
    if (cfg.enabled || wantsCapture(cfg)) {
      await setTabConfig(tabId, cfg);
    }
    // Same path as setConfig — badge + capture/element soft-handoff
    await applyConfigToTab(tabId);
  })().catch(err => console.warn('onActivated apply failed', err));
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  try {
    if (changeInfo.status === 'loading' && activeCaptures.has(tabId)) {
      await stopTabCapture(tabId);
      const cfg = await getTabConfig(tabId);
      applyBadge(tabId, cfg, false);
      await pushConfigToTab(tabId, cfg);
      await rebalanceCaptures(null);
      return;
    }
    // Audible tab that wants HQ should reclaim Best quality
    if (typeof changeInfo.audible === 'boolean') {
      await rebalanceCaptures(changeInfo.audible ? tabId : null);
      return;
    }
    if (changeInfo.status !== 'complete' && !changeInfo.url) return;
    // When Chrome exposes changeInfo.url, seed domain memory before apply
    // (often missing without host_permissions — content pageReady is the fallback).
    if (changeInfo.url) {
      const hostHint = hostFromUrl(changeInfo.url);
      if (hostHint) {
        const cfg = await getTabConfig(tabId, { host: hostHint });
        if (cfg.enabled || wantsCapture(cfg)) await setTabConfig(tabId, cfg);
      }
    }
    await applyConfigToTab(tabId);
  } catch (_) { /* ignore */ }
});
