'use strict';

// Agente impresor de AsisNexo.
// Hace polling HTTPS a GET /api/orders/pending y envía cada pedido a la ticketera
// térmica de red (TCP IP:9100) o a un simulador (mock). Al imprimir confirma con ack.
//
// Variables de entorno:
//   API_URL         https://dominio.com            (obligatorio)
//   AGENT_TOKEN     token compartido con el VPS    (obligatorio)
//   PRINTER_HOST    192.168.1.50                   (fallback si el panel no configuró impresora)
//   PRINTER_PORT    9100                            (default 9100)
//   PRINTER_WIDTH   58 | 80                         (default 58)
//   PRINTER_MODE    tcp | mock                      (default tcp)
//   POLL_MS         8000                            (default 8000)
//   LOG_FILE        agente.log                      (opcional, apéndice)
//   SCAN_SUBNET     192.168.1.0/24                  (opcional, subred a escanear)
//   SCAN_PORT       9100                            (default 9100)
//
// La config de la impresora se puede gestionar desde el panel /admin (pestaña
// Impresora): el servidor la entrega en cada polling y tiene prioridad sobre las
// env vars. El panel también puede pedir un escaneo de red o una impresión de
// prueba, que este agente ejecuta en la red local y reporta de vuelta.
//
// Uso:
//   API_URL=... AGENT_TOKEN=... PRINTER_HOST=... node agent.js
//   PRINTER_MODE=mock node agent.js   (prueba sin impresora)

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

const API_URL = String(env('API_URL', '')).replace(/\/+$/, '');
const AGENT_TOKEN = env('AGENT_TOKEN', '');
const PRINTER_HOST = env('PRINTER_HOST', '');
const PRINTER_PORT = Number(env('PRINTER_PORT', '9100'));
const PRINTER_WIDTH = Number(env('PRINTER_WIDTH', '58'));
const PRINTER_MODE = env('PRINTER_MODE', 'tcp');
const POLL_MS = Math.max(1500, Number(env('POLL_MS', '8000')));
const LOG_FILE = env('LOG_FILE', '');
const SCAN_PORT = Number(env('SCAN_PORT', '9100'));

const escpos = require('./escpos');
const { printTcp, printMock, tcpPing } = require('./printer');
const { scan } = require('./scan');

function log(msg) {
  const line = '[' + new Date().toLocaleString('es-VE') + '] ' + msg;
  console.log(line);
  if (LOG_FILE) {
    try {
      require('fs').appendFileSync(LOG_FILE, line + '\n');
    } catch (e) {}
  }
}

function missingEnv() {
  const missing = [];
  if (!API_URL) missing.push('API_URL');
  if (!AGENT_TOKEN) missing.push('AGENT_TOKEN');
  return missing;
}

const missing = missingEnv();
if (missing.length) {
  console.error('Faltan variables de entorno: ' + missing.join(', '));
  console.error('Ejemplo: API_URL=https://dominio.com AGENT_TOKEN=xxx node agent.js');
  process.exit(1);
}

log(
  'Agente iniciado | API=' + API_URL +
  ' | ancho=' + PRINTER_WIDTH + 'mm' +
  ' | modo=' + PRINTER_MODE +
  ' | host=' + (PRINTER_MODE === 'mock' ? '(mock)' : (PRINTER_HOST || '(usara config del panel)') + ':' + PRINTER_PORT) +
  ' | poll=' + POLL_MS + 'ms' +
  (process.env.SCAN_SUBNET ? ' | scan=' + process.env.SCAN_SUBNET : '')
);

// Evita reimprimir el mismo id en ventanas cortas si el ack falla.
const printedRecently = new Map();
function recentlyPrinted(id) {
  const t = printedRecently.get(id);
  return t && Date.now() - t < 20000;
}

// Config de la impresora efectiva: la del servidor (panel /admin) cuando exista;
// si el servidor nunca configuró una, se usa la env (backward-compatible).
let serverPrinter = null;
function effectivePrinter() {
  if (serverPrinter) {
    return {
      enabled: !!serverPrinter.active && !!serverPrinter.host,
      host: serverPrinter.host,
      port: Number(serverPrinter.port) || 9100,
      width: Number(serverPrinter.width) === 80 ? 80 : 58,
    };
  }
  return {
    enabled: !!PRINTER_HOST,
    host: PRINTER_HOST,
    port: PRINTER_PORT,
    width: PRINTER_WIDTH,
  };
}

// Identificador del agente para reportar al servidor (IP local privada).
function selfId() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal &&
          /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address)) {
        return i.address;
      }
    }
  }
  return os.hostname();
}

