'use strict';

// Configuración de impresoras + escaneo de red desde el panel /admin.
//
// Las impresoras viven en la tabla `printers` (CRUD completo desde el panel).
// La red local del local no es visible desde el VPS: el escaneo, el ping y las
// pruebas los ejecuta el print-agent (dispositivo local) cuando el panel lo pide:
//
//   admin: POST /api/admin/printers/:id/ping   -> marca solicitud 'pending'
//   admin: POST /api/admin/printers/:id/test   -> marca solicitud 'pending' (test)
//   admin: POST /api/admin/printers/scan       -> marca solicitud 'pending'
//   agente detecta en su polling y responde:
//   agente: POST /api/agent/ping-result        -> ok / latencia del ping
//   agente: POST /api/agent/test-result        -> resultado de la impresión de prueba
//   agente: POST /api/agent/scan-result        -> IPs encontradas en la subred
//
// El agente imprime los pedidos con la impresora marcada como `active`; si hay
// varias activas usa la primera.

const express = require('express');
const { query } = require('../db');
const { requireAdmin, requireAgent } = require('../auth');
const { wrap } = require('../http');
const { computeDailySummary } = require('./stats');

const router = express.Router();

const KEY_SCAN = 'printer_scan';
const KEY_SUMMARY = 'printer_summary';
const KEY_PING = 'printer_ping';

const PRINTER_COLS = 'id, name, model, location, host, port, width, active, created_at, updated_at';

async function getSetting(key) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch (err) {
    return null;
  }
}

async function setSetting(key, val) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(val)]
  );
}

// ---------------------------------------------------------------------------
// Helpers de la tabla printers
// ---------------------------------------------------------------------------

async function listPrinters() {
  const { rows } = await query(`SELECT ${PRINTER_COLS} FROM printers ORDER BY id`);
  return rows;
}

