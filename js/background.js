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

/**
 * Per-tab config stored in chrome.storage.session.
 * Persists across service worker restarts (SW is killed after ~5 s of inactivity in MV3)
 * but is cleared when the browser is closed — session-only, never written to disk.
 * Cleared individually when a tab is closed.
 */
const DEFAULT_CONFIG = Object.freeze({ enabled: false, limitDB: -20, captureEnabled: false, limiterStrength: 'normal', limiterFloor: 0.01, limiterRelease: 1.03 });
const LIMITER_STRENGTHS = new Set(['soft', 'normal', 'strong', 'custom']);
const LIMITER_PRESETS = Object.freeze({
  soft: { floor: 0.05, release: 1.06 },
  normal: { floor: 0.01, release: 1.03 },
  strong: { floor: 0.003, release: 1.015 }
});

function tabConfigKey(tabId) { return `tab_cfg_${tabId}`; }

async function getTabConfig(tabId) {
  const key = tabConfigKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data[key] ?? { ...DEFAULT_CONFIG };
}

async function setTabConfig(tabId, cfg) {
  await chrome.storage.session.set({ [tabConfigKey(tabId)]: cfg });
}

async function removeTabConfig(tabId) {
  await chrome.storage.session.remove(tabConfigKey(tabId));
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
          // Notify popup of decibel updates
          chrome.runtime.sendMessage({
            type: 'updateDB', tabId, db,
            averageDB: calcAverage(hist),
            peakDB: peakDB.get(tabId)
          }).catch(() => { }); // Ignore errors when popup is closed
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
            const limiterRelease = Number.isFinite(msg.limiterRelease) ? msg.limiterRelease : (LIMITER_PRESETS[limiterStrength]?.release ?? 1.03);

            if (tabId != null) {
              const previousCfg = await getTabConfig(tabId);
              const nextConfig = { enabled, limitDB, captureEnabled, limiterStrength, limiterFloor, limiterRelease };
              await setTabConfig(tabId, nextConfig);

              try {
                await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', enabled, limitDB, captureEnabled, limiterStrength, limiterFloor, limiterRelease });
              } catch (e) { /* ignore if no content script */ }

              // Only toggle capture when the flag actually changed
              if (captureEnabled !== !!previousCfg.captureEnabled) {
                if (captureEnabled) {
                  try { await startTabCapture(tabId); } catch (e) { /* ignore */ }
                } else {
                  try { await stopTabCapture(tabId); } catch (e) { /* ignore */ }
                }
              } else if (captureEnabled && activeCaptures.has(tabId)) {
                // Capture already active — propagate updated config to offscreen
                try { await chrome.runtime.sendMessage({ type: 'update-config', config: nextConfig }); } catch (e) {}
              }

              if (enabled) {
                chrome.action.setBadgeText({ tabId, text: 'ON' });
                chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ecc71' });
                chrome.action.setTitle({ tabId, title: 'Decibel Limiter — Enabled' });
              } else {
                chrome.action.setBadgeText({ tabId, text: '' });
                chrome.action.setTitle({ tabId, title: 'Decibel Limiter' });
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
  if (!activeCaptures.has(tabId)) return;
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
