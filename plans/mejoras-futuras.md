# AsisNexo — Roadmap de mejoras futuras

> Estado del arte: web estática (`index.html`, `menu.html`) + API Node/Express/PostgreSQL
> (`nexo-api/`) + panel `/admin` + agente de impresión (`print-agent/`). Desplegado en
> Dokploy (Docker Compose).
>
> Cada punto: **Problema · Ubicación · Solución · Verificación**. Prioridad por oleada.

## Convenciones

- Severidad: Alta / Media / Baja.
- Estado: `[ ]` pendiente, `[~]` en progreso, `[x]` hecho.
- Las rutas y líneas corresponden a la revisión inicial; verificar antes de aplicar porque
  el código puede haber cambiado.

---

## Oleada 1 — Seguridad crítica

- [ ] **1.1 Secretos filtrados** · Alta
  - Problema: `AGENT_TOKEN` hardcodeado y versionado en git. `SESSION_SECRET` cae a
    `'dev-session-secret'` y el arranque solo advierte.
  - Ubicación: `print-agent/agente.bat:4` (confirmado con `git ls-files`), `nexo-api/src/auth.js:7`,
    `nexo-api/src/server.js:98-102`.
  - Solución: rotar el token, cargar la config desde `.env` ignorado por git, purgar el
    historial (`git filter-repo` o BFG), y `process.exit(1)` si falta `SESSION_SECRET` en
    producción.
  - Verificación: `git grep` sin secretos; el arranque falla si falta la variable.

- [ ] **1.2 Precio autoritativo en servidor** · Alta
  - Problema: `unitPrice`/`total` vienen del cliente y así se calcula el total → manipulación
    de precios.
  - Ubicación: `nexo-api/src/validate.js:84,112`, `nexo-api/src/routes/orders.js:80,97`.
  - Solución: recalcular el subtotal desde `products`/variantes en el servidor; usar
    `unitPrice` solo como auditoría.
  - Verificación: test que envía un precio alterado y comprueba el total real persistido.

- [ ] **1.3 Rate-limit detrás del proxy** · Alta
  - Problema: sin `trust proxy`, `req.ip` es la IP del contenedor nginx → los límites son
    globales y el login puede bloquearse para todos.
  - Ubicación: `nexo-api/src/server.js`, `nexo-api/src/rateLimit.js:16`,
    `nexo-api/src/routes/admin.js:28`, `web/nginx.conf:32`.
  - Solución: `app.set('trust proxy', 1)` (solo el proxy conocido).
  - Verificación: peticiones con `X-Forwarded-For` distinto se limitan por IP real.

- [ ] **1.4 Token de agente y comparaciones** · Alta
  - Problema: `requireAgent` acepta el token por querystring (queda en los logs) y compara
    con `!==` (no timing-safe).
  - Ubicación: `nexo-api/src/auth.js:151-155`, `nexo-api/src/server.js:34`.
  - Solución: aceptar solo por header, usar `crypto.timingSafeEqual` y no loguear el query
    en rutas sensibles.
  - Verificación: el token por query devuelve 401; no aparece en los logs.

- [ ] **1.5 Headers de seguridad** · Media
  - Problema: sin CSP/HSTS/nosniff/X-Frame-Options; el panel es clickjackeable.
  - Ubicación: `nexo-api/src/server.js`, `web/nginx.conf`.
  - Solución: `helmet` en la API y `add_header` en nginx (CSP compatible con el build propio
    de Tailwind; hoy el CDN impide CSP estricta).
  - Verificación: `curl -I` muestra `X-Content-Type-Options`, `X-Frame-Options`, HSTS.

- [ ] **1.6 XSS en el menú** · Alta
  - Problema: datos de la API inyectados sin `esc()` en varios `innerHTML`.
  - Ubicación: `menu.html:1012,1030,1038,1040,1043,1121,1181,1372-1390`.
  - Solución: escapar de forma consistente o usar `textContent`/`createElement`.
  - Verificación: un nombre con `<img onerror>` no ejecuta script.

