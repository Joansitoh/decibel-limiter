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
