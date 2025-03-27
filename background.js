// Store current decibel levels per tab
const currentDBLevels = {};

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab.id;

  if (message.type === 'getConfig') {
    // Get the stored configuration for the tab
    chrome.storage.local.get(tabId.toString(), data => {
      const config = data[tabId] || { enabled: false, limitDB: -10 };
      sendResponse({ tabId, ...config });
    });
    return true; // Asynchronous response
  } else if (message.type === 'updateDB') {
    // Update the current decibel level
    currentDBLevels[tabId] = message.db;
    // Send to popup if open
    chrome.runtime.sendMessage({ type: 'updatePopup', tabId, db: message.db });
  } else if (message.type === 'getCurrentDB') {
    // Respond with the current decibel level
    sendResponse({ db: currentDBLevels[tabId] || -Infinity });
  }
});

// Notify the content script when the configuration changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    for (const key in changes) {
      const tabId = parseInt(key);
      const newConfig = changes[key].newValue;
      chrome.tabs.sendMessage(tabId, { type: 'setConfig', ...newConfig }, response => {
        if (chrome.runtime.lastError) {
          console.log(`Error sending config to tab ${tabId}: ${chrome.runtime.lastError.message}`);
        }
      });
    }
  }
});

// Clean levels when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  delete currentDBLevels[tabId];
  chrome.storage.local.remove(tabId.toString());
});