- [ ] **1.7 Rotación de JWT** · Media
  - Problema: el logout solo borra la cookie; el rol viaja en el token y no hay revocación.
  - Ubicación: `nexo-api/src/auth.js:80-137`, `nexo-api/src/routes/admin.js:151,203`.
  - Solución: `tokenVersion`/`jti` en `users` y verificarlo; invalidar al cambiar
    contraseña/rol.
  - Verificación: un token viejo deja de servir tras cambiar la contraseña.

- [ ] **1.8 Validación de subidas** · Media
  - Problema: solo se valida el `mimetype` (controlado por el cliente), no la firma real.
  - Ubicación: `nexo-api/src/routes/products.js:32-47`.
  - Solución: validar bytes mágicos (p. ej. `file-type`) además del tamaño.
  - Verificación: subir un `.txt` renombrado a `.jpg` se rechaza.

- [ ] **1.9 Panel servido por `express.static`** · Baja/Media
  - Problema: `panel.html` se sirve sin sesión vía `express.static`, evitando el check.
  - Ubicación: `nexo-api/src/server.js:60`.
  - Solución: servir `panel.html` solo tras `hasValidSession`; no exponer todo `publicDir`.
  - Verificación: `GET /admin/panel.html` sin cookie redirige a login.

---

## Oleada 2 — Consistencia y robustez

- [ ] **2.1 Deadlock del pool en stock** · Alta
  - Problema: `computeRequired` se ejecuta dentro de la transacción pero usa el pool global
    (no el `client`); cada pedido toma 2 conexiones y con `max:10` puede agotarse/deadlock.
  - Ubicación: `nexo-api/src/routes/orders.js:121`, `nexo-api/src/inventory.js:403-412`,
    `nexo-api/src/db.js:7`.
  - Solución: pasar el `client` de la transacción a `getRecipeRows/getIngredients`, o
    precalcular el requerimiento antes de abrir la transacción.
  - Verificación: test de concurrencia (p. ej. 20 pedidos simultáneos) sin timeouts de pool.

- [ ] **2.2 Restauración de stock idempotente** · Alta
  - Problema: `restoreOrderStock` lee el estado "ya restaurado" fuera de la transacción y sin
    `FOR UPDATE`; dos cancelaciones concurrentes restauran dos veces.
  - Ubicación: `nexo-api/src/inventory.js:558-588`, `nexo-api/src/routes/orders.js:426-445`.
  - Solución: bloquear la fila del pedido (`SELECT ... FOR UPDATE`) y/o índice único en
    `stock_movements(order_id, reason)` para `order_cancel`.
  - Verificación: cancelar dos veces no duplica movimientos ni stock.

- [ ] **2.3 Cancelación atómica** · Media
  - Problema: la cancelación ignora el error al restaurar stock y responde 200 igual.
  - Ubicación: `nexo-api/src/routes/orders.js:439-443`.
  - Solución: hacer atómica cancelación + restauración; si falla, revertir estado o devolver
    error.
  - Verificación: un fallo de restauración no deja el pedido cancelado con stock inconsistente.

- [ ] **2.4 Transiciones con guarda** · Media
  - Problema: pay/print/ack/complete/reprint hacen read-then-write sin guarda condicional
    (TOCTOU).
  - Ubicación: `nexo-api/src/routes/orders.js:325-421`.
  - Solución: `UPDATE ... WHERE id=$1 AND status='...'` y verificar `rowCount`.
  - Verificación: dos acciones concurrentes sobre el mismo pedido solo aplican una.

- [ ] **2.5 Validación de IDs numéricos** · Media
  - Problema: `getOrder(id)` con id no numérico produce `22P02` → 500 en vez de 400/404.
  - Ubicación: `nexo-api/src/routes/orders.js:56-59,314-320`.
  - Solución: validar `Number.isInteger` antes de consultar (patrón ya usado en otras rutas).
  - Verificación: `GET /api/orders/abc` devuelve 400.

