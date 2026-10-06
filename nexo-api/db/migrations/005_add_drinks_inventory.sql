-- Bebidas del menú como inventario de stock.
--
-- Cada bebida es un ingrediente (unidad "unidad") con su receta base de 1 ud:
-- al venderla se descuenta stock y, si llega a 0, se marca "Agotado" en la web
-- y en el POS (misma mecánica que los platos).
-- Idempotente: no falla si ya se crearon antes (re-ejecutar no duplica).

-- Merengadas
INSERT INTO ingredients (name, unit) VALUES ('Merengada de Fresa', 'unidad')      ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada de Oreo', 'unidad')       ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada Samba', 'unidad')         ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada de Cocosette', 'unidad')  ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada de Parchita', 'unidad')   ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada Toronto', 'unidad')       ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada Flip', 'unidad')          ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Merengada de Nutella', 'unidad')    ON CONFLICT (name) DO NOTHING;

-- Frozen / jugos
INSERT INTO ingredients (name, unit) VALUES ('Frozen de Fresa', 'unidad')        ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Frozen de Melocotón', 'unidad')    ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Frozen de Lechosa', 'unidad')      ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Frozen de Melón', 'unidad')        ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Frozen de Parchita', 'unidad')     ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Limonada', 'unidad')               ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Jarra Nestea', 'unidad')           ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Vaso Nestea', 'unidad')            ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Vaso Nestea Grande', 'unidad')     ON CONFLICT (name) DO NOTHING;

-- Refrescos
INSERT INTO ingredients (name, unit) VALUES ('Coca-Cola', 'unidad')              ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Coca-Cola Zero', 'unidad')         ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Coca-Cola 350ml', 'unidad')        ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Coca Cola 1.5L', 'unidad')         ON CONFLICT (name) DO NOTHING;
INSERT INTO ingredients (name, unit) VALUES ('Coca Cola 2L', 'unidad')           ON CONFLICT (name) DO NOTHING;

-- Recetas: producto -> ingrediente (1 ud). Idempotente por el índice único
-- (product_id, COALESCE(variant, ''), ingredient_id).
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b1',  'Merengada de Fresa',     NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada de Fresa'     ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b2',  'Merengada de Oreo',      NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada de Oreo'      ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b3',  'Merengada Samba',        NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada Samba'        ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b4',  'Merengada de Cocosette', NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada de Cocosette' ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b5',  'Merengada de Parchita',  NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada de Parchita'  ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b6',  'Merengada Toronto',      NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada Toronto'      ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b7',  'Merengada Flip',         NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada Flip'         ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b8',  'Merengada de Nutella',   NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Merengada de Nutella'   ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;

INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b9',  'Frozen de Fresa',        NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Frozen de Fresa'        ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b10', 'Frozen de Melocotón',    NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Frozen de Melocotón'    ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b11', 'Frozen de Lechosa',      NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Frozen de Lechosa'      ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b12', 'Frozen de Melón',        NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Frozen de Melón'        ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b13', 'Frozen de Parchita',     NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Frozen de Parchita'     ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b14', 'Limonada',               NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Limonada'               ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b15', 'Jarra Nestea',           NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Jarra Nestea'           ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b16', 'Vaso Nestea',            NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Vaso Nestea'            ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b17', 'Vaso Nestea Grande',     NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Vaso Nestea Grande'     ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;

INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b18', 'Coca-Cola',              NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Coca-Cola'              ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b19', 'Coca-Cola Zero',         NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Coca-Cola Zero'         ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b20', 'Coca-Cola 350ml',        NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Coca-Cola 350ml'        ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b22', 'Coca Cola 1.5L',         NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Coca Cola 1.5L'         ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;
INSERT INTO recipes (product_id, product_name, variant, ingredient_id, qty)
SELECT 'b21', 'Coca Cola 2L',           NULL, i.id, 1 FROM ingredients i WHERE i.name = 'Coca Cola 2L'           ON CONFLICT (product_id, COALESCE(variant, ''), ingredient_id) DO NOTHING;