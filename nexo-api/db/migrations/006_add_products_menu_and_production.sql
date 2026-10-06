-- Inventario + Menú unificados: productos terminados (kind), productos del menú
-- con imágenes, categorías, recetas de TODOS los platos y lotes de producción.
--
-- Un solo archivo, idempotente (ON CONFLICT / IF NOT EXISTS): re-ejecutar no
-- duplica. No modifica db/schema.sql. Reemplaza la mecánica de auto-receta de la
-- migración 005: las bebidas pasan a kind='product' con stock_item_id.

-- ---------------------------------------------------------------------------
-- 1. Esquema
-- ---------------------------------------------------------------------------

-- kind: 'ingredient' (materia prima) | 'product' (producto terminado con stock)
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ingredient'
  CHECK (kind IN ('ingredient','product'));
CREATE INDEX IF NOT EXISTS idx_ingredients_kind ON ingredients(kind);

-- Categorías del menú
CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'fa-box',
  sort INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

-- Productos del menú (fuente de verdad; reemplaza data/menu.js en runtime)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories(slug) ON DELETE RESTRICT,
  price NUMERIC(10,2),
  "desc" TEXT NOT NULL DEFAULT '',
  img TEXT NOT NULL DEFAULT 'img/placeholder.svg',
  popular BOOLEAN NOT NULL DEFAULT false,
  salsas BOOLEAN NOT NULL DEFAULT true,
  variants JSONB NOT NULL DEFAULT '[]',
  removable JSONB NOT NULL DEFAULT '[]',
  extras JSONB NOT NULL DEFAULT '[]',
  sin_no JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT true,
  sort INTEGER NOT NULL DEFAULT 0,
  -- Producto terminado con stock propio (bebidas, empacados): apunta al stock.
  stock_item_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category_active ON products(category, active);
CREATE INDEX IF NOT EXISTS idx_products_active_sort ON products(active, sort);

