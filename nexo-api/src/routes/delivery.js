'use strict';

// Delivery: configuración pública (menu.html la usa para mostrar el envío en vivo)
// y administración de tarifas/lluvia desde el panel /admin.

const express = require('express');
const { requireAdmin, requireRole } = require('../auth');
const { rateLimit } = require('../rateLimit');
const { wrap } = require('../http');
const { getDeliveryConfig, setDeliveryConfig, calcDelivery } = require('../delivery');

const router = express.Router();

// R pública — el cliente calcula su envío desde estas zonas + estado de lluvia.
router.get('/delivery/config', rateLimit({ windowMs: 60000, max: 60 }),
  wrap(async (req, res) => {
    const config = await getDeliveryConfig();
    res.json({
      storeLat: config.storeLat,
      storeLng: config.storeLng,
      zones: config.zones,
      rainSurcharge: config.rainSurcharge,
      raining: config.raining,
    });
  })
);

// R admin/mesero — leer configuración de delivery (el mesero la usa para cotizar
// el envío desde el POS). El POST de guardar sigue siendo solo admin.
router.get('/admin/delivery', requireRole('admin', 'mesero'), wrap(async (req, res) => {
  const config = await getDeliveryConfig();
  res.json({ config });
}));

// C/U admin — guardar coordenadas del local, zonas y estado de lluvia
router.post('/admin/delivery', requireAdmin, wrap(async (req, res) => {
  const body = req.body || {};
  const current = await getDeliveryConfig();

  const numOr = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const storeLat = numOr(body.storeLat, current.storeLat);
  const storeLng = numOr(body.storeLng, current.storeLng);
  if (storeLat < -90 || storeLat > 90 || storeLng < -180 || storeLng > 180) {
    const err = new Error('Coordenadas del local inválidas.');
    err.status = 400;
    throw err;
  }

  let zones = Array.isArray(body.zones) ? body.zones : current.zones;
  zones = zones
    .map((z) => ({
      maxKm: z.maxKm === null || z.maxKm === undefined || z.maxKm === '' ? null : Number(z.maxKm),
      price: Math.max(0, Number(z.price) || 0),
    }))
    .filter((z) => z.price >= 0);
  if (!zones.length) {
    const err = new Error('Debe existir al menos una zona de envío.');
    err.status = 400;
    throw err;
  }
  zones.sort((a, b) => {
    if (a.maxKm === null) return 1;
    if (b.maxKm === null) return -1;
    return a.maxKm - b.maxKm;
  });

  const rainSurcharge = Math.max(0, numOr(body.rainSurcharge, current.rainSurcharge));
  const raining = body.raining ? true : false;

  const config = { storeLat, storeLng, zones, rainSurcharge, raining };
  await setDeliveryConfig(config);
  res.json({ ok: true, config });
}));

// R pública (debug/útil para el panel) — estimar envío a unas coordenadas
router.get('/delivery/estimate', rateLimit({ windowMs: 60000, max: 120 }),
  wrap(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Se requieren lat y lng válidos.' });
    }
    const config = await getDeliveryConfig();
    const est = calcDelivery({ lat, lng }, config);
    res.json({
      fee: est.fee,
      distanceKm: est.distanceKm,
      zoneIndex: est.zoneIndex,
      raining: config.raining,
      rainSurcharge: config.rainSurcharge,
    });
  })
);

module.exports = router;