const { z } = require('zod')

const itemVentaSchema = z.object({
  id_articulo: z.union([z.string(), z.number()]),
  nombre: z.string(),
  precio_unitario: z.number(),
  cantidad: z.number().positive(),
}).passthrough()

const pagoSchema = z.object({
  forma: z.string(),
  monto: z.number().min(0),
}).passthrough()

const crearVentaSchema = z.object({
  id_cliente_centum: z.number({ message: 'id_cliente_centum es requerido' }),
  nombre_cliente: z.string().optional().nullable(),
  items: z.array(itemVentaSchema).optional(),
  promociones_aplicadas: z.array(z.any()).optional(),
  subtotal: z.number().optional(),
  descuento_total: z.number().optional(),
  total: z.number().positive('total debe ser mayor a 0'),
  monto_pagado: z.number().optional(),
  vuelto: z.number().optional(),
  pagos: z.array(pagoSchema).optional(),
  descuento_forma_pago: z.number().optional(),
  pedido_pos_id: z.string().uuid().optional().nullable(),
  saldo_aplicado: z.number().optional(),
  gift_cards_aplicadas: z.array(z.any()).optional(),
  gift_cards_a_activar: z.array(z.any()).optional(),
  caja_id: z.string().uuid().optional().nullable(),
  canal: z.string().optional(),
  descuento_grupo_cliente: z.number().optional(),
  grupo_descuento_nombre: z.string().optional().nullable(),
  created_at_offline: z.string().optional().nullable(),
  condicion_iva: z.string().optional().nullable(),
}).passthrough()

module.exports = { crearVentaSchema }
