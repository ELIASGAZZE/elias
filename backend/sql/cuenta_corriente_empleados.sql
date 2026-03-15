-- Cuenta corriente empleados: tablas para descuentos, topes, ventas y pagos

-- 1. Descuentos por rubro para empleados
CREATE TABLE IF NOT EXISTS descuentos_empleados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rubro TEXT NOT NULL UNIQUE,
  rubro_id_centum INTEGER,
  porcentaje NUMERIC NOT NULL DEFAULT 0 CHECK (porcentaje >= 0 AND porcentaje <= 100),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE descuentos_empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura descuentos_empleados" ON descuentos_empleados FOR SELECT USING (true);
CREATE POLICY "Admin modifica descuentos_empleados" ON descuentos_empleados FOR ALL USING (true);

-- 2. Tope mensual por empleado
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tope_mensual NUMERIC DEFAULT NULL;

-- 3. Ventas a cuenta corriente de empleados
CREATE TABLE IF NOT EXISTS ventas_empleados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID NOT NULL REFERENCES empleados(id),
  sucursal_id UUID REFERENCES sucursales(id),
  cajero_id UUID REFERENCES perfiles(id),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total NUMERIC NOT NULL DEFAULT 0,
  comprobante_centum TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ventas_empleados_empleado ON ventas_empleados(empleado_id);
CREATE INDEX IF NOT EXISTS idx_ventas_empleados_created ON ventas_empleados(created_at);

ALTER TABLE ventas_empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura ventas_empleados" ON ventas_empleados FOR SELECT USING (true);
CREATE POLICY "Insert ventas_empleados" ON ventas_empleados FOR INSERT WITH CHECK (true);

-- 4. Pagos / descuentos de sueldo
CREATE TABLE IF NOT EXISTS pagos_cuenta_empleados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID NOT NULL REFERENCES empleados(id),
  monto NUMERIC NOT NULL CHECK (monto > 0),
  concepto TEXT NOT NULL DEFAULT '',
  registrado_por UUID REFERENCES perfiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagos_cuenta_empleados_empleado ON pagos_cuenta_empleados(empleado_id);

ALTER TABLE pagos_cuenta_empleados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura pagos_cuenta_empleados" ON pagos_cuenta_empleados FOR SELECT USING (true);
CREATE POLICY "Insert pagos_cuenta_empleados" ON pagos_cuenta_empleados FOR INSERT WITH CHECK (true);
