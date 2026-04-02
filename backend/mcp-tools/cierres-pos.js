// MCP Tools — Cierres POS
module.exports = [
  {
    name: 'cierres_pos_listar',
    description: 'Listar cierres de caja del POS',
    method: 'GET',
    path: '/api/cierres-pos',
    params: {
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      estado: { type: 'string', description: 'Estado (abierta/cerrada)' },
      caja_id: { type: 'string', description: 'ID de la caja' },
    },
    queryParams: ['fecha', 'estado', 'caja_id'],
  },
  {
    name: 'cierres_pos_abierta',
    description: 'Obtener cierre POS abierto actualmente',
    method: 'GET',
    path: '/api/cierres-pos/abierta',
    params: {
      caja_id: { type: 'string', description: 'ID de la caja', required: true },
    },
    queryParams: ['caja_id'],
  },
  {
    name: 'cierres_pos_detalle',
    description: 'Detalle de un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_ventas',
    description: 'Ventas incluidas en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/pos-ventas',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_abrir',
    description: 'Abrir un nuevo cierre POS',
    method: 'POST',
    path: '/api/cierres-pos/abrir',
    params: {
      caja_id: { type: 'string', description: 'ID de la caja', required: true },
      fondo_inicio: { type: 'number', description: 'Fondo de caja inicial' },
    },
  },
  {
    name: 'cierres_pos_cerrar',
    description: 'Cerrar un cierre POS',
    method: 'PUT',
    path: '/api/cierres-pos/:id/cerrar',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      conteo: { type: 'object', description: 'Conteo de efectivo' },
    },
  },
  {
    name: 'cierres_pos_cancelaciones',
    description: 'Cancelaciones en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/cancelaciones',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_eliminaciones',
    description: 'Items eliminados en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/eliminaciones',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_pos_cambios_precio',
    description: 'Cambios de precio registrados en un cierre POS',
    method: 'GET',
    path: '/api/cierres-pos/:id/cambios-precio',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
]
