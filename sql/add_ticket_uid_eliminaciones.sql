-- Agregar ticket_uid para vincular eliminaciones con la venta final del ticket
ALTER TABLE pos_eliminaciones_log ADD COLUMN IF NOT EXISTS ticket_uid TEXT;
ALTER TABLE pos_eliminaciones_log ADD COLUMN IF NOT EXISTS venta_pos_id UUID REFERENCES ventas_pos(id);
ALTER TABLE pos_eliminaciones_log ADD COLUMN IF NOT EXISTS numero_venta INTEGER;

-- Index para buscar por ticket_uid rápidamente al vincular
CREATE INDEX IF NOT EXISTS idx_pos_eliminaciones_ticket_uid ON pos_eliminaciones_log(ticket_uid) WHERE ticket_uid IS NOT NULL;
