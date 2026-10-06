# Plan de implementación — Verificación automática de Pago Móvil vía SMS

> **Estado:** planificado, pendiente de implementar.
> **Alcance aceptado:** validación del pago en el checkout web (`menu.html`) al hacer el pedido, cruzando referencia + monto contra el SMS recibido del banco (reenviado por SMS Forwarder). El pago no verificado queda `nuevo` y se confirma manualmente en el panel (respaldo).

## 1. Objetivo

Validar que el pago móvil de un cliente sea real al momento de hacer el pedido: la **referencia** y el **monto** que ingresa el cliente deben coincidir con el SMS que el banco envía al teléfono del negocio cuando se acredita el pago.

Para eso, un teléfono Android del negocio (con la SIM que recibe las alertas del banco) corre la app **SMS Forwarder**, que reenvía cada SMS del banco a un webhook de la API. La API parsea referencia + monto, los guarda, y los cruza contra los pedidos con "Pago Móvil".

**Decisiones tomadas** (confirmadas con el cliente):

| Decisión | Valor |
|---|---|
| Comparación del monto | Se guarda la **tasa USD→Bs** en `settings` y se calcula el Bs esperado del total USD del pedido |
| Captura de la referencia/monto | En el **checkout web** (menu.html) cuando el método es "Pago Móvil" |
| Pago no verificable al enviar | El pedido se crea **`nuevo`** y el admin lo confirma a mano en el panel (respaldo ante SMS demorados) |
| Banco / formato del SMS | **Banco de Venezuela (0102)** — app PagomovilBDV. Formato real recibido: |
| | `Recibiste un PagomovilBDV por Bs.100,00 del 0412-5284595 Ref: 062700422744 en fecha 27-09-26 hora: 19:27` |

## 2. Formato del SMS (Banco de Venezuela)

Muestra real (la que llega a la app BDV):

```
Recibiste un PagomovilBDV por Bs.100,00 del 0412-5284595 Ref: 062700422744 en fecha 27-09-26 hora: 19:27
```

- **Monto (Bs):** `Bs.100,00` — decimal con coma; separador de miles con punto (`Bs.1.500,00`).
- **Referencia:** `Ref: 062700422744` — 12 dígitos, única por transacción (clave del match).
- **Teléfono del pagador:** `0412-5284595` (opcional, se puede guardar como apoyo).
- **Fecha/hora:** vienen en el texto, pero `receivedAt` del SMS Forwarder es más confiable.

### Regex del parser (`src/pagosmovil.js`)

```js
// Monto en Bs (acepta "100,00" y "1.500,00")
/por\s*Bs\.?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?)/i

// Referencia (6+ dígitos tras "Ref:")
/Ref\s*:?\s*([0-9]{6,})/i

// Normalización del monto: quitar puntos de miles, coma -> punto
// "1.500,00" -> 1500.00 ; "100,00" -> 100.00
```

## 3. Arquitectura y flujo

### 3.1 Recepción del SMS

```
Teléfono negocio (SIM banco) --SMS Forwarder--> POST /api/sms/webhook
                                                (header x-sms-token: SMS_TOKEN)
     -> parsear ref + monto (pagosmovil.js)
     -> guardar en incoming_sms (idempotente por idempotency_key)
     -> intentar matchear pedidos 'nuevo' pendientes con esa ref (auto-confirmar)
```

### 3.2 Pedido web (checkout)

```
Cliente: Pago Móvil -> paga -> escribe Referencia + Monto (Bs)
    -> POST /api/order { ..., pmRef, pmAmount }
    -> ¿existe incoming_sms con parsed_ref = pmRef
       y parsed_amount ≈ pmAmount (tol ±1 Bs)
       y parsed_amount ≈ totalUSD × tasa (tol ±2%)?
            sí  -> status 'pago_confirmado', paid_at=now(), paymentVerified: true
            no  -> status 'nuevo', paymentVerified: false (confirmación manual)
    -> respuesta incluye paymentVerified
```

### 3.3 Match en ambas direcciones

- **SMS llega después del pedido:** el webhook busca pedidos `nuevo` con `pm_ref` = ref parseada y monto dentro de tolerancia → los confirma.
- **SMS llegó antes del pedido:** al crear el pedido con `pmRef`, se busca el SMS ya guardado → se confirma al vuelo.

## 4. Cambios por archivo

