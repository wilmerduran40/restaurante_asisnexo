'use strict';

// Inventario de stock: ingredientes, recetas por plato (base + variantes) y
// movimientos. El servidor es la fuente autoritativa: al crear un pedido se
// valida el stock y se descuenta; al anular se restaura.
//
// Reglas de consumo por item:
// - Receta base (variant NULL) siempre se consume.
// - Receta de la variante elegida (variant = label) se consume.
// - "sin" (removed): quita lo que aporta la receta para ese ingrediente.
// - Extras: consumen 1 unidad del ingrediente cuyo nombre coincide con el extra.
// - Plato sin filas de receta: no consume stock (no bloqueado).

const { query, withTransaction } = require('./db');

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function httpError(status, message, data) {
  const err = new Error(message);
  err.status = status;
  if (data) err.data = data;
  return err;
}

// withTransaction viene de db.js (se reexporta más abajo para los imports previos).

function q(client) {
  return client ? client.query.bind(client) : query;
}

function mapIngredient(r) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind || 'ingredient',
    stock: Number(r.stock),
    unit: r.unit,
    lowThreshold: r.low_threshold === null || r.low_threshold === undefined ? 0 : Number(r.low_threshold),
    alwaysAvailable: !!r.always_available,
    updatedAt: r.updated_at,
  };
}

// Ingredientes que el botón "Crear ingredientes sugeridos del menú" marca como
// "siempre hay" (no bloquean ni descuentan). Fuente única en el servidor: si el
// dueño agrega/quita salsas o aderezos, se edita aquí y el panel lo consume.
const SUGGESTED_ALWAYS_AVAILABLE = [
  'Maíz',
  'Salsa de Tomate', 'Mostaza', 'Mayonesa', 'Salsa de la Casa',
  'Salsa tártara', 'Tartara', 'Aderezo césar', 'Salsa BBQ',
];

function getSuggestedAlwaysAvailable() {
  return SUGGESTED_ALWAYS_AVAILABLE.slice();
}

// ---------------------------------------------------------------------------
// Ingredientes (CRUD + ajuste)
// ---------------------------------------------------------------------------

async function getIngredients(kind, client) {
  const k = kind === 'product' || kind === 'ingredient' ? kind : null;
  const sql =
    'SELECT id, name, stock, unit, low_threshold, always_available, kind, updated_at FROM ingredients' +
    (k ? ' WHERE kind = $1' : '') +
    ' ORDER BY name';
  const { rows } = await q(client)(sql, k ? [k] : []);
  return rows.map(mapIngredient);
}

async function getIngredient(id, client) {
  const { rows } = await q(client)('SELECT * FROM ingredients WHERE id = $1', [Number(id)]);
  return rows.length ? rows[0] : null;
}

async function createIngredient({ name, stock = 0, unit = null, lowThreshold = 0, alwaysAvailable = false, kind = 'ingredient' }, client) {
  const clean = String(name || '').trim();
  if (!clean) throw httpError(400, 'El nombre del ingrediente es obligatorio.');
  const k = kind === 'product' ? 'product' : 'ingredient';
  const s = Math.max(0, num(stock, 0));
  const lt = Math.max(0, num(lowThreshold, 0));
  const u = String(unit || '').trim() || null;
  const aa = alwaysAvailable ? true : false;
  try {
    const { rows } = await q(client)(
      `INSERT INTO ingredients (name, stock, unit, low_threshold, always_available, kind)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, stock, unit, low_threshold, always_available, kind, updated_at`,
      [clean, s, u, lt, aa, k]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'Ya existe un ingrediente con ese nombre.');
    throw err;
  }
}

