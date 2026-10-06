# Limpiar pedidos de la base de datos (manual por SSH/Docker)

Guía para vaciar la tabla `orders` dejando el resto intacto (menú, inventario,
usuarios, configuración). Se hace a mano desde el VPS; no hay botón en el panel.

> La BD es PostgreSQL y corre en un contenedor Docker en el VPS (Dokploy).

## Pasos

1. **Conectar por SSH al VPS** desde PowerShell:

   ```powershell
   ssh root@IP_DEL_SERVIDOR
   ```

2. **Localizar el contenedor de postgres** (el nombre cambia si Dokploy recrea
   el contenedor, verificar cada vez):

   ```bash
   sudo docker ps --filter "name=asisnexo" --format "table {{.ID}}\t{{.Names}}\t{{.Image}}"
   ```

   Usar la fila de la imagen `postgres:16-alpine` (por ejemplo ID `b5bae35a375c`,
   nombre `asisnexo-asisnexo-rh01p6-postgres-1`).

   > Ojo: en el servidor hay varios postgres (dokploy, nfc, asisnexo-demo…);
   > usar siempre el contenedor de asisnexo.

3. **Vaciar los pedidos y reiniciar el contador** (el próximo pedido será el #1):

   ```bash
   sudo docker exec <ID_POSTGRES> psql -U nexo -d nexo -c "DELETE FROM orders;" -c "ALTER SEQUENCE orders_id_seq RESTART WITH 1;"
   ```

   Alternativa en una sola línea sin depender del nombre (lo encuentra solo):

   ```bash
   sudo docker exec $(sudo docker ps --filter "name=asisnexo-postgres" -q | head -n1) psql -U nexo -d nexo -c "DELETE FROM orders;" -c "ALTER SEQUENCE orders_id_seq RESTART WITH 1;"
   ```

4. **Verificar** que quedó en cero:

   ```bash
   sudo docker exec <ID_POSTGRES> psql -U nexo -d nexo -c "SELECT count(*) FROM orders;"
   ```

## Notas

- Solo toca `orders`. `stock_movements` referencia a `orders` con
  `ON DELETE SET NULL`, así que el borrado es seguro y no rompe nada.
- El inventario/stock **no** se restaura (los niveles quedan como están).
- No borra historial de movimientos de stock (si se quiere, pedir SQL aparte).