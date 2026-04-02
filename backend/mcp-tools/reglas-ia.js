// MCP Tools — Reglas IA
module.exports = [
  {
    name: 'reglas_ia_listar',
    description: 'Listar reglas de IA configuradas',
    method: 'GET',
    path: '/api/reglas-ia',
    params: {},
  },
  {
    name: 'reglas_ia_crear',
    description: 'Crear una regla de IA',
    method: 'POST',
    path: '/api/reglas-ia',
    params: {
      tipo: { type: 'string', description: 'Tipo de regla', required: true },
      descripcion: { type: 'string', description: 'Descripción de la regla', required: true },
      valor: { type: 'string', description: 'Valor/contenido de la regla' },
    },
  },
  {
    name: 'reglas_ia_eliminar',
    description: 'Eliminar una regla de IA',
    method: 'DELETE',
    path: '/api/reglas-ia/:id',
    params: {
      id: { type: 'string', description: 'ID de la regla', required: true },
    },
  },
]
