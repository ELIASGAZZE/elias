const { z } = require('zod')

const crearProveedorSchema = z.object({
  nombre: z.string().min(1, 'Nombre requerido').max(200),
  cuit: z.string().max(20).optional().nullable(),
  codigo: z.string().max(50).optional().nullable(),
  lead_time_dias: z.number().optional().nullable(),
  lead_time_variabilidad_dias: z.number().optional().nullable(),
  dias_pedido: z.array(z.number().int().min(0).max(6)).optional().default([]),
  contacto: z.string().max(200).optional().nullable(),
  telefono: z.string().max(50).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  whatsapp: z.string().max(50).optional().nullable(),
  monto_minimo: z.number().optional().default(0),
  notas: z.string().max(2000).optional().nullable(),
}).passthrough()

const editarProveedorSchema = crearProveedorSchema.partial().extend({
  activo: z.boolean().optional(),
}).passthrough()

const vincularArticuloSchema = z.object({
  articulo_id: z.string().uuid('articulo_id requerido'),
  unidad_compra: z.string().max(50).optional().nullable(),
  factor_conversion: z.number().positive().optional().default(1),
  codigo_proveedor: z.string().max(50).optional().nullable(),
  precio_compra: z.number().optional().nullable(),
  es_principal: z.boolean().optional().default(false),
}).passthrough()

const crearOrdenSchema = z.object({
  proveedor_id: z.string().uuid('proveedor_id requerido'),
  items: z.array(z.any()).optional().default([]),
  notas: z.string().max(2000).optional().nullable(),
  fecha_entrega_esperada: z.string().optional().nullable(),
  metodo_envio: z.string().max(100).optional().nullable(),
  analisis_ia_id: z.string().uuid().optional().nullable(),
}).passthrough()

const editarOrdenSchema = z.object({
  items: z.array(z.any()).optional(),
  notas: z.string().max(2000).optional().nullable(),
  fecha_entrega_esperada: z.string().optional().nullable(),
  metodo_envio: z.string().max(100).optional().nullable(),
}).passthrough()

const chatComprasSchema = z.object({
  mensaje: z.string().min(1, 'mensaje requerido'),
  historial: z.array(z.any()).optional().default([]),
}).passthrough()

const crearAjusteSchema = z.object({
  articulo_id: z.string().uuid('articulo_id requerido'),
  orden_compra_id: z.string().uuid().optional().nullable(),
  cantidad_sugerida: z.number().optional().nullable(),
  cantidad_final: z.number().optional().nullable(),
  motivo: z.string().max(200).optional().nullable(),
  nota: z.string().max(1000).optional().nullable(),
}).passthrough()

const crearReglaIASchema = z.object({
  regla: z.string().min(1, 'regla requerida').max(2000),
  categoria: z.string().max(100).optional().default('general'),
  proveedor_id: z.string().uuid().optional().nullable(),
  articulo_id: z.string().uuid().optional().nullable(),
}).passthrough()

const consumoInternoSchema = z.object({
  articulo_id: z.string().uuid('articulo_id requerido'),
  cantidad: z.number().positive('cantidad requerida'),
  motivo: z.string().max(200).optional().default('otro'),
  notas: z.string().max(1000).optional().nullable(),
  sucursal_id: z.string().uuid().optional().nullable(),
  fecha: z.string().optional(),
}).passthrough()

const crearPedidoExtraSchema = z.object({
  cantidad: z.number().positive('cantidad requerida'),
  articulo_id: z.string().uuid().optional().nullable(),
  articulo_nombre: z.string().max(200).optional().nullable(),
  cliente_nombre: z.string().max(200).optional().nullable(),
  fecha_necesaria: z.string().optional().nullable(),
  notas: z.string().max(1000).optional().nullable(),
}).passthrough()

const crearPromocionProveedorSchema = z.object({
  tipo: z.string().min(1, 'tipo requerido').max(50),
  articulo_id: z.string().uuid().optional().nullable(),
  cantidad_minima: z.number().optional().nullable(),
  cantidad_bonus: z.number().optional().nullable(),
  descuento_porcentaje: z.number().optional().nullable(),
  precio_especial: z.number().optional().nullable(),
  descripcion: z.string().max(500).optional().nullable(),
  vigente_desde: z.string().optional().nullable(),
  vigente_hasta: z.string().optional().nullable(),
}).passthrough()

module.exports = {
  crearProveedorSchema,
  editarProveedorSchema,
  vincularArticuloSchema,
  crearOrdenSchema,
  editarOrdenSchema,
  chatComprasSchema,
  crearAjusteSchema,
  crearReglaIASchema,
  consumoInternoSchema,
  crearPedidoExtraSchema,
  crearPromocionProveedorSchema,
}
