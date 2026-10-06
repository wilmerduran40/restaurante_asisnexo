# Plan de implementación — Modal de upsell "Finalizar Pedido" (bebida antes del pago)

> **Estado:** planificado, pendiente de implementar.
> **Alcance aceptado:** solo el carrito web (`menu.html`). El POS del mesero (`nexo-api/public/panel.html`) queda fuera.

## 1. Objetivo

Aprovechar el momento de mayor intención de compra — cuando el cliente ya tiene el pedido armado y la tarjeta en la mano para pagar — para ofrecer una bebida con un modal central, highly visual, de un solo tap. Es el equivalente digital del "¿no te falta algo para tomar?" del mesero en el mostrador.

Convertir el botón de checkout en **"Finalizar Pedido"**: el primer click abre el modal de bebidas; el CTA del modal (o el "seguir sin bebida") ejecuta el envío real a WhatsApp.

**Cero cambios en backend.** Los items se agregan al carrito normal, así que viajan al `POST /api/order` con su `productId` real y el backend descuenta inventario igual que con cualquier plato (`nexo-api/src/routes/orders.js:96`, `createOrderWithStock`).

## 2. Flujo resultante

```
Carrito → [Finalizar Pedido] → modal de bebidas (solo si el carrito no tiene bebida)
                                ├─ tap en una bebida → suma al carrito (modal sigue abierto)
                                └─ "Continuar" / "No, gracias"
                                        └─ doSendOrder() → POST /api/order + WhatsApp
```

## 3. Decisiones tomadas

| Decisión | Valor | Motivo |
|---|---|---|
| Punto de entrada | Renombrar el botón a "Finalizar Pedido" y modular el envío | Un solo CTA; el upsell no se puede saltar sin esfuerzo |
| Ofertas | Catálogo real de bebidas, data-driven | Precio, imagen y stock reales; `productId` correcto para el inventario del backend |
| Frecuencia | Solo si el carrito no tiene bebida; 1 vez por sesión | Evita la sensación de insistencia |
| Alcance | Solo `menu.html` | El POS ya cobra en caja y tiene su propio carrito |

## 4. Cambios en `css/menu.css`

Al final del archivo, antes del bloque `prefers-reduced-motion` de la línea 106.

- **`.upsell-pop`** — entrada con `scale(.92) → 1` + fade, `0.35s cubic-bezier(.34,1.56,.64,1)`. El `scale` del código de referencia, que `.slide-up` (línea 10) no tiene.
- **`.upsell-added`** — estado de la opción ya agregada: anillo dorado, opacidad reducida y badge "✓ En tu pedido".
- **Animación de entrada escalonada** de las tarjetas (delay por índice, como el stagger de `renderCartItems`).
- **Registrar `.upsell-pop` / `.upsell-added` en el bloque `prefers-reduced-motion`** para no romper la accesibilidad.

## 5. Cambios en `menu.html`

### 5.1 Markup — bloque nuevo

Insertar **después de la línea 357** (cierra `#cart-panel`) y antes de `#ios-location-modal` (línea 359).

```html
<!-- Modal de upsell: bebida antes del pago -->
<div id="upsell-modal" class="fixed inset-0 z-[65] hidden flex items-end md:items-center justify-center md:p-4" role="dialog" aria-modal="true" aria-labelledby="upsell-title">
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" id="upsell-backdrop"></div>

    <div id="upsell-card" class="relative w-full md:max-w-md bg-white rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden upsell-pop">
        <div class="bg-gradient-to-r from-orange-500 to-orange-600 p-5 text-center text-white relative shrink-0">
            <button id="upsell-close" aria-label="Cerrar" class="absolute top-3 right-3 w-10 h-10 text-white/90 hover:text-white bg-black/15 hover:bg-black/25 rounded-full flex items-center justify-center transition-colors">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <div class="text-4xl mb-1"><i class="fa-solid fa-martini-glass-cheese"></i></div>
            <h2 id="upsell-title" class="text-xl font-bold">¡Espera! Tu pedido va sin bebida</h2>
            <p class="text-white/85 text-xs mt-1">Agrega una bebida y sigue con el pago.</p>
        </div>

        <div id="upsell-options" class="p-4 grid grid-cols-2 gap-3 overflow-y-auto"></div>

        <div class="border-t border-gray-100 p-4 shrink-0">
            <button id="upsell-skip" class="w-full text-center text-gray-500 hover:text-gray-800 font-medium text-sm transition-colors py-1">
                No, gracias. Continuar sin bebida.
            </button>
        </div>
    </div>
</div>
```

