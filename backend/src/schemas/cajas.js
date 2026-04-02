const { z } = require('zod')

const crearCajaSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la caja es requerido').max(200),
  sucursal_id: z.string().uuid('La sucursal es requerida'),
}).passthrough()

const editarCajaSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  activo: z.boolean().optional(),
  punto_venta_centum: z.union([z.number(), z.string(), z.null()]).optional(),
}).passthrough()

module.exports = { crearCajaSchema, editarCajaSchema }
