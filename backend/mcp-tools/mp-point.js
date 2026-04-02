// MCP Tools — MP Point (Mercado Pago Posnet)
module.exports = [
  {
    name: 'mp_listar_dispositivos',
    description: 'Listar dispositivos Mercado Pago Point',
    method: 'GET',
    path: '/api/mp-point/devices',
    params: {},
  },
  {
    name: 'mp_crear_orden',
    description: 'Crear una orden de pago en el posnet MP Point',
    method: 'POST',
    path: '/api/mp-point/order',
    params: {
      device_id: { type: 'string', description: 'ID del dispositivo posnet', required: true },
      amount: { type: 'number', description: 'Monto a cobrar', required: true },
      external_reference: { type: 'string', description: 'Referencia externa' },
      description: { type: 'string', description: 'Descripción del cobro' },
      payment_type: { type: 'string', description: 'Tipo de pago' },
    },
  },
  {
    name: 'mp_estado_orden',
    description: 'Ver estado de una orden de pago MP',
    method: 'GET',
    path: '/api/mp-point/order/:id',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'mp_cancelar_orden',
    description: 'Cancelar una orden de pago MP',
    method: 'POST',
    path: '/api/mp-point/order/:id/cancel',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
  {
    name: 'mp_refund',
    description: 'Reembolsar un pago MP',
    method: 'POST',
    path: '/api/mp-point/order/:id/refund',
    params: {
      id: { type: 'string', description: 'ID de la orden', required: true },
    },
  },
]
