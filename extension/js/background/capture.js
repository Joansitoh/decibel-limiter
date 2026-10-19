/**
 * @file Background capture — exclusive Best quality + soft handoff
 * Must be importScripts'd after presets.js + storage.js.
 */

const activeCaptures = new Map();
const captureStarting = new Set();

/** Same path wording as the popup: active / on another tab (really) / paused / Fullscreen-friendly. */
function badgeFor(cfg, captureActive) {
  const t = key => chrome.i18n.getMessage(key);
  const name = t('extensionName');
  if (!cfg.enabled) return { text: '', title: name };
  let pathKey = 'pathElement';
  if (captureActive) pathKey = 'pathCapture';
  else if (self.DLPresets.wantsCapture(cfg)) pathKey = activeCaptures.size ? 'statusPathStandby' : 'statusPathPaused';
  return {
    text: captureActive ? 'HQ' : 'ON',
    title: `${name} — ${t('powerOnLabel')} · ${t(pathKey)}`,
    color: '#2ecc71'
  };
}

function applyBadge(tabId, cfg, captureActive = activeCaptures.has(tabId)) {
  const b = badgeFor(cfg, captureActive);
  chrome.action.setBadgeText({ tabId, text: b.text });
  if (b.color) chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
  chrome.action.setTitle({ tabId, title: b.title });
}

/** Push config + runtime captureActive so content can soft-handoff to element path. */
async function pushConfigToTab(tabId, cfg) {
  try {
    await chromeAsync.sendMessageTab(tabId, {
      type: 'setConfig',
      ...cfg,
      captureActive: activeCaptures.has(tabId)
    });
  } catch (_) { /* no content script */ }
}

async function wantsCaptureTab(tabId) {
  try {
    return self.DLPresets.wantsCapture(await getTabConfig(tabId));
  } catch (_) {
    return false; // tab gone
  }
}

/**
 * Pick the single Best-quality owner among tabs that want capture.
 * If force is true and preferTabId is set (user clicked a button in popup / shortcut), it wins.
 * Otherwise, if a tab already has active capture and still wants HQ, it KEEPS it
 * so that switching tabs or opening new tabs does not disrupt the currently playing audio.
 */
async function pickHqOwner(preferTabId = null, { force = false } = {}) {
  if (force && preferTabId != null && await wantsCaptureTab(preferTabId)) return preferTabId;

  // Preserve existing active capture if the tab is still alive and wants capture
  for (const activeTabId of activeCaptures.keys()) {
    try {
      await chrome.tabs.get(activeTabId);
      if (await wantsCaptureTab(activeTabId)) return activeTabId;
    } catch (_) { /* tab closed or gone */ }
  }

  if (preferTabId != null && await wantsCaptureTab(preferTabId)) return preferTabId;

  const tabs = (await chrome.tabs.query({})).filter(t => t.id != null);
  const wants = await Promise.all(tabs.map(t => wantsCaptureTab(t.id)));
  let best = null;
  let bestScore = -1;
  tabs.forEach((tab, i) => {
    if (!wants[i]) return;
    const score = (tab.audible ? 100 : 0) + (tab.active ? 50 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = tab.id;
    }
  });
  return best;
}

/**
 * Exclusive Best quality: at most one tabCapture.
 * Other enabled tabs that prefer HQ stay protected via element path (soft handoff).
 */
async function rebalanceCaptures(preferTabId = null, { force = false } = {}) {
  const owner = await pickHqOwner(preferTabId, { force });

  for (const id of [...activeCaptures.keys()]) {
    if (id !== owner) {
      try { await stopTabCapture(id); } catch (_) { /* ignore */ }
    }
  }

  if (owner != null) await claimHq(owner);

  // After the owner settled, so badges can tell "on another tab" from "paused".
  // Every tab gets its config: one that just turned off must bypass its element graphs too.
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    if (tab.id == null || tab.id === owner) return;
    const cfg = await getTabConfig(tab.id);
    applyBadge(tab.id, cfg, false);
    await pushConfigToTab(tab.id, cfg);
  }));
}

/** Start (or refresh) Best quality on the chosen owner; soft-handoff to element on failure. */
async function claimHq(owner) {
  const cfg = await getTabConfig(owner);
  // Ensure domain-derived config is pinned to this tab so the next activate sees it.
  try { await setTabConfig(owner, cfg); } catch (_) { /* ignore */ }

  if (!activeCaptures.has(owner) && !captureStarting.has(owner)) {
    try {
      await startTabCapture(owner);
    } catch (e) {
      // Soft handoff (e.g. no gesture yet): keep the HQ preference — popup / next
      // focus can retry — and protect via the element path meanwhile.
      console.warn('tabCapture unavailable — soft element handoff', e);
      applyBadge(owner, cfg, false);
      await pushConfigToTab(owner, cfg);
      return;
    }
  } else if (activeCaptures.has(owner)) {
    try { await chrome.runtime.sendMessage({ type: 'update-config', config: cfg }); } catch (_) { /* ignore */ }
  }
  applyBadge(owner, cfg, activeCaptures.has(owner));
  await pushConfigToTab(owner, cfg);
}

async function applyConfigToTab(tabId, { force = false } = {}) {
  const cfg = await getTabConfig(tabId);
  if (self.DLPresets.wantsCapture(cfg)) {
    await rebalanceCaptures(tabId, { force });
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
    if (!existingContexts.some(c => c.contextType === 'OFFSCREEN_DOCUMENT')) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio processing for decibel limiting',
      });
    }

    // Config travels with start-capture — streamId expires in seconds, so the
    // worklet must not wait for a second message to get enabled/limitDB.
    const startResp = await chrome.runtime.sendMessage({
      type: 'start-capture',
      streamId,
      tabId,
      config: await getTabConfig(tabId)
    });
    if (startResp?.error) throw new Error(String(startResp.error));

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
