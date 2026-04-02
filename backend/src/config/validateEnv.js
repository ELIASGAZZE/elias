// Validación de variables de entorno al startup
const logger = require('./logger')

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
]

const RECOMMENDED = [
  'FRONTEND_URL',
  'CENTUM_BASE_URL',
  'CENTUM_API_KEY',
  'CENTUM_BI_SERVER',
  'CENTUM_BI_DATABASE',
  'CENTUM_BI_USER',
  'CENTUM_BI_PASSWORD',
]

function validateEnv() {
  const missing = REQUIRED.filter(v => !process.env[v])
  if (missing.length > 0) {
    logger.fatal({ missing }, 'Variables de entorno REQUERIDAS faltantes — el servidor no puede iniciar')
    process.exit(1)
  }

  const warned = RECOMMENDED.filter(v => !process.env[v])
  if (warned.length > 0) {
    logger.warn({ missing: warned }, 'Variables de entorno recomendadas faltantes — algunas funciones no estarán disponibles')
  }

  logger.info('Variables de entorno validadas correctamente')
}

module.exports = { validateEnv }
