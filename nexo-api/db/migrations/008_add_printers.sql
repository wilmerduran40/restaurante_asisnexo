-- Impresoras del local: CRUD desde el panel /admin.
-- Sustituye a la config global única que vivía en settings ('printer').
-- La impresora marcada como activa es la que imprime los pedidos (comandas).

CREATE TABLE IF NOT EXISTS printers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 9100 CHECK (port BETWEEN 1 AND 65535),
  width INTEGER NOT NULL DEFAULT 58 CHECK (width IN (58, 80)),
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Si ya existía la config global previa (settings.key = 'printer') y aún no hay
-- impresoras en la tabla, se migra como la primera (y queda activa).
INSERT INTO printers (name, model, location, host, port, width, active)
SELECT
  COALESCE((value::jsonb)->>'name', ''),
  COALESCE((value::jsonb)->>'model', ''),
  COALESCE((value::jsonb)->>'location', ''),
  (value::jsonb)->>'host',
  COALESCE(((value::jsonb)->>'port')::int, 9100),
  COALESCE(((value::jsonb)->>'width')::int, 58),
  COALESCE(((value::jsonb)->>'active')::boolean, false)
FROM settings
WHERE key = 'printer'
  AND value LIKE '{%'
  AND (value::jsonb)->>'host' IS NOT NULL
  AND (value::jsonb)->>'host' <> ''
  AND NOT EXISTS (SELECT 1 FROM printers);