-- Lotes de producción: X unidades de un producto terminado (ingredient kind='product')
CREATE TABLE IF NOT EXISTS production_batches (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty NUMERIC(10,2) NOT NULL CHECK (qty > 0),
  note TEXT,
  produced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Detalle del lote: ingredientes consumidos
CREATE TABLE IF NOT EXISTS production_batch_items (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty NUMERIC(10,2) NOT NULL CHECK (qty > 0),
  UNIQUE (batch_id, ingredient_id)
);

-- Receta de fabricación guardada por producto terminado (BOM para producir lotes)
CREATE TABLE IF NOT EXISTS production_recipes (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  UNIQUE (product_id, ingredient_id)
);

-- ---------------------------------------------------------------------------
-- 2. Categorías
-- ---------------------------------------------------------------------------
INSERT INTO categories (slug, name, icon, sort) VALUES
  ('hamburguesas',   'Hamburguesas',     'fa-burger',    1),
  ('parrillas',      'Parrillas',        'fa-fire',      2),
  ('perros_costillas','Perros y Costillas','fa-hotdog',  3),
  ('especiales',     'Especiales',       'fa-bowl-food', 4),
  ('ensaladas_keto', 'Ensaladas y Keto', 'fa-leaf',      5),
  ('marisqueria',    'Marisquería',      'fa-shrimp',    6),
  ('bebidas',        'Bebidas',          'fa-mug-saucer',7)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, icon = EXCLUDED.icon, sort = EXCLUDED.sort, active = true;

-- ---------------------------------------------------------------------------
-- 3. Catálogo de ingredientes (despensa). Todos en 'unidad'. Idempotente.
-- ---------------------------------------------------------------------------
INSERT INTO ingredients (name, unit, always_available) VALUES
  -- Base
  ('Pan','unidad',false), ('Pan de Perro','unidad',false),
  ('Carne','unidad',false), ('Pollo','unidad',false), ('Lomito','unidad',false),
  ('Chuleta','unidad',false), ('Chorizo','unidad',false), ('Croqueta','unidad',false),
  ('Tocineta','unidad',false), ('Salchicha','unidad',false), ('Salchicha Jumbo','unidad',false),
  -- Quesos
  ('Cheddar','unidad',false), ('Mozzarella','unidad',false), ('Queso Amarillo','unidad',false),
  ('Queso de Mano','unidad',false), ('Parmesano','unidad',false), ('Queso Americano','unidad',false),
  ('Queso','unidad',false),
  -- Guarniciones y vegetales
  ('Huevo','unidad',false), ('Tajadas','unidad',false), ('Maíz','unidad',false),
  ('Aguacate','unidad',false), ('Lechuga','unidad',false), ('Tomate','unidad',false),
  ('Cebolla','unidad',false), ('Papas','unidad',false), ('Papas de Perro','unidad',false),
  ('Plátano Maduro','unidad',false), ('Ensalada','unidad',false), ('Arroz','unidad',false),
  ('Ajo','unidad',false),
  -- Proteínas del mar
  ('Camarón','unidad',false), ('Mariscos','unidad',false),
  -- Especiales
  ('Costillas','unidad',false), ('Pasta','unidad',false),
  -- Salsas / aderezos (no bloquean ni descuentan)
  ('Salsa de Tomate','unidad',true), ('Mostaza','unidad',true), ('Mayonesa','unidad',true),
  ('Salsa de la Casa','unidad',true), ('Salsa Tártara','unidad',true), ('Salsa BBQ','unidad',true),
  ('Aderezo César','unidad',true),
  -- Para recetas de producción (bebidas hechas en casa)
  ('Leche','unidad',false), ('Fresa','unidad',false), ('Azúcar','unidad',false),
  ('Hielo','unidad',false), ('Limón','unidad',false), ('Agua','unidad',false),
  ('Nestea','unidad',false)
ON CONFLICT (name) DO NOTHING;

-- Bebidas ya creadas por la migración 005 -> productos terminados
UPDATE ingredients SET kind = 'product' WHERE name IN (
  'Merengada de Fresa','Merengada de Oreo','Merengada Samba','Merengada de Cocosette',
  'Merengada de Parchita','Merengada Toronto','Merengada Flip','Merengada de Nutella',
  'Frozen de Fresa','Frozen de Melocotón','Frozen de Lechosa','Frozen de Melón',
  'Frozen de Parchita','Limonada','Jarra Nestea','Vaso Nestea','Vaso Nestea Grande',
  'Coca-Cola','Coca-Cola Zero','Coca-Cola 350ml','Coca Cola 1.5L','Coca Cola 2L'
);

-- ---------------------------------------------------------------------------
-- 4. Productos del menú (sembrados desde data/menu.js)
--    variants / removable / sin_no en JSONB. extras se cargan por UPDATE.
-- ---------------------------------------------------------------------------
INSERT INTO products (id, name, category, price, "desc", img, popular, salsas, variants, removable, sin_no, active, sort) VALUES
-- HAMBURGUESAS
('h1','Groserita','hamburguesas',9.50,'Croqueta gratinada con queso mozzarella.','img/groserita.jpg',true,true,
 '[{"label":"Carne","price":0},{"label":"Pollo","price":1}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,1),
('h2','Criollita','hamburguesas',11.00,'Tajadas, cheddar, huevo y mozzarella.','img/criollita.jpg',false,true,
 '[{"label":"Carne","price":0},{"label":"Pollo","price":1}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,2),
('h3','Llanerita','hamburguesas',11.00,'Aguacate, queso de mano y tocineta.','img/llanerita.jpg',false,true,
 '[{"label":"Carne","price":0},{"label":"Pollo","price":1}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,3),
('h4','Mixta','hamburguesas',12.50,'Carne, pollo, tocineta, gratinado con mozzarella y maíz.','img/mixta.jpg',false,true,
 '[]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,4),
('h5','Mixta Especial','hamburguesas',13.50,'Chuleta, pollo gratinado con mozzarella y maíz.','img/mixtapolloychuleta.jpeg',false,true,
 '[]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,5),
('h6','Tociqueso','hamburguesas',12.00,'Proteína con baño de cheddar fundido y tocineta.','img/tociqueso.jpeg',false,true,
 '[{"label":"Carne","price":0},{"label":"Pollo","price":1},{"label":"Lomito","price":2}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,6),
('h7','Americana','hamburguesas',11.00,'Tocineta y queso amarillo.','img/americana.jpg',false,true,
 '[{"label":"Carne","price":0},{"label":"Pollo","price":1}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,7),
('h8','Grosera Junior','hamburguesas',13.00,'Chorizo, maíz, tocineta y queso amarillo. Peso: 600 g.','img/groserajunio.jpg',false,true,
 '[{"label":"Carne","price":0},{"label":"Pollo","price":1}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,8),
('h9','Grosera Mayor Mixta','hamburguesas',16.00,'Doble proteína, chorizo, maíz, tocineta, queso amarillo y mozzarella. Peso: 800 g.','img/groseramayor.jpg',false,true,
 '[{"label":"Normal (Doble Proteína)","price":0},{"label":"Mixta","price":2}]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,9),
('h10','Granjera Grosera','hamburguesas',20.00,'Croqueta, pollo, chuleta, chorizo, tocineta, maíz, huevo, queso mozzarella y americano. Peso: 800 g.','img/granjeragrosera.jpg',false,true,
 '[]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,10),
('h11','La Monstruosa','hamburguesas',28.00,'3 croquetas gratinadas con mozzarella, maíz, pollo gratinado con queso amarillo, tocineta y chorizo. Peso: 1 kg.','img/mostrosa.jpg',true,true,
 '[]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,11),
('h12','Mixta Keto','hamburguesas',12.50,'Hamburguesa sin pan, con lechuga, pollo, chorizo, tocineta, maíz y queso mozzarella.','img/mixtaketo.jpg',false,true,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,12),
-- PARRILLAS
('p1','Parrilla Pequeña','parrillas',15.00,'250 g de lomito, chorizo, queso y maíz. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,1),
('p2','Parrilla Mediana','parrillas',20.00,'500 g de lomito, chorizo, queso y maíz. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/placeholder.svg',true,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,2),
('p3','Parrilla Mixta','parrillas',25.00,'500 g de lomito, chorizo, 200 g de pollo, queso y maíz. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,3),
('p4','Parrilla Familiar','parrillas',36.00,'1 kilo de lomito, chorizo x2, maíz, 200 g de pollo y queso. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,4),
('p5','Parrilla con Camarones Pequeña','parrillas',22.00,'250 g de lomito, chorizo, queso y maíz + 200 g de camarón. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/parrillacamaronpeq.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,5),
('p6','Parrilla con Camarones Mediana','parrillas',27.00,'500 g de lomito, chorizo, queso y maíz + 200 g de camarón. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/parrillacamaron.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,6),
('p7','Parrilla con Camarones Mixta','parrillas',31.00,'500 g de lomito, chorizo, 200 g de pollo, queso y maíz + 200 g de camarón. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/parillamixtacamaron.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,7),
('p8','Parrilla con Camarones Familiar','parrillas',43.00,'1 kilo de lomito, chorizo x2, maíz, 200 g de pollo y queso + 200 g de camarón. Incluye papas, ensalada mixta con aguacate o a la parmesana y salsa tártara.','img/parrillacamaron.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,8),
-- PERROS Y COSTILLAS
('pc1','Morochos Normales','perros_costillas',11.50,'2 perros calientes con salchichas jumbo, cebolla en mini cuadritos, papas de perro y queso parmesano.','img/morochosnorm.jpg',false,true,
 '[]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,1),
('pc2','Morochos Groseros','perros_costillas',18.50,'2 perros calientes con salchichas jumbo, lomito, chorizo, cebollas en mini cuadritos, maíz, cheddar fundido y papas de perro. Acompañados de papas a la francesa.','img/perrocaliente.jpg',true,true,
 '[]'::jsonb,'["Pan"]'::jsonb,'[]'::jsonb,true,2),
('pc3','Costillas BBQ (1/2)','perros_costillas',14.00,'Costillas BBQ para 1 persona. Acompañadas de papas fritas y ensalada a la parmesana o mixta.','img/costillabqq.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'["Parmesano"]'::jsonb,true,3),
('pc4','Costillas BBQ (1)','perros_costillas',25.00,'Costillas BBQ para 3 personas. Acompañadas de papas fritas y ensalada a la parmesana o mixta.','img/costillabqq.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'["Parmesano"]'::jsonb,true,4),
-- ESPECIALES
('e1','Salchipapas','especiales',11.00,'Salchichas con papas fritas.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,1),
('e2','Salchipapas con Tocineta','especiales',11.00,'Salchichas con papas fritas y tocineta.','img/salchipapatoci.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,2),
('e3','Salchipapas con Camarón','especiales',11.00,'Salchichas con papas fritas , adicional de camarón.','img/salchipapacamaron.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,3),
('e4','Choripapas','especiales',12.50,'Chorizo con papas fritas.','img/choripapa.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,4),
('e5','Pollipapas','especiales',12.50,'Pollo con papas fritas.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,5),
('e6','Pollo 3 Quesos','especiales',14.00,'Pollo gratinado con 3 quesos.','img/pollo3quesos.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,6),
('e7','Patacón Maduro','especiales',11.00,'Patacón de plátano maduro.','img/maduro.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,7),
('e8','Servicio Papas','especiales',4.00,'Servicio de papas fritas.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,8),
-- ENSALADAS Y KETO
('ek1','Ensalada Parmesana','ensaladas_keto',5.00,'Ensalada fresca con queso parmesano.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'["Ensalada"]'::jsonb,true,1),
('ek2','Ensalada Mixta','ensaladas_keto',5.00,'Ensalada mixta fresca.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'["Ensalada"]'::jsonb,true,2),
('ek3','Ensalada Cesar con Pollo','ensaladas_keto',12.00,'Lechuga, pollo, aderezo césar y parmesano.','img/cesarpollo.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,3),
('ek4','Ensalada Cesar con Camarones','ensaladas_keto',16.00,'Lechuga, camarones, aderezo césar y parmesano.','img/cesarcamaron.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,4),
('ek5','Ensalada Cesar con Pollo y Camarones','ensaladas_keto',19.00,'Lechuga, pollo, camarones, aderezo césar y parmesano.','img/cesarpollocamaron.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,5),
('ek6','Pollo Gratinado','ensaladas_keto',14.00,'Pollo gratinado. Incluye ensalada, queso, aguacate, tocineta y huevo.','img/polloketo.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,6),
('ek7','Lomito Gratinado','ensaladas_keto',16.00,'Lomito gratinado. Incluye ensalada, queso, aguacate, tocineta y huevo.','img/ketolomito.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,7),
('ek8','Camarones Gratinados','ensaladas_keto',17.00,'Camarones gratinados. Incluye ensalada, queso, aguacate, tocineta y huevo.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,8),
-- MARISQUERÍA
('m1','Parrilla Mar y Tierra (Pequeña)','marisqueria',62.00,'Lomito y mariscos a la parrilla.','img/marytierra.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,1),
('m2','Parrilla Mar y Tierra (Grande)','marisqueria',73.00,'Lomito y mariscos a la parrilla.','img/marytierra.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,2),
('m3','Frutos del Mar (Pequeña)','marisqueria',29.00,'Selección de frutos del mar.','img/frutosdelmar.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,3),
('m4','Frutos del Mar (Grande)','marisqueria',40.00,'Selección de frutos del mar.','img/frutosdelmar.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,4),
('m5','Zarzuela','marisqueria',30.00,'Zarzuela de mariscos.','img/zarzuela.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,5),
('m6','Paella','marisqueria',40.00,'Paella de mariscos.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,6),
('m7','Pollo con Mariscos','marisqueria',36.00,'Pollo acompañado de mariscos.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,7),
('m8','Pollo con Camarones','marisqueria',22.00,'Pollo acompañado de camarones.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,8),
('m9','Pasta con Mariscos','marisqueria',31.00,'Pasta con mariscos en salsa roja o salsa blanca.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,9),
('m10','Pasta con Camarones','marisqueria',19.00,'Pasta con camarones en salsa roja o salsa blanca.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,10),
('m11','Pasta de la Casa','marisqueria',24.00,'Camarones, tocineta, pollo, maíz y queso parmesano en salsa blanca.','img/placeholder.svg',true,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,11),
('m12','Camarones al Ajillo','marisqueria',16.00,'Camarones al ajillo. Acompañados de papas o pan al ajillo y salsa tártara.','img/camaronesajillo.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,12),
('m13','Camarones en Salsa de Queso','marisqueria',19.00,'Camarones en salsa de queso. Acompañados de papas o pan al ajillo y salsa tártara.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,13),
('m14','Camarones Rebosados','marisqueria',NULL,'Camarones rebosados. Acompañados de papas o pan al ajillo y salsa tártara.','img/camaronesreb.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,14),
('m15','Camarones Bechamel y Tocino','marisqueria',19.00,'Camarones en bechamel con tocino. Acompañados de papas o pan al ajillo y salsa tártara.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,15),
('m16','Copa de Camarones','marisqueria',19.00,'Copa de camarones. Acompañados de papas o pan al ajillo y salsa tártara, ensalada cesar.','img/copacamaron.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,16),
-- BEBIDAS (productos terminados; stock_item_id se asigna después)
('b1','Merengada de Fresa','bebidas',5.00,'Merengada artesanal de fresa.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,1),
('b2','Merengada de Oreo','bebidas',5.00,'Merengada artesanal con galleta Oreo.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,2),
('b3','Merengada Samba','bebidas',5.00,'Merengada artesanal sabor a Samba.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,3),
('b4','Merengada de Cocosette','bebidas',5.00,'Merengada artesanal con Cocosette.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,4),
('b5','Merengada de Parchita','bebidas',5.00,'Merengada artesanal de parchita.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,5),
('b6','Merengada Toronto','bebidas',6.00,'Merengada artesanal sabor Toronto.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,6),
('b7','Merengada Flip','bebidas',6.00,'Merengada artesanal sabor Flip.','img/merengadafliz.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,7),
('b8','Merengada de Nutella','bebidas',6.00,'Merengada artesanal con Nutella.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,8),
('b9','Frozen de Fresa','bebidas',5.00,'Jugo tipo frozen de fresa.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,9),
('b10','Frozen de Melocotón','bebidas',5.00,'Jugo tipo frozen de melocotón.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,10),
('b11','Frozen de Lechosa','bebidas',5.00,'Jugo tipo frozen de lechosa.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,11),
('b12','Frozen de Melón','bebidas',5.00,'Jugo tipo frozen de melón.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,12),
('b13','Frozen de Parchita','bebidas',5.00,'Jugo tipo frozen de parchita.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,13),
('b14','Limonada','bebidas',5.00,'Limonada tipo frozen bien fría.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,14),
('b15','Jarra Nestea','bebidas',5.00,'Jarra de Nestea fresca.','img/jarranestea.jpeg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,15),
('b16','Vaso Nestea','bebidas',1.00,'Vaso de Nestea Pequeño.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,16),
('b17','Vaso Nestea Grande','bebidas',2.00,'Vaso de Nestea Grande.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,17),
('b18','Coca-Cola','bebidas',2.00,'Refresco de Coca-Cola Lata.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,18),
('b19','Coca-Cola Zero','bebidas',2.00,'Refresco de Coca-Cola Zero Lata.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,19),
('b20','Coca-Cola 350ml','bebidas',2.00,'Refresco de Coca-Cola 350ml.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,20),
('b22','Coca Cola 1.5L','bebidas',3.00,'Refresco de Coca-Cola 1.5L.','img/placeholder.svg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,21),
('b21','Coca Cola 2L','bebidas',4.00,'Refresco de Coca-Cola 2L.','img/cocacola1.5.jpg',false,false,
 '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,22)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, category = EXCLUDED.category, price = EXCLUDED.price,
  "desc" = EXCLUDED."desc", img = EXCLUDED.img, popular = EXCLUDED.popular,
  salsas = EXCLUDED.salsas, variants = EXCLUDED.variants, removable = EXCLUDED.removable,
  sin_no = EXCLUDED.sin_no, active = EXCLUDED.active, sort = EXCLUDED.sort,
  updated_at = now();

-- Extras (adicionales) para todas las hamburguesas (antes globales en menu.js)
UPDATE products SET extras = '[
  {"name":"Chorizo","price":2},{"name":"Tocineta","price":2},{"name":"Cheddar","price":2},
  {"name":"Queso Amarillo","price":1.5},{"name":"Mozzarella","price":1.5},{"name":"Huevo","price":1},
  {"name":"Tajadas","price":1},{"name":"Aguacate","price":1},{"name":"Pollo","price":2.5},
  {"name":"Lomito","price":3},{"name":"Parmesano","price":2},{"name":"Croqueta","price":3},
  {"name":"Chuleta","price":3.5},{"name":"Tartara","price":1}
]'::jsonb WHERE category = 'hamburguesas';

-- Bebidas: vincular cada producto del menú a su stock terminado (kind='product')
UPDATE products SET stock_item_id = i.id
  FROM ingredients i
  WHERE i.kind = 'product' AND i.name = products.name AND products.id LIKE 'b%';

-- ---------------------------------------------------------------------------
-- 5. Recetas de TODOS los platos (base = variant NULL, variantes por proteína)
--    Cantidades en raciones (1 por ingrediente). Idempotente por índice único.
-- ---------------------------------------------------------------------------
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT v.product_id, v.product_name, v.variant, i.id, v.qty
FROM (VALUES
  -- HAMBURGUESAS (base: pan + ensalada base + desc; variantes: proteína)
  ('h1','Groserita',NULL,'Pan',1),('h1','Groserita',NULL,'Croqueta',1),('h1','Groserita',NULL,'Mozzarella',1),
  ('h1','Groserita',NULL,'Lechuga',1),('h1','Groserita',NULL,'Tomate',1),('h1','Groserita',NULL,'Cebolla',1),
  ('h1','Groserita','Carne','Carne',1),('h1','Groserita','Pollo','Pollo',1),
  ('h2','Criollita',NULL,'Pan',1),('h2','Criollita',NULL,'Tajadas',1),('h2','Criollita',NULL,'Cheddar',1),
  ('h2','Criollita',NULL,'Huevo',1),('h2','Criollita',NULL,'Mozzarella',1),
  ('h2','Criollita',NULL,'Lechuga',1),('h2','Criollita',NULL,'Tomate',1),('h2','Criollita',NULL,'Cebolla',1),
  ('h2','Criollita','Carne','Carne',1),('h2','Criollita','Pollo','Pollo',1),
  ('h3','Llanerita',NULL,'Pan',1),('h3','Llanerita',NULL,'Aguacate',1),('h3','Llanerita',NULL,'Queso de Mano',1),
  ('h3','Llanerita',NULL,'Tocineta',1),('h3','Llanerita',NULL,'Lechuga',1),('h3','Llanerita',NULL,'Tomate',1),
  ('h3','Llanerita',NULL,'Cebolla',1),
  ('h3','Llanerita','Carne','Carne',1),('h3','Llanerita','Pollo','Pollo',1),
  ('h4','Mixta',NULL,'Pan',1),('h4','Mixta',NULL,'Carne',1),('h4','Mixta',NULL,'Pollo',1),
  ('h4','Mixta',NULL,'Tocineta',1),('h4','Mixta',NULL,'Mozzarella',1),('h4','Mixta',NULL,'Maíz',1),
  ('h4','Mixta',NULL,'Lechuga',1),('h4','Mixta',NULL,'Tomate',1),('h4','Mixta',NULL,'Cebolla',1),
  ('h5','Mixta Especial',NULL,'Pan',1),('h5','Mixta Especial',NULL,'Chuleta',1),('h5','Mixta Especial',NULL,'Pollo',1),
  ('h5','Mixta Especial',NULL,'Mozzarella',1),('h5','Mixta Especial',NULL,'Maíz',1),
  ('h5','Mixta Especial',NULL,'Lechuga',1),('h5','Mixta Especial',NULL,'Tomate',1),('h5','Mixta Especial',NULL,'Cebolla',1),
  ('h6','Tociqueso',NULL,'Pan',1),('h6','Tociqueso',NULL,'Cheddar',1),('h6','Tociqueso',NULL,'Tocineta',1),
  ('h6','Tociqueso',NULL,'Lechuga',1),('h6','Tociqueso',NULL,'Tomate',1),('h6','Tociqueso',NULL,'Cebolla',1),
  ('h6','Tociqueso','Carne','Carne',1),('h6','Tociqueso','Pollo','Pollo',1),('h6','Tociqueso','Lomito','Lomito',1),
  ('h7','Americana',NULL,'Pan',1),('h7','Americana',NULL,'Tocineta',1),('h7','Americana',NULL,'Queso Amarillo',1),
  ('h7','Americana',NULL,'Lechuga',1),('h7','Americana',NULL,'Tomate',1),('h7','Americana',NULL,'Cebolla',1),
  ('h7','Americana','Carne','Carne',1),('h7','Americana','Pollo','Pollo',1),
  ('h8','Grosera Junior',NULL,'Pan',1),('h8','Grosera Junior',NULL,'Chorizo',1),('h8','Grosera Junior',NULL,'Maíz',1),
  ('h8','Grosera Junior',NULL,'Tocineta',1),('h8','Grosera Junior',NULL,'Queso Amarillo',1),
  ('h8','Grosera Junior',NULL,'Lechuga',1),('h8','Grosera Junior',NULL,'Tomate',1),('h8','Grosera Junior',NULL,'Cebolla',1),
  ('h8','Grosera Junior','Carne','Carne',1),('h8','Grosera Junior','Pollo','Pollo',1),
  ('h9','Grosera Mayor Mixta',NULL,'Pan',1),('h9','Grosera Mayor Mixta',NULL,'Chorizo',1),('h9','Grosera Mayor Mixta',NULL,'Maíz',1),
  ('h9','Grosera Mayor Mixta',NULL,'Tocineta',1),('h9','Grosera Mayor Mixta',NULL,'Queso Amarillo',1),
  ('h9','Grosera Mayor Mixta',NULL,'Mozzarella',1),
  ('h9','Grosera Mayor Mixta',NULL,'Lechuga',1),('h9','Grosera Mayor Mixta',NULL,'Tomate',1),('h9','Grosera Mayor Mixta',NULL,'Cebolla',1),
  ('h9','Grosera Mayor Mixta','Normal (Doble Proteína)','Carne',1),('h9','Grosera Mayor Mixta','Normal (Doble Proteína)','Pollo',1),
  ('h9','Grosera Mayor Mixta','Mixta','Carne',1),('h9','Grosera Mayor Mixta','Mixta','Pollo',1),
  ('h10','Granjera Grosera',NULL,'Pan',1),('h10','Granjera Grosera',NULL,'Croqueta',1),('h10','Granjera Grosera',NULL,'Pollo',1),
  ('h10','Granjera Grosera',NULL,'Chuleta',1),('h10','Granjera Grosera',NULL,'Chorizo',1),('h10','Granjera Grosera',NULL,'Tocineta',1),
  ('h10','Granjera Grosera',NULL,'Maíz',1),('h10','Granjera Grosera',NULL,'Huevo',1),('h10','Granjera Grosera',NULL,'Mozzarella',1),
  ('h10','Granjera Grosera',NULL,'Queso Americano',1),
  ('h10','Granjera Grosera',NULL,'Lechuga',1),('h10','Granjera Grosera',NULL,'Tomate',1),('h10','Granjera Grosera',NULL,'Cebolla',1),
  ('h11','La Monstruosa',NULL,'Pan',1),('h11','La Monstruosa',NULL,'Croqueta',1),('h11','La Monstruosa',NULL,'Mozzarella',1),
  ('h11','La Monstruosa',NULL,'Maíz',1),('h11','La Monstruosa',NULL,'Pollo',1),('h11','La Monstruosa',NULL,'Queso Amarillo',1),
  ('h11','La Monstruosa',NULL,'Tocineta',1),('h11','La Monstruosa',NULL,'Chorizo',1),
  ('h11','La Monstruosa',NULL,'Lechuga',1),('h11','La Monstruosa',NULL,'Tomate',1),('h11','La Monstruosa',NULL,'Cebolla',1),
  ('h12','Mixta Keto',NULL,'Lechuga',1),('h12','Mixta Keto',NULL,'Pollo',1),('h12','Mixta Keto',NULL,'Chorizo',1),
  ('h12','Mixta Keto',NULL,'Tocineta',1),('h12','Mixta Keto',NULL,'Maíz',1),('h12','Mixta Keto',NULL,'Mozzarella',1),
  -- PARRILLAS (base completa; sin variantes)
  ('p1','Parrilla Pequeña',NULL,'Lomito',1),('p1','Parrilla Pequeña',NULL,'Chorizo',1),('p1','Parrilla Pequeña',NULL,'Queso',1),
  ('p1','Parrilla Pequeña',NULL,'Maíz',1),('p1','Parrilla Pequeña',NULL,'Papas',1),('p1','Parrilla Pequeña',NULL,'Ensalada',1),
  ('p2','Parrilla Mediana',NULL,'Lomito',1),('p2','Parrilla Mediana',NULL,'Chorizo',1),('p2','Parrilla Mediana',NULL,'Queso',1),
  ('p2','Parrilla Mediana',NULL,'Maíz',1),('p2','Parrilla Mediana',NULL,'Papas',1),('p2','Parrilla Mediana',NULL,'Ensalada',1),
  ('p3','Parrilla Mixta',NULL,'Lomito',1),('p3','Parrilla Mixta',NULL,'Chorizo',1),('p3','Parrilla Mixta',NULL,'Pollo',1),
  ('p3','Parrilla Mixta',NULL,'Queso',1),('p3','Parrilla Mixta',NULL,'Maíz',1),('p3','Parrilla Mixta',NULL,'Papas',1),
  ('p3','Parrilla Mixta',NULL,'Ensalada',1),
  ('p4','Parrilla Familiar',NULL,'Lomito',1),('p4','Parrilla Familiar',NULL,'Chorizo',1),('p4','Parrilla Familiar',NULL,'Pollo',1),
  ('p4','Parrilla Familiar',NULL,'Queso',1),('p4','Parrilla Familiar',NULL,'Maíz',1),('p4','Parrilla Familiar',NULL,'Papas',1),
  ('p4','Parrilla Familiar',NULL,'Ensalada',1),
  ('p5','Parrilla con Camarones Pequeña',NULL,'Lomito',1),('p5','Parrilla con Camarones Pequeña',NULL,'Chorizo',1),
  ('p5','Parrilla con Camarones Pequeña',NULL,'Camarón',1),('p5','Parrilla con Camarones Pequeña',NULL,'Queso',1),
  ('p5','Parrilla con Camarones Pequeña',NULL,'Maíz',1),('p5','Parrilla con Camarones Pequeña',NULL,'Papas',1),
  ('p5','Parrilla con Camarones Pequeña',NULL,'Ensalada',1),
  ('p6','Parrilla con Camarones Mediana',NULL,'Lomito',1),('p6','Parrilla con Camarones Mediana',NULL,'Chorizo',1),
  ('p6','Parrilla con Camarones Mediana',NULL,'Camarón',1),('p6','Parrilla con Camarones Mediana',NULL,'Queso',1),
  ('p6','Parrilla con Camarones Mediana',NULL,'Maíz',1),('p6','Parrilla con Camarones Mediana',NULL,'Papas',1),
  ('p6','Parrilla con Camarones Mediana',NULL,'Ensalada',1),
  ('p7','Parrilla con Camarones Mixta',NULL,'Lomito',1),('p7','Parrilla con Camarones Mixta',NULL,'Chorizo',1),
  ('p7','Parrilla con Camarones Mixta',NULL,'Pollo',1),('p7','Parrilla con Camarones Mixta',NULL,'Camarón',1),
  ('p7','Parrilla con Camarones Mixta',NULL,'Queso',1),('p7','Parrilla con Camarones Mixta',NULL,'Maíz',1),
  ('p7','Parrilla con Camarones Mixta',NULL,'Papas',1),('p7','Parrilla con Camarones Mixta',NULL,'Ensalada',1),
  ('p8','Parrilla con Camarones Familiar',NULL,'Lomito',1),('p8','Parrilla con Camarones Familiar',NULL,'Chorizo',1),
  ('p8','Parrilla con Camarones Familiar',NULL,'Pollo',1),('p8','Parrilla con Camarones Familiar',NULL,'Camarón',1),
  ('p8','Parrilla con Camarones Familiar',NULL,'Queso',1),('p8','Parrilla con Camarones Familiar',NULL,'Maíz',1),
  ('p8','Parrilla con Camarones Familiar',NULL,'Papas',1),('p8','Parrilla con Camarones Familiar',NULL,'Ensalada',1),
  -- PERROS Y COSTILLAS
  ('pc1','Morochos Normales',NULL,'Pan de Perro',1),('pc1','Morochos Normales',NULL,'Salchicha Jumbo',1),
  ('pc1','Morochos Normales',NULL,'Cebolla',1),('pc1','Morochos Normales',NULL,'Papas de Perro',1),
  ('pc1','Morochos Normales',NULL,'Parmesano',1),
  ('pc2','Morochos Groseros',NULL,'Pan de Perro',1),('pc2','Morochos Groseros',NULL,'Salchicha Jumbo',1),
  ('pc2','Morochos Groseros',NULL,'Lomito',1),('pc2','Morochos Groseros',NULL,'Chorizo',1),
  ('pc2','Morochos Groseros',NULL,'Cebolla',1),('pc2','Morochos Groseros',NULL,'Maíz',1),
  ('pc2','Morochos Groseros',NULL,'Cheddar',1),('pc2','Morochos Groseros',NULL,'Papas de Perro',1),
  ('pc2','Morochos Groseros',NULL,'Papas',1),
  ('pc3','Costillas BBQ (1/2)',NULL,'Costillas',1),('pc3','Costillas BBQ (1/2)',NULL,'Papas',1),
  ('pc3','Costillas BBQ (1/2)',NULL,'Ensalada',1),
  ('pc4','Costillas BBQ (1)',NULL,'Costillas',1),('pc4','Costillas BBQ (1)',NULL,'Papas',1),
  ('pc4','Costillas BBQ (1)',NULL,'Ensalada',1),
  -- ESPECIALES
  ('e1','Salchipapas',NULL,'Salchicha',1),('e1','Salchipapas',NULL,'Papas',1),
  ('e2','Salchipapas con Tocineta',NULL,'Salchicha',1),('e2','Salchipapas con Tocineta',NULL,'Papas',1),
  ('e2','Salchipapas con Tocineta',NULL,'Tocineta',1),
  ('e3','Salchipapas con Camarón',NULL,'Salchicha',1),('e3','Salchipapas con Camarón',NULL,'Papas',1),
  ('e3','Salchipapas con Camarón',NULL,'Camarón',1),
  ('e4','Choripapas',NULL,'Chorizo',1),('e4','Choripapas',NULL,'Papas',1),
  ('e5','Pollipapas',NULL,'Pollo',1),('e5','Pollipapas',NULL,'Papas',1),
  ('e6','Pollo 3 Quesos',NULL,'Pollo',1),('e6','Pollo 3 Quesos',NULL,'Queso Amarillo',1),
  ('e6','Pollo 3 Quesos',NULL,'Mozzarella',1),('e6','Pollo 3 Quesos',NULL,'Parmesano',1),
  ('e7','Patacón Maduro',NULL,'Plátano Maduro',1),
  ('e8','Servicio Papas',NULL,'Papas',1),
  -- ENSALADAS Y KETO
  ('ek1','Ensalada Parmesana',NULL,'Ensalada',1),('ek1','Ensalada Parmesana',NULL,'Parmesano',1),
  ('ek2','Ensalada Mixta',NULL,'Ensalada',1),
  ('ek3','Ensalada Cesar con Pollo',NULL,'Lechuga',1),('ek3','Ensalada Cesar con Pollo',NULL,'Pollo',1),
  ('ek3','Ensalada Cesar con Pollo',NULL,'Aderezo César',1),('ek3','Ensalada Cesar con Pollo',NULL,'Parmesano',1),
  ('ek4','Ensalada Cesar con Camarones',NULL,'Lechuga',1),('ek4','Ensalada Cesar con Camarones',NULL,'Camarón',1),
  ('ek4','Ensalada Cesar con Camarones',NULL,'Aderezo César',1),('ek4','Ensalada Cesar con Camarones',NULL,'Parmesano',1),
  ('ek5','Ensalada Cesar con Pollo y Camarones',NULL,'Lechuga',1),('ek5','Ensalada Cesar con Pollo y Camarones',NULL,'Pollo',1),
  ('ek5','Ensalada Cesar con Pollo y Camarones',NULL,'Camarón',1),('ek5','Ensalada Cesar con Pollo y Camarones',NULL,'Aderezo César',1),
  ('ek5','Ensalada Cesar con Pollo y Camarones',NULL,'Parmesano',1),
  ('ek6','Pollo Gratinado',NULL,'Pollo',1),('ek6','Pollo Gratinado',NULL,'Ensalada',1),('ek6','Pollo Gratinado',NULL,'Queso',1),
  ('ek6','Pollo Gratinado',NULL,'Aguacate',1),('ek6','Pollo Gratinado',NULL,'Tocineta',1),('ek6','Pollo Gratinado',NULL,'Huevo',1),
  ('ek7','Lomito Gratinado',NULL,'Lomito',1),('ek7','Lomito Gratinado',NULL,'Ensalada',1),('ek7','Lomito Gratinado',NULL,'Queso',1),
  ('ek7','Lomito Gratinado',NULL,'Aguacate',1),('ek7','Lomito Gratinado',NULL,'Tocineta',1),('ek7','Lomito Gratinado',NULL,'Huevo',1),
  ('ek8','Camarones Gratinados',NULL,'Camarón',1),('ek8','Camarones Gratinados',NULL,'Ensalada',1),
  ('ek8','Camarones Gratinados',NULL,'Queso',1),('ek8','Camarones Gratinados',NULL,'Aguacate',1),
  ('ek8','Camarones Gratinados',NULL,'Tocineta',1),('ek8','Camarones Gratinados',NULL,'Huevo',1),
  -- MARISQUERÍA
  ('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Lomito',1),('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Mariscos',1),
  ('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Chorizo',1),('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Queso',1),
  ('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Maíz',1),('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Papas',1),
  ('m1','Parrilla Mar y Tierra (Pequeña)',NULL,'Ensalada',1),
  ('m2','Parrilla Mar y Tierra (Grande)',NULL,'Lomito',1),('m2','Parrilla Mar y Tierra (Grande)',NULL,'Mariscos',1),
  ('m2','Parrilla Mar y Tierra (Grande)',NULL,'Chorizo',1),('m2','Parrilla Mar y Tierra (Grande)',NULL,'Queso',1),
  ('m2','Parrilla Mar y Tierra (Grande)',NULL,'Maíz',1),('m2','Parrilla Mar y Tierra (Grande)',NULL,'Papas',1),
  ('m2','Parrilla Mar y Tierra (Grande)',NULL,'Ensalada',1),
  ('m3','Frutos del Mar (Pequeña)',NULL,'Mariscos',1),
  ('m4','Frutos del Mar (Grande)',NULL,'Mariscos',1),
  ('m5','Zarzuela',NULL,'Mariscos',1),
  ('m6','Paella',NULL,'Mariscos',1),('m6','Paella',NULL,'Arroz',1),
  ('m7','Pollo con Mariscos',NULL,'Pollo',1),('m7','Pollo con Mariscos',NULL,'Mariscos',1),
  ('m8','Pollo con Camarones',NULL,'Pollo',1),('m8','Pollo con Camarones',NULL,'Camarón',1),
  ('m9','Pasta con Mariscos',NULL,'Pasta',1),('m9','Pasta con Mariscos',NULL,'Mariscos',1),
  ('m10','Pasta con Camarones',NULL,'Pasta',1),('m10','Pasta con Camarones',NULL,'Camarón',1),
  ('m11','Pasta de la Casa',NULL,'Pasta',1),('m11','Pasta de la Casa',NULL,'Camarón',1),('m11','Pasta de la Casa',NULL,'Tocineta',1),
  ('m11','Pasta de la Casa',NULL,'Pollo',1),('m11','Pasta de la Casa',NULL,'Maíz',1),('m11','Pasta de la Casa',NULL,'Parmesano',1),
  ('m12','Camarones al Ajillo',NULL,'Camarón',1),('m12','Camarones al Ajillo',NULL,'Ajo',1),
  ('m12','Camarones al Ajillo',NULL,'Papas',1),
  ('m13','Camarones en Salsa de Queso',NULL,'Camarón',1),('m13','Camarones en Salsa de Queso',NULL,'Queso',1),
  ('m13','Camarones en Salsa de Queso',NULL,'Papas',1),
  ('m14','Camarones Rebosados',NULL,'Camarón',1),('m14','Camarones Rebosados',NULL,'Papas',1),
  ('m15','Camarones Bechamel y Tocino',NULL,'Camarón',1),('m15','Camarones Bechamel y Tocino',NULL,'Tocineta',1),
  ('m15','Camarones Bechamel y Tocino',NULL,'Papas',1),
  ('m16','Copa de Camarones',NULL,'Camarón',1),('m16','Copa de Camarones',NULL,'Papas',1),
  ('m16','Copa de Camarones',NULL,'Lechuga',1)
) AS v(product_id, product_name, variant, ingredient_name, qty)
JOIN ingredients i ON i.name = v.ingredient_name
ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;

-- Bebidas: se eliminan las auto-recetas de la migración 005 (producto -> sí mismo).
-- El consumo ahora se resuelve por products.stock_item_id.
DELETE FROM recipes
WHERE ingredient_id IN (SELECT id FROM ingredients WHERE kind = 'product')
  AND product_name IN (SELECT name FROM ingredients WHERE kind = 'product');

-- ---------------------------------------------------------------------------
-- 6. Recetas de fabricación de ejemplo (producción de bebidas hechas en casa)
-- ---------------------------------------------------------------------------
INSERT INTO production_recipes (product_id, ingredient_id, qty)
SELECT p.id, i.id, r.qty
FROM (VALUES
  ('Frozen de Fresa','Leche',1),
  ('Frozen de Fresa','Fresa',1),
  ('Frozen de Fresa','Azúcar',0.25),
  ('Frozen de Fresa','Hielo',1),
  ('Limonada','Limón',1),
  ('Limonada','Azúcar',0.25),
  ('Limonada','Hielo',1),
  ('Limonada','Agua',1),
  ('Jarra Nestea','Nestea',1),
  ('Jarra Nestea','Agua',1),
  ('Jarra Nestea','Hielo',1)
) AS r(product_name, ingredient_name, qty)
JOIN ingredients p ON p.name = r.product_name AND p.kind = 'product'
JOIN ingredients i ON i.name = r.ingredient_name
ON CONFLICT (product_id, ingredient_id) DO NOTHING;