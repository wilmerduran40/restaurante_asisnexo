# AsisNexo — Sitio Web + Panel Admin

Landing + menú digital con carrito, pedido por **WhatsApp** y **panel administrativo completo** (pedidos, POS, menú, inventario, impresoras, estadísticas). El sitio sigue siendo estático para el visitante, pero detrás hay una **API Node + Express + PostgreSQL** que alimenta el menú y registra cada pedido.

- 🍗 Alitas que vuelan, 🍔 Burgers que te transportan — Socopó, Barinas.
- Pedido directo por WhatsApp a `+58 412-5284595`.
- Panel admin en `/admin` (login con usuario/contraseña).

## Arquitectura

| Pieza | Descripción |
|---|---|
| `index.html` / `menu.html` | Landing + menú digital (carrito, delivery por distancia, upsell de bebidas, envío por WhatsApp). |
| `menu.html` → `/api/menu` | El menú se sirve desde la BD; `data/menu.js` queda como respaldo offline. |
| `menu.html` → `/api/order` | Cada pedido también se registra en la BD (panel/POS/impresora), además de abrir WhatsApp. |
| `nexo-api/` | Backend **Express + PostgreSQL**: auth JWT, pedidos, menú, inventario, impresoras, mesas, delivery, estadísticas. |
| `nexo-api/public/` | Panel `/admin` (login.html + panel.html): POS, Pedidos en vivo, Mesas, Historial, Estadísticas, Impresoras, Delivery, Usuarios, Menú e Inventario. |
| `web/` | Nginx: sirve los estáticos y hace proxy de `/api` y `/admin` hacia la API. |
| `print-agent/` | Agente local para imprimir comandas en ticketera térmica (JetDirect 9100). |
| `docker-compose.yml` | PostgreSQL + nexo-api + web (un solo comando). |

> El menú del panel se edita en la BD y **la web lo refleja al recargar**. `data/menu.js` sigue siendo el respaldo estático (por si la API está caída).

## Despliegue (VPS con Docker)

El sistema necesita un servidor con Docker (los sitios 100% estáticos ya no aplican para el panel).

1. Copia el repo al VPS y crea `.env` a partir de `.env.example`:
   ```
   POSTGRES_PASSWORD=<contraseña larga>
   ADMIN_PASSWORD=<contraseña del panel>
   ORDER_TOKEN=<token aleatorio>
   AGENT_TOKEN=<token del agente impresor>
   SESSION_SECRET=<secreto para sesiones>
   ```
2. Levanta todo:
   ```bash
   docker compose up -d --build
   ```
3. Accede al panel en `/admin` (usuario `admin` + `ADMIN_PASSWORD`). La primera vez se siembra el menú de AsisNexo automáticamente (migración `010`).
4. Expón el dominio apuntando el puerto 80 del contenedor `web` (Dokploy: pestaña *Domains*; o `ports` en `docker-compose.yml`).

## En el panel puedes

- **Pedidos en vivo / Historial**: ver, confirmar pago, imprimir, completar o anular pedidos (llegan desde la web y desde el POS).
- **POS**: tomar pedidos de mesas, delivery o pickup desde el local.
- **Menú y Productos**: crear/editar productos, precios, categorías, variantes (tamaño/sabor), sabores de alitas, "sin pan", adicionales, fotos y visibilidad.
- **Inventario**: stock de ingredientes y bebidas (las bebidas descontan stock al venderse).
- **Impresoras**: configurar la ticketera que imprime las comandas.
- **Estadísticas**: ventas por día, métodos de pago, etc.

## Estructura del producto (BD `products`)

Se mantiene el mismo modelo de `data/menu.js`, más campos de AsisNexo:

```js
{
    id: 'alitas-tripack',             // id único (deep-link menu.html#id)
    name: 'Tripack',
    category: 'alitas',               // 'alitas' | 'burgers' | 'bebidas' (+ las que agregues)
    price: 28.00,                     // base; 0 si usa variants, null = "Consultar"
    desc: '...',
    img: 'img/tripack.jpeg',
    variants: [                       // tamaño de burger o sabor de bebida
        { label: 'Junior', price: 11.00 },
        { label: 'Doble', price: 13.00 }
    ],
    variantTitle: 'Elige tu Bebida',  // título del selector (opcional)
    flavors: { options: ['Broaster', 'BBQ Honey'], max: 2 },  // sabores de alitas (opcional)
    removable: ['Tocineta', 'Queso'], // lista "SIN"
    sinPan: true,                     // opción "Sin Pan (envuelta en lechuga)"
    extras: ADICIONALES,              // adicionales con precio
    popular: true
}
```

## Editar menú sin código

1. Entra a `/admin` → **Menú y Productos**.
2. Cambia precios, fotos, sabores o crea categorías/productos.
3. La web se actualiza al recargar (el pedido reporta el `productId` real para el stock).

## Agente impresor (opcional)

En la PC del local con la ticketera:

```bash
cd print-agent
set API_URL=https://TU-DOMINIO.com
set AGENT_TOKEN=<el mismo del .env>
node agent.js
```

Imprime cada pedido que entra al estado *en cola*. Guía completa en `print-agent/README.md`.

## Scripts útiles

```bash
# Regenerar variantes WebP de las imágenes (tras agregar fotos)
NODE_PATH=<ruta a node_modules> node scripts/optimize-images.js

# Local (sin Docker): necesita PostgreSQL y las variables de entorno
cd nexo-api && npm install && node src/server.js
```