import { test, expect, sendExtensionInvokeHotkey } from './fixtures.mjs';
import { recordTrace, writeAudioReport, summarize } from './report.mjs';

const CEILING = -20;

async function waitForMeter(extMessage, tabId, timeout = 25_000) {
  await expect
    .poll(async () => {
      const m = await extMessage({ type: 'getCurrentDB', tabId });
      return typeof m?.db === 'number' && Number.isFinite(m.db) ? m.db : null;
    }, { timeout })
    .not.toBeNull();
}

/** Invoke extension (activeTab) + start tabCapture with the given limiter config. */
async function activateHqCapture(page, extMessage, tabId, cfg) {
  await page.exposeFunction('__dlActivateHq', async () => {
    try {
      await page.bringToFront();
      await page.click('body').catch(() => {});
      await sendExtensionInvokeHotkey();
      await new Promise(r => setTimeout(r, 400));

      await extMessage({
        type: 'setConfig',
        tabId,
        enabled: true,
        audioPath: 'capture',
        scenario: 'custom',
        limiterStrength: 'normal',
        limitDB: CEILING,
        levelingEnabled: false,
        levelingProfile: null,
        ...cfg
      });

      let state = await extMessage({ type: 'getConfig', tabId });
      if (!state?.captureActive) {
        await extMessage({ type: 'startTabCapture', tabId });
        state = await extMessage({ type: 'getConfig', tabId });
      }

      return {
        ok: state?.captureActive === true,
        cfg: state,
        error: state?.captureActive
          ? null
          : 'captureActive false tras hotkey+setConfig (¿ventana Chromium al frente?)'
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  await page.evaluate(() =>
    window.__DL_TEST.showHqGate(
      'Pulsa el botón (o espera): invoca la extensión con Alt+Shift+U y arranca tabCapture.'
    )
  );

  console.log('\n=== HQ === Deja la ventana Chromium visible; auto-activo en 1s ===\n');
  await page.waitForTimeout(1000);
  await page.locator('#hqActivateBtn').click();

  await expect
    .poll(async () => (await extMessage({ type: 'getConfig', tabId }))?.captureActive === true, {
      timeout: 45_000
    })
    .toBe(true);

  await page.evaluate(() => window.__DL_TEST.hideHqGate());
}

async function setHqConfig(extMessage, tabId, cfg) {
  await extMessage({
    type: 'setConfig',
    tabId,
    enabled: true,
    audioPath: 'capture',
    scenario: 'custom',
    limiterStrength: 'normal',
    ...cfg
  });
}

test.describe('HQ (Best quality)', () => {
  test('04 — Best quality: tabCapture real sobre MP4', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    test.setTimeout(5 * 60_000);

    const page = await context.newPage();
    await page.goto(`${fixtureServer.origin}/test-video.html`);
    await page.bringToFront();
    await page.click('body');
    const tabId = await activeTabId();

    await activateHqCapture(page, extMessage, tabId, {
      limitDB: CEILING,
      levelingEnabled: false
    });

    await page.bringToFront();
    await page.click('body');
    await page.evaluate(() => window.__DL_TEST.play({ fromSec: 0 }));
    await waitForMeter(extMessage, tabId);

    const samples = await recordTrace(extMessage, tabId, { ms: 12_000, everyMs: 50 });
    const still = await extMessage({ type: 'getConfig', tabId });
    console.log('HQ mid-state', still);
    const pre = summarize(samples, CEILING);
    const hqPass =
      still?.captureActive === true &&
      pre.outPeak != null &&
      (pre.inPeak == null || pre.inPeak <= CEILING || pre.outPeak <= CEILING + 2);

    const reportPage = await context.newPage();
    const { summary, pass, dir } = await writeAudioReport({
      name: '04-mejorado-hq',
      title: '04 · Best quality (HQ) — tabCapture real',
      ceilingDb: CEILING,
      samples,
      page: reportPage,
      passFn: () => hqPass,
      scenario: {
        goal:
          'Pipeline real Best quality (tabCapture → offscreen). Chrome exige “invocar” la extensión; el harness usa Alt+Shift+U por SendKeys (el teclado de Playwright no llega a chrome.commands).',
        howToRead: 'Azul entrada, verde salida, rojo techo. Audio por captura de pestaña.',
        config: {
          enabled: true,
          limitDB: CEILING,
          levelingEnabled: false,
          levelingProfile: null,
          limiterStrength: 'normal',
          audioPath: 'capture',
          scenario: 'custom',
          captureActive: still.captureActive
        },
        audio: {
          source: 'tests/videoplayback.mp4',
          description: 'Invoke → HQ on → play 12 s.',
          mutations: [
            { when: 't0', what: 'Alt+Shift+U (OS) + setConfig capture' },
            { when: 'HQ OK', what: 'Play MP4' }
          ]
        },
        expectExplain: 'captureActive true; salida bajo techo si la entrada lo supera.',
        verdictText: hqPass
          ? `PASS — HQ activo. Pico salida ${pre.outPeak.toFixed(1)} dBFS.`
          : `FAIL — captureActive=${still.captureActive}, pico ${pre.outPeak?.toFixed(1) ?? '—'}.`
      }
    });

    console.log('Informe HQ:', dir, summary);
    expect(pass).toBe(true);
  });

  test('06 — HQ igualar: volume del MP4 + cambio de techo', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    test.setTimeout(5 * 60_000);

    const page = await context.newPage();
    await page.goto(`${fixtureServer.origin}/test-video.html`);
    await page.bringToFront();
    await page.click('body');
    const tabId = await activeTabId();

    const CEIL_A = -20;
    const CEIL_B = -32;
    const VOL_LOW = 0.3;
    const phaseMs = 4000;

    await activateHqCapture(page, extMessage, tabId, {
      limitDB: CEIL_A,
      levelingEnabled: false
    });

    async function runScript(levelingOn) {
      await setHqConfig(extMessage, tabId, {
        limitDB: CEIL_A,
        levelingEnabled: levelingOn,
        levelingProfile: levelingOn ? 'balanced' : null
      });
      const still = await extMessage({ type: 'getConfig', tabId });
      if (!still?.captureActive) {
        throw new Error('captureActive false al inicio de runScript');
      }

      await page.bringToFront();
      await page.click('body');
      await page.evaluate(() => window.__DL_TEST.setVolume(1));
      await page.evaluate(() => window.__DL_TEST.play({ fromSec: 0 }));
      await waitForMeter(extMessage, tabId);

      const p1 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });
      await page.evaluate(v => window.__DL_TEST.setVolume(v), VOL_LOW);
      await page.waitForTimeout(350);
      const p2 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });

      await setHqConfig(extMessage, tabId, {
        limitDB: CEIL_B,
        levelingEnabled: levelingOn,
        levelingProfile: levelingOn ? 'balanced' : null
      });
      await page.waitForTimeout(350);
      const p3 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });

      await page.evaluate(() => window.__DL_TEST.setVolume(1));
      await page.waitForTimeout(350);
      const p4 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });

      let tCursor = 0;
      const stitch = [];
      const markers = [];
      const pushPhase = (phase, label) => {
        markers.push({ t: tCursor, label });
        for (const s of phase) stitch.push({ ...s, t: tCursor + s.t });
        tCursor += (phase.length ? phase[phase.length - 1].t : phaseMs / 1000) + 0.35;
      };
      pushPhase(p1, `vol1 techo${CEIL_A}`);
      pushPhase(p2, `vol${VOL_LOW} techo${CEIL_A}`);
      pushPhase(p3, `vol${VOL_LOW} techo${CEIL_B}`);
      pushPhase(p4, `vol1 techo${CEIL_B}`);

      const s1 = summarize(p1, CEIL_A);
      const s2 = summarize(p2, CEIL_A);
      const s3 = summarize(p3, CEIL_B);
      const s4 = summarize(p4, CEIL_B);
      const dropVol =
        s1.outMean != null && s2.outMean != null ? s1.outMean - s2.outMean : null;
      const ceilingSpans = [
        { fromT: 0, toT: markers[2]?.t ?? tCursor / 2, db: CEIL_A },
        { fromT: markers[2]?.t ?? tCursor / 2, toT: tCursor, db: CEIL_B }
      ];
      return { stitch, markers, ceilingSpans, s1, s2, s3, s4, dropVol };
    }

    const off = await runScript(false);
    await page.evaluate(() => window.__DL_TEST.pause());
    const on = await runScript(true);
    const endCfg = await extMessage({ type: 'getConfig', tabId });

    const volStepDb = 20 * Math.log10(VOL_LOW);
    const cushionsVol =
      on.dropVol != null && off.dropVol != null && on.dropVol < off.dropVol - 1.0;
    const respectsCeilA =
      on.s1.outPeak <= CEIL_A + 1.5 && on.s2.outPeak <= CEIL_A + 1.5;
    const respectsCeilB =
      on.s3.outPeak <= CEIL_B + 1.5 && on.s4.outPeak <= CEIL_B + 1.5;
    const followsNewCeiling =
      on.s4.outPeak != null &&
      on.s4.outPeak <= CEIL_B + 1.5 &&
      on.s4.outPeak > CEIL_B - 8;
    const captureOk = endCfg?.captureActive === true;

    const pass =
      captureOk && cushionsVol && respectsCeilA && respectsCeilB && followsNewCeiling;

    const reportPage = await context.newPage();
    const { dir, summary } = await writeAudioReport({
      name: '06-igualar-volume-y-techo-hq',
      title: '06 · HQ Igualar: volume del MP4 + cambio de techo',
      ceilingDb: CEIL_A,
      samples: on.stitch,
      chart: { markers: on.markers, ceilingSpans: on.ceilingSpans },
      compare: {
        samples: off.stitch,
        title: '06 · HQ referencia — Igualar OFF (mismos cambios)',
        markers: off.markers,
        ceilingSpans: off.ceilingSpans,
        ceilingDb: CEIL_A
      },
      page: reportPage,
      passFn: () => pass,
      scenario: {
        goal:
          'Mismo guion que 05, pero por Best quality (tabCapture → offscreen): bajar volume del MP4 y a mitad cambiar el techo.',
        howToRead:
          'Líneas verticales = cambios. Rojo segmentado = techo −20 luego −32. Con igualar ON el verde no debería hundirse tanto al bajar volume; al bajar el techo debe pegarse al nuevo máximo.',
        compareHowToRead:
          'Misma coreografía con Igualar OFF por el pipeline HQ.',
        config: {
          enabled: true,
          limitDB: `${CEIL_A} → ${CEIL_B}`,
          levelingEnabled: true,
          levelingProfile: 'balanced',
          limiterStrength: 'normal',
          audioPath: 'capture',
          scenario: 'custom',
          captureActive: endCfg?.captureActive
        },
        audio: {
          source: 'tests/videoplayback.mp4',
          description: `HQ activo. 4 fases × ~${phaseMs / 1000}s: vol1/${CEIL_A} → vol${VOL_LOW}/${CEIL_A} → vol${VOL_LOW}/${CEIL_B} → vol1/${CEIL_B}.`,
          mutations: [
            { when: 't0', what: 'Alt+Shift+U + tabCapture' },
            { when: 'fase 1', what: `video.volume=1, techo ${CEIL_A}` },
            { when: 'fase 2', what: `video.volume=${VOL_LOW}, techo ${CEIL_A}` },
            { when: 'fase 3', what: `video.volume=${VOL_LOW}, techo ${CEIL_B}` },
            { when: 'fase 4', what: `video.volume=1, techo ${CEIL_B}` }
          ]
        },
        expectExplain:
          `Paso volume ≈ ${volStepDb.toFixed(1)} dB. Drop media OUT con igualar=${on.dropVol?.toFixed(1)} dB vs sin=${off.dropVol?.toFixed(1)} dB. ` +
          `Picos OUT fase4 (techo ${CEIL_B}): ${on.s4.outPeak?.toFixed(1)} dB. captureActive=${endCfg?.captureActive}.`,
        verdictText: pass
          ? `PASS — HQ+igualar amortigua volume (${on.dropVol.toFixed(1)} < ${off.dropVol.toFixed(1)} dB) y techo nuevo ok (pico fase4 ${on.s4.outPeak.toFixed(1)}).`
          : `FAIL — capture=${captureOk}; drop ON ${on.dropVol?.toFixed(1)} / OFF ${off.dropVol?.toFixed(1)}; ` +
            `techos A=${respectsCeilA} B=${respectsCeilB}; sigue techo nuevo=${followsNewCeiling}.`
      }
    });

    console.log('Informe HQ 06:', dir, {
      on: { dropVol: on.dropVol, s1: on.s1, s2: on.s2, s3: on.s3, s4: on.s4 },
      off: { dropVol: off.dropVol, s4: off.s4 },
      summary,
      pass
    });
    expect(pass).toBe(true);
  });
});
