-- ================================================================
-- Semilla del menú de AsisNexo (Socopó, Barinas)
-- ================================================================
-- Reemplaza la semilla genérica de AsisNexo (migración 006) por el menú real de
-- AsisNexo: alitas, burgers y bebidas (data/menu.js). También agrega los campos
-- del modelo de producto AsisNexo (flavors, sin_pan, variant_title).
--
-- Idempotente (ON CONFLICT / IF NOT EXISTS): re-ejecutar no duplica.
-- Corre después de 006/007; por eso primero limpia los productos y categorías
-- de la semilla anterior.

-- ---------------------------------------------------------------------------
-- 1. Campos del modelo de producto AsisNexo
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS flavors JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sin_pan BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variant_title TEXT;

-- ---------------------------------------------------------------------------
-- 2. Limpiar semilla de AsisNexo (products/categories/recipes)
-- ---------------------------------------------------------------------------
DELETE FROM recipes WHERE product_id IN (SELECT id FROM products);
DELETE FROM production_recipes WHERE product_id IN (SELECT id FROM ingredients WHERE kind = 'product');
DELETE FROM products;
DELETE FROM categories;

-- ---------------------------------------------------------------------------
-- 3. Categorías AsisNexo
-- ---------------------------------------------------------------------------
INSERT INTO categories (slug, name, icon, sort) VALUES
  ('alitas',  'Alitas',  'fa-drumstick-bite',     1),
  ('burgers', 'Burgers', 'fa-burger',             2),
  ('bebidas', 'Bebidas', 'fa-martini-glass-citrus',3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, icon = EXCLUDED.icon, sort = EXCLUDED.sort, active = true;

-- ---------------------------------------------------------------------------
-- 4. Ingredientes "producto terminado" para las bebidas (stock propio)
-- ---------------------------------------------------------------------------
INSERT INTO ingredients (name, unit, kind) VALUES
  ('Agua 600ml','unidad','product'),
  ('Bombita','unidad','product'),
  ('Nestea','unidad','product'),
  ('Refresco 1L','unidad','product'),
  ('Refresco 1.5L','unidad','product'),
  ('Refresco 2L','unidad','product'),
  ('Refresco Lata','unidad','product'),
  ('Yucky Pack','unidad','product')
ON CONFLICT (name) DO NOTHING;

-- 'Nestea' ya existía como ingrediente base de la semilla 006: se convierte en
-- producto terminado para que la bebida del menú enlace su stock.
UPDATE ingredients SET kind = 'product' WHERE name = 'Nestea' AND kind = 'ingredient';

-- Limpia productos terminados de la semilla de AsisNexo (merengadas, frozen, etc.)
-- que ya no pertenecen al menú de AsisNexo. Sus productos en `products` fueron
-- borrados arriba; aquí se quitan de la despensa.
DELETE FROM ingredients WHERE kind = 'product' AND name NOT IN (
  'Agua 600ml','Bombita','Nestea','Refresco 1L','Refresco 1.5L',
  'Refresco 2L','Refresco Lata','Yucky Pack'
);

-- Stock inicial de las bebidas (los pedidos consumen de aquí; se gestiona en
-- el panel /admin → Inventario).
UPDATE ingredients SET stock = 24 WHERE kind = 'product';

-- ---------------------------------------------------------------------------
-- 5. Productos del menú AsisNexo
--    variants/removable/extras/flavors en JSONB. extras se cargan por UPDATE.
--    Bebidas: variant_title = 'Elige tu Bebida' y stock propio (stock_item_id).
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
 NULL,true,true,6,NULL),

-- BEBIDAS (precio base; las variantes son sabores sin recargo)
('bebida-agua','Agua 600ml','bebidas',1.50,'Agua mineral 600 ml.','img/agua_600ml.webp',false,false,
 '[]'::jsonb,'[]'::jsonb,NULL,false,true,1,'Elige tu Bebida'),
