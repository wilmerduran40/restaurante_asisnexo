# AsisNexo — Plan y Resumen

## Contexto

Página web de AsisNexo (Socopó, Barinas). Sitio estático con dos páginas:

- `index.html` — Landing: hero, nosotros, especialidades, ubicación y contacto.
- `menu.html` — Menú digital con carrito, modificadores (proteína, SIN, adicionales, notas) y envío del pedido por WhatsApp.

**Stack**: HTML + Tailwind CSS (CDN) + Google Fonts (Poppins) + Font Awesome + `data/menu.js` (datos del menú).

## Cambios realizados

### Tipografía y móvil (sesión de revisión)

- `index.html`: corregida clase inválida `md:text-7x2` → `md:text-7xl` en el título hero.
- `index.html`: agregados pesos 500 y 700 de Poppins al `<link>` de Google Fonts. Antes solo cargaban 300/400/600/800 y el navegador sintetizaba el bold (letras inconsistentes entre páginas).
- `index.html`: título hero ahora `text-4xl sm:text-6xl md:text-7xl` para que "Hamburguesas" no se desborde en pantallas de ~360px.
- `menu.html`: limpiada clase inválida `"shrink-0, marigintop-10"` → `"shrink-0"`.
- `menu.html`: imagen del producto ahora usa `w-full h-full object-cover md:h-72` (antes `cover ... md:h-70`, clases inexistentes).

### Visor de imagen a pantalla completa (lupa)

- `menu.html`: botón de lupa (`fa-magnifying-glass-plus`) sobre la imagen en el modal del producto.
- Overlay fullscreen (`#image-viewer`, `z-[60]`) con fondo negro, imagen en `object-contain` y flecha `fa-arrow-left` para volver al modal.
- Comportamiento: la lupa abre el visor; la flecha, tocar la imagen o el fondo lo cierra; `Escape` cierra el visor primero (antes que el modal/carrito). Al cerrar el modal también se cierra el visor.

### Refactor CSS

- Se separó el CSS embebido en archivos externos dentro de la carpeta `css/`:
  - `css/index.css` — estilos de `index.html` (hero parallax, animaciones, scrollbar). Ruta de imagen corregida a `../img/portada.jpg` (las rutas `url()` en CSS se resuelven desde la carpeta del CSS).
  - `css/menu.css` — estilos de `menu.html` (hide-scrollbar, animaciones del carrito, checkboxes/radios personalizados).
- Se removieron los bloques `<style>` y se enlazaron los CSS en cada HTML:
  - `index.html` → `<link rel="stylesheet" href="css/index.css">`
  - `menu.html` → `<link rel="stylesheet" href="css/menu.css">`

## Pendientes / Futuro

- Reemplazar `img/placeholder.svg` por fotos reales de cada plato (quedan ~20: Mixta Especial, Tociqueso, parrillas simples, salchipapas, pollipapas, ensaladas parmesana/mixta, camarones gratinados, paella, pollo con mariscos/camarones, pastas y camarones al ajillo/salsa de queso/bechamel).
- Publicar el sitio en un hosting gratuito (GitHub Pages / Netlify) y probar en móvil real.

### Rebrand a la paleta del logo

- `index.html` y `menu.html`: bloque `tailwind.config` que sobrescribe la escala `orange` con el rojo del logo (`#BF0B1A` / `#730710`) y agrega la escala `gold` (`#F2D335` / `#A69129`).
- Acentos dorados (`gold-300`) en secciones sobre fondos oscuros: hero, "Especialidades" y footer de `index.html`.
- `theme-color` de ambas páginas actualizado a `#BF0B1A`.
- `css/menu.css`: checkboxes del modal ahora usan `#BF0B1A` (radios ya usaban `#BF0B1A`/`#F2D335`).
- `img/favicon.svg`: fondo del ícono cambiado a `#BF0B1A`.

### Favicon con el logo real

- `img/favicon.png`: generado a partir de `img/logo.jpeg` (recorte cuadrado 512×512, ImageMagick).
- `index.html` y `menu.html`: `<link rel="icon">` apunta ahora a `img/favicon.png` (PNG en vez del SVG de hamburguesa genérica).

