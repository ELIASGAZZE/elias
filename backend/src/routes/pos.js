// Rutas para el Punto de Venta (POS) con promociones locales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { sincronizarERP } = require('../services/syncERP')

// GET /api/pos/articulos
// Lee artículos con precios minoristas desde la tabla local (sincronizada 1x/día)
router.get('/articulos', verificarAuth, async (req, res) => {
  try {
    const campos = 'id, id_centum, codigo, nombre, rubro, subrubro, rubro_id_centum, subrubro_id_centum, precio, descuento1, descuento2, descuento3, iva_tasa, es_pesable, codigos_barras'

    // Supabase limita a 1000 por defecto — paginar para traer todos
    const PAGE_SIZE = 1000
    let allData = []
    let from = 0

    while (true) {
      let query = supabase
        .from('articulos')
        .select(campos)
        .eq('tipo', 'automatico')
        .gt('precio', 0)
        .range(from, from + PAGE_SIZE - 1)

      if (req.query.buscar) {
        query = query.or(`nombre.ilike.%${req.query.buscar}%,codigo.ilike.%${req.query.buscar}%`)
      }

      const { data, error } = await query
      if (error) throw error
      if (!data || data.length === 0) break
      allData = allData.concat(data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const articulos = allData.map(a => ({
      id: a.id_centum || a.id,
      codigo: a.codigo || '',
      nombre: a.nombre || '',
      precio: parseFloat(a.precio) || 0,
      rubro: a.rubro ? { id: a.rubro_id_centum, nombre: a.rubro } : null,
      subRubro: a.subrubro ? { id: a.subrubro_id_centum, nombre: a.subrubro } : null,
      iva: { id: null, tasa: parseFloat(a.iva_tasa) || 21 },
      descuento1: parseFloat(a.descuento1) || 0,
      descuento2: parseFloat(a.descuento2) || 0,
      descuento3: parseFloat(a.descuento3) || 0,
      esPesable: a.es_pesable || false,
      codigosBarras: a.codigos_barras || [],
    }))

    res.json({ articulos, total: articulos.length })
  } catch (err) {
    console.error('[POS] Error al obtener artículos:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pos/sincronizar-articulos (admin)
// Sincroniza artículos desde Centum manualmente
router.post('/sincronizar-articulos', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const resultado = await sincronizarERP('manual_pos')
    res.json(resultado)
  } catch (err) {
    console.error('[POS] Error al sincronizar artículos:', err.message)
    res.status(500).json({ error: 'Error al sincronizar: ' + err.message })
  }
})

// ============ PROMOCIONES LOCALES ============

// GET /api/pos/promociones
// Lista promos activas (POS) o todas si ?todas=1 (admin)
router.get('/promociones', verificarAuth, async (req, res) => {
  try {
    let query = supabase
      .from('promociones_pos')
      .select('*')
      .order('created_at', { ascending: false })

    if (!req.query.todas) {
      query = query.eq('activa', true)
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ promociones: data || [] })
  } catch (err) {
    console.error('[POS] Error al listar promociones:', err.message)
    res.status(500).json({ error: 'Error al listar promociones' })
  }
})

// POST /api/pos/promociones (admin)
router.post('/promociones', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, tipo, fecha_desde, fecha_hasta, reglas } = req.body

    if (!nombre || !tipo || !reglas) {
      return res.status(400).json({ error: 'nombre, tipo y reglas son requeridos' })
    }
    if (!['porcentaje', 'monto_fijo', 'nxm', 'combo', 'forma_pago'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo inválido' })
    }

    const { data, error } = await supabase
      .from('promociones_pos')
      .insert({
        nombre,
        tipo,
        fecha_desde: fecha_desde || null,
        fecha_hasta: fecha_hasta || null,
        reglas,
        created_by: req.perfil.id,
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ promocion: data })
  } catch (err) {
    console.error('[POS] Error al crear promoción:', err.message)
    res.status(500).json({ error: 'Error al crear promoción: ' + err.message })
  }
})

// PUT /api/pos/promociones/:id (admin)
router.put('/promociones/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, tipo, activa, fecha_desde, fecha_hasta, reglas } = req.body
    const updates = { updated_at: new Date().toISOString() }

    if (nombre !== undefined) updates.nombre = nombre
    if (tipo !== undefined) {
      if (!['porcentaje', 'monto_fijo', 'nxm', 'combo', 'forma_pago'].includes(tipo)) {
        return res.status(400).json({ error: 'tipo inválido' })
      }
      updates.tipo = tipo
    }
    if (activa !== undefined) updates.activa = activa
    if (fecha_desde !== undefined) updates.fecha_desde = fecha_desde || null
    if (fecha_hasta !== undefined) updates.fecha_hasta = fecha_hasta || null
    if (reglas !== undefined) updates.reglas = reglas

    const { data, error } = await supabase
      .from('promociones_pos')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json({ promocion: data })
  } catch (err) {
    console.error('[POS] Error al editar promoción:', err.message)
    res.status(500).json({ error: 'Error al editar promoción: ' + err.message })
  }
})

