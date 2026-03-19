-- Tabla para grupos de descuento por cliente
CREATE TABLE grupos_descuento (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  porcentaje NUMERIC NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Columna en clientes para asignar grupo
ALTER TABLE clientes ADD COLUMN grupo_descuento_id UUID REFERENCES grupos_descuento(id);

-- Columnas en ventas_pos para registrar descuento grupo
ALTER TABLE ventas_pos ADD COLUMN descuento_grupo_cliente NUMERIC DEFAULT 0;
ALTER TABLE ventas_pos ADD COLUMN grupo_descuento_nombre TEXT;
