'use strict';

// Rate-limit simple en memoria para POST /api/order (evita spam).
// La limpieza se hace de forma perezosa: entradas viejas se descartan al leer.
function rateLimit({ windowMs = 60000, max = 5 } = {}) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (now - rec.start > windowMs) hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || now - rec.start > windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return next();
    }
    rec.count += 1;
    if (rec.count > max) {
      return res
        .status(429)
        .json({ error: 'Demasiados pedidos. Inténtalo de nuevo en un minuto.' });
    }
    return next();
  };
}

// Auth para pedidos desde la web: requiere ORDER_TOKEN (onoscurece el acceso público).
function requireOrderToken(req, res, next) {
  const provided = req.get('x-order-token');
  if (!process.env.ORDER_TOKEN || provided !== process.env.ORDER_TOKEN) {
    return res.status(401).json({ error: 'Token de pedido inválido.' });
  }
  return next();
}

module.exports = { rateLimit, requireOrderToken };