### Ajustes móviles y fotos de platos

- `index.html`: hero `min-h-screen` → `min-h-[100svh]` (corrige la barra de URL de iOS).
- `menu.html`: botones táctiles `w-8 h-8` → `w-10 h-10` (mínimo recomendado de 44px) en modal, carrito, badge flotante y tarjetas de producto.
- `data/menu.js`: reemplazados varios `placeholder.svg` por fotos reales (`parrillacamaron.jpg`, `costillabqq.jpg`, `frutosdelmar.jpg`, `pollo3quesos.jpg`). Corregida referencia rota `parrillacamaronmix.jpg` → `parrillacamaron.jpg` (p7) y confirmada `groserajunio.jpg` (h8).

### Barra de búsqueda en el menú

- `menu.html`: barra de búsqueda entre el título y el grid con icono de lupa (`#search-input`).
- `renderMenu()` ahora filtra por categoría activa **y** por texto de búsqueda sobre nombre y descripción (case-insensitive, combina con los filtros).
- Mensaje "No encontramos resultados para..." cuando no hay coincidencias.

## Paleta de Colores del logo

| Color | Hex | Uso |
|---|---|---|
| Rojo vivo | `#BF0B1A` | Color principal (botones, badges, acentos) |
| Rojo oscuro | `#730710` | Hover / estados activos |
| Amarillo dorado | `#F2D335` | Acentos sobre fondos oscuros |
| Dorado oliva | `#A69129` | Acento secundario |
| Negro | `#0D0D0D` | Secciones oscuras y texto

## Implementado: Sistema de pedidos (backend + panel + impresión)

> **Plan original con detalle del CRUD:** `plans/implementacion-crud-pedidos.md`.

### Qué se construyó
1. **`nexo-api/`** — Backend Node + Express + PostgreSQL (`pg`), containerizado en Docker:
   - Público: `POST /api/order` (validación + `X-Order-Token` + rate limit 5/min/IP).
   - Mesero (sesión admin): `POST /api/orders` (POS; `printNow:true` va a `en_cola`).
   - Admin: `GET /api/orders` (filtros `status/source/payment/from/to/q/page/limit`),
     `GET /api/orders/:id`, `POST .../pay|print|ack|complete|reprint|cancel`,
     `POST /api/admin/login|me|password|logout`, `GET /api/stats` (hoy/día/productos top/origen).
   - Panel SPA en `nexo-api/public/admin.html` (`/admin`): login, POS, vista en vivo
     (polling + sonido), historial con filtros y paginación, estadísticas, seguridad.
   - Estados: `nuevo → pago_confirmado → en_cola → impreso → completado/cancelado`.
   - Regla de impresión: `pickup`/`local` siempre imprimibles; `delivery` solo con pago confirmado.
2. **`menu.html`** — además del WhatsApp (sin cambios), hace `fetch` a `POST /api/order`;
   si falla, guarda en `localStorage` y reintenta (`flushPendingOrders`).
3. **`print-agent/`** — agente Node (fuera de Docker) en la PC del local: polling
   `GET /api/orders/pending` → ticket ESC/POS (58mm/80mm) → ack → `impreso`.
   Modos `tcp` (ticketera de red, puerto 9100) y `mock` (guarda texto para pruebas).
4. **Despliegue** — `docker-compose.yml` (postgres + nexo-api + web nginx),
   `web/nginx.conf` (estáticos + proxy `/api/` y `/admin`), `.env.example`,
   `.github/workflows/deploy.yml` (SSH al VPS).

## Implementado: Mesas del local + pedido por mesa

- **Mesas configurables (CRUD):** las mesas viven en la tabla `tables` (migración `009`),
  sembrada con las 12 iniciales (1-12). El admin puede **crear/editar/eliminar/desactivar**
  mesas desde el panel (pestaña Mesas): número, nombre y capacidad. Eliminar exige que la
  mesa no tenga pedidos activos. El `CHECK` de `orders.table_no` ya no limita a 1-12.