Notas:
- `z-[65]`: por encima del drawer del carrito (`z-50`) y del visor de imágenes (`z-[60]`), por debajo del modal iOS (`z-[70]`).
- `items-end md:items-center` → bottom-sheet en móvil, centrado en desktop.
- `max-h-[88vh]` + scroll interno para que el footer quede siempre alcanzable.
- El header usa `orange-*`, que en el `tailwind.config` (línea 54) **es** la paleta roja de marca (`#BF0B1A` / `#730710`). Sale rojo, no naranja.

### 5.2 JS — bloque nuevo junto al checkout (después de la línea 1600)

```js
const upsellModal = document.getElementById('upsell-modal');
const upsellBackdrop = document.getElementById('upsell-backdrop');
const upsellCloseBtn = document.getElementById('upsell-close');
const upsellOptions = document.getElementById('upsell-options');
const upsellSkipBtn = document.getElementById('upsell-skip');

const UPSELL_CATEGORY = 'bebidas';
const UPSELL_SKIP_KEY = 'nexo_upsell_skipped';
```

**`getUpsellProducts()`** — data-driven:
```js
menuData
  .filter(p => p.category === UPSELL_CATEGORY
            && p.price !== null
            && p.active !== false
            && productAvStatus(p).ok)
  .sort((a, b) => (b.popular ? 1 : 0) - (a.popular ? 1 : 0))
  .slice(0, 6)
```
> Nunca hardcodear bebidas como "Refresco $1.50" (como en el mock de referencia): un item sin `productId` real no descuenta inventario y el precio no cuadraría con el catálogo. Hoy hay 23 bebidas reales (merengadas, frozen) en `data/menu.js:721+`.

**`shouldShowUpsell()`** — las 5 condiciones:
1. `cart.length > 0`
2. `isOpenNow()`
3. El carrito **no** tiene ningún item de categoría `bebidas` (buscar por `productId` en `menuData`)
4. `!sessionStorage.getItem(UPSELL_SKIP_KEY)` → 1 vez por sesión
5. `getUpsellProducts().length > 0`

**`renderUpsellOptions()`** — tarjetas de bebida con `img` (+ `onerror` a `img/placeholder.svg`, como el resto del archivo), nombre, `+$precio`; botón `.upsell-card` con `data-product-id`; marca `aria-pressed="true"` + "En tu pedido" si ese producto ya está en el carrito; stagger de entrada.

**`addUpsellProduct(pid)`** — un tap = un item:
- Busca el producto; **re-valida** `productAvStatus(p).ok` en el momento del tap (si se agotó, `showToast(..., 'warning')` + re-render).
- Si ya existe una línea idéntica (mismo `productId`, sin `variant`, sin `removed`, sin `extras`, sin `notes`) → **incrementa `qty`** en vez de duplicar la línea.
- Si no, `cart.push` con la misma forma del objeto de la línea 1252: `{ id, productId, name, basePrice, unitPrice: p.price, variant: null, qty: 1, removed: [], extras: [], notes: '', img }`.
- Después: `updateCartUI()` + `animateCartIcon()` + `showToast(...)` + re-render de las opciones.
- **El modal sigue abierto** para que puedan meter 2 bebidas antes de pagar.

**`openUpsell()` / `closeUpsell(continueCheckout)`**:
- `openUpsell()`: guarda `document.activeElement`, quita `hidden`, re-renderiza opciones, enfoca `#upsell-close` (convención del archivo, línea 1168).
- `closeUpsell(false)`: cierra por backdrop, X o Escape.
- `closeUpsell(true)`: pone `sessionStorage.setItem(UPSELL_SKIP_KEY, '1')` y llama `doSendOrder()`.
- Restaura el foco a `sendWhatsappBtn` al cerrar.
- **No toca `document.body.style.overflow`**: el carrito ya lo tiene bloqueado (línea 1402) y el modal solo se abre desde el footer del carrito.

