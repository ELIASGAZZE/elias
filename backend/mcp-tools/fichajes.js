// MCP Tools — Fichajes (Reloj)
module.exports = [
  {
    name: 'fichajes_listar',
    description: 'Listar fichajes/registros de asistencia con filtros',
    method: 'GET',
    path: '/api/fichajes',
    params: {
      empleado_id: { type: 'string', description: 'Filtrar por empleado' },
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      fecha_desde: { type: 'string', description: 'Desde (YYYY-MM-DD)' },
      fecha_hasta: { type: 'string', description: 'Hasta (YYYY-MM-DD)' },
    },
    queryParams: ['empleado_id', 'sucursal_id', 'fecha_desde', 'fecha_hasta'],
  },
  {
    name: 'fichajes_estado',
    description: 'Ver si un empleado está fichado (entrada/salida)',
    method: 'GET',
    path: '/api/fichajes/estado/:empleadoId',
    params: {
      empleadoId: { type: 'string', description: 'ID del empleado', required: true },
    },
    noAuth: true,
  },
  {
    name: 'fichajes_ultimos',
    description: 'Obtener últimos fichajes (pantalla de reloj)',
    method: 'GET',
    path: '/api/fichajes/ultimos',
    params: {
      sucursal_id: { type: 'string', description: 'Sucursal' },
      limit: { type: 'number', description: 'Cantidad a mostrar' },
    },
    queryParams: ['sucursal_id', 'limit'],
    noAuth: true,
  },
  {
    name: 'fichajes_manual',
    description: 'Registrar fichaje manual (admin)',
    method: 'POST',
    path: '/api/fichajes/manual',
    params: {
      empleado_id: { type: 'string', description: 'ID del empleado', required: true },
      sucursal_id: { type: 'string', description: 'ID de la sucursal', required: true },
      tipo: { type: 'string', description: 'entrada o salida', required: true, enum: ['entrada', 'salida'] },
      fecha_hora: { type: 'string', description: 'Fecha y hora (ISO)' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'fichajes_eliminar',
    description: 'Eliminar un fichaje (admin)',
    method: 'DELETE',
    path: '/api/fichajes/:id',
    params: {
      id: { type: 'string', description: 'ID del fichaje', required: true },
    },
  },
  {
    name: 'fichajes_dashboard',
    description: 'Dashboard de asistencia/fichajes (admin)',
    method: 'GET',
    path: '/api/fichajes/dashboard',
    params: {},
  },
  {
    name: 'fichajes_reporte',
    description: 'Reporte de fichajes/asistencia (admin)',
    method: 'GET',
    path: '/api/fichajes/reporte',
    params: {
      fecha_desde: { type: 'string', description: 'Desde' },
      fecha_hasta: { type: 'string', description: 'Hasta' },
      empleado_id: { type: 'string', description: 'Filtrar por empleado' },
    },
    queryParams: ['fecha_desde', 'fecha_hasta', 'empleado_id'],
  },
  {
    name: 'fichajes_autorizaciones',
    description: 'Listar autorizaciones de fichaje (admin)',
    method: 'GET',
    path: '/api/fichajes/autorizaciones',
    params: {},
  },
]
