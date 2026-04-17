-- Agregar campo id_pedido_plataforma a ventas_pos
-- Almacena el ID/Nro de orden de plataformas delivery (Rappi, PedidosYa)
ALTER TABLE ventas_pos ADD COLUMN IF NOT EXISTS id_pedido_plataforma TEXT DEFAULT NULL;
