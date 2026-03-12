// Rutas para integración Mercado Pago Point (posnet) — Orders API v1
const express = require('express')
const router = express.Router()
const { verificarAuth } = require('../middleware/auth')

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN
const MP_BASE_POINT = 'https://api.mercadopago.com/point/integration-api'
const MP_BASE_ORDERS = 'https://api.mercadopago.com/v1/orders'

function mpHeaders(idempotencyKey) {
  const h = {
    'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  }
  if (idempotencyKey) h['X-Idempotency-Key'] = idempotencyKey
  return h
}

// PATCH /api/mp-point/devices/:id — cambiar modo operativo del dispositivo
router.patch('/devices/:id', verificarAuth, async (req, res) => {
  try {
    const { operating_mode } = req.body
    if (!operating_mode) return res.status(400).json({ error: 'operating_mode requerido' })

    // Intentar con endpoint integration-api (usado para devices GET)
    let resp = await fetch(`${MP_BASE_POINT}/devices/${req.params.id}`, {
      method: 'PATCH',
      headers: mpHeaders(),
      body: JSON.stringify({ operating_mode }),
    })

    // Si falla, intentar con endpoint alternativo /point/integrations/
    if (!resp.ok && resp.status === 404) {
      console.log('[MP Point] Endpoint integration-api no encontrado, probando /point/integrations/')
      resp = await fetch(`https://api.mercadopago.com/point/integrations/devices/${req.params.id}`, {
        method: 'PATCH',
        headers: mpHeaders(),
        body: JSON.stringify({ operating_mode }),
      })
    }

    const data = await resp.json()
    if (!resp.ok) {
      console.error('[MP Point] Error cambiando modo:', resp.status, data)
      return res.status(resp.status).json(data)
    }
    console.log(`[MP Point] Device ${req.params.id} cambiado a modo ${operating_mode}`)
    res.json(data)
  } catch (err) {
    console.error('[MP Point] Error cambiando modo:', err.message)
    res.status(500).json({ error: 'Error al cambiar modo del dispositivo' })
  }
})

// GET /api/mp-point/devices — listar dispositivos (sin auth para config terminal)
router.get('/devices', async (req, res) => {
  try {
    const resp = await fetch(`${MP_BASE_POINT}/devices`, { headers: mpHeaders() })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json(data)
  } catch (err) {
    console.error('[MP Point] Error listando devices:', err.message)
    res.status(500).json({ error: 'Error al listar dispositivos' })
  }
})

// POST /api/mp-point/order — crear orden de pago (Orders API, soporta tarjeta + QR)
// Helper: buscar órdenes pendientes de un device y cancelarlas
async function cancelarOrdenesPendientes(deviceId) {
  try {
    const now = new Date()
    const desde = new Date(now - 3600000).toISOString() // última hora
    const hasta = now.toISOString()
    const resp = await fetch(`${MP_BASE_ORDERS}?type=point&begin_date=${desde}&end_date=${hasta}`, {
      headers: mpHeaders(),
    })
    if (!resp.ok) return
    const { data: orders } = await resp.json()
    if (!Array.isArray(orders)) return

    for (const order of orders) {
      if (order.config?.point?.terminal_id !== deviceId) continue
      if (order.status !== 'created' && order.status !== 'at_terminal') continue
      try {
        await fetch(`${MP_BASE_ORDERS}/${order.id}/cancel`, {
          method: 'POST',
          headers: mpHeaders(`auto-cancel-${order.id}-${Date.now()}`),
        })
        console.log(`[MP Point] Orden pendiente cancelada: ${order.id}`)
      } catch {}
    }
  } catch (err) {
    console.error('[MP Point] Error limpiando órdenes pendientes:', err.message)
  }
}

router.post('/order', verificarAuth, async (req, res) => {
  try {
    const { device_id, amount, external_reference, description, payment_type } = req.body
    if (!device_id || !amount) return res.status(400).json({ error: 'device_id y amount requeridos' })
    if (amount < 15) return res.status(400).json({ error: 'El monto mínimo es $15.00' })

    const orderBody = {
      type: 'point',
      external_reference: external_reference || `pos-${Date.now()}`,
      description: description || 'Venta POS',
      expiration_time: 'PT5M',
      transactions: {
        payments: [{ amount: amount.toFixed(2) }]
      },
      config: {
        point: {
          terminal_id: device_id,
          print_on_terminal: 'no_ticket',
        },
      },
    }

    // Si se especifica tipo de pago, agregarlo a la config
    if (payment_type) {
      orderBody.config.payment_method = { default_type: payment_type }
    }

    let idempotencyKey = `pos-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let resp = await fetch(MP_BASE_ORDERS, {
      method: 'POST',
      headers: mpHeaders(idempotencyKey),
      body: JSON.stringify(orderBody),
    })

    let data = await resp.json()

    // Si hay orden encolada, intentar cancelar las pendientes y reintentar
    if (!resp.ok && data.errors?.[0]?.code === 'already_queued_order_on_terminal') {
      console.log('[MP Point] Orden encolada detectada, cancelando pendientes...')
      await cancelarOrdenesPendientes(device_id)

      // Reintentar con nuevo idempotency key
      idempotencyKey = `pos-order-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      resp = await fetch(MP_BASE_ORDERS, {
        method: 'POST',
        headers: mpHeaders(idempotencyKey),
        body: JSON.stringify(orderBody),
      })
      data = await resp.json()
    }

    if (!resp.ok) {
      console.error('[MP Point] Error creando orden:', data)
      const msg = data.errors?.[0]?.code === 'already_queued_order_on_terminal'
        ? 'Hay un cobro pendiente en el posnet. Cancelalo en el posnet e intentá de nuevo.'
        : data.errors?.[0]?.message || 'Error al crear orden de pago'
      return res.status(resp.status).json({ error: msg })
    }

    console.log(`[MP Point] Orden creada: ${data.id} — $${amount} en device ${device_id}`)
    res.json(data)
  } catch (err) {
    console.error('[MP Point] Error creando orden:', err.message)
    res.status(500).json({ error: 'Error al crear orden de pago' })
  }
})

