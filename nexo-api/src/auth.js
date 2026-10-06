'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret';
const COOKIE_NAME = 'nexo_session';
const COOKIE_MAX_AGE = 7 * 24 * 3600 * 1000; // 7 días

const ROLES = new Set(['admin', 'mesero', 'cocina']);

// Siembra el usuario admin al primer arranque. Reutiliza el hash legacy de la
// setting `admin_password_hash` (para no cambiar la contraseña actual al migrar)
// y si no existe usa ADMIN_PASSWORD del env. Cambios posteriores se hacen por el
// panel (POST /api/admin/password) y el env queda sin efecto.
async function bakeAdminPassword() {
  const { rows } = await query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length > 0) {
    console.log('[auth] usuario admin presente en la base');
    return;
  }
  const legacy = await getSettingValue('admin_password_hash');
  let hash = legacy;
  if (!hash) {
    const env = process.env.ADMIN_PASSWORD;
    if (!env) {
      throw new Error('ADMIN_PASSWORD no está definido y no hay usuario admin en la base.');
    }
    hash = await bcrypt.hash(env, 10);
  }
  await query(
    `INSERT INTO users (username, password_hash, role, active)
     VALUES ($1, $2, 'admin', true)
     ON CONFLICT (username) DO NOTHING`,
    ['admin', hash]
  );
  console.log('[auth] usuario admin sembrado');
}

async function getSettingValue(key) {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

// Autentica usuario + contraseña; devuelve el usuario o null.
async function verifyUser(username, password) {
  const name = String(username || '').trim().toLowerCase();
  if (!name) return null;
  const { rows } = await query(
    'SELECT id, username, password_hash, role, active FROM users WHERE username = $1',
    [name]
  );
  if (!rows.length) return null;
  const user = rows[0];
  const ok = await bcrypt.compare(password || '', user.password_hash);
  if (!ok) return null;
  return { id: user.id, username: user.username, role: user.role, active: user.active };
}

// Cambia la contraseña de un usuario existente (se usa para el admin).
async function setUserPassword(username, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    const err = new Error('La nueva contraseña debe tener al menos 8 caracteres.');
    err.status = 400;
    throw err;
  }
  const hash = await bcrypt.hash(String(newPassword), 10);
  const { rows } = await query(
    'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id',
    [hash, String(username).trim().toLowerCase()]
  );
  if (!rows.length) {
    const err = new Error('Usuario no encontrado.');
    err.status = 404;
    throw err;
  }
}

function signSession(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    SESSION_SECRET,
    { expiresIn: '7d' }
  );
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
}

function parseSession(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    if (!payload || !ROLES.has(payload.role)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Cualquier sesión válida (admin o mesero).
function requireUser(req, res, next) {
  const payload = parseSession(req);
  if (!payload) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
  req.user = payload;
  return next();
}

// Sesión válida con rol en la lista (p. ej. requireRole('admin','mesero')).
function requireRole(...roles) {
  return (req, res, next) => {
    const payload = parseSession(req);
    if (!payload) {
      return res.status(401).json({ error: 'Sesión inválida o expirada.' });
    }
    if (!roles.includes(payload.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
    }
    req.user = payload;
    return next();
  };
}

function requireAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

// Comprueba si la cookie de sesión es válida (sin responder); se usa para
// decidir en el servidor si se sirve el panel o se redirige al login.
function hasValidSession(req) {
  return !!parseSession(req);
}

// Autenticación del agente impresor (publica, usa AGENT_TOKEN).
function requireAgent(req, res, next) {
  const provided =
    req.get('x-agent-token') || req.query.agentToken || '';
  if (!process.env.AGENT_TOKEN || provided !== process.env.AGENT_TOKEN) {
    return res.status(401).json({ error: 'Token de agente inválido.' });
  }
  return next();
}

module.exports = {
  SESSION_SECRET,
  COOKIE_NAME,
  bakeAdminPassword,
  verifyUser,
  setUserPassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
  requireRole,
  requireAdmin,
  hasValidSession,
  requireAgent,
};