async function updateIngredient(id, { name, stock, unit, lowThreshold, alwaysAvailable, kind }, client) {
  const nid = Number(id);
  if (!Number.isInteger(nid)) throw httpError(400, 'Ingrediente inválido.');
  const cur = await getIngredient(nid, client);
  if (!cur) throw httpError(404, 'Ingrediente no encontrado.');
  const clean = name !== undefined ? String(name).trim() : cur.name;
  if (!clean) throw httpError(400, 'El nombre del ingrediente es obligatorio.');
  const s = stock !== undefined ? Math.max(0, num(stock, cur.stock)) : Number(cur.stock);
  const lt = lowThreshold !== undefined ? Math.max(0, num(lowThreshold, cur.lowThreshold)) : Number(cur.low_threshold);
  const u = unit !== undefined ? (String(unit).trim() || null) : cur.unit;
  const aa = alwaysAvailable !== undefined ? (alwaysAvailable ? true : false) : !!cur.always_available;
  const k = kind !== undefined ? (kind === 'product' ? 'product' : 'ingredient') : (cur.kind || 'ingredient');
  try {
    const { rows } = await q(client)(
      `UPDATE ingredients SET name = $1, stock = $2, unit = $3, low_threshold = $4,
              always_available = $5, kind = $6, updated_at = now()
       WHERE id = $7 RETURNING id, name, stock, unit, low_threshold, always_available, kind, updated_at`,
      [clean, s, u, lt, aa, k, nid]
    );
    // Auditoría: si se fijó un valor de stock directo (conteo/corrección) se
    // registra la diferencia como movimiento 'count' (los botones ± usan el
    // endpoint de ajuste que ya registra su propio movimiento).
    const newStock = Number(rows[0].stock);
    const oldStock = Number(cur.stock);
    if (stock !== undefined && newStock !== oldStock) {
      await q(client)(
        `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
         VALUES ($1, $2, 'count', NULL)`,
        [nid, newStock - oldStock]
      );
    }
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'Ya existe un ingrediente con ese nombre.');
    throw err;
  }
}

// Dónde se usa un ingrediente. Se consulta antes de borrar para poder explicar el
// bloqueo con datos concretos en vez de un 500 genérico de la BD.
async function ingredientUsage(id, client) {
  const nid = Number(id);
  const qq = q(client);
  const [recipes, prodRecipes, batches, batchItems, menuProducts] = await Promise.all([
    qq(
      `SELECT count(*)::int AS n,
              count(DISTINCT product_id)::int AS dishes,
              count(DISTINCT COALESCE(NULLIF(variant, ''), 'base'))::int AS profiles
       FROM recipes WHERE ingredient_id = $1`,
      [nid]
    ),
    qq(
      `SELECT count(*)::int AS n, count(DISTINCT product_id)::int AS products
       FROM production_recipes WHERE ingredient_id = $1`,
      [nid]
    ),
    qq(
      `SELECT count(*)::int AS n, COALESCE(SUM(qty), 0) AS qty, MAX(produced_at) AS last_at
       FROM production_batches WHERE product_id = $1`,
      [nid]
    ),
    qq(
      `SELECT count(*)::int AS n, count(DISTINCT batch_id)::int AS batches,
              COALESCE(SUM(qty), 0) AS qty
       FROM production_batch_items WHERE ingredient_id = $1`,
      [nid]
    ),
    qq('SELECT count(*)::int AS n FROM products WHERE stock_item_id = $1', [nid]),
  ]);
  return {
    ingredientId: nid,
    recipes: recipes.rows[0].n,
    recipeDishes: recipes.rows[0].dishes,
    recipeProfiles: recipes.rows[0].profiles,
    productionRecipes: prodRecipes.rows[0].n,
    productionProducts: prodRecipes.rows[0].products,
    batches: batches.rows[0].n,
    batchQty: Number(batches.rows[0].qty),
    batchLastAt: batches.rows[0].last_at,
    batchItems: batchItems.rows[0].n,
    batchesUsedIn: batchItems.rows[0].batches,
    batchItemsQty: Number(batchItems.rows[0].qty),
    menuProducts: menuProducts.rows[0].n,
  };
}

// Une las cantidades de "usage" en una frase legible para el panel.
function describeIngredientUsage(u) {
  const parts = [];
  if (u.recipes > 0) {
    parts.push(
      u.recipes + (u.recipes === 1 ? ' receta de plato' : ' recetas de plato')
      + ' (' + u.recipeDishes + (u.recipeDishes === 1 ? ' plato' : ' platos') + ')'
    );
  }
  if (u.productionRecipes > 0) {
    parts.push(
      u.productionRecipes
      + (u.productionRecipes === 1 ? ' receta de fabricación' : ' recetas de fabricación')
      + ' de ' + u.productionProducts + (u.productionProducts === 1 ? ' producto' : ' productos')
    );
  }
  if (u.batches > 0) {
    parts.push(
      u.batches + (u.batches === 1 ? ' lote de producción' : ' lotes de producción')
      + ' (' + u.batchQty + ' ud producidas)'
    );
  }
  if (u.batchItems > 0) {
    parts.push(
      'consumido en ' + u.batchesUsedIn
      + (u.batchesUsedIn === 1 ? ' lote de producción' : ' lotes de producción')
      + ' (' + u.batchItemsQty + ' ud)'
    );
  }
  if (u.menuProducts > 0) {
    parts.push(
      u.menuProducts + (u.menuProducts === 1 ? ' producto del menú con stock propio' : ' productos del menú con stock propio')
    );
  }
  return parts;
}