- [ ] **2.6 Mesas con pedidos activos** · Media
  - Problema: al cambiar el `no` de una mesa no se actualizan los `orders.table_no`; sin FK,
    los pedidos activos desaparecen de la vista de mesas.
  - Ubicación: `nexo-api/src/routes/tables.js:148-172`.
  - Solución: bloquear el cambio de número si hay pedidos activos o migrarlos en la misma
    transacción.
  - Verificación: no se puede renumerar una mesa ocupada (o se migra correctamente).

- [ ] **2.7 CSV sin neutralizar fórmulas** · Media
  - Problema: campos de cliente (`=`, `+`, `-`, `@`) pueden ejecutarse en Excel.
  - Ubicación: `nexo-api/src/routes/stats.js:323-367`.
  - Solución: prefijar con `'` o espacio los valores que empiecen por esos caracteres.
  - Verificación: un nombre `=SUM(...)` se exporta neutralizado.

- [ ] **2.8 Bugs menores** · Baja
  - `saveProduct` con SELECT+INSERT sin capturar `23505` → 500 (`nexo-api/src/products.js:140-154`).
  - `adjustStock` registra el delta solicitado, no el efectivo (`inventory.js:290-307`,
    `inventory.js:878-886`).
  - `zones.maxKm` puede quedar `NaN` y no se rechaza (`routes/delivery.js:52-68`).
  - `source='web'` puede crear `deliveryType='local'` sin mesa (`validate.js:45-69`).
  - `initSchema` reintenta 30× cualquier error, no solo de conexión (`db.js:102-114`).
  - Sin `unhandledRejection`/`uncaughtException` ni graceful shutdown (`server.js`).
  - Migraciones sin checksum: editar una ya aplicada no se re-ejecuta (`db.js:65-85`).

---

## Oleada 3 — Rendimiento y assets

- [x] **3.1 Imágenes** · Alta
  - Problema: `img/` ≈ 23 MB con JPGs de hasta 580 KB, sin WebP/AVIF ni `srcset`; duplicado
    exacto `MixtaKeto.jpeg`/`mixtaketo.jpg`.
  - Ubicación: `img/`, `menu.html`, `index.html`.
  - Solución: pipeline con `sharp`/squoosh a WebP + `srcset`, borrar duplicados.
  - Verificación: Lighthouse/transferencia de red reducida y sin referencias rotas.
  - Hecho: `nexo-api/scripts/optimize-images.js` (sharp, escalera 400/800/1600 WebP, no
    destructivo) + `nexo-api/src/imageOptim.js` para las subidas del panel. `menu.html` e
    `index.html` usan `<picture>`/`srcset` con el JPG original como fallback (sin cambios en
    BD ni seeds); `css/index.css`, `panel.html` y `login.html` usan WebP. Duplicado y 7
    huérfanos borrados. Transferencia: JPG 8.96 MB → WebP 1.39 MB (400w) / 3.61 MB (800w) /
    6.55 MB (1600w).

- [ ] **3.2 Vídeos pesados** · Media
  - Problema: `img/clientes/videos/*.mp4` ≈ 12 MB y se autoplayan en hover.
  - Solución: reencodear a H.264/WebM ~720p y usar `poster`.
  - Verificación: peso por vídeo < 1 MB.

- [ ] **3.3 Caché de estáticos en nginx** · Media
  - Ubicación: `web/nginx.conf`.
  - Solución: `location ~* \.(jpg|jpeg|png|webp|css|js|svg|mp4)$ { expires 30d; add_header
    Cache-Control "public, immutable"; }`.
  - Verificación: `curl -I` de una imagen devuelve `Cache-Control`.

- [ ] **3.4 Frontend** · Media
  - Debounce en la búsqueda (`menu.html:1086-1089`) que hoy re-renderiza por tecla.
  - `Page Visibility` en el polling de 5s (`panel.html:2112,2201`) y refresco incremental.
  - `passive`/throttle en el listener de scroll (`index.html:554`).
  - Verificación: menos re-render/llamadas al ocultar la pestaña.

