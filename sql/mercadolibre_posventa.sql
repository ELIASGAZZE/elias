-- ═══════════════════════════════════════════════════════════════
-- Módulo Mercado Libre — Posventa (Reclamos, Devoluciones, Mensajes)
-- ═══════════════════════════════════════════════════════════════

-- Reclamos (claims) abiertos
CREATE TABLE IF NOT EXISTS ml_reclamos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id TEXT NOT NULL UNIQUE,
  ml_order_id TEXT,
  pack_id TEXT,
  stage TEXT NOT NULL DEFAULT 'claim', -- claim, dispute, recontact
  status TEXT NOT NULL DEFAULT 'opened', -- opened, closed
  razon TEXT,
  tipo_recurso TEXT, -- order, shipment, payment, purchase
  comprador_id TEXT,
  comprador_nickname TEXT,
  comprador_nombre TEXT,
  fecha_creacion TIMESTAMPTZ,
  fecha_actualizacion TIMESTAMPTZ,
  resolucion TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  detalle JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_reclamos_status ON ml_reclamos(status);
CREATE INDEX IF NOT EXISTS idx_ml_reclamos_stage ON ml_reclamos(stage);
CREATE INDEX IF NOT EXISTS idx_ml_reclamos_order ON ml_reclamos(ml_order_id);
CREATE INDEX IF NOT EXISTS idx_ml_reclamos_fecha ON ml_reclamos(fecha_creacion DESC);

-- Devoluciones asociadas a reclamos
CREATE TABLE IF NOT EXISTS ml_devoluciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id TEXT UNIQUE,
  claim_id TEXT NOT NULL,
  ml_order_id TEXT,
  status TEXT, -- waiting_for_sender, shipped, delivered_to_buyer, etc.
  tracking_number TEXT,
  shipping_id TEXT,
  fecha_limite TIMESTAMPTZ,
  detalle JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_devoluciones_claim ON ml_devoluciones(claim_id);
CREATE INDEX IF NOT EXISTS idx_ml_devoluciones_status ON ml_devoluciones(status);
CREATE INDEX IF NOT EXISTS idx_ml_devoluciones_order ON ml_devoluciones(ml_order_id);

-- Mensajes pendientes por pack
CREATE TABLE IF NOT EXISTS ml_mensajes_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id TEXT NOT NULL UNIQUE,
  ml_order_id TEXT,
  comprador_id TEXT,
  comprador_nickname TEXT,
  ultimo_mensaje_texto TEXT,
  ultimo_mensaje_fecha TIMESTAMPTZ,
  cantidad_sin_leer INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'pendiente', -- pendiente, respondido, ignorado
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_mensajes_estado ON ml_mensajes_pendientes(estado);
CREATE INDEX IF NOT EXISTS idx_ml_mensajes_fecha ON ml_mensajes_pendientes(ultimo_mensaje_fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ml_mensajes_order ON ml_mensajes_pendientes(ml_order_id);

-- RLS
ALTER TABLE ml_reclamos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_devoluciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_mensajes_pendientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ml_reclamos_admin" ON ml_reclamos FOR ALL USING (true);
CREATE POLICY "ml_devoluciones_admin" ON ml_devoluciones FOR ALL USING (true);
CREATE POLICY "ml_mensajes_admin" ON ml_mensajes_pendientes FOR ALL USING (true);
