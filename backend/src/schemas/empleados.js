const { z } = require('zod')

const crearEmpleadoSchema = z.object({
  nombre: z.string().min(1, 'El nombre del empleado es requerido').max(200),
  codigo: z.string().min(1, 'El código del empleado es requerido').max(50),
  sucursal_id: z.string().uuid().optional().nullable(),
  empresa: z.string().max(50).optional().nullable(),
  fecha_cumpleanos: z.string().max(20).optional().nullable(),
}).passthrough()

const editarEmpleadoSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  codigo: z.string().min(1).max(50).optional(),
  sucursal_id: z.string().uuid().optional().nullable(),
  activo: z.boolean().optional(),
  empresa: z.string().max(50).optional().nullable(),
  fecha_cumpleanos: z.string().max(20).optional().nullable(),
}).passthrough()

const asignarPinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'El PIN debe ser de 4-6 dígitos numéricos'),
  temporal: z.boolean().optional(),
})

const cambiarPinSchema = z.object({
  empleado_id: z.string().uuid('empleado_id requerido'),
  pin_actual: z.string().min(1, 'pin_actual requerido'),
  pin_nuevo: z.string().regex(/^\d{4,6}$/, 'El PIN nuevo debe ser de 4-6 dígitos numéricos'),
})

module.exports = { crearEmpleadoSchema, editarEmpleadoSchema, asignarPinSchema, cambiarPinSchema }
