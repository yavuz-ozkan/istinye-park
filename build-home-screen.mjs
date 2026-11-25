// Builds docs/ (the folder GitHub Pages serves), the installable iPad home screen version of the game, from index.html (the artifact source).
// Run: node build-home-screen.mjs   Safe to rerun: it rebuilds docs/ from scratch and the output is byte-identical.
// Needs Node 18 or newer and nothing else. three.js and the fonts come from vendor/, so the build never touches the network.
// The voices come from audio-pack.js, which tools/pack-audio.ps1 makes from the clips in audio/.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(ROOT, 'docs');
const APP_NAME = 'İstinye Park';
const CACHE_PREFIX = 'istinye-park-';
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const ICONS = [
  { file: 'icons/apple-touch-icon-180.png', size: 180, purpose: null },
  { file: 'icons/icon-192.png', size: 192, purpose: 'any' },
  { file: 'icons/icon-512.png', size: 512, purpose: 'any' },
  { file: 'icons/icon-maskable-512.png', size: 512, purpose: 'maskable' },
];

/* ---------- Reading the artifact source ---------- */

function splitArtifact(source) {
  const styleStart = source.indexOf('<style>'), styleEnd = source.indexOf('</style>');
  if (!source.startsWith('<title>') || styleStart < 0 || styleEnd < styleStart) {
    throw new Error('index.html is not in the expected artifact format: it should start with <title>, then metas, then one <style> block, then the markup and scripts. Restore that order and rerun.');
  }
  if (!source.slice(0, styleStart).includes('fonts.googleapis.com')) {
    throw new Error('index.html no longer links the Google Fonts stylesheet before <style>. The build swaps that link for the bundled fonts in vendor/fonts; update build-home-screen.mjs to match the new font setup.');
  }
  let body = source.slice(styleEnd + '</style>'.length).trim();
  if (!body.includes(THREE_CDN)) throw new Error('index.html no longer loads three.js r128 from cdnjs. The build swaps that for vendor/three/three.min.js; update THREE_CDN in build-home-screen.mjs and the vendored copy together.');
  body = body.replace(THREE_CDN, 'vendor/three.min.js');
  if (!body.includes('<script src="audio-pack.js"></script>')) throw new Error('index.html no longer loads audio-pack.js. Without it the game has no recorded voices; restore the script tag or update the build.');
  return { style: source.slice(styleStart, styleEnd + '</style>'.length), body };
}

function readTokens(style) {
  const tokens = {};
  for (const m of style.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2].toLowerCase();
  for (const name of ['night', 'marble', 'ink', 'brass', 'baba']) {
    if (!tokens[name]) throw new Error(`The color token --${name} is missing from index.html :root. The icons and theme color are drawn from it; add it back or update the build.`);
  }
  return tokens;
}

/* ---------- Icons: a tiny supersampled rasterizer and PNG encoder ---------- */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const arch = (x0, x1, yTop, yBottom) => { const r = (x1 - x0) / 2, cx = (x0 + x1) / 2; return (x, y) => rect(x0, yTop + r, x1, yBottom)(x, y) || circle(cx, yTop + r, r)(x, y); };

