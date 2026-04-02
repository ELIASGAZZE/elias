// Rutas para integración Mercado Pago Point (posnet) — Orders API v1
const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const { verificarAuth } = require('../middleware/auth')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')
const { breakers } = require('../utils/circuitBreaker')
const { fetchWithTimeout } = require('../utils/fetchWithTimeout')

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN
const MP_BASE_POINT = 'https://api.mercadopago.com/point/integration-api'
const MP_BASE_ORDERS = 'https://api.mercadopago.com/v1/orders'

// Wrap fetch with circuit breaker + timeout for all MP API calls
function mpFetch(url, options = {}) {
  return breakers.mercadopago.exec(() => fetchWithTimeout(url, options, 30000))
}

function mpHeaders(idempotencyKey) {
  const h = {
    'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  }
  if (idempotencyKey) h['X-Idempotency-Key'] = idempotencyKey
  return h
}

// ── SSE (Server-Sent Events) para notificaciones en tiempo real ──────────────
const sseClients = new Map() // orderId -> { createdAt, clients: Set<res> }

const SSE_TTL = 30 * 60 * 1000 // 30 minutes
const SSE_CLEANUP_INTERVAL = 5 * 60 * 1000 // 5 minutes

// Periodic cleanup of stale SSE entries
setInterval(() => {
  const now = Date.now()
  for (const [orderId, entry] of sseClients) {
    if (now - entry.createdAt > SSE_TTL) {
      for (const client of entry.clients) {
        try { client.end() } catch {}
      }
      sseClients.delete(orderId)
    }
  }
}, SSE_CLEANUP_INTERVAL).unref()

function emitSSE(orderId, event, data) {
  const entry = sseClients.get(orderId)
  if (!entry || entry.clients.size === 0) return
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of entry.clients) {
    try { client.write(payload) } catch {}
  }
}

// GET /api/mp-point/order/:id/events — SSE stream para recibir updates de una orden
// Auth via query param ?token=JWT (EventSource no soporta headers custom)
router.get('/order/:id/events', asyncHandler(async (req, res) => {
  const token = req.query.token
  if (!token) return res.status(401).json({ error: 'Token requerido' })

  // Autenticar manualmente usando el token del query param
  req.headers.authorization = `Bearer ${token}`
  try {
    await new Promise((resolve, reject) => {
      verificarAuth(req, res, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  } catch {
    // verificarAuth ya envió la respuesta de error
    if (res.headersSent) return
    return res.status(401).json({ error: 'Token inválido' })
  }
  // Si verificarAuth respondió con error (401/503), headers ya fueron enviados
  if (res.headersSent) return

  const orderId = req.params.id

  // Configurar SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx/proxy: no buffering
  })
  res.flushHeaders()

  // Evento inicial
  res.write(`event: connected\ndata: ${JSON.stringify({ orderId })}\n\n`)

  // Registrar cliente
  if (!sseClients.has(orderId)) sseClients.set(orderId, { createdAt: Date.now(), clients: new Set() })
  sseClients.get(orderId).clients.add(res)

  // Keepalive cada 30s para evitar timeout de proxies
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n') } catch {}
  }, 30000)

  // Cleanup al desconectar
  req.on('close', () => {
    clearInterval(keepalive)
    const entry = sseClients.get(orderId)
    if (entry) {
      entry.clients.delete(res)
      if (entry.clients.size === 0) sseClients.delete(orderId)
    }
  })
}))

// POST /api/mp-point/webhook — recibe notificaciones de Mercado Pago (sin auth)
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET

