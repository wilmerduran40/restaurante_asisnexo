'use strict';

// Construcción de tickets ESC/POS para ticketeras térmicas de red (JetDirect, puerto 9100).
// Puro Node.js, sin dependencias. Ancho configurable: 58mm (32 cols) u 80mm (48 cols).

const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  init: Buffer.from([ESC, 0x40]), // ESC @
  center: Buffer.from([ESC, 0x61, 0x01]), // ESC a 1
  left: Buffer.from([ESC, 0x61, 0x00]), // ESC a 0
  boldOn: Buffer.from([ESC, 0x45, 0x01]), // ESC E 1
  boldOff: Buffer.from([ESC, 0x45, 0x00]), // ESC E 0
  feed: (n) => Buffer.from([ESC, 0x64, n || 1]), // ESC d n
  cut: Buffer.from([GS, 0x56, 0x42, 0x00]), // GS V 66 0 (full cut)
  beep: Buffer.from([ESC, 0x28, 0x41, 0x04, 0x00, 0x04]), // ESC ( A t=4 n=4
};

function widthFor(mm) {
  return mm === 80 ? 48 : 32;
}

// Limpia caracteres que una termica latin1 no entiende (emojis, glifos raros).
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\x20-\xff]/g, '')
    .trim();
}

function centerLine(s, w) {
  const line = clean(s).slice(0, w);
  const pad = Math.max(0, w - line.length);
  return ' '.repeat(Math.floor(pad / 2)) + line + ' '.repeat(pad - Math.floor(pad / 2));
}
function leftPad(s, w) {
  const line = clean(s).slice(0, w);
  return (line + ' '.repeat(w)).slice(0, w);
}
function rightPad(s, w) {
  const line = clean(s).slice(0, w);
  return ' '.repeat(Math.max(0, w - line.length)) + line;
}
function divider(w, ch) {
  ch = ch || '=';
  return ch.repeat(w);
}

