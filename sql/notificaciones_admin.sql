-- Notificaciones in-app para admins (alertas de duplicados, etc.)
CREATE TABLE IF NOT EXISTS notificaciones_admin (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id UUID REFERENCES perfiles(id) ON DELETE CASCADE,  -- NULL = todos los admins
  tipo TEXT NOT NULL DEFAULT 'alerta',  -- 'alerta', 'info', 'error'
  titulo TEXT NOT NULL,
  mensaje TEXT,
  metadata JSONB DEFAULT '{}',  -- datos extra (ids de ventas, etc.)
  leida BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_notificaciones_admin_perfil ON notificaciones_admin(perfil_id, leida, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_admin_created ON notificaciones_admin(created_at DESC);

-- RLS
ALTER TABLE notificaciones_admin ENABLE ROW LEVEL SECURITY;

-- Admins pueden ver sus notificaciones (las dirigidas a ellos o las globales)
CREATE POLICY "Admins ven sus notificaciones" ON notificaciones_admin
  FOR SELECT USING (
    perfil_id = auth.uid() OR perfil_id IS NULL
  );

-- Service role puede insertar (backend)
CREATE POLICY "Service puede insertar" ON notificaciones_admin
  FOR INSERT WITH CHECK (true);

-- Admins pueden actualizar (marcar como leída)
CREATE POLICY "Admins pueden actualizar" ON notificaciones_admin
  FOR UPDATE USING (
    perfil_id = auth.uid() OR perfil_id IS NULL
  );
