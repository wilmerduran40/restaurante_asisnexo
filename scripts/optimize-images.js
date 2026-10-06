'use strict';

// Genera variantes WebP responsive para las imágenes del sitio AsisNexo.
// - Recorre img/ y por cada .jpg/.jpeg/.png/.webp crea: <base>-<w>.webp (srcset).
// - No destructivo: conserva el original como fallback en <picture>.
//
// Uso:
//   NODE_PATH=<ruta a nexo-api/node_modules> node scripts/optimize-images.js
//   (o simplemente: node scripts/optimize-images.js si sharp está instalado localmente)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTHS = [400, 800, 1600];
const MAX_WIDTH = 1600;
const QUALITY = 80;
const CONCURRENCY = 4;

// No son <img> de contenido: se saltan (placeholder es SVG; refs de logo).
const SKIP = /(^|[\\/])(placeholder|logo_ref|header_ref)\b/i;

const ROOT = path.join(__dirname, '..', 'img');

const SRC_RE = /\.(jpe?g|png|webp)$/i;
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK = argv.includes('--check');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
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

  const jobs = WIDTHS.map((w) => ({ width: w, out: `${base}-${w}.webp` }));

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
  const files = walk(ROOT).sort();
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