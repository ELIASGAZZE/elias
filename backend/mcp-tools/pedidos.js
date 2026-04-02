// MCP Tools — Pedidos Internos
module.exports = [
  {
    name: 'pedidos_listar',
    description: 'Listar pedidos internos (no POS) con filtros',
    method: 'GET',
    path: '/api/pedidos',
    params: {
      estado: { type: 'string', description: 'Filtrar por estado' },
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      sucursal_id: { type: 'string', description: 'Filtrar por sucursal' },
    },
    queryParams: ['estado', 'fecha', 'sucursal_id'],
  },
  {
    name: 'pedidos_detalle',
    description: 'Detalle de un pedido interno',
    method: 'GET',
    path: '/api/pedidos/:id',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
    },
  },
  {
    name: 'pedidos_crear',
    description: 'Crear pedido interno',
    method: 'POST',
    path: '/api/pedidos',
    params: {
      items: { type: 'array', description: 'Items del pedido', required: true },
      sucursal_id: { type: 'string', description: 'Sucursal que pide' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'pedidos_editar',
    description: 'Editar items de un pedido interno (admin)',
    method: 'PUT',
    path: '/api/pedidos/:id',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      items: { type: 'array', description: 'Items actualizados' },
    },
  },
  {
    name: 'pedidos_cambiar_estado',
    description: 'Cambiar estado de un pedido interno (admin)',
    method: 'PUT',
    path: '/api/pedidos/:id/estado',
    params: {
      id: { type: 'string', description: 'ID del pedido', required: true },
      estado: { type: 'string', description: 'Nuevo estado', required: true },
    },
  },
  {
    name: 'pedidos_check_pendiente',
    description: 'Verificar si hay pedido pendiente para el usuario actual',
    method: 'GET',
    path: '/api/pedidos/check-pendiente',
    params: {},
  },
]
