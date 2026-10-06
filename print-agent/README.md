# Agente impresor AsisNexo (`print-agent`)

Imprime en la ticketera térmica **de red** (RJ45/JetDirect, puerto `9100`) los
pedidos que quedan `en_cola` en el VPS. Corre **sin dependencias** (solo Node.js),
en una PC (Windows/Linux) o en un celular Android con Termux. No necesita que
ninguna PC "especial" esté encendida: la impresora es un dispositivo de red con
IP propia.

## Cómo funciona

1. Cada ~8s hace `GET /api/orders/pending` (con `X-Agent-Token`).
2. Por cada pedido arma el ticket ESC/POS según el ancho configurado.
3. Abre un socket TCP a `PRINTER_HOST:9100` y envía los bytes.
4. Si la impresión fue enviada, confirma con `ack` → el pedido pasa a `impreso`
   (evita dobles impresiones con varios agentes en línea).

Si la impresora no responde, **no** hace `ack`: el pedido queda en cola y se
reintenta en el siguiente ciclo. Los pedidos se acumulan en PostgreSQL hasta
imprimirse.

## Comandas por pedido

Cada pedido imprime hasta **3 comandas** en la misma ticketera (cada una con su
corte, para desprenderla por separado), con contenidos distintos:

| Comanda      | Cuándo            | Contenido |
|--------------|-------------------|-----------|
| **Cocina**   | siempre           | Solo los productos y modificadores (proteína, SIN, extra, nota), `#` de pedido y tipo de entrega. Sin precios, sin total y sin datos del cliente. |
| **Caja**     | siempre           | Recibo completo: `#`, cliente, dirección/teléfono, mesero, items con precios, total, método de pago y estado (PAGADO / POR COBRAR / PENDIENTE). |
| **Cliente**  | delivery y para llevar | Etiqueta corta (`TICKET CLIENTE`) con `#`, nombre, tipo de entrega, cantidad de productos y total, para engrapar o pegar al pedido. |

En pedidos **"En el local"** solo se imprimen cocina + caja.

## Variables de entorno

| Variable         | Descripción                                            | Ejemplo                    |
|------------------|--------------------------------------------------------|----------------------------|
| `API_URL`        | Dominio del VPS (https)                                | `https://pedidos.nexo.com` |
| `AGENT_TOKEN`    | Token compartido (mismo del `.env` del VPS)            | `ag3nt-...`                |
| `PRINTER_HOST`   | IP de la impresora (fallback; ver "Config desde /admin") | `192.168.1.50`           |
| `PRINTER_PORT`   | Puerto JetDirect (default `9100`)                      | `9100`                     |
| `PRINTER_WIDTH`  | Ancho físico: `58` u `80` (default `58`)                 | `58`                       |
| `PRINTER_MODE`   | `tcp` para imprimir, `mock` para probar sin hardware   | `tcp`                      |
| `POLL_MS`        | Frecuencia del polling (default `8000`)                | `8000`                     |
| `LOG_FILE`       | Archivo de log opcional                                 | `agente.log`               |
| `SCAN_SUBNET`    | Subred a escanear (opcional, default: la /24 del equipo) | `192.168.1.0/24`       |
| `SCAN_PORT`      | Puerto de la ticketera al escanear (default `9100`)    | `9100`                     |

> `API_URL` y `AGENT_TOKEN` son obligatorios. `PRINTER_HOST` es opcional si la
> impresora se configura desde el panel `/admin` (ver abajo).

## Config desde el panel /admin

El panel tiene una pestaña **Impresoras** que gestiona un CRUD completo (lista,
crear, editar, eliminar) de las ticketeras del local, cada una con nombre,
**modelo**, **ubicación en el local** (Caja, Cocina, Delivery/Cliente, Oficina),
IP, puerto y ancho (58/80). La marcada como **Activa** es la que imprime los
pedidos (prioridad sobre las env vars).

1. **Escanear la red**: el panel pide un escaneo; este agente lo detecta en su
   polling, escanea la subred local (TCP al puerto 9100, ~254 IPs en paralelo)
   y reporta las impresoras encontradas. En el panel basta tocar la IP.
2. **Ping**: el panel pide verificar la conexión de una impresora; este agente
   abre un socket TCP a `IP:puerto` (9100), mide la latencia y reporta si la
   impresora responde.
3. **Probar**: imprime un ticket de prueba en la impresora seleccionada para
   confirmar que se eligió la correcta.

La config del servidor tiene prioridad sobre `PRINTER_HOST`/`PRINTER_PORT`/`PRINTER_WIDTH`.
Si no hay impresora **activa** configurada, el agente no imprime (los pedidos
quedan en la cola, sin ack). El escaneo solo ve la subred del equipo donde corre
este agente: si la impresora está en otra VLAN o el Wi-Fi tiene aislamiento de
clientes, se escribe la IP a mano. El escaneo identifica "algo escuchando en
9100"; la confirmación final es el botón *Probar*.

## Instalación

Requiere **Node.js 18+** (la última LTS). Descarga desde https://nodejs.org
(página "Long Term Support").

### Windows / Linux (PC del local)

```bash
cd print-agent
# Copia este repo a la PC (git clone o carpeta compartida)

# Prueba sin impresora primero (modo mock):
PRINTER_MODE=mock node agent.js

# Producción:
API_URL=https://PEDIDOS.DOMINIO \
AGENT_TOKEN=xxx \
PRINTER_HOST=192.168.1.50 \
PRINTER_WIDTH=58 \
node agent.js
```

En **Windows** usa `set KEY=valor &&` (o crea un `agente.bat`):

```bat
@echo off
cd /d %~dp0
set API_URL=https://PEDIDOS.DOMINIO
set AGENT_TOKEN=xxx
set PRINTER_HOST=192.168.1.50
set PRINTER_WIDTH=58
node agent.js
```

### Android (Termux)

```bash
pkg install nodejs

# Guarda el token con md5sum / memoria, y ejecuta:
cd print-agent
export API_URL=https://PEDIDOS.DOMINIO
export AGENT_TOKEN=xxx
export PRINTER_HOST=192.168.1.50
export PRINTER_WIDTH=58
node agent.js
```

Para que corra en segundo plano con el celular encendido (opcional, avanzado):
`termux-wake-lock` + un loop que lo reinicie si se cae.

## Auto-inicio en la PC

- **Windows** — Programador de tareas: tarea al iniciar sesión → `agente.bat`,
  "no mostrar ventana" opcional.
- **Linux** — `systemd`: crea `/etc/systemd/system/nexo-agent.service` con el
  comando y `[Install] WantedBy=multi-user.target`.

## Modo simulado (`mock-printer`)

`PRINTER_MODE=mock` no toca la impresora: escribe cada comanda en
`print-agent/tickets/pedido-<id>-<caja|cocina|cliente>.txt` y lo muestra en
consola. Sirve para probar el formato y el flujo completo de extremo a extremo
**sin hardware**. Los pedidos se confirman igual (vía ack), así que para pruebas
reales usa el agente real.

## Solución de problemas

- `ECONNREFUSED` / timeout → confirma la IP y que la ticketera esté encendida y
  con cable de red; prueba `telnet IP 9100` desde la misma red.
- Sin impresión pero sin error → revisa `PRINTER_WIDTH` (si el texto sale cortado
  o con saltos raros prueba `80`).
- El ticket sale con caracteres raros → el contenido tiene emojis; el agente los
  filtra automáticamente (las ticketeras usan latin1/CP437).