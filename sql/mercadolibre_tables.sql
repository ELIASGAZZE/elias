-- ═══════════════════════════════════════════════════════════════
-- Módulo Mercado Libre — Tablas Supabase
-- ═══════════════════════════════════════════════════════════════

-- Configuración OAuth (singleton, id=1)
CREATE TABLE IF NOT EXISTS ml_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  seller_id TEXT,
  activo BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Órdenes/ventas sincronizadas desde ML
CREATE TABLE IF NOT EXISTS ml_ordenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ml_order_id TEXT NOT NULL UNIQUE,
  pack_id TEXT,
  estado TEXT NOT NULL, -- paid, cancelled, pending, etc.
  estado_detalle TEXT,
  fecha_creacion TIMESTAMPTZ,
  fecha_cierre TIMESTAMPTZ,
  total NUMERIC(12,2),
  moneda TEXT DEFAULT 'ARS',
  items JSONB DEFAULT '[]'::jsonb,
  -- Comprador
  comprador_id TEXT,
  comprador_nickname TEXT,
  comprador_nombre TEXT,
  -- Envío
  envio_id TEXT,
  envio_estado TEXT,
  -- Metadata
  tags JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda y filtrado
CREATE INDEX IF NOT EXISTS idx_ml_ordenes_estado ON ml_ordenes(estado);
CREATE INDEX IF NOT EXISTS idx_ml_ordenes_fecha ON ml_ordenes(fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_ml_ordenes_comprador ON ml_ordenes(comprador_nickname);
CREATE INDEX IF NOT EXISTS idx_ml_ordenes_pack ON ml_ordenes(pack_id);

-- RLS
ALTER TABLE ml_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_ordenes ENABLE ROW LEVEL SECURITY;

-- Policies (el backend usa service key, así que bypass RLS — estas son por si se consulta desde frontend directo)
CREATE POLICY "ml_config_admin" ON ml_config FOR ALL USING (true);
CREATE POLICY "ml_ordenes_admin" ON ml_ordenes FOR ALL USING (true);
