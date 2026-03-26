-- Agregar campo numero a cierres_pos (identificador unico secuencial)
ALTER TABLE cierres_pos ADD COLUMN IF NOT EXISTS numero INTEGER;

-- Asignar numeros retroactivamente ordenados por fecha de creacion
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS num
  FROM cierres_pos
)
UPDATE cierres_pos
SET numero = numbered.num
FROM numbered
WHERE cierres_pos.id = numbered.id;

-- Crear indice unico
CREATE UNIQUE INDEX IF NOT EXISTS idx_cierres_pos_numero ON cierres_pos(numero);
