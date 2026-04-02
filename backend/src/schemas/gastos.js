const { z } = require('zod')

const crearGastoSchema = z.object({
  descripcion: z.string().min(1, 'La descripción es obligatoria').max(500),
  importe: z.number().positive('El importe debe ser mayor a $0'),
}).passthrough()

const controlarGastoSchema = z.object({
  controlado: z.boolean().optional().default(true),
}).passthrough()

module.exports = { crearGastoSchema, controlarGastoSchema }
