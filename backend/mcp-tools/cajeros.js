// MCP Tools — Cajeros
module.exports = [
  {
    name: 'cajeros_historial_auditoria',
    description: 'Historial de auditoría de un cajero',
    method: 'GET',
    path: '/api/cajeros/:empleadoId/historial-auditoria',
    params: {
      empleadoId: { type: 'string', description: 'ID del empleado/cajero', required: true },
    },
  },
  {
    name: 'cajeros_chat_ia',
    description: 'Chat con IA sobre el desempeño de un cajero',
    method: 'POST',
    path: '/api/cajeros/:empleadoId/chat-ia',
    params: {
      empleadoId: { type: 'string', description: 'ID del cajero', required: true },
      mensaje: { type: 'string', description: 'Pregunta/mensaje', required: true },
      historial: { type: 'array', description: 'Historial previo' },
    },
  },
]
