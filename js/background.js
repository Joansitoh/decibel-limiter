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

/** @type {Map<number, {streamId: string, offscreenCreated: boolean}>} - Tracks active tab captures */
const activeCaptures = new Map();

/**
 * Utility object to promisify Chrome API calls.
 * @namespace
 */
const chromeAsync = {
  getStorage: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
  setStorage: (items) => new Promise(resolve => chrome.storage.local.set(items, resolve)),
  queryTabs: (query) => new Promise(resolve => chrome.tabs.query(query, resolve)),
  sendMessageTab: (tabId, msg) => new Promise(resolve => chrome.tabs.sendMessage(tabId, msg, resolve)),
};

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
          const data = await chromeAsync.getStorage(tabId.toString());
          const cfg = data[tabId] || { enabled: false, limitDB: -20 };
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
          // Called by popup to update per-tab config (enabled, limitDB, captureEnabled)
          try {
            const enabled = !!msg.enabled;
            const limitDB = Number.isFinite(msg.limitDB) ? msg.limitDB : -20;
            const captureEnabled = !!msg.captureEnabled;

            // Persist the config per-tab when tabId is provided
            if (tabId != null) {
              const tabKey = String(tabId);
              try {
                await chromeAsync.setStorage({ [tabKey]: { enabled, limitDB, captureEnabled } });
              } catch (e) {
                // ignore storage errors
              }

              // Apply to the tab's content script (if present)
              try {
                await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', enabled, limitDB, captureEnabled });
              } catch (e) {
                // ignore if no content script
              }

              // Manage capture state according to config
              if (captureEnabled) {
                try { await startTabCapture(tabId); } catch (e) { /* ignore */ }
              } else {
                try { await stopTabCapture(tabId); } catch (e) { /* ignore */ }
              }

              // Set badge for visual feedback on that tab
              if (enabled) {
                chrome.action.setBadgeText({ tabId, text: 'ON' });
                chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ecc71' });
                chrome.action.setTitle({ tabId, title: 'Decibel Limiter — Enabled' });
              } else {
                chrome.action.setBadgeText({ tabId, text: '' });
                chrome.action.setTitle({ tabId, title: 'Decibel Limiter' });
              }
            } else {
              // No tabId: store globally (not per-tab) and update badge/title globally
              try { await chromeAsync.setStorage({ globalConfig: { enabled, limitDB, captureEnabled } }); } catch (e) {}
              if (enabled) {
                chrome.action.setBadgeText({ text: 'ON' });
                chrome.action.setBadgeBackgroundColor({ color: '#2ecc71' });
                chrome.action.setTitle({ title: 'Decibel Limiter — Enabled' });
              } else {
                chrome.action.setBadgeText({ text: '' });
                chrome.action.setTitle({ title: 'Decibel Limiter' });
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
 * Propagates configuration changes to content scripts and offscreen document.
 * Ensures all components stay synchronized with user settings.
 */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    const tabId = Number(key);
    if (Number.isNaN(tabId)) continue;

    // Update content script (handles traditional media elements)
    await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', ...newValue });

    // Update offscreen document if enhanced mode is active
    if (activeCaptures.has(tabId)) {
      try {
        await chrome.runtime.sendMessage({
          type: 'update-config',
          config: newValue
        });
      } catch (error) {
        // Ignore errors if offscreen document doesn't exist
      }
    }
  }
});

/**
 * Starts tab audio capture for enhanced mode.
 * Creates offscreen document and initiates audio processing.
 * @param {number} tabId - Tab ID to capture audio from
 * @returns {Promise<void>}
 * @throws {Error} If tab capture fails to start
 */
async function startTabCapture(tabId) {
  try {
    // Prevent duplicate capture sessions
    if (activeCaptures.has(tabId)) {
      return;
    }

    // Obtain stream ID from Chrome's tabCapture API
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    // Create offscreen document if it doesn't exist
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
    );

    if (!offscreenDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio processing for decibel limiting',
      });
    }

    // Initialize capture in offscreen document
    await chrome.runtime.sendMessage({
      type: 'start-capture',
      streamId: streamId,
      tabId: tabId
    });

    // Load and send current configuration to offscreen
    const data = await chromeAsync.getStorage(tabId.toString());
    const config = data[tabId] || { enabled: false, limitDB: -20 };

    await chrome.runtime.sendMessage({
      type: 'update-config',
      config: config
    });

    activeCaptures.set(tabId, { streamId, offscreenCreated: !offscreenDocument });
    // Tab capture started successfully
  } catch (error) {
    console.error('Failed to start tab capture:', error);
    throw error;
  }
}

/**
 * Stops tab audio capture and cleans up resources.
 * @param {number} tabId - Tab ID to stop capturing
 * @returns {Promise<void>}
 */
async function stopTabCapture(tabId) {
  try {
    if (!activeCaptures.has(tabId)) {
      return;
    }

    // Send stop signal to offscreen document
    await chrome.runtime.sendMessage({
      type: 'stop-capture'
    });

    activeCaptures.delete(tabId);
    // Tab capture stopped successfully
  } catch (error) {
    console.error('Failed to stop tab capture:', error);
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

  if (activeCaptures.has(tabId)) {
    await stopTabCapture(tabId);
  }

  chrome.storage.local.remove(tabId.toString());
});

// When a tab becomes active, apply stored configuration for that tab (re-activate if needed)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tabId = activeInfo.tabId;
    const key = String(tabId);
    const data = await chromeAsync.getStorage(key);
    const cfg = data[key] || {};

    // Send config to content script
    try { await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', ...cfg }); } catch (e) {}

    // If enhanced capture was active previously, try to re-start it
    if (cfg.captureEnabled) {
      try { await startTabCapture(tabId); } catch (e) { }
    }

    // Ensure the action badge reflects enabled state for this tab
    if (cfg.enabled) {
      chrome.action.setBadgeText({ tabId, text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ecc71' });
      chrome.action.setTitle({ tabId, title: 'Decibel Limiter — Enabled' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
      chrome.action.setTitle({ tabId, title: 'Decibel Limiter' });
    }
  } catch (err) {
    // ignore
  }
});

// When a tab finishes loading (navigation), re-apply stored config so new page gets settings
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  try {
    if (changeInfo.status !== 'complete') return;
    const key = String(tabId);
    const data = await chromeAsync.getStorage(key);
    const cfg = data[key] || {};
    try { await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', ...cfg }); } catch (e) {}
    if (cfg.captureEnabled) {
      try { await startTabCapture(tabId); } catch (e) { }
    }

    // Update badge to match stored enabled state
    if (cfg.enabled) {
      chrome.action.setBadgeText({ tabId, text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ecc71' });
      chrome.action.setTitle({ tabId, title: 'Decibel Limiter — Enabled' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
      chrome.action.setTitle({ tabId, title: 'Decibel Limiter' });
    }
  } catch (err) {
    // ignore
  }
});
