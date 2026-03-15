-- Migración: Integración POS con Centum ERP
-- Agregar campos necesarios para mapear cajas y sucursales a Centum

-- Punto de venta Centum en cajas
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS punto_venta_centum INTEGER;

-- ID de sucursal física en Centum
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS centum_sucursal_id INTEGER;

-- Campos de tracking Centum en ventas_pos
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS id_venta_centum INTEGER;
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS centum_sync BOOLEAN DEFAULT FALSE;
