'use strict';

// Menú + gestión de productos/categorías + subida de imágenes.
// - GET  /api/menu           -> público (web), productos activos.
// - GET  /api/admin/menu     -> panel (POS), incluye inactivos.
// - CRUD /api/admin/products, /api/admin/categories.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { requireAdmin, requireRole } = require('../auth');
const { rateLimit } = require('../rateLimit');
const { wrap } = require('../http');
const prd = require('../products');
const { optimizeUpload } = require('../imageOptim');
const { query } = require('../db');

const router = express.Router();

// Acepta ?force=1 / true / yes (o body.force) para los borrados con dos pasos.
function isTruthy(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// Directorio de subidas (volumen compartido con nginx en producción).
// Debe coincidir con server.js (donde se sirven por express.static).
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error('Solo imágenes JPG, PNG, WEBP o GIF.'));
    cb(null, true);
  },
});

// Configuración pública para el sitio (menu.html). Expone el token de pedido
// para que el frontend nunca quede desincronizado con el .env del servidor.
// El token ya es público (va embebido en menu.html), por eso se sirve por API.
router.get('/client-config', rateLimit({ windowMs: 60000, max: 300 }),
  wrap(async (req, res) => {
    res.json({
      orderToken: process.env.ORDER_TOKEN || '',
    });
  })
);

// Diagnóstico de la base para el menú (panel): detecta tablas faltantes o
// esquema desactualizado (migración 006) sin morir en el intento. Cada
// comprobación va en try/catch para reportar aunque la BD esté a medias.
router.get('/admin/db-check', requireAdmin,
  wrap(async (req, res) => {
    const out = { ok: false, problem: '', migrations: [], tables: {}, counts: {}, columns: {} };

    try {
      const { rows } = await query('SELECT name FROM schema_migrations ORDER BY name');
      out.migrations = rows.map((r) => r.name);
    } catch (e) { out.migrationsError = e.message; }

    for (const t of ['products', 'categories']) {
      try {
        const r = await query('SELECT to_regclass($1) AS t', ['public.' + t]);
        out.tables[t] = r.rows[0].t !== null;
      } catch (e) { out.tables[t] = false; out.tablesError = e.message; }
    }

    const NEEDED = {
      products: ['name', 'category', 'price', 'desc', 'img', 'popular', 'salsas',
        'variants', 'removable', 'extras', 'sin_no', 'active', 'sort', 'stock_item_id', 'upsell',
        'variant_title', 'flavors', 'sin_pan'],
      categories: ['name', 'icon', 'sort', 'active'],
    };
    for (const t of Object.keys(NEEDED)) {
      if (!out.tables[t]) continue;
      try {
        const { rows } = await query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
          [t]
        );
        const present = new Set(rows.map((r) => r.column_name));
        out.columns[t] = NEEDED[t].filter((c) => !present.has(c));
      } catch (e) { out.columnsError = e.message; }
    }

    for (const t of ['products', 'categories']) {
      if (!out.tables[t]) continue;
      try {
        const { rows } = await query('SELECT count(*)::int AS n FROM ' + t);
        out.counts[t] = rows[0].n;
      } catch (e) { out.countsError = e.message; }
    }

    const missingTables = Object.keys(out.tables).filter((t) => !out.tables[t]);
    const missingCols = Object.keys(out.columns).filter((t) => out.columns[t].length);
    const has006 = out.migrations.includes('006_add_products_menu_and_production.sql');
    if (missingTables.length) {
      out.problem = 'Faltan tablas: ' + missingTables.join(', ')
        + '. La migración 006 no está aplicada (' + (has006 ? 'registrada pero las tablas no existen' : 'no registrada') + ').';
    } else if (missingCols.length) {
      out.problem = 'Esquema desactualizado, faltan columnas en: ' + missingCols.join(', ') + '.';
    } else if (!has006) {
      out.problem = 'Las tablas existen pero la migración 006 no está registrada.';
    } else {
      out.ok = true;
      out.problem = 'Base de datos OK.';
    }
    res.json(out);
  })
);

