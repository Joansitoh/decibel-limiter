import path from 'path';
import http from 'http';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { test as base, chromium } from '@playwright/test';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const extensionPath = path.join(root, 'extension');
const testsDir = path.join(root, 'tests');

/**
 * HQ harness: local host_permissions + a commands shortcut used to *invoke*
 * the extension (tabCapture requires that; Playwright's page.keyboard does not
 * fire extension shortcuts — we use OS SendKeys on Windows).
 * Production manifest is not modified.
 */
function prepareHqExtensionHarness() {
  const dest = path.join(root, 'test-results', '_extension-hq-harness');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(extensionPath, dest, { recursive: true });
  const mfPath = path.join(dest, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  mf.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
  mf.commands = {
    ...(mf.commands || {}),
    'invoke-for-capture': {
      suggested_key: { default: 'Alt+Shift+U', windows: 'Alt+Shift+U' },
      description: 'Invoke extension (HQ e2e harness)'
    }
  };
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
  return dest;
}

/** Windows: Alt+Shift+U → chrome.commands invoke-for-capture (grants activeTab). */
export async function sendExtensionInvokeHotkey() {
  if (process.platform !== 'win32') {
    throw new Error('HQ harness hotkey only implemented on Windows (SendKeys)');
  }
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    // % = Alt, + = Shift in System.Windows.Forms.SendKeys
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%+u')`
  ]);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  if (filePath.endsWith('.webm')) return 'video/webm';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

/** Stream file with optional Range (needed for video seek). */
function sendFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = contentType(filePath);
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.writeHead(416);
        res.end();
        return;
      }
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/** Tiny static server for tests/ (no extra deps). */
async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(testsDir, safe === path.sep || safe === '/' ? 'test-audio.html' : safe);
    if (!filePath.startsWith(testsDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    sendFile(req, res, filePath);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

async function serviceWorker(context) {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  return sw;
}

/** Extension page used as a messaging bridge (SW cannot sendMessage to itself). */
async function bridgePage(context, extensionId) {
  const url = `chrome-extension://${extensionId}/popup.html`;
  const existing = context.pages().find(p => p.url().startsWith(url));
  if (existing) return existing;
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

/** Talk to the extension SW via an extension page. */
async function extMessage(context, extensionId, message) {
  const bridge = await bridgePage(context, extensionId);
  return bridge.evaluate(async msg => {
    return await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, resp => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(resp);
      });
    });
  }, message);
}

/**
 * Resolve Chrome tabId. Manifest has no "tabs" permission, so tab.url is often
 * stripped — prefer the focused tab after the test page called bringToFront().
 */
async function activeTabId(context) {
  const sw = await serviceWorker(context);
  return sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error('No active Chrome tab');
    return tab.id;
  });
}

export const test = base.extend({
  // Disable default context; we launch our own with the extension.
  context: async ({}, use, testInfo) => {
    const ext =
      testInfo.project.name === 'hq-manual'
        ? prepareHqExtensionHarness()
        : extensionPath;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: false,
      args: [
        `--disable-extensions-except=${ext}`,
        `--load-extension=${ext}`,
        '--autoplay-policy=no-user-gesture-required'
      ]
    });
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const sw = await serviceWorker(context);
    await use(sw.url().split('/')[2]);
  },

  fixtureServer: async ({}, use) => {
    const server = await startFixtureServer();
    await use(server);
    await server.close();
  },

  extMessage: async ({ context, extensionId }, use) => {
    await use(msg => extMessage(context, extensionId, msg));
  },

  activeTabId: async ({ context }, use) => {
    await use(() => activeTabId(context));
  }
});

export const expect = test.expect;
