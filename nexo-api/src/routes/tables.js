'use strict';

// CRUD de mesas del local.
//
// Antes las mesas eran fijas (1-12). Ahora viven en la tabla `tables` y el admin
// puede crear/editar/eliminar mesas desde el panel:
//
//   R      GET    /api/tables            (admin, mesero) listar con pedidos activos
//   C      POST   /api/tables            (admin) crear mesa
//   U      PUT    /api/tables/:no        (admin) editar mesa
//   D      DELETE /api/tables/:no        (admin) eliminar (solo sin pedidos activos)
//
// El GET mantiene la forma que esperaba el panel (`tables[].orders`) para no
// romper la pestaña Mesas.

const express = require('express');
const { query } = require('../db');
const { requireRole, requireAdmin } = require('../auth');
const { wrap } = require('../http');

const router = express.Router();

const TABLE_COLS = 'id, no, name, capacity, active, created_at, updated_at';

// Estados que cuentan como "pedido activo" en una mesa (mismos que usaba el
// GET /api/tables original).
const ACTIVE_TABLE_STATUSES = ['nuevo', 'pago_confirmado', 'en_cola', 'impreso'];

async function getTableByNo(no) {
  const { rows } = await query(`SELECT ${TABLE_COLS} FROM tables WHERE no = $1`, [no]);
  return rows[0] || null;
}

function bad(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

function notFound() {
  const err = new Error('Mesa no encontrada.');
  err.status = 404;
  throw err;
}

function sanitize(body, existing) {
  const cur = existing || { name: '', capacity: 1, active: true };
  const pick = (f, fallback) => (body && body[f] !== undefined ? body[f] : fallback);

  let no = existing ? existing.no : Number(pick('no', null));
  if (!Number.isInteger(no) || no <= 0) {
    bad('El número de mesa debe ser un entero positivo.');
  }

  let name = String(pick('name', cur.name)).trim();
  if (!name) name = 'Mesa ' + no;

  let capacity = Number(pick('capacity', cur.capacity));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    bad('La capacidad debe ser un entero entre 1 y 100.');
  }

  return {
    no,
    name: name.slice(0, 80),
    capacity,
    active: pick('active', cur.active) ? true : false,
  };
}

// ---------------------------------------------------------------------------
// R — GET /api/tables (admin, mesero)
// ---------------------------------------------------------------------------
router.get('/tables', requireRole('admin', 'mesero'),
  wrap(async (req, res) => {
    const tables = await query(`SELECT ${TABLE_COLS} FROM tables ORDER BY no ASC`);
    if (!tables.rows.length) {
      return res.json({ tables: [] });
    }
    // Un pedido entregado (completado) pero sin cobrar mantiene la mesa ocupada:
    // en un restaurante se cobra después de comer. La mesa se libera al pagarlo.
    const { rows } = await query(
      `SELECT * FROM orders
       WHERE delivery_type = 'local' AND table_no IS NOT NULL
         AND (status = ANY($1::text[]) OR (status = 'completado' AND paid_at IS NULL))
       ORDER BY table_no ASC, created_at ASC, id ASC`,
      [ACTIVE_TABLE_STATUSES]
    );
    const byTable = new Map();
    for (const row of rows) {
      if (!byTable.has(row.table_no)) byTable.set(row.table_no, []);
      byTable.get(row.table_no).push(mapOrder(row));
    }
    res.json({
      tables: tables.rows.map((t) => ({
        id: t.id,
        no: t.no,
        name: t.name,
        capacity: t.capacity,
        active: t.active,
        orders: byTable.get(t.no) || [],
      })),
    });
  })
);

function mapOrder(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    address: row.address,
    phone: row.phone,
    source: row.source,
    waiter: row.waiter,
    tableNo: row.table_no,
    deliveryType: row.delivery_type,
    paymentMethod: row.payment_method,
    total: Number(row.total),
    items: row.items,
    status: row.status,
    paidAt: row.paid_at,
    printedAt: row.printed_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    kitchenReadyAt: row.kitchen_ready_at || null,
  };
}

// ---------------------------------------------------------------------------
// C — POST /api/tables (admin)
// ---------------------------------------------------------------------------
router.post('/tables', requireAdmin, wrap(async (req, res) => {
  const t = sanitize(req.body, null);
  const existing = await getTableByNo(t.no);
  if (existing) {
    return res.status(409).json({ error: `Ya existe la mesa ${t.no} (${existing.name}).` });
  }
  const { rows } = await query(
    `INSERT INTO tables (no, name, capacity, active)
     VALUES ($1, $2, $3, $4)
     RETURNING ${TABLE_COLS}`,
    [t.no, t.name, t.capacity, t.active]
  );
  res.status(201).json({ table: rows[0] });
}));

// ---------------------------------------------------------------------------
// U — PUT /api/tables/:no (admin)
// ---------------------------------------------------------------------------
router.put('/tables/:no', requireAdmin, wrap(async (req, res) => {
  const no = Number(req.params.no);
  if (!Number.isInteger(no) || no <= 0) bad('Número de mesa inválido.');
  const existing = await getTableByNo(no);
  if (!existing) notFound();

  // Si se cambia el número, verifica que el nuevo no esté ocupado por otra mesa.
  const body = req.body || {};
  const newNo = Number(body.no !== undefined ? body.no : existing.no);
  if (Number.isInteger(newNo) && newNo > 0 && newNo !== no) {
    const clash = await getTableByNo(newNo);
    if (clash) {
      return res.status(409).json({ error: `Ya existe la mesa ${newNo} (${clash.name}).` });
    }
  }

  const t = sanitize(body, existing);
  const { rows } = await query(
    `UPDATE tables
     SET no = $1, name = $2, capacity = $3, active = $4, updated_at = now()
     WHERE id = $5
     RETURNING ${TABLE_COLS}`,
    [t.no, t.name, t.capacity, t.active, existing.id]
  );
  res.json({ table: rows[0] });
}));

// ---------------------------------------------------------------------------
// D — DELETE /api/tables/:no (admin)
// ---------------------------------------------------------------------------
router.delete('/tables/:no', requireAdmin, wrap(async (req, res) => {
  const no = Number(req.params.no);
  if (!Number.isInteger(no) || no <= 0) bad('Número de mesa inválido.');
  const existing = await getTableByNo(no);
  if (!existing) notFound();

  // No se puede borrar una mesa con pedidos activos (no dejaría historial consistente).
  const active = await query(
    `SELECT id FROM orders
     WHERE table_no = $1
       AND (status = ANY($2::text[]) OR (status = 'completado' AND paid_at IS NULL))
     LIMIT 1`,
    [no, ACTIVE_TABLE_STATUSES]
  );
  if (active.rows.length) {
    const err = new Error(
      `La mesa ${no} tiene pedidos activos. Entrégalos o anúlalos antes de eliminarla.`
    );
    err.status = 409;
    throw err;
  }

  const { rowCount } = await query('DELETE FROM tables WHERE no = $1', [no]);
  if (!rowCount) notFound();
  res.json({ ok: true });
}));

module.exports = router;