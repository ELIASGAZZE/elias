// MCP Tools — Gastos
module.exports = [
  {
    name: 'gastos_listar',
    description: 'Listar gastos de un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'gastos_crear',
    description: 'Registrar un gasto en un cierre de caja',
    method: 'POST',
    path: '/api/cierres/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre', required: true },
      concepto: { type: 'string', description: 'Concepto del gasto', required: true },
      monto: { type: 'number', description: 'Monto del gasto', required: true },
      tipo: { type: 'string', description: 'Tipo de gasto' },
    },
  },
  {
    name: 'gastos_controlar',
    description: 'Aprobar/controlar un gasto (admin)',
    method: 'PUT',
    path: '/api/gastos/:id/controlar',
    params: {
      id: { type: 'string', description: 'ID del gasto', required: true },
      controlado: { type: 'boolean', description: 'true para aprobar' },
    },
  },
  {
    name: 'gastos_pos_listar',
    description: 'Listar gastos de un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
    },
  },
  {
    name: 'gastos_pos_crear',
    description: 'Registrar un gasto en un cierre POS',
    method: 'POST',
    path: '/api/cierres-pos/:cierreId/gastos',
    params: {
      cierreId: { type: 'string', description: 'ID del cierre POS', required: true },
      concepto: { type: 'string', description: 'Concepto del gasto', required: true },
      monto: { type: 'number', description: 'Monto del gasto', required: true },
    },
  },
]
