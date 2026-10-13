/**
 * @file Background capture — exclusive Best quality + soft handoff
 * Must be importScripts'd after presets.js + storage.js.
 */

const activeCaptures = new Map();
const captureStarting = new Set();

function badgeFor(cfg, captureActive) {
  if (!cfg.enabled) return { text: '', title: 'Decibel Limiter' };
  if (captureActive) {
    return { text: 'HQ', title: 'Decibel Limiter — Best quality', color: '#2ecc71' };
  }
  if (self.DLPresets.wantsCapture(cfg)) {
    return {
      text: 'ON',
      title: 'Decibel Limiter — Enabled (Best quality on another tab)',
      color: '#2ecc71'
    };
  }
  return { text: 'ON', title: 'Decibel Limiter — Enabled', color: '#2ecc71' };
}

function applyBadge(tabId, cfg, captureActive = activeCaptures.has(tabId)) {
  const b = badgeFor(cfg, captureActive);
  chrome.action.setBadgeText({ tabId, text: b.text });
  if (b.color) chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
  chrome.action.setTitle({ tabId, title: b.title });
}

/** Push config + runtime captureActive so content can soft-handoff to element path. */
async function pushConfigToTab(tabId, cfg, extra = {}) {
  try {
    await chromeAsync.sendMessageTab(tabId, {
      type: 'setConfig',
      ...cfg,
      captureActive: activeCaptures.has(tabId),
      ...extra
    });
  } catch (_) { /* no content script */ }
}

/**
 * Pick the single Best-quality owner among tabs that want capture.
 * If preferTabId is set (user focused that tab), it wins when it wants HQ —
 * otherwise background "audible" would keep capture and the focused tab stays bare
 * until the popup is opened.
 */
async function pickHqOwner(preferTabId = null) {
  if (preferTabId != null) {
    try {
      const preferCfg = await getTabConfig(preferTabId);
      if (self.DLPresets.wantsCapture(preferCfg)) return preferTabId;
    } catch (_) { /* tab gone */ }
  }

  const tabs = await chrome.tabs.query({});
  let best = null;
  let bestScore = -1;
  for (const tab of tabs) {
    if (tab.id == null) continue;
    const cfg = await getTabConfig(tab.id);
    if (!self.DLPresets.wantsCapture(cfg)) continue;
    let score = 0;
    if (tab.audible) score += 100;
    if (tab.active) score += 50;
    if (score > bestScore) {
      bestScore = score;
      best = tab.id;
    }
  }
  return best;
}

/**
 * Soft handoff when capture can't start (e.g. no gesture yet): keep HQ preference,
 * protect via element path. Only permanently flip audioPath when `permanent` is true.
 */
async function fallbackCaptureToElement(tabId, cfg, err, { permanent = false } = {}) {
  if (permanent && (cfg.audioPath === 'auto' || cfg.audioPath === 'capture')) {
    const fallback = self.DLPresets.migrateConfig({ ...cfg, audioPath: 'element', captureEnabled: false });
    await setTabConfig(tabId, fallback);
    const host = await tabHost(tabId);
    if (host && !fallback.global) await setDomainConfig(host, fallback);
    applyBadge(tabId, fallback, false);
    await pushConfigToTab(tabId, fallback, { captureError: String(err?.message || err) });
    return;
  }
  console.warn('tabCapture unavailable — soft element handoff', err);
  applyBadge(tabId, cfg, false);
  await pushConfigToTab(tabId, cfg);
}

/**
 * Exclusive Best quality: at most one tabCapture.
 * Other enabled tabs that prefer HQ stay protected via element path (soft handoff).
 */
async function rebalanceCaptures(preferTabId = null) {
  const owner = await pickHqOwner(preferTabId);

  for (const id of [...activeCaptures.keys()]) {
    if (id !== owner) {
      try { await stopTabCapture(id); } catch (_) { /* ignore */ }
    }
  }

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null || tab.id === owner) continue;
    const cfg = await getTabConfig(tab.id);
    if (!cfg.enabled && !self.DLPresets.wantsCapture(cfg)) {
      applyBadge(tab.id, cfg, false);
      continue;
    }
    if (self.DLPresets.wantsCapture(cfg) || cfg.enabled) {
      applyBadge(tab.id, cfg, false);
      await pushConfigToTab(tab.id, cfg);
    }
  }

  if (owner == null) return;

  const cfg = await getTabConfig(owner);
  // Ensure domain-derived config is pinned to this tab so the next activate sees it.
  try { await setTabConfig(owner, cfg); } catch (_) { /* ignore */ }

  if (!activeCaptures.has(owner) && !captureStarting.has(owner)) {
    try {
      await startTabCapture(owner);
    } catch (e) {
      // Don't rewrite domain to element — popup / next focus can retry HQ.
      await fallbackCaptureToElement(owner, cfg, e, { permanent: false });
      return;
    }
  } else if (activeCaptures.has(owner)) {
    try { await chrome.runtime.sendMessage({ type: 'update-config', config: cfg }); } catch (_) { /* ignore */ }
  }
  applyBadge(owner, cfg, activeCaptures.has(owner));
  await pushConfigToTab(owner, cfg);
}

async function applyConfigToTab(tabId) {
  const cfg = await getTabConfig(tabId);
  if (self.DLPresets.wantsCapture(cfg)) {
    await rebalanceCaptures(tabId);
    return;
  }
  if (activeCaptures.has(tabId)) {
    try { await stopTabCapture(tabId); } catch (_) { /* ignore */ }
  }
  applyBadge(tabId, cfg, false);
  await pushConfigToTab(tabId, cfg);
  // Free the HQ slot for another candidate if any
  await rebalanceCaptures(null);
}

async function startTabCapture(tabId) {
  if (activeCaptures.has(tabId) || captureStarting.has(tabId)) return;
  captureStarting.add(tabId);
  try {
    for (const activeTabId of activeCaptures.keys()) {
      if (activeTabId !== tabId) await stopTabCapture(activeTabId);
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');

    if (!offscreenDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio processing for decibel limiting',
      });
    }

    const config = await getTabConfig(tabId);
    // Pass config in start-capture — streamId expires in seconds; don't rely on a
    // second message before the worklet gets enabled/limitDB.
    const startResp = await chrome.runtime.sendMessage({
      type: 'start-capture',
      streamId,
      tabId,
      config
    });
    if (startResp?.error) {
      throw new Error(String(startResp.error));
    }
    try {
      await chrome.runtime.sendMessage({ type: 'update-config', config });
    } catch (_) { /* offscreen already has config from start-capture */ }

    activeCaptures.set(tabId, { streamId });
  } catch (error) {
    console.error('Failed to start tab capture:', error);
    throw error;
  } finally {
    captureStarting.delete(tabId);
  }
}

async function stopTabCapture(tabId) {
  try {
    await chrome.runtime.sendMessage({ type: 'stop-capture', tabId });
  } catch (error) {
    console.error('Failed to stop tab capture:', error);
  } finally {
    activeCaptures.delete(tabId);
  }
}

