/**
 * Chrome Web Store artwork: writes img/store/*.svg and renders *.png at the exact store sizes
 * (screenshots 1280×800, small promo 440×280, marquee 1400×560) using the extension's fonts.
 * Run: node scripts/store-art.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'img', 'store');
const fontsDir = path.join(root, 'extension', 'fonts');
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(root, 'extension', 'icons', 'icon128.png')).toString('base64')}`;

// ——— Design tokens (mirror extension/popup.css) ———
const THEMES = {
  dark: {
    bg: '#111217', surface: '#181b1f', surface2: '#22252b', tube: '#0b0c0e',
    ink: '#ccccdc', ink2: 'rgba(204,204,220,0.75)', ink3: 'rgba(204,204,220,0.55)',
    line: 'rgba(204,204,220,0.12)', lineStrong: 'rgba(204,204,220,0.22)',
    accent: '#ff780a', accentInk: '#ffb375', accentSoft: 'rgba(255,120,10,0.16)', onAccent: '#111217'
  },
  light: {
    bg: '#f4f5f5', surface: '#ffffff', surface2: '#e9edf2', tube: '#dce1e8',
    ink: '#1f2428', ink2: '#52565c', ink3: '#6e737a',
    line: 'rgba(31,36,40,0.10)', lineStrong: 'rgba(31,36,40,0.18)',
    accent: '#ed5700', accentInk: '#c24600', accentSoft: 'rgba(237,87,0,0.14)', onAccent: '#ffffff'
  }
};
const D = THEMES.dark;
const HEAD = '#f3f4f8'; // marketing headline ink (a touch brighter than UI ink)
const SANS = "Outfit, 'Segoe UI', system-ui, sans-serif";
const MONO = "'JetBrains Mono', Consolas, monospace";
const minus = n => String(n).replace('-', '−');

// Icon paths from popup.html (24×24 grid)
const ICONS = {
  moon: '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M19 14.5A7.5 7.5 0 1 1 9.5 5 6 6 0 0 0 19 14.5z"/>',
  balance: '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M12 4v16M5 9h14M7 9l-2 7h6L9 9m6 0-2 7h6l-2-7"/>',
  social: '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M8 10h.01M12 10h.01M16 10h.01M5 18v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1"/><circle cx="12" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.75"/>',
  music: '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.75"/><circle cx="17" cy="16" r="2.5" fill="none" stroke="currentColor" stroke-width="1.75"/>',
  gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.75"/><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M12 3.5v2.2M12 18.3v2.2M4.8 7.2l1.9 1.1M17.3 15.7l1.9 1.1M3.5 12h2.2M18.3 12h2.2M4.8 16.8l1.9-1.1M17.3 8.3l1.9-1.1"/>',
  hq: '<rect x="3.5" y="6" width="17" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.75"/><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M8 10v4M8 12h2a1 1 0 0 0 0-2H8m6 4V10h1.2a1.2 1.2 0 1 1 0 2.4H14"/>',
  fs: '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
  info: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.75"/><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" d="M12 11v5M12 8h.01"/>',
  check: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.75"/><path fill="none" stroke="currentColor" stroke-width="1.75" d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
  bolt: '<path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/>'
};
const icon = (name, x, y, size, color) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" color="${color}">${ICONS[name]}</g>`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, { size = 16, weight = 400, fill = D.ink, font = SANS, anchor = 'start', ls = 0, opacity } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"` +
  `${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${ls ? ` letter-spacing="${ls}"` : ''}` +
  `${opacity != null ? ` opacity="${opacity}"` : ''}>${s}</text>`;

/** Deterministic noise so every build draws the same art. */
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Loud-content envelope (0..1): a speech-like body scaled by `level`, plus sudden
 * spikes that attack instantly and decay over a few bars.
 */
function envelope(n, seed, spikes, level = 0.7) {
  const r = rng(seed);
  const a = [];
  for (let i = 0; i < n; i++) {
    const body = level * (0.24 + 0.1 * Math.sin(i / 7) + 0.07 * Math.sin(i / 2.3) + r() * 0.16);
    let spike = 0;
    for (const [at, peak] of spikes) {
      const d = i - Math.round(at * n);
      if (d >= 0 && d < 14) spike = Math.max(spike, peak * Math.exp(-d / 4.5) * (0.88 + r() * 0.12));
    }
    a.push(Math.min(1, Math.max(body, spike)));
  }
  return a;
}

