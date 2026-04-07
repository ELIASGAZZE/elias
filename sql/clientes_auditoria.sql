-- Tabla de auditoría de cambios en clientes
-- Registra todos los cambios realizados desde POS, admin, API y sync automático

CREATE TABLE IF NOT EXISTS clientes_auditoria (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  accion TEXT NOT NULL, -- 'crear', 'editar', 'contacto', 'sync_centum', 'refresh', 'importar', 'desactivar', 'reactivar', 'resolver_duplicado', 'exportar_centum'
  origen TEXT NOT NULL, -- 'admin', 'pos', 'api_sync', 'cron', 'centum_bi'
  usuario TEXT, -- username del usuario que hizo el cambio (null para automáticos)
  cambios JSONB NOT NULL DEFAULT '{}', -- { campo: { antes: X, despues: Y } }
  detalle TEXT, -- descripción libre opcional
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_clientes_auditoria_cliente_id ON clientes_auditoria(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_auditoria_created_at ON clientes_auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clientes_auditoria_accion ON clientes_auditoria(accion);