router.post('/webhook', asyncHandler(async (req, res) => {
  // Verificar firma HMAC si tenemos la clave secreta
  if (MP_WEBHOOK_SECRET) {
    const xSignature = req.headers['x-signature'] || ''
    const xRequestId = req.headers['x-request-id'] || ''
    // Extraer ts y v1 del header: "ts=xxx,v1=xxx"
    const parts = Object.fromEntries(xSignature.split(',').map(p => { const [k, v] = p.split('='); return [k?.trim(), v?.trim()] }))
    const ts = parts.ts
    const v1 = parts.v1
    if (ts && v1) {
      const dataId = req.query['data.id'] || req.body?.data?.id || ''
      const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
      const hmac = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex')
      if (hmac !== v1) {
        logger.warn('[MP Webhook] Firma inválida — rechazado')
        return res.sendStatus(403)
      }
    }
  }

  // Responder 200 inmediatamente (MP reintenta si no responde en 5s)
  res.sendStatus(200)

  try {
    const { type, action, data } = req.body || {}
    if (!data?.id) return

    logger.info(`[MP Webhook] ${type} ${action} — order ${data.id}`)

    const orderId = data.id
    const entry = sseClients.get(orderId)
    if (!entry || entry.clients.size === 0) {
      logger.info(`[MP Webhook] No hay clientes SSE para orden ${orderId}, skip`)
      return
    }

    // Re-fetch la orden desde MP para validar datos (no confiar ciegamente en el webhook)
    const resp = await mpFetch(`${MP_BASE_ORDERS}/${orderId}`, { headers: mpHeaders() })
    if (!resp.ok) {
      logger.error(`[MP Webhook] Error re-fetching orden ${orderId}: ${resp.status}`)
      return
    }
    const order = await resp.json()

    emitSSE(orderId, 'order_update', {
      status: order.status,
      transactions: order.transactions,
    })
    logger.info(`[MP Webhook] SSE emitido para orden ${orderId} — status: ${order.status}`)
  } catch (err) {
    logger.error('[MP Webhook] Error procesando:', err.message)
  }
}))

// PATCH /api/mp-point/devices/:id — cambiar modo operativo del dispositivo
router.patch('/devices/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { operating_mode } = req.body
    if (!operating_mode) return res.status(400).json({ error: 'operating_mode requerido' })

    // Intentar con endpoint integration-api (usado para devices GET)
    let resp = await mpFetch(`${MP_BASE_POINT}/devices/${req.params.id}`, {
      method: 'PATCH',
      headers: mpHeaders(),
      body: JSON.stringify({ operating_mode }),
    })

    // Si falla, intentar con endpoint alternativo /point/integrations/
    if (!resp.ok && resp.status === 404) {
      logger.info('[MP Point] Endpoint integration-api no encontrado, probando /point/integrations/')
      resp = await mpFetch(`https://api.mercadopago.com/point/integrations/devices/${req.params.id}`, {
        method: 'PATCH',
        headers: mpHeaders(),
        body: JSON.stringify({ operating_mode }),
      })
    }

    const data = await resp.json()
    if (!resp.ok) {
      logger.error('[MP Point] Error cambiando modo:', resp.status, data)
      return res.status(resp.status).json(data)
    }
    logger.info(`[MP Point] Device ${req.params.id} cambiado a modo ${operating_mode}`)
    res.json(data)
  } catch (err) {
    logger.error('[MP Point] Error cambiando modo:', err.message)
    res.status(500).json({ error: 'Error al cambiar modo del dispositivo' })
  }
}))

// POST /api/mp-point/devices/:id/resolve-qr — auto-detectar y asignar QR vinculado al posnet
router.post('/devices/:id/resolve-qr', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // 1. Obtener pos_id del device buscando en el listado (GET individual no existe en MP API)
    const listResp = await mpFetch(`${MP_BASE_POINT}/devices`, { headers: mpHeaders() })
    if (!listResp.ok) {
      logger.error('[MP QR Resolve] Error listando devices:', listResp.status)
      return res.status(listResp.status).json({ error: 'No se pudo obtener info del posnet' })
    }
    const listData = await listResp.json()
    const device = (listData.devices || []).find(d => d.id === req.params.id)
    if (!device) {
      return res.status(404).json({ error: `Posnet ${req.params.id} no encontrado en Mercado Pago` })
    }
    const posId = device.pos_id
    if (!posId) {
      return res.status(400).json({ error: 'Este posnet no tiene un POS (caja) vinculado en Mercado Pago. Vinculalo desde el dashboard de MP.' })
    }

    // 2. Consultar el POS para ver si ya tiene external_id
    const posResp = await mpFetch(`https://api.mercadopago.com/pos/${posId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })
    if (!posResp.ok) {
      logger.error('[MP QR Resolve] Error obteniendo POS:', posResp.status)
      return res.status(posResp.status).json({ error: 'No se pudo obtener info de la caja QR vinculada' })
    }
    const pos = await posResp.json()

    // 3. Si ya tiene external_id, retornar
    if (pos.external_id) {
      logger.info(`[MP QR Resolve] POS ${posId} ya tiene external_id: ${pos.external_id}`)
      return res.json({ external_id: pos.external_id, auto_assigned: false })
    }

    // 4. Generar y asignar external_id
    const externalId = `POS${posId}`
    const putResp = await mpFetch(`https://api.mercadopago.com/pos/${posId}`, {
      method: 'PUT',
      headers: mpHeaders(),
      body: JSON.stringify({ external_id: externalId }),
    })
    if (!putResp.ok) {
      const err = await putResp.json().catch(() => ({}))
      logger.error('[MP QR Resolve] Error asignando external_id:', putResp.status, err)
      return res.status(putResp.status).json({ error: 'No se pudo asignar el external_id a la caja QR' })
    }

    logger.info(`[MP QR Resolve] POS ${posId} — external_id asignado: ${externalId}`)
    res.json({ external_id: externalId, auto_assigned: true })
  } catch (err) {
    logger.error('[MP QR Resolve] Error:', err.message)
    res.status(500).json({ error: 'Error al resolver caja QR del posnet' })
  }
}))

