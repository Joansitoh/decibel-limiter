/**
 * @file Background service worker for Decibel Limiter extension
 * @module BackgroundScript
 */

/** @type {Map<number, number>} - Maps tab ID to current decibel level */
const currentDB = new Map();

/** @type {Map<number, Array<number>>} - Maps tab ID to decibel history for averaging */
const historyDB = new Map();

/** @type {Map<number, number>} - Maps tab ID to peak decibel level */
const peakDB = new Map();

/** @type {Map<number, {streamId: string}>} - Tracks active tab captures */
const activeCaptures = new Map();

/** @type {Set<number>} - Tabs currently starting a capture (prevents duplicate concurrent starts) */
const captureStarting = new Set();

/** @type {Map<number, number>} - Maps tab ID to last popup-notify timestamp (throttles UI updates) */
const lastPopupNotify = new Map();

/**
 * Per-tab config stored in chrome.storage.local.
 * `storage.session` was tempting here (it dies with the browser, which matches
 * per-tab state) but it is also wiped whenever the extension is reloaded or
 * updated, which made the popup reopen showing defaults while the limiter was
 * still running — so this uses local storage and prunes dead tabs explicitly
 * (on tab close and on startup, see pruneOrphanTabConfigs).
 *
 * When `global` is turned on, the limiter fields (everything except
 * `captureEnabled`, which is inherently per-tab) are instead read from
 * `GLOBAL_STORAGE_KEY` in chrome.storage.local — persistent across browser
 * restarts and applied to every tab/domain automatically.
 */
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  limitDB: -20,
  captureEnabled: false,
  limiterStrength: 'normal',
  limiterFloor: 0.01,
  limiterRelease: 8, // dB/sec
  global: false
});
const LIMITER_STRENGTHS = new Set(['soft', 'normal', 'strong', 'custom']);
// release is expressed in dB/sec (how fast gain recovers once no longer needed)
const LIMITER_PRESETS = Object.freeze({
  soft: { floor: 0.05, release: 15 },
  normal: { floor: 0.01, release: 8 },
  strong: { floor: 0.003, release: 4 }
});

const GLOBAL_STORAGE_KEY = 'global_config';

function tabConfigKey(tabId) { return `tab_cfg_${tabId}`; }

/**
 * Reads the persistent "apply to all sites" config, if any is stored.
 * @returns {Promise<Object|null>}
 */
async function getGlobalConfig() {
  const data = await chrome.storage.local.get(GLOBAL_STORAGE_KEY);
  return data[GLOBAL_STORAGE_KEY] ?? null;
}

async function setGlobalConfig(cfg) {
  await chrome.storage.local.set({ [GLOBAL_STORAGE_KEY]: cfg });
}

async function clearGlobalConfig() {
  await chrome.storage.local.remove(GLOBAL_STORAGE_KEY);
}

/**
 * Resolves the effective config for a tab: the persistent global config when
 * "apply to all sites" is active (same limiter settings everywhere), merged
 * with that tab's own `captureEnabled` (tab capture is exclusive/per-tab by
 * nature and never forced globally); otherwise the tab's own session config.
 * @param {number} tabId
 * @returns {Promise<Object>}
 */
async function getTabConfig(tabId) {
  const key = tabConfigKey(tabId);
  const data = await chrome.storage.local.get(key);
  const perTab = data[key] ?? { ...DEFAULT_CONFIG };

  const globalCfg = await getGlobalConfig();
  if (globalCfg?.global) {
    return { ...globalCfg, captureEnabled: perTab.captureEnabled ?? false };
  }
  return perTab;
}

async function setTabConfig(tabId, cfg) {
  await chrome.storage.local.set({ [tabConfigKey(tabId)]: cfg });
}

async function removeTabConfig(tabId) {
  await chrome.storage.local.remove(tabConfigKey(tabId));
}

/**
 * Drops per-tab configs whose tab no longer exists. Tab ids are recycled by the
 * browser, so stale entries would otherwise leak settings into unrelated tabs.
 */
async function pruneOrphanTabConfigs() {
  const [all, tabs] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.tabs.query({})
  ]);
  const liveKeys = new Set(tabs.map(t => tabConfigKey(t.id)));
  const orphans = Object.keys(all).filter(k => k.startsWith('tab_cfg_') && !liveKeys.has(k));
  if (orphans.length) await chrome.storage.local.remove(orphans);
}

const chromeAsync = {
  sendMessageTab: (tabId, msg) => new Promise(resolve => chrome.tabs.sendMessage(tabId, msg, resolve)),
};

/**
 * Applies the current in-memory config to a tab's content script and manages capture state.
 * @param {number} tabId
 */
