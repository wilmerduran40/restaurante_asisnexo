-- ================================================================
-- Comprobante de pago en pedidos
-- ================================================================
-- El cliente web adjunta una foto del comprobante (receipt) en el
-- checkout. Para Pago Móvil también se capturan la referencia (pm_ref)
-- y el monto en Bs (pm_amount): quedan listos para la automatización
-- futura del cruce con los SMS del banco (incoming_sms).

-- Idempotente: no rompe si ya están aplicadas.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pm_ref TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pm_amount NUMERIC(12,2);