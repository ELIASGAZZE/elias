const { z } = require('zod')

const fichajesPinSchema = z.object({
  pin: z.string().min(1, 'Código inválido'),
  sucursal_id: z.string().uuid().optional().nullable(),
}).passthrough()

const fichajeManualSchema = z.object({
  empleado_id: z.string().uuid('empleado_id requerido'),
  tipo: z.enum(['entrada', 'salida'], { message: 'tipo debe ser entrada o salida' }),
  fecha_hora: z.string().min(1, 'fecha_hora es requerido'),
  sucursal_id: z.string().uuid().optional().nullable(),
  observaciones: z.string().max(1000).optional().nullable(),
}).passthrough()

const autorizacionSchema = z.object({
  empleado_id: z.string().uuid('empleado_id requerido'),
  fecha: z.string().min(1, 'fecha es requerido'),
  tipo: z.string().min(1, 'tipo es requerido').max(50),
  hora_autorizada: z.string().max(10).optional().nullable(),
  motivo: z.string().max(500).optional().nullable(),
}).passthrough()

module.exports = { fichajesPinSchema, fichajeManualSchema, autorizacionSchema }