async function fetchPending() {
  const res = await fetch(API_URL + '/api/orders/pending', {
    headers: { 'X-Agent-Token': AGENT_TOKEN },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function ackOrder(id) {
  const res = await fetch(API_URL + '/api/orders/' + id + '/ack', {
    method: 'POST',
    headers: {
      'X-Agent-Token': AGENT_TOKEN,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('ack HTTP ' + res.status);
}

async function handleOrder(order) {
  const id = order.id;
  if (recentlyPrinted(id)) {
    log('#' + id + ': ya impreso recientemente (esperando ack), se omite este ciclo');
    return;
  }
  printedRecently.set(id, Date.now());

  const p = effectivePrinter();
  if (!p.enabled) {
    log('#' + id + ': impresora sin configurar o desactivada en el panel, el pedido queda en cola');
    return;
  }

  const isDeliveryLike = order.deliveryType === 'delivery' || order.deliveryType === 'pickup';
  const plan = escpos.ticketPlan(order, p.width);
  const tickets = plan.map((t) => ({ label: t.label, text: escpos.textRender(t.lines) }));

  if (PRINTER_MODE === 'mock') {
    const r = printMock(order, tickets);
    log('#' + id + ': COMANDA(S) IMPRESA(S) (mock) -> ' + r.files.join(', ') + '\n' +
        tickets.map((t) => '===== ' + t.label.toUpperCase() + ' =====\n' + t.text).join('\n') + '\n');
  } else {
    const bytes = escpos.buildOrderBytes(order, p.width);
    try {
      await printTcp(p.host, p.port, bytes);
      log('#' + id + ': ' + tickets.length + ' comanda(s) (caja/cocina' + (isDeliveryLike ? '/cliente' : '') + ') enviadas a la impresora (' + p.host + ':' + p.port + ')');
    } catch (err) {
      log('#' + id + ': ERROR de impresion -> ' + err.message + ' (se reintentara en el proximo ciclo)');
      return;
    }
  }

  try {
    await ackOrder(id);
    log('#' + id + ': ack enviado (pedido marcado como impreso)');
  } catch (err) {
    log('#' + id + ': WARN no se pudo confirmar ack -> ' + err.message);
  }
}

async function postResult(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: {
      'X-Agent-Token': AGENT_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(path + ' HTTP ' + res.status);
  return res.json();
}

// Comandos del panel: escanear la red, imprimir un ticket de prueba o hacer ping.
let scanInProgress = false;
async function handleRemoteCommand(command, isPing) {
  if (scanInProgress) {
    log('Ya hay un escaneo/prueba/ping en curso, se omite la nueva solicitud');
    return;
  }
  scanInProgress = true;
  try {
    if (isPing) await runPing(command);
    else if (command && command.test) await runTestPrint(command.printer);
    else await runScan();
  } catch (err) {
    log('Fallo en la solicitud del panel: ' + err.message);
  } finally {
    scanInProgress = false;
  }
}

async function runScan() {
  log('Escaneo de red solicitado desde el panel /admin.');
  if (PRINTER_MODE === 'mock') {
    log('Modo mock: no se escanea la red real. Se reporta vacio.');
    await postResult('/api/agent/scan-result', { agent: selfId(), subnet: null, found: [] });
    return;
  }
  const result = await scan(SCAN_PORT);
  if (!result.subnet) {
    log('No se detecto una subred local para escanear. Prueba SCAN_SUBNET=192.168.1.0/24');
  } else {
    log('Escaneo de ' + result.subnet + ' completado: ' + result.found.length +
        ' dispositivo(s) con puerto ' + SCAN_PORT + ' abierto');
    for (const f of result.found) log('  - ' + f.ip + ' (' + f.status + ')');
  }
  await postResult('/api/agent/scan-result', {
    agent: selfId(),
    subnet: result.subnet,
    found: result.found.map((f) => f.ip),
  });
}

async function runTestPrint(targetPrinter) {
  // Si el panel envió la impresora objetivo (host/puerto/ancho), la usa tal cual,
  // aunque todavía no esté marcada como activa (permite probar antes de activar).
  const p = targetPrinter && targetPrinter.host ? {
    enabled: true,
    host: targetPrinter.host,
    port: Number(targetPrinter.port) || 9100,
    width: Number(targetPrinter.width) === 80 ? 80 : 58,
  } : effectivePrinter();
  log('Prueba de impresion solicitada desde el panel /admin.');
  try {
    if (PRINTER_MODE === 'mock') {
      printMock({ id: 'PRUEBA' }, escpos.textRender(escpos.testTicketLines(p.width)));
      log('Ticket de prueba impreso en modo mock');
    } else {
      if (!p.enabled) throw new Error('impresora sin configurar o desactivada en el panel');
      await printTcp(p.host, p.port, escpos.buildTestBytes(p.width));
      log('Ticket de prueba enviado a la impresora (' + p.host + ':' + p.port + ')');
    }
    await postResult('/api/agent/test-result', { ok: true });
  } catch (err) {
    log('ERROR en la prueba de impresion -> ' + err.message);
    try {
      await postResult('/api/agent/test-result', { ok: false, error: err.message });
    } catch (e) {}
  }
}

// Ping de conexión a una impresora solicitado desde el panel /admin.
async function runPing(request) {
  const printer = request && request.printer;
  const printerId = request && request.printerId;
  const target = printer && printer.host ? {
    host: printer.host,
    port: Number(printer.port) || 9100,
  } : effectivePrinter();
  log('Ping de conexion solicitado desde el panel /admin -> ' + target.host + ':' + target.port);
  try {
    if (PRINTER_MODE === 'mock') {
      log('Modo mock: ping reportado como ok (sin conexion real).');
      await postResult('/api/agent/ping-result', { printerId, ok: true, latencyMs: 0 });
      return;
    }
    const r = await tcpPing(target.host, target.port);
    if (r.ok) {
      log('Ping OK -> ' + target.host + ':' + target.port + ' (' + r.latencyMs + ' ms)');
      await postResult('/api/agent/ping-result', { printerId, ok: true, latencyMs: r.latencyMs });
    } else {
      log('Ping FALLIDO -> ' + target.host + ':' + target.port + ' (' + r.error + ')');
      await postResult('/api/agent/ping-result', { printerId, ok: false, error: r.error });
    }
  } catch (err) {
    log('ERROR en el ping -> ' + err.message);
    try {
      await postResult('/api/agent/ping-result', { printerId, ok: false, error: err.message });
    } catch (e) {}
  }
}

// Imprime el resumen diario solicitado desde el panel /admin (Estadísticas).
async function handleSummaryPrint(request) {
  if (scanInProgress) {
    log('Resumen del dia: hay un escaneo/prueba en curso, se reintenta en el proximo ciclo');
    return;
  }
  const p = effectivePrinter();
  const date = (request && request.date) || '';
  if (!p.enabled) {
    log('Resumen del dia ' + date + ': impresora sin configurar o desactivada en el panel');
    try { await postResult('/api/agent/summary-result', { ok: false, error: 'impresora sin configurar o desactivada en el panel' }); } catch (e) {}
    return;
  }
  const summary = request && request.summary;
  if (!summary) {
    log('Resumen del dia ' + date + ': sin datos de resumen en la solicitud');
    try { await postResult('/api/agent/summary-result', { ok: false, error: 'sin datos de resumen' }); } catch (e) {}
    return;
  }
  log('Resumen del dia ' + date + ' solicitado desde el panel /admin.');
  try {
    if (PRINTER_MODE === 'mock') {
      const r = printMock({ id: 'RESUMEN-' + date }, escpos.textRender(escpos.formatSummary(summary, p.width)));
      log('Resumen del dia ' + date + ' impreso (mock) -> ' + r.file);
    } else {
      await printTcp(p.host, p.port, escpos.buildSummaryBytes(summary, p.width));
      log('Resumen del dia ' + date + ' enviado a la impresora (' + p.host + ':' + p.port + ')');
    }
    await postResult('/api/agent/summary-result', { ok: true });
    log('Resumen del dia ' + date + ': resultado ok enviado');
  } catch (err) {
    log('ERROR imprimiendo resumen del dia -> ' + err.message);
    try {
      await postResult('/api/agent/summary-result', { ok: false, error: err.message });
    } catch (e) {}
  }
}

async function pollOnce() {
  let data = null;
  try {
    data = await fetchPending();
  } catch (err) {
    log('Error consultando cola: ' + err.message);
  }
  if (!data) return;

  if (data.printer) serverPrinter = data.printer;
  else serverPrinter = null;

  if (data.scanRequest) {
    handleRemoteCommand(data.scanRequest);
  }

  if (data.pingRequest) {
    handleRemoteCommand(data.pingRequest, true);
  }

  if (data.summaryRequest) {
    handleSummaryPrint(data.summaryRequest);
  }

  const orders = Array.isArray(data.orders) ? data.orders : [];
  for (const order of orders) {
    try {
      await handleOrder(order);
    } catch (err) {
      log('#' + order.id + ': error inesperado -> ' + err.message);
    }
  }
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  log('Agente detenido.');
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

(async function loop() {
  while (!stopping) {
    await pollOnce();
    if (!stopping) await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();