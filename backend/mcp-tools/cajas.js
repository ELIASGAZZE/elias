// MCP Tools — Cajas
module.exports = [
  {
    name: 'cajas_listar',
    description: 'Listar cajas registradoras',
    method: 'GET',
    path: '/api/cajas',
    params: {},
  },
  {
    name: 'cajas_crear',
    description: 'Crear una caja registradora',
    method: 'POST',
    path: '/api/cajas',
    params: {
      nombre: { type: 'string', description: 'Nombre de la caja', required: true },
      sucursal_id: { type: 'string', description: 'Sucursal', required: true },
    },
  },
  {
    name: 'cajas_editar',
    description: 'Editar una caja',
    method: 'PUT',
    path: '/api/cajas/:id',
    params: {
      id: { type: 'string', description: 'ID de la caja', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      sucursal_id: { type: 'string', description: 'Sucursal' },
    },
  },
]
