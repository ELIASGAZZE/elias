-- Agregar columna cajero_nombre a pedidos_pos para mostrar el nombre del empleado (no del usuario del sistema)
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS cajero_nombre TEXT;