// GET /api/mp-point/devices — listar dispositivos
router.get('/devices', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const resp = await mpFetch(`${MP_BASE_POINT}/devices`, { headers: mpHeaders() })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json(data)
  } catch (err) {
    logger.error('[MP Point] Error listando devices:', err.message)
    res.status(500).json({ error: 'Error al listar dispositivos' })
  }
}))

// POST /api/mp-point/order — crear orden de pago (Orders API, soporta tarjeta + QR)
// Helper: buscar órdenes pendientes de un device y cancelarlas
async function cancelarOrdenesPendientes(deviceId) {
  try {
    // 1) Cancelar vía Orders API — buscar órdenes de las últimas 2 horas
    const now = new Date()
    const desde = new Date(now - 7200000).toISOString()
    const hasta = now.toISOString()
    const resp = await mpFetch(`${MP_BASE_ORDERS}?type=point&begin_date=${desde}&end_date=${hasta}`, {
      headers: mpHeaders(),
    })
    if (resp.ok) {
      const body = await resp.json()
      const orders = body.data || body.elements || []
      if (Array.isArray(orders)) {
        for (const order of orders) {
          if (order.config?.point?.terminal_id !== deviceId) continue
          if (order.status !== 'created' && order.status !== 'at_terminal' && order.status !== 'open') continue
          try {
            await mpFetch(`${MP_BASE_ORDERS}/${order.id}/cancel`, {
              method: 'POST',
              headers: mpHeaders(`auto-cancel-${order.id}-${Date.now()}`),
            })
            logger.info(`[MP Point] Orden pendiente cancelada: ${order.id}`)
          } catch {}
        }
      }
    }

    // 2) Cancelar vía Integration API (delete del intent del device)
    try {
      await mpFetch(`${MP_BASE_POINT}/devices/${deviceId}/payment-intents`, {
        method: 'DELETE',
        headers: mpHeaders(),
      })
      logger.info(`[MP Point] Payment intents del device ${deviceId} eliminados`)
    } catch {}

    // Dar tiempo a MP para procesar las cancelaciones
    await new Promise(r => setTimeout(r, 500))
  } catch (err) {
    logger.error('[MP Point] Error limpiando órdenes pendientes:', err.message)
  }
}

