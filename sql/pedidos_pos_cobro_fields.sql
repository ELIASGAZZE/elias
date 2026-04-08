-- Agregar campos de cobro a pedidos_pos
-- Para registrar info de pago anticipado sin crear venta prematuramente

-- Pagos realizados (array de {tipo, monto, detalle})
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS pagos jsonb DEFAULT NULL;

-- Descuento por forma de pago aplicado al cobrar
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS descuento_forma_pago jsonb DEFAULT NULL;

-- Nombre del empleado que cobro
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS cobrado_por text DEFAULT NULL;

-- Numero de cierre donde se registro el cobro
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS cobrado_en_cierre integer DEFAULT NULL;

-- ID de la caja donde se cobro
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS caja_cobro_id uuid DEFAULT NULL;