// DELETE /api/pos/promociones/:id (admin) — soft delete
router.delete('/promociones/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('promociones_pos')
      .update({ activa: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    res.json({ promocion: data, mensaje: 'Promoción desactivada' })
  } catch (err) {
    console.error('[POS] Error al eliminar promoción:', err.message)
    res.status(500).json({ error: 'Error al eliminar promoción: ' + err.message })
  }
})

// ============ VENTAS ============

// POST /api/pos/ventas
// Guarda una venta POS localmente
router.post('/ventas', verificarAuth, async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, items, promociones_aplicadas, subtotal, descuento_total, total, monto_pagado, vuelto, pagos, descuento_forma_pago, pedido_pos_id } = req.body

    if (id_cliente_centum == null) return res.status(400).json({ error: 'id_cliente_centum es requerido' })
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items es requerido' })
    if (total == null || total <= 0) return res.status(400).json({ error: 'total debe ser mayor a 0' })
    if (monto_pagado == null || monto_pagado < total) return res.status(400).json({ error: 'monto_pagado debe ser >= total' })

    const insertData = {
      cajero_id: req.perfil.id,
      sucursal_id: req.perfil.sucursal_id || null,
      id_cliente_centum,
      nombre_cliente: nombre_cliente || null,
      subtotal: subtotal || 0,
      descuento_total: descuento_total || 0,
      total,
      monto_pagado,
      vuelto: vuelto || 0,
      items: JSON.stringify(items),
      promociones_aplicadas: promociones_aplicadas ? JSON.stringify(promociones_aplicadas) : null,
      pagos: pagos || [],
      descuento_forma_pago: descuento_forma_pago || null,
    }
    if (pedido_pos_id) insertData.pedido_pos_id = pedido_pos_id

    const { data, error } = await supabase
      .from('ventas_pos')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ venta: data, mensaje: 'Venta registrada correctamente' })
  } catch (err) {
    console.error('[POS] Error al guardar venta:', err.message)
    res.status(500).json({ error: 'Error al guardar venta: ' + err.message })
  }
})

// GET /api/pos/ventas?fecha=YYYY-MM-DD&sucursal_id=X&cajero_id=X
// Lista ventas del día
router.get('/ventas', verificarAuth, async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0]
    const desde = `${fecha}T00:00:00`
    const hasta = `${fecha}T23:59:59`

    let query = supabase
      .from('ventas_pos')
      .select('*, perfiles:cajero_id(nombre), pedido:pedido_pos_id(id, numero, nombre_cliente)')
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('created_at', { ascending: false })

    // No-admin solo ve sus ventas
    if (req.perfil.rol !== 'admin') {
      query = query.eq('cajero_id', req.perfil.id)
    } else {
      // Filtros opcionales solo para admin
      if (req.query.sucursal_id) {
        query = query.eq('sucursal_id', req.query.sucursal_id)
      }
      if (req.query.cajero_id) {
        query = query.eq('cajero_id', req.query.cajero_id)
      }
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ ventas: data || [] })
  } catch (err) {
    console.error('[POS] Error al listar ventas:', err.message)
    res.status(500).json({ error: 'Error al listar ventas' })
  }
})

// GET /api/pos/ventas/:id — Detalle de una venta
router.get('/ventas/:id', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ventas_pos')
      .select('*, perfiles:cajero_id(nombre), pedido:pedido_pos_id(id, numero, nombre_cliente)')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' })

    // No-admin solo puede ver sus propias ventas
    if (req.perfil.rol !== 'admin' && data.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta venta' })
    }

    res.json({ venta: data })
  } catch (err) {
    console.error('[POS] Error al obtener detalle de venta:', err.message)
    res.status(500).json({ error: 'Error al obtener detalle de venta' })
  }
})

// ============ PEDIDOS POS ============

// POST /api/pos/pedidos — crear pedido (carrito guardado para retiro posterior)
router.post('/pedidos', verificarAuth, async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, items, total, observaciones, tipo, direccion_entrega, sucursal_retiro, estado, fecha_entrega } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items es requerido' })
    }

    // Generar número secuencial
    const { data: ultimoPedido } = await supabase
      .from('pedidos_pos')
      .select('numero')
      .not('numero', 'is', null)
      .order('numero', { ascending: false })
      .limit(1)
      .single()
    const numero = (ultimoPedido?.numero || 0) + 1

    const insertData = {
      cajero_id: req.perfil.id,
      sucursal_id: req.perfil.sucursal_id || null,
      id_cliente_centum: id_cliente_centum ?? 0,
      nombre_cliente: nombre_cliente || 'Consumidor Final',
      items: JSON.stringify(items),
      total: total || 0,
      numero,
      observaciones: [
        observaciones,
        direccion_entrega ? `Dirección: ${direccion_entrega}` : null,
        sucursal_retiro ? `Retiro en: ${sucursal_retiro}` : null,
      ].filter(Boolean).join(' | ') || null,
      tipo: tipo || 'retiro',
      fecha_entrega: fecha_entrega || null,
    }

    const { data, error } = await supabase
      .from('pedidos_pos')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ pedido: data, mensaje: 'Pedido registrado correctamente' })
  } catch (err) {
    console.error('[POS] Error al crear pedido:', err.message)
    res.status(500).json({ error: 'Error al crear pedido: ' + err.message })
  }
})