router.post('/order', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { device_id, amount, external_reference, description, payment_type } = req.body
    if (!device_id || !amount) return res.status(400).json({ error: 'device_id y amount requeridos' })
    if (amount < 15) return res.status(400).json({ error: 'El monto mínimo es $15.00' })

    const extRef = external_reference || `pos-${Date.now()}`
    const orderBody = {
      type: 'point',
      external_reference: extRef,
      description: description || 'Venta POS',
      expiration_time: 'PT1M',
      transactions: {
        payments: [{ amount: amount.toFixed(2) }]
      },
      config: {
        point: {
          terminal_id: device_id,
          print_on_terminal: 'no_ticket',
          ticket_number: extRef,
        },
      },
    }

    // Si se especifica tipo de pago, agregarlo a la config
    if (payment_type) {
      orderBody.config.payment_method = { default_type: payment_type }
    }

    let idempotencyKey = `pos-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let resp = await mpFetch(MP_BASE_ORDERS, {
      method: 'POST',
      headers: mpHeaders(idempotencyKey),
      body: JSON.stringify(orderBody),
    })

    let data = await resp.json()

    // Si hay orden encolada, intentar cancelar las pendientes y reintentar
    if (!resp.ok && data.errors?.[0]?.code === 'already_queued_order_on_terminal') {
      logger.info('[MP Point] Orden encolada detectada, cancelando pendientes...')
      await cancelarOrdenesPendientes(device_id)

      // Reintentar con nuevo idempotency key
      idempotencyKey = `pos-order-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      resp = await mpFetch(MP_BASE_ORDERS, {
        method: 'POST',
        headers: mpHeaders(idempotencyKey),
        body: JSON.stringify(orderBody),
      })
      data = await resp.json()
    }

    if (!resp.ok) {
      logger.error('[MP Point] Error creando orden:', data)
      const msg = data.errors?.[0]?.code === 'already_queued_order_on_terminal'
        ? 'Hay un cobro pendiente en el posnet. Cancelalo en el posnet e intentá de nuevo.'
        : data.errors?.[0]?.message || 'Error al crear orden de pago'
      return res.status(resp.status).json({ error: msg })
    }

    logger.info(`[MP Point] Orden creada: ${data.id} — $${amount} en device ${device_id}`)
    res.json(data)
  } catch (err) {
    logger.error('[MP Point] Error creando orden:', err.message)
    res.status(500).json({ error: 'Error al crear orden de pago' })
  }
}))

// GET /api/mp-point/order/:id — consultar estado de orden
router.get('/order/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const resp = await mpFetch(`${MP_BASE_ORDERS}/${req.params.id}`, { headers: mpHeaders() })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json(data)
  } catch (err) {
    logger.error('[MP Point] Error consultando orden:', err.message)
    res.status(500).json({ error: 'Error al consultar orden' })
  }
}))

// POST /api/mp-point/order/:id/cancel — cancelar orden
router.post('/order/:id/cancel', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const resp = await mpFetch(`${MP_BASE_ORDERS}/${req.params.id}/cancel`, {
      method: 'POST',
      headers: mpHeaders(`cancel-${req.params.id}-${Date.now()}`),
    })
    if (resp.status === 200 || resp.status === 204) return res.json({ ok: true })
    const data = await resp.json()
    const errorCode = data.errors?.[0]?.code
    // Si ya estaba cancelada, no es error
    if (errorCode === 'order_already_canceled') return res.json({ ok: true })
    // Si está at_terminal, no se puede cancelar desde API — informar al frontend
    if (errorCode === 'cannot_cancel_order') {
      logger.info(`[MP Point] Orden ${req.params.id} en terminal, no se puede cancelar desde API`)
      return res.json({ ok: false, at_terminal: true, message: 'La orden está en el posnet. Cancelala desde el dispositivo.' })
    }
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json({ ok: true, ...data })
  } catch (err) {
    logger.error('[MP Point] Error cancelando orden:', err.message)
    res.status(500).json({ error: 'Error al cancelar orden' })
  }
}))

// POST /api/mp-point/devices/:id/clear — forzar limpieza de órdenes pendientes de un device
router.post('/devices/:id/clear', verificarAuth, asyncHandler(async (req, res) => {
  try {
    await cancelarOrdenesPendientes(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    logger.error('[MP Point] Error limpiando device:', err.message)
    res.status(500).json({ error: 'Error al limpiar órdenes pendientes' })
  }
}))

// GET /api/mp-point/payment/:id — obtener detalle de un pago completado
router.get('/payment/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const resp = await mpFetch(`https://api.mercadopago.com/v1/payments/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json(data)
  } catch (err) {
    logger.error('[MP Point] Error obteniendo pago:', err.message)
    res.status(500).json({ error: 'Error al obtener pago' })
  }
}))

