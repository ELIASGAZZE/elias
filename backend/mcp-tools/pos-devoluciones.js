// MCP Tools — POS Devoluciones / Notas de Credito
module.exports = [
  {
    name: 'pos_devolucion',
    description: 'Crear una devolución (nota de crédito por devolución de artículos)',
    method: 'POST',
    path: '/api/pos/devolucion',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta original', required: true },
      items: { type: 'array', description: 'Items a devolver [{id_articulo_centum, nombre, cantidad, precio_unitario}]', required: true },
      motivo: { type: 'string', description: 'Motivo de la devolución', required: true },
      observaciones: { type: 'string', description: 'Observaciones adicionales' },
    },
  },
  {
    name: 'pos_correccion_cliente',
    description: 'Crear NC por corrección de cliente (cambio de cliente en factura)',
    method: 'POST',
    path: '/api/pos/correccion-cliente',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta original', required: true },
      nuevo_cliente_id_centum: { type: 'number', description: 'ID del nuevo cliente en Centum', required: true },
      motivo: { type: 'string', description: 'Motivo de la corrección' },
    },
  },
  {
    name: 'pos_devolucion_precio',
    description: 'Crear NC por diferencia de precio',
    method: 'POST',
    path: '/api/pos/devolucion-precio',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta original', required: true },
      items: { type: 'array', description: 'Items con diferencia [{id_articulo_centum, nombre, cantidad, precio_correcto, precio_original}]', required: true },
      motivo: { type: 'string', description: 'Motivo' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
]
