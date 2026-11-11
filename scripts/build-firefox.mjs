// Generates dist/firefox/ from extension/: Firefox manifest (event page, no tabCapture/offscreen).
// Usage: node scripts/build-firefox.mjs   then load dist/firefox/manifest.json via about:debugging.
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'firefox');
rmSync(out, { recursive: true, force: true });
cpSync(path.join(root, 'extension'), out, { recursive: true });

const manifestPath = path.join(out, 'manifest.json');
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
delete m.minimum_chrome_version;
m.permissions = m.permissions.filter(p => !['tabCapture', 'offscreen'].includes(p));
m.background = { scripts: ['js/presets.js', 'js/background/storage.js', 'js/background/capture.js', 'js/background/main.js'] };
m.browser_specific_settings = { gecko: { id: 'decibel-limiter@joancabrera.es', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } };
writeFileSync(manifestPath, JSON.stringify(m, null, 2));
rmSync(path.join(out, 'offscreen.html'), { force: true });
rmSync(path.join(out, 'js', 'offscreen.js'), { force: true });
console.log('Firefox build ready:', out);
