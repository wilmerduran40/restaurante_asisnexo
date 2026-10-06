'use strict';

// Optimización de imágenes subidas desde el panel.
// Genera la escalera WebP (<base>-<w>.webp + <base>.webp) junto al archivo original,
// que se conserva como fallback del <picture> en el menú.

const path = require('path');
const sharp = require('sharp');

const WIDTHS = [400, 800, 1600];
const MAX_WIDTH = 1600;
const QUALITY = 80;

// Devuelve el "base" (sin extensión) o null si el archivo no es una imagen procesable.
async function optimizeUpload(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  const meta = await sharp(filePath).metadata();
  if (!meta.format) return null;

  const outputs = WIDTHS.map((w) => ({ width: w, file: path.join(dir, `${base}-${w}.webp`) }));
  outputs.push({ width: MAX_WIDTH, file: path.join(dir, `${base}.webp`) });

  for (const out of outputs) {
    await sharp(filePath)
      .rotate()
      .resize({ width: out.width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(out.file);
  }

  return base;
}

module.exports = { optimizeUpload, WIDTHS };
