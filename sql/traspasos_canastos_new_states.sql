-- Migración de estados de canastos/bultos de traspasos
-- Nuevos estados: en_preparacion, en_origen, en_transito, en_destino, controlado, con_diferencia
-- Ejecutar en Supabase SQL Editor

-- 1. Eliminar el CHECK constraint viejo
ALTER TABLE traspaso_canastos DROP CONSTRAINT traspaso_canastos_estado_check;

-- 2. Crear el CHECK constraint con los nuevos valores
ALTER TABLE traspaso_canastos ADD CONSTRAINT traspaso_canastos_estado_check
  CHECK (estado IN ('en_preparacion', 'en_origen', 'en_transito', 'en_destino', 'controlado', 'con_diferencia'));

-- 3. Migrar estados antiguos a nuevos
UPDATE traspaso_canastos SET estado = 'en_origen' WHERE estado = 'cerrado';
UPDATE traspaso_canastos SET estado = 'en_transito' WHERE estado = 'despachado';
UPDATE traspaso_canastos SET estado = 'controlado' WHERE estado = 'aprobado';
UPDATE traspaso_canastos SET estado = 'con_diferencia' WHERE estado = 'verificacion_manual';