async function applyConfigToTab(tabId) {
  const cfg = await getTabConfig(tabId);

  try {
    await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', ...cfg });
  } catch (e) {
    // Ignore if no content script
  }

  if (cfg.captureEnabled && !activeCaptures.has(tabId) && !captureStarting.has(tabId)) {
    try { await startTabCapture(tabId); } catch (e) { /* ignore */ }
  } else if (!cfg.captureEnabled) {
    // The worker can forget activeCaptures while the offscreen document keeps
    // running. This idempotent stop repairs that state after worker restart.
    try { await stopTabCapture(tabId); } catch (e) { /* ignore */ }
  }

  if (cfg.enabled) {
    chrome.action.setBadgeText({ tabId, text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ecc71' });
    chrome.action.setTitle({ tabId, title: 'Decibel Limiter — Enabled' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: 'Decibel Limiter' });
  }
}

/**
 * Calculates exponentially weighted moving average (EMA) of decibel values.
 * Gives more weight to recent values for better responsiveness.
 * @param {number[]} list - Array of decibel values
 * @returns {number} Weighted average or -Infinity if no valid values
 */
function calcAverage(list = []) {
  const validValues = list.filter(v => isFinite(v));
  if (!validValues.length) return -Infinity;

  // Exponentially weighted moving average (EMA)
  // Alpha controls smoothing: higher = more weight to recent values
  const alpha = 0.3; // Smoothing factor (0 < alpha < 1)
  let ema = validValues[0];

  for (let i = 1; i < validValues.length; i++) {
    ema = alpha * validValues[i] + (1 - alpha) * ema;
  }

  return isFinite(ema) ? ema : -Infinity;
}

// Must match WHATS_NEW_VERSION in popup.js — marking it seen on fresh install
// means only existing users (who update into a new value) see the banner.
const WHATS_NEW_VERSION = 'presets-2026-08';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ seenWhatsNew: WHATS_NEW_VERSION });
  }
  pruneOrphanTabConfigs().catch(() => { });
});

chrome.runtime.onStartup.addListener(() => {
  pruneOrphanTabConfigs().catch(() => { });
});

/**
 * Main message handler for communication between extension components.
 * Handles config requests, decibel updates, and tab capture control.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const tabId = sender.tab?.id || msg.tabId;
      switch (msg.type) {
        case 'getConfig': {
          const cfg = await getTabConfig(tabId ?? -1);
          sendResponse({ tabId, ...cfg });
          break;
        }
        case 'updateDB': {
          if (tabId == null) break;
          const db = msg.db;
          currentDB.set(tabId, db);
          // Update history - keep limited size for better reactivity
          const hist = historyDB.get(tabId) ?? [];
          if (hist.length >= 30) hist.shift();
          if (isFinite(db)) hist.push(db);
          historyDB.set(tabId, hist);
          // Update peak decibel level
          const oldPeak = peakDB.get(tabId) ?? -Infinity;
          peakDB.set(tabId, isFinite(db) && db > oldPeak ? db : oldPeak);
          // Notify popup of decibel updates — throttled to ~30Hz so multiple
          // media elements reporting at 40Hz each can't flood the popup; the
          // popup's own rAF meter loop keeps the bar smooth between messages.
          const now = Date.now();
          if (now - (lastPopupNotify.get(tabId) ?? 0) > 33) {
            lastPopupNotify.set(tabId, now);
            chrome.runtime.sendMessage({
              type: 'updateDB', tabId, db,
              averageDB: calcAverage(hist),
              peakDB: peakDB.get(tabId),
              gainDB: typeof msg.gainDB === 'number' ? msg.gainDB : undefined
            }).catch(() => { }); // Ignore errors when popup is closed
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
          sendResponse({ db, averageDB: calcAverage(hist), peakDB: peakDB.get(tabId) ?? -Infinity });
          break;
        }
        case 'setConfig': {
          try {
            const enabled = !!msg.enabled;
            const limitDB = Number.isFinite(msg.limitDB) ? msg.limitDB : -20;
            const captureEnabled = !!msg.captureEnabled;
            const limiterStrength = LIMITER_STRENGTHS.has(msg.limiterStrength) ? msg.limiterStrength : 'normal';
            const limiterFloor = Number.isFinite(msg.limiterFloor) ? msg.limiterFloor : (LIMITER_PRESETS[limiterStrength]?.floor ?? 0.01);
            const limiterRelease = Number.isFinite(msg.limiterRelease) ? msg.limiterRelease : (LIMITER_PRESETS[limiterStrength]?.release ?? 8);
            const global = !!msg.global;

            if (tabId != null) {
              const nextConfig = { enabled, limitDB, captureEnabled, limiterStrength, limiterFloor, limiterRelease, global };
              await setTabConfig(tabId, nextConfig);

              if (global) {
                // Persist and push to every open tab, so it "sticks" everywhere right away.
                await setGlobalConfig({ enabled, limitDB, limiterStrength, limiterFloor, limiterRelease, global: true });
                const tabs = await chrome.tabs.query({});
                await Promise.all(tabs.map(async t => {
                  const tabCfg = await getTabConfig(t.id);
                  try { await chromeAsync.sendMessageTab(t.id, { type: 'setConfig', ...tabCfg }); } catch (e) { /* ignore if no content script */ }
                  chrome.action.setBadgeText({ tabId: t.id, text: tabCfg.enabled ? 'ON' : '' });
                  if (tabCfg.enabled) chrome.action.setBadgeBackgroundColor({ tabId: t.id, color: '#2ecc71' });
                }));
              } else {
                await clearGlobalConfig();
                try {
                  await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', ...nextConfig });
                } catch (e) { /* ignore if no content script */ }

                if (enabled) {
                  chrome.action.setBadgeText({ tabId, text: 'ON' });
                  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ecc71' });
                  chrome.action.setTitle({ tabId, title: 'Decibel Limiter — Enabled' });
                } else {
                  chrome.action.setBadgeText({ tabId, text: '' });
                  chrome.action.setTitle({ tabId, title: 'Decibel Limiter' });
                }
              }

              // Tab capture is exclusive/per-tab by nature — never driven by global mode.
              // Compare against the live capture state, not the stored config: the
              // popup writes storage itself before sending this message, so the
              // stored "previous" value already matches the new one.
              const capturing = activeCaptures.has(tabId) || captureStarting.has(tabId);
              if (captureEnabled && !capturing) {
                try { await startTabCapture(tabId); } catch (e) { /* ignore */ }
              } else if (!captureEnabled) {
                try { await stopTabCapture(tabId); } catch (e) { /* ignore */ }
              } else if (captureEnabled && activeCaptures.has(tabId)) {
                // Capture already active — propagate updated config to offscreen
                try { await chrome.runtime.sendMessage({ type: 'update-config', config: nextConfig }); } catch (e) {}
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
      }
    } catch (err) {
      console.error('bg message handler', err);
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep sendResponse channel open for async responses
});

