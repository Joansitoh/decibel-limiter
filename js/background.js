const currentDB = new Map();       // tabId -> number
const historyDB = new Map();       // tabId -> Array<number>
const peakDB = new Map();          // tabId -> number

// Utility to safely call async chrome APIs
const chromeAsync = {
  getStorage: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
  setStorage: (items) => new Promise(resolve => chrome.storage.local.set(items, resolve)),
  queryTabs: (query) => new Promise(resolve => chrome.tabs.query(query, resolve)),
  sendMessageTab: (tabId, msg) => new Promise(resolve => chrome.tabs.sendMessage(tabId, msg, resolve)),
};

// Calculate weighted moving average, giving more weight to recent values
function calcAverage(list = []) {
  const validValues = list.filter(v => isFinite(v));
  if (!validValues.length) return -Infinity;

  // Use an exponentially weighted moving average (EMA)
  // With a smoothing factor that gives more weight to recent values
  const alpha = 0.3; // Smoothing factor (0 < alpha < 1)
  let ema = validValues[0];

  for (let i = 1; i < validValues.length; i++) {
    ema = alpha * validValues[i] + (1 - alpha) * ema;
  }

  return isFinite(ema) ? ema : -Infinity;
}

// Handle incoming messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      const tabId = sender.tab?.id;
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
          // update history - keep a shorter history for better reactivity
          const hist = historyDB.get(tabId) ?? [];
          if (hist.length >= 30) hist.shift();
          if (isFinite(db)) hist.push(db);
          historyDB.set(tabId, hist);
          // update peak
          const oldPeak = peakDB.get(tabId) ?? -Infinity;
          peakDB.set(tabId, isFinite(db) && db > oldPeak ? db : oldPeak);
          // notify popup
          chrome.runtime.sendMessage({
            type: 'updateDB', tabId, db,
            averageDB: calcAverage(hist),
            peakDB: peakDB.get(tabId)
          });
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
  return true; // keep sendResponse alive
});

// Propagate config changes to content scripts
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    const tabId = Number(key);
    if (Number.isNaN(tabId)) continue;
    await chromeAsync.sendMessageTab(tabId, { type: 'setConfig', ...newValue });
  }
});

// Clean up when tab closed
chrome.tabs.onRemoved.addListener(tabId => {
  currentDB.delete(tabId);
  historyDB.delete(tabId);
  peakDB.delete(tabId);
  chrome.storage.local.remove(tabId.toString());
});
