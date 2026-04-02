// MCP Tools — API Logs & Health
module.exports = [
  {
    name: 'api_logs',
    description: 'Ver logs de llamadas a APIs externas (Centum, AFIP, etc)',
    method: 'GET',
    path: '/api/api-logs',
    params: {},
  },
  {
    name: 'api_health',
    description: 'Estado de salud de las APIs externas',
    method: 'GET',
    path: '/api/api-logs/health',
    params: {},
  },
  {
    name: 'api_errores_recientes',
    description: 'Errores recientes en llamadas a APIs',
    method: 'GET',
    path: '/api/api-logs/errores-recientes',
    params: {},
  },
  {
    name: 'health',
    description: 'Health check del servidor backend',
    method: 'GET',
    path: '/health',
    params: {},
    noAuth: true,
  },
]