/**
 * Starts tab audio capture for enhanced mode.
 * Uses captureStarting as a lock to prevent duplicate concurrent starts.
 * @param {number} tabId
 */
async function startTabCapture(tabId) {
  if (activeCaptures.has(tabId) || captureStarting.has(tabId)) return;
  captureStarting.add(tabId);
  try {
    for (const activeTabId of activeCaptures.keys()) {
      if (activeTabId !== tabId) await stopTabCapture(activeTabId);
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');

    if (!offscreenDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio processing for decibel limiting',
      });
    }

    const config = await getTabConfig(tabId);
    await chrome.runtime.sendMessage({ type: 'start-capture', streamId, tabId });
    await chrome.runtime.sendMessage({ type: 'update-config', config });

    activeCaptures.set(tabId, { streamId });
  } catch (error) {
    console.error('Failed to start tab capture:', error);
    throw error;
  } finally {
    captureStarting.delete(tabId);
  }
}

/**
 * Stops tab audio capture and cleans up resources.
 * @param {number} tabId
 */
async function stopTabCapture(tabId) {
  try {
    await chrome.runtime.sendMessage({ type: 'stop-capture', tabId });
  } catch (error) {
    console.error('Failed to stop tab capture:', error);
  } finally {
    activeCaptures.delete(tabId);
  }
}

/**
 * Handles extension icon clicks to toggle tab capture.
 * @deprecated This handler may not be used if popup is configured
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (activeCaptures.has(tab.id)) {
      await stopTabCapture(tab.id);
    } else {
      await startTabCapture(tab.id);
    }
  } catch (error) {
    console.error('Action button handler error:', error);
  }
});

/**
 * Cleans up resources when a tab is closed.
 * Removes stored data and stops any active captures.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  currentDB.delete(tabId);
  historyDB.delete(tabId);
  peakDB.delete(tabId);
  captureStarting.delete(tabId);
  lastPopupNotify.delete(tabId);
  await removeTabConfig(tabId);

  if (activeCaptures.has(tabId)) {
    await stopTabCapture(tabId);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await applyConfigToTab(activeInfo.tabId);
  } catch (err) { /* ignore */ }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  try {
    if (changeInfo.status === 'loading' && activeCaptures.has(tabId)) {
      await stopTabCapture(tabId);
      return;
    }
    if (changeInfo.status !== 'complete') return;
    await applyConfigToTab(tabId);
  } catch (err) { /* ignore */ }
});