- [ ] **3.5 Agente de impresión** · Media
  - Backoff con jitter (`print-agent/agent.js:384,39`).
  - Limpiar `printedRecently` (leak) y reordenar la validación de `enabled` (`agent.js:81-85,150-156`).
  - `drain`/verificación en `printTcp` (`print-agent/printer.js:13-28`).
  - Log con stream asíncrono en vez de `appendFileSync` (`agent.js:52`).
  - Verificación: la API caída no genera martilleo; sin crecimiento de memoria.

- [ ] **3.6 API** · Media
  - Índices para stats/búsqueda (`routes/stats.js:122-174`, `routes/orders.js:251-260`).
  - `LIMIT` + índice parcial en la cola `en_cola` (`routes/orders.js:286-294`).
  - ETag/`Cache-Control` y `updatedAt` en `/api/menu` y `/api/inventory/availability`
    (`routes/products.js:125-130`, `routes/inventory.js:21-26`).
  - Verificación: `EXPLAIN` usa índices; la cola no crece sin tope.

---

## Oleada 4 — Calidad y experiencia

- [ ] **4.1 Tests + lint + CI** · Alta
  - No hay tests ni lint; CI solo hace `node --check` y smoke de módulos.
  - Ubicación: repo, `.github/workflows/ci.yml`.
  - Solución: Vitest/Jest + supertest (precios, stock concurrente, auth, validación),
    ESLint + Prettier, y job de CI con `postgres:16` + migraciones.
  - Verificación: `npm test` y `npm run lint` en verde; CI corre contra BD real.

- [ ] **4.2 Modularización** · Media
  - `panel.html` (≈4560 líneas/268 KB) y `menu.html` (≈2065) con JS inline y config Tailwind
    duplicada en 4 archivos; `esc()` duplicado.
  - Solución: extraer JS a módulos, build de Tailwind, utilidades compartidas (`esc`,
    settings, `httpError`), separar seeds de esquema en migraciones.
  - Verificación: bundle compilado y HTML sin bloques gigantes de JS.

- [ ] **4.3 PWA/offline** · Media
  - Sin `manifest.json` ni service worker; la cola offline (`menu.html:1888-1917`) solo
    reintenta al enviar/recargar.
  - Solución: manifest + SW (precache del shell) y reintento con backoff en el evento `online`.
  - Verificación: instalable y pedido pendiente se envía al reconectar.

- [ ] **4.4 SEO** · Media
  - OG/JSON-LD apuntan a `github.io` mientras el sitio real es `asisnexo.com`; sin
    canonical ni `robots.txt`/`sitemap.xml`.
  - Ubicación: `menu.html:10,28`, `index.html:10,28`.
  - Verificación: metadatos con el dominio correcto y sitemap accesible.

- [ ] **4.5 Observabilidad** · Media
  - Solo `console.log`, sin logs estructurados, request-id, métricas ni backup documentado.
  - Solución: `pino` + request-id, endpoint `/metrics`, plan de backup de PostgreSQL.
  - Verificación: logs con request-id correlacionables y backup restore probado.

---

## Orden de ejecución sugerido

Oleada 1 → 2 → 3 → 4, con un checkpoint de tests (4.1) al cerrar cada oleada. Los puntos
Alta de cada oleada van primero.

## Puntos correctos a preservar

- Consultas parametrizadas (sin inyección SQL evidente).
- Whitelists de columnas/estados (stats, orders).
- `consumeStock` con `UPDATE ... WHERE stock >=` (nunca stock negativo) y `withTransaction`.
- Cookies `httpOnly` + `sameSite=lax`, `x-powered-by` deshabilitado y body JSON limitado.
- Migraciones versionadas con `schema_migrations` y healthchecks de BD/contenedor.