/** Background motif: the raw signal as a gray ghost, the limited one in orange, fading in from the left. */
function backdropWave(x, cy, width, half, amps, ceiling, gap = 2) {
  return `<g mask="url(#fadeIn)">
    ${bars(x, cy, width, half, amps, { color: '#ccccdc', gap, opacity: 0.1 })}
    ${bars(x, cy, width, half, amps, { color: '#ff780a', ceiling, clamp: true, gap, opacity: 0.42 })}
    <rect x="${x}" y="${cy - ceiling * half - 1}" width="${width}" height="1.5" fill="#ff780a" opacity="0.55"/>
    <rect x="${x}" y="${cy + ceiling * half}" width="${width}" height="1.5" fill="#ff780a" opacity="0.55"/>
  </g>`;
}

/**
 * Mirrored bar waveform centred on cy. `ceiling` (0..1) clamps output bars;
 * `showExcess` paints the part of input bars above the ceiling in red.
 */
function bars(x, cy, width, half, amps, { color, ceiling = null, clamp = false, showExcess = false, gap = 2, opacity = 1 }) {
  const step = width / amps.length;
  const w = Math.max(1, step - gap);
  let out = `<g opacity="${opacity}">`;
  amps.forEach((amp, i) => {
    const a = clamp && ceiling != null ? Math.min(amp, ceiling * (0.94 + 0.06 * Math.sin(i))) : amp;
    const h = Math.max(1.5, a * half);
    const bx = (x + i * step).toFixed(1);
    out += `<rect x="${bx}" y="${(cy - h).toFixed(1)}" width="${w.toFixed(1)}" height="${(2 * h).toFixed(1)}" rx="${Math.min(w / 2, 2).toFixed(1)}" fill="${color}"/>`;
    if (showExcess && ceiling != null && amp > ceiling) {
      const e = (amp - ceiling) * half;
      const c = ceiling * half;
      out += `<rect x="${bx}" y="${(cy - c - e).toFixed(1)}" width="${w.toFixed(1)}" height="${e.toFixed(1)}" fill="#ff4a3d"/>`;
      out += `<rect x="${bx}" y="${(cy + c).toFixed(1)}" width="${w.toFixed(1)}" height="${e.toFixed(1)}" fill="#ff4a3d"/>`;
    }
  });
  return out + '</g>';
}

// ——— Popup mock (380×560, mirrors popup.html layout) ———
const SCEN = {
  night: { name: 'Night', icon: 'moon', meta: 'Even · −26' },
  balanced: { name: 'Balanced', icon: 'balance', meta: 'Even · −20' },
  social: { name: 'Social', icon: 'social', meta: 'Strong even · −30' },
  music: { name: 'Music', icon: 'music', meta: 'Peaks · −12' }
};

