/**
 * Popup config: service-worker round-trips (the SW owns config resolution + storage).
 */
const { migrateConfig } = self.DLPresets;

export async function identifyActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) throw new Error('No active tab found');
  const tab = tabs[0];
  let host = null;
  try {
    const url = tab.url || '';
    if (url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && !url.startsWith('about:')) {
      host = new URL(url).hostname || null;
    }
  } catch (_) {
    host = null;
  }
  return { tabId: tab.id, host };
}

/** Resolves the SW response, or null on error / no SW. */
function swMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resp => {
      resolve(chrome.runtime.lastError || !resp || resp.error ? null : resp);
    });
  });
}

export async function readStoredConfig(tabId, host = null) {
  const resp = await swMessage({ type: 'getConfig', tabId, host });
  if (resp) return resp;
  // SW unreachable: fall back to this tab's stored session config.
  const key = `tab_cfg_${tabId}`;
  const data = await chrome.storage.local.get(key);
  return migrateConfig(data[key]);
}

/** Sends config to the SW; resolves the resulting tab state (or null). */
export function persistConfig(tabId, config, host = null) {
  return swMessage({ type: 'setConfig', tabId, host, ...migrateConfig(config) });
}

export function requestCurrentDB(tabId) {
  return swMessage({ type: 'getCurrentDB', tabId });
}
