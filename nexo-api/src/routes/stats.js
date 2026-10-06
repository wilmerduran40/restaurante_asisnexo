'use strict';

const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../auth');
const { wrap } = require('../http');

const router = express.Router();

const TZ = process.env.APP_TZ || 'America/Caracas';
const ACTIVE_STATUSES = ['nuevo', 'pago_confirmado', 'en_cola'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
// Columnas permitidas para los desgloses: evita inyección al interpolar el GROUP BY.
const BREAKDOWN_COLS = {
  payment: 'payment_method',
  delivery: 'delivery_type',
  source: 'source',
};

// Filtro por origen: null cuando no aplica, 'web' o 'mesero' si viene.
function srcParam(source) {
  return source === 'web' || source === 'mesero' ? source : null;
}

// ---------------------------------------------------------------------------
// Utilidades de fecha (se trabaja con fechas locales YYYY-MM-DD de APP_TZ)
// ---------------------------------------------------------------------------
function shiftDay(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return (
    dt.getUTCFullYear() + '-' +
    String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getUTCDate()).padStart(2, '0')
  );
}

function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

async function todayLocal() {
  const { rows } = await query(
    `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`,
    [TZ]
  );
  return rows[0].d;
}

// Resuelve range/from/to a un rango local [start, end] y la ventana previa
// equivalente (para las comparativas del dashboard).
function resolveRange(rangeRaw, fromRaw, toRaw, today) {
  const range = String(rangeRaw || '30').trim().toLowerCase();
  let start;
  let end = today;
  let label;
  let used = '30';

  if (range === 'today') {
    start = today;
    label = 'Hoy';
    used = 'today';
  } else if (range === '7') {
    start = shiftDay(today, -6);
    label = 'Últimos 7 días';
    used = '7';
  } else if (range === 'month') {
    start = today.slice(0, 8) + '01';
    label = 'Mes actual';
    used = 'month';
  } else if (range === 'custom') {
    const from = String(fromRaw || '').trim();
    const to = String(toRaw || '').trim() || today;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      const err = new Error('Rango inválido. Usa fechas YYYY-MM-DD.');
      err.status = 400;
      throw err;
    }
    start = from;
    end = to;
    if (start > end) {
      const err = new Error('La fecha inicial no puede ser posterior a la final.');
      err.status = 400;
      throw err;
    }
    label = start + ' → ' + end;
    used = 'custom';
  } else {
    start = shiftDay(today, -29);
    label = 'Últimos 30 días';
    used = '30';
  }

  const days = dayDiff(start, end) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) {
    const err = new Error('El rango debe estar entre 1 y ' + MAX_RANGE_DAYS + ' días.');
    err.status = 400;
    throw err;
  }

  const prevEnd = shiftDay(start, -1);
  const prevStart = shiftDay(prevEnd, -(days - 1));
  return { start, end, days, label, range: used, prevStart, prevEnd };
}

// Lee y valida los filtros comunes de /api/stats y /api/stats/export.
async function readFilters(req) {
  const source = String(req.query.source || '').trim();
  const src = srcParam(source);
  const today = await todayLocal();
  const r = resolveRange(req.query.range, req.query.from, req.query.to, today);
  return { src, ...r };
}

// Totales (hoy/rango): pedidos por created_at, ingresos por paid_at (no anulados).
function totalsSql() {
  return `SELECT
            count(*) FILTER (WHERE status <> 'cancelado'
                             AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS total,
            COALESCE(sum(total) FILTER (WHERE status <> 'cancelado'
                                        AND paid_at IS NOT NULL
                                        AND (paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date), 0) AS revenue,
            count(*) FILTER (WHERE status <> 'cancelado'
                             AND paid_at IS NOT NULL
                             AND (paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS paid,
            count(*) FILTER (WHERE status = ANY($4::text[])
                             AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS pending,
            count(*) FILTER (WHERE status = 'cancelado'
                             AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS cancelled,
            count(*) FILTER (WHERE source = 'web' AND status <> 'cancelado'
                             AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS web,
            count(*) FILTER (WHERE source = 'mesero' AND status <> 'cancelado'
                             AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS mesero,
            count(*) FILTER (WHERE delivery_type = 'delivery' AND status <> 'cancelado'
                             AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS delivery
          FROM orders
          WHERE ($5::text IS NULL OR source = $5)
            AND (((created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date)
                 OR (paid_at IS NOT NULL AND (paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date))`;
}

