// MCP Tools — Licencias y Feriados
module.exports = [
  {
    name: 'licencias_listar',
    description: 'Listar licencias de empleados',
    method: 'GET',
    path: '/api/licencias',
    params: {},
  },
  {
    name: 'licencias_crear',
    description: 'Crear licencia para un empleado',
    method: 'POST',
    path: '/api/licencias',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      tipo: { type: 'string', description: 'Tipo de licencia', required: true },
      fecha_desde: { type: 'string', description: 'Fecha inicio', required: true },
      fecha_hasta: { type: 'string', description: 'Fecha fin', required: true },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'feriados_listar',
    description: 'Listar feriados configurados',
    method: 'GET',
    path: '/api/feriados',
    params: {},
  },
  {
    name: 'feriados_crear',
    description: 'Crear un feriado',
    method: 'POST',
    path: '/api/feriados',
    params: {
      nombre: { type: 'string', description: 'Nombre del feriado', required: true },
      fecha: { type: 'string', description: 'Fecha (YYYY-MM-DD)', required: true },
    },
  },
]