### 5.3 Refactor del checkout

**Markup (líneas 351-353):** el texto del botón pasa a **"Finalizar Pedido"**. Se conserva el id `#send-whatsapp-btn`, el icono y el verde de WhatsApp (el flujo sigue siendo WhatsApp; `renderCartItems` y el resto ya lo referencian por id, así que el diff se limita a una línea).

**JS (líneas 1465-1600):**
1. El cuerpo del listener actual se extrae **tal cual** a `function doSendOrder()`, sustituyendo `this` por la const `sendWhatsappBtn` (necesario porque ahora la dispara el CTA del modal). Cero cambios de lógica: mismos guards, mensaje de WhatsApp, spinner de 800 ms, `submitOrder()` antes de `window.open()` y la cola offline.
2. El listener queda así:
```js
sendWhatsappBtn.addEventListener('click', () => {
    if (cart.length === 0) return;
    if (!isOpenNow()) {
        showToast('Estamos cerrados. Atendemos de 4:00 PM a 12:00 AM, todos los días excepto los miércoles.', 'warning');
        return;
    }
    if (shouldShowUpsell()) { openUpsell(); return; }
    doSendOrder();
});
```
   `validateCheckout()` **se queda dentro** de `doSendOrder`, así los errores de formulario saltan después del upsell.
3. En el `setTimeout` de éxito, antes de `clearCart()`: `sessionStorage.removeItem(UPSELL_SKIP_KEY)` → el siguiente pedido tiene una nueva oportunidad.

### 5.4 Teclado y foco (líneas 1750-1769)

- **Escape:** agregar el upsell como **primera** rama, antes de `cartPanel`.
- **Tab:** agregar `trapFocus(upsellModal, e)` como primera rama, antes de `imageViewer` / `modal` / `cartPanel`.

### 5.5 Micro-fix recomendado (1 línea, riesgo bajo)

`id: Date.now().toString()` (línea 1253 y el nuevo add) puede colisionar con taps rápidos en el mismo milisegundo, y `updateCartItemQty` usa `findIndex`. Cambiar por:
```js
id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7)
```

## 6. Casos borde

| Caso | Comportamiento |
|---|---|
| Menú de la API aún en vuelo, o todas las bebidas agotadas | `getUpsellProducts()` vacío → se **salta** el modal y sigue al checkout. Nunca bloquea el pago |
| El carrito ya tiene una bebida | No se muestra |
| El cliente rechazó el upsell | `sessionStorage` → no reaparece en la misma visita |
| Bebida se agota entre el render y el tap | Re-validación en `addUpsellProduct` → toast de advertencia |
| Doble tap rápido en la misma bebida | Fusiona a `qty: 2`, no crea dos líneas |
| Item "Consultar" (`basePrice === null`) en el carrito | No afecta el subtotal; el upsell no lo altera |
| Conflicto 409 de stock al enviar | El toast y `loadAvailability()` que ya existen; el upsell se rearma por el paso 5.3.3 |
| Móvil | Bottom-sheet con scroll interno y footer siempre visible |

## 7. Verificación

1. `docker compose up -d` → abrir `menu.html`.
2. Agregar una hamburguesa → abrir el carrito → **"Finalizar Pedido"**: aparece el modal con 6 bebidas reales, con los precios del catálogo.
3. Tap en una: toast, tarjeta marcada "✓ En tu pedido", y el total del carrito detrás sube.
4. Tap otra vez en la misma: `qty 2` fusionado, sin línea duplicada.
5. "Continuar": abre WhatsApp con la bebida incluida y el pedido llega al panel con esa línea (también sale en el ticket de cocina).
6. Agregar primero una merengada y luego "Finalizar Pedido" → el modal **no** aparece.
7. Presionar "No, gracias", recargar y volver a finalizar → no reaparece en la misma sesión.
8. Agotar una bebida desde el panel → desaparece del modal.
9. Escape / X cierran sin enviar nada.
10. Tab cicla el foco dentro del modal y no se sale al carrito.
