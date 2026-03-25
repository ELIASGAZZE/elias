-- Campos de peso para artículos pesables
-- peso_promedio_pieza: para calcular unidades aproximadas desde kg
-- peso_minimo / peso_maximo: para futuro control de picking
ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS peso_promedio_pieza NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS peso_minimo NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS peso_maximo NUMERIC(8,3);
