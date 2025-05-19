(() => {
  class Popup {
    #tabId = null;
    #config = { enabled: false, limitDB: -20 };
    #currentDB = null;      // null = no data; -Infinity is interpreted as actual silence
    #averageDB = null;
    #lastRender = 0;        // for UI throttling
    #elements = {};

    constructor() {
      document.addEventListener('DOMContentLoaded', () => this.init());
      window.addEventListener('unload', () => this.cleanup());
    }

    // Main initialization
    async init() {
      this.#cacheElements();
      this.#localize();
      this.#setupThemeWatcher();
      this.#bindUIEvents();
      this.#listenBackground();
      await this.#identifyTab();
      await this.#loadConfig();
      this.#requestCurrentDB();  // first request
    }

    #cacheElements() {
      const qs = sel => document.getElementById(sel);
      this.#elements = {
        averageDB: qs('averageDB'),
        meterFill: qs('meterFill'),
        limitSlider: qs('limitSlider'),
        limitValue: qs('limitValue'),
        toggleButton: qs('toggleButton'),
        toggleIcon: qs('toggleButton')?.querySelector('.material-icons'),
        toggleText: qs('toggleText'),
        darkModeStatus: qs('darkModeStatus'),
      };
    }

    #localize() {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        el.textContent = chrome.i18n.getMessage(key) || el.textContent;
      });
      document.title = chrome.i18n.getMessage('extensionName');
    }

    #setupThemeWatcher() {
      const apply = () => {
        const isDark = getComputedStyle(this.#elements.darkModeStatus).display === 'block';
        document.body.classList.toggle('dark', isDark);
      };
      apply();
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', apply);
    }

    #bindUIEvents() {
      this.#elements.limitSlider.addEventListener('input', e => {
        this.#config.limitDB = +e.target.value;
        this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;
        this.#saveConfig();
      });
      this.#elements.toggleButton.addEventListener('click', () => {
        this.#config.enabled = !this.#config.enabled;
        this.#elements.toggleButton.classList.toggle('enabled', this.#config.enabled);
        this.#elements.toggleText.textContent = chrome.i18n.getMessage(
          this.#config.enabled ? 'disable' : 'enable'
        );
        this.#saveConfig();
      });
    }

    #listenBackground() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'updateDB' && msg.tabId === this.#tabId) {
          this.#currentDB = (typeof msg.db === 'number') ? msg.db : this.#currentDB;
          this.#averageDB = (typeof msg.averageDB === 'number') ? msg.averageDB : this.#averageDB;
          this.#render();
        }
        sendResponse({ received: true });
        return true;
      });
    }

    async #identifyTab() {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs.length) throw new Error('No active tab');
      this.#tabId = tabs[0].id;
    }

    async #loadConfig() {
      const data = await chrome.storage.local.get(this.#tabId.toString());
      const cfg = data[this.#tabId] || {};
      this.#config.enabled = !!cfg.enabled;
      this.#config.limitDB = Number.isFinite(cfg.limitDB) ? cfg.limitDB : this.#config.limitDB;
      // initialize controls
      this.#elements.limitSlider.value = this.#config.limitDB;
      this.#elements.limitValue.textContent = `${this.#config.limitDB} dBFS`;
      this.#elements.toggleButton.classList.toggle('enabled', this.#config.enabled);
      this.#elements.toggleText.textContent = chrome.i18n.getMessage(
        this.#config.enabled ? 'disable' : 'enable'
      );
    }

    #saveConfig() {
      chrome.storage.local.set({
        [this.#tabId]: {
          enabled: this.#config.enabled,
          limitDB: this.#config.limitDB
        }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving config:', chrome.runtime.lastError);
        }
      });
      chrome.runtime.sendMessage({ type: 'setConfig', ...this.#config });
    }

    async #requestCurrentDB() {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'getCurrentDB', tabId: this.#tabId },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });
        
        if (response) {
          this.#currentDB = typeof response.db === 'number' ? response.db : null;
          this.#averageDB = typeof response.averageDB === 'number' ? response.averageDB : null;
          this.#render();
        }
      } catch (error) {
        console.warn('Error requesting current decibel level:', error);
      }
    }

    // Rendering (throttled at ≈60 Hz)
    #render() {
      const now = performance.now();
      if (now - this.#lastRender < 16) return; // ≈60 FPS
      this.#lastRender = now;

      // Update average
      if (this.#elements.averageDB) {
        const avg = this.#averageDB;
        this.#elements.averageDB.textContent = 
          (avg === null || !isFinite(avg)) ? 
          '-∞ dBFS' : 
          `${Math.round(avg * 10) / 10} dBFS`; // Round to 1 decimal place
      }

      // Update meter
      if (this.#elements.meterFill) {
        const db = this.#currentDB;
        if (typeof db === 'number' && isFinite(db)) {
          // Ensure the value is in the range [-60, 0] dBFS
          const normalizedDB = Math.max(-60, Math.min(0, db));
          const pct = ((normalizedDB + 60) / 60) * 100;
          this.#elements.meterFill.style.width = `${pct}%`;
          
          // Change color according to level
          this.#elements.meterFill.style.backgroundColor = 
            db > -10 ? 'var(--danger-color)' :
            db > this.#config.limitDB ? 'var(--success-color)' :
            'var(--primary-color)';
        } else {
          // No signal
          this.#elements.meterFill.style.width = '0%';
        }
      }
    }

    cleanup() {
      // Nothing to clear since no setInterval persisted
    }
  }

  new Popup();
})();
