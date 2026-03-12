-- Tabla para registrar ventas canceladas en el POS (auditoría)
CREATE TABLE IF NOT EXISTS ventas_pos_canceladas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cajero_id UUID REFERENCES auth.users(id),
  cajero_nombre TEXT,
  sucursal_id UUID,
  caja_id UUID,
  motivo TEXT NOT NULL,
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  cliente_nombre TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para consultas de auditoría
CREATE INDEX IF NOT EXISTS idx_vpc_cajero ON ventas_pos_canceladas(cajero_id);
CREATE INDEX IF NOT EXISTS idx_vpc_created ON ventas_pos_canceladas(created_at);
CREATE INDEX IF NOT EXISTS idx_vpc_sucursal ON ventas_pos_canceladas(sucursal_id);

-- Índice en pos_eliminaciones_log si no existe
CREATE INDEX IF NOT EXISTS idx_pel_usuario ON pos_eliminaciones_log(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pel_fecha ON pos_eliminaciones_log(fecha);

-- RLS
ALTER TABLE ventas_pos_canceladas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ventas_pos_canceladas_all" ON ventas_pos_canceladas FOR ALL USING (true) WITH CHECK (true);
