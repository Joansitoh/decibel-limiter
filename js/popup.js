let tabId;
let enabled = false;
let limitDB = -20; // Default value matching HTML default
let currentDB = -Infinity;
let averageDB = -Infinity;
let isDarkMode = false;
let updateInterval;

function detectDarkMode() {
  const darkModeStatus = document.getElementById('darkModeStatus');
  isDarkMode = window.getComputedStyle(darkModeStatus).display === 'block';
}

function updateUI() {
  // Update average decibel level text
  const averageDBElement = document.getElementById('averageDB');
  if (averageDBElement) {
    // Verify averageDB is a valid number
    if (averageDB === -Infinity || averageDB === null || averageDB === undefined || isNaN(averageDB)) {
      averageDBElement.textContent = '-∞ dBFS';
    } else {
      try {
        averageDBElement.textContent = `${averageDB.toFixed(1)} dBFS`;
      } catch (e) {
        console.error(`Error formatting averageDB (${averageDB}): ${e.message}`);
        averageDBElement.textContent = '-∞ dBFS';
      }
    }
  }

  const limitSlider = document.getElementById('limitSlider');
  if (limitSlider) {
    limitSlider.value = limitDB;
  }

  const limitValue = document.getElementById('limitValue');
  if (limitValue) {
    limitValue.textContent = `${limitDB} dBFS`;
  }

  const toggleButton = document.getElementById('toggleButton');
  const toggleText = document.getElementById('toggleText');

  if (toggleButton && toggleText) {
    if (enabled) {
      toggleButton.classList.add('enabled');
      toggleText.textContent = chrome.i18n.getMessage('disable');
      toggleButton.querySelector('.material-icons').textContent = 'power_settings_new';
    } else {
      toggleButton.classList.remove('enabled');
      toggleText.textContent = chrome.i18n.getMessage('enable');
      toggleButton.querySelector('.material-icons').textContent = 'power_settings_new';
    }
  }

  const meterFill = document.getElementById('meterFill');
  if (meterFill) {
    // Progress bar shows current level
    if (currentDB === -Infinity) {
      meterFill.style.width = '0%';
    } else {
      const minDB = -60;
      const maxDB = 0;
      const percentage = Math.max(0, Math.min(100, ((currentDB - minDB) / (maxDB - minDB)) * 100));
      meterFill.style.width = `${percentage}%`;

      if (currentDB > -10) {
        meterFill.style.backgroundColor = 'var(--danger-color)';
      } else if (currentDB > -20) {
        meterFill.style.backgroundColor = 'var(--success-color)';
      } else {
        meterFill.style.backgroundColor = 'var(--primary-color)';
      }
    }
  }
}

function requestCurrentDB() {
  try {
    // Check if extension context is still valid
    if (chrome.runtime.id === undefined) {
      console.error("Extension context invalidated. Stopping updates.");
      clearInterval(updateInterval);
      return;
    }
    
    chrome.runtime.sendMessage({ type: 'getCurrentDB' }, response => {
      if (chrome.runtime.lastError) {
        // Check if error is due to invalidated context
        if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes("Extension context invalidated")) {
          console.error("Extension context invalidated. Communication stopped.");
          clearInterval(updateInterval);
          return;
        }
        console.error(`Error getting dB: ${chrome.runtime.lastError.message}`);
        return;
      }

      if (response) {
        // Update current values
        if (response.db !== undefined) {
          currentDB = response.db;
        }

        // Update average values
        if (response.averageDB !== undefined) {
          averageDB = response.averageDB;
        }

        updateUI();
      } else {
        console.warn('Received empty or invalid response for getCurrentDB');
      }
    });
  } catch (e) {
    console.error(`Error in requestCurrentDB: ${e.message}`);
    
    // If error is due to invalidated context, stop updates
    if (e.message.includes("Extension context invalidated")) {
      console.warn("Extension context invalidated. Stopping update interval.");
      clearInterval(updateInterval);
    }
  }
}

// Function to reset peak value
function resetPeakDB() {
  chrome.runtime.sendMessage({ type: 'resetPeak' }, response => {
    if (chrome.runtime.lastError) {
      console.error(`Error resetting peak: ${chrome.runtime.lastError.message}`);
      return;
    }

    if (response && response.success) {
      updateUI();
    }
  });
}

function setupThemeDetection() {
  detectDarkMode();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    detectDarkMode();
  });
}

function localizeUI() {
  // Localize all elements with data-i18n attribute
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = chrome.i18n.getMessage(key) || element.textContent;
  });

  // Update document title
  document.title = chrome.i18n.getMessage('extensionName');
}

function setupMessageListener() {
  try {
    // Listen for updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message.type === 'updatePopup' && message.tabId === tabId) {
          // Update current values
          if (message.db !== undefined) {
            currentDB = message.db;
          }

          // Update average values
          if (message.averageDB !== undefined) {
            averageDB = message.averageDB;
          }

          updateUI();
        }

        // Always confirm receipt
        sendResponse({ received: true });
      } catch (e) {
        console.error(`Error processing message: ${e.message}`);
      }
      return true;
    });
  } catch (e) {
    console.error(`Error setting up message listener: ${e.message}`);
  }
}

function setupEventListeners() {
  // Set up event listeners for controls
  document.getElementById('limitSlider')?.addEventListener('input', e => {
    limitDB = parseInt(e.target.value);
    updateUI();
    saveConfig();
  });

  document.getElementById('toggleButton')?.addEventListener('click', () => {
    enabled = !enabled;
    updateUI();
    saveConfig();
  });
}

function initialize() {
  // Localize UI elements
  localizeUI();

  setupThemeDetection();
  setupMessageListener();
  setupEventListeners();

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs || tabs.length === 0) {
      console.error('No active tab found');
      return;
    }

    tabId = tabs[0].id;

    chrome.storage.local.get(tabId.toString(), data => {
      const config = data[tabId] || { enabled: false, limitDB: -20 }; // Updated default value

      enabled = config.enabled;
      limitDB = config.limitDB;

      updateUI();
      requestCurrentDB();

      // Set up periodic updates
      clearInterval(updateInterval);
      updateInterval = setInterval(requestCurrentDB, 500); // Update every 500ms
    });
  });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initialize);

// Clear interval when popup is closed
window.addEventListener('unload', () => {
  clearInterval(updateInterval);
});

function saveConfig() {
  chrome.storage.local.set({ [tabId]: { enabled, limitDB } }, () => {
    if (chrome.runtime.lastError) {
      console.error(`Error saving config: ${chrome.runtime.lastError.message}`);
    }
  });
}