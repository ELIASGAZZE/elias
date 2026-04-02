// MCP Tools — Empleados
module.exports = [
  {
    name: 'empleados_listar',
    description: 'Listar empleados con filtros opcionales',
    method: 'GET',
    path: '/api/empleados',
    params: {
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
      todas: { type: 'boolean', description: 'Incluir inactivos' },
      empresa: { type: 'string', description: 'Filtrar por empresa' },
    },
    queryParams: ['sucursal_id', 'todas', 'empresa'],
  },
  {
    name: 'empleados_por_codigo',
    description: 'Obtener empleado por su código',
    method: 'GET',
    path: '/api/empleados/por-codigo/:codigo',
    params: {
      codigo: { type: 'string', description: 'Código del empleado', required: true },
    },
  },
  {
    name: 'empleados_crear',
    description: 'Crear un nuevo empleado',
    method: 'POST',
    path: '/api/empleados',
    params: {
      nombre: { type: 'string', description: 'Nombre completo', required: true },
      sucursal_id: { type: 'string', description: 'Sucursal asignada', required: true },
      codigo: { type: 'string', description: 'Código de empleado' },
      fecha_cumpleanos: { type: 'string', description: 'Fecha de cumpleaños (YYYY-MM-DD)' },
      empresa: { type: 'string', description: 'Empresa' },
    },
  },
  {
    name: 'empleados_editar',
    description: 'Editar un empleado',
    method: 'PUT',
    path: '/api/empleados/:id',
    params: {
      id: { type: 'string', description: 'ID del empleado', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      sucursal_id: { type: 'string', description: 'Sucursal' },
      activo: { type: 'boolean', description: 'Activo/inactivo' },
      codigo: { type: 'string', description: 'Código' },
      fecha_cumpleanos: { type: 'string', description: 'Cumpleaños' },
      empresa: { type: 'string', description: 'Empresa' },
    },
  },
  {
    name: 'empleados_eliminar',
    description: 'Eliminar un empleado',
    method: 'DELETE',
    path: '/api/empleados/:id',
    params: {
      id: { type: 'string', description: 'ID del empleado', required: true },
    },
  },
  {
    name: 'empleados_set_pin',
    description: 'Establecer PIN de fichaje para un empleado',
    method: 'POST',
    path: '/api/empleados/:id/pin',
    params: {
      id: { type: 'string', description: 'ID del empleado', required: true },
      pin: { type: 'string', description: 'PIN numérico', required: true },
      temporal: { type: 'boolean', description: 'true si es PIN temporal' },
    },
  },
]
