// MCP Tools — Cierres de Caja
module.exports = [
  {
    name: 'cierres_listar',
    description: 'Listar cierres de caja con filtros',
    method: 'GET',
    path: '/api/cierres',
    params: {
      fecha: { type: 'string', description: 'Filtrar por fecha' },
      estado: { type: 'string', description: 'Filtrar por estado (abierta, cerrada)' },
      caja_id: { type: 'string', description: 'Filtrar por caja' },
    },
    queryParams: ['fecha', 'estado', 'caja_id'],
  },
  {
    name: 'cierres_detalle',
    description: 'Obtener detalle completo de un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:id',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_abrir',
    description: 'Abrir un nuevo cierre de caja',
    method: 'POST',
    path: '/api/cierres/abrir',
    params: {
      caja_id: { type: 'string', description: 'ID de la caja', required: true },
      fondo_inicio: { type: 'number', description: 'Fondo de caja inicial' },
    },
  },
  {
    name: 'cierres_cerrar',
    description: 'Cerrar un cierre de caja',
    method: 'PUT',
    path: '/api/cierres/:id/cerrar',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      conteo: { type: 'object', description: 'Conteo de efectivo por denominación' },
    },
  },
  {
    name: 'cierres_comprobantes',
    description: 'Obtener comprobantes/facturas de un cierre',
    method: 'GET',
    path: '/api/cierres/:id/comprobantes',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_verificacion',
    description: 'Obtener estado de verificación de un cierre',
    method: 'GET',
    path: '/api/cierres/:id/verificacion',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_verificar',
    description: 'Verificar/aprobar un cierre de caja (admin)',
    method: 'POST',
    path: '/api/cierres/:id/verificar',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      aprobado: { type: 'boolean', description: 'true para aprobar' },
      observaciones: { type: 'string', description: 'Observaciones' },
    },
  },
  {
    name: 'cierres_analisis_ia',
    description: 'Obtener análisis de IA sobre un cierre de caja',
    method: 'GET',
    path: '/api/cierres/:id/analisis-ia',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
  {
    name: 'cierres_chat_ia',
    description: 'Chatear con IA sobre un cierre específico',
    method: 'POST',
    path: '/api/cierres/:id/chat-ia',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
      mensaje: { type: 'string', description: 'Mensaje/pregunta', required: true },
      historial: { type: 'array', description: 'Historial de chat previo' },
    },
  },
  {
    name: 'cierres_auditoria',
    description: 'Información de auditoría de un cierre',
    method: 'GET',
    path: '/api/cierres/:id/auditoria',
    params: {
      id: { type: 'string', description: 'ID del cierre', required: true },
    },
  },
]
