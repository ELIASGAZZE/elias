const { z } = require('zod')

const crearSucursalSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la sucursal es requerido').max(200),
}).passthrough()

const editarSucursalSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  centum_sucursal_id: z.union([z.number(), z.string(), z.null()]).optional(),
  centum_operador_empresa: z.string().max(200).optional().nullable(),
  centum_operador_prueba: z.string().max(200).optional().nullable(),
  mostrar_en_consulta: z.boolean().optional(),
  permite_pedidos: z.boolean().optional(),
}).passthrough()

module.exports = { crearSucursalSchema, editarSucursalSchema }
