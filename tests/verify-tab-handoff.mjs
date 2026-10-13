/**
 * Verifies multi-tab handoff / domain revive / module wiring without Chrome.
 * Run: node tests/verify-tab-handoff.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const extJs = path.join(root, 'extension', 'js');
const require = createRequire(import.meta.url);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
}

await import(pathToFileURL(path.join(extJs, 'presets.js')).href);
const presets = globalThis.DLPresets;
assert(presets.wantsCapture({ enabled: true, audioPath: 'capture' }) === true, 'wantsCapture capture');
assert(presets.wantsCapture({ enabled: false, audioPath: 'capture' }) === false, 'wantsCapture off');
assert(presets.hostFromUrl('https://www.youtube.com/watch?v=1') === 'youtube.com', 'host strips www');
assert(presets.hostFromUrl('https://music.youtube.com/') === 'music.youtube.com', 'music host distinct');

function loadWorkerScripts() {
  const captureCalls = [];
  const chrome = {
    storage: {
      local: {
        _data: {},
        async get(keys) {
          if (keys == null) return { ...this._data };
          if (typeof keys === 'string') return { [keys]: this._data[keys] };
          const out = {};
          for (const k of keys) out[k] = this._data[k];
          return out;
        },
        async set(obj) { Object.assign(this._data, obj); },
        async remove(keys) {
          for (const k of (Array.isArray(keys) ? keys : [keys])) delete this._data[k];
        }
      }
    },
    tabs: {
      _tabs: new Map(),
      async get(id) {
        const t = this._tabs.get(id);
        if (!t) throw new Error('no tab ' + id);
        return t;
      },
      async query() { return [...this._tabs.values()]; },
      sendMessage(tabId, msg, cb) {
        if (typeof cb === 'function') cb({});
        return Promise.resolve({});
      }
    },
    action: {
      badges: new Map(),
      setBadgeText({ tabId, text }) { this.badges.set(tabId, text); },
      setBadgeBackgroundColor() {},
      setTitle() {}
    },
    runtime: {
      async sendMessage(msg) { captureCalls.push(msg); },
      async getContexts() { return [{ contextType: 'OFFSCREEN_DOCUMENT' }]; }
    },
    tabCapture: {
      async getMediaStreamId({ targetTabId }) {
        captureCalls.push({ type: 'getMediaStreamId', targetTabId });
        return 'stream-' + targetTabId;
      }
    },
    offscreen: { async createDocument() {} }
  };

  const sandbox = {
    chrome,
    console,
    Map,
    Set,
    Object,
    Array,
    Promise,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    URL,
    isFinite,
    Infinity,
    undefined,
    parseInt,
    parseFloat
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  const run = (file, append = '') => {
    const code = fs.readFileSync(path.join(extJs, file), 'utf8') + append;
    vm.runInNewContext(code, sandbox, { filename: file });
  };

  run('presets.js');
  run('background/storage.js', '\n;self.__storage = { getTabConfig, setTabConfig, tabHost, getDomainConfigs };');
  run(
    'background/capture.js',
    '\n;self.__capture = { pickHqOwner, rebalanceCaptures, applyConfigToTab, get activeCaptures() { return activeCaptures; }, badgeFor, applyBadge };'
  );

  return { sandbox, chrome, captureCalls };
}

const { sandbox, chrome, captureCalls } = loadWorkerScripts();
assert(!!sandbox.__storage?.getTabConfig, 'getTabConfig wired');
assert(!!sandbox.__capture?.pickHqOwner, 'pickHqOwner wired');
assert(!!sandbox.DLPresets?.wantsCapture, 'DLPresets on SW self');

chrome.storage.local._data.domain_configs = {
  'youtube.com': presets.migrateConfig({
    enabled: true,
    audioPath: 'capture',
    scenario: 'balanced',
    limitDB: -20
  })
};

chrome.tabs._tabs.set(1, { id: 1, url: 'https://www.youtube.com/watch?v=a', active: false, audible: true });
chrome.storage.local._data.tab_cfg_1 = presets.migrateConfig({
  enabled: true,
  audioPath: 'capture',
  scenario: 'balanced'
});

chrome.tabs._tabs.set(2, { id: 2, url: 'https://www.youtube.com/watch?v=b', active: true, audible: false });
chrome.storage.local._data.tab_cfg_2 = presets.migrateConfig({
  enabled: false,
  audioPath: 'capture'
});

const cfgB = await sandbox.__storage.getTabConfig(2);
assert(cfgB.enabled === true, 'stale disabled tab_cfg revived from domain enabled');
assert(presets.wantsCapture(cfgB) === true, 'revived tab wants capture');

chrome.tabs._tabs.set(3, { id: 3, url: 'https://youtube.com/watch?v=c', active: true, audible: false });
const cfgC = await sandbox.__storage.getTabConfig(3);
assert(cfgC.enabled === true, 'new tab inherits domain enabled');

const owner = await sandbox.__capture.pickHqOwner(2);
assert(owner === 2, `preferTabId wins HQ when no active capture (got ${owner})`);

const ownerAudible = await sandbox.__capture.pickHqOwner(null);
assert(ownerAudible === 1, `without prefer, audible tab wins (got ${ownerAudible})`);

// Setup active capture on Tab 1
sandbox.__capture.activeCaptures.set(1, { streamId: 'stream-1' });
captureCalls.length = 0;
chrome.tabs._tabs.get(1).active = false;
chrome.tabs._tabs.get(2).active = true;

// Passive rebalance on Tab 2 (e.g. switching tabs / onActivated)
await sandbox.__capture.rebalanceCaptures(2, { force: false });
assert(sandbox.__capture.activeCaptures.has(1), 'passive rebalance keeps active capture on tab 1');
assert(!sandbox.__capture.activeCaptures.has(2), 'passive rebalance does not steal capture to tab 2');
assert(chrome.action.badges.get(2) === 'ON', `badge ON on tab 2 while tab 1 holds HQ (got "${chrome.action.badges.get(2)}")`);

// Explicit user action on Tab 2 (e.g. button click / setConfig / force: true)
await sandbox.__capture.rebalanceCaptures(2, { force: true });
assert(sandbox.__capture.activeCaptures.has(2), 'forced rebalance transfers capture to tab 2 on user button press');
assert(!sandbox.__capture.activeCaptures.has(1), 'forced rebalance releases tab 1 capture');
assert(
  captureCalls.some(c => c.type === 'getMediaStreamId' && c.targetTabId === 2),
  'getMediaStreamId requested for focused tab'
);
assert(chrome.action.badges.get(2) === 'HQ', `badge HQ on tab 2 after user action (got "${chrome.action.badges.get(2)}")`);

const domainBefore = chrome.storage.local._data.domain_configs['youtube.com'].audioPath;
chrome.tabCapture.getMediaStreamId = async () => { throw new Error('no gesture'); };
sandbox.__capture.activeCaptures.clear();
captureCalls.length = 0;
await sandbox.__capture.rebalanceCaptures(2);
assert(
  chrome.storage.local._data.domain_configs['youtube.com'].audioPath === domainBefore,
  'failed capture does not rewrite domain to element'
);
assert(chrome.action.badges.get(2) === 'ON', `soft handoff still shows ON badge (got "${chrome.action.badges.get(2)}")`);

// Popup ESM (stub DOM)
globalThis.self = globalThis;
globalThis.DLPresets = presets;
globalThis.localStorage = { getItem: () => 'auto', setItem() {} };
globalThis.document = { documentElement: { dataset: {} } };
globalThis.chrome = {
  i18n: { getMessage: k => k },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: {
    sendMessage: (_m, cb) => { if (typeof cb === 'function') cb(null); },
    lastError: null
  },
  tabs: { query: async () => [{ id: 1, url: 'https://www.youtube.com/' }] }
};

const format = await import(pathToFileURL(path.join(extJs, 'popup', 'format.js')).href);
assert(format.fmtDB(-20) === '−20', 'popup format fmtDB');
assert(format.clampDB(-100) === -60, 'popup format clamp');

const configMod = await import(pathToFileURL(path.join(extJs, 'popup', 'config.js')).href);
assert(typeof configMod.readStoredConfig === 'function', 'popup config readStoredConfig');
assert(typeof configMod.persistConfig === 'function', 'popup config persistConfig');

// Limiter processor unit tests (self-contained)
const { spawnSync } = await import('child_process');
const lim = spawnSync(process.execPath, [path.join(root, 'tests', 'limiter-processor.test.js')], {
  encoding: 'utf8'
});
assert(lim.status === 0, `limiter-processor tests exit 0 (status ${lim.status})`);
if (lim.stdout) console.log(lim.stdout.trim().split('\n').map(l => '  ' + l).join('\n'));

console.log('\n' + (failed ? `${failed} FAILED` : 'ALL CHECKS PASSED'));
process.exit(failed ? 1 : 0);
