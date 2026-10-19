/**
 * @file Background service worker — messaging, metering, tab lifecycle
 * @module BackgroundScript
 */
importScripts('../presets.js', 'storage.js', 'capture.js');

const {
  DEFAULT_CONFIG,
  SCENARIO_PRESETS,
  LEVELING_PROFILES,
  SCENARIOS,
  AUDIO_PATHS,
  wantsCapture,
  migrateConfig,
  hostFromUrl,
  applyScenario
} = self.DLPresets;

const currentDB = new Map();
const currentGainDB = new Map();
const lastPopupNotify = new Map();

chrome.runtime.onInstalled.addListener(() => {
  pruneOrphanTabConfigs().catch(() => { });
});

chrome.runtime.onStartup.addListener(() => {
  pruneOrphanTabConfigs().catch(() => { });
});

/** When the SW wakes, re-apply the focused tab so badge/capture aren't stuck until popup. */
async function hydrateActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await applyConfigToTab(tab.id, { force: false });
  } catch (err) {
    console.warn('hydrateActiveTab', err);
  }
}

hydrateActiveTab();

/** Whitelist + clamp a config arriving by message; migrateConfig fills the rest. */
function sanitizeIncoming(msg) {
  return migrateConfig({
    enabled: !!msg.enabled,
    limitDB: Number.isFinite(msg.limitDB) ? Math.max(-60, Math.min(0, msg.limitDB)) : DEFAULT_CONFIG.limitDB,
    audioPath: AUDIO_PATHS.has(msg.audioPath) ? msg.audioPath : undefined,
    scenario: SCENARIOS.has(msg.scenario) ? msg.scenario : 'custom',
    limiterStrength: msg.limiterStrength,
    limiterRelease: msg.limiterRelease,
    levelingEnabled: typeof msg.levelingEnabled === 'boolean' ? msg.levelingEnabled : undefined,
    levelingProfile: Object.hasOwn(LEVELING_PROFILES, msg.levelingProfile ?? '') ? msg.levelingProfile : null,
    global: !!msg.global
  });
}

/** Popup/content view of a tab: effective config + host + runtime capture state. */
async function tabState(tabId, cfg, hostHint = null) {
  const host = resolveHost(hostHint, null) || (tabId != null ? await tabHost(tabId) : null);
  const domains = await getDomainConfigs();
  return {
    tabId,
    ...cfg,
    host,
    domainSaved: !!(host && domains[host]),
    captureActive: tabId != null && activeCaptures.has(tabId),
    // Which tab really holds Best quality (null = none) — "on another tab" must not be a guess.
    hqTabId: activeCaptures.keys().next().value ?? null
  };
}

/** Effective config for a tab, pinning domain memory onto it so Enable/HQ follows without the popup. */
async function resolveAndPin(tabId, host) {
  const cfg = await getTabConfig(tabId, { host });
  // tabs.url is often opaque without host_permissions, so without this pin, Enable
  // only "appears" after the popup grants activeTab.
  if (cfg.enabled || wantsCapture(cfg)) await setTabConfig(tabId, cfg);
  return cfg;
}

/** Persist a tab's config to its scope (global or site memory), then apply it. */
async function saveAndApply(tabId, cfg) {
  await setTabConfig(tabId, cfg);
  if (cfg.global) {
    const { captureEnabled: _c, ...g } = cfg;
    await setGlobalConfig({ ...g, global: true });
  } else {
    const host = await tabHost(tabId);
    if (host) await setDomainConfig(host, cfg);
  }
  await applyConfigToTab(tabId, { force: true });
}

async function toggleEnabled(tabId) {
  const cfg = await getTabConfig(tabId);
  await saveAndApply(tabId, migrateConfig({ ...cfg, enabled: !cfg.enabled }));
}

async function cycleScenario(tabId) {
  const order = Object.keys(SCENARIO_PRESETS);
  const cfg = await getTabConfig(tabId);
  const next = order[(order.indexOf(cfg.scenario) + 1) % order.length];
  await saveAndApply(tabId, applyScenario(cfg, next));
}

