-- Pop-up de bebidas (upsell) antes de finalizar el pedido en la web.
--
-- Marca qué productos aparecen en el modal de bebidas de menu.html. El admin lo
-- controla desde la vista Menú del panel; si no hay ninguno marcado, la web cae
-- al respaldo automático (las 6 bebidas curadas de siempre).
-- Idempotente: re-ejecutar no falla ni pisa la selección ya hecha.

ALTER TABLE products ADD COLUMN IF NOT EXISTS upsell BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_upsell ON products(upsell) WHERE upsell;

-- Semilla: las 6 bebidas que la web ofrecía antes (UPSELL_PREFERRED), para que
-- el comportamiento no cambie al desplegar. Solo aplica si aún no se marcó nada.
UPDATE products SET upsell = true
WHERE id IN ('b7', 'b1', 'b9', 'b15', 'b14', 'b21');
