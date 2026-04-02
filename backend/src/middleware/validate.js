// Middleware genérico de validación con Zod
// Uso: router.post('/ruta', validate(miSchema), handler)
const { ZodError } = require('zod')

function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source])
      req[source] = parsed
      next()
    } catch (err) {
      if (err instanceof ZodError) {
        const items = err.issues || err.errors || []
        const mensajes = items.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')
        return res.status(400).json({ error: mensajes })
      }
      next(err)
    }
  }
}

module.exports = { validate }
