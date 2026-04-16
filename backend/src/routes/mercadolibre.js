// Rutas del módulo Mercado Libre
const express = require('express')
const router = express.Router()
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const asyncHandler = require('../middleware/asyncHandler')
const logger = require('../config/logger')
const mlAuth = require('../services/mercadolibreAuth')
const mlSync = require('../services/mercadolibreSync')
const mlPosventa = require('../services/mercadolibrePosventa')
const mlPublicaciones = require('../services/mercadolibrePublicaciones')

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
// Posventa — Mensajes, Reclamos, Devoluciones
// ═══════════════════════════════════════════════════════════════

// Contadores para badges
router.get('/posventa/contadores', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const contadores = await mlPosventa.getContadoresPosventa()
  res.json(contadores)
}))

// Sync completo posventa
router.post('/posventa/sync', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPosventa.syncPosventa()
  res.json(resultado)
}))

// --- Mensajes ---
router.post('/posventa/mensajes/sync', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPosventa.syncMensajesPendientes()
  res.json(resultado)
}))

router.get('/posventa/mensajes', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { page, limit, estado } = req.query
  const resultado = await mlPosventa.listarMensajesPendientes({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    estado: estado || null,
  })
  res.json(resultado)
}))

router.get('/posventa/mensajes/:packId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPosventa.getMensajesPack(req.params.packId)
  res.json(resultado)
}))

router.post('/posventa/mensajes/:packId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { texto } = req.body
  if (!texto?.trim()) return res.status(400).json({ error: 'Texto requerido' })
  const resultado = await mlPosventa.responderMensaje(req.params.packId, texto.trim())
  res.json(resultado)
}))

// --- Reclamos ---
router.post('/posventa/reclamos/sync', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPosventa.syncReclamos()
  res.json(resultado)
}))

router.get('/posventa/reclamos', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { page, limit, stage, status } = req.query
  const resultado = await mlPosventa.listarReclamos({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    stage: stage || null,
    status: status || null,
  })
  res.json(resultado)
}))

router.get('/posventa/reclamos/:claimId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPosventa.getReclamoDetalle(req.params.claimId)
  if (!resultado) return res.status(404).json({ error: 'Reclamo no encontrado' })
  res.json(resultado)
}))

// --- Devoluciones ---
router.get('/posventa/devoluciones', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query
  const resultado = await mlPosventa.listarDevoluciones({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    status: status || null,
  })
  res.json(resultado)
}))

router.get('/posventa/devoluciones/:claimId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPosventa.getDevolucionDetalle(req.params.claimId)
  if (!resultado) return res.status(404).json({ error: 'Devolución no encontrada' })
  res.json(resultado)
}))

// ═══════════════════════════════════════════════════════════════
// Publicaciones (Items/Listings)
// ═══════════════════════════════════════════════════════════════

router.get('/publicaciones/contadores', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const contadores = await mlPublicaciones.getContadoresPublicaciones()
  res.json(contadores)
}))

router.post('/publicaciones/sync', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { estado } = req.body
  if (estado) {
    // Sync de un estado específico
    const resultado = await mlPublicaciones.syncPublicaciones({ estado })
    return res.json(resultado)
  }
  // Sync de activas + pausadas en paralelo
  const [activas, pausadas] = await Promise.allSettled([
    mlPublicaciones.syncPublicaciones({ estado: 'active' }),
    mlPublicaciones.syncPublicaciones({ estado: 'paused' }),
  ])
  const totalActivas = activas.status === 'fulfilled' ? activas.value.sincronizadas : 0
  const totalPausadas = pausadas.status === 'fulfilled' ? pausadas.value.sincronizadas : 0
  res.json({ sincronizadas: totalActivas + totalPausadas, activas: totalActivas, pausadas: totalPausadas })
}))

// Calcular y guardar costos de venta para todas las publicaciones activas
router.post('/publicaciones/costos/sync', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const resultado = await mlPublicaciones.syncCostos()
  res.json(resultado)
}))

router.post('/publicaciones/costos', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { items } = req.body // [{ precio, listing_type_id }]
  if (!items?.length) return res.status(400).json({ error: 'Items requeridos' })
  const costos = await mlPublicaciones.getCostosBatch(items.slice(0, 50)) // Max 50
  res.json({ costos })
}))

router.get('/publicaciones', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { page, limit, estado, busqueda, sinStock, orderBy } = req.query
  const resultado = await mlPublicaciones.listarPublicaciones({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    estado: estado || null,
    busqueda: busqueda || null,
    sinStock: sinStock === 'true',
    orderBy: orderBy || null,
  })
  res.json(resultado)
}))

// ═══════════════════════════════════════════════════════════════
// Webhooks de ML (sin auth — ML envía notificaciones aquí)
// ═══════════════════════════════════════════════════════════════

// IPs oficiales de MercadoLibre para notificaciones
const ML_WEBHOOK_IPS = ['54.88.218.97', '18.215.140.160', '18.213.114.129', '18.206.34.84']

router.post('/webhooks', asyncHandler(async (req, res) => {
  // Validar que la notificación venga de IPs de ML
  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  if (ML_WEBHOOK_IPS.length > 0 && !ML_WEBHOOK_IPS.includes(clientIp)) {
    logger.warn({ clientIp }, '[ML Webhook] Notificación desde IP no autorizada')
    // Responder 200 igual para no generar retries de IPs legítimas detrás de proxy
  }

  // Responder 200 inmediatamente (ML requiere <500ms)
  res.status(200).json({ ok: true })

  // Procesar async
  const { topic, resource, user_id } = req.body
  logger.info({ topic, resource, user_id }, '[ML Webhook] Notificación recibida')

  try {
    if (topic === 'orders_v2') {
      const orderId = resource.replace('/orders/', '')
      const orden = await mlSync.getOrdenDetalle(orderId)
      if (orden) {
        await mlSync.upsertOrden(orden)
        logger.info(`[ML Webhook] Orden ${orderId} sincronizada (${orden.status})`)
      }
    } else if (topic === 'items') {
      const itemId = resource.replace('/items/', '')
      logger.info(`[ML Webhook] Item ${itemId} modificado — sync pendiente en próximo ciclo`)
      // Las publicaciones se sincronizan en batch, no individualmente
    } else if (topic === 'shipments') {
      const shipmentId = resource.replace('/shipments/', '')
      logger.info(`[ML Webhook] Envío ${shipmentId} actualizado`)
    } else if (topic === 'payments') {
      const paymentId = resource.replace('/collections/', '')
      logger.info(`[ML Webhook] Pago ${paymentId} actualizado`)
    } else if (topic === 'messages') {
      logger.info(`[ML Webhook] Nuevo mensaje — sync pendiente`)
    } else {
      logger.info({ topic, resource }, '[ML Webhook] Tópico no procesado')
    }
  } catch (err) {
    logger.error({ err, topic, resource }, '[ML Webhook] Error procesando notificación')
  }
}))

module.exports = router
