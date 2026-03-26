-- ═══════════════════════════════════════════════════════════════
-- Módulo de Órdenes de Traspaso — Tablas Supabase
-- Fecha: 2026-03-21
-- ═══════════════════════════════════════════════════════════════

-- ── Órdenes de traspaso ───────────────────────────────────────
CREATE TABLE ordenes_traspaso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT UNIQUE,
  sucursal_origen_id UUID NOT NULL,
  sucursal_destino_id UUID NOT NULL,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_preparacion', 'preparado', 'despachado', 'recibido', 'con_diferencia', 'cancelado')),
  items JSONB DEFAULT '[]',
  notas TEXT,
  creado_por UUID,
  preparado_por UUID,
  despachado_por UUID,
  recibido_por UUID,
  preparado_at TIMESTAMPTZ,
  despachado_at TIMESTAMPTZ,
  recibido_at TIMESTAMPTZ,
  centum_ajuste_origen_id TEXT,
  centum_ajuste_destino_id TEXT,
  centum_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ot_estado ON ordenes_traspaso(estado);
CREATE INDEX idx_ot_sucursal_origen ON ordenes_traspaso(sucursal_origen_id);
CREATE INDEX idx_ot_sucursal_destino ON ordenes_traspaso(sucursal_destino_id);
CREATE INDEX idx_ot_created ON ordenes_traspaso(created_at);

-- ── Canastos de traspaso ──────────────────────────────────────
CREATE TABLE traspaso_canastos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_traspaso_id UUID NOT NULL REFERENCES ordenes_traspaso(id) ON DELETE CASCADE,
  precinto TEXT NOT NULL,
  items JSONB DEFAULT '[]',
  peso_origen NUMERIC(10,3),
  peso_destino NUMERIC(10,3),
  estado TEXT DEFAULT 'en_preparacion' CHECK (estado IN ('en_preparacion', 'cerrado', 'despachado', 'aprobado', 'verificacion_manual', 'con_diferencia')),
  diferencias JSONB,
  verificado_por UUID,
  verificado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tc_orden ON traspaso_canastos(orden_traspaso_id);
CREATE INDEX idx_tc_estado ON traspaso_canastos(estado);

-- ── Configuración de traspasos ────────────────────────────────
CREATE TABLE traspaso_config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO traspaso_config (clave, valor) VALUES
  ('tolerancia_peso_porcentaje', '2');

-- ── Secuencia para número de orden ────────────────────────────
CREATE SEQUENCE IF NOT EXISTS ordenes_traspaso_numero_seq START 1;

-- ── RLS (políticas abiertas para service key) ─────────────────
ALTER TABLE ordenes_traspaso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ordenes_traspaso_all" ON ordenes_traspaso FOR ALL USING (true);

ALTER TABLE traspaso_canastos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "traspaso_canastos_all" ON traspaso_canastos FOR ALL USING (true);

ALTER TABLE traspaso_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "traspaso_config_all" ON traspaso_config FOR ALL USING (true);
