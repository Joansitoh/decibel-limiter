// Builds the store packages into dist/:
//   decibel-limiter-<version>.zip          Chrome Web Store (JS minified with esbuild, never obfuscated)
//   decibel-limiter-<version>-firefox.zip  Firefox Add-ons (unminified, so AMO needs no separate source upload)
// Usage: npm run build            (npm run build -- --no-minify zips the Chromium sources as they are)
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { transform } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const minify = !process.argv.includes('--no-minify');

/** Relative paths of every file under dir, sorted so the zip is reproducible. */
function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])
    .map(p => p.split(path.sep).join('/'))
    .sort();
}

/** Minimal deflate zip writer (store uploads only need plain zips). Fixed timestamps → same input, same bytes. */
function zipDir(dir, outFile) {
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  const local = [];
  const central = [];
  let offset = 0;
  for (const rel of listFiles(dir)) {
    const data = readFileSync(path.join(dir, rel));
    const packed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 30); // version needed … name length are identical
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk
    entry.writeUInt16LE(0, 36); // internal attrs
    entry.writeUInt32LE(0, 38); // external attrs
    entry.writeUInt32LE(offset, 42);
    local.push(header, name, packed);
    central.push(entry, name);
    offset += header.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const count = central.length / 2;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...local, cd, end]));
  console.log(`Built ${path.relative(root, outFile)} (${count} files)`);
}

mkdirSync(dist, { recursive: true });

// Chromium: copy, minify every non-.min.js file in place (keeps third-party license headers), zip.
const staging = path.join(dist, '_staging');
rmSync(staging, { recursive: true, force: true });
cpSync(path.join(root, 'extension'), staging, { recursive: true });
if (minify) {
  for (const rel of listFiles(staging).filter(f => f.endsWith('.js') && !f.endsWith('.min.js'))) {
    const file = path.join(staging, rel);
    // Per-file transform, no bundling: top-level names stay intact, which the shared service-worker scope needs.
    const { code } = await transform(readFileSync(file, 'utf8'), { minify: true, legalComments: 'none', loader: 'js' });
    writeFileSync(file, code);
  }
}
zipDir(staging, path.join(dist, `decibel-limiter-${version}.zip`));
rmSync(staging, { recursive: true, force: true });

// Firefox: the generated dist/firefox/ as is.
await import('./build-firefox.mjs');
zipDir(path.join(dist, 'firefox'), path.join(dist, `decibel-limiter-${version}-firefox.zip`));
