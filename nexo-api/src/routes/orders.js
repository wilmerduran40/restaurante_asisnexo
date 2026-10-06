'use strict';

const express = require('express');
const { query } = require('../db');
const { validateOrderPayload } = require('../validate');
const { requireAdmin, requireAgent, requireRole } = require('../auth');
const { rateLimit, requireOrderToken } = require('../rateLimit');
const { wrap } = require('../http');
const { getPendingExtras } = require('./printers');
const { getDeliveryConfig, calcDelivery } = require('../delivery');
const {
  withTransaction,
  computeRequired,
  consumeStock,
  restoreOrderStock,
} = require('../inventory');

const router = express.Router();

const STATUSES = new Set([
  'nuevo',
  'pago_confirmado',
  'en_cola',
  'impreso',
  'completado',
  'cancelado',
]);

const PAYMENT_METHODS = new Set([
  'A convenir',
  'Pago Móvil',
  'Nequi',
  'Zelle',
  'Transferencia Bancaria',
  'Efectivo (Divisas)',
  'Punto de Venta',
]);

function mapRow(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    address: row.address,
    gmapsUrl: row.gmaps_url,
    phone: row.phone,
    source: row.source,
    waiter: row.waiter,
    tableNo: row.table_no,
    deliveryType: row.delivery_type,
    paymentMethod: row.payment_method,
    total: Number(row.total),
    receipt: row.receipt || null,
    pmRef: row.pm_ref || null,
    pmAmount: row.pm_amount === null || row.pm_amount === undefined ? null : Number(row.pm_amount),
    deliveryFee: row.delivery_fee === null || row.delivery_fee === undefined ? null : Number(row.delivery_fee),
    distanceKm: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
    coords: row.coords || null,
    items: row.items,
    status: row.status,
    paidAt: row.paid_at,
    printedAt: row.printed_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    kitchenReadyAt: row.kitchen_ready_at || null,
  };
}

async function getOrder(id) {
  const { rows } = await query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows.length ? rows[0] : null;
}

// Regla de impresión del servidor: pickup/local siempre; delivery solo con pago.
// Acepta tanto el row crudo de PostgreSQL (snake_case) como el objeto mapeado (camelCase).
function canPrintRule(order) {
  if (order.status === 'cancelado' || order.status === 'completado') {
    return { ok: false, error: `No se puede imprimir un pedido ${order.status}.` };
  }
  const isDelivery = order.deliveryType === 'delivery' || order.delivery_type === 'delivery';
  const paid = order.paidAt || order.paid_at;
  if (isDelivery && !paid) {
    return { ok: false, error: 'Delivery requiere pago confirmado antes de imprimir.' };
  }
  return { ok: true };
}

const INSERT_COLS = `(name, address, gmaps_url, phone, source, waiter, table_no, delivery_type,
                     payment_method, total, items, status, delivery_fee, distance_km, coords,
                     receipt, pm_ref, pm_amount)`;

// Subtotal de los items (sin envío).
function subtotal(order) {
  return order.items.reduce((s, it) => s + (it.qty * it.unitPrice), 0);
}

// Envío autoritativo calculado por el servidor a partir de las coordenadas del cliente
// y la configuración de zonas/lluvia. Para pickup/local (o sin coords) fee = 0.
async function computeDelivery(order) {
  if (order.deliveryType !== 'delivery') {
    return { fee: 0, distanceKm: null };
  }
  const config = await getDeliveryConfig();
  const est = calcDelivery(order.coords, config);
  return { fee: est.fee, distanceKm: est.distanceKm };
}

// Inserta el pedido y descuenta stock en la misma transacción. El stock se
// descuenta de forma informativa (puede quedar negativo); nunca bloquea el
// pedido por falta de ingredientes: la producción se registra en total.
async function createOrderWithStock(order, delivery, meta) {
  const total = Math.round((subtotal(order) + delivery.fee) * 100) / 100;
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO orders ${INSERT_COLS}
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'nuevo',$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        order.name,
        order.address,
        order.gmapsUrl,
        order.phone,
        meta.source,
        meta.waiter,
        meta.tableNo,
        order.deliveryType,
        order.paymentMethod,
        total,
        JSON.stringify(order.items),
        delivery.fee,
        delivery.distanceKm,
        order.coords ? JSON.stringify(order.coords) : null,
        order.receipt || null,
        order.pmRef || null,
        order.pmAmount === undefined || order.pmAmount === null ? null : order.pmAmount,
      ]
    );
    const created = rows[0];

    const { required } = await computeRequired(order.items);
    await consumeStock(required, created.id, client);
    return created;
  });
}

