// MCP Tools — Auth
module.exports = [
  {
    name: 'auth_me',
    description: 'Obtener información del usuario autenticado actual',
    method: 'GET',
    path: '/api/auth/me',
    params: {},
  },
  {
    name: 'auth_listar_usuarios',
    description: 'Listar todos los usuarios del sistema',
    method: 'GET',
    path: '/api/auth/usuarios',
    params: {},
  },
  {
    name: 'auth_crear_usuario',
    description: 'Crear un nuevo usuario del sistema',
    method: 'POST',
    path: '/api/auth/usuarios',
    params: {
      username: { type: 'string', description: 'Nombre de usuario', required: true },
      password: { type: 'string', description: 'Contraseña', required: true },
      nombre: { type: 'string', description: 'Nombre completo', required: true },
      rol: { type: 'string', description: 'Rol del usuario', enum: ['admin', 'cajero', 'gestor'] },
      sucursal_id: { type: 'string', description: 'ID de sucursal asignada' },
    },
  },
  {
    name: 'auth_editar_usuario',
    description: 'Editar un usuario existente',
    method: 'PUT',
    path: '/api/auth/usuarios/:id',
    params: {
      id: { type: 'string', description: 'ID del usuario', required: true },
      username: { type: 'string', description: 'Nombre de usuario' },
      password: { type: 'string', description: 'Nueva contraseña' },
      nombre: { type: 'string', description: 'Nombre completo' },
      rol: { type: 'string', description: 'Rol del usuario' },
      sucursal_id: { type: 'string', description: 'ID de sucursal' },
    },
  },
  {
    name: 'auth_eliminar_usuario',
    description: 'Eliminar un usuario del sistema',
    method: 'DELETE',
    path: '/api/auth/usuarios/:id',
    params: {
      id: { type: 'string', description: 'ID del usuario', required: true },
    },
  },
]
