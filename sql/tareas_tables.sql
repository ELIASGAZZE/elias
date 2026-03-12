-- ============================================================
-- App Tareas — Gestión de tareas operativas por sucursal
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Definiciones globales de tareas
CREATE TABLE tareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  enlace_manual TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Subtareas (hijas de tarea)
CREATE TABLE subtareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id UUID NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true
);

-- 3. Config por sucursal
CREATE TABLE tareas_config_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id UUID NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  frecuencia_dias INT NOT NULL DEFAULT 7,
  dia_preferencia TEXT, -- 'lunes','martes',...'domingo' (nullable)
  reprogramar_siguiente BOOLEAN NOT NULL DEFAULT true,
  fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  activo BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(tarea_id, sucursal_id)
);

-- 4. Registro de ejecuciones
CREATE TABLE ejecuciones_tarea (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_config_id UUID NOT NULL REFERENCES tareas_config_sucursal(id) ON DELETE CASCADE,
  fecha_programada DATE NOT NULL,
  fecha_ejecucion DATE NOT NULL DEFAULT CURRENT_DATE,
  completada_por_id UUID REFERENCES perfiles(id),
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Qué empleados hicieron la tarea
CREATE TABLE ejecuciones_empleados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecucion_id UUID NOT NULL REFERENCES ejecuciones_tarea(id) ON DELETE CASCADE,
  empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  UNIQUE(ejecucion_id, empleado_id)
);

-- 6. Qué subtareas se completaron
CREATE TABLE ejecuciones_subtareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecucion_id UUID NOT NULL REFERENCES ejecuciones_tarea(id) ON DELETE CASCADE,
  subtarea_id UUID NOT NULL REFERENCES subtareas(id) ON DELETE CASCADE,
  completada BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(ejecucion_id, subtarea_id)
);

-- 7. Checklist imprimible (campo libre en tarea)
-- ALTER TABLE tareas ADD COLUMN checklist_imprimible TEXT;

-- RLS: habilitar Row Level Security (permitir todo via service_role key)
ALTER TABLE tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tareas_config_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejecuciones_tarea ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejecuciones_empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE ejecuciones_subtareas ENABLE ROW LEVEL SECURITY;

-- Policies: acceso completo para service_role (backend)
CREATE POLICY "service_role_all" ON tareas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON subtareas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON tareas_config_sucursal FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ejecuciones_tarea FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ejecuciones_empleados FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON ejecuciones_subtareas FOR ALL USING (true) WITH CHECK (true);
