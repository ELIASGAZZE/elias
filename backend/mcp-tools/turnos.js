// MCP Tools — Turnos
module.exports = [
  {
    name: 'turnos_listar',
    description: 'Listar turnos de trabajo definidos',
    method: 'GET',
    path: '/api/turnos',
    params: {},
  },
  {
    name: 'turnos_crear',
    description: 'Crear un turno de trabajo',
    method: 'POST',
    path: '/api/turnos',
    params: {
      nombre: { type: 'string', description: 'Nombre del turno', required: true },
      hora_inicio: { type: 'string', description: 'Hora inicio (HH:mm)' },
      hora_fin: { type: 'string', description: 'Hora fin (HH:mm)' },
    },
  },
  {
    name: 'turnos_asignaciones',
    description: 'Listar asignaciones de turnos a empleados',
    method: 'GET',
    path: '/api/turnos/asignaciones',
    params: {},
  },
  {
    name: 'turnos_crear_asignacion',
    description: 'Asignar un turno a un empleado',
    method: 'POST',
    path: '/api/turnos/asignaciones',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      turno_id: { type: 'string', description: 'ID del turno', required: true },
      dia_semana: { type: 'number', description: 'Día de la semana (1-7)' },
    },
  },
]
