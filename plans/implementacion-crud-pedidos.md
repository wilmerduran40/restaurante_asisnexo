# Plan de implementación — Sistema de Pedidos + Impresión + Panel Admin (CRUD)

## 1. Objetivo
Convertir el sitio estático en una página de pedidos: el pedido de `menu.html` llega a la vez a WhatsApp (sin cambios) y a un backend en el VPS (`POST /api/order`), queda persistido en PostgreSQL con CRUD completo y se gestiona/imprime desde un panel `/admin` accesible desde PC, tablet o celular. Impresión vía ticketera **RJ45 (red, puerto 9100)** — sin depender de ninguna PC encendida. Además, el mesero puede **tomar pedidos en el local desde un POS integrado en el mismo panel `/admin`**, distinguiendo su origen (`mesero`) del web.

## 2. Arquitectura
```
Cliente menu.html ── POST /api/order (misma origen; fallback localStorage + reintento)
       ▼
VPS (docker-compose, dominio propio)
 ├─ postgres (volumen nexo-data)   → pedidos persistentes (cola + historial)
 ├─ nexo-api (Express + pg)        → API REST + panel /admin (SPA)
 └─ web (nginx)                    → estáticos + proxy /api/* y /admin* → nexo-api
       ▼  polling GET /api/orders/pending (AGENT_TOKEN)
Dispositivo local (PC / tablet Android / celular)
 └─ print-agent (Node genérico)    → TCP impresora-IP:9100 (ESC/POS, ancho 58/80 por env)
```
- Mismo dominio → sin CORS. Varios agentes simultáneos OK (ack evita doble impresión).
- Los pedidos quedan siempre en PostgreSQL con historial de estados.
- La impresora RJ45 es un dispositivo de red con IP propia: no necesita que ninguna PC esté encendida (solo energía + red).
- El menú de la web sigue estático (`data/menu.js`); el CRUD de productos queda **fuera de alcance**.

## 3. CRUD completo por entidad

### 3.1 Pedidos (`orders`) — CRUD completo
| Op | Endpoint | Descripción |
|---|---|---|
| **C** | `POST /api/order` | Crear pedido (cliente). Valida payload, exige `ORDER_TOKEN` + rate-limit. Estado inicial `nuevo`, `source='web'`. |
| **C** | `POST /api/orders` | Crear pedido del mesero (POS). Requiere sesión admin, mismo payload + `waiter`. `source='mesero'`, sin `ORDER_TOKEN` ni rate-limit. |
| **R** | `GET /api/orders?status&q&from&to&payment&page` | Listado admin con filtros, búsqueda y paginación. |
| **R** | `GET /api/orders/:id` | Detalle de un pedido. |
| **R** | `GET /api/orders/pending` | Cola para el agente impresor (`AGENT_TOKEN`). |
| **U** | `POST /api/orders/:id/pay` | `nuevo → pago_confirmado` (timestamp). |
| **U** | `POST /api/orders/:id/print` | → `en_cola`. **Regla servidor:** `pickup` y `local` siempre; `delivery` solo si pago confirmado (si no, `403`). |
| **U** | `POST /api/orders/:id/ack` | Agente confirma impresión → `impreso`. |
| **U** | `POST /api/orders/:id/complete` | → `completado` (entregado). |
| **U** | `POST /api/orders/:id/reprint` | `impreso → en_cola` (reimprimir). |
| **U (soft D)** | `POST /api/orders/:id/cancel` | **Soft delete:** → `cancelado` con `cancelled_at`. Nunca hay `DELETE` real (auditoría). |

Transiciones: `nuevo → pago_confirmado → en_cola → impreso → completado` (+ `cancelado` o `reprint`) con timestamps.

### 3.2 Autenticación / sesión admin
| Op | Endpoint | Descripción |
|---|---|---|
| **C** | `POST /api/admin/login` | Crea sesión (cookie httpOnly + JWT). Verifica hash bcrypt de `ADMIN_PASSWORD` (horneado al primer arranque). Sin registro público. |
| **R** | `GET /api/admin/me` | Sesión actual. |
| **U** | `POST /api/admin/password` | Cambiar contraseña (antigua + nueva). |
| **D** | `POST /api/admin/logout` | Destruye sesión. |

### 3.3 Cola de impresión
| Op | Endpoint | Descripción |
|---|---|---|
| **C** | (vía `print`) | Registro `en_cola` con `printed_at=NULL`. |
| **R** | `GET /api/orders/pending` | Polling del agente. |
| **U** | `POST /api/orders/:id/ack` | Marca `impreso` (idempotente, evita duplicados). |
| **D** | n/a | Se anula vía `cancel` (3.1). |

### 3.4 Estadísticas — solo lectura
| Op | Endpoint | Descripción |
|---|---|---|
| **R** | `GET /api/stats?source` | Pedidos/día (7 y 30 días), top productos, total vendido $ (base: estados `impreso`+); filtrable por origen (`web`/`mesero`). |