function popup({
  id, x, y, scale = 1, theme = 'dark', level = -27, reduction = 4.2, ceiling = -20,
  status = 'Evening volume · Best quality', scenario = 'balanced', even = true,
  site = 'youtube.com', path = 'Best quality', pathIcon = 'hq', on = true
}) {
  const T = THEMES[theme];
  const fy = db => 78 + (-db / 60) * 399;
  const cy = fy(ceiling);
  const ly = fy(level);
  const switchOn = (sx, sy, active) => `
    <rect x="${sx}" y="${sy}" width="46" height="26" rx="13" fill="${active ? T.accent : T.surface2}"/>
    <circle cx="${active ? sx + 33 : sx + 13}" cy="${sy + 13}" r="9.5" fill="${active ? T.onAccent : T.ink3}"/>`;
  // The list scrolls in the real popup: show the three rows around the selected one.
  const visible = scenario === 'music' ? ['balanced', 'social', 'music'] : ['night', 'balanced', 'social'];
  const scenRows = visible.map((k, i) => {
    const ry = 404 + i * 34;
    const sel = k === scenario;
    return `${sel ? `<rect x="138" y="${ry}" width="226" height="30" rx="8" fill="${T.accentSoft}"/>` : ''}
      ${icon(SCEN[k].icon, 146, ry + 6, 18, sel ? T.accentInk : T.ink2)}
      ${text(176, ry + 20, SCEN[k].name, { size: 13.5, weight: sel ? 650 : 550, fill: sel ? T.accentInk : T.ink })}
      ${text(356, ry + 20, minus(SCEN[k].meta), { size: 10, font: MONO, fill: sel ? T.accentInk : T.ink3, anchor: 'end' })}`;
  }).join('');
  const ticks = [0, -20, -40, -60].map(db => text(38, fy(db) + 3.5, minus(db), { size: 9.5, font: MONO, fill: T.ink3, anchor: 'end' })).join('') +
    [-10, -30, -50].map(db => `<rect x="34" y="${fy(db)}" width="4" height="1" fill="${T.ink3}"/>`).join('');

  return `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <defs>
      <clipPath id="${id}-frame"><rect width="380" height="560" rx="18"/></clipPath>
      <clipPath id="${id}-tube"><rect x="52" y="74" width="32" height="408" rx="16"/></clipPath>
      <pattern id="${id}-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill="${T.accentSoft}"/><rect width="3" height="8" fill="${T.accent}" opacity="0.28"/>
      </pattern>
      <linearGradient id="${id}-fill" x1="0" y1="1" x2="0" y2="0">
        <stop stop-color="${T.accent}"/><stop offset="1" stop-color="${theme === 'dark' ? '#ff9830' : '#ff7a1f'}"/>
      </linearGradient>
    </defs>
    <rect width="380" height="560" rx="18" fill="${T.bg}" filter="url(#shadow)"/>
    <g clip-path="url(#${id}-frame)">
      <rect width="380" height="560" fill="${T.bg}"/>
      <image href="${ICON}" x="16" y="15" width="30" height="30"/>
      ${text(56, 29, 'Decibel Limiter', { size: 15, weight: 650, fill: T.ink })}
      ${site ? `${text(56, 45, site, { size: 11.5, fill: T.ink2 })}
        <rect x="${58 + site.length * 6.1}" y="34" width="44" height="15" rx="7.5" fill="${T.accentSoft}"/>
        ${text(80 + site.length * 6.1, 45, 'Saved', { size: 9.5, weight: 600, fill: T.accentInk, anchor: 'middle' })}` : ''}
      ${icon('gear', 337, 21, 18, T.ink2)}

      ${ticks}
      <rect x="52" y="74" width="32" height="408" rx="16" fill="${T.tube}" stroke="${T.line}"/>
      <g clip-path="url(#${id}-tube)">
        <rect x="52" y="74" width="32" height="${cy - 74}" fill="url(#${id}-hatch)"/>
        ${on ? `<rect x="52" y="${ly}" width="32" height="${482 - ly}" fill="url(#${id}-fill)"/>` : ''}
      </g>
      <rect x="40" y="${cy - 1}" width="56" height="2.5" rx="1" fill="${T.accent}"/>
      <rect x="72" y="${cy - 14}" width="56" height="28" rx="8" fill="${T.accent}" filter="url(#glow)"/>
      ${text(100, cy + 5, minus(ceiling), { size: 13, weight: 650, font: MONO, fill: T.onAccent, anchor: 'middle' })}

      ${text(144, 74, esc(status), { size: 11.5, weight: 600, fill: on ? T.accentInk : T.ink2 })}
      <rect x="144" y="90" width="220" height="40" rx="10" fill="${on ? T.accentSoft : T.surface}" stroke="${on ? T.accent : T.line}" stroke-opacity="${on ? 0.55 : 1}"/>
      ${text(158, 115, on ? 'Protecting' : 'Protection off', { size: 13.5, weight: 650, fill: T.ink })}
      ${switchOn(308, 97, on)}

      ${text(144, 158, 'Current level', { size: 11.5, fill: T.ink3 })}
      ${text(144, 198, on ? minus(level) : '−∞', { size: 36, weight: 700, font: MONO, fill: T.ink })}
      ${text(on ? 214 : 192, 198, 'dBFS', { size: 11.5, fill: T.ink3 })}
      ${on ? text(144, 220, `Reduction ${reduction.toFixed(1)} dB`, { size: 11, font: MONO, fill: T.ink2 }) : ''}
      <rect x="144" y="236" width="220" height="1" fill="${T.line}"/>

      ${text(144, 262, 'Ceiling', { size: 14, weight: 650, fill: T.ink })}
      ${text(364, 262, `${minus(ceiling)} dBFS`, { size: 13, weight: 600, font: MONO, fill: T.accentInk, anchor: 'end' })}
      ${text(144, 281, even ? 'Peaks are stopped; quiet and loud parts' : 'Peaks above this are stopped', { size: 11, fill: T.ink3 })}
      ${even ? text(144, 296, 'are also evened out', { size: 11, fill: T.ink3 }) : ''}
      <rect x="144" y="314" width="220" height="1" fill="${T.line}"/>

      ${text(144, 351, 'Even volume', { size: 14, weight: 650, fill: T.ink })}
      ${icon('info', 233, 341, 12, T.ink3)}
      ${switchOn(318, 333, even)}

      ${text(144, 392, 'Scenario', { size: 13.5, weight: 650, fill: T.ink })}
      ${scenRows}

      <rect x="0" y="508" width="380" height="1" fill="${T.line}"/>
      <rect x="14" y="518" width="${Math.max(150, path.length * 7.2 + 52)}" height="30" rx="15" fill="${T.accentSoft}"/>
      ${icon(pathIcon, 26, 525, 16, T.accentInk)}
      ${text(50, 538, path, { size: 12.5, weight: 600, fill: T.accentInk })}
      ${icon('info', Math.max(150, path.length * 7.2 + 52) + 26, 525, 15, T.ink3)}
    </g>
    <rect width="380" height="560" rx="18" fill="none" stroke="${T.lineStrong}"/>
  </g>`;
}

