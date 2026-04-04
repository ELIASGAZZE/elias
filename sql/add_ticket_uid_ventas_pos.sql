-- Agregar ticket_uid a ventas_pos para idempotencia (prevenir ventas duplicadas por doble-submit)
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS ticket_uid TEXT;

-- Índice único para garantizar idempotencia a nivel de base de datos
CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_pos_ticket_uid_unique
  ON ventas_pos(ticket_uid)
  WHERE ticket_uid IS NOT NULL;