// Baba in his red jumper, coming through a brass arch of the mall at night.
// scale shrinks the picture toward the centre so a maskable icon keeps him inside the safe zone.
function iconLayers(t, scale) {
  const s = (v) => 0.5 + (v - 0.5) * scale, d = (v) => v * scale;
  const R = (x0, y0, x1, y1) => rect(s(x0), s(y0), s(x1), s(y1));
  const C = (x, y, r) => circle(s(x), s(y), d(r));
  const A = (x0, x1, yTop, yBottom) => arch(s(x0), s(x1), s(yTop), s(yBottom));
  const night = hex(t.night), marble = hex(t.marble), brass = hex(t.brass), baba = hex(t.baba), ink = hex(t.ink), skin = [232, 185, 140], hair = [42, 26, 10];
  const floorY = s(0.8);
  return [
    ...[[0.12, 0.1], [0.3, 0.05], [0.72, 0.07], [0.9, 0.16], [0.06, 0.3], [0.94, 0.36]].map(([x, y]) => ({ shape: circle(x, y, 0.011), color: [255, 255, 255] })),
    { shape: A(0.17, 0.83, 0.13, 0.8), color: brass },                         // the arch
    { shape: A(0.215, 0.785, 0.175, 0.8), color: marble },                      // pale wall inside it
    { shape: A(0.3, 0.7, 0.26, 0.8), color: mix(night, ink, 0.5) },             // the dark corridor
    { shape: rect(-0.02, floorY, 1.02, 1.02), color: mix(marble, [170, 185, 215], 0.35) },   // marble floor
    { shape: rect(-0.02, floorY, 1.02, floorY + d(0.02)), color: brass },
    { shape: R(0.435, 0.64, 0.485, 0.79), color: ink }, { shape: R(0.515, 0.64, 0.565, 0.79), color: ink },   // legs
    { shape: R(0.415, 0.775, 0.495, 0.81), color: [10, 10, 10] }, { shape: R(0.505, 0.775, 0.585, 0.81), color: [10, 10, 10] },   // shiny shoes
    { shape: R(0.39, 0.45, 0.61, 0.66), color: baba },                          // red jumper
    { shape: R(0.33, 0.46, 0.39, 0.6), color: baba }, { shape: R(0.61, 0.46, 0.67, 0.6), color: baba },   // arms
    { shape: C(0.36, 0.62, 0.035), color: skin }, { shape: C(0.64, 0.62, 0.035), color: skin },
    { shape: R(0.488, 0.46, 0.512, 0.6), color: [255, 209, 102] },             // yellow tie
    { shape: C(0.5, 0.375, 0.095), color: skin },                               // head
    { shape: (x, y) => circle(s(0.5), s(0.365), d(0.1))(x, y) && y < s(0.335), color: hair },
    { shape: C(0.465, 0.375, 0.016), color: [17, 17, 17] }, { shape: C(0.535, 0.375, 0.016), color: [17, 17, 17] },
    { shape: R(0.47, 0.415, 0.53, 0.43), color: [122, 31, 31] },
  ];
}

function renderIcon(size, tokens, purpose) {
  const layers = iconLayers(tokens, purpose === 'maskable' ? 0.78 : 1);
  const top = mix(hex(tokens.night), [0, 0, 0], 0.25), low = mix(hex(tokens.night), [60, 80, 150], 0.45);
  const SS = 4, pixels = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
          let color = mix(top, low, y);
          for (const layer of layers) if (layer.shape(x, y)) color = layer.color;
          acc[0] += color[0]; acc[1] += color[1]; acc[2] += color[2];
        }
      }
      const o = (py * size + px) * 3;
      for (let i = 0; i < 3; i++) pixels[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  return encodePng(size, pixels);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) rgb.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- The page, manifest and service worker ---------- */

