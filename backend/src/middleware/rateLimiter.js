// Rate limiting para proteger la API
const rateLimit = require('express-rate-limit')

// Limitar intentos de login: 10 por minuto por IP
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intente de nuevo en 1 minuto.' },
})

// Limitar API general: 200 por minuto por IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intente de nuevo en un momento.' },
  skip: (req) => req.path.startsWith('/mcp') || req.path === '/health',
})

module.exports = { loginLimiter, apiLimiter }
