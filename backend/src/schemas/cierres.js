const { z } = require('zod')

// Shared: billetes/monedas son objetos JSONB { "1000": 5, "500": 3 }
const billetesSchema = z.record(z.string(), z.union([z.number(), z.string()])).optional().default({})

const abrirCierreSchema = z.object({
  caja_id: z.string().uuid('Seleccioná una caja'),
  codigo_empleado: z.string().min(1, 'Ingresá el código del empleado').optional(),
  empleado_id: z.string().uuid().optional(),
  planilla_id: z.union([z.string().min(1), z.number()], { message: 'El ID de planilla de caja es requerido' }),
  fondo_fijo: z.number().optional().default(0),
  fondo_fijo_billetes: billetesSchema,
  fondo_fijo_monedas: billetesSchema,
  diferencias_apertura: z.any().optional().nullable(),
  observaciones_apertura: z.string().optional().nullable(),
  skip_validacion: z.boolean().optional(),
}).passthrough()

const abrirCierrePosSchema = z.object({
  caja_id: z.string().uuid('Seleccioná una caja'),
  codigo_empleado: z.string().min(1, 'Ingresá el código del empleado'),
  fondo_fijo: z.number().optional().default(0),
  fondo_fijo_billetes: billetesSchema,
  fondo_fijo_monedas: billetesSchema,
  diferencias_apertura: z.any().optional().nullable(),
  observaciones_apertura: z.string().optional().nullable(),
}).passthrough()

const cerrarCierreSchema = z.object({
  billetes: billetesSchema,
  monedas: billetesSchema,
  total_efectivo: z.number().optional().default(0),
  medios_pago: z.array(z.any()).optional().default([]),
  total_general: z.number().optional().default(0),
  observaciones: z.string().optional().default(''),
  cambio_billetes: billetesSchema,
  cambio_monedas: billetesSchema,
  cambio_que_queda: z.number().optional().default(0),
  efectivo_retirado: z.number().optional().default(0),
  codigo_empleado: z.string().optional(),
}).passthrough()

const editarConteoSchema = cerrarCierreSchema.passthrough()

const verificarCierreSchema = z.object({
  billetes: billetesSchema,
  monedas: billetesSchema,
  total_efectivo: z.number().optional(),
  medios_pago: z.array(z.any()).optional(),
  total_general: z.number().optional(),
  observaciones: z.string().optional(),
}).passthrough()

const chatIASchema = z.object({
  mensaje: z.string().min(1, 'El mensaje es requerido'),
  historial: z.array(z.any()).optional(),
}).passthrough()

module.exports = {
  abrirCierreSchema,
  abrirCierrePosSchema,
  cerrarCierreSchema,
  editarConteoSchema,
  verificarCierreSchema,
  chatIASchema,
}
