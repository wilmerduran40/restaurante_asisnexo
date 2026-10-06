'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const {
  verifyUser,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
  requireUser,
} = require('../auth');
const { query } = require('../db');
const { wrap } = require('../http');

const router = express.Router();
const loginBuckets = new Map();

const USER_ROLES = new Set(['admin', 'mesero', 'cocina']);
function normalizeRole(value) {
  return USER_ROLES.has(value) ? value : 'mesero';
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of loginBuckets) {
    if (now - b.start > 60000) loginBuckets.delete(k);
  }
}, 30000).unref();

// POST /api/admin/login — crea sesión (cookie httpOnly + JWT) para admin o mesero
router.post('/admin/login', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = 'login:' + ip;
  const now = Date.now();
  const bucket = loginBuckets.get(key);
  if (bucket && now - bucket.start < 60000 && bucket.count >= 10) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera un minuto.' });
  }
  if (!bucket || now - bucket.start > 60000) {
    loginBuckets.set(key, { start: now, count: 1 });
  } else {
    bucket.count += 1;
  }
  next();
}, wrap(async (req, res) => {
  const user = await verifyUser(req.body && req.body.username, req.body && req.body.password);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({ ok: true, role: user.role, username: user.username });
}));

// GET /api/admin/me — sesión actual
router.get('/admin/me', requireUser, (req, res) => {
  res.json({ ok: true, role: req.user.role, username: req.user.username || 'admin' });
});

// POST /api/admin/logout — destruye sesión
router.post('/admin/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Usuarios (solo admin) — gestiona cuentas de meseros
// ---------------------------------------------------------------------------

// GET /api/admin/users — listar
router.get('/admin/users', requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, username, role, active, created_at FROM users ORDER BY id'
    );
    res.json({ users: rows });
  })
);

// POST /api/admin/users — crear (mesero por defecto; admin solo para nuevos admins)
router.post('/admin/users', requireAdmin,
  wrap(async (req, res) => {
    const username = String((req.body && req.body.username) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const role = normalizeRole(req.body && req.body.role);
    if (!username) {
      const err = new Error('El usuario es obligatorio.');
      err.status = 400;
      throw err;
    }
    if (password.length < 8) {
      const err = new Error('La contraseña debe tener al menos 8 caracteres.');
      err.status = 400;
      throw err;
    }
    const hash = await bcrypt.hash(password, 10);
    try {
      const { rows } = await query(
        `INSERT INTO users (username, password_hash, role, active)
         VALUES ($1, $2, $3, true)
         RETURNING id, username, role, active, created_at`,
        [username, hash, role]
      );
      res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        const e = new Error('Ese usuario ya existe.');
        e.status = 409;
        throw e;
      }
      throw err;
    }
  })
);

// POST /api/admin/users/:id/status — activar/desactivar (no toca al admin)
router.post('/admin/users/:id/status', requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      const err = new Error('Usuario inválido.');
      err.status = 400;
      throw err;
    }
    const active = !!(req.body && req.body.active);
    const { rows } = await query(
      `UPDATE users SET active = $1 WHERE id = $2 AND role <> 'admin'
       RETURNING id, username, role, active`,
      [active, id]
    );
    if (!rows.length) {
      const err = new Error('No se puede modificar ese usuario.');
      err.status = 404;
      throw err;
    }
    res.json({ user: rows[0] });
  })
);

// POST /api/admin/users/:id/password — resetear contraseña
router.post('/admin/users/:id/password', requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const password = String((req.body && req.body.password) || '');
    if (!Number.isInteger(id)) {
      const err = new Error('Usuario inválido.');
      err.status = 400;
      throw err;
    }
    if (password.length < 8) {
      const err = new Error('La contraseña debe tener al menos 8 caracteres.');
      err.status = 400;
      throw err;
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username',
      [hash, id]
    );
    if (!rows.length) {
      const err = new Error('Usuario no encontrado.');
      err.status = 404;
      throw err;
    }
    res.json({ ok: true });
  })
);

// PUT /api/admin/users/:id — editar usuario (username/rol)
router.put('/admin/users/:id', requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      const err = new Error('Usuario inválido.');
      err.status = 400;
      throw err;
    }
    const body = req.body || {};
    const username = String(body.username || '').trim().toLowerCase();
    const role = normalizeRole(body.role);
    if (!username) {
      const err = new Error('El usuario es obligatorio.');
      err.status = 400;
      throw err;
    }
    const { rows } = await query('SELECT id, username, role FROM users WHERE id = $1', [id]);
    if (!rows.length) {
      const err = new Error('Usuario no encontrado.');
      err.status = 404;
      throw err;
    }
    const target = rows[0];
    if (target.role === 'admin' && role !== 'admin') {
      if (target.id === req.user.userId) {
        const err = new Error('No puedes quitarte tu propio rol de admin.');
        err.status = 400;
        throw err;
      }
      const { rows: admins } = await query("SELECT id FROM users WHERE role = 'admin'");
      if (admins.length <= 1) {
        const err = new Error('No se puede quitar el rol admin al único admin.');
        err.status = 400;
        throw err;
      }
    }
    try {
      const { rows: updated } = await query(
        'UPDATE users SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role, active, created_at',
        [username, role, id]
      );
      res.json({ user: updated[0] });
    } catch (err) {
      if (err.code === '23505') {
        const e = new Error('Ese usuario ya existe.');
        e.status = 409;
        throw e;
      }
      throw err;
    }
  })
);

// DELETE /api/admin/users/:id — eliminar usuario
router.delete('/admin/users/:id', requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      const err = new Error('Usuario inválido.');
      err.status = 400;
      throw err;
    }
    if (id === req.user.userId) {
      const err = new Error('No puedes eliminar tu propia cuenta.');
      err.status = 400;
      throw err;
    }
    const { rows } = await query('SELECT role FROM users WHERE id = $1', [id]);
    if (!rows.length) {
      const err = new Error('Usuario no encontrado.');
      err.status = 404;
      throw err;
    }
    if (rows[0].role === 'admin') {
      const { rows: admins } = await query("SELECT id FROM users WHERE role = 'admin'");
      if (admins.length <= 1) {
        const err = new Error('No se puede eliminar el único admin.');
        err.status = 400;
        throw err;
      }
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  })
);

module.exports = router;