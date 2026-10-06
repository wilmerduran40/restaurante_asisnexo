'use strict';

// Escaneo de la red local para encontrar la ticketera térmica de red (puerto 9100).
// Sin dependencias: solo Node (net + os). Detecta la subred /24 del equipo y
// probada cada IP con TCP. Si la impresora responde a una consulta de estado
// ESC/POS (GS r 1), la marca como 'confirmed'; si no, queda como 'open'.

const net = require('net');
const os = require('os');

const CONCURRENCY = 64;
const CONNECT_TIMEOUT_MS = 400;
const STATUS_TIMEOUT_MS = 350;

const isPrivate = (ip) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && !ip.startsWith('127.');

function base24(ip) {
  return ip.split('.').slice(0, 3).join('.');
}

// Subred a escanear: override por env SCAN_SUBNET (formato 192.168.1.0/24) o la
// primera interfaz IPv4 privada (no loopback) del equipo.
function localSubnet() {
  const override = process.env.SCAN_SUBNET;
  if (override) {
    const m = String(override).trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/24$/);
    if (m && m[1].split('.').every((p) => Number(p) <= 255)) return base24(m[1]);
  }
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (isPrivate(iface.address)) return base24(iface.address);
    }
  }
  return null;
}

function probe(ip, port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, ip);
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => settle(false), CONNECT_TIMEOUT_MS);
    socket.on('error', () => { clearTimeout(timer); settle(false); });
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.write(Buffer.from([0x1d, 0x72, 0x01])); // GS r 1: estado de papel
      let gotData = false;
      socket.on('data', () => { gotData = true; });
      socket.on('error', () => settle('open'));
      setTimeout(() => settle(gotData ? 'confirmed' : 'open'), STATUS_TIMEOUT_MS);
    });
  });
}

// Escanea .1 .. .254 de la subred; devuelve { subnet, found: [{ip, status}] }.
async function scan(port) {
  const subnet = localSubnet();
  if (!subnet) return { subnet: null, found: [] };

  const hosts = [];
  for (let i = 1; i <= 254; i++) hosts.push(subnet + '.' + i);

  const found = [];
  let cursor = 0;
  const workers = Array(Math.min(CONCURRENCY, hosts.length))
    .fill(0)
    .map(async () => {
      while (cursor < hosts.length) {
        const ip = hosts[cursor++];
        const status = await probe(ip, port);
        if (status) found.push({ ip, status });
      }
    });
  await Promise.all(workers);

  found.sort((a, b) => Number(a.ip.split('.').pop()) - Number(b.ip.split('.').pop()));
  return { subnet, found };
}

module.exports = { scan, localSubnet };