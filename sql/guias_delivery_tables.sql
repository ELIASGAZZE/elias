-- Tablas para el sistema de guías de delivery
-- Ejecutar en Supabase SQL Editor

-- 1. Guías de delivery (una por turno/fecha)
CREATE TABLE IF NOT EXISTS guias_delivery (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  turno TEXT NOT NULL CHECK (turno IN ('AM', 'PM')),
  cadete_id UUID REFERENCES empleados(id),
  cadete_nombre TEXT,
  cambio_entregado NUMERIC(12,2) DEFAULT 0,
  total_efectivo NUMERIC(12,2) DEFAULT 0,
  total_anticipado NUMERIC(12,2) DEFAULT 0,
  cantidad_pedidos INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'despachada' CHECK (estado IN ('despachada', 'cerrada', 'con_diferencia')),
  -- Cierre
  efectivo_recibido NUMERIC(12,2),
  diferencia NUMERIC(12,2),
  observaciones_cierre TEXT,
  cerrada_por UUID REFERENCES perfiles(id),
  cerrada_at TIMESTAMPTZ,
  -- Auditoría
  despachada_por UUID REFERENCES perfiles(id),
  sucursal_id UUID REFERENCES sucursales(id),
  cierre_pos_id UUID REFERENCES cierres_pos(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- No duplicar guía para misma fecha+turno
  UNIQUE(fecha, turno)
);

-- 2. Relación guía <-> pedidos
CREATE TABLE IF NOT EXISTS guia_delivery_pedidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guia_id UUID REFERENCES guias_delivery(id) ON DELETE CASCADE NOT NULL,
  pedido_pos_id UUID REFERENCES pedidos_pos(id) NOT NULL,
  venta_pos_id UUID REFERENCES ventas_pos(id),
  forma_pago TEXT CHECK (forma_pago IN ('anticipado', 'efectivo')),
  monto NUMERIC(12,2) DEFAULT 0,
  estado_entrega TEXT DEFAULT 'pendiente' CHECK (estado_entrega IN ('pendiente', 'entregado', 'no_entregado', 'rechazado')),
  motivo_no_entrega TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_guias_delivery_fecha ON guias_delivery(fecha);
CREATE INDEX IF NOT EXISTS idx_guias_delivery_estado ON guias_delivery(estado);
CREATE INDEX IF NOT EXISTS idx_guia_delivery_pedidos_guia ON guia_delivery_pedidos(guia_id);

-- RLS
ALTER TABLE guias_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE guia_delivery_pedidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guias_delivery_all" ON guias_delivery FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "guia_delivery_pedidos_all" ON guia_delivery_pedidos FOR ALL USING (true) WITH CHECK (true);
