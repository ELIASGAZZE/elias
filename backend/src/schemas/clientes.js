const { z } = require('zod')

const crearClienteSchema = z.object({
  razon_social: z.string().min(1, 'Razón social requerida').max(200),
  cuit: z.string().max(20).optional().nullable(),
  direccion: z.string().max(200).optional().nullable(),
  localidad: z.string().max(100).optional().nullable(),
  codigo_postal: z.string().max(10).optional().nullable(),
  provincia: z.string().max(100).optional().nullable(),
  telefono: z.string().max(50).optional().nullable(),
  email: z.string().email('Email inválido').max(100).optional().nullable().or(z.literal('')),
  celular: z.string().max(50).optional().nullable(),
  condicion_iva: z.string().max(50).optional().nullable(),
  grupo_descuento_id: z.string().uuid().optional().nullable(),
  direcciones_entrega: z.array(z.object({
    direccion: z.string().max(200),
    localidad: z.string().max(100).optional(),
    codigo_postal: z.string().max(10).optional(),
    provincia: z.string().max(100).optional(),
    notas: z.string().max(500).optional(),
  })).optional(),
})

const editarClienteSchema = crearClienteSchema.partial().extend({
  razon_social: z.string().min(1, 'Razón social requerida').max(200).optional(),
})

module.exports = { crearClienteSchema, editarClienteSchema }
