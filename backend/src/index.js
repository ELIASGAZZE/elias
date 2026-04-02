// Punto de entrada del servidor Express — v2.3
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const logger = require('./config/logger')
const { validateEnv } = require('./config/validateEnv')
const { loginLimiter, apiLimiter } = require('./middleware/rateLimiter')
const requestLogger = require('./middleware/requestLogger')

// Validar env vars antes de arrancar
validateEnv()

const authRoutes = require('./routes/auth')
const articulosRoutes = require('./routes/articulos')
const pedidosRoutes = require('./routes/pedidos')
const sucursalesRoutes = require('./routes/sucursales')
const rubrosRoutes = require('./routes/rubros')
const cajasRoutes = require('./routes/cajas')
const cierresRoutes = require('./routes/cierres')
const apiLogsRoutes = require('./routes/apiLogs')
const pushRoutes = require('./routes/push')
const denominacionesRoutes = require('./routes/denominaciones')
const formasCobroRoutes = require('./routes/formas-cobro')
const empleadosRoutes = require('./routes/empleados')
const retirosRoutes = require('./routes/retiros')
const gastosRoutes = require('./routes/gastos')
const clientesRoutes = require('./routes/clientes')
const cajerosRoutes = require('./routes/cajeros')
const reglasIARoutes = require('./routes/reglasIA')
const resolucionesRoutes = require('./routes/resoluciones')
const batchAnalisisRoutes = require('./routes/batchAnalisis')
const posRoutes = require('./routes/pos')
const cierresPosRoutes = require('./routes/cierresPos')
const retirosPosRoutes = require('./routes/retirosPos')
const gastosPosRoutes = require('./routes/gastosPos')
const giftCardsRoutes = require('./routes/giftcards')
const tareasRoutes = require('./routes/tareas')
const auditoriaRoutes = require('./routes/auditoria')
const mpPointRoutes = require('./routes/mpPoint')
const cuentaEmpleadosRoutes = require('./routes/cuentaCorrienteEmpleados')
const fichajesRoutes = require('./routes/fichajes')
const turnosRoutes = require('./routes/turnos')
const planificacionRoutes = require('./routes/planificacion')
const licenciasRoutes = require('./routes/licencias')
const feriadosRoutes = require('./routes/feriados')
const gruposDescuentoRoutes = require('./routes/gruposDescuento')
const comprasRoutes = require('./routes/compras')
const traspasosRoutes = require('./routes/traspasos')
const { mountMcp } = require('../mcp-server')
const { iniciarCronJobs } = require('./jobs/cron')

const app = express()
const PORT = process.env.PORT || 3001

// Confiar en el proxy de Render (para que req.protocol devuelva https)
app.set('trust proxy', 1)

// ── Middlewares globales ──────────────────────────────────────────────────────

// Headers de seguridad (excluir rutas MCP — SSE necesita conexión abierta)
app.use((req, res, next) => {
  if (req.path.startsWith('/mcp') || req.path === '/mcp') return next()
  helmet()(req, res, next)
})

// CORS abierto para rutas MCP (Cowork), restringido para el resto
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2,
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173'] : []),
].filter(Boolean)

app.use((req, res, next) => {
  if (req.path.startsWith('/mcp') || req.path === '/mcp') {
    return cors({ origin: '*' })(req, res, next)
  }
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
      cb(null, false)
    },
    credentials: true,
  })(req, res, next)
})

// Parseamos el body de los requests como JSON (excepto /mcp que lo maneja el SDK)
app.use((req, res, next) => {
  if (req.path === '/mcp') return next()
  express.json({ limit: '10mb' })(req, res, next)
})

// Compresión gzip para todas las respuestas
app.use(compression())

// Request logging con pino-http (excluye health y MCP — ya filtrados en requestLogger)
app.use(requestLogger)

