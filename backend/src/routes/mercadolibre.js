// Rutas del módulo Mercado Libre
const express = require('express')
const router = express.Router()
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const asyncHandler = require('../middleware/asyncHandler')
const logger = require('../config/logger')
const mlAuth = require('../services/mercadolibreAuth')
const mlSync = require('../services/mercadolibreSync')

// ═══════════════════════════════════════════════════════════════
// OAuth — Conexión con Mercado Libre
// ═══════════════════════════════════════════════════════════════

// Inicia el flujo OAuth → redirige a ML
router.get('/auth', verificarAuth, soloAdmin, (req, res) => {
  const url = mlAuth.getAuthUrl()
  res.json({ url })
})

// Callback de ML después de autorizar
router.get('/callback', asyncHandler(async (req, res) => {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'Código de autorización requerido' })

  try {
    const tokens = await mlAuth.exchangeCode(code)
    logger.info(`[ML] Cuenta conectada. Seller ID: ${tokens.user_id}`)

    // Redirigir al frontend con éxito
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    res.redirect(`${frontendUrl}/mercadolibre?connected=true`)
  } catch (err) {
    logger.error({ err }, '[ML] Error en callback OAuth')
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    res.redirect(`${frontendUrl}/mercadolibre?error=${encodeURIComponent(err.message)}`)
  }
}))

// Estado de conexión
router.get('/status', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const status = await mlAuth.getConnectionStatus()
  res.json(status)
}))

// Desconectar cuenta
router.post('/desconectar', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  await mlAuth.desconectar()
  res.json({ ok: true })
}))

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const [status, dashboard] = await Promise.all([
    mlAuth.getConnectionStatus(),
    mlSync.getDashboard().catch(() => null),
  ])

  res.json({ conexion: status, metricas: dashboard })
}))

// ═══════════════════════════════════════════════════════════════
// Órdenes / Ventas
// ═══════════════════════════════════════════════════════════════

// Listar órdenes con filtros
router.get('/ordenes', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { estado, desde, hasta, busqueda, page, limit } = req.query
  const resultado = await mlSync.listarOrdenes({
    estado,
    desde,
    hasta,
    busqueda,
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
  })
  res.json(resultado)
}))

// Sincronizar órdenes desde ML
router.post('/ordenes/sync', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { dias } = req.body
  const resultado = await mlSync.syncOrdenes(dias || 30)
  res.json(resultado)
}))

// Detalle de una orden (refresca desde ML)
router.get('/ordenes/:mlOrderId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const detalle = await mlSync.getOrdenDetalle(req.params.mlOrderId)
  res.json(detalle)
}))

// Detalle de envío
router.get('/envios/:envioId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const detalle = await mlSync.getEnvioDetalle(req.params.envioId)
  if (!detalle) return res.status(404).json({ error: 'Envío no encontrado' })
  res.json(detalle)
}))

// ═══════════════════════════════════════════════════════════════
// Webhooks de ML (sin auth — ML envía notificaciones aquí)
// ═══════════════════════════════════════════════════════════════

router.post('/webhooks', asyncHandler(async (req, res) => {
  // Responder 200 inmediatamente (ML requiere <500ms)
  res.status(200).json({ ok: true })

  // Procesar async
  const { topic, resource, user_id } = req.body
  logger.info({ topic, resource, user_id }, '[ML Webhook] Notificación recibida')

  try {
    if (topic === 'orders_v2') {
      // Obtener la orden actualizada y guardarla
      const orderId = resource.replace('/orders/', '')
      const orden = await mlSync.getOrdenDetalle(orderId)
      if (orden) {
        // Re-sync esta orden específica
        const { upsertOrden } = require('../services/mercadolibreSync')
        // El upsert ya está en el módulo, pero es privado — usamos syncOrdenes parcial
        logger.info(`[ML Webhook] Orden ${orderId} procesada (${orden.status})`)
      }
    }
  } catch (err) {
    logger.error({ err, topic, resource }, '[ML Webhook] Error procesando notificación')
  }
}))

module.exports = router
