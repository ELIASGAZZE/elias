-- Anti-duplicación de ventas en Centum
-- Nuevas columnas para máquina de estados de sync

ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS centum_intentos INTEGER DEFAULT 0;
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS centum_ultimo_intento TIMESTAMPTZ;

-- Índice para el cron de retry (ventas pendientes ordenadas por fecha)
CREATE INDEX IF NOT EXISTS idx_ventas_pos_centum_retry
  ON ventas_pos (centum_sync, created_at)
  WHERE centum_sync = false AND caja_id IS NOT NULL;

-- Migrar ventas que ya tenían errores 500 a intentos=1
UPDATE ventas_pos
SET centum_intentos = 1,
    centum_ultimo_intento = NOW() - INTERVAL '15 minutes'
WHERE centum_sync = false
  AND centum_error LIKE '500_NOVERIFY|%';
