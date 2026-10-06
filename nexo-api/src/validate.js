'use strict';

const { query } = require('./db');

function asString(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return max ? s.slice(0, max) : s;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Valida el payload común de un pedido (web: POST /api/order, mesero: POST /api/orders).
// Devuelve { errors: [], order: {...} } con los campos ya normalizados para insertar.
async function validateOrderPayload(body, { source = 'web' } = {}) {
  const errors = [];
  const order = {};

  order.name = asString(body.name, 120);
  if (!order.name) errors.push('El campo "name" es obligatorio.');

  order.address = asString(body.address, 300);
  if (!order.address) errors.push('El campo "address" es obligatorio.');

  order.gmapsUrl = asString(body.gmapsUrl, 400) || null;

  order.phone = asString(body.phone, 40) || null;

  order.deliveryType = asString(body.deliveryType, 20);
  if (!['delivery', 'pickup', 'local'].includes(order.deliveryType)) {
    errors.push('"deliveryType" debe ser delivery, pickup o local.');
  }

  order.paymentMethod = asString(body.payment, 60) || 'A convenir';

  // Comprobante de pago (URL de la imagen subida vía POST /api/receipt).
  // Opcional: si el método es digital el frontend lo exige, pero el servidor
  // lo acepta siempre como dato de apoyo para la verificación.
  order.receipt = asString(body.receipt, 400) || null;

  // Pago Móvil: referencia + monto en Bs. Base para la automatización futura
  // (cruce con los SMS del banco). Se aceptan solo dígitos en la ref y un
  // número >= 0 en el monto.
  order.pmRef = null;
  order.pmAmount = null;
  if (body.pmRef !== undefined && body.pmRef !== null && body.pmRef !== '') {
    const ref = String(body.pmRef).replace(/[^0-9]/g, '');
    if (ref.length < 6) {
      errors.push('"pmRef" debe tener al menos 6 dígitos.');
    } else {
      order.pmRef = ref;
    }
  }
  if (body.pmAmount !== undefined && body.pmAmount !== null && body.pmAmount !== '') {
    const amt = asNumber(body.pmAmount);
    if (amt === null || amt < 0) {
      errors.push('"pmAmount" debe ser un número >= 0.');
    } else {
      order.pmAmount = Math.round(amt * 100) / 100;
    }
  }

  // El waiter se toma del username de la sesión en el ruteador (POST /api/orders),
  // nunca del body del cliente.

  // Mesa del local: obligatoria cuando el mesero toma un pedido 'local'. Se valida
  // contra la tabla `tables` (mesa existente y activa). Los pedidos web y otros
  // tipos de entrega no usan mesa (se guarda null).
  order.tableNo = null;
  if (source === 'mesero' && order.deliveryType === 'local') {
    if (body.tableNo !== undefined && body.tableNo !== null && body.tableNo !== '') {
      const n = Number(body.tableNo);
      if (!Number.isInteger(n) || n <= 0) {
        errors.push('"tableNo" debe ser un número de mesa positivo.');
      } else {
        const { rows } = await query(
          'SELECT no, name, active FROM tables WHERE no = $1',
          [n]
        );
        const mesa = rows[0];
        if (!mesa) {
          errors.push(`La mesa ${n} no existe.`);
        } else if (!mesa.active) {
          errors.push(`La mesa ${n} (${mesa.name}) está desactivada.`);
        } else {
          order.tableNo = n;
        }
      }
    }
    if (order.tableNo === null) {
      errors.push('Selecciona una mesa para pedidos del local.');
    }
  }

  if (source === 'mesero' && order.deliveryType === 'delivery') {
    if (!order.name) errors.push('El cliente es obligatorio para delivery.');
    if (!order.phone) errors.push('El teléfono del cliente es obligatorio para delivery.');
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    errors.push('El pedido debe tener al menos un item.');
  } else {
    order.items = [];
    for (const it of items) {
      const name = asString(it.name, 150);
      const qty = Number(it.qty);
      const unitPrice = Number(it.unitPrice);
      if (!name || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        errors.push('Cada item requiere name, qty (entero > 0) y unitPrice (>= 0).');
        break;
      }
      order.items.push({
        name,
        qty,
        unitPrice,
        productId: asString(it.productId, 40) || null,
        variant: asString(it.variant, 100) || null,
        removed: Array.isArray(it.removed) ? it.removed.map((r) => asString(r, 100)).filter(Boolean) : [],
        extras: Array.isArray(it.extras)
          ? it.extras.map((e) => ({
              name: asString(e.name, 100),
              price: Number(e.price) || 0,
            })).filter((e) => e.name)
          : [],
        notes: asString(it.notes, 400) || null,
        // Para identificar cada comida dentro de un mismo pedido (varias órdenes
        // en la misma bolsa) y separar los items "para llevar" de una mesa.
        takeaway: it.takeaway === true,
        label: asString(it.label, 60) || null,
        orden: (Number.isInteger(Number(it.orden)) && Number(it.orden) > 0) ? Number(it.orden) : null,
      });
    }
  }

  const total = asNumber(body.total);
  if (total === null || total < 0) {
    errors.push('El campo "total" debe ser un número >= 0.');
  } else {
    order.total = total;
  }

  // Coordenadas del cliente (opcionales): con ellas el servidor calcula el envío.
  order.coords = null;
  if (body.coords && typeof body.coords === 'object') {
    const lat = Number(body.coords.lat);
    const lng = Number(body.coords.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      order.coords = { lat, lng };
    }
  }

  // El servidor recalcula el envío de forma autoritativa; estos campos solo se usan
  // como referencia/auditoría de lo que el cliente vio al confirmar.
  order.deliveryFee = asNumber(body.deliveryFee);
  if (order.deliveryFee === null || order.deliveryFee < 0) order.deliveryFee = 0;
  order.distanceKm = asNumber(body.distanceKm);

  return { errors, order };
}

module.exports = { validateOrderPayload };