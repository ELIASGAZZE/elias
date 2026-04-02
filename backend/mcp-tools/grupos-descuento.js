// MCP Tools — Grupos de Descuento
module.exports = [
  {
    name: 'grupos_descuento_listar',
    description: 'Listar grupos de descuento para clientes',
    method: 'GET',
    path: '/api/grupos-descuento',
    params: {},
  },
  {
    name: 'grupos_descuento_crear',
    description: 'Crear grupo de descuento',
    method: 'POST',
    path: '/api/grupos-descuento',
    params: {
      nombre: { type: 'string', description: 'Nombre del grupo', required: true },
      porcentaje: { type: 'number', description: 'Porcentaje de descuento', required: true },
    },
  },
]
