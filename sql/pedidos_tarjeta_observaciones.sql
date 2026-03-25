-- Agregar campos tarjeta_regalo y observaciones_pedido a pedidos_pos
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS tarjeta_regalo TEXT;
ALTER TABLE pedidos_pos ADD COLUMN IF NOT EXISTS observaciones_pedido TEXT;
