-- ============================================================
-- Migración: Tareas con tipo día fijo / frecuencia
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Agregar campo tipo (dia_fijo / frecuencia)
ALTER TABLE tareas_config_sucursal
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'frecuencia';

-- 2. Agregar campo dias_semana (JSONB array de días para tipo dia_fijo)
ALTER TABLE tareas_config_sucursal
  ADD COLUMN IF NOT EXISTS dias_semana JSONB;

-- 3. Migrar configs existentes que tenían dia_preferencia a tipo dia_fijo
UPDATE tareas_config_sucursal
SET tipo = 'dia_fijo',
    dias_semana = jsonb_build_array(dia_preferencia)
WHERE dia_preferencia IS NOT NULL AND dia_preferencia != '';
