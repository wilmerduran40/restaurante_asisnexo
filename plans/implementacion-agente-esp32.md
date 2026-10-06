# Plan: Agente impresor en ESP32 (MicroPython) para XP-N200L

> Plan guardado para ejecutar más adelante. Fecha: 2026-09-24.

## Objetivo

Que la impresora térmica **XP-N200L** (variante USB + Ethernet/RJ45, ancho **80mm**)
no dependa de ninguna PC: un **ESP32** dedicado (siempre encendido, USB cargador)
recibe las comandas del backend (VPS) y las envía a la impresora por IP local
(puerto 9100, ESC/POS). Los pedidos se siguen mandando desde cualquier celular
(cliente con `menu.html` o mesero con el panel `/admin`).

## Arquitectura final

```
Celulares (clientes) ──► VPS (cola en_cola) ◄── panel /admin desde tu celular
                               ▲  polling HTTPS 10s (X-Agent-Token)
                        ESP32 DevKit (MicroPython, WiFi, USB cargador)
                               │  TCP 192.168.x.x:9100 (ESC/POS)
                               ▼
                    XP-N200L (RJ45 → router, ancho 80mm)
```

- El ESP32 está en el mismo WiFi del router donde está conectada la impresora:
  alcanza la IP local de la impresora por TCP **y** a internet para hablar con el VPS.
- El RJ45 de la impresora es **solo red local**; eso no es problema: el ESP32 es quien
  tiene internet (WiFi).
- El panel `/admin` sigue gestionando la impresora desde el celular y el ESP32
  **respeta esa config** (IP/ancho) sin reflashear.

## Decisiones tomadas

- Lenguaje del firmware: **MicroPython**.
- Modelo: **ESP32 clásico / DevKit**.
- Alcance: **mínimo** (imprimir comandas de la cola + ticket de prueba). Sin escaneo
  de red real y sin resumen diario en el firmware.

## Archivos a crear (carpeta nueva `print-agent-esp32/`)

| Archivo | Contenido |
|---|---|
| `main.py` | Bucle principal: WiFi + reconexión → polling `GET /api/orders/pending` → por pedido construir ticket → socket TCP `IP:9100` → enviar → ack solo si envió → sleep 10s. Maneja pedido de **prueba** y responde escaneo como vacío. |
| `escpos.py` | Port de `escpos.js` a MicroPython: `clean`, `wrap`, `centerLine/leftPad/rightPad`, `formatTicket(order, 80)`, `buildBytes(lines)` (init, center, bold, feed, cut, beep) y ticket de prueba. |
| `config.py` | `WIFI_SSID`, `WIFI_PASSWORD`, `API_URL`, `AGENT_TOKEN`, `PRINTER_HOST`, `PRINTER_PORT=9100`, `PRINTER_WIDTH=80`, `POLL_MS=10000`. |
| `README.md` | Lista de materiales, flasheo de MicroPython (Thonny/esptool), copia de archivos, edición de config, prueba, solución de problemas. |

## Lógica clave (replica del agente Node, versión mínima)

- **Ack correcto**: solo `POST /api/orders/:id/ack` si el envío TCP a la impresora fue
  exitoso. Si la impresora está apagada → el pedido queda en cola y se reintenta (sin ack).
  Guardar los IDs recién impresos (~20s) para evitar doble impresión si el ack falla.
- **Config del panel > config.py**: si el servidor devuelve `printer` con `active` y `host`,
  usa esa IP/puerto/ancho; si no, usa `config.py`.
- **Prueba del panel**: al recibir `scanRequest.test`, imprimir ticket de prueba y reportar
  `POST /api/agent/test-result`. Un escaneo normal (no test) responde vacío para que el
  panel no se quede esperando.
- **Resumen diario**: fuera de alcance (lo sigue cubriendo el agente Node si algún día se necesita).
- **Robustez**: reconexión automática de WiFi, cierre de sockets/respuestas, `try/except`
  para que el bucle nunca muera, `gc.collect()` periódico.

## Consideraciones técnicas

- **HTTPS/TLS**: `urequests` funciona contra el dominio Let's Encrypt sin verificar
  certificado (comportamiento por defecto de MicroPython). Aceptable para el WiFi del local;
  documentar cómo añadir verificación de CA después si se desea.
- **Memoria**: tickets de 2–4 KB, sobra en un ESP32 clásico.
- **Tiempo de respuesta**: el VPS no cambia nada; `GET /api/orders/pending` y los ack son
  idénticos a los que hoy usa el agente Node.

## Puesta a punto (sin cambios en el VPS)

1. Conectar la XP-N200L al router por RJ45; asignarle **IP fija** en el router (reserva DHCP).
2. Flashear MicroPython en el ESP32, subir los archivos, editar `config.py`.
3. Desde el panel `/admin` → **Impresora** → poner IP y **ancho 80** → **Guardar** →
   **Imprimir prueba** (lo imprime el ESP32).
4. Pedir desde `menu.html` → debe imprimir solo; pedido de mesero con "Imprimir comanda" → imprime.

## Verificación

- Modo desarrollo: correr el agente **Node** con `PRINTER_MODE=mock` para validar el formato
  del ticket, y comparar con la salida del ESP32.
- Con el ESP32 real: ticket de prueba desde el panel, comanda web, comanda de mesero, y prueba
  de "impresora apagada" (el pedido queda en cola y se imprime al encenderla).

## Fuera de alcance

- Escaneo de red real desde el ESP32 (254 IPs es lento ahí; se escribe la IP a mano en el panel).
- Resumen diario y mock-printer en el firmware.