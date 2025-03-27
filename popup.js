let tabId;
let enabled = false;
let limitDB = -10;
let currentDB = -Infinity;
let isDarkMode = false;

function detectDarkMode() {
  const darkModeStatus = document.getElementById('darkModeStatus');
  isDarkMode = window.getComputedStyle(darkModeStatus).display === 'block';
}

function updateUI() {
  document.getElementById('currentDB').textContent = 
    currentDB === -Infinity ? '-∞' : currentDB.toFixed(1);
  
  document.getElementById('limitSlider').value = limitDB;
  document.getElementById('limitValue').textContent = limitDB;
  
  const toggleButton = document.getElementById('toggleButton');
  toggleButton.textContent = enabled ? 'Disable' : 'Enable';
  
  if (enabled) {
    toggleButton.classList.add('enabled');
    toggleButton.innerHTML = '<span class="material-icons">power_settings_new</span>Disable';
  } else {
    toggleButton.classList.remove('enabled');
    toggleButton.innerHTML = '<span class="material-icons">power_settings_new</span>Enable';
  }
  
  const meterFill = document.getElementById('meterFill');
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

function requestCurrentDB() {
  chrome.runtime.sendMessage({ type: 'getCurrentDB' }, response => {
    if (chrome.runtime.lastError) {
      console.log(`Error getting dB: ${chrome.runtime.lastError.message}`);
      return;
    }
    currentDB = response.db;
    updateUI();
  });
}

function setupThemeDetection() {
  detectDarkMode();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    detectDarkMode();
  });
}

function initialize() {
  setupThemeDetection();
  
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    tabId = tabs[0].id;
    chrome.storage.local.get(tabId.toString(), data => {
      const config = data[tabId] || { enabled: false, limitDB: -10 };
      enabled = config.enabled;
      limitDB = config.limitDB;
      updateUI();
      requestCurrentDB();
      setInterval(requestCurrentDB, 1000);
    });
  });
}

document.addEventListener('DOMContentLoaded', initialize);

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'updatePopup' && message.tabId === tabId) {
    currentDB = message.db;
    updateUI();
  }
});

document.getElementById('limitSlider').addEventListener('input', e => {
  limitDB = parseInt(e.target.value);
  updateUI();
  saveConfig();
});

document.getElementById('toggleButton').addEventListener('click', () => {
  enabled = !enabled;
  updateUI();
  saveConfig();
});

function saveConfig() {
  chrome.storage.local.set({ [tabId]: { enabled, limitDB } }, () => {
    if (chrome.runtime.lastError) {
      console.log(`Error saving config: ${chrome.runtime.lastError.message}`);
    }
  });
}