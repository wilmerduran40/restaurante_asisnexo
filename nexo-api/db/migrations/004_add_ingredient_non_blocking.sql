-- Ingredientes "siempre hay" (no bloquean): p. ej. maíz y salsas.
-- Con always_available = true el ingrediente no se descuenta ni afecta la
-- disponibilidad de los platos.

ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS always_available BOOLEAN NOT NULL DEFAULT false;