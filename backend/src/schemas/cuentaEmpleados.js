const { z } = require('zod')

const guardarDescuentosSchema = z.object({
  descuentos: z.array(z.object({
    rubro: z.string().min(1),
    rubro_id_centum: z.union([z.number(), z.string()]).optional().nullable(),
    porcentaje: z.union([z.number(), z.string()]),
  })),
}).passthrough()

const actualizarTopeSchema = z.object({
  tope_mensual: z.union([z.number(), z.string(), z.null()]).optional(),
}).passthrough()

const registrarVentaSchema = z.object({
  codigo_empleado: z.string().min(1, 'código de empleado requerido'),
  items: z.array(z.any()).min(1, 'items requeridos'),
  total: z.number().positive('total requerido'),
  sucursal_id: z.string().uuid().optional().nullable(),
  caja_id: z.string().uuid().optional().nullable(),
  nonce: z.string().optional().nullable(),
}).passthrough()

const registrarPagoSchema = z.object({
  monto: z.union([z.number(), z.string()]).refine(v => parseFloat(v) !== 0, 'El monto no puede ser 0'),
  concepto: z.string().max(500).optional().default(''),
}).passthrough()

module.exports = { guardarDescuentosSchema, actualizarTopeSchema, registrarVentaSchema, registrarPagoSchema }
