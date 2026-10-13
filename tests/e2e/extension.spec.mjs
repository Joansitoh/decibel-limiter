import { test, expect } from './fixtures.mjs';

function finiteDb(sample) {
  const v = [sample?.averageDB, sample?.db].find(x => typeof x === 'number' && Number.isFinite(x));
  return v != null && v > -80 ? v : null;
}

test.describe('Decibel Limiter live', () => {
  test('popup UI loads', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#mainToggle')).toBeVisible();
    await expect(popup.locator('#statusLine')).toBeVisible();
  });

  test('element path meters live audio from test page', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    const page = await context.newPage();
    const url = `${fixtureServer.origin}/test-audio.html`;
    await page.goto(url);

    await page.click('#btnStart');
    await expect(page.locator('#btnStop')).toBeEnabled();
    await page.waitForFunction(() => window.__DL_TEST?.isRunning?.() === true);
    await page.bringToFront();

    const tabId = await activeTabId();

    await extMessage({
      type: 'setConfig',
      tabId,
      enabled: true,
      audioPath: 'element',
      limitDB: -20,
      scenario: 'balanced',
      levelingEnabled: true
    });

    await page.bringToFront();
    await page.click('body');

    await expect
      .poll(async () => finiteDb(await extMessage({ type: 'getCurrentDB', tabId })), {
        timeout: 25_000
      })
      .not.toBeNull();

    const cfg = await extMessage({ type: 'getConfig', tabId });
    expect(cfg.enabled).toBe(true);
    expect(cfg.audioPath).toBe('element');
    expect(cfg.captureActive).toBe(false);
  });

  test('best-quality preference soft-handoffs when tabCapture unavailable', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    // tabCapture often cannot start under Playwright; product soft-handoffs to element path.
    const page = await context.newPage();
    const url = `${fixtureServer.origin}/test-audio.html`;
    await page.goto(url);
    await page.click('#btnStart');
    await page.waitForFunction(() => window.__DL_TEST?.isRunning?.() === true);
    await page.bringToFront();

    const tabId = await activeTabId();
    await extMessage({
      type: 'setConfig',
      tabId,
      enabled: true,
      audioPath: 'capture',
      limitDB: -20,
      scenario: 'balanced'
    });

    await page.bringToFront();
    await page.click('body');

    const cfg = await extMessage({ type: 'getConfig', tabId });
    expect(cfg.enabled).toBe(true);
    expect(cfg.captureEnabled).toBe(true);

    await expect
      .poll(async () => finiteDb(await extMessage({ type: 'getCurrentDB', tabId })), {
        timeout: 25_000
      })
      .not.toBeNull();
  });
});
