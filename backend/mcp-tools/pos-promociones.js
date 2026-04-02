// MCP Tools — POS Promociones
module.exports = [
  {
    name: 'pos_listar_promociones',
    description: 'Listar promociones del POS (activas por defecto)',
    method: 'GET',
    path: '/api/pos/promociones',
    params: {
      todas: { type: 'boolean', description: 'true para ver todas, incluso inactivas' },
    },
    queryParams: ['todas'],
  },
  {
    name: 'pos_crear_promocion',
    description: 'Crear una nueva promoción para el POS',
    method: 'POST',
    path: '/api/pos/promociones',
    params: {
      nombre: { type: 'string', description: 'Nombre de la promoción', required: true },
      tipo: { type: 'string', description: 'Tipo: NxM, porcentaje, monto_fijo, condicional', required: true },
      fecha_desde: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD)' },
      fecha_hasta: { type: 'string', description: 'Fecha fin (YYYY-MM-DD)' },
      reglas: { type: 'object', description: 'Reglas de la promoción (depende del tipo)' },
    },
  },
  {
    name: 'pos_editar_promocion',
    description: 'Editar una promoción existente',
    method: 'PUT',
    path: '/api/pos/promociones/:id',
    params: {
      id: { type: 'string', description: 'ID de la promoción', required: true },
      nombre: { type: 'string', description: 'Nombre' },
      tipo: { type: 'string', description: 'Tipo' },
      activa: { type: 'boolean', description: 'Activar/desactivar' },
      fecha_desde: { type: 'string', description: 'Fecha inicio' },
      fecha_hasta: { type: 'string', description: 'Fecha fin' },
      reglas: { type: 'object', description: 'Reglas' },
    },
  },
  {
    name: 'pos_eliminar_promocion',
    description: 'Eliminar una promoción',
    method: 'DELETE',
    path: '/api/pos/promociones/:id',
    params: {
      id: { type: 'string', description: 'ID de la promoción', required: true },
    },
  },
]