// POST /api/mp-point/order/:id/refund — devolver (anular) un cobro completado
router.post('/order/:id/refund', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const orderId = req.params.id
    const { transaction_id, amount } = req.body // si viene amount → refund parcial

    const body = {}
    if (transaction_id && amount) {
      // Refund parcial
      body.transactions = [{ id: transaction_id, amount: amount.toString() }]
    }
    // Si body vacío → refund total

    const idempotencyKey = `refund-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const resp = await mpFetch(`${MP_BASE_ORDERS}/${orderId}/refund`, {
      method: 'POST',
      headers: mpHeaders(idempotencyKey),
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    })

    if (resp.status === 201 || resp.status === 200) {
      const data = await resp.json().catch(() => ({}))
      logger.info(`[MP Point] Refund exitoso para orden ${orderId}`)
      return res.json({ ok: true, ...data })
    }

    const data = await resp.json().catch(() => ({}))
    logger.error('[MP Point] Error en refund:', data)
    const msg = data.errors?.[0]?.message || data.message || 'Error al anular el cobro'
    return res.status(resp.status).json({ error: msg })
  } catch (err) {
    logger.error('[MP Point] Error en refund:', err.message)
    res.status(500).json({ error: 'Error al anular el cobro' })
  }
}))

// ── QR Instore (para posnet N950 que no muestra QR en pantalla) ───────────────
const MP_USER_ID = '455606488'

// PUT /api/mp-point/qr-order — crear orden en caja QR (instore API)
router.put('/qr-order', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { qr_pos_id, amount, external_reference, description } = req.body
    if (!qr_pos_id || !amount) return res.status(400).json({ error: 'qr_pos_id y amount requeridos' })

    const extRef = external_reference || `pos-qr-${Date.now()}`
    const resp = await mpFetch(`https://api.mercadopago.com/instore/qr/seller/collectors/${MP_USER_ID}/pos/${qr_pos_id}/orders`, {
      method: 'PUT',
      headers: mpHeaders(),
      body: JSON.stringify({
        external_reference: extRef,
        title: description || 'Venta POS',
        description: description || 'Venta POS',
        total_amount: parseFloat(amount),
        items: [{
          title: description || 'Venta POS',
          unit_price: parseFloat(amount),
          quantity: 1,
          unit_measure: 'unit',
          total_amount: parseFloat(amount),
        }],
      }),
    })

    if (resp.status === 204) {
      logger.info(`[MP QR] Orden creada en caja ${qr_pos_id} — $${amount} — ref: ${extRef}`)
      return res.json({ ok: true, external_reference: extRef })
    }

    const data = await resp.json().catch(() => ({}))
    logger.error('[MP QR] Error creando orden:', resp.status, data)
    res.status(resp.status).json({ error: data.message || 'Error al crear orden QR' })
  } catch (err) {
    logger.error('[MP QR] Error creando orden:', err.message)
    res.status(500).json({ error: 'Error al crear orden QR' })
  }
}))

// GET /api/mp-point/qr-order/:ref/status — consultar estado de orden QR por external_reference
router.get('/qr-order/:ref/status', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // Buscar merchant_order por external_reference
    const resp = await mpFetch(`https://api.mercadopago.com/merchant_orders/search?external_reference=${req.params.ref}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })
    const data = await resp.json()
    const orders = data.elements || []
    if (orders.length === 0) {
      return res.json({ status: 'pending' })
    }

    const order = orders[0]
    // Buscar pagos aprobados
    const pagoAprobado = (order.payments || []).find(p => p.status === 'approved')
    if (pagoAprobado) {
      return res.json({
        status: 'approved',
        payment_id: pagoAprobado.id,
        merchant_order_id: order.id,
      })
    }

    // Si tiene pagos pero ninguno aprobado
    if (order.payments?.length > 0) {
      const ultimo = order.payments[order.payments.length - 1]
      return res.json({ status: ultimo.status || 'pending', merchant_order_id: order.id })
    }

    return res.json({ status: order.status === 'closed' ? 'closed' : 'pending', merchant_order_id: order.id })
  } catch (err) {
    logger.error('[MP QR] Error consultando estado:', err.message)
    res.status(500).json({ error: 'Error al consultar estado QR' })
  }
}))

// DELETE /api/mp-point/qr-order/:posId — cancelar/eliminar orden de la caja QR
router.delete('/qr-order/:posId', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const resp = await mpFetch(`https://api.mercadopago.com/instore/qr/seller/collectors/${MP_USER_ID}/pos/${req.params.posId}/orders`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })
    if (resp.status === 204 || resp.status === 200) return res.json({ ok: true })
    const data = await resp.json().catch(() => ({}))
    res.status(resp.status).json(data)
  } catch (err) {
    logger.error('[MP QR] Error cancelando orden:', err.message)
    res.status(500).json({ error: 'Error al cancelar orden QR' })
  }
}))

module.exports = router