function mapTotals(r) {
  const revenue = Number(r.revenue);
  const paid = Number(r.paid);
  return {
    total: Number(r.total),
    revenue,
    pending: Number(r.pending),
    cancelled: Number(r.cancelled),
    web: Number(r.web),
    mesero: Number(r.mesero),
    deliveryCount: Number(r.delivery),
    paid,
    avgTicket: paid ? Math.round((revenue / paid) * 100) / 100 : 0,
  };
}

function breakdownSql(col) {
  return `SELECT ${col} AS key,
                 count(*) FILTER (WHERE status <> 'cancelado'
                                  AND (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date) AS count,
                 COALESCE(sum(total) FILTER (WHERE status <> 'cancelado'
                                             AND paid_at IS NOT NULL
                                             AND (paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date), 0) AS revenue
          FROM orders
          WHERE ($4::text IS NULL OR source = $4)
            AND (((created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date)
                 OR (paid_at IS NOT NULL AND (paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date))
          GROUP BY ${col}
          ORDER BY revenue DESC, key`;
}

function mapBreakdown(rows) {
  return rows.map((r) => ({
    key: `${r.key}`,
    count: Number(r.count),
    revenue: Number(r.revenue),
  }));
}

// Params de los totales actuales: TZ, start, end, statuses, src
function curParams(f) {
  return [TZ, f.start, f.end, ACTIVE_STATUSES, f.src];
}

