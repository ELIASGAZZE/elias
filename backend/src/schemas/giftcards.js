const { z } = require('zod')

const activarGiftCardSchema = z.object({
  codigo: z.string().min(1, 'Código es requerido').length(19, 'El código debe tener exactamente 19 dígitos'),
  monto: z.number().positive('Monto debe ser mayor a 0'),
  comprador_nombre: z.string().max(200).optional().nullable(),
  pagos: z.array(z.any()).optional(),
  caja_id: z.string().uuid().optional().nullable(),
  sucursal_id: z.string().uuid().optional().nullable(),
  cierre_id: z.string().uuid().optional().nullable(),
  cajero_nombre: z.string().max(200).optional().nullable(),
}).passthrough()

const usarGiftCardSchema = z.object({
  codigo: z.string().min(1, 'Código es requerido'),
  monto: z.number().positive('Monto debe ser mayor a 0'),
  venta_pos_id: z.string().uuid().optional().nullable(),
}).passthrough()

module.exports = { activarGiftCardSchema, usarGiftCardSchema }
