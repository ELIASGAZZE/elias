-- Tabla para registrar cambios de precio en el POS
CREATE TABLE IF NOT EXISTS pos_cambios_precio_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_pos_id UUID REFERENCES ventas_pos(id),
  cierre_id UUID,
  cajero_id UUID REFERENCES auth.users(id),
  cajero_nombre TEXT,
  caja_id UUID,
  sucursal_id UUID,
  articulo_id INTEGER NOT NULL,
  articulo_codigo TEXT,
  articulo_nombre TEXT,
  precio_original NUMERIC(12,2) NOT NULL,
  precio_nuevo NUMERIC(12,2) NOT NULL,
  diferencia NUMERIC(12,2) NOT NULL,
  cantidad NUMERIC(12,4) DEFAULT 1,
  motivo TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcpl_created ON pos_cambios_precio_log(created_at);
CREATE INDEX IF NOT EXISTS idx_pcpl_cajero ON pos_cambios_precio_log(cajero_id);
CREATE INDEX IF NOT EXISTS idx_pcpl_cierre ON pos_cambios_precio_log(cierre_id);
CREATE INDEX IF NOT EXISTS idx_pcpl_venta ON pos_cambios_precio_log(venta_pos_id);

-- RLS
ALTER TABLE pos_cambios_precio_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert" ON pos_cambios_precio_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can select" ON pos_cambios_precio_log
  FOR SELECT TO authenticated USING (true);