- **Base de datos:** la columna `orders.table_no` (nullable) se agrega con la **migración**
  `001_add_orders_table_no.sql`, aplicada por el motor de migraciones de `src/db.js`
  (`runMigrations`) que registra cada archivo en `schema_migrations`. **`db/schema.sql` no se modifica**,
  así la BD en producción no se rompe; las instalaciones nuevas aplican `schema.sql` + migraciones.
- **API:** `POST /api/orders` acepta `tableNo` (obligatorio si `source='mesero'` y
  `deliveryType='local'`, validado contra la tabla `tables` y solo mesas activas);
  `GET /api/orders` filtra por `?table=N`; **CRUD `POST/PUT/DELETE /api/tables`** (solo admin) y
  `GET /api/tables` devuelve las mesas con sus pedidos activos
  (`nuevo/pago_confirmado/en_cola/impreso`) para la pestaña Mesas.
- **Panel `/admin`:** pestaña **Mesas** (grilla Libre/Ocupada, total, mesero, items y acciones
  pagar/imprimir/entregar/anular; botón "Tomar pedido" que abre el POS con tipo local y mesa
  preseleccionada, polling 5s; botones de agregar/editar/eliminar mesa solo para admin).
  El POS muestra la grilla de mesas activas al elegir "En el local" (obligatoria); nombre auto
  "Mesa N" (o el nombre configurado). Badge "🪑 Mesa N" en En vivo e Historial + filtro por mesa
  en Historial alimentado desde `/api/tables`.
- **Impresión:** las comandas de caja y cocina incluyen "Mesa: N" (`print-agent/escpos.js`).

## Implementado: Costo de envío por distancia + recargo por lluvia

- **Cálculo:** distancia (Haversine) desde el local (`8.231491, -70.8198939`) hasta las
  coordenadas que comparte el cliente en `menu.html`. La tarifa sale de **zonas/radios
  configurables** (ej: hasta 1 km = $1, hasta 2 km = $2, hasta 4 km = $3, resto = $4).
- **Lluvia:** interruptor manual en el panel `/admin` → Delivery ("🌧 ¿Está lloviendo?").
  Cuando está activo se suma un recargo configurable (por defecto **$1**) a todos los delivery.
- **`nexo-api/src/delivery.js`** (nuevo): config por defecto, `haversineKm()`, `calcDelivery()`
  y helpers sobre la tabla `settings` (mismo patrón JSON que la impresora).
- **Rutas nuevas:** `GET /api/delivery/config` (público, con `X-Order-Token`) para que el
  carrito muestre el envío en vivo; `GET /api/delivery/estimate?lat=&lng=` (público, útil);
  `GET/POST /api/admin/delivery` (solo admin) para editar coordenadas, zonas y lluvia.
- **Migración `002_add_delivery_fee.sql`:** columnas `orders.delivery_fee`, `orders.distance_km`
  y `orders.coords`. `db/schema.sql` no se modifica.
- **Autoritativo en el servidor:** `POST /api/order` recalcula fee/distancia desde las coords
  y guarda `total = subtotal + envío`. El `menu.html` envía `coords`, `deliveryFee` y
  `distanceKm` solo como referencia/auditoría.
- **`menu.html`:** si el cliente comparte ubicación, el carrito muestra "Delivery $X.XX (a ~Y km)"
  (con nota "+$1 por lluvia 🌧" si aplica) y el TOTAL ya lo incluye; el mensaje de WhatsApp
  detalla el envío. Sin ubicación compartida se mantiene "El costo se confirma en el local".
- **`print-agent/escpos.js`:** la comanda de caja imprime `ENVIO $X` y `Distancia ~Y km`
  cuando el pedido tiene envío calculado.

### Notas
- El POS del mesero ahora permite **cotizar el envío con coordenadas** (lat/lng, tipo
  calculadora) en los campos de Delivery: calcula en vivo distancia y tarifa desde la
  misma configuración de zonas/lluvia y envía las `coords` al crear el pedido, para que
  el servidor recalcule y guarde el fee autoritativo. El panel muestra el desglose
  `Subtotal + Envío = Total` en En vivo e Historial.
