-- Agregar campo historial JSONB a pedidos_pos para registrar eventos de la vitácora
-- Estructura: array de objetos { tipo, fecha, usuario, detalle }
-- Tipos: 'entregado', 'revertido'

ALTER TABLE pedidos_pos
ADD COLUMN IF NOT EXISTS historial JSONB DEFAULT '[]'::jsonb;