// ---------------------------------------------------------------------------
// C (cliente web) — POST /api/order
// ---------------------------------------------------------------------------
router.post('/order', rateLimit({ windowMs: 60000, max: 5 }), requireOrderToken,
  wrap(async (req, res) => {
    const { errors, order } = await validateOrderPayload(req.body, { source: 'web' });
    if (errors.length) {
      return res.status(400).json({ error: 'Datos inválidos.', details: errors });
    }
    const delivery = await computeDelivery(order);
    let created;
    try {
      created = await createOrderWithStock(order, delivery, { source: 'web', waiter: null, tableNo: null });
    } catch (err) {
      if (err.status === 409) {
        return res.status(409).json({ error: err.message, details: err.data });
      }
      throw err;
    }
    res.status(201).json(mapRow(created));
  })
);

// ---------------------------------------------------------------------------
// C (mesero / POS) — POST /api/orders
// ---------------------------------------------------------------------------
router.post('/orders', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const { errors, order } = await validateOrderPayload(req.body, { source: 'mesero' });
    if (errors.length) {
      return res.status(400).json({ error: 'Datos inválidos.', details: errors });
    }
    order.waiter = req.user.username;
    const delivery = await computeDelivery(order);
    let created;
    try {
      created = await createOrderWithStock(order, delivery, {
        source: 'mesero',
        waiter: req.user.username,
        tableNo: order.tableNo,
      });
    } catch (err) {
      if (err.status === 409) {
        return res.status(409).json({ error: err.message, details: err.data });
      }
      throw err;
    }
    // Todo pedido tomado por un mesero (POS) va directo a cocina e impresión:
    // se pasa a 'en_cola' sin importar el tipo de entrega ni el estado de pago.
    // Los pedidos web siguen entrando en 'nuevo' y solo se envían al confirmar
    // el pago o al pulsar "Imprimir" (ver POST /api/orders/:id/pay y /print).
    // `printNow` se acepta por compatibilidad con el frontend, pero ya no cambia
    // el comportamiento.
    await setStatus(created.id, 'en_cola');
    const reloaded = await getOrder(created.id);
    res.status(201).json(mapRow(reloaded));
  })
);

// ---------------------------------------------------------------------------
// R Admin — GET /api/orders (filtros + búsqueda + paginación)
// ---------------------------------------------------------------------------
router.get('/orders', requireAdmin,
  wrap(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    let idx = 1;

    if (req.query.status) {
      const statuses = String(req.query.status)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => STATUSES.has(s));
      if (statuses.length) {
        where.push(`status = ANY($${idx++})`);
        params.push(statuses);
      }
    }
    if (req.query.source) {
      const src = String(req.query.source).trim();
      if (src === 'web' || src === 'mesero') {
        where.push(`source = $${idx++}`);
        params.push(src);
      }
    }
    if (req.query.payment) {
      where.push(`payment_method ILIKE $${idx++}`);
      params.push(`%${req.query.payment}%`);
    }
    if (req.query.table) {
      const t = Number(req.query.table);
      if (Number.isInteger(t) && t >= 1) {
        where.push(`table_no = $${idx++}`);
        params.push(t);
      }
    }
    if (req.query.from) {
      where.push(`created_at >= $${idx++}`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      where.push(`created_at <= $${idx++}`);
      params.push(req.query.to);
    }
    if (req.query.q) {
      const q = `%${req.query.q}%`;
      where.push(
        `(name ILIKE $${idx} OR COALESCE(phone,'') ILIKE $${idx} OR
           COALESCE(waiter,'') ILIKE $${idx} OR address ILIKE $${idx} OR id::text ILIKE $${idx} OR
           COALESCE(table_no::text,'') ILIKE $${idx})`
      );
      params.push(q);
      idx += 1;
    }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countRes = await query(`SELECT count(*)::int AS total FROM orders ${whereSql}`, params);
    const total = countRes.rows[0].total;

    const { rows } = await query(
      `SELECT * FROM orders ${whereSql} ORDER BY created_at DESC, id DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      orders: rows.map(mapRow),
    });
  })
);

// ---------------------------------------------------------------------------
// R Cola impresora (agente) — GET /api/orders/pending
// Incluye además la config global de la impresora y, si el panel lo pidió,
// la señal de escaneo / prueba de impresión.
// ---------------------------------------------------------------------------
router.get('/orders/pending', requireAgent,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM orders WHERE status = 'en_cola' ORDER BY created_at ASC, id ASC`
    );
    const extras = await getPendingExtras();
    res.json({ orders: rows.map(mapRow), ...extras });
  })
);

