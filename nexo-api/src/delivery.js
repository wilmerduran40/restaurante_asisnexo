'use strict';

// Cálculo de costo de envío por distancia (zonas/radios configurables) +
// recargo por lluvia. La configuración vive en la tabla `settings` (key 'delivery'),
// el mismo patrón JSON que usa printers.js. El servidor es la fuente autoritativa:
// menu.html muestra una estimación con GET /api/delivery/config, pero al crear el
// pedido el backend recalcula fee/distancia y lo guarda.

const { query } = require('./db');

const KEY_DELIVERY = 'delivery';

// Config por defecto (editable en el panel /admin → Delivery).
// zones: bandas ordenadas por maxKm ascendente; el precio de la primera zona cuyo
// maxKm >= distancia aplica. La última zona puede tener maxKm = null = "desde X km".
const DEFAULT_CONFIG = {
  storeLat: 8.231491,
  storeLng: -70.8198939,
  zones: [
    { maxKm: 1, price: 1 },
    { maxKm: 2, price: 2 },
    { maxKm: 4, price: 3 },
    { maxKm: null, price: 4 },
  ],
  rainSurcharge: 1,
  raining: false,
};

async function getDeliveryConfig() {
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [KEY_DELIVERY]);
  if (!rows.length) return { ...DEFAULT_CONFIG, zones: DEFAULT_CONFIG.zones.map((z) => ({ ...z })) };
  try {
    const saved = JSON.parse(rows[0].value);
    return Object.assign({}, DEFAULT_CONFIG, saved, {
      zones: Array.isArray(saved.zones) ? saved.zones : DEFAULT_CONFIG.zones.map((z) => ({ ...z })),
    });
  } catch (err) {
    return { ...DEFAULT_CONFIG, zones: DEFAULT_CONFIG.zones.map((z) => ({ ...z })) };
  }
}

async function setDeliveryConfig(cfg) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY_DELIVERY, JSON.stringify(cfg)]
  );
}

// Distancia en km entre dos coordenadas (fórmula de Haversine).
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // radio medio de la Tierra en km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calcula el envío para unas coordenadas. Devuelve { fee, distanceKm, zoneIndex }.
// Si no hay coordenadas válidas devuelve fee 0 y distanceKm null (se confirma en el local).
function calcDelivery(coords, cfg) {
  if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') {
    return { fee: 0, distanceKm: null, zoneIndex: -1 };
  }
  const config = cfg || DEFAULT_CONFIG;
  const distanceKm = Math.max(0, haversineKm(config.storeLat, config.storeLng, coords.lat, coords.lng));
  let zoneIndex = -1;
  for (let i = 0; i < config.zones.length; i++) {
    const z = config.zones[i];
    if (z.maxKm === null || distanceKm <= z.maxKm) {
      zoneIndex = i;
      break;
    }
  }
  if (zoneIndex === -1) zoneIndex = config.zones.length - 1;
  let fee = Number(config.zones[zoneIndex].price) || 0;
  if (config.raining) fee += Number(config.rainSurcharge) || 0;
  return { fee: Math.round(fee * 100) / 100, distanceKm: Math.round(distanceKm * 100) / 100, zoneIndex };
}

module.exports = { getDeliveryConfig, setDeliveryConfig, calcDelivery, haversineKm, DEFAULT_CONFIG, KEY_DELIVERY };