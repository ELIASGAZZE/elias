-- Agregar caja_id a ventas_empleados para saber qué caja procesó el retiro
ALTER TABLE ventas_empleados ADD COLUMN IF NOT EXISTS caja_id UUID REFERENCES cajas(id);
CREATE INDEX IF NOT EXISTS idx_ventas_empleados_caja ON ventas_empleados(caja_id);
