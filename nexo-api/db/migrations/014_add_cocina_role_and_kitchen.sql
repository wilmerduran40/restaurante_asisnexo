-- Migración 014: rol "cocina" y tablero KDS (comandas en pantalla).
--
--  - Amplía el CHECK de users.role para incluir 'cocina'. La cocina entra al
--    panel y ve únicamente el tablero de comandas (KDS).
--  - Agrega orders.kitchen_ready_at: momento en que cocina marcó el pedido como
--    listo. Es independiente del estado de caja ("completado") y se resetea al
--    reenviar el pedido a cocina (print/reprint).
--
-- Aplicada por el motor de migraciones (src/db.js) y registrada en
-- schema_migrations, así que se ejecuta una sola vez sobre bases existentes.

-- Elimina cualquier CHECK previo sobre users.role (sin depender del nombre
-- autogenerado) y lo recrea con el rol 'cocina'.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'users'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','mesero','cocina'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS kitchen_ready_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_kitchen
  ON orders(status, kitchen_ready_at, created_at);
