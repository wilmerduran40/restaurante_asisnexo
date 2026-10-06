'use strict';

// Inventario: disponibilidad pública (menu.html), gestión de ingredientes,
// recetas por plato y movimientos desde el panel /admin.

const express = require('express');
const { requireAdmin, requireRole } = require('../auth');
const { rateLimit } = require('../rateLimit');
const { wrap } = require('../http');
const inv = require('../inventory');

const router = express.Router();

// Acepta ?force=1 / true / yes (o body.force) para los borrados con dos pasos.
function isTruthy(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

// R pública — platos/variantes no disponibles hoy + stock actual por ingrediente.
router.get('/inventory/availability', rateLimit({ windowMs: 60000, max: 120 }),
  wrap(async (req, res) => {
    const data = await inv.getAvailability();
    res.json({ updatedAt: new Date().toISOString(), ...data });
  })
);

// R admin/mesero — inventario completo (el mesero lo usa en el POS para marcar
// productos agotados). El guardado es solo admin.
router.get('/admin/inventory', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const [ingredients, products, recipes, availability] = await Promise.all([
      inv.getIngredients('ingredient'),
      inv.getIngredients('product'),
      inv.getRecipeRows(),
      inv.getAvailability(),
    ]);
    res.json({ ingredients, products, recipes, availability });
  })
);

// Admin — crear ingrediente o producto terminado (kind: 'ingredient'|'product')
router.post('/admin/inventory/ingredients', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const ingredient = await inv.createIngredient({
      name: body.name,
      stock: body.stock,
      unit: body.unit,
      lowThreshold: body.lowThreshold,
      alwaysAvailable: body.alwaysAvailable,
      kind: body.kind,
    });
    res.status(201).json({ ingredient });
  })
);

// Admin — crear varios a la vez (sugerencias desde el menú). Va antes de
// "/:id" para que 'bulk' no se tome como un id.
router.post('/admin/inventory/ingredients/bulk', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const created = await inv.bulkCreateIngredients(body.names, body.alwaysAvailableNames);
    res.json({ ok: true, created });
  })
);

// Admin — ingredientes sugeridos como "siempre hay" (no bloquean). El panel los
// usa para sembrar ingredientes desde el menú sin duplicar la lista en el cliente.
router.get('/admin/inventory/suggested', requireAdmin,
  wrap(async (req, res) => {
    res.json({ alwaysAvailableNames: inv.getSuggestedAlwaysAvailable() });
  })
);

// Admin — registrar lote de producción de un producto terminado
router.post('/admin/inventory/production', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const batch = await inv.registerProduction({
      productId: body.productId,
      qty: body.qty,
      items: body.items,
      note: body.note,
    });
    res.status(201).json({ batch });
  })
);

// Admin — entrada por compra de un producto terminado
router.post('/admin/inventory/products/:id/restock', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const qty = Number(body.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: '"qty" es obligatorio (número > 0).' });
    }
    const row = await inv.restockProduct(req.params.id, qty, body.note || 'compra');
    res.json({ ok: true, stock: row.stock });
  })
);

// Admin — receta de fabricación de un producto terminado
router.get('/admin/inventory/production-recipes/:productId', requireAdmin,
  wrap(async (req, res) => {
    const recipes = await inv.getProductionRecipes(req.params.productId);
    res.json({ recipes });
  })
);

router.put('/admin/inventory/production-recipes/:productId', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    await inv.saveProductionRecipe(req.params.productId, body.rows);
    res.json({ ok: true });
  })
);

// Admin — historial de lotes de producción
router.get('/admin/inventory/production/batches', requireAdmin,
  wrap(async (req, res) => {
    const batches = await inv.getProductionBatches(req.query.limit);
    res.json({ batches });
  })
);

// Admin — actualizar ingrediente o producto terminado (nombre, stock, unidad,
// umbral, no bloquea, y kind para moverlo entre las dos listas del panel)
router.post('/admin/inventory/ingredients/:id', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const ingredient = await inv.updateIngredient(req.params.id, {
      name: body.name,
      stock: body.stock,
      unit: body.unit,
      lowThreshold: body.lowThreshold,
      alwaysAvailable: body.alwaysAvailable,
      kind: body.kind,
    });
    res.json({ ingredient });
  })
);

// Admin — ajustar stock (restock/corrección) con movimiento
router.post('/admin/inventory/ingredients/:id/stock', requireAdmin,
  wrap(async (req, res) => {
    const delta = Number((req.body || {}).delta);
    if (!Number.isFinite(delta)) {
      return res.status(400).json({ error: '"delta" es obligatorio (número).' });
    }
    const row = await inv.adjustStock(req.params.id, delta, (req.body || {}).reason || 'adjust');
    res.json({ ok: true, stock: row.stock });
  })
);

// Admin — eliminar ingrediente o producto terminado.
// Sin ?force y si está en uso responde 409 con el detalle ({ usage, message }) para
// que el panel ofrezca un segundo paso explícito; con ?force=1 limpia las
// referencias (recetas, lotes, vínculo con el menú) en una transacción.
router.delete('/admin/inventory/ingredients/:id', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    const force = isTruthy(req.query.force) || isTruthy(body.force);
    const removed = await inv.deleteIngredient(req.params.id, { force });
    res.json({ ok: true, ...removed });
  })
);

// Admin — revertir un lote de producción mal registrado: descuenta lo producido,
// devuelve los ingredientes consumidos y borra el lote.
router.delete('/admin/inventory/production/batches/:id', requireAdmin,
  wrap(async (req, res) => {
    const batch = await inv.revertProductionBatch(req.params.id);
    res.json({ ok: true, ...batch });
  })
);

// Admin — guardar receta de un plato (base o una variante específica)
router.put('/admin/inventory/recipes/:productId', requireAdmin,
  wrap(async (req, res) => {
    const body = req.body || {};
    await inv.saveRecipe(req.params.productId, body.productName, body.rows, {
      variant: body.variant,
    });
    res.json({ ok: true });
  })
);

// Admin — movimientos de stock (auditoría)
router.get('/admin/inventory/movements', requireAdmin,
  wrap(async (req, res) => {
    const movements = await inv.getMovements(req.query.limit);
    res.json({ movements });
  })
);

module.exports = router;