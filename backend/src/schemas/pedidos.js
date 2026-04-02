const { z } = require('zod')

const itemPedidoSchema = z.object({
  articulo_id: z.string().uuid('articulo_id inválido'),
  cantidad: z.number().positive('La cantidad debe ser mayor a 0'),
})

const crearPedidoSchema = z.object({
  sucursal_id: z.string().uuid('sucursal_id requerido'),
  nombre: z.string().max(200).optional().nullable(),
  tipo: z.string().max(50).optional(),
  items: z.array(itemPedidoSchema).min(1, 'El pedido debe tener al menos un artículo'),
}).passthrough()

const editarPedidoSchema = z.object({
  estado: z.enum(['pendiente', 'cargado_en_centum', 'cancelado']).optional(),
  items: z.array(itemPedidoSchema).optional(),
}).passthrough()

const cambiarEstadoPedidoSchema = z.object({
  estado: z.enum(['pendiente', 'cargado_en_centum', 'cancelado'], { message: 'Estado inválido' }),
})

module.exports = { crearPedidoSchema, editarPedidoSchema, cambiarEstadoPedidoSchema }