// ---------------------------------------------------------------------------
// GET /api/stats?range=today|7|30|month|custom&from=&to=&source=web|mesero
// ---------------------------------------------------------------------------
router.get(
  '/stats',
  requireAdmin,
  wrap(async (req, res) => {
    const f = await readFilters(req);
    const rangeParams = [TZ, f.start, f.end, f.src];
    const prevParams = [TZ, f.prevStart, f.prevEnd, ACTIVE_STATUSES, f.src];

    const [
      curRes, prevRes, perDayRes, perHourRes,
      payRes, delRes, srcRes, topRes, catRes,
    ] = await Promise.all([
      query(totalsSql(), curParams(f)),
      query(totalsSql(), prevParams),
      query(
        `WITH days AS (
           SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
         )
         SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
                (SELECT count(*) FROM orders o
                  WHERE o.status <> 'cancelado'
                    AND ($4::text IS NULL OR o.source = $4)
                    AND (o.created_at AT TIME ZONE $1)::date = d.day) AS orders,
                (SELECT COALESCE(sum(o.total), 0) FROM orders o
                  WHERE o.status <> 'cancelado'
                    AND o.paid_at IS NOT NULL
                    AND ($4::text IS NULL OR o.source = $4)
                    AND (o.paid_at AT TIME ZONE $1)::date = d.day) AS revenue
         FROM days d
         ORDER BY d.day`,
        rangeParams
      ),
      query(
        `WITH hours AS (SELECT generate_series(0, 23) AS hour)
         SELECT h.hour,
                (SELECT count(*) FROM orders o
                  WHERE o.status <> 'cancelado'
                    AND ($4::text IS NULL OR o.source = $4)
                    AND (o.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
                    AND EXTRACT(hour FROM (o.created_at AT TIME ZONE $1)) = h.hour) AS orders,
                (SELECT COALESCE(sum(o.total), 0) FROM orders o
                  WHERE o.status <> 'cancelado'
                    AND o.paid_at IS NOT NULL
                    AND ($4::text IS NULL OR o.source = $4)
                    AND (o.paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
                    AND EXTRACT(hour FROM (o.paid_at AT TIME ZONE $1)) = h.hour) AS revenue
         FROM hours h
         ORDER BY h.hour`,
        rangeParams
      ),
      query(breakdownSql(BREAKDOWN_COLS.payment), rangeParams),
      query(breakdownSql(BREAKDOWN_COLS.delivery), rangeParams),
      query(breakdownSql(BREAKDOWN_COLS.source), rangeParams),
      query(
        `SELECT i->>'name' AS name,
                sum((i->>'qty')::int) AS qty,
                COALESCE(sum(((i->>'qty')::int) * (i->>'unitPrice')::numeric)
                         FILTER (WHERE o.paid_at IS NOT NULL
                                 AND (o.paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date), 0) AS revenue
         FROM orders o, jsonb_array_elements(o.items) AS i
         WHERE o.status <> 'cancelado'
           AND ($4::text IS NULL OR o.source = $4)
           AND (o.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         GROUP BY 1
         ORDER BY qty DESC
         LIMIT 10`,
        rangeParams
      ),
      query(
        `SELECT COALESCE(c.name, 'Otros') AS key,
                sum((i->>'qty')::int) AS qty,
                COALESCE(sum(((i->>'qty')::int) * (i->>'unitPrice')::numeric)
                         FILTER (WHERE o.paid_at IS NOT NULL
                                 AND (o.paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date), 0) AS revenue
         FROM orders o
         CROSS JOIN LATERAL jsonb_array_elements(o.items) AS i
         LEFT JOIN products p ON p.id = i->>'productId'
         LEFT JOIN categories c ON c.slug = p.category
         WHERE o.status <> 'cancelado'
           AND ($4::text IS NULL OR o.source = $4)
           AND (o.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         GROUP BY 1
         ORDER BY qty DESC`,
        rangeParams
      ),
    ]);

    res.json({
      range: {
        range: f.range,
        start: f.start,
        end: f.end,
        days: f.days,
        label: f.label,
        source: f.src,
        prevStart: f.prevStart,
        prevEnd: f.prevEnd,
      },
      current: mapTotals(curRes.rows[0]),
      previous: mapTotals(prevRes.rows[0]),
      perDay: perDayRes.rows.map((r) => ({
        day: r.day,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      perHour: perHourRes.rows.map((r) => ({
        hour: Number(r.hour),
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      })),
      byPayment: mapBreakdown(payRes.rows),
      byDelivery: mapBreakdown(delRes.rows),
      bySource: mapBreakdown(srcRes.rows),
      topProducts: topRes.rows.map((r) => ({
        name: `${r.name}`,
        qty: Number(r.qty),
        revenue: Number(r.revenue),
      })),
      byCategory: catRes.rows.map((r) => ({
        key: `${r.key}`,
        qty: Number(r.qty),
        revenue: Number(r.revenue),
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/stats/export — CSV con los pedidos del rango (solo admin).
// ---------------------------------------------------------------------------
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

router.get(
  '/stats/export',
  requireAdmin,
  wrap(async (req, res) => {
    const f = await readFilters(req);
    const { rows } = await query(
      `SELECT to_char(o.created_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI') AS fecha,
              o.id,
              o.source,
              o.delivery_type,
              o.payment_method,
              o.status,
              o.total,
              COALESCE(o.waiter, '') AS waiter,
              COALESCE(o.table_no::text, '') AS table_no,
              CASE WHEN o.paid_at IS NOT NULL
                   THEN to_char(o.paid_at AT TIME ZONE $1, 'YYYY-MM-DD HH24:MI')
                   ELSE '' END AS pagado_en
       FROM orders o
       WHERE ($4::text IS NULL OR o.source = $4)
         AND (((o.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date)
              OR (o.paid_at IS NOT NULL
                  AND (o.paid_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date))
       ORDER BY o.created_at`,
      [TZ, f.start, f.end, f.src]
    );

    const header = ['fecha', 'id', 'origen', 'tipo', 'metodo_pago', 'estado', 'total', 'mesero', 'mesa', 'pagado_en'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.fecha, r.id, r.source, r.delivery_type, r.payment_method,
        r.status, Number(r.total).toFixed(2), r.waiter, r.table_no, r.pagado_en,
      ].map(csvCell).join(','));
    }

    const filename = `pedidos_${f.start}_${f.end}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  })
);

// ---------------------------------------------------------------------------
// Resumen diario completo (para imprimir en la térmica y/o consultar).
// date: YYYY-MM-DD local (por defecto: hoy en APP_TZ).
// ---------------------------------------------------------------------------
async function computeDailySummary(dateStr) {
  let date = null;
  if (dateStr) {
    if (!DATE_RE.test(String(dateStr).trim())) {
      const err = new Error('Fecha inválida. Usa formato YYYY-MM-DD.');
      err.status = 400;
      throw err;
    }
    date = String(dateStr).trim();
  } else {
    const { rows } = await query(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`,
      [TZ]
    );
    date = rows[0].d;
  }

  const [totalsRes, deliveryRes, sourceRes, paymentRes, topRes] = await Promise.all([
    query(
      `SELECT count(*) FILTER (WHERE status <> 'cancelado'
                               AND (created_at AT TIME ZONE $1)::date = $2::date) AS total,
              COALESCE(sum(total) FILTER (WHERE status <> 'cancelado'
                                          AND paid_at IS NOT NULL
                                          AND (paid_at AT TIME ZONE $1)::date = $2::date), 0) AS revenue,
              count(*) FILTER (WHERE status = ANY($3::text[])
                               AND (created_at AT TIME ZONE $1)::date = $2::date) AS pending,
              count(*) FILTER (WHERE status = 'cancelado'
                               AND (created_at AT TIME ZONE $1)::date = $2::date) AS cancelled
       FROM orders
       WHERE (created_at AT TIME ZONE $1)::date = $2::date
          OR (paid_at IS NOT NULL AND (paid_at AT TIME ZONE $1)::date = $2::date)`,
      [TZ, date, ACTIVE_STATUSES]
    ),
    query(
      `SELECT delivery_type AS type,
              count(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date) AS count,
              COALESCE(sum(total) FILTER (WHERE paid_at IS NOT NULL
                                          AND (paid_at AT TIME ZONE $1)::date = $2::date), 0) AS revenue
       FROM orders
       WHERE status <> 'cancelado'
         AND ((created_at AT TIME ZONE $1)::date = $2::date
              OR (paid_at IS NOT NULL AND (paid_at AT TIME ZONE $1)::date = $2::date))
       GROUP BY delivery_type
       ORDER BY type`,
      [TZ, date]
    ),
    query(
      `SELECT source,
              count(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date) AS count,
              COALESCE(sum(total) FILTER (WHERE paid_at IS NOT NULL
                                          AND (paid_at AT TIME ZONE $1)::date = $2::date), 0) AS revenue
       FROM orders
       WHERE status <> 'cancelado'
         AND ((created_at AT TIME ZONE $1)::date = $2::date
              OR (paid_at IS NOT NULL AND (paid_at AT TIME ZONE $1)::date = $2::date))
       GROUP BY source
       ORDER BY source`,
      [TZ, date]
    ),
    query(
      `SELECT payment_method AS method,
              count(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date) AS count,
              COALESCE(sum(total) FILTER (WHERE paid_at IS NOT NULL
                                          AND (paid_at AT TIME ZONE $1)::date = $2::date), 0) AS revenue
       FROM orders
       WHERE status <> 'cancelado'
         AND ((created_at AT TIME ZONE $1)::date = $2::date
              OR (paid_at IS NOT NULL AND (paid_at AT TIME ZONE $1)::date = $2::date))
       GROUP BY payment_method
       ORDER BY revenue DESC, method`,
      [TZ, date]
    ),
    query(
      `SELECT i->>'name' AS name,
              sum((i->>'qty')::int) AS qty,
              COALESCE(sum(((i->>'qty')::int) * (i->>'unitPrice')::numeric)
                       FILTER (WHERE o.paid_at IS NOT NULL
                               AND (o.paid_at AT TIME ZONE $1)::date = $2::date), 0) AS revenue
       FROM orders o, jsonb_array_elements(o.items) AS i
       WHERE o.status <> 'cancelado'
         AND (o.created_at AT TIME ZONE $1)::date = $2::date
       GROUP BY 1
       ORDER BY qty DESC
       LIMIT 8`,
      [TZ, date]
    ),
  ]);

  return {
    date,
    totals: {
      total: totalsRes.rows[0].total,
      revenue: Number(totalsRes.rows[0].revenue),
      pending: totalsRes.rows[0].pending,
      cancelled: totalsRes.rows[0].cancelled,
    },
    byDelivery: deliveryRes.rows.map((r) => ({
      type: r.type,
      count: r.count,
      revenue: Number(r.revenue),
    })),
    bySource: sourceRes.rows.map((r) => ({
      source: r.source,
      count: r.count,
      revenue: Number(r.revenue),
    })),
    byPayment: paymentRes.rows.map((r) => ({
      method: r.method,
      count: r.count,
      revenue: Number(r.revenue),
    })),
    top: topRes.rows.map((r) => ({
      name: `${r.name}`,
      qty: r.qty,
      revenue: Number(r.revenue),
    })),
  };
}

module.exports = { router, computeDailySummary };
