-- Congelar descuentos/promociones al crear un pedido POS
-- Al entregar se respetan los descuentos vigentes al momento de armar el pedido,
-- tal como ya ocurre con el descuento_forma_pago en pagos anticipados.

ALTER TABLE pedidos_pos
  ADD COLUMN IF NOT EXISTS promociones_aplicadas jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS descuento_grupo_cliente numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_grupo_cliente_detalle jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS grupo_descuento_nombre text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS descuento_total numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS condicion_iva text DEFAULT NULL;

COMMENT ON COLUMN pedidos_pos.promociones_aplicadas IS 'Snapshot de promociones aplicadas al crear el pedido; se respeta al entregar';
COMMENT ON COLUMN pedidos_pos.descuento_grupo_cliente IS 'Monto del descuento por grupo de cliente, congelado al crear el pedido';
COMMENT ON COLUMN pedidos_pos.subtotal IS 'Subtotal bruto (items a precio de lista antes de descuentos)';
COMMENT ON COLUMN pedidos_pos.descuento_total IS 'Descuento por promociones condicionales (no incluye grupo cliente ni forma de pago)';
