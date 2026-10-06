-- ================================================================
-- Reconciliar el menú AsisNexo: precios correctos y platos visibles
-- ================================================================
-- Corre después de 010/011. Resuelve en producción:
--   1) Algunas burgers no aparecían en el POS "Nuevo pedido" y los precios
--      (que viven en las variantes Junior/Doble, base 0) se veían como $0.00.
--      Se restaura el menú canónico de data/menu.js y se dejan activos.
--   2) Guarda de esquema (IF NOT EXISTS) por si la migración 010/007 no se
--      aplicó en el servidor: el guardado de productos usa estas columnas.
-- Idempotente: re-ejecutar no duplica ni pisa stock/pedidos.

-- ---------------------------------------------------------------------------
-- 1. Guards de esquema (columnas que usa el guardado de productos)
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS flavors JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sin_pan BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_title TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS upsell BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Categorías AsisNexo
-- ---------------------------------------------------------------------------
INSERT INTO categories (slug, name, icon, sort) VALUES
  ('alitas',  'Alitas',  'fa-drumstick-bite',     1),
  ('burgers', 'Burgers', 'fa-burger',             2),
  ('bebidas', 'Bebidas', 'fa-martini-glass-citrus',3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, icon = EXCLUDED.icon, sort = EXCLUDED.sort, active = true;

-- ---------------------------------------------------------------------------
-- 3. Ítems terminados de los platos (stock propio por producción/compra)
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

-- ---------------------------------------------------------------------------
-- 4. Platos con precios canónicos y siempre visibles
-- ---------------------------------------------------------------------------
INSERT INTO products (id, name, category, price, "desc", img, popular, salsas, variants, removable, flavors, sin_pan, active, sort, variant_title) VALUES
-- ALITAS (sabores multi-selección con límite)
('alitas-chicken-little','Chicken Little','alitas',10.00,'7 piezas bañadas con 2 sabores de tu elección, papas fritas y arepitas.','img/chicken_little.jpeg',true,true,
 '[]'::jsonb,'[]'::jsonb,'{"options":["Broaster","BBQ Honey","Sabor de la Casa","Tártara","Ajo Parmesano"],"max":2}'::jsonb,false,true,1,NULL),
('alitas-duo','Dúo','alitas',19.00,'14 piezas bañadas con 2 sabores de tu elección, papas fritas y arepitas.','img/duo.jpeg',false,true,
 '[]'::jsonb,'[]'::jsonb,'{"options":["Broaster","BBQ Honey","Sabor de la Casa","Tártara","Ajo Parmesano"],"max":2}'::jsonb,false,true,2,NULL),
('alitas-tripack','Tripack','alitas',28.00,'21 piezas bañadas con 3 sabores de tu elección, papas fritas y arepitas.','img/tripack.jpeg',false,true,
 '[]'::jsonb,'[]'::jsonb,'{"options":["Broaster","BBQ Honey","Sabor de la Casa","Tártara","Ajo Parmesano"],"max":3}'::jsonb,false,true,3,NULL),
('alitas-combo','Combo Alitas','alitas',35.00,'28 piezas bañadas con 4 sabores de tu elección, papas fritas y arepitas.','img/combo_alitas.jpeg',false,true,
 '[]'::jsonb,'[]'::jsonb,'{"options":["Broaster","BBQ Honey","Sabor de la Casa","Tártara","Ajo Parmesano"],"max":4}'::jsonb,false,true,4,NULL),
-- BURGERS (precio base 0; el total está en las variantes Junior/Doble)
('burger-americana','Americana','burgers',0,'Carne premium, slice de queso americano, tocineta ahumada, pepinillos en rodajas, cama de lechuga, tomate fresco y cebolla troceada. Incluye papas fritas.','img/americana.jpeg',true,true,
 '[{"label":"Junior","price":11.00},{"label":"Doble","price":13.00}]'::jsonb,'["Tocineta","Tomate","Cebolla","Lechuga","Pepinillos","Salsas","Queso"]'::jsonb,
 NULL,true,true,1,NULL),
('burger-cheese','Cheese','burgers',0,'Carne premium, slice de queso americano, pepinillos en rodajas y cebolla troceada. Incluye papas fritas.','img/cheese.jpeg',false,true,
 '[{"label":"Junior","price":8.00},{"label":"Doble","price":10.00}]'::jsonb,'["Queso","Salsas","Pepinillos","Cebolla"]'::jsonb,
 NULL,true,true,2,NULL),
('burger-cuarto-de-libra','Cuarto de Libra','burgers',0,'Carne premium, slice de queso americano, tocineta ahumada, cama de lechuga, cebolla troceada y pepinillos en rodajas. Incluye papas fritas.','img/cuarto_de_libra.jpeg',false,true,
 '[{"label":"Junior","price":11.00},{"label":"Doble","price":13.00}]'::jsonb,'["Tocineta","Queso","Lechuga","Cebolla","Pepinillos","Salsas"]'::jsonb,
 NULL,true,true,3,NULL),
('burger-smash','Smash','burgers',0,'Carne premium smash, slice de queso americano, tocineta ahumada y cebolla caramelizada. Incluye papas fritas.','img/smash.jpeg',false,true,
 '[{"label":"Junior","price":11.00},{"label":"Doble","price":13.00}]'::jsonb,'["Tocineta","Cebolla Caramelizada","Queso","Salsas"]'::jsonb,
 NULL,true,true,4,NULL),
('burger-especial','Burger Especial','burgers',0,'Carne premium, slice de queso americano y mermelada de tocineta. Incluye papas fritas.','img/burger_especial.jpeg',true,true,
 '[{"label":"Junior","price":11.00},{"label":"Doble","price":13.00}]'::jsonb,'["Salsas"]'::jsonb,
 NULL,true,true,5,NULL),
('burger-crispy','Burger Crispy','burgers',13.00,'Pechuga de pollo crispy, slice de queso americano x2, queso cheddar, tocineta ahumada, cama de lechuga y tomate fresco. Incluye papas fritas.','img/burger_crispy.jpeg',true,true,
 '[]'::jsonb,'["Tocineta","Queso","Cheddar","Lechuga","Tomate","Salsas"]'::jsonb,
 NULL,true,true,6,NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price,
  "desc" = EXCLUDED."desc", img = EXCLUDED.img, popular = EXCLUDED.popular,
  salsas = EXCLUDED.salsas, variants = EXCLUDED.variants, removable = EXCLUDED.removable,
  flavors = EXCLUDED.flavors, sin_pan = EXCLUDED.sin_pan, active = EXCLUDED.active,
  sort = EXCLUDED.sort, variant_title = EXCLUDED.variant_title, updated_at = now();

-- ---------------------------------------------------------------------------
-- 5. Extras (adicionales) globales de alitas y burgers (solo si están vacíos)
-- ---------------------------------------------------------------------------
UPDATE products SET extras = '[
  {"name":"Pepinillos","price":1.00},{"name":"Queso Cheddar","price":1.00},
  {"name":"Carne y Queso","price":2.50},{"name":"Cebolla","price":0.50},
  {"name":"Maíz","price":0.50},{"name":"Cebolla Caramelizada","price":1.50},
  {"name":"Queso Americano","price":1.00},{"name":"Tocineta","price":1.50},
  {"name":"Pollo Crispy y Queso","price":3.00},{"name":"Lechuga","price":0.50},
  {"name":"Tomate","price":0.50}
]'::jsonb
WHERE category IN ('alitas','burgers')
  AND (extras IS NULL OR jsonb_array_length(extras) = 0);

-- ---------------------------------------------------------------------------
-- 6. Vincular cada plato a su stock terminado (por nombre, si falta)
-- ---------------------------------------------------------------------------
UPDATE products SET stock_item_id = i.id
  FROM ingredients i
  WHERE i.kind = 'product' AND i.name = products.name
    AND products.stock_item_id IS NULL
    AND products.category IN ('alitas','burgers');