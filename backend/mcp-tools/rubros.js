// MCP Tools — Rubros
module.exports = [
  {
    name: 'rubros_listar',
    description: 'Listar rubros/categorías de artículos',
    method: 'GET',
    path: '/api/rubros',
    params: {},
  },
  {
    name: 'rubros_crear',
    description: 'Crear un rubro',
    method: 'POST',
    path: '/api/rubros',
    params: {
      nombre: { type: 'string', description: 'Nombre del rubro', required: true },
      color: { type: 'string', description: 'Color hex para el POS' },
    },
  },
]
