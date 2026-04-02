// MCP Tools — Sucursales
module.exports = [
  {
    name: 'sucursales_listar',
    description: 'Listar sucursales/locales',
    method: 'GET',
    path: '/api/sucursales',
    params: {},
  },
  {
    name: 'sucursales_crear',
    description: 'Crear una sucursal',
    method: 'POST',
    path: '/api/sucursales',
    params: {
      nombre: { type: 'string', description: 'Nombre de la sucursal', required: true },
      direccion: { type: 'string', description: 'Dirección' },
    },
  },
  {
    name: 'sucursales_editar',
    description: 'Editar una sucursal',
    method: 'PUT',
    path: '/api/sucursales/:id',
    params: {
      id: { type: 'string', description: 'ID de la sucursal', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      direccion: { type: 'string', description: 'Dirección' },
    },
  },
]
