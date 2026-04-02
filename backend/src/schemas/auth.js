const { z } = require('zod')

const loginSchema = z.object({
  username: z.string().min(1, 'Usuario requerido').max(50),
  password: z.string().min(1, 'Contraseña requerida').max(200),
})

const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token requerido'),
})

const crearUsuarioSchema = z.object({
  username: z.string()
    .min(1, 'Username requerido')
    .max(50)
    .regex(/^[a-z0-9.]+$/, 'Solo letras minúsculas, números y puntos'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
  nombre: z.string().min(1, 'Nombre requerido').max(100),
  rol: z.enum(['admin', 'operario', 'gestor'], { message: 'Rol inválido' }),
  sucursal_id: z.string().uuid().optional().nullable(),
})

const editarUsuarioSchema = z.object({
  nombre: z.string().min(1, 'Nombre requerido').max(100),
  rol: z.enum(['admin', 'operario', 'gestor'], { message: 'Rol inválido' }),
  sucursal_id: z.string().uuid().optional().nullable(),
  username: z.string().max(50).regex(/^[a-z0-9.]+$/, 'Solo letras minúsculas, números y puntos').optional(),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200).optional().or(z.literal('')),
})

module.exports = { loginSchema, refreshSchema, crearUsuarioSchema, editarUsuarioSchema }
