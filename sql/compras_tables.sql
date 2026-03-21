-- ═══════════════════════════════════════════════════════════════
-- Módulo de Compras Inteligentes con IA — Tablas Supabase
-- Fecha: 2026-03-20
-- ═══════════════════════════════════════════════════════════════

-- ── Proveedores ──────────────────────────────────────────────
CREATE TABLE proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  cuit TEXT,
  codigo TEXT,
  lead_time_dias INT DEFAULT 1,
  lead_time_variabilidad_dias INT DEFAULT 0,
  dias_pedido TEXT[] DEFAULT '{}',
  contacto TEXT,
  telefono TEXT,
  email TEXT,
  whatsapp TEXT,
  monto_minimo NUMERIC(12,2) DEFAULT 0,
  notas TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_proveedores_activo ON proveedores(activo);
CREATE INDEX idx_proveedores_nombre ON proveedores(nombre);

-- ── Proveedor ↔ Artículos ───────────────────────────────────
CREATE TABLE proveedor_articulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  articulo_id TEXT NOT NULL,
  unidad_compra TEXT DEFAULT 'unidad',
  factor_conversion INT DEFAULT 1,
  codigo_proveedor TEXT,
  precio_compra NUMERIC(12,2),
  es_principal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(proveedor_id, articulo_id)
);

CREATE INDEX idx_pa_proveedor ON proveedor_articulos(proveedor_id);
CREATE INDEX idx_pa_articulo ON proveedor_articulos(articulo_id);

-- ── Promociones de proveedor ────────────────────────────────
CREATE TABLE proveedor_promociones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  articulo_id TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('bonificacion', 'descuento', 'precio_especial')),
  cantidad_minima INT,
  cantidad_bonus INT,
  descuento_porcentaje NUMERIC(5,2),
  precio_especial NUMERIC(12,2),
  descripcion TEXT,
  vigente_desde DATE,
  vigente_hasta DATE,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pp_proveedor ON proveedor_promociones(proveedor_id);
CREATE INDEX idx_pp_activa ON proveedor_promociones(activa);

-- ── Órdenes de compra ───────────────────────────────────────
CREATE TABLE ordenes_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT UNIQUE,
  proveedor_id UUID NOT NULL REFERENCES proveedores(id),
  estado TEXT DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada', 'recibida_parcial', 'recibida', 'cancelada')),
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  fecha_entrega_esperada DATE,
  metodo_envio TEXT,
  enviado_at TIMESTAMPTZ,
  notas TEXT,
  creado_por UUID,
  analisis_ia_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_oc_proveedor ON ordenes_compra(proveedor_id);
CREATE INDEX idx_oc_estado ON ordenes_compra(estado);
CREATE INDEX idx_oc_created ON ordenes_compra(created_at);

-- ── Recepciones de compra (Fase 2, se crea ahora) ──────────
CREATE TABLE recepciones_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID NOT NULL REFERENCES ordenes_compra(id),
  fecha TIMESTAMPTZ DEFAULT now(),
  items JSONB DEFAULT '[]',
  observaciones TEXT,
  recibido_por UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rc_orden ON recepciones_compra(orden_compra_id);

-- ── Ajustes de compra (aprendizaje IA) ──────────────────────
CREATE TABLE compras_ajustes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_compra_id UUID REFERENCES ordenes_compra(id),
  articulo_id TEXT NOT NULL,
  cantidad_sugerida NUMERIC(10,2),
  cantidad_final NUMERIC(10,2),
  motivo TEXT CHECK (motivo IN ('consumo_interno', 'pedido_especial', 'estacionalidad', 'promo_propia', 'merma', 'otro')),
  nota TEXT,
  ajustado_por UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ca_articulo ON compras_ajustes(articulo_id);
CREATE INDEX idx_ca_created ON compras_ajustes(created_at);

-- ── Reglas IA de compras ────────────────────────────────────
CREATE TABLE compras_reglas_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  regla TEXT NOT NULL,
  categoria TEXT DEFAULT 'general' CHECK (categoria IN ('general', 'proveedor', 'articulo', 'estacionalidad')),
  proveedor_id UUID REFERENCES proveedores(id),
  articulo_id TEXT,
  activa BOOLEAN DEFAULT true,
  creado_por UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cri_activa ON compras_reglas_ia(activa);

-- ── Análisis IA de compras ──────────────────────────────────
CREATE TABLE compras_analisis_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT CHECK (tipo IN ('demanda', 'orden_sugerida', 'chat')),
  proveedor_id UUID REFERENCES proveedores(id),
  resultado JSONB,
  modelo TEXT,
  tokens_usados INT DEFAULT 0,
  parametros JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cai_proveedor ON compras_analisis_ia(proveedor_id);
CREATE INDEX idx_cai_created ON compras_analisis_ia(created_at);

-- ── Consumo interno ─────────────────────────────────────────
CREATE TABLE consumo_interno (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id TEXT NOT NULL,
  cantidad NUMERIC(10,3) NOT NULL,
  motivo TEXT CHECK (motivo IN ('produccion', 'degustacion', 'merma', 'vencimiento', 'rotura', 'otro')),
  notas TEXT,
  sucursal_id UUID,
  fecha DATE DEFAULT CURRENT_DATE,
  registrado_por UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ci_articulo ON consumo_interno(articulo_id);
CREATE INDEX idx_ci_fecha ON consumo_interno(fecha);

-- ── Pedidos extraordinarios ─────────────────────────────────
CREATE TABLE pedidos_extraordinarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id TEXT,
  articulo_nombre TEXT,
  cantidad NUMERIC(10,2) NOT NULL,
  cliente_nombre TEXT,
  fecha_necesaria DATE,
  estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'incluido_en_oc', 'entregado')),
  orden_compra_id UUID REFERENCES ordenes_compra(id),
  notas TEXT,
  creado_por UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pe_estado ON pedidos_extraordinarios(estado);
CREATE INDEX idx_pe_fecha ON pedidos_extraordinarios(fecha_necesaria);

-- ── RLS (políticas abiertas para service key) ───────────────
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proveedores_all" ON proveedores FOR ALL USING (true);

ALTER TABLE proveedor_articulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proveedor_articulos_all" ON proveedor_articulos FOR ALL USING (true);

ALTER TABLE proveedor_promociones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proveedor_promociones_all" ON proveedor_promociones FOR ALL USING (true);

ALTER TABLE ordenes_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ordenes_compra_all" ON ordenes_compra FOR ALL USING (true);

ALTER TABLE recepciones_compra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recepciones_compra_all" ON recepciones_compra FOR ALL USING (true);

ALTER TABLE compras_ajustes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compras_ajustes_all" ON compras_ajustes FOR ALL USING (true);

ALTER TABLE compras_reglas_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compras_reglas_ia_all" ON compras_reglas_ia FOR ALL USING (true);

ALTER TABLE compras_analisis_ia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compras_analisis_ia_all" ON compras_analisis_ia FOR ALL USING (true);

ALTER TABLE consumo_interno ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consumo_interno_all" ON consumo_interno FOR ALL USING (true);

ALTER TABLE pedidos_extraordinarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pedidos_extraordinarios_all" ON pedidos_extraordinarios FOR ALL USING (true);

-- ── Secuencia para número de orden ──────────────────────────
CREATE SEQUENCE IF NOT EXISTS ordenes_compra_numero_seq START 1;