/** Message handlers: each returns the response (undefined = plain ack). */
const handlers = {
  async getConfig(msg, tabId) {
    if (tabId == null) return tabState(null, await getTabConfig(-1, { host: msg.host }), msg.host);
    return tabState(tabId, await resolveAndPin(tabId, msg.host), msg.host);
  },

  async pageReady(msg, tabId) {
    // Content script always knows its host; use that to restore domain memory immediately.
    if (tabId == null) return { success: false };
    const state = await tabState(tabId, await resolveAndPin(tabId, msg.host), msg.host);
    // Badge + capture/element after responding (avoid racing the content getConfig path)
    setTimeout(() => applyConfigToTab(tabId, { force: false })
      .catch(err => console.warn('pageReady apply failed', err)));
    return { success: true, ...state };
  },

  async setConfig(msg, tabId) {
    if (tabId == null) return { success: false };
    const nextConfig = sanitizeIncoming(msg);
    try {
      // Track enables for soft review prompt
      const prev = await getTabConfig(tabId);
      if (!prev.enabled && nextConfig.enabled) {
        const { enableCount = 0 } = await chrome.storage.local.get('enableCount');
        await chrome.storage.local.set({ enableCount: enableCount + 1 });
      }

      await setTabConfig(tabId, nextConfig);

      if (nextConfig.global) {
        const { captureEnabled: _c, ...globalCfg } = nextConfig;
        await setGlobalConfig({ ...globalCfg, global: true });
        // Rebalance refreshes every tab (badge + content) and the HQ owner.
        await rebalanceCaptures(tabId, { force: true });
      } else {
        await clearGlobalConfig();
        const host = resolveHost(msg.host, null) || (await tabHost(tabId));
        if (host) await setDomainConfig(host, nextConfig);
        await applyConfigToTab(tabId, { force: true });
      }
    } catch (err) {
      console.warn('setConfig handler error', err);
    }
    return { success: true, ...(await tabState(tabId, await getTabConfig(tabId, { host: msg.host }), msg.host)) };
  },

  async forgetDomain(msg, tabId) {
    const host = msg.host || (tabId != null ? await tabHost(tabId) : null);
    await clearDomainConfig(host);
    if (tabId != null) await applyConfigToTab(tabId);
    return { success: true, host };
  },

  async importSettings(msg) {
    const p = msg.payload;
    if (!p || typeof p !== 'object') return { success: false, error: 'Invalid payload' };
    if (p.global_config && typeof p.global_config === 'object') {
      await setGlobalConfig(p.global_config);
    } else {
      await clearGlobalConfig();
    }
    if (p.domain_configs && typeof p.domain_configs === 'object') {
      // Merge: imported sites win, sites not in the file are kept.
      await setDomainConfigs({ ...(await getDomainConfigs()), ...p.domain_configs });
    }
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(t => applyConfigToTab(t.id).catch(() => { })));
    return { success: true };
  },

  async markReviewSeen() {
    await chrome.storage.local.set({ [REVIEW_STORAGE_KEY]: { seen: true, at: Date.now() } });
    return { success: true };
  },

  async getReviewState() {
    const data = await chrome.storage.local.get([REVIEW_STORAGE_KEY, 'enableCount']);
    return { seen: !!data[REVIEW_STORAGE_KEY]?.seen, enableCount: data.enableCount || 0 };
  },

  async updateDB(msg, tabId) {
    if (tabId == null) return;
    const { db } = msg;
    currentDB.set(tabId, db);
    if (typeof msg.gainDB === 'number') currentGainDB.set(tabId, msg.gainDB);
    const now = Date.now();
    if (now - (lastPopupNotify.get(tabId) ?? 0) > 33) {
      lastPopupNotify.set(tabId, now);
      chrome.runtime.sendMessage({
        type: 'updateDB', tabId, db, gainDB: currentGainDB.get(tabId)
      }).catch(() => { });
    }
    return { success: true };
  },

  async getCurrentDB(_msg, tabId) {
    return { db: currentDB.get(tabId) ?? -Infinity, gainDB: currentGainDB.get(tabId) ?? 0 };
  },

  // Used by the manual HQ e2e (tests/e2e/hq-manual.spec.mjs).
  async startTabCapture(_msg, tabId) {
    if (tabId == null) return { success: false };
    await startTabCapture(tabId);
    return { success: true };
  },

  async stopTabCapture(_msg, tabId) {
    if (tabId == null) return { success: false };
    await stopTabCapture(tabId);
    return { success: true };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  // Not ours (e.g. offscreen traffic) — don't hold the channel open.
  if (!handler) return;
  // Prefer explicit tabId (popup / tests). Action popups have no sender.tab;
  // opening popup.html as a tab would otherwise steal the id.
  const tabId = msg.tabId != null ? msg.tabId : sender.tab?.id;
  handler(msg, tabId).then(sendResponse, err => {
    console.error('bg message handler', err);
    sendResponse({ error: err.message });
  });
  return true;
});

chrome.commands?.onCommand?.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  if (command === 'toggle-enabled') await toggleEnabled(tab.id);
  else if (command === 'cycle-scenario') await cycleScenario(tab.id);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const wasCapturing = activeCaptures.has(tabId);
  currentDB.delete(tabId);
  currentGainDB.delete(tabId);
  lastPopupNotify.delete(tabId);
  captureStarting.delete(tabId);
  await removeTabConfig(tabId);
  if (wasCapturing) {
    try { await stopTabCapture(tabId); } catch (_) { /* ignore */ }
    await rebalanceCaptures(null);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  (async () => {
    await resolveAndPin(tabId);
    // Same path as setConfig — badge + capture/element soft-handoff (passive, do not steal active capture)
    await applyConfigToTab(tabId, { force: false });
  })().catch(err => console.warn('onActivated apply failed', err));
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  try {
    if (changeInfo.status === 'loading' && activeCaptures.has(tabId)) {
      await stopTabCapture(tabId);
      const cfg = await getTabConfig(tabId);
      applyBadge(tabId, cfg, false);
      await pushConfigToTab(tabId, cfg);
      await rebalanceCaptures(null);
      return;
    }
    // Audible tab that wants HQ should reclaim Best quality if no tab is currently capturing
    if (typeof changeInfo.audible === 'boolean') {
      await rebalanceCaptures(changeInfo.audible ? tabId : null, { force: false });
      return;
    }
    if (changeInfo.status !== 'complete' && !changeInfo.url) return;
    // When Chrome exposes changeInfo.url, seed domain memory before apply
    // (often missing without host_permissions — content pageReady is the fallback).
    const hostHint = changeInfo.url ? hostFromUrl(changeInfo.url) : null;
    if (hostHint) await resolveAndPin(tabId, hostHint);
    await applyConfigToTab(tabId, { force: false });
  } catch (_) { /* ignore */ }
});
