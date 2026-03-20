-- Migración: agregar tipo 'combo' a la tabla articulos
-- Ejecutar en Supabase SQL Editor

-- 1. Eliminar constraint existente y agregar nuevo con 'combo'
ALTER TABLE articulos DROP CONSTRAINT IF EXISTS articulos_tipo_check;
ALTER TABLE articulos ADD CONSTRAINT articulos_tipo_check
  CHECK (tipo IN ('manual', 'automatico', 'combo'));
