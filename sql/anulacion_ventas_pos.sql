-- Columnas para soporte de anulación de ventas POS
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS anulada boolean DEFAULT false;
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS anulada_motivo text;
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS anulada_nc_id uuid REFERENCES ventas_pos(id);
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS anulada_at timestamptz;
