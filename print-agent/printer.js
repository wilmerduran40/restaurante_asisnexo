'use strict';

// Backends de impresión para el agente:
//  - tcp:  envía bytes ESC/POS a la ticketera de red (IP:9100, JetDirect).
//  - mock: simula la impresión (archivo + consola) para probar sin hardware.

const net = require('net');
const fs = require('fs');
const path = require('path');

const TCP_TIMEOUT_MS = 6000;

function printTcp(host, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => {
      socket.write(buffer);
      setTimeout(() => {
        socket.end();
        resolve();
      }, 350);
    });
    socket.on('error', reject);
    socket.setTimeout(TCP_TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error('Timeout TCP hacia la impresora (' + host + ':' + port + ')'));
    });
  });
}

// Verifica la conexión con la impresora abriendo un socket TCP a host:port y
// midiendo la latencia de conexión. Resuelve { ok: true, latencyMs } si el puerto
// responde, o { ok: false, error } si no hay conexión o se agota el timeout.
const PING_TIMEOUT_MS = 4000;

function tcpPing(host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect(port, host, () => {
      socket.destroy();
      resolve({ ok: true, latencyMs: Date.now() - started });
    });
    socket.setTimeout(PING_TIMEOUT_MS, () => {
      socket.destroy();
      resolve({ ok: false, error: 'Timeout TCP (' + host + ':' + port + ')' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ ok: false, error: err.code || err.message || 'error' });
    });
  });
}

// Recibe una comanda como string (un solo archivo) o una lista de tickets
// [{ label, text }] (una archivo por comanda, ej: caja, cocina, cliente).
function printMock(order, input) {
  const dir = path.join(__dirname, 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const items = Array.isArray(input)
    ? input
    : [{ label: 'pedido', text: input }];
  const files = items.map((t) => {
    const file = path.join(dir, `pedido-${order.id}-${t.label}.txt`);
    fs.writeFileSync(file, `==== Pedido #${order.id} (${stamp}) — ${t.label.toUpperCase()} ====\n${t.text}\n`);
    return file;
  });
  return { files, file: files[0] };
}

module.exports = { printTcp, printMock, tcpPing };