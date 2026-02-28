-- Tabla para almacenar reglas aprendidas de la IA
-- Ejecutar en Supabase Dashboard > SQL Editor

CREATE TABLE reglas_ia (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  regla TEXT NOT NULL,
  activa BOOLEAN DEFAULT true,
  creado_por UUID REFERENCES perfiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Permitir acceso desde el service key
ALTER TABLE reglas_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service key full access" ON reglas_ia FOR ALL USING (true) WITH CHECK (true);