async function getPrinter(id) {
  const { rows } = await query(`SELECT ${PRINTER_COLS} FROM printers WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Impresora efectiva para imprimir pedidos: la primera activa; si no hay ninguna
// activa, la primera por id. Devuelve null si no hay impresoras.
async function getActivePrinter() {
  const { rows } = await query(`SELECT ${PRINTER_COLS} FROM printers ORDER BY active DESC, id ASC`);
  return rows[0] || null;
}

async function clearActiveExcept(id) {
  await query('UPDATE printers SET active = false WHERE active = true AND id <> $1', [id]);
}

function notFound() {
  const err = new Error('Impresora no encontrada.');
  err.status = 404;
  throw err;
}

function badId() {
  const err = new Error('Id de impresora inválido.');
  err.status = 400;
  throw err;
}

function sanitizePrinter(body) {
  const host = String((body && body.host) || '').trim();
  const port = Number(body && body.port);
  const width = Number(body && body.width);
  if (!host) {
    const err = new Error('La IP o host de la impresora es obligatoria.');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const err = new Error('Puerto invalido (1-65535).');
    err.status = 400;
    throw err;
  }
  if (width !== 58 && width !== 80) {
    const err = new Error('El ancho debe ser 58 u 80 mm.');
    err.status = 400;
    throw err;
  }
  return {
    name: String((body && body.name) || '').trim(),
    model: String((body && body.model) || '').trim(),
    location: String((body && body.location) || '').trim(),
    host,
    port,
    width,
    active: body && body.active ? true : false,
  };
}

// Lecturas que el agente necesita en su polling de /api/orders/pending.
async function getPendingExtras() {
  const printer = await getActivePrinter();
  const scan = await getSetting(KEY_SCAN);
  const summary = await getSetting(KEY_SUMMARY);
  const ping = await getSetting(KEY_PING);

  let scanRequest = null;
  if (scan && scan.status === 'pending') {
    scanRequest = { at: scan.at, test: !!scan.test };
    if (scan.test && scan.printer) scanRequest.printer = scan.printer;
  }

  let summaryRequest = null;
  if (summary && summary.status === 'pending') {
    summaryRequest = { at: summary.at, date: summary.date, summary: summary.summary };
  }

  let pingRequest = null;
  if (ping && ping.status === 'pending') {
    pingRequest = {
      at: ping.at,
      printerId: ping.printerId,
      printer: { host: ping.host, port: ping.port, width: ping.width || 58 },
    };
  }

  return {
    printer: printer && printer.host ? printer : null,
    scanRequest,
    summaryRequest,
    pingRequest,
  };
}

// ---------------------------------------------------------------------------
// Admin — CRUD de impresoras
// ---------------------------------------------------------------------------

// R — listar impresoras + estado de los comandos (scan/ping/summary)
router.get('/admin/printers', requireAdmin, wrap(async (req, res) => {
  const printers = await listPrinters();
  const scan = await getSetting(KEY_SCAN);
  const summary = await getSetting(KEY_SUMMARY);
  const ping = await getSetting(KEY_PING);
  const active = printers.find((p) => p.active) || printers[0] || null;
  res.json({ printers, activeId: active ? active.id : null, scan, ping, summary });
}));

// R — leer una impresora
router.get('/admin/printers/:id', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) badId();
  const printer = await getPrinter(id);
  if (!printer) notFound();
  res.json({ printer });
}));

// C — crear impresora
router.post('/admin/printers', requireAdmin, wrap(async (req, res) => {
  const p = sanitizePrinter(req.body);
  if (p.active) await clearActiveExcept(-1);
  const { rows } = await query(
    `INSERT INTO printers (name, model, location, host, port, width, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${PRINTER_COLS}`,
    [p.name, p.model, p.location, p.host, p.port, p.width, p.active]
  );
  res.status(201).json({ printer: rows[0] });
}));

// U — editar impresora (admite parcial: los campos ausentes conservan su valor)
router.put('/admin/printers/:id', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) badId();
  const existing = await getPrinter(id);
  if (!existing) notFound();

  const body = req.body || {};
  const pick = (field, fallback) => (body[field] !== undefined ? body[field] : fallback);
  const p = sanitizePrinter({
    name: pick('name', existing.name),
    model: pick('model', existing.model),
    location: pick('location', existing.location),
    host: pick('host', existing.host),
    port: pick('port', existing.port),
    width: pick('width', existing.width),
    active: pick('active', existing.active),
  });
  if (p.active) await clearActiveExcept(id);
  const { rows } = await query(
    `UPDATE printers
     SET name = $1, model = $2, location = $3, host = $4, port = $5,
         width = $6, active = $7, updated_at = now()
     WHERE id = $8
     RETURNING ${PRINTER_COLS}`,
    [p.name, p.model, p.location, p.host, p.port, p.width, p.active, id]
  );
  res.json({ printer: rows[0] });
}));

// D — eliminar impresora
router.delete('/admin/printers/:id', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) badId();
  const { rowCount } = await query('DELETE FROM printers WHERE id = $1', [id]);
  if (!rowCount) notFound();

  // Limpia solicitudes pendientes que referencien la impresora eliminada.
  const scan = await getSetting(KEY_SCAN);
  if (scan && scan.status === 'pending' && scan.test && scan.printer && scan.printer.id === id) {
    await setSetting(KEY_SCAN, Object.assign({}, scan, {
      status: 'done',
      testResult: 'impresora eliminada',
      testAt: new Date().toISOString(),
    }));
  }
  const ping = await getSetting(KEY_PING);
  if (ping && ping.status === 'pending' && ping.printerId === id) {
    await setSetting(KEY_PING, Object.assign({}, ping, {
      status: 'done',
      ok: false,
      error: 'impresora eliminada',
      testAt: new Date().toISOString(),
    }));
  }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Admin — comandos remotos (los ejecuta el print-agent del local)
// ---------------------------------------------------------------------------

// Pedir ping a una impresora específica
router.post('/admin/printers/:id/ping', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) badId();
  const printer = await getPrinter(id);
  if (!printer) notFound();
  await setSetting(KEY_PING, {
    at: new Date().toISOString(),
    status: 'pending',
    printerId: printer.id,
    host: printer.host,
    port: printer.port,
    width: printer.width,
    ok: null,
    latencyMs: null,
    error: null,
    testAt: null,
  });
  res.json({ ok: true, status: 'pending', printerId: printer.id });
}));

// Pedir impresión de prueba en una impresora específica
router.post('/admin/printers/:id/test', requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) badId();
  const printer = await getPrinter(id);
  if (!printer) notFound();
  await setSetting(KEY_SCAN, {
    at: new Date().toISOString(),
    status: 'pending',
    test: true,
    reports: [],
    printer: { id: printer.id, host: printer.host, port: printer.port, width: printer.width },
  });
  res.json({ ok: true, status: 'pending', printerId: printer.id });
}));

// Pedir escaneo de red (lo ejecuta el print-agent del local)
router.post('/admin/printers/scan', requireAdmin, wrap(async (req, res) => {
  await setSetting(KEY_SCAN, {
    at: new Date().toISOString(),
    status: 'pending',
    test: false,
    reports: [],
  });
  res.json({ ok: true, status: 'pending' });
}));

// Pedir impresión del resumen diario (lo imprime el print-agent del local)
router.post('/admin/printers/summary', requireAdmin, wrap(async (req, res) => {
  const active = await getActivePrinter();
  if (!active || !active.host) {
    return res.status(400).json({ error: 'Guarda primero una impresora para poder imprimir el resumen.' });
  }
  const summary = await computeDailySummary(req.body && req.body.date);
  await setSetting(KEY_SUMMARY, {
    at: new Date().toISOString(),
    status: 'pending',
    date: summary.date,
    summary,
  });
  res.json({ ok: true, status: 'pending', date: summary.date });
}));

// ---------------------------------------------------------------------------
// Agente — reportes
// ---------------------------------------------------------------------------

// El agente reporta el resultado del ping a una impresora
router.post('/agent/ping-result', requireAgent, wrap(async (req, res) => {
  const ping = (await getSetting(KEY_PING)) || {};
  const body = req.body || {};
  const ok = body.ok ? true : false;
  const latency = Number(body.latencyMs);
  await setSetting(KEY_PING, {
    at: ping.at || null,
    status: 'done',
    printerId: body.printerId || ping.printerId || null,
    host: ping.host || null,
    port: ping.port || 9100,
    width: ping.width || 58,
    ok,
    latencyMs: Number.isFinite(latency) ? Math.round(latency) : null,
    error: ok ? null : String(body.error || 'error'),
    testAt: new Date().toISOString(),
  });
  res.json({ ok: true });
}));

// El agente reporta las IPs encontradas al escanear la subred
router.post('/agent/scan-result', requireAgent, wrap(async (req, res) => {
  const scan = (await getSetting(KEY_SCAN)) || {};
  const body = req.body || {};
  const report = {
    agent: String(body.agent || 'desconocido'),
    subnet: body.subnet || null,
    found: Array.isArray(body.found) ? body.found.filter((f) => typeof f === 'string') : [],
    at: new Date().toISOString(),
  };
  const reports = (Array.isArray(scan.reports) ? scan.reports : []).slice(-9);
  reports.push(report);
  const merged = [...new Set(reports.flatMap((r) => r.found || []))].sort();
  await setSetting(KEY_SCAN, {
    at: scan.at || null,
    status: 'done',
    test: !!scan.test,
    reports,
    mergedFound: merged,
  });
  res.json({ ok: true });
}));

// El agente reporta el resultado de la impresión de prueba
router.post('/agent/test-result', requireAgent, wrap(async (req, res) => {
  const scan = (await getSetting(KEY_SCAN)) || {};
  const body = req.body || {};
  await setSetting(KEY_SCAN, {
    at: scan.at || null,
    status: 'done',
    test: true,
    reports: Array.isArray(scan.reports) ? scan.reports : [],
    testResult: body.ok ? 'ok' : String(body.error || 'error'),
    testAt: new Date().toISOString(),
    printer: scan.printer || null,
  });
  res.json({ ok: true });
}));

// El agente reporta el resultado de la impresión del resumen diario
router.post('/agent/summary-result', requireAgent, wrap(async (req, res) => {
  const summary = (await getSetting(KEY_SUMMARY)) || {};
  const body = req.body || {};
  await setSetting(KEY_SUMMARY, {
    at: summary.at || null,
    status: 'done',
    date: summary.date || null,
    summary: summary.summary || null,
    testResult: body.ok ? 'ok' : String(body.error || 'error'),
    testAt: new Date().toISOString(),
  });
  res.json({ ok: true });
}));

module.exports = { router, getPendingExtras };