// Elimina un ingrediente (materia prima o producto terminado).
//
// Sin `force` y si está en uso, responde 409 con el detalle para que el panel
// ofrezca un segundo paso explícito. Con `force`, limpia las referencias en una
// transacción, siempre en orden hijos -> padre para respetar los FKs:
//   production_recipes -> production_batch_items -> production_batches
//   -> products.stock_item_id -> ingredients
// (recipes y stock_movements caen en CASCADE solo al final).
async function deleteIngredient(id, opts = {}) {
  const nid = Number(id);
  if (!Number.isInteger(nid)) throw httpError(400, 'Ingrediente inválido.');
  const cur = await getIngredient(nid);
  if (!cur) throw httpError(404, 'Ingrediente no encontrado.');

  if (!opts.force) {
    const usage = await ingredientUsage(nid);
    const parts = describeIngredientUsage(usage);
    if (parts.length) {
      throw httpError(
        409,
        '"' + cur.name + '" está en uso: ' + parts.join(', ') + '. '
        + 'Si lo eliminas de todos modos se borran esas referencias y su historial.',
        { usage }
      );
    }
  }

  try {
    return await withTransaction(async (client) => {
      const qq = q(client);
      const pr = await qq('DELETE FROM production_recipes WHERE ingredient_id = $1', [nid]);
      const pbi = await qq('DELETE FROM production_batch_items WHERE ingredient_id = $1', [nid]);
      const pb = await qq('DELETE FROM production_batches WHERE product_id = $1', [nid]);
      const mp = await qq('UPDATE products SET stock_item_id = NULL, updated_at = now() WHERE stock_item_id = $1', [nid]);
      const del = await qq('DELETE FROM ingredients WHERE id = $1', [nid]);
      if (!del.rowCount) throw httpError(404, 'Ingrediente no encontrado.');
      return {
        id: nid,
        name: cur.name,
        cleaned: {
          productionRecipes: pr.rowCount,
          batchItems: pbi.rowCount,
          batches: pb.rowCount,
          menuProducts: mp.rowCount,
        },
      };
    });
  } catch (err) {
    // Red de seguridad: si algún FK sin acción bloquea el borrado, se reporta
    // como conflicto entendible en vez del 500 interno.
    if (err.code === '23503') {
      throw httpError(
        409,
        '"' + cur.name + '" tiene referencias que no se pueden quitar automáticamente. Revisa sus recetas y lotes.'
      );
    }
    throw err;
  }
}

// Ajuste manual de stock (restock/corrección) con registro de movimiento.
async function adjustStock(ingredientId, delta, reason, opts = {}) {
  const nid = Number(ingredientId);
  const d = num(delta, 0);
  if (!Number.isInteger(nid)) throw httpError(400, 'Ingrediente inválido.');
  if (!Number.isFinite(d)) throw httpError(400, 'Delta inválido.');
  const qq = q(opts.client);
  const { rows } = await qq(
    'UPDATE ingredients SET stock = GREATEST(0, stock + $1), updated_at = now() WHERE id = $2 RETURNING id, stock',
    [d, nid]
  );
  if (!rows.length) throw httpError(404, 'Ingrediente no encontrado.');
  await qq(
    `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
     VALUES ($1, $2, $3, $4)`,
    [nid, d, String(reason || 'adjust'), opts.orderId || null]
  );
  return rows[0];
}

