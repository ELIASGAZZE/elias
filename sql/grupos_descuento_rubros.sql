-- Descuentos por rubro para grupos de descuento
-- El porcentaje general del grupo se usa como fallback para rubros no configurados aquí

CREATE TABLE IF NOT EXISTS grupos_descuento_rubros (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  grupo_descuento_id UUID NOT NULL REFERENCES grupos_descuento(id) ON DELETE CASCADE,
  rubro TEXT NOT NULL,
  rubro_id_centum INTEGER,
  porcentaje NUMERIC NOT NULL DEFAULT 0 CHECK (porcentaje >= 0 AND porcentaje <= 100),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(grupo_descuento_id, rubro)
);

ALTER TABLE grupos_descuento_rubros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura grupos_descuento_rubros" ON grupos_descuento_rubros FOR SELECT USING (true);
CREATE POLICY "Admin modifica grupos_descuento_rubros" ON grupos_descuento_rubros FOR ALL USING (true);