// GET /api/pos/pedidos — listar pedidos (default: pendientes)
router.get('/pedidos', verificarAuth, async (req, res) => {
  try {
    const estado = req.query.estado || 'pendiente'

    let query = supabase
      .from('pedidos_pos')
      .select('*, perfiles:cajero_id(nombre)')
      .order('created_at', { ascending: false })

    if (estado !== 'todos') {
      query = query.eq('estado', estado)
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ pedidos: data || [] })
  } catch (err) {
    console.error('[POS] Error al listar pedidos:', err.message)
    res.status(500).json({ error: 'Error al listar pedidos' })
  }
})

// PUT /api/pos/pedidos/:id/estado — cambiar estado (entregado/cancelado)
router.put('/pedidos/:id/estado', verificarAuth, async (req, res) => {
  try {
    const { estado } = req.body
    if (!['entregado', 'cancelado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Debe ser entregado o cancelado' })
    }

    const { data, error } = await supabase
      .from('pedidos_pos')
      .update({ estado })
      .eq('id', req.params.id)
      .eq('estado', 'pendiente') // solo se puede cambiar si está pendiente
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })

    res.json({ pedido: data, mensaje: `Pedido marcado como ${estado}` })
  } catch (err) {
    console.error('[POS] Error al cambiar estado pedido:', err.message)
    res.status(500).json({ error: 'Error al cambiar estado: ' + err.message })
  }
})

// ============ MERCADO PAGO ============

const { crearPreferenciaPago, obtenerPago } = require('../services/mercadopago')

// POST /api/pos/pedidos/:id/link-pago
// Genera link de pago de Mercado Pago para un pedido POS
router.post('/pedidos/:id/link-pago', verificarAuth, async (req, res) => {
  try {
    const { data: pedido, error } = await supabase
      .from('pedidos_pos')
      .select('id, numero, total, estado, observaciones')
      .eq('id', req.params.id)
      .single()

    if (error || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
    if (pedido.estado !== 'pendiente') {
      return res.status(400).json({ error: 'El pedido no está pendiente' })
    }
    if ((pedido.observaciones || '').includes('PAGO ANTICIPADO')) {
      return res.status(400).json({ error: 'El pedido ya tiene pago anticipado' })
    }
    if (!pedido.total || pedido.total <= 0) {
      return res.status(400).json({ error: 'El pedido no tiene un total válido' })
    }

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

    const { id: prefId, init_point } = await crearPreferenciaPago({
      idPedido: pedido.id,
      titulo: `Pedido POS #${pedido.numero}`,
      monto: Math.round(pedido.total * 100) / 100,
      notificationUrl: `${backendUrl}/api/pos/webhook-mp`,
      backUrl: `${frontendUrl}/pos`,
    })

    await supabase
      .from('pedidos_pos')
      .update({ mp_preference_id: prefId })
      .eq('id', pedido.id)

    res.json({ link: init_point })
  } catch (err) {
    console.error('[POS Link MP] Error:', err)
    res.status(500).json({ error: 'Error al generar link de pago: ' + err.message })
  }
})

// POST /api/pos/webhook-mp
// Webhook de Mercado Pago — SIN auth (viene de servidores de MP)
router.post('/webhook-mp', async (req, res) => {
  try {
    if (req.body.type === 'payment') {
      const paymentId = req.body.data?.id
      if (paymentId) {
        const pago = await obtenerPago(paymentId)
        if (pago.status === 'approved' && pago.external_reference) {
          const pedidoId = pago.external_reference
          const { data: pedido } = await supabase
            .from('pedidos_pos')
            .select('id, estado, observaciones')
            .eq('id', pedidoId)
            .maybeSingle()

          if (pedido && pedido.estado === 'pendiente') {
            const obsActual = pedido.observaciones || ''
            const nuevaObs = obsActual ? `PAGO ANTICIPADO | ${obsActual}` : 'PAGO ANTICIPADO'
            await supabase
              .from('pedidos_pos')
              .update({ observaciones: nuevaObs, mp_payment_id: String(paymentId) })
              .eq('id', pedidoId)
            console.log(`[POS MP Webhook] Pedido ${pedidoId} marcado como pagado (payment ${paymentId})`)
          }
        }
      }
    }
    res.sendStatus(200)
  } catch (err) {
    console.error('[POS MP Webhook] Error:', err)
    res.sendStatus(200)
  }
})

module.exports = router