// ---------------------------------------------------------------------------
// R Vista en vivo (panel) — GET /api/orders/live
// Admin y meseros ven los pedidos activos en tiempo real.
// ---------------------------------------------------------------------------
router.get('/orders/live', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    // Además de los pedidos activos, incluye los que cocina marcó listos aunque
    // ya estén impresos: así el mesero los ve en En vivo para entregarlos.
    const { rows } = await query(
      `SELECT * FROM orders
       WHERE status IN ('nuevo','pago_confirmado','en_cola')
          OR (kitchen_ready_at IS NOT NULL AND status NOT IN ('completado','cancelado'))
       ORDER BY created_at DESC, id DESC LIMIT 100`
    );
    res.json({ orders: rows.map(mapRow) });
  })
);

// ---------------------------------------------------------------------------
// R Tablero de cocina (KDS) — GET /api/orders/kitchen
// Devuelve las comandas ya enviadas a cocina (en cola o impresas) y aún no
// completadas/anuladas, en orden FIFO. Incluye kitchenReadyAt para que el panel
// separe "En preparación" de "Listas".
// ---------------------------------------------------------------------------
router.get('/orders/kitchen', requireRole('admin', 'cocina'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT * FROM orders
       WHERE status IN ('en_cola','impreso')
       ORDER BY created_at ASC, id ASC LIMIT 200`
    );
    res.json({ orders: rows.map(mapRow) });
  })
);

// ---------------------------------------------------------------------------
// R Aviso "listo" — GET /api/orders/ready
// Pedidos activos que cocina marcó como listos. Lo consulta el panel de
// admin/mesero para avisar (badge + sonido) que la comida está lista.
// ---------------------------------------------------------------------------
router.get('/orders/ready', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT id, name, table_no, delivery_type, kitchen_ready_at
       FROM orders
       WHERE kitchen_ready_at IS NOT NULL
         AND status NOT IN ('completado','cancelado')
       ORDER BY kitchen_ready_at ASC, id ASC LIMIT 100`
    );
    res.json({
      orders: rows.map((r) => ({
        id: r.id,
        name: r.name,
        tableNo: r.table_no,
        deliveryType: r.delivery_type,
        kitchenReadyAt: r.kitchen_ready_at,
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// R Detalle — GET /api/orders/:id
// ---------------------------------------------------------------------------
router.get('/orders/:id', requireAdmin,
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    res.json(mapRow(row));
  })
);

// ---------------------------------------------------------------------------
// U Pago — POST /api/orders/:id/pay
// ---------------------------------------------------------------------------
router.post('/orders/:id/pay', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'cancelado') {
      return res.status(409).json({ error: 'No se puede pagar un pedido anulado.' });
    }
    if (row.paid_at) {
      return res.json(mapRow(row));
    }
    // Confirmar el pago envía el pedido a cocina (en_cola) si aún no se envió.
    // Un pedido ya entregado (completado) o ya en cocina (en_cola/impreso)
    // conserva su estado: solo se registra el pago sin reimprimir ni sacarlo
    // de la cola de preparación.
    const { rows } = await query(
      `UPDATE orders
       SET paid_at = COALESCE(paid_at, now()),
           status = CASE
             WHEN status IN ('completado','cancelado','en_cola','impreso') THEN status
             ELSE 'en_cola'
           END
       WHERE id=$1 RETURNING *`,
      [row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// U Método de pago — POST /api/orders/:id/payment
// El admin puede asignar/corregir el método de pago de un pedido activo
// (p. ej. los que quedaron "A convenir") desde la vista En vivo.
// ---------------------------------------------------------------------------
router.post('/orders/:id/payment', requireAdmin,
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'cancelado' || row.status === 'completado') {
      return res.status(409).json({ error: `No se puede editar el pago de un pedido ${row.status}.` });
    }
    const payment = req.body && req.body.payment !== undefined && req.body.payment !== null
      ? String(req.body.payment).trim().slice(0, 60)
      : '';
    if (!PAYMENT_METHODS.has(payment)) {
      return res.status(400).json({ error: 'Método de pago inválido.', methods: [...PAYMENT_METHODS] });
    }
    const { rows } = await query(
      `UPDATE orders SET payment_method=$1 WHERE id=$2 RETURNING *`,
      [payment, row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// U Impresión — POST /api/orders/:id/print
// ---------------------------------------------------------------------------
router.post('/orders/:id/print', requireAdmin,
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });

    const rule = canPrintRule(row);
    if (!rule.ok) return res.status(403).json({ error: rule.error });

    const { rows } = await query(
      `UPDATE orders SET status='en_cola', printed_at=NULL, kitchen_ready_at=NULL WHERE id=$1 RETURNING *`,
      [row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// U Confirmar impresión (agente) — POST /api/orders/:id/ack
// ---------------------------------------------------------------------------
router.post('/orders/:id/ack', requireAgent,
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'impreso') return res.json(mapRow(row)); // idempotente
    if (row.status !== 'en_cola') {
      return res.status(409).json({ error: `Estado inesperado del agente: ${row.status}.` });
    }
    const { rows } = await query(
      `UPDATE orders SET status='impreso', printed_at=now() WHERE id=$1 RETURNING *`,
      [row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// U Completado — POST /api/orders/:id/complete
// ---------------------------------------------------------------------------
router.post('/orders/:id/complete', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'completado') return res.json(mapRow(row));
    if (row.status === 'cancelado') {
      return res.status(409).json({ error: 'No se puede completar un pedido anulado.' });
    }
    const { rows } = await query(
      `UPDATE orders SET status='completado', completed_at=now() WHERE id=$1 RETURNING *`,
      [row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// U Cocina lista — POST /api/orders/:id/kitchen-ready
// La cocina (o admin) marca/desmarca el pedido como listo. No cambia el estado
// de caja: solo setea/limpia kitchen_ready_at para el KDS y el aviso al mesero.
// ---------------------------------------------------------------------------
router.post('/orders/:id/kitchen-ready', requireRole('admin', 'cocina'),
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'completado' || row.status === 'cancelado') {
      return res.status(409).json({ error: `No se puede marcar un pedido ${row.status}.` });
    }
    const ready = !(req.body && req.body.ready === false);
    const { rows } = await query(
      `UPDATE orders SET kitchen_ready_at = $1 WHERE id = $2 RETURNING *`,
      [ready ? new Date() : null, row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// U Reimpresión — POST /api/orders/:id/reprint
// ---------------------------------------------------------------------------
router.post('/orders/:id/reprint', requireAdmin,
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'en_cola') return res.json(mapRow(row)); // ya está en cola
    if (row.status !== 'impreso') {
      return res.status(409).json({ error: 'Solo se puede reimprimir un pedido ya impreso.' });
    }
    const rule = canPrintRule(row);
    if (!rule.ok) return res.status(403).json({ error: rule.error });

    const { rows } = await query(
      `UPDATE orders SET status='en_cola', printed_at=NULL, kitchen_ready_at=NULL WHERE id=$1 RETURNING *`,
      [row.id]
    );
    res.json(mapRow(rows[0]));
  })
);

// ---------------------------------------------------------------------------
// D (soft) — POST /api/orders/:id/cancel
// ---------------------------------------------------------------------------
router.post('/orders/:id/cancel', requireAdmin,
  wrap(async (req, res) => {
    const row = await getOrder(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (row.status === 'cancelado') return res.json(mapRow(row));
    if (row.status === 'completado') {
      return res.status(409).json({ error: 'No se puede anular un pedido completado.' });
    }
    const { rows } = await query(
      `UPDATE orders SET status='cancelado', cancelled_at=now() WHERE id=$1 RETURNING *`,
      [row.id]
    );
    // Restaura el stock consumido por el pedido (si corresponde).
    try {
      await restoreOrderStock(rows[0]);
    } catch (err) {
      console.error('[inventory] error restaurando stock del pedido #' + row.id + ':', err.message);
    }
    res.json(mapRow(rows[0]));
  })
);

async function setStatus(id, status) {
  await query('UPDATE orders SET status=$1 WHERE id=$2', [status, id]);
}

module.exports = router;