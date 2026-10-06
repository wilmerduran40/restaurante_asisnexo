-- Migración 009: CRUD de mesas del local.
-- Crea la tabla `tables` (mesas configurables desde el panel) y siembra las
-- 12 mesas iniciales (1-12) que existían fijas. Reemplaza el CHECK 1-12 de
-- orders.table_no por uno que solo exige número positivo: ahora el admin puede
-- agregar/renombrar/desactivar/eliminar mesas libremente.
--
-- Es aplicada por el motor de migraciones (src/db.js) y queda registrada en
-- schema_migrations, así que se ejecuta una sola vez sobre bases existentes.

CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  no INT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity INT NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tables (no, name, capacity)
SELECT gs, 'Mesa ' || gs, 1
FROM generate_series(1, 12) AS gs
ON CONFLICT (no) DO NOTHING;

-- Las mesas ya no están limitadas a 1-12: cualquier entero positivo es válido.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_table_no_range;

ALTER TABLE orders ADD CONSTRAINT orders_table_no_positive
  CHECK (table_no IS NULL OR table_no > 0);