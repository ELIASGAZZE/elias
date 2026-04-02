// MCP Tools — Retiros
module.exports = [
  {
    name: 'retiros_listar',
    description: 'Listar retiros de un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'retiros_crear',
    description: 'Registrar un retiro de efectivo',
    method: 'POST',
    path: '/api/cierres/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
      monto: { type: 'number', description: 'Monto retirado', required: true },
      motivo: { type: 'string', description: 'Motivo del retiro' },
    },
  },
  {
    name: 'retiros_pos_listar',
    description: 'Listar retiros de un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
    },
  },
  {
    name: 'retiros_pos_crear',
    description: 'Registrar un retiro en un cierre POS',
    method: 'POST',
    path: '/api/cierres-pos/:cierreId/retiros',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
      monto: { type: 'number', description: 'Monto retirado', required: true },
      motivo: { type: 'string', description: 'Motivo' },
    },
  },
]
