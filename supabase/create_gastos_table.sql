-- ============================================================
-- TABLA DE GASTOS PARA PLANILLAS DE CAJA
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- Gastos registrados durante un turno de caja
-- Se descuentan del efectivo (similar a retiros)
CREATE TABLE IF NOT EXISTS gastos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cierre_id UUID REFERENCES cierres(id) ON DELETE CASCADE NOT NULL,
  descripcion TEXT NOT NULL,
  importe NUMERIC NOT NULL CHECK (importe > 0),
  -- Control por parte del gestor/admin
  controlado BOOLEAN DEFAULT FALSE,
  controlado_por UUID REFERENCES perfiles(id),
  controlado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sin acceso directo desde cliente" ON gastos FOR ALL USING (false);