// GET /api/mp-point/order/:id — consultar estado de orden
router.get('/order/:id', verificarAuth, async (req, res) => {
  try {
    const resp = await fetch(`${MP_BASE_ORDERS}/${req.params.id}`, { headers: mpHeaders() })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json(data)
  } catch (err) {
    console.error('[MP Point] Error consultando orden:', err.message)
    res.status(500).json({ error: 'Error al consultar orden' })
  }
})

// POST /api/mp-point/order/:id/cancel — cancelar orden
router.post('/order/:id/cancel', verificarAuth, async (req, res) => {
  try {
    const resp = await fetch(`${MP_BASE_ORDERS}/${req.params.id}/cancel`, {
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
      console.log(`[MP Point] Orden ${req.params.id} en terminal, no se puede cancelar desde API`)
      return res.json({ ok: false, at_terminal: true, message: 'La orden está en el posnet. Cancelala desde el dispositivo.' })
    }
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json({ ok: true, ...data })
  } catch (err) {
    console.error('[MP Point] Error cancelando orden:', err.message)
    res.status(500).json({ error: 'Error al cancelar orden' })
  }
})

// GET /api/mp-point/payment/:id — obtener detalle de un pago completado
router.get('/payment/:id', verificarAuth, async (req, res) => {
  try {
    const resp = await fetch(`https://api.mercadopago.com/v1/payments/${req.params.id}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    res.json(data)
  } catch (err) {
    console.error('[MP Point] Error obteniendo pago:', err.message)
    res.status(500).json({ error: 'Error al obtener pago' })
  }
})

module.exports = router
