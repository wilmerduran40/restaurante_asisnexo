'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const { initSchema, runMigrations, ping } = require('./db');
const { bakeAdminPassword, hasValidSession } = require('./auth');

const ordersRouter = require('./routes/orders');
const deliveryRouter = require('./routes/delivery');
const adminRouter = require('./routes/admin');
const statsRouter = require('./routes/stats').router;
const printersRouter = require('./routes/printers').router;
const inventoryRouter = require('./routes/inventory');
const productsRouter = require('./routes/products');
const tablesRouter = require('./routes/tables');
const receiptsRouter = require('./routes/receipts');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Subidas de imágenes (volumen compartido con nginx en producción; aquí también
// se sirven para que el panel/desarrollo funcione sin nginx).
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/img/uploaded', express.static(uploadsDir));

// Request-logger ligero para visibilidad (agente, admin, web)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Healthcheck (usa la base; 200 solo si PostgreSQL responde)
app.get('/healthz', async (req, res) => {
  try {
    await ping();
    res.json({ ok: true });
  } catch (err) {
    console.error('[healthz] base no disponible:', err.message);
    res.status(503).json({ ok: false, error: 'database unavailable' });
  }
});

// Panel /admin: login y panel separados. El panel solo se sirve con sesión
// válida; si no, se redirige al login.
const publicDir = path.join(__dirname, '..', 'public');
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});
app.get(['/admin', '/admin/', '/admin/panel'], (req, res) => {
  if (!hasValidSession(req)) return res.redirect('/admin/login');
  res.sendFile(path.join(publicDir, 'panel.html'));
});
app.use('/admin', express.static(publicDir));

// API
app.use('/api', ordersRouter);
app.use('/api', deliveryRouter);
app.use('/api', adminRouter);
app.use('/api', statsRouter);
app.use('/api', printersRouter);
app.use('/api', inventoryRouter);
app.use('/api', productsRouter);
app.use('/api', tablesRouter);
app.use('/api', receiptsRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'No encontrado.' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[api] error:', status, err.message, err.stack && err.stack.split('\n')[1]);
    // DIAGNÓSTICO TEMPORAL: expone el mensaje real del 500 para localizar el
    // fallo al guardar productos. Se revierte al quedar resuelto.
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
  // 4xx: se devuelve el mensaje real (validación, conflictos, permisos) para
  // que el panel pueda mostrarlo tal cual.
  console.error('[api] error:', status, err.message);
  res.status(status).json({ error: err.message || 'Solicitud inválida.' });
});

const PORT = process.env.PORT || 3000;

async function main() {
  await initSchema();
  await runMigrations();
  await bakeAdminPassword();

  const required = ['DATABASE_URL', 'ADMIN_PASSWORD', 'ORDER_TOKEN', 'AGENT_TOKEN', 'SESSION_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`[startup] variables de entorno faltantes (${missing.join(', ')}). Revisa .env`);
  }

  // Mantener el proceso vivo con keep-alive HTTP
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[api] AsisNexo API escuchando en http://0.0.0.0:${PORT}`);
  });
  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 70 * 1000;
}

main().catch((err) => {
  console.error('[startup] error fatal:', err.message);
  process.exit(1);
});