- No usa API de clima: el estado de lluvia lo controla el personal en el panel.

### Implementado: Inventario de stock (ingredientes + recetas)

- **Modelo:** `ingredients` (nombre único, stock NUMERIC, unidad, umbral de bajo stock),
  `recipes` (por plato: ingrediente + cantidad; `variant NULL` = base que se consume
  siempre, `variant 'Pollo'` = solo cuando se elige esa variante) y `stock_movements`
  (auditoría y restauración idempotente al anular). Migración `003_add_inventory.sql`.
- **Regla de disponibilidad:** un plato solo se sirve si se cumplen TODAS las condiciones:
  los ingredientes base **y** la proteína de la variante elegida. Si falta un ingrediente
  base, el plato queda "Agotado" completo (no sale con ninguna variante). Si solo falta la
  proteína de una variante, se bloquea esa variante pero se pueden elegir las demás.
- **Ingredientes "siempre hay" (no bloquean):** flag `always_available` por ingrediente
  (migración `004_add_ingredient_non_blocking.sql`). Los marcados así (p. ej. **Maíz** y las
  **salsas/aderezos**) nunca agotan un plato ni se descuentan del stock, y sus extras no
  aparecen como "agotado". Se gestionan desde Inventario (interruptor "Siempre hay") y se
  siembran automáticamente con el botón de sugerencias del menú.
- **Consumo:** al crear el pedido (web `POST /api/order` o mesero `POST /api/orders`) se
  valida y descuenta stock en la misma transacción; los **extras** descuentan del
  ingrediente del mismo nombre y los **"sin"** no descuentan. Si falta stock → `409`
  indicando el ingrediente. Al anular un pedido se restaura el stock (solo si consumió).
- **Platos sin receta** configurada siguen siempre disponibles (no bloquean).
- **Panel `/admin` → Inventario:** CRUD de ingredientes (stock editable, ajuste ±, bajo
  stock), botón "Crear ingredientes sugeridos del menú" (variantes, adicionales, salsas,
  SIN), editor de recetas por plato (base + por variante) y movimientos.
- **POS:** productos con base agotada se ven grises ("Agotado"); si solo falla una
  proteína, esa variante aparece deshabilitada en el modal. Los extras agotados también
  se deshabilitan.
- **Web (`menu.html`):** tarjetas "Agotado" según `GET /api/inventory/availability`;
  variantes y extras agotados deshabilitados en el modal; el pedido envía `productId`;
  si el servidor responde 409 se avisa y se refresca la disponibilidad.

## Implementado: Persistencia de la pestaña activa al recargar

- **Panel `/admin` (`panel.html`):** la vista activa se guarda en `localStorage`
  (`asisnexo_admin_view`). `showView()` la persiste y `checkSession()` la restaura al recargar,
  validándola contra el rol (mesero solo `pos/live/mesas`; admin todas); si no es válida,
  abre `pos`.
- **Menú público (`menu.html`):** la categoría activa se guarda en `localStorage`
  (`nexo_active_category`) al pulsar un filtro y se restaura al recargar. Si la categoría
  guardada ya no existe en el menú, vuelve a `todos`. No se usa el hash porque está
  reservado para el deep-link a un producto.
- Se descartó (por ahora) separar el panel en archivos por pestaña; queda como refactor
  futuro (implicaría externalizar el JS y actualizar el check de `.github/workflows/ci.yml`).

## Pendientes
- [ ] Ancho de la ticketera: 58mm u 80mm (cliente lo confirmará; configurable vía `PRINTER_WIDTH`).
- [ ] Dominio + HTTPS en Dokploy (pestaña **Domains** del app compose; el compose ya no publica puertos en el host). Al activar TLS, setear `COOKIE_SECURE=true`.
- [ ] Actualizar meta `og:url`/`og:image` con el dominio definitivo.
- [ ] (Opcional) Watcher de WhatsApp Web (`whatsapp-web.js`) para pedidos escritos sueltos.

> Despliegue: **Dokploy** (source Docker + GitHub). La app compose se construye desde el repo y expone
> el sitio vía Traefik por dominio; no se usa `.github/workflows` (eliminado).