### 3.5 Pedidos del mesero (POS) — flujo en el local
- El mesero toma el pedido en el local desde el **POS integrado en `/admin`** (pestaña "Nuevo pedido (mesero)"): productos desde `data/menu.js`, carrito y total calculados en cliente.
- Se crea con `source='mesero'` y `waiter` (nombre del mesero). El pago queda **pendiente** hasta que el cliente paga (después de comer o al momento de retirar si es delivery).
- Regla de impresión: `local`/`pickup` imprimen sin pago (comanda al instante); `delivery` imprime solo con pago confirmado.
- El ticket sin pago muestra **"POR COBRAR"**; al confirmar el pago (`pay`) se puede reimprimir el recibo si hace falta.

## 4. Esquema PostgreSQL (`nexo-api/db/schema.sql`)
```sql
CREATE TABLE orders (
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
  paid_at TIMESTAMPTZ, printed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ
);
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
```
- Payload de `POST /api/order`: `{name, address, gmapsUrl, phone, deliveryType, payment, items:[{name, variant, removed, extras, notes, qty, unitPrice}], total}`. `POST /api/orders` (mesero) usa el mismo payload + `waiter`.

## 5. Cambios mínimos en `menu.html`
- En el handler `sendWhatsappBtn` (menu.html:1147): tras abrir WhatsApp, `fetch('/api/order', ...)` con el payload del carrito (ruta relativa, misma origen). Si falla → guardar en `localStorage['nexo_pending_orders']` y flush silencioso en carga/siguiente pedido.
- Añadir campo opcional **Teléfono** al checkout.
- Actualizar metas `og:url`/`og:image` (menu.html:10-18 e index.html) al dominio nuevo.

## 6. Panel `/admin` (SPA, servida por Express static, navbar + vistas)
- **Login**: contraseña.
- **Nuevo pedido (mesero / POS)**: productos de `data/menu.js` (categorías, variantes, SIN, extras, notas), carrito y total en cliente. Campos: mesero (nombre), tipo de entrega (Local / Para llevar / Delivery), método de pago, y cliente + dirección si es delivery. Botón "Guardar" + opción "Imprimir comanda" (va directo a la cola).
- **Vista en vivo (pedidos nuevos)**: polling 5s, aviso sonoro + `Notification` al llegar `nuevo`. Botones por pedido: Confirmar pago · Imprimir comanda · Entregado · Anular · Reimprimir. Regla visible: pickup → "POR COBRAR EN LOCAL".
- **Historial**: tabla con filtros (fecha, cliente, método pago, estado, **origen**) + búsqueda + paginación + detalle expandible; badge `mesero` + nombre del mesero.
- **Estadísticas**: totales del día, pedidos/día, top productos (gráficos CSS/JS puro, sin librerías); filtro por origen.
- **Seguridad**: cambiar contraseña; sesión con logout.

## 7. `print-agent/` (independiente del VPS)
- Node genérico, corre en PC (Windows/Linux), Android (Termux) o celular.
- Polling HTTPS `GET /api/orders/pending` cada ~8s → **socket TCP `PRINTER_HOST:9100`** (JetDirect, ESC/POS crudo) → `POST ack`.
- Env: `PRINTER_HOST`, `PRINTER_PORT=9100`, `PRINTER_WIDTH=58|80`, `AGENT_TOKEN`, `API_URL`, `POLL_MS=8000`.
- Ticket: header "ASISNEXO", n° orden, fecha, cliente, entrega, dirección + Maps, items (proteína/SIN/extra/nota), total, pago; para `pickup`/`local` sin pago → **"POR COBRAR EN LOCAL"**; feed + **cut** + **beep**.
- Incluye `mock-printer` (log a consola/archivo) para probar sin hardware + guía de instalación corta (PC y Termux).

## 8. Despliegue (todo en el repo)
- `docker-compose.yml`: `postgres`, `nexo-api`, `web` (nginx + estáticos del repo). `nginx.conf`: estáticos + proxy `/api`, `/admin`, `/admin/*`.
- `.env.example` (comentado) + `.env` real en el VPS: `DATABASE_URL`, `ADMIN_PASSWORD`, `ORDER_TOKEN`, `AGENT_TOKEN`, `POSTGRES_PASSWORD`, `SESSION_SECRET`.
- **`deploy.yml`** (GitHub Actions, push main): SSH al VPS → `git pull` → escribir `.env` desde Secrets → `docker compose up -d --build`.
- Ancho de ticketera y `PRINTER_HOST` en el `.env` del agente (dispositivo local), no en el servidor.

## 9. Verificación
- `curl POST /api/order` (ok + sin token 401 + spam 429); `POST /api/orders` sin sesión → 401 y con sesión → crea con `source='mesero'`; estados C→R→U y soft-delete; regla `pickup`/`local` vs `delivery` (403); stats cuadran y filtran por origen; agente con `mock-printer` → ticket real (ancho definido).

## 10. Pendientes con el cliente (no bloquean)
- Dominio y TLS del VPS (nginx las necesita).
- Ancho físico final de la ticketera (se configura por env, sin recodificar).
- Confirmar inclusión del campo teléfono opcional.

## 11. Fuera del alcance
- Watcher de WhatsApp Web (decisión previa).
- CRUD de menú/productos (el menú sigue estático en `data/menu.js`).