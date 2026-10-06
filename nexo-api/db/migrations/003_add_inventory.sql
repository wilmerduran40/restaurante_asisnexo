-- Inventario de stock: ingredientes, recetas por plato (base + por variante)
-- y movimientos. Se agrega con migración (no se toca db/schema.sql).
--
-- Reglas:
-- - recipes.variant = NULL  -> ingrediente BASE (se consume siempre).
-- - recipes.variant = 'Pollo' -> se consume solo cuando se elige esa variante.
-- - Un plato sin filas en recipes no consume stock (no bloqueado).

CREATE TABLE IF NOT EXISTS ingredients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  stock NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit TEXT,
  low_threshold NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipes (
  id SERIAL PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  variant TEXT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty NUMERIC(10,2) NOT NULL DEFAULT 1
);

-- Un ingrediente no puede repetirse dentro de la misma receta base ni dentro de
-- la misma variante (NULL se trata como '' para que la base sea única).
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipes_product_variant_ingredient
  ON recipes (product_id, COALESCE(variant, ''), ingredient_id);

CREATE INDEX IF NOT EXISTS idx_recipes_product ON recipes(product_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  delta NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL DEFAULT 'adjust',
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_ingredient
  ON stock_movements(ingredient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements(order_id);