('bebida-bombita','Bombita','bebidas',1.50,'Refresco en presentación bombita.','img/bombita.webp',false,false,
 '[{"label":"Coca-Cola","price":0},{"label":"Frescolita","price":0}]'::jsonb,'[]'::jsonb,
 NULL,false,true,2,'Elige tu Bebida'),
('bebida-nestea','Nestea','bebidas',2.00,'Nestea 500 ml. Próximamente para llevar.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,NULL,false,true,3,'Elige tu Bebida'),
('bebida-refresco-1l','Refresco 1L','bebidas',2.50,'Refresco familiar de 1 litro.','img/refresco_de_1l.webp',false,false,
 '[{"label":"Coca-Cola","price":0},{"label":"Frescolita","price":0},{"label":"Chinotto","price":0}]'::jsonb,'[]'::jsonb,
 NULL,false,true,4,'Elige tu Bebida'),
('bebida-refresco-1-5l','Refresco 1.5L','bebidas',3.00,'Refresco familiar de 1.5 litros.','img/refresco_de_1_5l.webp',false,false,
 '[{"label":"Coca-Cola","price":0},{"label":"Chinotto","price":0},{"label":"Naranja","price":0},{"label":"Uva","price":0}]'::jsonb,'[]'::jsonb,
 NULL,false,true,5,'Elige tu Bebida'),
('bebida-refresco-2l','Refresco 2L','bebidas',3.50,'Refresco familiar de 2 litros.','img/refresco_de_2l.jpeg',false,false,
 '[{"label":"Coca-Cola","price":0},{"label":"Uva","price":0},{"label":"Chinotto","price":0}]'::jsonb,'[]'::jsonb,
 NULL,false,true,6,'Elige tu Bebida'),
('bebida-refresco-lata','Refresco Lata','bebidas',2.00,'Refresco en lata 355 ml.','img/refresco_lata.png',false,false,
 '[{"label":"Coca-Cola","price":0},{"label":"Frescolita","price":0},{"label":"Chinotto","price":0}]'::jsonb,'[]'::jsonb,
 NULL,false,true,7,'Elige tu Bebida'),
('bebida-yucky-pack','Yucky Pack','bebidas',2.00,'Jugo en presentación individual.','img/yucky_pack.webp',false,false,
 '[{"label":"Manzana","price":0},{"label":"Pera","price":0}]'::jsonb,'[]'::jsonb,
 NULL,false,true,8,'Elige tu Bebida')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price,
  "desc" = EXCLUDED."desc", img = EXCLUDED.img, popular = EXCLUDED.popular,
  salsas = EXCLUDED.salsas, variants = EXCLUDED.variants, removable = EXCLUDED.removable,
  flavors = EXCLUDED.flavors, sin_pan = EXCLUDED.sin_pan, active = EXCLUDED.active,
  sort = EXCLUDED.sort, variant_title = EXCLUDED.variant_title, updated_at = now();

-- Extras (adicionales) globales para alitas y burgers
UPDATE products SET extras = '[
  {"name":"Pepinillos","price":1.00},{"name":"Queso Cheddar","price":1.00},
  {"name":"Carne y Queso","price":2.50},{"name":"Cebolla","price":0.50},
  {"name":"Maíz","price":0.50},{"name":"Cebolla Caramelizada","price":1.50},
  {"name":"Queso Americano","price":1.00},{"name":"Tocineta","price":1.50},
  {"name":"Pollo Crispy y Queso","price":3.00},{"name":"Lechuga","price":0.50},
  {"name":"Tomate","price":0.50}
]'::jsonb WHERE category IN ('alitas','burgers');

-- Bebidas: vincular cada producto del menú a su stock terminado (kind='product')
-- y marcarlas para el pop-up de upsell de la web.
UPDATE products SET stock_item_id = i.id, upsell = true
  FROM ingredients i
  WHERE i.kind = 'product' AND i.name = products.name AND products.category = 'bebidas';