| Archivo | Cambio |
|---|---|
| `db/migrations/010_add_pago_movil.sql` | tabla `incoming_sms` + columnas `orders.pm_ref` / `orders.pm_amount` |
| `src/pagosmovil.js` (nuevo) | parser del SMS BDV (ref + monto) + normalización del monto Bs |
| `src/routes/sms.js` (nuevo) | webhook `POST /api/sms/webhook`: auth por `x-sms-token`, rate limit, idempotencia, parseo, guardado, match inverso de pedidos `nuevo` |
| `src/server.js` | montar `sms.js` en `/api` |
| `src/validate.js` | aceptar `pmRef` (solo dígitos) y `pmAmount` (Bs) cuando el método es "Pago Móvil"; guardarlos como `pm_ref` / `pm_amount` |
| `src/routes/orders.js` | en `POST /api/order` y `POST /api/orders`: si es Pago Móvil con `pmRef`, intentar match → auto-confirmar; devolver `paymentVerified` en la respuesta |
| `src/routes/admin.js` | GET/POST de la tasa `usd_bs_rate` (persistida en `settings`, patrón de `delivery.js`) |
| `src/routes/products.js` | `GET /api/client-config` expone `usdBsRate` (menu.html ya consume este endpoint) |
| `menu.html` | al elegir Pago Móvil: campos "N° de referencia" y "Monto pagado (Bs)" + pista `≈ Bs X`; incluirlos en el payload y en el mensaje de WhatsApp; aviso si `paymentVerified: false` |
| `panel.html` | sección de ajustes con la tasa USD→Bs; tarjetas/detalle de pedido muestran ref, monto y verificación automática; el botón "Confirmar pago" sigue como respaldo |
| `.env.example`, `docker-compose.yml` | nueva variable `SMS_TOKEN` (secreto del webhook) |
| `plans/` + doc | guía de instalación del SMS Forwarder (regla, remitente, body regex, header, primer plano/batería) |

### 4.1 Esquema de la migración

```sql
CREATE TABLE IF NOT EXISTS incoming_sms (
  id SERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  sender TEXT,
  body TEXT,
  parsed_ref TEXT,
  parsed_amount NUMERIC(12,2),
  received_at TIMESTAMPTZ,
  matched_order_id INTEGER REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN pm_ref TEXT;
ALTER TABLE orders ADD COLUMN pm_amount NUMERIC(12,2);

-- tasa USD->Bs se guarda en settings (key 'usd_bs_rate'), patrón delivery.js
```

### 4.2 Tolerancias del monto

- `SMS.monto` vs `pmAmount` del cliente: **±1 Bs** (los bancos pueden redondear céntimos).
- `SMS.monto` vs `total USD × tasa`: **±2%** (la tasa del día puede variar ligeramente; evita falsos rechazos).
- Tolerancias configurables como constantes del módulo.

## 5. SMS Forwarder — configuración del lado del negocio

1. Instalar la app en el Android del negocio que tiene la SIM que recibe los SMS del banco.
2. Crear una regla de reenvío:
   - Remitente: el número/nombre del banco (BDV / PagomovilBDV).
   - Body regex: `Recibiste un PagomovilBDV` (y/o `Ref:`).
   - Destino: webhook `https://<dominio>/api/sms/webhook` con header `x-sms-token: <SMS_TOKEN>`.
3. Mantener el **servicio en primer plano** y excluir la app de la optimización de batería (Android puede matar tareas en segundo plano y perder SMS).

## 6. Casos borde

| Caso | Comportamiento |
|---|---|
| El SMS llega antes que el pedido | El pedido se auto-confirma al crearse |
| El SMS llega después del pedido | El webhook matchea el pedido `nuevo` pendiente y lo confirma |
| El SMS nunca llega (demora/fallo) | Pedido queda `nuevo`; el admin lo confirma a mano |
| Ref existe pero monto no coincide | Sin match → `nuevo`; se registra en `incoming_sms` el motivo (revisar en el panel) |
| Referencia duplicada / reenvío del SMS | `idempotency_key` único en `incoming_sms` (SMS Forwarder lo envía); el match es idempotente |
| Cliente escribe mal la ref | No hay SMS con esa ref → `nuevo` |
| Pago móvil de otro banco al BDV | El parser es genérico (patrón BDV + fallback genérico `Bs.`/`Ref:`); se calibra con el primer SMS real |
| Total en USD sin tasa configurada | El check de tasa se omite; solo se validan ref + monto del cliente vs SMS |

## 7. Verificación

1. `docker compose up -d` → aplicar migración.
2. Configurar `SMS_TOKEN` en `.env` y `docker-compose.yml`.
3. En el panel, cargar la tasa USD→Bs.
4. Enviar un SMS de prueba al webhook (curl con `x-sms-token`) con el formato real → debe quedar en `incoming_sms` parseado.
5. Crear un pedido web con Pago Móvil usando esa misma ref + monto → debe quedar `pago_confirmado` automáticamente y la respuesta traer `paymentVerified: true`.
6. Crear otro pedido con ref inexistente → queda `nuevo` y el admin lo confirma manualmente.
7. SMS que llega después del pedido → el pedido `nuevo` correspondiente se confirma solo.
8. Reenviar el mismo SMS (misma `idempotencyKey`) → no se duplica.