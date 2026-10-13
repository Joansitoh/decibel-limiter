import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const reportsRoot = path.resolve(__dirname, '../../test-results/audio-reports');

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function fmt(n, digits = 1) {
  return finite(n) ? n.toFixed(digits) : '—';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Reconstruct pre-limiter level: outDb ≈ inDb + gainDb */
export function sampleFromMeter(msg, t0) {
  const outDb = finite(msg?.db) ? msg.db : finite(msg?.averageDB) ? msg.averageDB : null;
  const gainDb = finite(msg?.gainDB) ? msg.gainDB : 0;
  const inDb = outDb != null ? outDb - gainDb : null;
  return {
    t: (Date.now() - t0) / 1000,
    inDb,
    outDb,
    gainDb,
    peakDb: finite(msg?.peakDB) ? msg.peakDB : null
  };
}

export async function recordTrace(extMessage, tabId, { ms = 8000, everyMs = 40 } = {}) {
  const t0 = Date.now();
  const samples = [];
  while (Date.now() - t0 < ms) {
    const msg = await extMessage({ type: 'getCurrentDB', tabId });
    samples.push(sampleFromMeter(msg, t0));
    await new Promise(r => setTimeout(r, everyMs));
  }
  return samples;
}

export function summarize(samples, ceilingDb) {
  const outs = samples.map(s => s.outDb).filter(finite);
  const ins = samples.map(s => s.inDb).filter(finite);
  const gains = samples.map(s => s.gainDb).filter(finite);
  const overshoots = outs.filter(v => v > ceilingDb + 0.5);
  const inMean = ins.length ? ins.reduce((a, b) => a + b, 0) / ins.length : null;
  const outMean = outs.length ? outs.reduce((a, b) => a + b, 0) / outs.length : null;
  const inRange = ins.length ? Math.max(...ins) - Math.min(...ins) : null;
  const outRange = outs.length ? Math.max(...outs) - Math.min(...outs) : null;
  return {
    ceilingDb,
    n: samples.length,
    inPeak: ins.length ? Math.max(...ins) : null,
    outPeak: outs.length ? Math.max(...outs) : null,
    inMean,
    outMean,
    inRange,
    outRange,
    minGainDb: gains.length ? Math.min(...gains) : null,
    overshootCount: overshoots.length,
    overshootPeak: overshoots.length ? Math.max(...overshoots) : null
  };
}

function polyline(values, x0, y0, w, h, yMin, yMax) {
  const pts = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!finite(v)) continue;
    const x = x0 + (i / Math.max(1, values.length - 1)) * w;
    const y = y0 + h - ((v - yMin) / (yMax - yMin)) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.length ? pts.join(' ') : `${x0},${y0 + h}`;
}

