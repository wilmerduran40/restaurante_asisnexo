'use strict';

// Productos del menú + categorías + menú público. La tabla `products` es la
// fuente de verdad del menú (reemplaza data/menu.js en runtime). Cada producto
// puede apuntar a un stock terminado (products.stock_item_id -> ingredients con
// kind='product') para bebidas/empacados.

const { query, withTransaction } = require('./db');

function httpError(status, message, data) {
  const err = new Error(message);
  err.status = status;
  if (data) err.data = data;
  return err;
}

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// Genera un slug a partir de un texto: quita acentos, pasa a minúsculas y deja
// solo alfanuméricos separados por "_". Se usa para crear categorías sin que el
// admin tenga que escribir el slug a mano.
function slugify(text) {
  const s = String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return s || 'categoria';
}

function mapProduct(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    desc: r.desc,
    img: r.img,
    popular: !!r.popular,
    upsell: !!r.upsell,
    salsas: !!r.salsas,
    variants: Array.isArray(r.variants) ? r.variants : [],
    variantTitle: r.variant_title || null,
    removable: Array.isArray(r.removable) ? r.removable : [],
    extras: Array.isArray(r.extras) ? r.extras : [],
    sinNo: Array.isArray(r.sin_no) ? r.sin_no : [],
    flavors: (r.flavors && typeof r.flavors === 'object' && !Array.isArray(r.flavors)) ? r.flavors : null,
    sinPan: !!r.sin_pan,
    active: !!r.active,
    sort: Number(r.sort) || 0,
    stockItemId: r.stock_item_id === null || r.stock_item_id === undefined ? null : Number(r.stock_item_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapCategory(r) {
  return {
    slug: r.slug,
    name: r.name,
    icon: r.icon,
    sort: Number(r.sort) || 0,
    active: !!r.active,
  };
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

async function getProducts(opts = {}) {
  const { rows } = await query(
    'SELECT * FROM products ORDER BY sort, name'
  );
  let list = rows.map(mapProduct);
  if (!opts.includeInactive) list = list.filter((p) => p.active);
  return list;
}

async function getProduct(id) {
  const { rows } = await query('SELECT * FROM products WHERE id = $1', [String(id)]);
  return rows.length ? mapProduct(rows[0]) : null;
}

// Crea o actualiza. Si `id` cambia y ya existía (edit), se actualiza con ese id.
// Con `opts.create = true` (alta desde el panel) no se sobrescribe un producto
// existente: se devuelve un conflicto para no pisar datos por accidente.
async function saveProduct(data, client, opts) {
  const q = client ? client.query.bind(client) : query;
  const id = String(data.id || '').trim();
  const name = String(data.name || '').trim();
  if (!id) throw httpError(400, 'El id del producto es obligatorio.');
  if (!name) throw httpError(400, 'El nombre del producto es obligatorio.');
  const category = String(data.category || '').trim();
  if (!category) throw httpError(400, 'La categoría es obligatoria.');

  const price = data.price === null || data.price === undefined || data.price === '' ? null : num(data.price, null);
  const variants = Array.isArray(data.variants) ? JSON.stringify(data.variants) : '[]';
  const removable = Array.isArray(data.removable) ? JSON.stringify(data.removable) : '[]';
  const extras = Array.isArray(data.extras) ? JSON.stringify(data.extras) : '[]';
  const sinNo = Array.isArray(data.sinNo) ? JSON.stringify(data.sinNo) : '[]';
  // Sabores multi-selección de las alitas: { options: [], max: N }. Se guarda tal
  // cual (JSONB) para que menu.html lo consuma igual que data/menu.js.
  const flavors = (data.flavors && typeof data.flavors === 'object' && !Array.isArray(data.flavors))
    ? JSON.stringify({ options: Array.isArray(data.flavors.options) ? data.flavors.options : [], max: Math.max(1, Number(data.flavors.max) || 1) })
    : 'null';
  const variantTitle = String(data.variantTitle || '').trim() || null;
  const sinPan = data.sinPan ? true : false;

  const exists = await q('SELECT 1 FROM products WHERE id = $1', [id]);
  if (exists.rows.length && opts && opts.create) {
    throw httpError(409, 'Ya existe un producto con el id "' + id + '". Elige otro ID o edita el existente.');
  }

  // El flag del pop-up de bebidas (upsell) se gestiona aparte (endpoint /upsell).
  // Si el body no lo trae (edición desde el modal general) se conserva el actual;
  // en un alta nueva y sin valor queda en false.
  let upsell = data.upsell === undefined ? null : !!data.upsell;
  if (upsell === null && exists.rows.length) {
    const cur = await q('SELECT upsell FROM products WHERE id = $1', [id]);
    upsell = !!(cur.rows[0] && cur.rows[0].upsell);
  }
  if (upsell === null) upsell = false;

  const fields = {
    name,
    category,
    price,
    desc: String(data.desc || ''),
    img: String(data.img || 'img/placeholder.svg'),
    popular: data.popular ? true : false,
    upsell,
    salsas: data.salsas !== false,
    variants,
    variantTitle,
    removable,
    extras,
    sin_no: sinNo,
    flavors,
    sin_pan: sinPan,
    active: data.active !== false,
    sort: Math.max(0, Number(data.sort) || 0),
  };

  // Stock propio: si el producto es un terminado (bebida/empacado) se enlaza a un
  // ingrediente kind='product' con el mismo nombre (se crea si no existe).
  let stockItemId = null;
  if (data.hasStock) {
    const found = await q('SELECT id, kind FROM ingredients WHERE name = $1', [name]);
    if (found.rows.length && found.rows[0].kind === 'product') {
      stockItemId = found.rows[0].id;
    } else if (found.rows.length && found.rows[0].kind !== 'product') {
      // El nombre coincide con una materia prima: enlazarlo sería incorrecto
      // (descontaría stock de un ingrediente como si fuera el producto).
      throw httpError(400,
        'El nombre "' + name + '" ya existe como ingrediente de cocina. Desmarca "Tiene stock propio" o usa otro nombre.');
    } else if (!found.rows.length) {
      const ins = await q(
        'INSERT INTO ingredients (name, unit, kind) VALUES ($1, $2, $3) RETURNING id',
        [name, 'unidad', 'product']
      );
      stockItemId = ins.rows[0].id;
    }
  } else if (data.stockItemId) {
    stockItemId = Number(data.stockItemId) || null;
  }

  try {
    if (exists.rows.length) {
      const { rows } = await q(
        `UPDATE products SET name=$1, category=$2, price=$3, "desc"=$4, img=$5, popular=$6,
                salsas=$7, variants=$8::jsonb, removable=$9::jsonb, extras=$10::jsonb,
                sin_no=$11::jsonb, active=$12, sort=$13, stock_item_id=$14, upsell=$15,
                variant_title=$16, flavors=$17::jsonb, sin_pan=$18, updated_at=now()
         WHERE id=$19 RETURNING *`,
        [fields.name, fields.category, fields.price, fields.desc, fields.img, fields.popular,
         fields.salsas, fields.variants, fields.removable, fields.extras, fields.sin_no,
         fields.active, fields.sort, stockItemId, fields.upsell,
         fields.variantTitle, fields.flavors, fields.sinPan, id]
      );
      return mapProduct(rows[0]);
    }
    const { rows } = await q(
      `INSERT INTO products (id, name, category, price, "desc", img, popular, salsas,
                             variants, removable, extras, sin_no, active, sort, stock_item_id, upsell,
                             variant_title, flavors, sin_pan)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18::jsonb,$19)
       RETURNING *`,
      [id, fields.name, fields.category, fields.price, fields.desc, fields.img, fields.popular,
       fields.salsas, fields.variants, fields.removable, fields.extras, fields.sin_no,
       fields.active, fields.sort, stockItemId, fields.upsell,
       fields.variantTitle, fields.flavors, fields.sinPan]
    );
    return mapProduct(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'Ya existe un producto con ese id.');
    if (err.code === '23503') throw httpError(400, 'La categoría no existe.');
    throw err;
  }
}

async function setProductImage(id, img) {
  const { rows } = await query(
    'UPDATE products SET img = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [img, String(id)]
  );
  if (!rows.length) throw httpError(404, 'Producto no encontrado.');
  return mapProduct(rows[0]);
}

// Muestra u oculta el producto del menú (soft): deja de salir en la web y el POS
// pero conserva recetas, ítem de stock e historial. Para quitarlo de verdad, DELETE.
async function setProductActive(id, active) {
  const { rows } = await query(
    'UPDATE products SET active = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [String(id), active ? true : false]
  );
  if (!rows.length) throw httpError(404, 'Producto no encontrado.');
  return mapProduct(rows[0]);
}

// Marca/desmarca una bebida para el pop-up (upsell) de la web. No afecta su
// visibilidad en el menú; solo controla si aparece en el modal de bebidas.
async function setProductUpsell(id, upsell) {
  const { rows } = await query(
    'UPDATE products SET upsell = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [String(id), upsell ? true : false]
  );
  if (!rows.length) throw httpError(404, 'Producto no encontrado.');
  return mapProduct(rows[0]);
}

// Borrado real del producto. Sin `force` y si tiene recetas definidas, responde 409
// con el detalle; con `force` las borra (recipes.product_id es TEXT, sin FK, así que
// hay que limpiarlas a mano) y desvincula el ítem de stock propio.
//
// Los pedidos ya registrados y las estadísticas NO se ven afectados: orders.items
// guarda una copia del nombre (y las estadísticas leen ese JSONB, no products).
async function deleteProduct(id, opts = {}) {
  const pid = String(id);
  const cur = await getProduct(pid);
  if (!cur) throw httpError(404, 'Producto no encontrado.');

  const { rows: recRows } = await query(
    'SELECT count(*)::int AS n, count(DISTINCT COALESCE(NULLIF(variant, \'\'), \'base\'))::int AS profiles FROM recipes WHERE product_id = $1',
    [pid]
  );
  const usage = {
    productId: cur.id,
    recipes: recRows[0].n,
    recipeProfiles: recRows[0].profiles,
    hasStockItem: cur.stockItemId !== null,
  };

  if ((usage.recipes > 0 || usage.hasStockItem) && !opts.force) {
    const detalles = [];
    if (usage.recipes > 0) {
      detalles.push(
        'tiene ' + usage.recipes
        + (usage.recipes === 1 ? ' receta' : ' recetas')
        + ' en ' + usage.recipeProfiles
        + (usage.recipeProfiles === 1 ? ' perfil (base o variante)' : ' perfiles (base/variantes)')
      );
    }
    if (usage.hasStockItem) detalles.push('tiene un ítem de stock propio enlazado');
    const consecuencia = [];
    if (usage.recipes > 0) consecuencia.push('se borran esas recetas');
    if (usage.hasStockItem) consecuencia.push('se desvincula su ítem de stock (el ítem no se borra, pero deja de estar enlazado)');
    throw httpError(
      409,
      '"' + cur.name + '" ' + detalles.join(' y ') + '. Si lo eliminas de todos modos ' + consecuencia.join(' y ') + '.',
      { usage }
    );
  }

  return withTransaction(async (client) => {
    const qq = client.query.bind(client);
    const rec = await qq('DELETE FROM recipes WHERE product_id = $1', [pid]);
    // Desvincula el ítem de stock propio: el ingrediente (kind='product') se queda
    // con su stock e historial, solo deja de estar enlazado a este producto.
    let stockLinks = 0;
    if (cur.stockItemId !== null) {
      const stock = await qq(
        'UPDATE products SET stock_item_id = NULL, updated_at = now() WHERE stock_item_id = $1',
        [cur.stockItemId]
      );
      stockLinks = stock.rowCount;
    }
    const del = await qq('DELETE FROM products WHERE id = $1', [pid]);
    if (!del.rowCount) throw httpError(404, 'Producto no encontrado.');
    return {
      id: cur.id,
      name: cur.name,
      cleaned: { recipes: rec.rowCount, stockLinks },
    };
  });
}

async function getProductIds() {
  const { rows } = await query('SELECT id FROM products');
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

async function getCategories(opts = {}) {
  const { rows } = await query('SELECT * FROM categories ORDER BY sort, name');
  let list = rows.map(mapCategory);
  if (!opts.includeInactive) list = list.filter((c) => c.active);
  return list;
}

async function saveCategory(data) {
  let slug = String(data.slug || '').trim().toLowerCase().replace(/\s+/g, '_');
  const name = String(data.name || '').trim();
  if (!name) throw httpError(400, 'El nombre de la categoría es obligatorio.');

  // Alta desde el panel sin slug: se genera desde el nombre y, si ya existe,
  // se le agrega un sufijo numérico en vez de fallar.
  if (!slug) {
    slug = slugify(name);
    const base = slug;
    let n = 1;
    while ((await query('SELECT 1 FROM categories WHERE slug = $1', [slug])).rows.length) {
      n += 1;
      slug = base + '_' + n;
    }
  }

  const exists = await query('SELECT 1 FROM categories WHERE slug = $1', [slug]);
  const icon = String(data.icon || 'fa-box').trim();
  const sort = Math.max(0, Number(data.sort) || 0);
  const active = data.active !== false;
  try {
    if (exists.rows.length) {
      const { rows } = await query(
        'UPDATE categories SET name=$1, icon=$2, sort=$3, active=$4 WHERE slug=$5 RETURNING *',
        [name, icon, sort, active, slug]
      );
      return mapCategory(rows[0]);
    }
    const { rows } = await query(
      'INSERT INTO categories (slug, name, icon, sort, active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [slug, name, icon, sort, active]
    );
    return mapCategory(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'Ya existe una categoría con ese slug.');
    throw err;
  }
}

async function deleteCategory(slug) {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM products WHERE category = $1',
    [String(slug)]
  );
  if (rows[0].n > 0) throw httpError(409, 'La categoría tiene productos; no se puede eliminar.');
  const { rowCount } = await query('DELETE FROM categories WHERE slug = $1', [String(slug)]);
  if (!rowCount) throw httpError(404, 'Categoría no encontrada.');
}

// ---------------------------------------------------------------------------
// Menú público (web): mismo shape que data/menu.js
// ---------------------------------------------------------------------------

async function getPublicMenu() {
  const [products, categories] = await Promise.all([
    query('SELECT * FROM products WHERE active = true ORDER BY sort, name'),
    query('SELECT * FROM categories WHERE active = true ORDER BY sort, name'),
  ]);
  return {
    categories: categories.rows.map(mapCategory),
    products: products.rows.map(mapProduct),
  };
}

module.exports = {
  httpError,
  getProducts,
  getProduct,
  saveProduct,
  setProductImage,
  setProductActive,
  setProductUpsell,
  deleteProduct,
  getProductIds,
  getCategories,
  saveCategory,
  deleteCategory,
  getPublicMenu,
};