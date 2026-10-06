-- ================================================================
-- Inventario AsisNexo por producción + limpieza
-- ================================================================
-- Corre después de 010 (menú AsisNexo). Hace dos cosas:
--
--   1) Limpia los ingredientes del menú viejo "AsisNexo" que no usa AsisNexo.
--   2) Convierte los platos de comida (alitas y burgers) en productos
--      terminados con stock propio, reabastecidos por lotes de
--      producción / compra (igual que las bebidas). Así el inventario
--      del día a día no requiere manejar cada ingrediente: el panel
--      muestra "Productos terminados + Producción".
--
-- Idempotente: re-ejecutar no duplica ni rompe.

-- ---------------------------------------------------------------------------
-- 1. Limpiar referencias antes de borrar ingredientes.
--    production_batches.product_id y production_batch_items.ingredient_id
--    tienen FK RESTRICT; recipes, production_recipes y stock_movements caen
--    en CASCADE al borrar el ingrediente (products.stock_item_id se pone NULL).
-- ---------------------------------------------------------------------------
DELETE FROM production_batches
WHERE product_id IN (SELECT id FROM ingredients WHERE kind = 'ingredient');

DELETE FROM production_batch_items
WHERE ingredient_id IN (SELECT id FROM ingredients WHERE kind = 'ingredient');

-- ---------------------------------------------------------------------------
-- 2. Borrar ingredientes del menú viejo (los que no conserva AsisNexo).
--    Se conservan los que el menú AsisNexo referencia (extras/removibles) y las
--    salsas/aderezos "siempre hay".
-- ---------------------------------------------------------------------------
DELETE FROM ingredients
WHERE kind = 'ingredient'
  AND name NOT IN (
    'Maíz', 'Tocineta', 'Cheddar', 'Queso Americano', 'Queso',
    'Lechuga', 'Tomate', 'Cebolla',
    'Salsa de Tomate', 'Mostaza', 'Mayonesa', 'Salsa de la Casa',
    'Salsa Tártara', 'Salsa BBQ', 'Aderezo César'
  );

-- ---------------------------------------------------------------------------
-- 3. Platos de comida -> producto terminado con stock propio.
--    Se crea un ítem kind='product' por plato y se enlaza como stock_item_id.
-- ---------------------------------------------------------------------------
INSERT INTO ingredients (name, unit, kind) VALUES
  ('Chicken Little','unidad','product'),
  ('Dúo','unidad','product'),
  ('Tripack','unidad','product'),
  ('Combo Alitas','unidad','product'),
  ('Americana','unidad','product'),
  ('Cheese','unidad','product'),
  ('Cuarto de Libra','unidad','product'),
  ('Smash','unidad','product'),
  ('Burger Especial','unidad','product'),
  ('Burger Crispy','unidad','product')
ON CONFLICT (name) DO NOTHING;

-- Stock inicial de los platos (ajustable desde el panel). Las bebidas ya
-- tienen su stock (24) desde la migración 010.
UPDATE ingredients SET stock = 30
WHERE kind = 'product'
  AND name IN (
    'Chicken Little','Dúo','Tripack','Combo Alitas','Americana','Cheese',
    'Cuarto de Libra','Smash','Burger Especial','Burger Crispy'
  );

-- Vincular cada plato del menú (alitas/burgers) a su stock propio.
UPDATE products SET stock_item_id = i.id
  FROM ingredients i
  WHERE i.kind = 'product' AND i.name = products.name
    AND products.stock_item_id IS NULL
    AND products.category IN ('alitas','burgers');