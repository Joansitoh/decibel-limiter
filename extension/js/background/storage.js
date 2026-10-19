/**
 * @file Background storage — tab / domain / global config
 * Must be importScripts'd after presets.js. Use self.DLPresets, not top-level
 * destructures: main.js already declares those names in the shared global scope,
 * and a redeclared const across files kills the SW.
 */

// importScripts files share one global scope, so these are visible in main.js too.
const GLOBAL_STORAGE_KEY = 'global_config';
const DOMAIN_STORAGE_KEY = 'domain_configs';
const REVIEW_STORAGE_KEY = 'reviewPrompt';

function tabConfigKey(tabId) { return `tab_cfg_${tabId}`; }

async function setDomainConfigs(all) {
  await chrome.storage.local.set({ [DOMAIN_STORAGE_KEY]: all && typeof all === 'object' ? all : {} });
}

async function getGlobalConfig() {
  const data = await chrome.storage.local.get(GLOBAL_STORAGE_KEY);
  return data[GLOBAL_STORAGE_KEY] ?? null;
}

async function setGlobalConfig(cfg) {
  await chrome.storage.local.set({ [GLOBAL_STORAGE_KEY]: cfg });
}

async function clearGlobalConfig() {
  await chrome.storage.local.remove(GLOBAL_STORAGE_KEY);
}

async function getDomainConfigs() {
  const data = await chrome.storage.local.get(DOMAIN_STORAGE_KEY);
  return data[DOMAIN_STORAGE_KEY] ?? {};
}

async function setDomainConfig(host, cfg) {
  if (!host) return;
  const all = await getDomainConfigs();
  const { global: _g, captureEnabled: _c, ...rest } = cfg;
  all[host] = rest;
  await chrome.storage.local.set({ [DOMAIN_STORAGE_KEY]: all });
}

async function clearDomainConfig(host) {
  if (!host) return;
  const all = await getDomainConfigs();
  delete all[host];
  await chrome.storage.local.set({ [DOMAIN_STORAGE_KEY]: all });
}

async function tabHost(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    // Without host_permissions / tabs, tab.url is often "" — content script must pass host.
    return self.DLPresets.hostFromUrl(tab.url || tab.pendingUrl || '');
  } catch {
    return null;
  }
}

/** Prefer host reported by the content script (always knows location.hostname). */
function resolveHost(hostHint, tabUrlHost) {
  const { normalizeHost } = self.DLPresets;
  if (hostHint) return normalizeHost(hostHint);
  return tabUrlHost || null;
}

/**
 * Resolve effective config:
 * 1) global apply-all (path may stay per-tab)
 * 2) per-tab if this tab already has saved config (authoritative while tab lives)
 * 3) domain memory (new tabs on a known site)
 * 4) defaults
 *
 * @param {number} tabId
 * @param {{ host?: string|null }} [opts] host hint from content (required when tabs.url is opaque)
 */
async function getTabConfig(tabId, opts = {}) {
  const key = tabConfigKey(tabId);
  const data = await chrome.storage.local.get(key);
  const { migrateConfig, wantsCapture } = self.DLPresets;
  const hasTab = !!data[key];
  const perTab = migrateConfig(data[key] ?? {});

  const globalCfg = await getGlobalConfig();
  if (globalCfg?.global) {
    const merged = migrateConfig({
      ...globalCfg,
      ...(hasTab ? { audioPath: perTab.audioPath } : {}),
      scenario: globalCfg.scenario ?? perTab.scenario
    });
    merged.global = true;
    merged.captureEnabled = wantsCapture(merged);
    return merged;
  }

  const host = resolveHost(opts.host, await tabHost(tabId));
  const domains = host ? await getDomainConfigs() : {};
  const domainCfg = host && domains[host] ? migrateConfig({ ...domains[host], global: false }) : null;

  // Open-tab session wins over domain — otherwise a stale domain "enabled:false"
  // could wipe a just-enabled tab when the popup reopens.
  if (hasTab) {
    // Exception: site memory says ON but this tab session is still OFF (common after
    // switching YouTube tabs). Revive from domain so badge/capture don't wait for popup.
    if (domainCfg?.enabled && !perTab.enabled) {
      domainCfg.captureEnabled = wantsCapture(domainCfg);
      return domainCfg;
    }
    perTab.global = false;
    perTab.captureEnabled = wantsCapture(perTab);
    return perTab;
  }

  if (domainCfg) {
    domainCfg.captureEnabled = wantsCapture(domainCfg);
    return domainCfg;
  }

  perTab.captureEnabled = wantsCapture(perTab);
  return perTab;
}

async function setTabConfig(tabId, cfg) {
  await chrome.storage.local.set({ [tabConfigKey(tabId)]: self.DLPresets.migrateConfig(cfg) });
}

async function removeTabConfig(tabId) {
  await chrome.storage.local.remove(tabConfigKey(tabId));
}

async function pruneOrphanTabConfigs() {
  const [all, tabs] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.tabs.query({})
  ]);
  const liveKeys = new Set(tabs.map(t => tabConfigKey(t.id)));
  const orphans = Object.keys(all).filter(k => k.startsWith('tab_cfg_') && !liveKeys.has(k));
  if (orphans.length) await chrome.storage.local.remove(orphans);
}

const chromeAsync = {
  sendMessageTab: (tabId, msg) => new Promise(resolve => chrome.tabs.sendMessage(tabId, msg, resolve)),
};