// ── Rate Limiting ─────────────────────────────────────────────────────────────
app.use('/api', apiLimiter)
app.use('/api/auth/login', loginLimiter)

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/articulos', articulosRoutes)
app.use('/api/pedidos', pedidosRoutes)
app.use('/api/sucursales', sucursalesRoutes)
app.use('/api/rubros', rubrosRoutes)
app.use('/api/cajas', cajasRoutes)
app.use('/api/cierres', cierresRoutes)
app.use('/api/api-logs', apiLogsRoutes)
app.use('/api/push', pushRoutes)
app.use('/api/denominaciones', denominacionesRoutes)
app.use('/api/formas-cobro', formasCobroRoutes)
app.use('/api/empleados', empleadosRoutes)
// Sub-recursos de cierres: definen rutas /cierres/:id/retiros y /cierres/:id/gastos internamente
app.use('/api', retirosRoutes)
app.use('/api', gastosRoutes)
app.use('/api/clientes', clientesRoutes)
app.use('/api/cajeros', cajerosRoutes)
app.use('/api/reglas-ia', reglasIARoutes)
app.use('/api/resoluciones', resolucionesRoutes)
app.use('/api/batch-analisis', batchAnalisisRoutes)
app.use('/api/pos', posRoutes)
app.use('/api/cierres-pos', cierresPosRoutes)
// Sub-recursos de cierres-pos: definen rutas /cierres-pos/:id/retiros y /cierres-pos/:id/gastos internamente
app.use('/api', retirosPosRoutes)
app.use('/api', gastosPosRoutes)
app.use('/api/gift-cards', giftCardsRoutes)
app.use('/api/tareas', tareasRoutes)
app.use('/api/auditoria', auditoriaRoutes)
app.use('/api/mp-point', mpPointRoutes)
app.use('/api/cuenta-empleados', cuentaEmpleadosRoutes)
app.use('/api/fichajes', fichajesRoutes)
app.use('/api/turnos', turnosRoutes)
app.use('/api/planificacion', planificacionRoutes)
app.use('/api/licencias', licenciasRoutes)
app.use('/api/feriados', feriadosRoutes)
app.use('/api/grupos-descuento', gruposDescuentoRoutes)
app.use('/api/compras', comprasRoutes)
app.use('/api/traspasos', traspasosRoutes)

// ── MCP Server (Cowork) ──────────────────────────────────────────────────────
mountMcp(app)

// Ruta de salud para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
  res.json({ estado: 'ok', timestamp: new Date().toISOString() })
})

// Health check detallado (incluye estado de DBs)
app.get('/health/detailed', async (req, res) => {
  const checks = { servidor: 'ok', timestamp: new Date().toISOString() }

  // Supabase
  try {
    const supabase = require('./config/supabase')
    const { error } = await supabase.from('sucursales').select('id').limit(1)
    checks.supabase = error ? 'error' : 'ok'
    if (error) checks.supabase_error = error.message
  } catch (err) {
    checks.supabase = 'error'
    checks.supabase_error = err.message
  }

  // Centum BI
  try {
    const { getPool } = require('./config/centum')
    const pool = await getPool()
    await pool.request().query('SELECT 1')
    checks.centum_bi = 'ok'
  } catch (err) {
    checks.centum_bi = 'error'
    checks.centum_bi_error = err.message
  }

  const allOk = checks.supabase === 'ok' && checks.centum_bi === 'ok'
  res.status(allOk ? 200 : 503).json(checks)
})

// ── Error handler global ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const reqId = req.id || res.getHeader('X-Request-Id')
  logger.error({ err, path: req.path, method: req.method, reqId }, '[Error no manejado]')
  if (!res.headersSent) {
    res.status(500).json({ error: 'Error interno del servidor', requestId: reqId })
  }
})

// ── Inicio del servidor ───────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Servidor corriendo en http://localhost:${PORT}`)
  iniciarCronJobs()
})

// ── Graceful shutdown ────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info(`${signal} recibido, cerrando servidor...`)
  server.close(async () => {
    try {
      const { getPool } = require('./config/centum')
      const pool = await getPool()
      await pool.close()
      logger.info('Pool SQL Server cerrado')
    } catch (e) { /* pool may not be initialized */ }
    logger.info('Servidor cerrado correctamente')
    process.exit(0)
  })
  // Forzar cierre si no termina en 10s
  setTimeout(() => {
    logger.warn('Forzando cierre después de 10s')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Capturar errores no manejados para logging antes de crash
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled Promise Rejection')
})
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught Exception — cerrando proceso')
  process.exit(1)
})
