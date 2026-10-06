'use strict';

// Genera variantes WebP responsive para las imágenes del sitio.
// - Recorre img/ (raíz del repo) y nexo-api/public/img.
// - Por cada .jpg/.jpeg/.png crea: <base>-<w>.webp (escalera srcset).
// - No destructivo: conserva el original como fallback en <picture>.
//
// Uso:
//   node scripts/optimize-images.js            convierte lo que falte
//   node scripts/optimize-images.js --force    regenera todo
//   node scripts/optimize-images.js --check    solo reporta el ahorro (no escribe)
//   node scripts/optimize-images.js --prune    borra duplicados/huérfanos conocidos

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTHS = [400, 800, 1600];
const MAX_WIDTH = 1600;
const QUALITY = 80;
const CONCURRENCY = 4;

// No son <img> de contenido: se saltan (favicon se enlaza como PNG; placeholder es SVG).
const SKIP = /(^|[\\/])(favicon|placeholder)\b/i;
// Solo se usan como fondo CSS: basta una única variante full.
const SINGLE = /logo-watermark/i;

const ROOTS = [
  path.join(__dirname, '..', '..', 'img'),
  path.join(__dirname, '..', 'public', 'img'),
];

// Duplicado exacto y huérfanos detectados en la revisión (3.1).
const PRUNE = [
  'img/MixtaKeto.jpeg',
  'img/clientes/cliente3.jpg',
  'img/clientes/cliente4.jpg',
  'img/criollitaquesofrito.jpg',
  'img/favicon.svg',
  'img/grosera.jpg',
  'img/mayormixta.jpeg',
  'img/perro.jpg',
];

const SRC_RE = /\.(jpe?g|png)$/i;
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK = argv.includes('--check');
const PRUNE_MODE = argv.includes('--prune');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'uploaded') continue;
      out.push(...walk(full));
    } else if (entry.isFile() && SRC_RE.test(entry.name) && !SKIP.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function isFresh(src, out) {
  if (FORCE || !fs.existsSync(out)) return false;
  return fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs;
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

let processed = 0;
let created = 0;
let originalBytes = 0;
let webpBytes = 0;

async function optimizeOne(file) {
  const base = file.replace(SRC_RE, '');
  originalBytes += fs.statSync(file).size;

  const jobs = SINGLE.test(file)
    ? [{ width: MAX_WIDTH, out: `${base}.webp` }]
    : WIDTHS.map((w) => ({ width: w, out: `${base}-${w}.webp` }));

  for (const job of jobs) {
    if (isFresh(file, job.out)) {
      webpBytes += fs.statSync(job.out).size;
      continue;
    }
    if (CHECK) continue;
    await sharp(file)
      .rotate()
      .resize({ width: job.width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(job.out);
    created += 1;
    webpBytes += fs.statSync(job.out).size;
  }

  processed += 1;
  process.stdout.write(`  ${path.relative(process.cwd(), file)}\n`);
}

async function run() {
  if (PRUNE_MODE) {
    let removed = 0;
    for (const rel of PRUNE) {
      const full = path.join(__dirname, '..', '..', rel);
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
        console.log(`  prune  ${rel}`);
        removed += 1;
      }
    }
    console.log(removed ? `[prune] ${removed} archivo(s) borrado(s).` : '[prune] nada que borrar.');
    return;
  }

  const files = ROOTS.flatMap(walk).sort();
  console.log(
    `[optimize] ${files.length} imagen(es) fuente · ${WIDTHS.join('/')}px · q${QUALITY}` +
      (CHECK ? ' · CHECK (no escribe)' : '')
  );

  const queue = [...files];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await optimizeOne(queue.shift());
  });
  await Promise.all(workers);

  const saved = originalBytes - webpBytes;
  const pct = originalBytes ? ((saved / originalBytes) * 100).toFixed(1) : '0';
  console.log('');
  console.log(`[optimize] imágenes procesadas: ${processed}`);
  console.log(`[optimize] webp creados: ${created}`);
  console.log(`[optimize] originales: ${fmt(originalBytes)} · webp total (todas las variantes): ${fmt(webpBytes)}`);
  console.log(`[optimize] ahorro si se sirviera solo la variante mayor: ${fmt(saved)} (${pct}%)`);
}

run().catch((err) => {
  console.error('[optimize] error:', err.message);
  process.exit(1);
});
