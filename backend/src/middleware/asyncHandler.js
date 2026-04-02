// Wrapper para rutas async — captura errores sin try/catch explícito
// Uso: router.get('/ruta', asyncHandler(async (req, res) => { ... }))
const logger = require('../config/logger')

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    logger.error({ err, path: req.path, method: req.method }, 'Error no capturado en ruta')
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno del servidor' })
    }
  })
}

module.exports = asyncHandler
