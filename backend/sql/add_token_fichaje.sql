-- Agregar campo token_fichaje a sucursales para links únicos de reloj de fichaje
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS token_fichaje TEXT UNIQUE;

-- Índice para búsqueda rápida por token
CREATE INDEX IF NOT EXISTS idx_sucursales_token_fichaje ON sucursales(token_fichaje) WHERE token_fichaje IS NOT NULL;
