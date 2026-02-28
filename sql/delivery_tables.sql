-- ============================================================
-- App Delivery: tablas clientes, pedidos_delivery, items_delivery
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- 1. Tabla clientes
CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  razon_social TEXT NOT NULL,
  cuit TEXT,
  direccion TEXT,
  localidad TEXT,
  codigo_postal TEXT,
  provincia TEXT,
  telefono TEXT,
  id_centum INTEGER,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clientes_codigo ON clientes(codigo);
CREATE INDEX idx_clientes_razon_social ON clientes(razon_social);
CREATE INDEX idx_clientes_id_centum ON clientes(id_centum);

-- 2. Tabla pedidos_delivery
CREATE TABLE pedidos_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  usuario_id UUID NOT NULL REFERENCES perfiles(id),
  sucursal_id UUID NOT NULL REFERENCES sucursales(id),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'en_preparacion', 'en_camino', 'entregado', 'cancelado')),
  observaciones TEXT,
  direccion_entrega TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pedidos_delivery_estado ON pedidos_delivery(estado);
CREATE INDEX idx_pedidos_delivery_cliente ON pedidos_delivery(cliente_id);
CREATE INDEX idx_pedidos_delivery_sucursal ON pedidos_delivery(sucursal_id);

-- 3. Tabla items_delivery
CREATE TABLE items_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos_delivery(id) ON DELETE CASCADE,
  articulo_id UUID NOT NULL REFERENCES articulos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  observaciones TEXT
);

CREATE INDEX idx_items_delivery_pedido ON items_delivery(pedido_id);

-- 4. Habilitar RLS (Row Level Security) — policies abiertas, auth se maneja en backend
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access clientes" ON clientes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access pedidos_delivery" ON pedidos_delivery FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access items_delivery" ON items_delivery FOR ALL USING (true) WITH CHECK (true);
