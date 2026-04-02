// MCP Tools — Auditoria
module.exports = [
  {
    name: 'auditoria_dashboard',
    description: 'Dashboard de auditoría con KPIs, gráficos y métricas',
    method: 'GET',
    path: '/api/auditoria/dashboard',
    params: {
      fecha_desde: { type: 'string', description: 'Desde' },
      fecha_hasta: { type: 'string', description: 'Hasta' },
      cajero_id: { type: 'string', description: 'Filtrar por cajero' },
    },
    queryParams: ['fecha_desde', 'fecha_hasta', 'cajero_id'],
  },
  {
    name: 'auditoria_cancelacion',
    description: 'Registrar una cancelación de venta en auditoría',
    method: 'POST',
    path: '/api/auditoria/cancelacion',
    params: {
      venta_id: { type: 'string', description: 'ID de la venta' },
      motivo: { type: 'string', description: 'Motivo de cancelación', required: true },
      items: { type: 'array', description: 'Items cancelados' },
    },
  },
]
