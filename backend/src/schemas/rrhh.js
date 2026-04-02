const { z } = require('zod')

// ── Turnos ──────────────────────────────────────────────────────────────────

const crearTurnoSchema = z.object({
  nombre: z.string().min(1, 'nombre es requerido').max(100),
  hora_entrada: z.string().min(1, 'hora_entrada es requerido'),
  hora_salida: z.string().min(1, 'hora_salida es requerido'),
  tolerancia_entrada_min: z.number().int().optional().default(10),
  tolerancia_salida_min: z.number().int().optional().default(10),
}).passthrough()

const editarTurnoSchema = z.object({
  nombre: z.string().min(1).max(100).optional(),
  hora_entrada: z.string().optional(),
  hora_salida: z.string().optional(),
  tolerancia_entrada_min: z.number().int().optional(),
  tolerancia_salida_min: z.number().int().optional(),
  activo: z.boolean().optional(),
}).passthrough()

const crearAsignacionSchema = z.object({
  empleado_id: z.string().uuid('empleado_id requerido'),
  turno_id: z.string().uuid('turno_id requerido'),
  dia_semana: z.number().int().min(0).max(6, 'dia_semana debe ser 0-6'),
  vigente_desde: z.string().optional(),
  vigente_hasta: z.string().optional().nullable(),
}).passthrough()

const editarAsignacionSchema = z.object({
  turno_id: z.string().uuid().optional(),
  vigente_hasta: z.string().optional().nullable(),
}).passthrough()

// ── Feriados ────────────────────────────────────────────────────────────────

const crearFeriadoSchema = z.object({
  fecha: z.string().min(1, 'fecha es requerido'),
  descripcion: z.string().min(1, 'descripcion es requerido').max(200),
  tipo: z.string().max(50).optional().default('empresa'),
  anio: z.union([z.number(), z.string()]).optional().nullable(),
}).passthrough()

const importarFeriadosSchema = z.object({
  anio: z.union([z.number(), z.string()]).optional(),
}).passthrough()

// ── Licencias ───────────────────────────────────────────────────────────────

const crearLicenciaSchema = z.object({
  empleado_id: z.string().uuid('empleado_id requerido'),
  tipo: z.string().min(1, 'tipo es requerido').max(100),
  fecha_desde: z.string().min(1, 'fecha_desde es requerido'),
  fecha_hasta: z.string().min(1, 'fecha_hasta es requerido'),
  observaciones: z.string().max(1000).optional().nullable(),
}).passthrough()

const editarLicenciaSchema = z.object({
  estado: z.enum(['pendiente', 'aprobada', 'rechazada']).optional(),
  observaciones: z.string().max(1000).optional().nullable(),
}).passthrough()

module.exports = {
  crearTurnoSchema,
  editarTurnoSchema,
  crearAsignacionSchema,
  editarAsignacionSchema,
  crearFeriadoSchema,
  importarFeriadosSchema,
  crearLicenciaSchema,
  editarLicenciaSchema,
}
