/**
 * Popup config: storage + service-worker round-trips.
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

export async function readStoredConfig(tabId) {
  const tabKey = `tab_cfg_${tabId}`;
  const data = await chrome.storage.local.get([tabKey, 'global_config', 'domain_configs']);
  const globalCfg = data.global_config;
  const perTab = data[tabKey];
  const domains = data.domain_configs ?? {};

  let base;
  if (globalCfg?.global) {
    base = {
      ...globalCfg,
      ...(perTab ? { audioPath: perTab.audioPath } : {})
    };
  } else if (perTab) {
    base = perTab;
  } else {
    const meta = await swGetConfig(tabId);
    if (meta?.host && domains[meta.host]) {
      base = { ...domains[meta.host], host: meta.host, domainSaved: true };
    } else if (meta && !meta.error) {
      return meta;
    } else {
      base = {};
    }
    if (meta?.host) {
      base.host = meta.host;
      base.domainSaved = !!(meta.host && domains[meta.host]);
    }
    return migrateConfig(base);
  }

  const meta = await swGetConfig(tabId);
  const host = meta?.host || null;
  return {
    ...migrateConfig(base),
    host,
    domainSaved: !!(host && domains[host]),
    captureActive: !!meta?.captureActive,
    captureError: meta?.captureError
  };
}

function swGetConfig(tabId) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'getConfig', tabId }, resp => {
      if (chrome.runtime.lastError || !resp || resp.error) resolve(null);
      else resolve(resp);
    });
  });
}

export async function persistConfig(tabId, config, host = null) {
  const cfg = migrateConfig(config);
  const tabKey = `tab_cfg_${tabId}`;
  const writes = { [tabKey]: cfg };
  if (cfg.global) {
    const { captureEnabled: _c, ...globalCfg } = cfg;
    writes.global_config = globalCfg;
  }
  await chrome.storage.local.set(writes);
  if (!cfg.global) await chrome.storage.local.remove('global_config');

  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'setConfig', tabId, host, ...cfg }, () => {
      chrome.runtime.sendMessage({ type: 'getConfig', tabId, host }, resp => {
        resolve(resp && !resp.error ? resp : null);
      });
    });
  });
}

export function requestCurrentDB(tabId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'getCurrentDB', tabId }, response => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(response);
    });
  });
}
