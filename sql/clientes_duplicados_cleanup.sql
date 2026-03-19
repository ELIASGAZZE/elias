-- =============================================================
-- Paso 1: Agregar columna codigo_centum
-- =============================================================
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_centum TEXT;

-- =============================================================
-- Paso 2: Encontrar duplicados por id_centum (revisar antes de limpiar)
-- =============================================================
-- SELECT id_centum, array_agg(id ORDER BY created_at), array_agg(codigo ORDER BY created_at), count(*)
-- FROM clientes
-- WHERE id_centum IS NOT NULL
-- GROUP BY id_centum
-- HAVING count(*) > 1;

-- =============================================================
-- Paso 3: Desactivar duplicados (conservar el más antiguo por id_centum)
-- =============================================================
UPDATE clientes SET activo = false
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY id_centum ORDER BY created_at ASC) as rn
    FROM clientes
    WHERE id_centum IS NOT NULL AND activo = true
  ) ranked
  WHERE rn > 1
);

-- =============================================================
-- Paso 4: Limpiar id_centum de filas desactivadas (necesario para el unique index)
-- =============================================================
UPDATE clientes SET id_centum = NULL
WHERE activo = false AND id_centum IS NOT NULL;

-- =============================================================
-- Paso 5: Crear unique partial index (solo para id_centum NOT NULL)
-- Esto previene futuros duplicados a nivel DB
-- =============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_id_centum_unique
ON clientes (id_centum) WHERE id_centum IS NOT NULL;
