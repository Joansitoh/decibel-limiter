import { test, expect } from './fixtures.mjs';
import { recordTrace, writeAudioReport, writeReportsIndex, summarize } from './report.mjs';

const CEILING = -20;

async function setLimiter(extMessage, tabId, cfg) {
  await extMessage({
    type: 'setConfig',
    tabId,
    enabled: true,
    audioPath: 'element',
    scenario: 'custom',
    limiterStrength: 'normal',
    limitDB: CEILING,
    levelingEnabled: false,
    levelingProfile: null,
    ...cfg
  });
}

async function waitForMeter(extMessage, tabId, timeout = 15_000) {
  await expect
    .poll(async () => {
      const m = await extMessage({ type: 'getCurrentDB', tabId });
      return typeof m?.db === 'number' && Number.isFinite(m.db) ? m.db : null;
    }, { timeout })
    .not.toBeNull();
}

const indexEntries = [];

test.describe('Informes visuales por escenario', () => {
  test.afterAll(() => {
    if (indexEntries.length) {
      const idx = writeReportsIndex(indexEntries);
      console.log('Índice de informes:', idx);
    }
  });

  test('01 — picos / susto (solo techo, sin igualar)', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    test.setTimeout(90_000);
    const page = await context.newPage();
    await page.goto(`${fixtureServer.origin}/test-audio.html`);
    await page.bringToFront();
    const tabId = await activeTabId();

    const config = {
      enabled: true,
      limitDB: CEILING,
      levelingEnabled: false,
      levelingProfile: null,
      limiterStrength: 'normal',
      audioPath: 'element',
      scenario: 'custom'
    };
    await setLimiter(extMessage, tabId, config);
    await page.bringToFront();
    await page.click('body');

    const program = await page.evaluate(() =>
      window.__DL_TEST.playSpikeProgram({
        durationSec: 8,
        bedAmp: 0.08,
        spikeAmp: 0.95,
        spikeMs: 200,
        spikeAtSec: [1.2, 2.8, 4.5, 6.2]
      })
    );

    await waitForMeter(extMessage, tabId);
    const samples = await recordTrace(extMessage, tabId, { ms: 7500, everyMs: 40 });
    const reportPage = await context.newPage();
    const { summary, pass, dir } = await writeAudioReport({
      name: '01-picos-susto',
      title: '01 · Picos / susto — solo techo',
      ceilingDb: CEILING,
      samples,
      page: reportPage,
      passFn: s =>
        s.inPeak > CEILING + 3 &&
        s.outPeak <= CEILING + 1.5 &&
        s.minGainDb < -1 &&
        s.overshootCount < 8,
      scenario: {
        goal:
          'Comprobar que un pico fuerte (casi 0 dBFS) no te asusta: el techo corta el golpe y la salida se queda bajo la línea roja.',
        howToRead:
          'Azul = lo que llega a la extensión. Verde = lo que sale a tus oídos. En cada pico el azul se dispara; el verde debe rozar el techo (−20) y el amarillo baja (el limitador recorta). Entre picos, cama suave: azul y verde parecidos.',
        config,
        audio: {
          source: 'WAV sintético en test-audio.html → <audio> oculto',
          description: `Cama de ruido amp=${program.bedAmp} + 4 picos amp=${program.spikeAmp} a los ${program.spikeAtSec.join(', ')} s (cada uno ~${200} ms).`,
          mutations: [
            { when: 't=0', what: 'Empieza la cama suave' },
            { when: `t=${program.spikeAtSec.join(' / ')}s`, what: 'Picos fuertes inyectados en el WAV (no se tocó un slider a mano)' }
          ]
        },
        expectExplain: `Entrada debe superar el techo con holgura. Salida ≤ ${CEILING + 1.5} dBFS. Ganancia debe caer en los picos.`
      }
    });

    indexEntries.push({
      name: '01-picos-susto',
      title: '01 · Picos / susto',
      pass,
      blurb: 'Leveling OFF. Solo brickwall. ¿Los sustos quedan bajo el techo?'
    });
    console.log('Informe:', dir, summary);
    expect(pass).toBe(true);
  });

  test('02 — techo plano en MP4 (sin igualar)', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    test.setTimeout(90_000);
    const page = await context.newPage();
    await page.goto(`${fixtureServer.origin}/test-video.html`);
    await page.bringToFront();
    const tabId = await activeTabId();

    const config = {
      enabled: true,
      limitDB: CEILING,
      levelingEnabled: false,
      levelingProfile: null,
      limiterStrength: 'normal',
      audioPath: 'element',
      scenario: 'custom'
    };
    await setLimiter(extMessage, tabId, config);
    await page.bringToFront();
    await page.click('body');
    await page.evaluate(() => window.__DL_TEST.play({ fromSec: 0 }));

    await waitForMeter(extMessage, tabId, 20_000);
    const samples = await recordTrace(extMessage, tabId, { ms: 12_000, everyMs: 50 });
    const reportPage = await context.newPage();
    const { summary, pass, dir } = await writeAudioReport({
      name: '02-techo-plano-mp4',
      title: '02 · Techo plano — MP4 real (sin igualar)',
      ceilingDb: CEILING,
      samples,
      page: reportPage,
      passFn: s =>
        s.outPeak != null &&
        (s.inPeak == null || s.inPeak <= CEILING || (s.outPeak <= CEILING + 2 && s.minGainDb < -0.5)),
      scenario: {
        goal:
          'Mismo vídeo real, pero SOLO el techo (Igualar volumen OFF). Debe cortar lo que pasa de −20 sin “aplanar” el resto como un compresor de programa.',
        howToRead:
          'Si el azul está por encima del techo, el verde debe quedar pegado/bajo la línea roja. Las partes ya tranquilas del azul pueden parecerse al verde (no hay makeup de leveling). El amarillo baja solo cuando hace falta cortar.',
        config,
        audio: {
          source: 'tests/videoplayback.mp4 vía test-video.html',
          description: 'Reproducción desde el inicio, volumen del elemento = 1.0, sin mute. No se cambió el volumen a mitad.',
          mutations: [
            { when: 't=0', what: 'Play del MP4 (sin seek)' },
            { when: 'durante el test', what: 'Ningún cambio de volume/currentTime — señal del propio vídeo' }
          ]
        },
        expectExplain:
          'Si el vídeo es ruidoso por encima del techo, la salida no debe pasarse de −18 dBFS y la ganancia debe bajar. Overshoots ≈ 0.'
      }
    });

    indexEntries.push({
      name: '02-techo-plano-mp4',
      title: '02 · Techo plano (MP4)',
      pass,
      blurb: 'Leveling OFF + vídeo real. Solo mira si el techo aguanta.'
    });
    console.log('Informe:', dir, summary);
    expect(pass).toBe(true);
  });

  test('03 — igualar volumen (A/B: ON vs OFF)', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.goto(`${fixtureServer.origin}/test-audio.html`);
    await page.bringToFront();
    const tabId = await activeTabId();

    const dynOpts = { durationSec: 10, quietAmp: 0.04, loudAmp: 0.55, blockSec: 1.5 };

    // B — referencia: solo techo, sin igualar
    const configOff = {
      enabled: true,
      limitDB: CEILING,
      levelingEnabled: false,
      levelingProfile: null,
      limiterStrength: 'normal',
      audioPath: 'element',
      scenario: 'custom'
    };
    await setLimiter(extMessage, tabId, configOff);
    await page.bringToFront();
    await page.click('body');
    await page.evaluate(opts => window.__DL_TEST.playDynamicsProgram(opts), dynOpts);
    await waitForMeter(extMessage, tabId);
    const samplesOff = await recordTrace(extMessage, tabId, { ms: 9500, everyMs: 40 });

    // A — igualar ON, mismo programa de audio
    const configOn = {
      ...configOff,
      levelingEnabled: true,
      levelingProfile: 'balanced'
    };
    await setLimiter(extMessage, tabId, configOn);
    await page.bringToFront();
    await page.click('body');
    await page.evaluate(opts => window.__DL_TEST.playDynamicsProgram(opts), dynOpts);
    await waitForMeter(extMessage, tabId);
    const samplesOn = await recordTrace(extMessage, tabId, { ms: 9500, everyMs: 40 });

    const preOn = summarize(samplesOn, CEILING);
    const preOff = summarize(samplesOff, CEILING);
    const abPass =
      preOn.outPeak <= CEILING + 1.5 &&
      preOn.outRange != null &&
      preOff.outRange != null &&
      preOn.outRange < preOff.outRange - 1.5;

    const reportPage = await context.newPage();
    const { summary, compareSummary, pass, dir } = await writeAudioReport({
      name: '03-igualar-volumen',
      title: '03 · Igualar volumen — A/B mismo audio',
      ceilingDb: CEILING,
      samples: samplesOn,
      compare: {
        samples: samplesOff,
        title: '03 · Referencia B — Igualar OFF (solo techo)'
      },
      page: reportPage,
      passFn: () => abPass,
      scenario: {
        goal:
          '¿“Igualar volumen” hace que bloques flojos/fuertes suenen más parejos? Comparamos el MISMO audio dos veces: A con igualar ON, B con igualar OFF.',
        howToRead:
          'Gráfico A (arriba): igualar ON. El verde debería variar menos entre tramos flojos y fuertes. Ambos deben respetar el techo rojo.',
        compareHowToRead:
          'Gráfico B (referencia): igualar OFF. El verde sigue más los escalones fuerte/flojo (solo corta el techo). Si igualar funciona, el rango de salida de A es menor que el de B.',
        config: configOn,
        audio: {
          source: 'WAV sintético (playDynamicsProgram) — misma secuencia en A y B',
          description: `Alterna quiet=${dynOpts.quietAmp} / loud=${dynOpts.loudAmp} cada ${dynOpts.blockSec}s × ${dynOpts.durationSec}s. Primero se graba B (OFF), luego A (ON).`,
          mutations: [
            { when: 'pasada B', what: 'Igualar OFF + play dynamics' },
            { when: 'pasada A', what: 'Igualar ON (perfil balanced) + mismo play dynamics' }
          ]
        },
        expectExplain:
          'Rango de salida con igualar ON debe ser ≥1.5 dB menor que con igualar OFF. Techo respetado en ambos.',
        verdictText: abPass
          ? `PASS — rango salida ON ${preOn.outRange.toFixed(1)} dB < OFF ${preOff.outRange.toFixed(1)} dB (más parejo con igualar).`
          : `FAIL — ON ${preOn.outRange?.toFixed(1)} dB vs OFF ${preOff.outRange?.toFixed(1)} dB (se esperaba ON más bajo).`
      }
    });

    // Custom verdict after we know numbers
    indexEntries.push({
      name: '03-igualar-volumen',
      title: '03 · Igualar volumen (A/B)',
      pass,
      blurb: `ON rango ${summary.outRange?.toFixed(1)} dB vs OFF ${compareSummary?.outRange?.toFixed(1)} dB`
    });
    console.log('Informe:', dir, { on: summary, off: compareSummary });
    expect(pass).toBe(true);
  });

  test('05 — igualar: volume del MP4 + cambio de techo', async ({
    context,
    fixtureServer,
    extMessage,
    activeTabId
  }) => {
    test.setTimeout(150_000);
    const page = await context.newPage();
    await page.goto(`${fixtureServer.origin}/test-video.html`);
    await page.bringToFront();
    const tabId = await activeTabId();

    const CEIL_A = -20;
    const CEIL_B = -32;
    const VOL_LOW = 0.3;
    const phaseMs = 4000;

    async function runScript(levelingOn) {
      await setLimiter(extMessage, tabId, {
        enabled: true,
        limitDB: CEIL_A,
        levelingEnabled: levelingOn,
        levelingProfile: levelingOn ? 'balanced' : null,
        limiterStrength: 'normal',
        audioPath: 'element',
        scenario: 'custom'
      });
      await page.bringToFront();
      await page.click('body');
      await page.evaluate(() => window.__DL_TEST.setVolume(1));
      await page.evaluate(() => window.__DL_TEST.play({ fromSec: 0 }));
      await waitForMeter(extMessage, tabId, 20_000);

      // P1: vol alto, techo -20
      const p1 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });
      // P2: bajar volume del vídeo, mismo techo
      await page.evaluate(v => window.__DL_TEST.setVolume(v), VOL_LOW);
      await page.waitForTimeout(350);
      const p2 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });
      // P3: cambiar techo del limiter (igualar a otro nivel de techo)
      await setLimiter(extMessage, tabId, {
        enabled: true,
        limitDB: CEIL_B,
        levelingEnabled: levelingOn,
        levelingProfile: levelingOn ? 'balanced' : null,
        limiterStrength: 'normal',
        audioPath: 'element',
        scenario: 'custom'
      });
      await page.waitForTimeout(350);
      const p3 = await recordTrace(extMessage, tabId, { ms: phaseMs, everyMs: 50 });
      // P4: subir volume otra vez con techo nuevo
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

    const volStepDb = 20 * Math.log10(VOL_LOW);
    const cushionsVol =
      on.dropVol != null && off.dropVol != null && on.dropVol < off.dropVol - 1.0;
    const respectsCeilA =
      on.s1.outPeak <= CEIL_A + 1.5 && on.s2.outPeak <= CEIL_A + 1.5;
    const respectsCeilB =
      on.s3.outPeak <= CEIL_B + 1.5 && on.s4.outPeak <= CEIL_B + 1.5;
    // Tras bajar el techo, con vol alto (p4) el pico de salida debe situarse cerca del nuevo techo
    // (no quedarse en el viejo −20).
    const followsNewCeiling =
      on.s4.outPeak != null &&
      on.s4.outPeak <= CEIL_B + 1.5 &&
      on.s4.outPeak > CEIL_B - 8;

    const pass =
      cushionsVol && respectsCeilA && respectsCeilB && followsNewCeiling;

    const reportPage = await context.newPage();
    const { dir, summary } = await writeAudioReport({
      name: '05-igualar-volume-y-techo',
      title: '05 · Igualar: volume del MP4 + cambio de techo',
      ceilingDb: CEIL_A,
      samples: on.stitch,
      chart: { markers: on.markers, ceilingSpans: on.ceilingSpans },
      compare: {
        samples: off.stitch,
        title: '05 · Referencia — Igualar OFF (mismos cambios)',
        markers: off.markers,
        ceilingSpans: off.ceilingSpans,
        ceilingDb: CEIL_A
      },
      page: reportPage,
      passFn: () => pass,
      scenario: {
        goal:
          'Cambiar el volume del <video> y a mitad el techo del limitador, con Igualar ON, para ver si la salida se reajusta.',
        howToRead:
          'Líneas verticales = cambios. Rojo segmentado = techo −20 luego −32. Azul=entrada del limitador, verde=salida. Con igualar, al bajar volume el verde no debería hundirse tanto como sin igualar; al bajar el techo, el verde debe respetar el nuevo máximo.',
        compareHowToRead:
          'Misma coreografía con Igualar OFF: el bajón de volume se nota más en el verde.',
        config: {
          enabled: true,
          limitDB: `${CEIL_A} → ${CEIL_B}`,
          levelingEnabled: true,
          levelingProfile: 'balanced',
          limiterStrength: 'normal',
          audioPath: 'element',
          scenario: 'custom'
        },
        audio: {
          source: 'tests/videoplayback.mp4',
          description: `4 fases × ~${phaseMs / 1000}s: vol1/${CEIL_A} → vol${VOL_LOW}/${CEIL_A} → vol${VOL_LOW}/${CEIL_B} → vol1/${CEIL_B}.`,
          mutations: [
            { when: 'fase 1', what: `video.volume=1, techo ${CEIL_A}` },
            { when: 'fase 2', what: `video.volume=${VOL_LOW}, techo ${CEIL_A}` },
            { when: 'fase 3', what: `video.volume=${VOL_LOW}, techo ${CEIL_B} (setConfig)` },
            { when: 'fase 4', what: `video.volume=1, techo ${CEIL_B}` }
          ]
        },
        expectExplain:
          `Paso volume ≈ ${volStepDb.toFixed(1)} dB. Drop media OUT con igualar=${on.dropVol?.toFixed(1)} dB vs sin=${off.dropVol?.toFixed(1)} dB. ` +
          `Picos OUT fase4 (techo ${CEIL_B}): ${on.s4.outPeak?.toFixed(1)} dB.`,
        verdictText: pass
          ? `PASS — igualar amortigua el volume (${on.dropVol.toFixed(1)} < ${off.dropVol.toFixed(1)} dB) y el techo nuevo se respeta (pico fase4 ${on.s4.outPeak.toFixed(1)}).`
          : `FAIL — drop ON ${on.dropVol?.toFixed(1)} / OFF ${off.dropVol?.toFixed(1)}; ` +
            `techos A ok=${respectsCeilA} B ok=${respectsCeilB}; sigue techo nuevo=${followsNewCeiling}.`
      }
    });

    indexEntries.push({
      name: '05-igualar-volume-y-techo',
      title: '05 · Igualar: volume + techo',
      pass,
      blurb: `drop ON ${on.dropVol?.toFixed(1)} vs OFF ${off.dropVol?.toFixed(1)}; techo ${CEIL_A}→${CEIL_B}`
    });
    console.log('Informe:', dir, { on, off: { dropVol: off.dropVol, s4: off.s4 }, summary, pass });
    expect(pass).toBe(true);
  });
});



