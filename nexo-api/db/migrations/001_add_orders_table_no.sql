-- Migración 001: Mesa del pedido en el local.
-- Agrega la columna table_no a orders (nullable; solo pedidos delivery_type='local').
-- Es aplicada por el motor de migraciones (src/db.js) y queda registrada en
-- schema_migrations, así que se ejecuta una sola vez sobre bases existentes.

ALTER TABLE orders ADD COLUMN table_no INT;

ALTER TABLE orders ADD CONSTRAINT orders_table_no_range
  CHECK (table_no IS NULL OR (table_no >= 1 AND table_no <= 12));

CREATE INDEX IF NOT EXISTS idx_orders_table_status ON orders(table_no, status);