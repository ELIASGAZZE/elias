-- ═══════════════════════════════════════════════════════════════
-- Módulo Mercado Libre — Publicaciones (Items/Listings)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ml_publicaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ml_item_id TEXT NOT NULL UNIQUE,
  titulo TEXT,
  precio NUMERIC(12,2),
  precio_original NUMERIC(12,2),
  moneda TEXT DEFAULT 'ARS',
  stock_disponible INTEGER DEFAULT 0,
  vendidos INTEGER DEFAULT 0,
  condicion TEXT, -- new, used
  estado TEXT, -- active, paused, closed, under_review, inactive
  permalink TEXT,
  thumbnail TEXT,
  categoria_id TEXT,
  tipo_publicacion TEXT, -- gold_special, gold_pro, etc.
  sku TEXT,
  tiene_variaciones BOOLEAN DEFAULT false,
  variaciones JSONB DEFAULT '[]'::jsonb,
  envio_gratis BOOLEAN DEFAULT false,
  fulfillment BOOLEAN DEFAULT false,
  catalogo BOOLEAN DEFAULT false,
  fecha_creacion TIMESTAMPTZ,
  fecha_actualizacion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_pub_estado ON ml_publicaciones(estado);
CREATE INDEX IF NOT EXISTS idx_ml_pub_titulo ON ml_publicaciones USING gin(to_tsvector('spanish', coalesce(titulo, '')));
CREATE INDEX IF NOT EXISTS idx_ml_pub_precio ON ml_publicaciones(precio);
CREATE INDEX IF NOT EXISTS idx_ml_pub_stock ON ml_publicaciones(stock_disponible);
CREATE INDEX IF NOT EXISTS idx_ml_pub_sku ON ml_publicaciones(sku);

ALTER TABLE ml_publicaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml_publicaciones_admin" ON ml_publicaciones FOR ALL USING (true);
