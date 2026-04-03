const { z } = require('zod')

const crearTareaSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la tarea es requerido').max(200),
  descripcion: z.string().max(2000).optional().nullable(),
  enlace_manual: z.string().max(500).optional().nullable(),
  checklist_imprimible: z.string().max(5000).optional().nullable(),
  subtareas: z.array(z.object({
    nombre: z.string().min(1).max(200),
    orden: z.number().optional(),
  })).optional(),
}).passthrough()

const editarTareaSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(2000).optional().nullable(),
  enlace_manual: z.string().max(500).optional().nullable(),
  activo: z.boolean().optional(),
  checklist_imprimible: z.string().max(5000).optional().nullable(),
}).passthrough()

const crearSubtareaSchema = z.object({
  nombre: z.string().min(1, 'El nombre de la subtarea es requerido').max(200),
  orden: z.number().optional().default(0),
}).passthrough()

const editarSubtareaSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  orden: z.number().optional(),
  activo: z.boolean().optional(),
}).passthrough()

const crearConfigSchema = z.object({
  sucursal_id: z.string().uuid('La sucursal es requerida'),
  tipo: z.string().max(50).optional().default('frecuencia'),
  frecuencia_dias: z.number().int().positive().optional().default(7),
  dias_semana: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  dia_preferencia: z.string().max(50).optional().nullable(),
  reprogramar_siguiente: z.boolean().optional().default(true),
  fecha_inicio: z.string().max(20).optional(),
}).passthrough()

const editarConfigSchema = z.object({
  tipo: z.string().max(50).optional(),
  frecuencia_dias: z.number().int().positive().optional(),
  dias_semana: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  dia_preferencia: z.string().max(50).optional().nullable(),
  reprogramar_siguiente: z.boolean().optional(),
  fecha_inicio: z.string().max(20).optional(),
  activo: z.boolean().optional(),
}).passthrough()

const ejecutarTareaSchema = z.object({
  tarea_config_id: z.string().uuid('tarea_config_id es requerido'),
  empleados_ids: z.array(z.string().uuid()).optional(),
  subtareas_completadas: z.array(z.object({
    subtarea_id: z.string().uuid(),
    completada: z.boolean().optional(),
  })).optional(),
  observaciones: z.string().max(2000).optional().nullable(),
  calificacion: z.union([z.number().int().min(1).max(5), z.string()]).optional().nullable(),
}).passthrough()

module.exports = {
  crearTareaSchema,
  editarTareaSchema,
  crearSubtareaSchema,
  editarSubtareaSchema,
  crearConfigSchema,
  editarConfigSchema,
  ejecutarTareaSchema,
}
