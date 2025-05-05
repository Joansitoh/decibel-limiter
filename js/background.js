// Store current decibel levels per tab
const currentDBLevels = {};
const dbHistory = {}; // Store level history for average calculation
const peakDBLevels = {}; // Store maximum levels

// Function to calculate average decibel level
function calculateAverageDB(tabId) {
  try {
    if (!dbHistory[tabId] || dbHistory[tabId].length === 0) {
      return -Infinity;
    }

    // Filter -Infinity and non-numeric values
    const validValues = dbHistory[tabId].filter(db =>
      db !== -Infinity &&
      db !== null &&
      db !== undefined &&
      !isNaN(db)
    );

    if (validValues.length === 0) {
      return -Infinity;
    }

    // Calculate average
    const sum = validValues.reduce((acc, val) => acc + val, 0);
    const average = sum / validValues.length;

    // Verify result is a valid number
    if (isNaN(average) || average === null || average === undefined) {
      return -Infinity;
    }

    return average;
  } catch (e) {
    return -Infinity;
  }
}

// Check if extension context is valid
function isExtensionContextValid() {
  try {
    return chrome.runtime.id !== undefined;
  } catch (e) {
    return false;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // Check if context is valid
    if (!isExtensionContextValid()) {
      return false;
    }

    // If message comes from a content script, it will have a tabId
    const tabId = sender?.tab?.id;

    if (message.type === 'getConfig') {
      // Get the stored configuration for the tab
      try {
        chrome.storage.local.get(tabId.toString(), data => {
          try {
            const config = data[tabId] || { enabled: false, limitDB: -20 };
            sendResponse({ tabId, ...config });
          } catch (e) {
            sendResponse({ error: e.message });
          }
        });
        return true; // Asynchronous response
      } catch (e) {
        sendResponse({ error: e.message });
        return true;
      }
    } else if (message.type === 'updateDB') {
      // Update the current decibel level
      if (tabId) {
        const db = message.db;
        currentDBLevels[tabId] = db;

        // Update history and peak
        if (!dbHistory[tabId]) {
          dbHistory[tabId] = [];
        }

        // Keep a limited history (last 100 values)
        if (dbHistory[tabId].length >= 100) {
          dbHistory[tabId].shift(); // Remove oldest value
        }

        // Only add valid values to history
        if (db !== -Infinity) {
          dbHistory[tabId].push(db);
        }

        // Update maximum level
        if (!peakDBLevels[tabId] || peakDBLevels[tabId] === -Infinity || (db !== -Infinity && db > peakDBLevels[tabId])) {
          peakDBLevels[tabId] = db;
        }

        // Send to popup if open
        try {
          chrome.runtime.sendMessage({
            type: 'updatePopup',
            tabId,
            db,
            averageDB: calculateAverageDB(tabId),
            peakDB: peakDBLevels[tabId] || -Infinity
          }, response => {
          });
        } catch (e) {
        }

        // Confirm receipt to content script
        sendResponse({ success: true });
      }
      return true; // Asynchronous response
    } else if (message.type === 'getCurrentDB') {
      // Respond with the current decibel level and statistics
      const db = currentDBLevels[tabId] || -Infinity;
      const averageDB = calculateAverageDB(tabId);
      const peakDB = peakDBLevels[tabId] || -Infinity;

      sendResponse({
        db,
        averageDB,
        peakDB
      });
      return true; // Asynchronous response
    } else if (message.type === 'resetPeak') {
      // Reset maximum level
      if (tabId) {
        peakDBLevels[tabId] = -Infinity;
        sendResponse({ success: true });
      }
      return true;
    }
  } catch (e) {
    // Handle general errors
    if (e.message.includes("Extension context invalidated")) {
      return false;
    }
    try {
      sendResponse({ error: e.message });
    } catch (sendError) {
    }
    return true;
  }
});

// Notify the content script when the configuration changes
chrome.storage.onChanged.addListener((changes, area) => {
  try {
    // Check if context is valid
    if (!isExtensionContextValid()) {
      return;
    }

    if (area === 'local') {
      for (const key in changes) {
        if (isNaN(parseInt(key))) continue;

        const tabId = parseInt(key);
        const newConfig = changes[key].newValue;

        try {
          chrome.tabs.sendMessage(tabId, {
            type: 'setConfig',
            ...newConfig
          }, response => {
          });
        } catch (e) {
        }
      }
    }
  } catch (e) {
    // Handle general errors
    if (!e.message.includes("Extension context invalidated")) {
    }
  }
});

// Clean levels when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  try {
    delete currentDBLevels[tabId];
    delete dbHistory[tabId];
    delete peakDBLevels[tabId];
    chrome.storage.local.remove(tabId.toString());
  } catch (e) {
  }
});