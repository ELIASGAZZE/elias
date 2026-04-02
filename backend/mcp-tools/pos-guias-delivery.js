// MCP Tools — POS Guias Delivery
module.exports = [
  {
    name: 'pos_listar_guias_delivery',
    description: 'Listar guías de delivery',
    method: 'GET',
    path: '/api/pos/guias-delivery',
    params: {
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      estado: { type: 'string', description: 'Filtrar por estado' },
    },
    queryParams: ['fecha', 'estado'],
  },
  {
    name: 'pos_detalle_guia_delivery',
    description: 'Obtener detalle de una guía de delivery',
    method: 'GET',
    path: '/api/pos/guias-delivery/:id',
    params: {
      id: { type: 'string', description: 'ID de la guía', required: true },
    },
  },
  {
    name: 'pos_despachar_guia',
    description: 'Crear/despachar una guía de delivery',
    method: 'POST',
    path: '/api/pos/guias-delivery/despachar',
    params: {
      fecha: { type: 'string', description: 'Fecha de despacho', required: true },
      turno: { type: 'string', description: 'Turno' },
      cadete_id: { type: 'string', description: 'ID del cadete', required: true },
      cadete_nombre: { type: 'string', description: 'Nombre del cadete' },
      cambio_entregado: { type: 'number', description: 'Cambio entregado al cadete' },
      caja_id: { type: 'string', description: 'ID de la caja' },
    },
  },
  {
    name: 'pos_cerrar_guia',
    description: 'Cerrar una guía de delivery al regreso del cadete',
    method: 'PUT',
    path: '/api/pos/guias-delivery/:id/cerrar',
    params: {
      id: { type: 'string', description: 'ID de la guía', required: true },
      efectivo_recibido: { type: 'number', description: 'Efectivo recibido del cadete' },
      observaciones: { type: 'string', description: 'Observaciones' },
      pedidos_no_entregados: { type: 'array', description: 'IDs de pedidos no entregados' },
    },
  },
]