function chartSvg(samples, {
  ceilingDb,
  title,
  width = 960,
  height = 320,
  /** @type {{ t: number, label: string }[]} */
  markers = [],
  /** @type {{ fromT: number, toT: number, db: number }[]} */
  ceilingSpans = []
}) {
  const pad = { l: 56, r: 24, t: 40, b: 52 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const yMin = -60;
  const yMax = 0;
  const inVals = samples.map(s => s.inDb);
  const outVals = samples.map(s => s.outDb);
  const gainVals = samples.map(s => (finite(s.gainDb) ? Math.max(yMin, s.gainDb) : null));
  const tMax = samples.length ? samples[samples.length - 1].t : 1;
  const xAt = t => pad.l + (Math.max(0, Math.min(tMax, t)) / Math.max(tMax, 1e-6)) * w;
  const yAt = db => pad.t + h - ((db - yMin) / (yMax - yMin)) * h;

  const spans =
    ceilingSpans.length > 0
      ? ceilingSpans
      : [{ fromT: 0, toT: tMax, db: ceilingDb }];

  const ceilingLines = spans
    .map(sp => {
      const x1 = xAt(sp.fromT);
      const x2 = xAt(sp.toT);
      const y = yAt(sp.db);
      return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#ff6b4a" stroke-dasharray="6 4" stroke-width="1.5"/>
  <text x="${(x1 + x2) / 2}" y="${y - 6}" fill="#ff6b4a" font-size="11" text-anchor="middle" font-family="ui-monospace, monospace">techo ${sp.db}</text>`;
    })
    .join('\n');

  const markerLines = markers
    .map(m => {
      const x = xAt(m.t);
      return `<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + h}" stroke="#7a8499" stroke-dasharray="3 3"/>
  <text x="${x + 4}" y="${pad.t + 14}" fill="#a8b0c0" font-size="10" font-family="Segoe UI, system-ui, sans-serif">${escapeHtml(m.label)}</text>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0f1115"/>
  <text x="${pad.l}" y="24" fill="#e8eaef" font-family="Segoe UI, system-ui, sans-serif" font-size="15" font-weight="600">${escapeHtml(title)}</text>
  <rect x="${pad.l}" y="${pad.t}" width="${w}" height="${h}" fill="#161a22" stroke="#2a3140"/>
  ${[0, -20, -40, -60].map(db => {
    const y = yAt(db);
    return `<line x1="${pad.l}" y1="${y}" x2="${pad.l + w}" y2="${y}" stroke="#2a3140"/><text x="${pad.l - 8}" y="${y + 4}" fill="#8b93a7" font-size="11" text-anchor="end" font-family="ui-monospace, monospace">${db}</text>`;
  }).join('')}
  ${ceilingLines}
  ${markerLines}
  <polyline fill="none" stroke="#5b8cff" stroke-width="1.5" points="${polyline(inVals, pad.l, pad.t, w, h, yMin, yMax)}"/>
  <polyline fill="none" stroke="#3dd68c" stroke-width="2" points="${polyline(outVals, pad.l, pad.t, w, h, yMin, yMax)}"/>
  <polyline fill="none" stroke="#c9a227" stroke-width="1.25" opacity="0.9" points="${polyline(gainVals, pad.l, pad.t, w, h, yMin, yMax)}"/>
  <text x="${pad.l}" y="${height - 14}" fill="#8b93a7" font-size="11" font-family="Segoe UI, system-ui, sans-serif">0s</text>
  <text x="${pad.l + w}" y="${height - 14}" fill="#8b93a7" font-size="11" text-anchor="end" font-family="Segoe UI, system-ui, sans-serif">${tMax.toFixed(1)}s</text>
  <g font-family="Segoe UI, system-ui, sans-serif" font-size="11">
    <rect x="${pad.l}" y="${height - 36}" width="10" height="10" fill="#5b8cff"/><text x="${pad.l + 14}" y="${height - 27}" fill="#c5c9d3">azul = entrada</text>
    <rect x="${pad.l + 130}" y="${height - 36}" width="10" height="10" fill="#3dd68c"/><text x="${pad.l + 144}" y="${height - 27}" fill="#c5c9d3">verde = salida</text>
    <rect x="${pad.l + 270}" y="${height - 36}" width="10" height="10" fill="#c9a227"/><text x="${pad.l + 284}" y="${height - 27}" fill="#c5c9d3">amarillo = ganancia</text>
  </g>
</svg>`;
}

function onOff(v) {
  return v ? 'ON' : 'OFF';
}

function reportHtml({ title, scenario, summary, chartFile, compareChartFile, compareSummary, pass }) {
  const cfg = scenario.config || {};
  const audio = scenario.audio || {};
  const rows = [
    ['Limitador activo', onOff(cfg.enabled !== false)],
    ['Techo (ceiling)', `${cfg.limitDB} dBFS`],
    ['Igualar volumen (leveling)', onOff(!!cfg.levelingEnabled)],
    ['Perfil leveling', cfg.levelingEnabled ? (cfg.levelingProfile || '—') : 'n/a (apagado)'],
    ['Fuerza del limitador', cfg.limiterStrength || 'normal'],
    ['Ruta de audio', cfg.audioPath || 'element'],
    ['Escenario UI', cfg.scenario || 'custom']
  ];

  const mutations = (audio.mutations || [])
    .map(m => `<li><strong>${escapeHtml(m.when)}</strong> — ${escapeHtml(m.what)}</li>`)
    .join('') || '<li>Sin cambios a mitad del test (misma señal todo el rato).</li>';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font: 15px/1.5 Segoe UI, system-ui, sans-serif; background: #0b0d11; color: #e8eaef; }
    main { max-width: 980px; margin: 0 auto; padding: 28px 24px 48px; }
    h1 { font-size: 1.35rem; margin: 0 0 6px; }
    h2 { font-size: 0.95rem; margin: 28px 0 10px; color: #c5c9d3; text-transform: uppercase; letter-spacing: 0.06em; }
    .lead { color: #a8b0c0; margin: 0 0 18px; max-width: 62ch; }
    .verdict { padding: 12px 16px; border-radius: 10px; margin: 0 0 20px; font-weight: 600;
      background: ${pass ? '#123526' : '#3a1814'}; color: ${pass ? '#3dd68c' : '#ff8a75'};
      border: 1px solid ${pass ? '#1e5c40' : '#6b2a22'}; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
    .card { background: #161a22; border: 1px solid #2a3140; border-radius: 12px; padding: 14px 16px; }
    .card p { margin: 0 0 8px; color: #c5c9d3; }
    .card p:last-child { margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a3140; }
    th { color: #8b93a7; font-weight: 500; width: 45%; }
    td { font-variant-numeric: tabular-nums; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
    .stat { background: #12151c; border: 1px solid #2a3140; border-radius: 10px; padding: 10px 12px; }
    .stat b { display: block; font-size: 1.15rem; }
    .stat span { color: #8b93a7; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
    ul { margin: 0; padding-left: 1.2em; color: #c5c9d3; }
    object, img { width: 100%; height: auto; border-radius: 10px; border: 1px solid #2a3140; background: #0f1115; margin-top: 8px; }
    .hint { background: #1a2230; border-left: 3px solid #5b8cff; padding: 10px 14px; border-radius: 0 8px 8px 0; color: #c5c9d3; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(scenario.goal || '')}</p>
    <div class="verdict" id="verdict">${escapeHtml(scenario.verdictText || (pass ? 'PASS' : 'FAIL'))}</div>

    <h2>Cómo leer el gráfico</h2>
    <div class="hint">${escapeHtml(scenario.howToRead || '')}</div>
    <object id="chart" data="${escapeHtml(chartFile)}" type="image/svg+xml" width="960" height="300"></object>
    ${
      compareChartFile
        ? `<h2>Comparación (mismo audio, otro ajuste)</h2>
    <div class="hint">${escapeHtml(scenario.compareHowToRead || '')}</div>
    <object data="${escapeHtml(compareChartFile)}" type="image/svg+xml" width="960" height="300"></object>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><span>Rango salida A</span><b>${fmt(summary.outRange)} dB</b></div>
      <div class="stat"><span>Rango salida B</span><b>${fmt(compareSummary?.outRange)} dB</b></div>
      <div class="stat"><span>Δ rangos</span><b>${fmt(
        finite(summary.outRange) && finite(compareSummary?.outRange)
          ? summary.outRange - compareSummary.outRange
          : null
      )} dB</b></div>
    </div>`
        : ''
    }

    <h2>Ajustes de la extensión en este test</h2>
    <div class="card">
      <table>
        ${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}
      </table>
    </div>

    <h2>Audio de prueba</h2>
    <div class="grid">
      <div class="card">
        <p><strong>Fuente:</strong> ${escapeHtml(audio.source || '—')}</p>
        <p>${escapeHtml(audio.description || '')}</p>
      </div>
      <div class="card">
        <p><strong>¿Se tocó el volumen a mitad?</strong></p>
        <ul>${mutations}</ul>
      </div>
    </div>

    <h2>Números del trazo</h2>
    <div class="stats">
      <div class="stat"><span>Pico entrada</span><b>${fmt(summary.inPeak)}</b></div>
      <div class="stat"><span>Pico salida</span><b>${fmt(summary.outPeak)}</b></div>
      <div class="stat"><span>Media entrada</span><b>${fmt(summary.inMean)}</b></div>
      <div class="stat"><span>Media salida</span><b>${fmt(summary.outMean)}</b></div>
      <div class="stat"><span>Rango entrada</span><b>${fmt(summary.inRange)} dB</b></div>
      <div class="stat"><span>Rango salida</span><b>${fmt(summary.outRange)} dB</b></div>
      <div class="stat"><span>Ganancia mín.</span><b>${fmt(summary.minGainDb)} dB</b></div>
      <div class="stat"><span>Overshoots</span><b>${summary.overshootCount}</b></div>
    </div>

    <h2>Qué debería pasar (y pasó?)</h2>
    <div class="card">
      <p>${escapeHtml(scenario.expectExplain || '')}</p>
    </div>
  </main>
</body>
</html>`;
}

/**
 * @param {object} opts
 * @param {string} opts.name folder under audio-reports/
 * @param {string} opts.title
 * @param {object} opts.scenario human-readable scenario card
 * @param {object[]} opts.samples
 * @param {number} opts.ceilingDb
 * @param {import('@playwright/test').Page} opts.page
 * @param {(summary) => boolean} [opts.passFn]
 */
export async function writeAudioReport({
  name,
  title,
  scenario,
  samples,
  ceilingDb,
  page,
  passFn,
  /** Optional second trace (e.g. leveling OFF) for A/B */
  compare,
  /** Markers / multi-ceiling for the SVG */
  chart = {}
}) {
  const dir = path.join(reportsRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const summary = summarize(samples, ceilingDb);
  const compareSummary = compare ? summarize(compare.samples, compare.ceilingDb ?? ceilingDb) : null;
  const pass = passFn
    ? passFn(summary, compareSummary)
    : summary.overshootCount === 0;
  const chartName = 'levels.svg';
  const compareChartName = compare ? 'levels-compare.svg' : null;
  const chartOpts = {
    ceilingDb,
    markers: chart.markers || [],
    ceilingSpans: chart.ceilingSpans || []
  };
  const fullScenario = {
    ...scenario,
    config: { ...(scenario.config || {}), limitDB: ceilingDb },
    verdictText:
      scenario.verdictText ||
      (pass
        ? `PASS — salida bajo el techo ${ceilingDb} dBFS (tol. +0.5 dB).`
        : `FAIL — ${summary.overshootCount} muestras por encima del techo (pico salida ${fmt(summary.overshootPeak)}).`)
  };

  fs.writeFileSync(
    path.join(dir, chartName),
    chartSvg(samples, {
      ...chartOpts,
      title: compare ? `${title} · A (ajuste bajo prueba)` : title
    })
  );
  if (compare && compareChartName) {
    fs.writeFileSync(
      path.join(dir, compareChartName),
      chartSvg(compare.samples, {
        ceilingDb: compare.ceilingDb ?? ceilingDb,
        markers: compare.markers || chartOpts.markers,
        ceilingSpans: compare.ceilingSpans || chartOpts.ceilingSpans,
        title: compare.title || `${title} · B (referencia)`
      })
    );
  }
  fs.writeFileSync(
    path.join(dir, 'trace.json'),
    JSON.stringify({ scenario: fullScenario, summary, compareSummary, samples, compare }, null, 2)
  );
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    reportHtml({
      title,
      scenario: fullScenario,
      summary,
      chartFile: chartName,
      compareChartFile: compareChartName,
      compareSummary,
      pass
    })
  );

  await page.goto(pathToFileUrl(path.join(dir, 'index.html')));
  await page.locator('#verdict').waitFor();
  await page.screenshot({ path: path.join(dir, 'report.png'), fullPage: true });
  await page.setContent(
    chartSvg(samples, { ...chartOpts, title: compare ? `${title} · A` : title }),
    { waitUntil: 'load' }
  );
  await page.screenshot({ path: path.join(dir, 'levels.png'), fullPage: true });
  if (compare) {
    await page.setContent(
      chartSvg(compare.samples, {
        ceilingDb: compare.ceilingDb ?? ceilingDb,
        markers: compare.markers || chartOpts.markers,
        ceilingSpans: compare.ceilingSpans || chartOpts.ceilingSpans,
        title: compare.title || `${title} · B`
      }),
      { waitUntil: 'load' }
    );
    await page.screenshot({ path: path.join(dir, 'levels-compare.png'), fullPage: true });
  }

  return {
    dir,
    summary,
    compareSummary,
    pass,
    reportPng: path.join(dir, 'report.png'),
    levelsPng: path.join(dir, 'levels.png')
  };
}

/** Index page linking every scenario report. */
export function writeReportsIndex(entries) {
  fs.mkdirSync(reportsRoot, { recursive: true });
  const cards = entries
    .map(
      e => `<a class="card" href="${escapeHtml(e.name)}/index.html">
      <strong>${escapeHtml(e.title)}</strong>
      <span class="${e.pass ? 'ok' : 'bad'}">${e.pass ? 'PASS' : 'FAIL'}</span>
      <p>${escapeHtml(e.blurb || '')}</p>
    </a>`
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/><title>Informes Decibel Limiter</title>
<style>
body{margin:0;font:15px/1.45 Segoe UI,system-ui,sans-serif;background:#0b0d11;color:#e8eaef}
main{max-width:900px;margin:0 auto;padding:32px 24px}
h1{font-size:1.4rem;margin:0 0 8px}
p.lead{color:#8b93a7;margin:0 0 24px}
.list{display:grid;gap:12px}
.card{display:block;padding:16px 18px;border-radius:12px;background:#161a22;border:1px solid #2a3140;color:inherit;text-decoration:none}
.card:hover{border-color:#5b8cff}
.card strong{display:block;margin-bottom:4px}
.card p{margin:8px 0 0;color:#a8b0c0;font-size:0.92rem}
.ok{color:#3dd68c;font-weight:700;font-size:0.8rem}
.bad{color:#ff8a75;font-weight:700;font-size:0.8rem}
</style></head>
<body><main>
<h1>Informes visuales de audio</h1>
<p class="lead">Cada tarjeta es un experimento distinto (ajustes + tipo de audio). Abre una para ver el gráfico y la explicación.</p>
<div class="list">${cards}</div>
</main></body></html>`;
  fs.writeFileSync(path.join(reportsRoot, 'index.html'), html);
  return path.join(reportsRoot, 'index.html');
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p).replace(/\\/g, '/');
  return resolved.startsWith('/') ? `file://${resolved}` : `file:///${resolved}`;
}
