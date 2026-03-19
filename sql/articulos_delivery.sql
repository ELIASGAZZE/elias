-- Tabla para artículos con precios especiales de delivery (PedidosYa/Rappi)
CREATE TABLE articulos_delivery (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  articulo_id_centum INT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  precio_delivery NUMERIC(12,2) NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Canal de venta en ventas_pos (pos / delivery)
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS canal TEXT DEFAULT 'pos';
