-- Trazabilidad completa de pedidos: creación, cobro y entrega
-- Cada etapa registra: fecha/hora, sucursal, numero de caja, empleado

-- === CREACIÓN (complementa created_at, cajero_nombre, sucursal_id que ya existen) ===
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS creado_en_cierre integer DEFAULT NULL;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS creado_sucursal_nombre text DEFAULT NULL;

-- === COBRO (complementa cobrado_por, cobrado_en_cierre, caja_cobro_id, pagos que ya existen) ===
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS cobrado_at timestamptz DEFAULT NULL;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS cobrado_sucursal_nombre text DEFAULT NULL;

-- === ENTREGA ===
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS entregado_por text DEFAULT NULL;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS entregado_en_cierre integer DEFAULT NULL;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS entregado_at timestamptz DEFAULT NULL;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS entregado_sucursal_nombre text DEFAULT NULL;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS caja_entrega_id uuid DEFAULT NULL;
