-- Agregar campo forma_pago_origen a movimientos_saldo_pos
-- Estructura: { "Efectivo": 26100, "Transferencia": 5000 } — desglose del saldo por forma de pago original
-- NULL para saldos legacy/ajustes manuales sin info

ALTER TABLE movimientos_saldo_pos ADD COLUMN IF NOT EXISTS forma_pago_origen jsonb DEFAULT NULL;

COMMENT ON COLUMN movimientos_saldo_pos.forma_pago_origen IS 'Desglose del saldo por forma de pago original. Ej: {"Efectivo": 26100, "Transferencia": 5000}. NULL para legacy/ajustes sin info.';