// ---------------------------------------------------------------------------
// Menú público (web) — solo lectura, sin token (rate-limit es suficiente).
// ---------------------------------------------------------------------------
router.get('/menu', rateLimit({ windowMs: 60000, max: 120 }),
  wrap(async (req, res) => {
    const menu = await prd.getPublicMenu();
    res.json({ updatedAt: new Date().toISOString(), ...menu });
  })
);

// Menú para el panel/POS (con sesión): incluye inactivos para gestión.
router.get('/admin/menu', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const [products, categories] = await Promise.all([
      prd.getProducts({ includeInactive: true }),
      prd.getCategories({ includeInactive: true }),
    ]);
    res.json({ categories, products });
  })
);

// ---------------------------------------------------------------------------
// CRUD productos (admin)
// ---------------------------------------------------------------------------
router.get('/admin/products', requireAdmin,
  wrap(async (req, res) => {
    const products = await prd.getProducts({ includeInactive: true });
    res.json({ products });
  })
);

router.post('/admin/products', requireAdmin,
  wrap(async (req, res) => {
    const product = await prd.saveProduct(req.body || {}, null, { create: true });
    res.status(201).json({ product });
  })
);

router.post('/admin/products/:id', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const product = await prd.saveProduct({ ...body, id: req.params.id });
    res.json({ product });
  })
);

router.post('/admin/products/:id/image', requireAdmin,
  upload.single('image'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Sube un archivo de imagen.' });
    // Genera la escalera WebP junto al original (que queda como fallback).
    // Los GIF se conservan tal cual (pueden ser animados).
    if (req.file.mimetype !== 'image/gif') {
      try {
        await optimizeUpload(req.file.path);
      } catch (err) {
        console.warn('[upload] no se pudo optimizar la imagen, se conserva el original:', err.message);
      }
    }
    const img = 'img/uploaded/' + req.file.filename;
    const product = await prd.setProductImage(req.params.id, img);
    res.json({ product });
  })
);

// Admin — mostrar/ocultar del menú (soft). El checkbox "Visible" del modal guarda
// lo mismo; este endpoint es para el toggle rápido en la lista.
router.post('/admin/products/:id/visibility', requireAdmin,
  wrap(async (req, res) => {
    const active = !!(req.body || {}).active;
    const product = await prd.setProductActive(req.params.id, active);
    res.json({ product });
  })
);

// Admin — marca/desmarca una bebida para el pop-up (upsell) de la web. Toggle
// rápido desde la vista Menú; no cambia su visibilidad en el menú normal.
router.post('/admin/products/:id/upsell', requireAdmin,
  wrap(async (req, res) => {
    const upsell = !!(req.body || {}).upsell;
    const product = await prd.setProductUpsell(req.params.id, upsell);
    res.json({ product });
  })
);

// Admin — borrado real del producto. Sin ?force y si tiene recetas responde 409 con
// el detalle; con ?force=1 borra también las recetas y desvincula su ítem de stock.
// Para ocultarlo sin borrarlo, usar /visibility o el checkbox del modal.
router.delete('/admin/products/:id', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const force = isTruthy(req.query.force) || isTruthy(body.force);
    const removed = await prd.deleteProduct(req.params.id, { force });
    res.json({ ok: true, ...removed });
  })
);

// ---------------------------------------------------------------------------
// Categorías (admin)
// ---------------------------------------------------------------------------
router.get('/admin/categories', requireAdmin,
  wrap(async (req, res) => {
    const categories = await prd.getCategories({ includeInactive: true });
    res.json({ categories });
  })
);

router.post('/admin/categories', requireAdmin,
  wrap(async (req, res) => {
    const category = await prd.saveCategory(req.body || {});
    res.status(201).json({ category });
  })
);

router.post('/admin/categories/:slug', requireAdmin,
  wrap(async (req, res) => {
    const category = await prd.saveCategory({ ...(req.body || {}), slug: req.params.slug });
    res.json({ category });
  })
);

router.delete('/admin/categories/:slug', requireAdmin,
  wrap(async (req, res) => {
    await prd.deleteCategory(req.params.slug);
    res.json({ ok: true });
  })
);

module.exports = router;