// ——— Shared scene chrome ———
function canvas(w, h, body, { glow = [0.78, 0.42], title, desc }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title>
  <desc id="d">${esc(desc)}</desc>
  <style>
    @font-face { font-family: "Outfit"; font-weight: 100 900; src: url("../../extension/fonts/outfit-latin-wght-normal.woff2") format("woff2"); }
    @font-face { font-family: "JetBrains Mono"; font-weight: 100 800; src: url("../../extension/fonts/jetbrains-mono-latin-wght-normal.woff2") format("woff2"); }
  </style>
  <defs>
    <radialGradient id="halo" cx="${glow[0]}" cy="${glow[1]}" r="0.55">
      <stop stop-color="#ff780a" stop-opacity="0.22"/><stop offset="0.55" stop-color="#ff780a" stop-opacity="0.05"/><stop offset="1" stop-color="#ff780a" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.2" fill="#ccccdc" opacity="0.07"/></pattern>
    <filter id="shadow" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#000" flood-opacity="0.55"/></filter>
    <filter id="glow" x="-50%" y="-80%" width="200%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#ff780a" flood-opacity="0.45"/></filter>
    <linearGradient id="orange" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ff6a00"/><stop offset="1" stop-color="#ffa040"/></linearGradient>
    <linearGradient id="fadeGrad" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#fff" stop-opacity="0"/><stop offset="0.3" stop-color="#fff"/></linearGradient>
    <mask id="fadeIn" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#fadeGrad)"/></mask>
  </defs>
  <rect width="${w}" height="${h}" fill="#0c0d11"/>
  <rect width="${w}" height="${h}" fill="url(#dots)"/>
  <rect width="${w}" height="${h}" fill="url(#halo)"/>
  ${body}
</svg>
`;
}

const brand = (x, y, size = 40) => `
  <image href="${ICON}" x="${x}" y="${y}" width="${size}" height="${size}"/>
  ${text(x + size + 14, y + size * 0.68, 'Decibel Limiter', { size: size * 0.5, weight: 650, fill: HEAD })}`;

const eyebrow = (x, y, s) => text(x, y, s, { size: 14, weight: 650, fill: D.accent, ls: 3 });

function pill(x, y, label, iconName) {
  const w = label.length * 8.4 + (iconName ? 58 : 36);
  return `<rect x="${x}" y="${y}" width="${w}" height="44" rx="22" fill="${D.surface}" stroke="${D.line}"/>
    ${iconName ? icon(iconName, x + 18, y + 12, 20, D.accent) : ''}
    ${text(x + (iconName ? 46 : 18), y + 28, label, { size: 16, weight: 550, fill: D.ink })}`;
}
const pillWidth = (label, iconName) => label.length * 8.4 + (iconName ? 58 : 36);

// ——— Scenes ———
function hero() {
  const amps = envelope(110, 7, [[0.22, 0.95], [0.55, 1], [0.82, 0.9]]);
  let chips = '';
  let cx = 96;
  for (const [label, ic] of [['~10 ms lookahead', 'bolt'], ['Remembers each site', 'globe'], ['Any site, any tab', 'check']]) {
    chips += pill(cx, 572, label, ic);
    cx += pillWidth(label, ic) + 12;
  }
  return canvas(1280, 800, `
    ${backdropWave(560, 430, 720, 170, amps, 0.42, 3)}
    ${brand(96, 112)}
    ${text(92, 290, 'Never hear', { size: 84, weight: 700, fill: HEAD })}
    ${text(92, 384, 'the spike.', { size: 84, weight: 700, fill: 'url(#orange)' })}
    ${text(96, 446, 'A real lookahead limiter for every tab.', { size: 24, fill: D.ink2 })}
    ${text(96, 480, 'Loud ads, jump scares and sudden peaks are', { size: 24, fill: D.ink2 })}
    ${text(96, 514, 'stopped before they reach your ears.', { size: 24, fill: D.ink2 })}
    ${chips}
    ${popup({ id: 'p1', x: 790, y: 96, scale: 1.08 })}
  `, {
    glow: [0.78, 0.5],
    title: 'Decibel Limiter — Never hear the spike',
    desc: 'Headline next to the Decibel Limiter popup: protection on, Balanced scenario, ceiling at −20 dBFS.'
  });
}

function protection() {
  const n = 150;
  const amps = envelope(n, 11, [[0.1, 0.98], [0.36, 0.9], [0.6, 1], [0.84, 0.94]], 0.62);
  const ceil = 0.5;
  const panel = (y, label, sub, inner, tag) => `
    <rect x="96" y="${y}" width="1088" height="196" rx="20" fill="${D.surface}" stroke="${D.line}"/>
    ${text(128, y + 42, label, { size: 20, weight: 650, fill: HEAD })}
    ${text(128, y + 68, sub, { size: 15, fill: D.ink3 })}
    ${tag}
    ${inner}`;
  const ceilLines = (cy, half) => `
    <line x1="400" x2="1156" y1="${cy - ceil * half}" y2="${cy - ceil * half}" stroke="#ff780a" stroke-width="2" stroke-dasharray="7 6"/>
    <line x1="400" x2="1156" y1="${cy + ceil * half}" y2="${cy + ceil * half}" stroke="#ff780a" stroke-width="2" stroke-dasharray="7 6"/>`;
  return canvas(1280, 800, `
    ${eyebrow(96, 112, 'LOOKAHEAD LIMITER')}
    ${text(92, 178, 'Peaks are cut before you hear them.', { size: 54, weight: 700, fill: HEAD })}
    ${text(96, 224, 'Audio is held for ~10 ms, so the volume is already down when the loud part arrives —', { size: 21, fill: D.ink2 })}
    ${text(96, 254, 'no blast first, then a late duck.', { size: 21, fill: D.ink2 })}

    ${panel(300, 'Without', 'Ads, explosions, a sudden scream', `
      ${bars(400, 398, 756, 84, amps, { color: 'rgba(204,204,220,0.38)', ceiling: ceil, showExcess: true })}
      ${ceilLines(398, 84)}`,
      `<rect x="128" y="384" width="168" height="34" rx="17" fill="rgba(255,74,61,0.14)"/>${text(212, 406, 'Spikes get through', { size: 14, weight: 600, fill: '#ff8a7f', anchor: 'middle' })}`)}

    ${panel(520, 'With Decibel Limiter', 'Same audio, held under your ceiling', `
      ${bars(400, 618, 756, 84, amps, { color: 'url(#orange)', ceiling: ceil, clamp: true })}
      ${ceilLines(618, 84)}`,
      `<rect x="128" y="604" width="168" height="34" rx="17" fill="${D.accentSoft}"/>${text(212, 626, 'Never above −20', { size: 14, weight: 600, fill: D.accentInk, anchor: 'middle' })}`)}

    <rect x="1010" y="${618 - ceil * 84 - 40}" width="146" height="28" rx="8" fill="#ff780a"/>
    ${text(1083, 618 - ceil * 84 - 21, 'Ceiling −20 dBFS', { size: 13, weight: 650, font: MONO, fill: '#111217', anchor: 'middle' })}
  `, {
    glow: [0.85, 0.15],
    title: 'Peaks are cut before you hear them',
    desc: 'Two waveforms: without the limiter, red spikes cross the dashed ceiling; with Decibel Limiter, the orange waveform stays under −20 dBFS.'
  });
}

function scenarios() {
  const cards = [
    { k: 'night', ceiling: '−26', mode: 'Even volume', lines: ['Quiet house, late shows.', 'Dialogue up, explosions', 'down.'] },
    { k: 'balanced', ceiling: '−20', mode: 'Even volume', lines: ['Everyday browsing,', 'videos and streams.', 'The default.'] },
    { k: 'social', ceiling: '−30', mode: 'Strong even', lines: ['Reels, shorts and feeds', 'where every clip has a', 'different loudness.'] },
    { k: 'music', ceiling: '−12', mode: 'Peaks only', lines: ['Keeps the dynamics of', 'music — only the real', 'spikes are caught.'] }
  ];
  const cardW = 256;
  const body = cards.map((c, i) => {
    const x = 96 + i * (cardW + 21);
    const sel = c.k === 'balanced';
    return `
      <rect x="${x}" y="318" width="${cardW}" height="330" rx="22" fill="${sel ? '#1d1712' : D.surface}" stroke="${sel ? '#ff780a' : D.line}" stroke-width="${sel ? 2 : 1}"/>
      <circle cx="${x + 52}" cy="378" r="28" fill="${sel ? 'rgba(255,120,10,0.2)' : D.surface2}"/>
      ${icon(SCEN[c.k].icon, x + 36, 362, 32, sel ? D.accentInk : D.ink)}
      ${sel ? `<rect x="${x + cardW - 100}" y="362" width="76" height="28" rx="14" fill="#ff780a"/>${text(x + cardW - 62, 381, 'Default', { size: 13, weight: 650, fill: '#111217', anchor: 'middle' })}` : ''}
      ${text(x + 28, 452, SCEN[c.k].name, { size: 30, weight: 700, fill: HEAD })}
      ${text(x + 28, 494, `${c.ceiling} dBFS`, { size: 22, weight: 650, font: MONO, fill: sel ? D.accentInk : D.ink })}
      <rect x="${x + 28}" y="510" width="${c.mode.length * 7.6 + 24}" height="26" rx="13" fill="${c.mode === 'Peaks only' ? D.surface2 : D.accentSoft}"/>
      ${text(x + 40, 528, c.mode, { size: 13, weight: 600, fill: c.mode === 'Peaks only' ? D.ink2 : D.accentInk })}
      ${c.lines.map((l, j) => text(x + 28, 572 + j * 22, l, { size: 16, fill: D.ink2 })).join('')}`;
  }).join('');
  const key = (x, y, k) => `<rect x="${x}" y="${y}" width="${k.length * 10 + 22}" height="32" rx="7" fill="${D.surface2}" stroke="${D.lineStrong}"/>${text(x + 11, y + 21, k, { size: 14, weight: 600, font: MONO, fill: D.ink })}`;
  return canvas(1280, 800, `
    ${eyebrow(96, 112, 'SCENARIOS')}
    ${text(92, 178, 'One tap for every moment.', { size: 54, weight: 700, fill: HEAD })}
    ${text(96, 224, 'Each scenario sets the ceiling, recovery and volume evening for you.', { size: 21, fill: D.ink2 })}
    ${text(96, 254, 'Drag the ceiling any time to make it your own.', { size: 21, fill: D.ink2 })}
    ${body}
    ${text(96, 712, 'Cycle scenarios from anywhere:', { size: 17, fill: D.ink3 })}
    ${key(352, 690, 'Alt')}${text(414, 712, '+', { size: 17, fill: D.ink3 })}${key(432, 690, 'Shift')}${text(514, 712, '+', { size: 17, fill: D.ink3 })}${key(532, 690, 'S')}
  `, {
    glow: [0.5, 0.0],
    title: 'One tap for every moment',
    desc: 'Four scenario cards: Night −26 dBFS, Balanced −20 dBFS (default), Social −30 dBFS and Music −12 dBFS.'
  });
}

function quality() {
  const card = (y, ic, title, badge, lines, sel) => `
    <rect x="96" y="${y}" width="540" height="168" rx="22" fill="${sel ? '#1d1712' : D.surface}" stroke="${sel ? '#ff780a' : D.line}" stroke-width="${sel ? 2 : 1}"/>
    <circle cx="146" cy="${y + 52}" r="26" fill="${sel ? 'rgba(255,120,10,0.2)' : D.surface2}"/>
    ${icon(ic, 131, y + 37, 30, sel ? D.accentInk : D.ink)}
    ${text(190, y + 61, title, { size: 26, weight: 700, fill: HEAD })}
    ${badge}
    ${lines.map((l, j) => text(124, y + 110 + j * 24, l, { size: 17, fill: D.ink2 })).join('')}`;
  const site = (y, host, scen, ceiling, saved = true) => `
    <rect x="712" y="${y}" width="472" height="62" rx="14" fill="${D.surface}" stroke="${D.line}"/>
    ${icon(SCEN[scen].icon, 734, y + 19, 24, D.accentInk)}
    ${text(772, y + 38, host, { size: 18, weight: 600, fill: HEAD })}
    ${text(1000, y + 38, SCEN[scen].name, { size: 15, fill: D.ink2, anchor: 'end' })}
    ${text(1100, y + 38, `${ceiling} dB`, { size: 15, weight: 600, font: MONO, fill: D.accentInk, anchor: 'end' })}
    ${saved ? `<rect x="1112" y="${y + 18}" width="56" height="26" rx="13" fill="${D.accentSoft}"/>${text(1140, y + 36, 'Saved', { size: 12, weight: 650, fill: D.accentInk, anchor: 'middle' })}` : ''}`;
  return canvas(1280, 800, `
    ${eyebrow(96, 112, 'YOUR SETUP, EVERY SITE')}
    ${text(92, 178, 'Best quality, or fullscreen. Your call.', { size: 54, weight: 700, fill: HEAD })}
    ${text(96, 224, 'Pick how audio is protected, and Decibel Limiter remembers it per site.', { size: 21, fill: D.ink2 })}

    ${card(286, 'hq', 'Best quality', `<rect x="350" y="${286 + 38}" width="50" height="28" rx="8" fill="#ff780a"/>${text(375, 286 + 58, 'HQ',{ size: 14, weight: 700, font: MONO, fill: '#111217', anchor: 'middle' })}`,
      ['Captures the whole tab: every sound is protected,', 'even players that hide their audio.'], true)}
    ${card(476, 'fs', 'Fullscreen-friendly', '',
      ['Works inside the page, so the player’s own', 'fullscreen button keeps working.'], false)}
    ${text(96, 712, 'Switch any time from the chip at the bottom of the popup.', { size: 17, fill: D.ink3 })}

    ${text(712, 306, 'Remembered per site', { size: 20, weight: 650, fill: HEAD })}
    ${site(326, 'youtube.com', 'balanced', '−20')}
    ${site(400, 'twitch.tv', 'night', '−26')}
    ${site(474, 'tiktok.com', 'social', '−30')}
    ${site(548, 'open.spotify.com', 'music', '−12')}
    <rect x="712" y="634" width="472" height="62" rx="14" fill="${D.surface}" stroke="${D.line}"/>
    ${icon('globe', 734, 653, 24, D.ink2)}
    ${text(772, 672, 'Apply to all sites', { size: 18, weight: 600, fill: HEAD })}
    <rect x="1110" y="652" width="52" height="28" rx="14" fill="${D.surface2}"/><circle cx="1125" cy="666" r="10" fill="${D.ink3}"/>
  `, {
    glow: [0.2, 0.3],
    title: 'Best quality, or fullscreen. Your call.',
    desc: 'Best quality (tab capture, HQ) and Fullscreen-friendly path cards, next to a list of sites with remembered scenarios and an Apply to all sites switch.'
  });
}

function themes() {
  return canvas(1280, 800, `
    ${eyebrow(96, 112, 'DESIGNED TO STAY OUT OF THE WAY')}
    ${text(92, 178, 'Light or dark.', { size: 54, weight: 700, fill: HEAD })}
    ${text(92, 240, 'Clear either way.', { size: 54, weight: 700, fill: 'url(#orange)' })}
    ${text(96, 300, 'Drag the ceiling, watch the live', { size: 21, fill: D.ink2 })}
    ${text(96, 330, 'level and see exactly how much', { size: 21, fill: D.ink2 })}
    ${text(96, 360, 'is being cut — at a glance.', { size: 21, fill: D.ink2 })}
    ${[['Follows your system theme', 'check'], ['Keyboard accessible', 'check'], ['English and Spanish', 'globe']].map(([l, ic], i) => `
      ${icon(ic, 96, 414 + i * 46, 24, D.accent)}${text(134, 432 + i * 46, l, { size: 19, fill: D.ink })}`).join('')}
    ${popup({ id: 'pl', x: 540, y: 120, scale: 0.92, theme: 'light', level: -31, reduction: 2.6, ceiling: -26, scenario: 'night', status: 'Evening volume · Best quality', site: 'netflix.com' })}
    ${popup({ id: 'pd', x: 878, y: 196, scale: 0.92, theme: 'dark', level: -18, reduction: 0.0, ceiling: -12, scenario: 'music', even: false, status: 'Peaks only · Fullscreen-friendly', site: 'open.spotify.com', path: 'Fullscreen-friendly', pathIcon: 'fs' })}
  `, {
    glow: [0.75, 0.55],
    title: 'Light or dark. Clear either way.',
    desc: 'The Decibel Limiter popup in light theme (Night scenario) and dark theme (Music scenario).'
  });
}

function promoSmall() {
  const amps = envelope(48, 3, [[0.28, 0.98], [0.7, 0.92]], 0.75);
  const cy = 222;
  const half = 44;
  const ceil = 0.5;
  return canvas(440, 280, `
    ${brand(26, 24, 34)}
    ${text(24, 116, 'Never hear', { size: 38, weight: 700, fill: HEAD })}
    ${text(24, 160, 'the spike.', { size: 38, weight: 700, fill: 'url(#orange)' })}
    ${bars(24, cy, 392, half, amps, { color: '#ccccdc', gap: 3, opacity: 0.16 })}
    ${bars(24, cy, 392, half, amps, { color: 'url(#orange)', ceiling: ceil, clamp: true, gap: 3 })}
    <line x1="24" x2="416" y1="${cy - ceil * half}" y2="${cy - ceil * half}" stroke="#ff780a" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.85"/>
    <line x1="24" x2="416" y1="${cy + ceil * half}" y2="${cy + ceil * half}" stroke="#ff780a" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.85"/>
  `, {
    glow: [0.85, 0.2],
    title: 'Decibel Limiter',
    desc: 'Small promo tile: Decibel Limiter, never hear the spike, with a waveform held under a ceiling.'
  });
}

function marquee() {
  const amps = envelope(110, 21, [[0.24, 0.96], [0.5, 1], [0.78, 0.9]]);
  return canvas(1400, 560, `
    ${backdropWave(540, 300, 860, 170, amps, 0.42, 3)}
    ${brand(96, 96, 44)}
    ${text(92, 262, 'Never hear', { size: 82, weight: 700, fill: HEAD })}
    ${text(92, 352, 'the spike.', { size: 82, weight: 700, fill: 'url(#orange)' })}
    ${text(96, 414, 'Lookahead volume limiter for every tab.', { size: 26, fill: D.ink2 })}
    ${text(96, 452, 'Peaks are stopped before they reach your ears.', { size: 26, fill: D.ink2 })}
    ${popup({ id: 'pm', x: 930, y: 34, scale: 0.88 })}
  `, {
    glow: [0.75, 0.5],
    title: 'Decibel Limiter — Never hear the spike',
    desc: 'Marquee: headline next to the Decibel Limiter popup with protection on.'
  });
}

const ART = {
  'screenshot-1-hero': [hero, 1280, 800],
  'screenshot-2-protection': [protection, 1280, 800],
  'screenshot-3-scenarios': [scenarios, 1280, 800],
  'screenshot-4-quality': [quality, 1280, 800],
  'screenshot-5-themes': [themes, 1280, 800],
  'promo-small-440x280': [promoSmall, 440, 280],
  'promo-marquee-1400x560': [marquee, 1400, 560]
};

// ——— Write SVGs + render PNGs ———
fs.mkdirSync(outDir, { recursive: true });
const fontFace = (family, file) =>
  `@font-face{font-family:"${family}";font-weight:100 900;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontsDir, file)).toString('base64')}) format("woff2");}`;
const fontCss = fontFace('Outfit', 'outfit-latin-wght-normal.woff2') + fontFace('JetBrains Mono', 'jetbrains-mono-latin-wght-normal.woff2');

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, [build, w, h]] of Object.entries(ART)) {
  const svg = build();
  fs.writeFileSync(path.join(outDir, `${name}.svg`), svg);
  await page.setViewportSize({ width: w, height: h });
  // Relative font URLs don't resolve in setContent — swap in embedded fonts for rendering.
  await page.setContent(`<!doctype html><html><head><style>${fontCss}html,body{margin:0;background:#0c0d11}svg{display:block}</style></head><body>${svg.replace(/<style>[\s\S]*?<\/style>/, '')}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  // JPEG-free, alpha-free: Chrome Web Store wants 24-bit images with no transparency.
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip: { x: 0, y: 0, width: w, height: h }, omitBackground: false });
  console.log(`${name}: ${w}×${h}`);
}
await browser.close();
