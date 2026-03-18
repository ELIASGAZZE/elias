-- Migración: Módulo Control de Horario del Personal
-- Ejecutar en Supabase SQL Editor

-- PIN de fichaje para cada empleado
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS pin_fichaje TEXT;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS pin_fichaje_temp BOOLEAN DEFAULT false;

-- Fichajes (clock in/out)
CREATE TABLE IF NOT EXISTS fichajes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID REFERENCES empleados(id),
  sucursal_id UUID REFERENCES sucursales(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  fecha_hora TIMESTAMPTZ NOT NULL DEFAULT now(),
  metodo TEXT DEFAULT 'pin',
  registrado_por UUID REFERENCES perfiles(id),
  observaciones TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Turnos (definición de horarios)
CREATE TABLE IF NOT EXISTS turnos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  hora_entrada TIME NOT NULL,
  hora_salida TIME NOT NULL,
  tolerancia_entrada_min INT DEFAULT 10,
  tolerancia_salida_min INT DEFAULT 10,
  activo BOOLEAN DEFAULT true
);

-- Asignación empleado → turno (por día de semana)
CREATE TABLE IF NOT EXISTS asignaciones_turno (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID REFERENCES empleados(id),
  turno_id UUID REFERENCES turnos(id),
  dia_semana INT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  UNIQUE(empleado_id, dia_semana, vigente_desde)
);

-- Feriados
CREATE TABLE IF NOT EXISTS feriados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  descripcion TEXT NOT NULL,
  tipo TEXT DEFAULT 'nacional' CHECK (tipo IN ('nacional', 'empresa')),
  anio INT,
  UNIQUE(fecha)
);

-- Licencias / ausencias
CREATE TABLE IF NOT EXISTS licencias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID REFERENCES empleados(id),
  tipo TEXT NOT NULL CHECK (tipo IN (
    'vacaciones', 'enfermedad', 'familiar', 'estudio',
    'mudanza', 'matrimonio', 'otro'
  )),
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE NOT NULL,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  aprobado_por UUID REFERENCES perfiles(id),
  observaciones TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Autorizaciones (llegada tarde / salida temprana)
CREATE TABLE IF NOT EXISTS autorizaciones_horario (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empleado_id UUID REFERENCES empleados(id),
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada_tarde', 'salida_temprana')),
  hora_autorizada TIME,
  motivo TEXT,
  autorizado_por UUID REFERENCES perfiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_fichajes_empleado_fecha ON fichajes(empleado_id, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_fichajes_sucursal_fecha ON fichajes(sucursal_id, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_licencias_empleado ON licencias(empleado_id, fecha_desde);
CREATE INDEX IF NOT EXISTS idx_asignaciones_empleado ON asignaciones_turno(empleado_id, dia_semana);
