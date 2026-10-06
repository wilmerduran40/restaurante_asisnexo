-- Costo de envío por distancia + recargo por lluvia.
-- Se agrega con migración (no se toca db/schema.sql) para no romper la BD en producción.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_km NUMERIC(6,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coords JSONB;