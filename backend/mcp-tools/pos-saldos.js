// MCP Tools — POS Saldos Cuenta Corriente
module.exports = [
  {
    name: 'pos_saldo_cliente',
    description: 'Obtener saldo de cuenta corriente de un cliente',
    method: 'GET',
    path: '/api/pos/saldo/:idClienteCentum',
    params: {
      idClienteCentum: { type: 'string', description: 'ID del cliente en Centum', required: true },
    },
  },
  {
    name: 'pos_listar_saldos',
    description: 'Listar saldos de cuenta corriente de todos los clientes',
    method: 'GET',
    path: '/api/pos/saldos',
    params: {},
  },
  {
    name: 'pos_buscar_saldo_cuit',
    description: 'Buscar saldo de cuenta corriente por CUIT',
    method: 'GET',
    path: '/api/pos/saldos/buscar-cuit',
    params: {
      cuit: { type: 'string', description: 'CUIT del cliente', required: true },
    },
    queryParams: ['cuit'],
  },
  {
    name: 'pos_ajuste_saldo',
    description: 'Ajustar saldo de cuenta corriente de un cliente (admin)',
    method: 'POST',
    path: '/api/pos/saldos/ajuste',
    params: {
      id_cliente_centum: { type: 'number', description: 'ID del cliente en Centum', required: true },
      monto: { type: 'number', description: 'Monto del ajuste (positivo o negativo)', required: true },
      motivo: { type: 'string', description: 'Motivo del ajuste', required: true },
    },
  },
]