// Corta un texto largo en varias líneas de ancho w respetando espacios.
// Si una palabra es más larga que w, la parte en trozos para no desbordar.
function wrap(text, w) {
  const words = clean(text).split(/\s+/);
  const out = [];
  let cur = '';
  const pushWord = (word) => {
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= w) cur += ' ' + word;
    else { out.push(cur); cur = word; }
  };
  for (const word of words) {
    if (!word) continue;
    if (word.length > w) {
      if (cur) { out.push(cur); cur = ''; }
      let rest = word;
      while (rest.length > w) { out.push(rest.slice(0, w)); rest = rest.slice(w); }
      cur = rest;
    } else {
      pushWord(word);
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

const DELIVERY_LABEL = { delivery: 'Delivery', pickup: 'Para llevar (pickup)', local: 'En el local' };

// Devuelve las líneas de texto legible del ticket (también útil para mock-printer).
function formatTicket(order, width) {
  const w = widthFor(width);
  const lines = [{ text: '', bold: false, center: true }];
  lines.push({ text: centerLine("ASISNEXO", w), bold: true, center: true });
  lines.push({ text: centerLine('Socopó / Barinas - Venezuela', w), bold: false, center: true });
  lines.push({ text: centerLine('Tel: 0412 445 4904', w), bold: false, center: true });
  lines.push({ text: centerLine('COMANDA CAJA', w), bold: true, center: true });
  lines.push({ text: divider(w), bold: false, center: false });

  const date = new Date(order.createdAt);
  const stamp =
    date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) + ' ' +
    date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  lines.push({ text: 'No: ' + String(order.id).padStart(4, '0') + '  ' + stamp, bold: false });

  lines.push({ text: 'Cliente: ' + clean(order.name), bold: true });
  lines.push({ text: 'Entrega: ' + (DELIVERY_LABEL[order.deliveryType] || order.deliveryType) });
  if (order.tableNo) lines.push({ text: 'Mesa: ' + order.tableNo, bold: true });
  if (order.address) {
    for (const l of wrap('Direccion: ' + order.address, w)) lines.push({ text: l });
  }
  if (order.gmapsUrl) {
    for (const l of wrap('Maps: ' + order.gmapsUrl, w)) lines.push({ text: l });
  }
  if (order.phone) lines.push({ text: 'Telefono: ' + clean(order.phone) });
  if (order.source === 'mesero' && order.waiter) lines.push({ text: 'Mesero: ' + clean(order.waiter), bold: true });
  lines.push({ text: 'Pago: ' + clean(order.paymentMethod || 'A convenir') });

  const unpaidPickup = (order.deliveryType === 'pickup' || order.deliveryType === 'local') && !order.paidAt;
  if (order.paidAt) {
    lines.push({ text: centerLine('*** PAGADO ***', w), bold: true, center: true });
  } else if (unpaidPickup) {
    lines.push({ text: centerLine('POR COBRAR EN LOCAL', w), bold: true, center: true });
  } else {
    lines.push({ text: centerLine('PENDIENTE DE PAGO', w), bold: false, center: true });
  }

  lines.push({ text: divider(w), bold: false });
  for (const it of order.items || []) {
    const total = (it.qty * it.unitPrice).toFixed(2);
    const headline = it.qty + 'x ' + clean(it.name);
    if (headline.length > w - 7) {
      lines.push({ text: headline.slice(0, w - 7) + '  ' + rightPad(total, 5), bold: true });
    } else {
      lines.push({ text: leftPad(headline, w - 7) + rightPad(total, 7), bold: true });
    }
    const who = it.label ? ('Orden ' + (it.orden || '') + ' - ' + clean(it.label)) : (it.orden ? 'Orden ' + it.orden : null);
    if (who) lines.push({ text: '  ' + who });
    if (it.takeaway) lines.push({ text: '  *** PARA LLEVAR ***', bold: true });
    if (it.variant) lines.push({ text: '  Proteina: ' + clean(it.variant) });
    if (it.removed && it.removed.length) lines.push({ text: '  Sin: ' + clean(it.removed.join(', ')) });
    if (it.extras && it.extras.length) lines.push({ text: '  Extra: ' + clean(it.extras.map((e) => e.name).join(', ')) });
    if (it.notes) {
      for (const l of wrap('  Nota: ' + it.notes, w)) lines.push({ text: l });
    }
  }

  lines.push({ text: divider(w), bold: false });
  if (order.deliveryType === 'delivery') {
    if (order.deliveryFee) {
      lines.push({
        text: leftPad('ENVIO', w - 11) + rightPad('$' + Number(order.deliveryFee).toFixed(2), 11),
        bold: false,
      });
    }
    if (order.distanceKm) {
      lines.push({ text: 'Distancia: ~' + Number(order.distanceKm).toFixed(1) + ' km', bold: false });
    }
  }
  lines.push({
    text: leftPad('TOTAL', w - 11) + rightPad('$' + Number(order.total).toFixed(2), 11),
    bold: true,
  });
  lines.push({ text: 'Pago: ' + clean(order.paymentMethod || 'A convenir') });
  lines.push({ text: centerLine('Gracias por tu pedido!', w), bold: false, center: true });
  lines.push({ text: '', bold: false });

  return lines;
}

// Número de orden efectivo de un item (si no trae orden se numera por posición).
function itemOrden(it, index) {
  return it.orden || (index + 1);
}

// Agrupa los items del pedido para imprimir una comanda por grupo:
//  - Local: los items de consumo en el local forman la comanda "MESA N"; cada
//    item marcado "para llevar" forma su propia comanda "PARA LLEVAR".
//  - Delivery/Pickup: cada orden (nombre o número) forma su propia comanda para
//    identificar de quién es cada comida cuando varias van en la misma bolsa.
function groupItems(order) {
  const items = order.items || [];
  const isLocal = order.deliveryType === 'local';
  const groups = [];

  if (isLocal) {
    const dineIn = [];
    const togoByKey = new Map();
    items.forEach((it, idx) => {
      if (it.takeaway) {
        const key = it.label ? 'L' + it.label : 'O' + itemOrden(it, idx);
        if (!togoByKey.has(key)) {
          togoByKey.set(key, { key, togo: true, label: it.label, orden: itemOrden(it, idx), items: [] });
        }
        togoByKey.get(key).items.push(it);
      } else {
        dineIn.push(it);
      }
    });
    if (dineIn.length) {
      groups.push({
        key: 'mesa',
        togo: false,
        title: 'MESA' + (order.tableNo ? ' ' + order.tableNo : ''),
        items: dineIn,
      });
    }
    for (const g of togoByKey.values()) {
      g.title = 'PARA LLEVAR' + (g.label ? ' - ' + g.label : '') + ' (Orden ' + g.orden + ')';
      groups.push(g);
    }
  } else {
    const byKey = new Map();
    items.forEach((it, idx) => {
      const key = it.label ? 'L' + it.label : 'O' + itemOrden(it, idx);
      if (!byKey.has(key)) {
        byKey.set(key, { key, togo: true, label: it.label, orden: itemOrden(it, idx), items: [] });
      }
      byKey.get(key).items.push(it);
    });
    for (const g of byKey.values()) {
      g.title = g.label ? (g.label + ' (Orden ' + g.orden + ')') : ('Orden ' + g.orden);
      groups.push(g);
    }
  }

  return groups;
}

// Líneas con los modificadores de un item para una comanda de cocina.
function kitchenItemLines(w, it) {
  const out = [];
  out.push({ text: it.qty + 'x ' + clean(it.name), bold: true });
  if (it.variant) out.push({ text: '  Proteina: ' + clean(it.variant) });
  if (it.removed && it.removed.length) out.push({ text: '  Sin: ' + clean(it.removed.join(', ')) });
  if (it.extras && it.extras.length) out.push({ text: '  Extra: ' + clean(it.extras.map((e) => e.name).join(', ')) });
  if (it.notes) {
    for (const l of wrap('  Nota: ' + it.notes, w)) out.push({ text: l });
  }
  return out;
}

// Comanda de cocina: solo lo que necesita preparar la cocina. Sin precios,
// sin total y sin datos del cliente; solo #pedido, tipo de entrega y los items
// con sus modificadores (proteina, SIN, extras, notas).
function formatKitchenTicket(order, width) {
  const w = widthFor(width);
  const lines = [
    { text: '', bold: false, center: true },
    { text: centerLine("ASISNEXO", w), bold: true, center: true },
    { text: centerLine('COMANDA COCINA', w), bold: true, center: true },
    { text: centerLine('No: ' + String(order.id).padStart(4, '0'), w), bold: true, center: true },
    { text: centerLine('Entrega: ' + (DELIVERY_LABEL[order.deliveryType] || order.deliveryType), w), bold: true, center: true },
  ];
  if (order.tableNo) {
    lines.push({ text: centerLine('Mesa: ' + order.tableNo, w), bold: true, center: true });
  }
  lines.push({ text: divider(w), bold: false, center: false });
  for (const it of order.items || []) {
    lines.push(...kitchenItemLines(w, it));
  }
  lines.push({ text: divider(w), bold: false });
  lines.push({ text: '', bold: false });

  return lines;
}

// Comanda de cocina de UN grupo de items (una orden / para llevar / mesa).
// Encabezado con el título del grupo para que la cocina sepa qué va en cada
// bolsa o qué es consumo en el local.
function formatKitchenGroupTicket(order, group, width) {
  const w = widthFor(width);
  const lines = [
    { text: '', bold: false, center: true },
    { text: centerLine("ASISNEXO", w), bold: true, center: true },
    { text: centerLine('COMANDA COCINA', w), bold: true, center: true },
    { text: centerLine('No: ' + String(order.id).padStart(4, '0'), w), bold: true, center: true },
    { text: centerLine('Entrega: ' + (DELIVERY_LABEL[order.deliveryType] || order.deliveryType), w), bold: true, center: true },
  ];
  if (order.tableNo) {
    lines.push({ text: centerLine('Mesa: ' + order.tableNo, w), bold: true, center: true });
  }
  lines.push({ text: centerLine(group.title, w), bold: true, center: true });
  lines.push({ text: divider(w), bold: false, center: false });
  for (const it of group.items) {
    lines.push(...kitchenItemLines(w, it));
  }
  lines.push({ text: divider(w), bold: false });
  lines.push({ text: '', bold: false });

  return lines;
}

// Ticket de cliente: etiqueta corta para identificar el pedido al entregarlo.
// Solo se imprime para delivery / para llevar (se engrapa o pega al pedido).
function formatCustomerTicket(order, width) {
  const w = widthFor(width);
  const nItems = (order.items || []).reduce((s, it) => s + it.qty, 0);
  const lines = [
    { text: '', bold: false, center: true },
    { text: centerLine("ASISNEXO", w), bold: true, center: true },
    { text: centerLine('TICKET CLIENTE', w), bold: false, center: true },
    { text: centerLine('No: ' + String(order.id).padStart(4, '0'), w), bold: true, center: true },
    { text: centerLine('Entrega: ' + (DELIVERY_LABEL[order.deliveryType] || order.deliveryType), w), bold: true, center: true },
    { text: centerLine('Cliente: ' + clean(order.name), w), bold: true, center: true },
    { text: centerLine(String(nItems) + ' producto(s)', w), bold: false, center: true },
  ];
  for (const it of order.items || []) {
    lines.push({ text: divider(w), bold: false });
    lines.push(...kitchenItemLines(w, it));
  }
  lines.push({ text: divider(w), bold: false });
  lines.push({ text: centerLine('Total: $' + Number(order.total).toFixed(2), w), bold: true, center: true });
  lines.push({ text: divider(w, '-'), bold: false });
  lines.push({ text: '', bold: false });
  return lines;
}

// Etiqueta de UN grupo "para llevar": identifica de quién es cada comida dentro
// de la misma bolsa (se engrapa/pega en cada paquete o bolsa del grupo).
function formatLabelTicketForGroup(order, group, width) {
  const w = widthFor(width);
  const nItems = group.items.reduce((s, it) => s + it.qty, 0);
  const groupTotal = group.items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const lines = [
    { text: '', bold: false, center: true },
    { text: centerLine("ASISNEXO", w), bold: true, center: true },
    { text: centerLine('TICKET CLIENTE', w), bold: false, center: true },
    { text: centerLine('No: ' + String(order.id).padStart(4, '0'), w), bold: true, center: true },
    { text: centerLine(group.title, w), bold: true, center: true },
    { text: centerLine('Cliente: ' + clean(order.name), w), bold: true, center: true },
    { text: centerLine(String(nItems) + ' producto(s)', w), bold: false, center: true },
  ];
  for (const it of group.items) {
    lines.push({ text: divider(w), bold: false });
    lines.push(...kitchenItemLines(w, it));
  }
  lines.push({ text: divider(w), bold: false });
  lines.push({ text: centerLine('Subtotal: $' + groupTotal.toFixed(2), w), bold: true, center: true });
  lines.push({ text: divider(w, '-'), bold: false });
  lines.push({ text: '', bold: false });
  return lines;
}

// Plan de impresión de un pedido: 1 caja + 1 comanda de cocina por grupo + 1
// etiqueta por grupo "para llevar" (delivery/pickup y los grupos para llevar de
// una mesa). Se usa tanto para el modo mock como para generar los bytes.
function ticketPlan(order, width) {
  const groups = groupItems(order);
  const plan = [{ label: 'caja', lines: formatTicket(order, width) }];
  groups.forEach((g, i) => {
    plan.push({
      label: 'cocina' + (groups.length > 1 ? '-' + (i + 1) : ''),
      lines: formatKitchenGroupTicket(order, g, width),
    });
    if (g.togo) {
      plan.push({ label: 'cliente-' + (i + 1), lines: formatLabelTicketForGroup(order, g, width) });
    }
  });
  return plan;
}

// Convierte las líneas de un ticket en bytes ESC/POS (con su propio corte).
function linesToBytes(lines) {
  const parts = [CMD.init];
  for (const line of lines) {
    parts.push(line.center ? CMD.center : CMD.left);
    if (line.bold) parts.push(CMD.boldOn);
    parts.push(Buffer.from(line.text || ' ', 'latin1')); // linea completa (ya con padding)
    parts.push(Buffer.from('\n', 'latin1'));
    if (line.bold) parts.push(CMD.boldOff);
  }
  parts.push(CMD.feed(4));
  parts.push(CMD.cut);
  return Buffer.concat(parts);
}

// Comanda de caja (recibo completo), una sola impresión.
function buildBytes(order, mm) {
  const parts = [linesToBytes(formatTicket(order, mm))];
  parts.push(CMD.beep);
  return Buffer.concat(parts);
}

// Comandas del pedido en un solo envío a la ticketera, en orden:
// caja -> comandas de cocina por grupo -> etiquetas de los grupos para llevar.
// Cada comanda se corta aparte para poder desprenderla por separado.
function buildOrderBytes(order, mm) {
  const parts = ticketPlan(order, mm).map((t) => linesToBytes(t.lines));
  parts.push(CMD.beep);
  return Buffer.concat(parts);
}

function textRender(lines) {
  return lines.map((l) => l.text.trimEnd ? l.text : l.text).join('\n');
}

// Ticket de prueba: confirma en el papel que la impresora configurada es la
// correcta (accede desde el panel /admin -> "Imprimir prueba").
function testTicketLines(width) {
  const w = widthFor(width);
  const now = new Date();
  const lines = [
    { text: '', bold: false },
    { text: centerLine("ASISNEXO", w), bold: true, center: true },
    { text: centerLine('PRUEBA DE IMPRESORA', w), bold: true, center: true },
    { text: divider(w, '-'), bold: false },
    ...wrap('Si puedes leer este ticket, la impresora esta bien configurada y lista para recibir las comandas.', w)
      .map((text) => ({ text, bold: false })),
    { text: divider(w, '-'), bold: false },
    { text: centerLine(now.toLocaleDateString('es-VE') + ' ' + now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }), w), bold: false, center: true },
    { text: '', bold: false },
  ];
  return lines;
}

