// MCP Tools — Resoluciones
module.exports = [
  {
    name: 'resoluciones_listar',
    description: 'Listar resoluciones internas',
    method: 'GET',
    path: '/api/resoluciones',
    params: {},
  },
  {
    name: 'resoluciones_crear',
    description: 'Crear una resolución',
    method: 'POST',
    path: '/api/resoluciones',
    params: {
      titulo: { type: 'string', description: 'Título', required: true },
      contenido: { type: 'string', description: 'Contenido de la resolución', required: true },
    },
  },
  {
    name: 'resoluciones_estadisticas',
    description: 'Estadísticas de resoluciones',
    method: 'GET',
    path: '/api/resoluciones/estadisticas',
    params: {},
  },
]
