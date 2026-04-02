const { z } = require('zod')

const billetesSchema = z.record(z.string(), z.union([z.number(), z.string()])).optional().default({})

const crearRetiroSchema = z.object({
  codigo_empleado: z.string().min(1, 'Ingresá el código del empleado'),
  billetes: billetesSchema,
  monedas: billetesSchema,
  total: z.number().optional().default(0),
  observaciones: z.string().max(1000).optional().default(''),
}).passthrough()

const verificarRetiroSchema = z.object({
  billetes: billetesSchema,
  monedas: billetesSchema,
  total: z.number().optional().default(0),
  observaciones: z.string().max(1000).optional().default(''),
}).passthrough()

module.exports = { crearRetiroSchema, verificarRetiroSchema }