function buildTestBytes(mm) {
  const lines = testTicketLines(mm);
  const parts = [CMD.init];
  for (const line of lines) {
    parts.push(line.center ? CMD.center : CMD.left);
    if (line.bold) parts.push(CMD.boldOn);
    parts.push(Buffer.from(line.text || ' ', 'latin1'));
    parts.push(Buffer.from('\n', 'latin1'));
    if (line.bold) parts.push(CMD.boldOff);
  }
  parts.push(CMD.feed(4));
  parts.push(CMD.cut);
  parts.push(CMD.beep);
  return Buffer.concat(parts);
}

const SOURCE_LABEL = { web: 'Web', mesero: 'Mesero' };
const SUMMARY_DELIVERY_LABEL = { delivery: 'Delivery', pickup: 'Para llevar', local: 'En el local' };
const money = (n) => '$' + Number(n || 0).toFixed(2);

function entryRow(label, count, revenue, w) {
  const right = String(count) + '  ' + money(revenue);
  return leftPad(clean(label), w - 12) + rightPad(right, 12);
}

// Ticket del resumen diario (lo genera el servidor y lo imprime el agente).
function formatSummary(summary, width) {
  const w = widthFor(width);
  const date = String(summary && summary.date || '');
  const dd = date ? date.slice(8) + '/' + date.slice(5, 7) + '/' + date.slice(0, 4) : '';
  const t = (summary && summary.totals) || {};

  const lines = [
    { text: '', bold: false },
    { text: centerLine("ASISNEXO", w), bold: true, center: true },
    { text: centerLine('RESUMEN DEL DIA', w), bold: true, center: true },
    { text: centerLine(dd, w), bold: false, center: true },
    { text: divider(w), bold: false },
    { text: 'Pedidos: ' + String(t.total == null ? 0 : t.total), bold: true },
    { text: 'Ingresos: ' + money(t.revenue), bold: true },
    { text: 'Pendientes: ' + String(t.pending == null ? 0 : t.pending) },
    { text: 'Anulados: ' + String(t.cancelled == null ? 0 : t.cancelled) },
    { text: divider(w), bold: false },
  ];

  const deliv = (summary && summary.byDelivery) || [];
  if (deliv.length) {
    lines.push({ text: centerLine('POR ENTREGA', w), bold: true, center: true });
    for (const d of deliv) {
      lines.push({ text: entryRow(SUMMARY_DELIVERY_LABEL[d.type] || d.type, d.count, d.revenue, w) });
    }
    lines.push({ text: divider(w, '-'), bold: false });
  }

  const src = (summary && summary.bySource) || [];
  if (src.length) {
    lines.push({ text: centerLine('POR ORIGEN', w), bold: true, center: true });
    for (const s of src) {
      lines.push({ text: entryRow(SOURCE_LABEL[s.source] || s.source, s.count, s.revenue, w) });
    }
    lines.push({ text: divider(w, '-'), bold: false });
  }

  const pays = (summary && summary.byPayment) || [];
  if (pays.length) {
    lines.push({ text: centerLine('METODOS DE PAGO', w), bold: true, center: true });
    for (const p of pays) {
      lines.push({ text: entryRow(p.method, p.count, p.revenue, w) });
    }
    lines.push({ text: divider(w, '-'), bold: false });
  }

  const top = (summary && summary.top) || [];
  if (top.length) {
    lines.push({ text: centerLine('TOP PRODUCTOS', w), bold: true, center: true });
    for (const p of top) {
      const nameStr = clean(p.name);
      const meta = ' x' + String(p.qty || 0);
      let left = nameStr + meta;
      if (left.length > w - 7) left = nameStr.slice(0, Math.max(0, w - 7 - meta.length)) + meta;
      lines.push({ text: leftPad(left, w - 7) + rightPad(money(p.revenue), 7) });
    }
  }

  lines.push({ text: divider(w), bold: false });
  lines.push({ text: centerLine('Gracias por tu pedido!', w), bold: false, center: true });
  lines.push({ text: '', bold: false });

  return lines;
}

function buildSummaryBytes(summary, mm) {
  const lines = formatSummary(summary, mm);
  const parts = [CMD.init];
  for (const line of lines) {
    parts.push(line.center ? CMD.center : CMD.left);
    if (line.bold) parts.push(CMD.boldOn);
    parts.push(Buffer.from(line.text || ' ', 'latin1'));
    parts.push(Buffer.from('\n', 'latin1'));
    if (line.bold) parts.push(CMD.boldOff);
  }
  parts.push(CMD.feed(4));
  parts.push(CMD.cut);
  parts.push(CMD.beep);
  return Buffer.concat(parts);
}

module.exports = { formatTicket, formatKitchenTicket, formatKitchenGroupTicket, formatLabelTicketForGroup, formatCustomerTicket, groupItems, ticketPlan, buildBytes, buildOrderBytes, textRender, testTicketLines, buildTestBytes, formatSummary, buildSummaryBytes, CMD, widthFor };