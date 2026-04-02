// MCP Tools — Gift Cards
module.exports = [
  {
    name: 'giftcards_listar',
    description: 'Listar gift cards con filtros',
    method: 'GET',
    path: '/api/gift-cards',
    params: {
      estado: { type: 'string', description: 'Filtrar por estado (activa, usada, anulada)' },
      buscar: { type: 'string', description: 'Buscar por código' },
    },
    queryParams: ['estado', 'buscar'],
  },
  {
    name: 'giftcards_consultar',
    description: 'Consultar saldo de una gift card por código',
    method: 'GET',
    path: '/api/gift-cards/consultar/:codigo',
    params: {
      codigo: { type: 'string', description: 'Código de la gift card', required: true },
    },
  },
  {
    name: 'giftcards_activar',
    description: 'Activar una gift card nueva',
    method: 'POST',
    path: '/api/gift-cards/activar',
    params: {
      codigo: { type: 'string', description: 'Código de la gift card', required: true },
      monto: { type: 'number', description: 'Monto a cargar', required: true },
      comprador_nombre: { type: 'string', description: 'Nombre del comprador' },
      pagos: { type: 'array', description: 'Forma de pago' },
    },
  },
  {
    name: 'giftcards_anular',
    description: 'Anular una gift card',
    method: 'PUT',
    path: '/api/gift-cards/:id/anular',
    params: {
      id: { type: 'string', description: 'ID de la gift card', required: true },
    },
  },
]
