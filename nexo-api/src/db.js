'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en el pool:', err.message);
});

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('[db] error en query:', err.message);
    throw err;
  }
}

// Ejecuta fn(client) dentro de una transacción (COMMIT/ROLLBACK automático).
// Se usa en operaciones de varias consultas que no pueden quedar a medias
// (stock de pedidos, borrados en cascada, producción).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}

// Aplica las migraciones pendientes en db/migrations/*.sql (por orden de nombre).
// Cada archivo se ejecuta una sola vez: se registra su nombre en schema_migrations.
// Idempotente y aditivo: no toca el esquema base ya aplicado.
async function runMigrations() {
  const { readdirSync, readFileSync } = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    console.log('[db] sin carpeta de migraciones (' + err.message + ')');
    return;
  }
  if (!files.length) return;

  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );
  const { rows } = await query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('[db] migracion aplicada: ' + file);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[db] error aplicando migracion ' + file + ': ' + err.message);
      throw err;
    } finally {
      client.release();
    }
  }
}

// Verificación de disponibilidad de la base (healthchecks).
async function ping() {
  await pool.query('SELECT 1');
}

// Espera a que PostgreSQL esté disponible y aplica el esquema (idempotente).
async function initSchema() {
  const { readFileSync } = require('fs');
  const path = require('path');
  const sql = readFileSync(
    path.join(__dirname, '..', 'db', 'schema.sql'),
    'utf8'
  );
  let lastError = null;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query(sql);
      console.log('[db] esquema aplicado correctamente');
      return;
    } catch (err) {
      lastError = err;
      console.error(
        `[db] intento ${attempt}/30 de conectar a PostgreSQL: ${err.message}`
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('No se pudo conectar a PostgreSQL: ' + (lastError && lastError.message));
}

module.exports = { query, withTransaction, initSchema, runMigrations, ping, pool };