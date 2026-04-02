-- Sucursal opcional en turnos (ej: "Mañana Suc A 8-16")
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS sucursal_id UUID REFERENCES sucursales(id);

-- Planificacion semanal por fecha
CREATE TABLE IF NOT EXISTS planificacion_semanal (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID REFERENCES empleados(id) NOT NULL,
  turno_id UUID REFERENCES turnos(id) NOT NULL,
  sucursal_id UUID REFERENCES sucursales(id),
  fecha DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES perfiles(id),
  UNIQUE(empleado_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_planificacion_fecha ON planificacion_semanal(fecha);
CREATE INDEX IF NOT EXISTS idx_planificacion_emp_fecha ON planificacion_semanal(empleado_id, fecha);