async function bulkCreateIngredients(names, alwaysAvailableNames, client) {
  const qq = q(client);
  const created = [];
  const aaSet = new Set((alwaysAvailableNames || []).map(norm).filter(Boolean));
  for (const raw of names || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const isAA = aaSet.has(norm(name));
    if (isAA) {
      // Upsert conservando el flag si el ingrediente ya estaba marcado.
      const { rowCount } = await qq(
        `INSERT INTO ingredients (name, always_available) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET
           always_available = ingredients.always_available OR EXCLUDED.always_available`,
        [name, true]
      );
      if (rowCount) created.push(name);
    } else {
      const { rowCount } = await qq(
        'INSERT INTO ingredients (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name]
      );
      if (rowCount) created.push(name);
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Recetas
// ---------------------------------------------------------------------------

async function getRecipeRows(client) {
  const { rows } = await q(client)(
    `SELECT r.id, r.product_id, r.product_name, r.variant, r.ingredient_id, r.qty,
            i.name AS ingredient_name
     FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
     ORDER BY r.product_id, r.variant NULLS FIRST, i.name`
  );
  return rows;
}

async function saveRecipe(productId, productName, rows, opts = {}) {
  const pid = String(productId || '').trim();
  if (!pid) throw httpError(400, 'productId es obligatorio.');
  // Variante objetivo: '' o null = base; si se pasa, solo se reemplazan sus filas.
  const targetVariant =
    opts.variant === undefined || opts.variant === null || opts.variant === ''
      ? null
      : String(opts.variant).trim();
  const clean = Array.isArray(rows) ? rows : [];
  const normalized = clean.map((r) => {
    const ingredientId = Number(r.ingredientId);
    const qty = num(r.qty, 1);
    if (!Number.isInteger(ingredientId)) throw httpError(400, 'Cada fila necesita ingredientId.');
    if (qty <= 0) throw httpError(400, 'La cantidad de cada fila debe ser mayor que 0.');
    return { ingredientId, qty };
  });

  const ids = [...new Set(normalized.map((r) => r.ingredientId))];
  if (ids.length) {
    const { rows: ing } = await q()('SELECT id FROM ingredients WHERE id = ANY($1::int[])', [ids]);
    const existing = new Set(ing.map((i) => i.id));
    for (const r of normalized) {
      if (!existing.has(r.ingredientId)) {
        throw httpError(400, 'El ingrediente (id ' + r.ingredientId + ') no existe.');
      }
    }
  }

  const doSave = async (qq2) => {
    if (targetVariant === null) {
      await qq2('DELETE FROM recipes WHERE product_id = $1 AND variant IS NULL', [pid]);
    } else {
      await qq2('DELETE FROM recipes WHERE product_id = $1 AND variant = $2', [pid, targetVariant]);
    }
    for (const r of normalized) {
      await qq2(
        `INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
         VALUES ($1, $2, $3, $4, $5)`,
        [pid, String(productName || '').trim(), targetVariant, r.ingredientId, r.qty]
      );
    }
  };
  return withTransaction((c) => doSave(q(c)));
}

// ---------------------------------------------------------------------------
// Consumo de stock (pedidos)
// ---------------------------------------------------------------------------

// Calcula el requerimiento de ingredientes de una lista de items (formato del
// pedido: { productId?, name, variant?, removed[], extras[], qty }).
// Devuelve { required: Map(id -> { name, qty }) }.
async function computeRequired(items) {
  const [recipeRows, ingredients, stockProducts] = await Promise.all([
    getRecipeRows(),
    getIngredients(),
    query(
      `SELECT p.id, p.name, p.stock_item_id
       FROM products p JOIN ingredients i ON i.id = p.stock_item_id
       WHERE p.active = true AND p.stock_item_id IS NOT NULL`
    ),
  ]);

  const nameId = new Map();
  const idName = new Map();
  for (const ing of ingredients) {
    nameId.set(norm(ing.name), ing.id);
    idName.set(ing.id, ing.name);
  }

  // Productos con stock propio (bebidas, empacados): se consumen directamente,
  // sin depender de recetas.
  const stockByPid = new Map();
  const stockByName = new Map();
  for (const r of stockProducts.rows) {
    const sid = Number(r.stock_item_id);
    stockByPid.set(r.id, sid);
    stockByName.set(norm(r.name), sid);
  }

  const byId = new Map();
  const byName = new Map();
  for (const r of recipeRows) {
    if (!byId.has(r.product_id)) byId.set(r.product_id, []);
    byId.get(r.product_id).push(r);
    if (r.product_name) {
      const key = norm(r.product_name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(r);
    }
  }

  const required = new Map();
  const nonBlocking = new Set(
    ingredients.filter((i) => i.alwaysAvailable).map((i) => i.id)
  );
  const add = (id, qty) => {
    if (nonBlocking.has(id)) return; // "siempre hay": no consume ni bloquea
    const cur = required.get(id) || { name: idName.get(id) || '?', qty: 0 };
    cur.qty += qty;
    required.set(id, cur);
  };

  for (const it of Array.isArray(items) ? items : []) {
    const qt = Math.max(0, Number(it.qty) || 0);
    if (!qt) continue;

    // Producto con stock propio: 1 ud por unidad vendida (no toca recetas).
    const stockId =
      (it.productId && stockByPid.get(String(it.productId))) ||
      stockByName.get(norm(it.name));
    if (stockId !== undefined) {
      add(stockId, qt);
      continue;
    }

    const rows =
      (it.productId && byId.get(String(it.productId))) || byName.get(norm(it.name));
    if (!rows) continue; // plato sin receta: no consume, no bloqueado

    const variantNorm = norm(it.variant);
    const matchesVariant = (r) =>
      r.variant === null || r.variant === undefined || r.variant === '' || norm(r.variant) === variantNorm;

    const recipeQty = new Map();
    for (const r of rows) {
      if (matchesVariant(r)) {
        recipeQty.set(r.ingredient_id, (recipeQty.get(r.ingredient_id) || 0) + Number(r.qty));
      }
    }

    // "sin": quita lo que aporta la receta para ese ingrediente
    for (const rm of Array.isArray(it.removed) ? it.removed : []) {
      const id = nameId.get(norm(rm));
      if (id !== undefined && recipeQty.has(id)) {
        const rowQty = rows
          .filter((r) => r.ingredient_id === id && matchesVariant(r))
          .reduce((s, r) => s + Number(r.qty), 0);
        recipeQty.set(id, Math.max(0, recipeQty.get(id) - rowQty));
      }
    }

    for (const [id, qty] of recipeQty) {
      if (qty > 0) add(id, qty * qt);
    }
    // extras: consumen 1 unidad del ingrediente con el mismo nombre
    for (const ex of Array.isArray(it.extras) ? it.extras : []) {
      const id = nameId.get(norm(ex && ex.name));
      if (id !== undefined) add(id, qt);
    }
  }

  return { required };
}

// Descuenta el stock dentro de una transacción ya abierta. No bloquea: si no
// hay stock suficiente el valor queda negativo (la producción se registra en
// total, nunca se rechaza un pedido por falta de ingredientes).
async function consumeStock(required, orderId, client) {
  const qq = q(client);
  for (const [id, req] of required) {
    await qq(
      'UPDATE ingredients SET stock = stock - $1, updated_at = now() WHERE id = $2',
      [req.qty, id]
    );
    await qq(
      `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
       VALUES ($1, $2, 'order', $3)`,
      [id, -req.qty, orderId]
    );
  }
}

// Restaura el stock de un pedido al anularlo. Idempotente: solo restaura si el
// pedido realmente consumió stock y aún no fue restaurado.
//
// Restaura los valores EXACTOS que se descontaron al crear el pedido (leídos de
// stock_movements), no los que calcularía la receta de hoy: si una receta cambió
// entre la venta y la anulación, se devuelve lo consumido, no lo que diría la
// receta actual (y un ingrediente marcado después como "siempre hay" igual se
// restaura, porque sí se consumió).
async function restoreOrderStock(order) {
  const consumed = await query(
    `SELECT ingredient_id, delta FROM stock_movements
     WHERE order_id = $1 AND reason = 'order'`,
    [order.id]
  );
  if (!consumed.rows.length) return false;
  const already = await query(
    `SELECT 1 FROM stock_movements WHERE order_id = $1 AND reason = 'order_cancel' LIMIT 1`,
    [order.id]
  );
  if (already.rows.length) return false;

  await withTransaction(async (client) => {
    const qq = q(client);
    for (const r of consumed.rows) {
      const restoreQty = Math.abs(Number(r.delta));
      if (!(restoreQty > 0)) continue;
      await qq(
        'UPDATE ingredients SET stock = stock + $1, updated_at = now() WHERE id = $2',
        [restoreQty, r.ingredient_id]
      );
      await qq(
        `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
         VALUES ($1, $2, 'order_cancel', $3)`,
        [r.ingredient_id, restoreQty, order.id]
      );
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// Disponibilidad (para la web y el POS)
// ---------------------------------------------------------------------------

// Calcula qué platos no pueden servirse hoy con el stock actual y el estado de
// cada variante. Devuelve { products: { id: { baseOk, variants: {label:bool} } },
// ingredients: { name: stock } }. Solo aparecen platos con receta (o con stock
// propio en el caso de bebidas/empacados); los demás se consideran disponibles
// (el cliente aplica el resto de la lógica con su menú).
async function getAvailability() {
  const [recipeRows, ingredients, stockProducts] = await Promise.all([
    getRecipeRows(),
    getIngredients(),
    query(
      `SELECT p.id, p.name, p.stock_item_id, i.stock AS stock
       FROM products p JOIN ingredients i ON i.id = p.stock_item_id
       WHERE p.active = true AND p.stock_item_id IS NOT NULL`
    ),
  ]);
  const stock = new Map(ingredients.map((i) => [i.id, i.stock]));

  const byProduct = new Map();
  for (const r of recipeRows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id).push(r);
  }

  const nonBlocking = new Set(
    ingredients.filter((i) => i.alwaysAvailable).map((i) => i.id)
  );

  const products = {};
  const ingredientsOut = {};
  for (const ing of ingredients) {
    if (ing.alwaysAvailable || ing.kind === 'product') continue; // no como extra
    ingredientsOut[ing.name] = ing.stock;
  }

  // Productos con stock propio (bebidas, empacados): disponibles si stock >= 1.
  for (const r of stockProducts.rows) {
    const sid = Number(r.stock_item_id);
    products[r.id] = {
      baseOk: (stock.get(sid) || 0) >= 1,
      variants: {},
    };
  }

  const enough = (rows) => {
    const need = new Map();
    for (const r of rows) {
      if (nonBlocking.has(r.ingredient_id)) continue; // no bloquea
      need.set(r.ingredient_id, (need.get(r.ingredient_id) || 0) + Number(r.qty));
    }
    for (const [id, qty] of need) {
      if ((stock.get(id) || 0) < qty) return false;
    }
    return true;
  };

  for (const [pid, rows] of byProduct) {
    const base = [];
    const variants = new Map();
    for (const r of rows) {
      if (r.variant === null || r.variant === undefined || r.variant === '') {
        base.push(r);
      } else {
        if (!variants.has(r.variant)) variants.set(r.variant, []);
        variants.get(r.variant).push(r);
      }
    }
    const baseOk = enough(base);
    const vOut = {};
    for (const [label, vrows] of variants) {
      vOut[label] = enough(base.concat(vrows));
    }
    products[pid] = { baseOk, variants: vOut };
  }

  return { products, ingredients: ingredientsOut };
}

async function getMovements(limit = 50) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const { rows } = await query(
    `SELECT m.id, m.ingredient_id, i.name AS ingredient, m.delta, m.reason, m.order_id, m.created_at
     FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
     ORDER BY m.created_at DESC, m.id DESC LIMIT $1`,
    [n]
  );
  return rows.map((r) => ({
    id: r.id,
    ingredient: r.ingredient,
    delta: Number(r.delta),
    reason: r.reason,
    orderId: r.order_id,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Producción y compra de productos terminados
// ---------------------------------------------------------------------------

async function getProduct(id) {
  const { rows } = await query(
    'SELECT id, name, stock, unit, kind, always_available, updated_at FROM ingredients WHERE id = $1',
    [Number(id)]
  );
  return rows.length ? mapIngredient(rows[0]) : null;
}

async function assertProduct(nid) {
  const p = await getProduct(nid);
  if (!p) throw httpError(404, 'Producto no encontrado.');
  if (p.kind !== 'product') throw httpError(400, 'El destino debe ser un producto terminado (kind=product).');
  return p;
}

// Registra un lote de producción: suma stock al producto terminado y guarda el
// lote + movimientos. Los ingredientes consumidos son OPCIONALES: si se indican
// se descuentan de la materia prima dentro de la misma transacción; si no, el
// lote solo suma stock ("produje N unidades"). Transaccional.
async function registerProduction({ productId, qty, items, note }) {
  const nid = Number(productId);
  const n = num(qty, 0);
  if (!Number.isInteger(nid)) throw httpError(400, 'Producto inválido.');
  if (!(n > 0)) throw httpError(400, 'La cantidad producida debe ser mayor que 0.');
  const prod = await assertProduct(nid);

  const clean = Array.isArray(items) ? items : [];
  // Los ingredientes son opcionales: un lote puede ser solo "produje N uds"
  // (suma stock sin descontar materia prima). Si se indican, se descuentan
  // dentro de la misma transacción sin bloquear por stock (puede quedar
  // negativo: la producción se registra en total).
  const need = new Map();
  for (const r of clean) {
    const iid = Number(r.ingredientId);
    const q = num(r.qty, 0);
    if (!Number.isInteger(iid)) throw httpError(400, 'Cada fila necesita ingredientId.');
    if (iid === nid) throw httpError(400, 'Un producto no puede consumirse a sí mismo.');
    if (!(q > 0)) throw httpError(400, 'La cantidad de cada ingrediente debe ser mayor que 0.');
    need.set(iid, (need.get(iid) || 0) + q);
  }

  if (need.size) {
    const ids = [...need.keys()];
    const { rows: ings } = await query(
      'SELECT id FROM ingredients WHERE id = ANY($1::int[])',
      [ids]
    );
    if (ings.length !== ids.length) throw httpError(400, 'Algún ingrediente no existe.');
  }

  return withTransaction(async (client) => {
    const qq = q(client);
    for (const [id, qty] of need) {
      await qq(
        'UPDATE ingredients SET stock = stock - $1, updated_at = now() WHERE id = $2',
        [qty, id]
      );
      await qq(
        `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
         VALUES ($1, $2, 'production', NULL)`,
        [id, -qty]
      );
    }
    await qq('UPDATE ingredients SET stock = stock + $1, updated_at = now() WHERE id = $2', [n, nid]);
    await qq(
      `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
       VALUES ($1, $2, 'production_in', NULL)`,
      [nid, n]
    );
    const { rows: b } = await qq(
      'INSERT INTO production_batches (product_id, qty, note) VALUES ($1, $2, $3) RETURNING id, produced_at',
      [nid, n, String(note || '').trim() || null]
    );
    for (const [id, qty] of need) {
      await qq(
        'INSERT INTO production_batch_items (batch_id, ingredient_id, qty) VALUES ($1, $2, $3)',
        [b[0].id, id, qty]
      );
    }
    return { batchId: b[0].id, product: prod.name, qty: n, producedAt: b[0].produced_at };
  });
}

// Entrada por compra de un producto terminado (empacado/comprado).
async function restockProduct(productId, qty, note) {
  const nid = Number(productId);
  const n = num(qty, 0);
  if (!Number.isInteger(nid)) throw httpError(400, 'Producto inválido.');
  if (!(n > 0)) throw httpError(400, 'La cantidad debe ser mayor que 0.');
  await assertProduct(nid);
  const { rows } = await query(
    'UPDATE ingredients SET stock = stock + $1, updated_at = now() WHERE id = $2 RETURNING id, stock',
    [n, nid]
  );
  await query(
    `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
     VALUES ($1, $2, 'purchase', NULL)`,
    [nid, n]
  );
  return { id: nid, stock: Number(rows[0].stock), note: String(note || '').trim() || null };
}

// Guarda la receta de fabricación de un producto terminado (BOM).
async function saveProductionRecipe(productId, rows) {
  const nid = Number(productId);
  if (!Number.isInteger(nid)) throw httpError(400, 'Producto inválido.');
  await assertProduct(nid);
  const clean = Array.isArray(rows) ? rows : [];
  const normalized = [];
  for (const r of clean) {
    const iid = Number(r.ingredientId);
    const q = num(r.qty, 1);
    if (!Number.isInteger(iid)) throw httpError(400, 'Cada fila necesita ingredientId.');
    if (iid === nid) throw httpError(400, 'El producto no puede consumirse a sí mismo.');
    if (!(q > 0)) throw httpError(400, 'La cantidad debe ser mayor que 0.');
    normalized.push({ ingredientId: iid, qty: q });
  }
  const ids = [...new Set(normalized.map((r) => r.ingredientId))];
  if (ids.length) {
    const { rows: ings } = await query('SELECT id FROM ingredients WHERE id = ANY($1::int[])', [ids]);
    const existing = new Set(ings.map((i) => i.id));
    for (const r of normalized) {
      if (!existing.has(r.ingredientId)) {
        throw httpError(400, 'El ingrediente (id ' + r.ingredientId + ') no existe.');
      }
    }
  }
  return withTransaction(async (client) => {
    const qq = q(client);
    await qq('DELETE FROM production_recipes WHERE product_id = $1', [nid]);
    for (const r of normalized) {
      await qq(
        'INSERT INTO production_recipes (product_id, ingredient_id, qty) VALUES ($1, $2, $3)',
        [nid, r.ingredientId, r.qty]
      );
    }
  });
}

async function getProductionRecipes(productId) {
  const nid = Number(productId);
  const { rows } = await query(
    `SELECT pr.id, pr.product_id, pr.ingredient_id, pr.qty, i.name AS ingredient_name
     FROM production_recipes pr JOIN ingredients i ON i.id = pr.ingredient_id
     WHERE pr.product_id = $1 ORDER BY i.name`,
    [nid]
  );
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    ingredientId: r.ingredient_id,
    ingredient: r.ingredient_name,
    qty: Number(r.qty),
  }));
}

// Revierte un lote de producción mal registrado: resta del stock del producto
// lo que se produjo, devuelve los ingredientes consumidos y borra el lote.
// Transaccional e idempotente por diseño: si el lote ya no existe, 404 (así no
// se puede revertir dos veces). Los movimientos quedan en la auditoría.
async function revertProductionBatch(id) {
  const nid = Number(id);
  if (!Number.isInteger(nid)) throw httpError(400, 'Lote inválido.');

  return withTransaction(async (client) => {
    const qq = q(client);
    const { rows: b } = await qq(
      'SELECT id, product_id, qty, note FROM production_batches WHERE id = $1 FOR UPDATE',
      [nid]
    );
    if (!b.length) throw httpError(404, 'Lote de producción no encontrado (quizá ya se revirtió).');
    const batch = b[0];
    const qty = Number(batch.qty);

    const { rows: items } = await qq(
      'SELECT ingredient_id, qty FROM production_batch_items WHERE batch_id = $1',
      [nid]
    );

    // 1) Descontar lo producido del producto terminado (no baja de 0).
    const { rows: upd } = await qq(
      'UPDATE ingredients SET stock = GREATEST(0, stock - $1), updated_at = now() WHERE id = $2 RETURNING stock',
      [qty, batch.product_id]
    );
    await qq(
      `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
       VALUES ($1, $2, 'production_revert', NULL)`,
      [batch.product_id, -qty]
    );

    // 2) Devolver cada ingrediente consumido.
    for (const it of items) {
      const backQty = Number(it.qty);
      if (!(backQty > 0)) continue;
      await qq(
        'UPDATE ingredients SET stock = stock + $1, updated_at = now() WHERE id = $2',
        [backQty, it.ingredient_id]
      );
      await qq(
        `INSERT INTO stock_movements (ingredient_id, delta, reason, order_id)
         VALUES ($1, $2, 'production_revert', NULL)`,
        [it.ingredient_id, backQty]
      );
    }

    // 3) Borrar el lote (CASCADE limpia production_batch_items).
    await qq('DELETE FROM production_batches WHERE id = $1', [nid]);

    return {
      id: nid,
      productId: batch.product_id,
      qty,
      stock: upd.length ? Number(upd[0].stock) : 0,
      ingredientsReturned: items.length,
    };
  });
}

async function getProductionBatches(limit = 50) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const { rows } = await query(
    `SELECT pb.id, pb.product_id, i.name AS product, pb.qty, pb.note, pb.produced_at,
            COALESCE(json_agg(json_build_object(
              'ingredientId', pbi.ingredient_id, 'ingredient', ii.name, 'qty', pbi.qty)
            ) FILTER (WHERE pbi.id IS NOT NULL), '[]') AS items
     FROM production_batches pb
     JOIN ingredients i ON i.id = pb.product_id
     LEFT JOIN production_batch_items pbi ON pbi.batch_id = pb.id
     LEFT JOIN ingredients ii ON ii.id = pbi.ingredient_id
     GROUP BY pb.id, i.name
     ORDER BY pb.produced_at DESC, pb.id DESC
     LIMIT $1`,
    [n]
  );
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    product: r.product,
    qty: Number(r.qty),
    note: r.note,
    producedAt: r.produced_at,
    items: r.items,
  }));
}

module.exports = {
  withTransaction,
  getIngredients,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  ingredientUsage,
  describeIngredientUsage,
  adjustStock,
  bulkCreateIngredients,
  getSuggestedAlwaysAvailable,
  getRecipeRows,
  saveRecipe,
  computeRequired,
  consumeStock,
  restoreOrderStock,
  getAvailability,
  getMovements,
  registerProduction,
  restockProduct,
  revertProductionBatch,
  saveProductionRecipe,
  getProductionRecipes,
  getProductionBatches,
  httpError,
};