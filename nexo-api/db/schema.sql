-- Esquema inicial de AsisNexo (PostgreSQL)
-- Se ejecuta en /docker-entrypoint-initdb.d al primer arranque del contenedor o vía
-- initSchema() en el arranque de la API (comportamiento idempotente).

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  gmaps_url TEXT,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','mesero')),
  waiter TEXT,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('delivery','pickup','local')),
  payment_method TEXT NOT NULL,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  items JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'nuevo' CHECK (status IN
    ('nuevo','pago_confirmado','en_cola','impreso','completado','cancelado')),
  paid_at TIMESTAMPTZ,
  printed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  kitchen_ready_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);

-- Almacén de configuración (ej: hash bcrypt de la contraseña admin, horneada al primer arranque).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usuarios del panel /admin con roles (admin: todo; mesero: POS, en vivo, pago, entregado;
-- cocina: solo el tablero de comandas KDS).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'mesero' CHECK (role IN ('admin','mesero','cocina')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impresoras del local (CRUD desde el panel /admin). La activa imprime los pedidos.
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