function homeScreenPage({ style, body }, tokens, fontCss) {
  return `<!doctype html>
<html lang="tr" class="home-screen">
<head>
<meta charset="utf-8">
<title>${APP_NAME}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${APP_NAME}">
<meta name="application-name" content="${APP_NAME}">
<meta name="theme-color" content="${tokens.night}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<script>
// Launched from the home screen: lets the CSS show the turn-sideways card in portrait.
if (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) {
  document.documentElement.classList.add('standalone');
}
</script>
<style>
/* Baloo 2 and Josefin Sans, bundled for offline play (SIL Open Font License, see fonts/OFL-*.txt). The latin-ext files carry the Turkish letters. */
${fontCss.trim()}
</style>
${style}
<style>
/* Home screen build only. */
html.home-screen { background: var(--night); }
.rotateCard {
  display: none; position: fixed; inset: 0; z-index: 50;
  flex-direction: column; align-items: center; justify-content: center; gap: 28px;
  padding: 24px; text-align: center; background: var(--night); color: var(--marble); font-family: var(--font-ui);
}
.rotateCard h1 { margin: 0; font-size: 2.4rem; line-height: 1.1; color: var(--brass); }
.rotateCard p { margin: 0; font-size: 1.3rem; }
.rotateCard svg { width: 180px; height: 180px; animation: tilt 2.4s ease-in-out infinite; }
@keyframes tilt { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
@media (prefers-reduced-motion: reduce) { .rotateCard svg { animation: none; transform: rotate(-90deg); } }
@media (orientation: portrait) { html.home-screen.standalone .rotateCard { display: flex; } }
</style>
</head>
<body>
${body}
<div class="rotateCard" id="rotateCard" role="alert">
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <rect x="34" y="14" width="52" height="92" rx="10" fill="none" stroke="currentColor" stroke-width="6"/>
    <circle cx="60" cy="96" r="4" fill="currentColor"/>
  </svg>
  <h1>iPad'i yan çevir</h1>
  <p>Turn the iPad sideways. ${APP_NAME} plays with the long side down.</p>
</div>
<script>
// Offline play: the service worker keeps every file of the game on the iPad after the first visit.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline play is not set up yet; the game still works online.', err));
  });
}
</script>
</body>
</html>
`;
}

function manifest(tokens) {
  return JSON.stringify({
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'A Turkish-speaking mall chase game by Baba and Noah',
    lang: 'tr',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: tokens.night,
    theme_color: tokens.night,
    icons: ICONS.filter((i) => i.purpose).map((i) => ({ src: i.file, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose })),
  }, null, 2) + '\n';
}

function serviceWorker(files, version) {
  return `// Generated by build-home-screen.mjs. Cache-first, so the game starts with the network off after one visit.
const CACHE = '${CACHE_PREFIX}${version}';
const FILES = ${JSON.stringify(['./', ...files], null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('${CACHE_PREFIX}') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)));
});
`;
}

/* ---------- Build ---------- */

function listFiles(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const full = path.join(dir, name), rel = prefix + name;
    return statSync(full).isDirectory() ? listFiles(full, rel + '/') : [rel];
  });
}

function write(rel, data) {
  const full = path.join(SITE, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
}

function build() {
  const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const parts = splitArtifact(source), tokens = readTokens(parts.style);
  const pack = path.join(ROOT, 'audio-pack.js');
  if (!existsSync(pack)) throw new Error('audio-pack.js is missing. Make it from the clips in audio/ with: pwsh -File tools/pack-audio.ps1');
  const fontDir = path.join(ROOT, 'vendor/fonts'), fontCss = readFileSync(path.join(fontDir, 'fonts.css'), 'utf8');
  rmSync(SITE, { recursive: true, force: true });
  write('index.html', homeScreenPage(parts, tokens, fontCss));
  write('manifest.webmanifest', manifest(tokens));
  write('audio-pack.js', readFileSync(pack));
  write('vendor/three.min.js', readFileSync(path.join(ROOT, 'vendor/three/three.min.js')));
  write('vendor/three-LICENSE.txt', readFileSync(path.join(ROOT, 'vendor/three/LICENSE')));
  for (const name of readdirSync(fontDir).sort()) if (name !== 'fonts.css') write('fonts/' + name, readFileSync(path.join(fontDir, name)));
  for (const icon of ICONS) write(icon.file, renderIcon(icon.size, tokens, icon.purpose));
  const files = listFiles(SITE);
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(path.join(SITE, f)));
  const version = hash.digest('hex').slice(0, 12);
  write('sw.js', serviceWorker([...files, 'sw.js'].sort(), version));
  console.log(`Built ${path.relative(ROOT, SITE)}/ (${files.length + 1} files, cache ${CACHE_PREFIX}${version}).`);
}

build();
