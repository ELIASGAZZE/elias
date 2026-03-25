-- Contador de muestras para calcular promedio acumulativo de peso por pieza
-- Se incrementa con cada escaneo de pesable durante preparación de traspasos
ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS peso_muestras INTEGER DEFAULT 0;
