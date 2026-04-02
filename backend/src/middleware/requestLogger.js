// Request logging con pino-http + request ID
const pinoHttp = require('pino-http')
const crypto = require('crypto')
const logger = require('../config/logger')

const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = crypto.randomUUID().slice(0, 8)
    // Exponer el request ID en el header de respuesta para correlación
    res.setHeader('X-Request-Id', id)
    return id
  },
  autoLogging: {
    ignore: (req) => {
      // No loguear health checks ni MCP (muy verbose)
      return req.url === '/health' || req.url?.startsWith('/mcp')
    },
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`
  },
  customErrorMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`
  },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      id: req.id,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
})

module.exports = requestLogger
