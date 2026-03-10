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
    const { id_cliente_centum, nombre_cliente, items, promociones_aplicadas, subtotal, descuento_total, total, monto_pagado, vuelto, pagos, descuento_forma_pago, pedido_pos_id, saldo_aplicado, gift_cards_aplicadas, gift_cards_a_activar } = req.body

    // Calcular total de gift cards a activar (se resta del total para ventas_pos)
    const totalGCActivar = (gift_cards_a_activar || []).reduce((s, gc) => s + (parseFloat(gc.monto) || 0), 0)
    const totalItemsSolo = Math.round((total - totalGCActivar) * 100) / 100

    if (id_cliente_centum == null) return res.status(400).json({ error: 'id_cliente_centum es requerido' })
    // Permitir items vacíos si hay gift cards a activar
    const tieneItems = items && Array.isArray(items) && items.length > 0
    const tieneGC = gift_cards_a_activar && Array.isArray(gift_cards_a_activar) && gift_cards_a_activar.length > 0
    if (!tieneItems && !tieneGC) return res.status(400).json({ error: 'items o gift_cards_a_activar es requerido' })
    if (total == null || total <= 0) return res.status(400).json({ error: 'total debe ser mayor a 0' })

    const saldoApl = parseFloat(saldo_aplicado) || 0
    const totalACobrar = total - saldoApl
    const montoPagadoNum = parseFloat(monto_pagado) || 0

    // Validar que monto_pagado + saldo >= total
    if (montoPagadoNum + saldoApl < total - 0.01) {
      return res.status(400).json({ error: 'monto_pagado + saldo_aplicado debe ser >= total' })
    }

    // Validar saldo disponible
    if (saldoApl > 0 && id_cliente_centum) {
      const { data: saldoRows } = await supabase
        .from('movimientos_saldo_pos')
        .select('monto')
        .eq('id_cliente_centum', id_cliente_centum)
      const saldoDisponible = (saldoRows || []).reduce((s, r) => s + parseFloat(r.monto), 0)
      if (saldoApl > saldoDisponible + 0.01) {
        return res.status(400).json({ error: `Saldo insuficiente. Disponible: ${saldoDisponible.toFixed(2)}` })
      }
    }

    // Si solo hay gift cards (sin artículos), no crear ventas_pos
    let data = null
    if (tieneItems) {
      const insertData = {
        cajero_id: req.perfil.id,
        sucursal_id: req.perfil.sucursal_id || null,
        id_cliente_centum,
        nombre_cliente: nombre_cliente || null,
        subtotal: subtotal || 0,
        descuento_total: descuento_total || 0,
        total: totalItemsSolo,
        monto_pagado: montoPagadoNum,
        vuelto: vuelto || 0,
        items: JSON.stringify(items),
        promociones_aplicadas: promociones_aplicadas ? JSON.stringify(promociones_aplicadas) : null,
        pagos: pagos || [],
        descuento_forma_pago: descuento_forma_pago || null,
      }
      if (pedido_pos_id) insertData.pedido_pos_id = pedido_pos_id

      const { data: ventaData, error } = await supabase
        .from('ventas_pos')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error
      data = ventaData
    }

    const ventaId = data?.id || null

    // Registrar movimiento negativo de saldo si se aplicó
    if (saldoApl > 0 && id_cliente_centum) {
      const { error: saldoError } = await supabase
        .from('movimientos_saldo_pos')
        .insert({
          id_cliente_centum,
          nombre_cliente: nombre_cliente || 'Cliente',
          monto: -saldoApl,
          motivo: 'Aplicado en venta',
          venta_pos_id: ventaId,
          created_by: req.perfil.id,
        })
      if (saldoError) {
        console.error('[POS] Error al registrar movimiento de saldo:', saldoError.message)
      }
    }

    // Descontar gift cards aplicadas (usadas como pago)
    if (gift_cards_aplicadas && Array.isArray(gift_cards_aplicadas) && gift_cards_aplicadas.length > 0) {
      for (const gc of gift_cards_aplicadas) {
        const { data: giftCard } = await supabase
          .from('gift_cards')
          .select('id, saldo, estado')
          .eq('codigo', gc.codigo.trim())
          .eq('estado', 'activa')
          .maybeSingle()

        if (giftCard) {
          const nuevoSaldo = Math.round((parseFloat(giftCard.saldo) - gc.monto) * 100) / 100
          const nuevoEstado = nuevoSaldo <= 0 ? 'agotada' : 'activa'

          await supabase
            .from('gift_cards')
            .update({ saldo: Math.max(0, nuevoSaldo), estado: nuevoEstado })
            .eq('id', giftCard.id)

          await supabase
            .from('movimientos_gift_card')
            .insert({
              gift_card_id: giftCard.id,
              monto: -gc.monto,
              motivo: 'Uso en venta',
              venta_pos_id: ventaId,
              created_by: req.perfil.id,
            })
        }
      }
    }

    // Activar gift cards vendidas (NO se incluyen en ventas_pos)
    if (tieneGC) {
      for (const gc of gift_cards_a_activar) {
        // Verificar que no exista ya
        const { data: existente } = await supabase
          .from('gift_cards')
          .select('id')
          .eq('codigo', gc.codigo.trim())
          .maybeSingle()

        if (existente) continue // Saltar si ya existe

        const { data: giftCard } = await supabase
          .from('gift_cards')
          .insert({
            codigo: gc.codigo.trim(),
            monto_inicial: gc.monto,
            saldo: gc.monto,
            estado: 'activa',
            comprador_nombre: gc.comprador_nombre || null,
            pagos: pagos || [],
            created_by: req.perfil.id,
          })
          .select()
          .single()

        if (giftCard) {
          await supabase
            .from('movimientos_gift_card')
            .insert({
              gift_card_id: giftCard.id,
              monto: gc.monto,
              motivo: 'Activación',
              venta_pos_id: ventaId,
              created_by: req.perfil.id,
            })
        }
      }
    }

    res.status(201).json({ venta: data, mensaje: tieneItems ? 'Venta registrada correctamente' : 'Gift card activada correctamente' })
  } catch (err) {
    console.error('[POS] Error al guardar venta:', err.message)
    res.status(500).json({ error: 'Error al guardar venta: ' + err.message })
  }
})

// GET /api/pos/ventas?fecha=YYYY-MM-DD&sucursal_id=X&cajero_id=X&buscar=texto&articulo=texto
// Lista ventas del día con filtros opcionales
router.get('/ventas', verificarAuth, async (req, res) => {
  try {
    let query = supabase
      .from('ventas_pos')
      .select('*, perfiles:cajero_id(nombre), sucursales:sucursal_id(nombre), pedido:pedido_pos_id(id, numero, nombre_cliente)')
      .order('created_at', { ascending: false })

    // Filtro por fecha (siempre se aplica salvo que venga buscar por cliente)
    const buscar = req.query.buscar?.trim()
    if (buscar) {
      query = query.ilike('nombre_cliente', `%${buscar}%`)
      // Si además viene fecha, aplicarla también
      if (req.query.fecha) {
        const desde = `${req.query.fecha}T00:00:00`
        const hasta = `${req.query.fecha}T23:59:59`
        query = query.gte('created_at', desde).lte('created_at', hasta)
      }
      query = query.limit(50)
    } else {
      const fecha = req.query.fecha || new Date().toISOString().split('T')[0]
      const desde = `${fecha}T00:00:00`
      const hasta = `${fecha}T23:59:59`
      query = query.gte('created_at', desde).lte('created_at', hasta)
    }

    // No-admin solo ve sus ventas
    if (req.perfil.rol !== 'admin') {
      query = query.eq('cajero_id', req.perfil.id)
    } else {
      if (req.query.sucursal_id) {
        query = query.eq('sucursal_id', req.query.sucursal_id)
      }
      if (req.query.cajero_id) {
        query = query.eq('cajero_id', req.query.cajero_id)
      }
    }

    const { data, error } = await query
    if (error) throw error

    let ventas = data || []

    // Filtro por artículo en JS (items es JSONB, no soporta ilike)
    const articulo = req.query.articulo?.trim()?.toLowerCase()
    if (articulo) {
      ventas = ventas.filter(v => {
        const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
        return items.some(i => (i.nombre || '').toLowerCase().includes(articulo))
      })
    }

    res.json({ ventas })
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
    const { id_cliente_centum, nombre_cliente, items, total, observaciones, tipo, direccion_entrega, sucursal_retiro, estado, fecha_entrega, total_pagado } = req.body

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
    if (total_pagado) insertData.total_pagado = total_pagado

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
      // total_pagado ya viene con * — no se necesita select extra

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

// PUT /api/pos/pedidos/:id — editar items/total/observaciones de un pedido pendiente
router.put('/pedidos/:id', verificarAuth, async (req, res) => {
  try {
    const { items, total, observaciones } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items es requerido' })
    }
    if (total == null || total <= 0) {
      return res.status(400).json({ error: 'total debe ser mayor a 0' })
    }

    // Leer pedido actual antes de actualizar (para saldo)
    const { data: pedidoActual } = await supabase
      .from('pedidos_pos')
      .select('id, numero, id_cliente_centum, nombre_cliente, total_pagado, total, estado')
      .eq('id', req.params.id)
      .single()

    if (!pedidoActual || pedidoActual.estado !== 'pendiente') {
      return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })
    }

    const totalPagado = parseFloat(pedidoActual.total_pagado) || 0
    const nuevoTotal = parseFloat(total)
    const updateData = {
      items: JSON.stringify(items),
      total: nuevoTotal,
      observaciones: observaciones || null,
    }

    // Si el pedido estaba pagado y el nuevo total es menor, ajustar total_pagado y generar saldo
    let saldoGenerado = null
    if (totalPagado > 0 && nuevoTotal < totalPagado) {
      const diferencia = totalPagado - nuevoTotal
      updateData.total_pagado = nuevoTotal

      if (pedidoActual.id_cliente_centum) {
        const { data: mov } = await supabase
          .from('movimientos_saldo_pos')
          .insert({
            id_cliente_centum: pedidoActual.id_cliente_centum,
            nombre_cliente: pedidoActual.nombre_cliente || 'Cliente',
            monto: diferencia,
            motivo: `Edición pedido #${pedidoActual.numero || pedidoActual.id} (bajó de ${pedidoActual.total} a ${nuevoTotal})`,
            pedido_pos_id: pedidoActual.id,
            created_by: req.perfil.id,
          })
          .select()
          .single()
        saldoGenerado = mov
      }
    }

    const { data, error } = await supabase
      .from('pedidos_pos')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('estado', 'pendiente')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })

    res.json({ pedido: data, mensaje: 'Pedido actualizado', saldoGenerado })
  } catch (err) {
    console.error('[POS] Error al editar pedido:', err.message)
    res.status(500).json({ error: 'Error al editar pedido: ' + err.message })
  }
})

// PUT /api/pos/pedidos/:id/estado — cambiar estado (entregado/cancelado)
router.put('/pedidos/:id/estado', verificarAuth, async (req, res) => {
  try {
    const { estado } = req.body
    if (!['entregado', 'cancelado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido. Debe ser entregado o cancelado' })
    }

    // Leer pedido actual antes de actualizar (para saldo)
    const { data: pedidoActual } = await supabase
      .from('pedidos_pos')
      .select('id, numero, id_cliente_centum, nombre_cliente, total_pagado, estado')
      .eq('id', req.params.id)
      .single()

    if (!pedidoActual || pedidoActual.estado !== 'pendiente') {
      return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })
    }

    const { data, error } = await supabase
      .from('pedidos_pos')
      .update({ estado })
      .eq('id', req.params.id)
      .eq('estado', 'pendiente')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })

    // Si se cancela un pedido pagado, generar saldo a favor
    let saldoGenerado = null
    const totalPagado = parseFloat(pedidoActual.total_pagado) || 0
    if (estado === 'cancelado' && totalPagado > 0 && pedidoActual.id_cliente_centum) {
      const { data: mov } = await supabase
        .from('movimientos_saldo_pos')
        .insert({
          id_cliente_centum: pedidoActual.id_cliente_centum,
          nombre_cliente: pedidoActual.nombre_cliente || 'Cliente',
          monto: totalPagado,
          motivo: `Cancelación pedido #${pedidoActual.numero || pedidoActual.id}`,
          pedido_pos_id: pedidoActual.id,
          created_by: req.perfil.id,
        })
        .select()
        .single()
      saldoGenerado = mov
    }

    res.json({ pedido: data, mensaje: `Pedido marcado como ${estado}`, saldoGenerado })
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
      .select('id, numero, total, estado, observaciones, total_pagado')
      .eq('id', req.params.id)
      .single()

    if (error || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
    if (pedido.estado !== 'pendiente') {
      return res.status(400).json({ error: 'El pedido no está pendiente' })
    }
    if (!pedido.total || pedido.total <= 0) {
      return res.status(400).json({ error: 'El pedido no tiene un total válido' })
    }

    const esPagoAnticipado = (pedido.observaciones || '').includes('PAGO ANTICIPADO')
    const totalPagado = parseFloat(pedido.total_pagado) || 0
    let montoACobrar = Math.round(pedido.total * 100) / 100
    let titulo = `Pedido POS #${pedido.numero}`

    if (esPagoAnticipado) {
      // Ya pagó — cobrar solo la diferencia
      const diferencia = pedido.total - totalPagado
      if (diferencia <= 0) {
        return res.status(400).json({ error: 'El pedido ya está completamente pagado' })
      }
      montoACobrar = Math.round(diferencia * 100) / 100
      titulo = `Diferencia Pedido POS #${pedido.numero}`
    }

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

    const { id: prefId, init_point } = await crearPreferenciaPago({
      idPedido: pedido.id,
      titulo,
      monto: montoACobrar,
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
            .select('id, estado, observaciones, total, total_pagado')
            .eq('id', pedidoId)
            .maybeSingle()

          if (pedido && pedido.estado === 'pendiente') {
            const obsActual = pedido.observaciones || ''
            const yaEsPagoAnticipado = obsActual.includes('PAGO ANTICIPADO')
            const totalPagadoActual = parseFloat(pedido.total_pagado) || 0
            const montoPago = parseFloat(pago.transaction_amount) || parseFloat(pedido.total) || 0

            if (yaEsPagoAnticipado) {
              // Pago de diferencia — sumar al total_pagado
              await supabase
                .from('pedidos_pos')
                .update({
                  total_pagado: totalPagadoActual + montoPago,
                  mp_payment_id: String(paymentId),
                })
                .eq('id', pedidoId)
              console.log(`[POS MP Webhook] Pedido ${pedidoId} — diferencia pagada $${montoPago} (payment ${paymentId})`)
            } else {
              // Primer pago anticipado
              const nuevaObs = obsActual ? `PAGO ANTICIPADO | ${obsActual}` : 'PAGO ANTICIPADO'
              await supabase
                .from('pedidos_pos')
                .update({
                  observaciones: nuevaObs,
                  mp_payment_id: String(paymentId),
                  total_pagado: parseFloat(pedido.total) || 0,
                })
                .eq('id', pedidoId)
              console.log(`[POS MP Webhook] Pedido ${pedidoId} marcado como pagado (payment ${paymentId})`)
            }
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

// ============ SALDO A FAVOR ============

// GET /api/pos/saldo/:idClienteCentum — saldo y movimientos de un cliente
router.get('/saldo/:idClienteCentum', verificarAuth, async (req, res) => {
  try {
    const idCliente = parseInt(req.params.idClienteCentum)
    if (!idCliente) return res.status(400).json({ error: 'idClienteCentum inválido' })

    const { data: movimientos, error } = await supabase
      .from('movimientos_saldo_pos')
      .select('*')
      .eq('id_cliente_centum', idCliente)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    const saldo = (movimientos || []).reduce((s, m) => s + parseFloat(m.monto), 0)

    res.json({ saldo: Math.round(saldo * 100) / 100, movimientos: movimientos || [] })
  } catch (err) {
    console.error('[POS] Error al obtener saldo:', err.message)
    res.status(500).json({ error: 'Error al obtener saldo' })
  }
})

// GET /api/pos/saldos — lista todos los clientes con saldo > 0
router.get('/saldos', verificarAuth, async (req, res) => {
  try {
    const { data: movimientos, error } = await supabase
      .from('movimientos_saldo_pos')
      .select('id_cliente_centum, nombre_cliente, monto, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error

    // Agrupar por cliente
    const clientesMap = {}
    for (const m of (movimientos || [])) {
      const key = m.id_cliente_centum
      if (!clientesMap[key]) {
        clientesMap[key] = { id_cliente_centum: key, nombre_cliente: m.nombre_cliente, saldo: 0, ultima_actividad: m.created_at }
      }
      clientesMap[key].saldo += parseFloat(m.monto)
      // La más reciente ya viene primera por el order
    }

    // Filtrar solo saldo positivo
    const clientes = Object.values(clientesMap)
      .filter(c => c.saldo > 0.01)
      .map(c => ({ ...c, saldo: Math.round(c.saldo * 100) / 100 }))
      .sort((a, b) => b.saldo - a.saldo)

    // Filtro de búsqueda opcional
    const buscar = req.query.buscar?.toLowerCase()
    const resultado = buscar
      ? clientes.filter(c => c.nombre_cliente?.toLowerCase().includes(buscar))
      : clientes

    res.json({ clientes: resultado })
  } catch (err) {
    console.error('[POS] Error al listar saldos:', err.message)
    res.status(500).json({ error: 'Error al listar saldos' })
  }
})

// PUT /api/pos/ventas/:id/cliente — corregir cliente de una venta
router.put('/ventas/:id/cliente', verificarAuth, async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente } = req.body
    if (!nombre_cliente) return res.status(400).json({ error: 'nombre_cliente requerido' })

    const { data, error } = await supabase
      .from('ventas_pos')
      .update({ id_cliente_centum: id_cliente_centum || 0, nombre_cliente })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('[POS] Error al corregir cliente:', err.message)
    res.status(500).json({ error: 'Error al corregir cliente' })
  }
})

// ============ DEVOLUCIONES ============

// POST /api/pos/devolucion — registra devolución y genera saldo a favor
router.post('/devolucion', verificarAuth, async (req, res) => {
  try {
    const { venta_id, id_cliente_centum, nombre_cliente, items_devueltos, tipo_problema, observacion } = req.body

    if (!venta_id || !id_cliente_centum || !items_devueltos?.length) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Obtener la venta original
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_pos')
      .select('*')
      .eq('id', venta_id)
      .single()

    if (ventaErr || !venta) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    // Calcular subtotal de items devueltos (valor a precio de la venta, sin descuentos)
    const itemsVenta = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
    let subtotalDevuelto = 0
    for (const dev of items_devueltos) {
      const itemOriginal = itemsVenta[dev.indice]
      if (!itemOriginal) continue
      const precioUnit = itemOriginal.precioUnitario || itemOriginal.precio || 0
      subtotalDevuelto += precioUnit * dev.cantidad
    }

    // Calcular proporción sobre el subtotal original
    const subtotalVenta = parseFloat(venta.subtotal) || 0
    const totalVenta = parseFloat(venta.total) || 0

    if (subtotalVenta <= 0) {
      return res.status(400).json({ error: 'Subtotal de venta inválido' })
    }

    // Saldo = proporción del total pagado (que ya tiene descuentos aplicados)
    const proporcion = subtotalDevuelto / subtotalVenta
    const saldoAFavor = Math.round(proporcion * totalVenta * 100) / 100

    // Armar items de la nota de crédito (con precio proporcional al descuento)
    const factorDescuento = subtotalVenta > 0 ? totalVenta / subtotalVenta : 1
    const itemsNC = items_devueltos.map(dev => {
      const itemOriginal = itemsVenta[dev.indice] || {}
      const precioOriginal = itemOriginal.precioUnitario || itemOriginal.precio || 0
      return {
        ...itemOriginal,
        cantidad: dev.cantidad,
        precioUnitario: Math.round(precioOriginal * factorDescuento * 100) / 100,
        precio: Math.round(precioOriginal * factorDescuento * 100) / 100,
        descripcionProblema: dev.descripcion,
      }
    })

    // Crear nota de crédito (venta negativa) en ventas_pos
    const { data: notaCredito, error: ncErr } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: venta.sucursal_id,
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        subtotal: -subtotalDevuelto,
        descuento_total: -Math.round((subtotalDevuelto - saldoAFavor) * 100) / 100,
        total: -saldoAFavor,
        monto_pagado: 0,
        vuelto: 0,
        items: JSON.stringify(itemsNC),
        pagos: [],
        tipo: 'nota_credito',
        venta_origen_id: venta_id,
      })
      .select()
      .single()

    if (ncErr) throw ncErr

    // Crear movimiento de saldo a favor
    const motivo = items_devueltos.map(d => `${d.cantidad}x ${d.nombre}: ${d.descripcion}`).join(' | ')
    const { error: saldoErr } = await supabase
      .from('movimientos_saldo_pos')
      .insert({
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        monto: saldoAFavor,
        motivo: `Devolución - ${tipo_problema || 'Producto en mal estado'}. ${motivo}${observacion ? '. Obs: ' + observacion : ''}`,
        venta_pos_id: notaCredito.id,
        created_by: req.perfil.id,
      })

    if (saldoErr) throw saldoErr

    res.json({
      ok: true,
      saldo_generado: saldoAFavor,
      subtotal_devuelto: subtotalDevuelto,
      proporcion: Math.round(proporcion * 10000) / 100,
      nota_credito_id: notaCredito.id,
    })
  } catch (err) {
    console.error('[POS] Error al procesar devolución:', err.message)
    res.status(500).json({ error: 'Error al procesar devolución' })
  }
})

// POST /api/pos/correccion-cliente — NC de venta original + nueva venta al cliente correcto
router.post('/correccion-cliente', verificarAuth, async (req, res) => {
  try {
    const { venta_id, id_cliente_centum, nombre_cliente } = req.body

    if (!venta_id || !id_cliente_centum || !nombre_cliente) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Obtener venta original
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_pos')
      .select('*')
      .eq('id', venta_id)
      .single()

    if (ventaErr || !venta) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }

    const itemsOriginal = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
    const pagosOriginal = typeof venta.pagos === 'string' ? JSON.parse(venta.pagos) : (venta.pagos || [])
    const promosOriginal = venta.promociones_aplicadas
      ? (typeof venta.promociones_aplicadas === 'string' ? JSON.parse(venta.promociones_aplicadas) : venta.promociones_aplicadas)
      : null

    // 1. Crear nota de crédito (anula la venta original)
    const { data: notaCredito, error: ncErr } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: venta.sucursal_id,
        id_cliente_centum: venta.id_cliente_centum,
        nombre_cliente: venta.nombre_cliente,
        subtotal: -Math.abs(parseFloat(venta.subtotal) || 0),
        descuento_total: -Math.abs(parseFloat(venta.descuento_total) || 0),
        total: -Math.abs(parseFloat(venta.total) || 0),
        monto_pagado: 0,
        vuelto: 0,
        items: venta.items,
        pagos: [],
        tipo: 'nota_credito',
        venta_origen_id: venta_id,
      })
      .select()
      .single()

    if (ncErr) throw ncErr

    // 2. Crear nueva venta al cliente correcto (mismos items, montos y pagos)
    const { data: nuevaVenta, error: nvErr } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: venta.sucursal_id,
        id_cliente_centum,
        nombre_cliente,
        subtotal: parseFloat(venta.subtotal) || 0,
        descuento_total: parseFloat(venta.descuento_total) || 0,
        total: parseFloat(venta.total) || 0,
        monto_pagado: parseFloat(venta.monto_pagado) || 0,
        vuelto: parseFloat(venta.vuelto) || 0,
        items: venta.items,
        promociones_aplicadas: promosOriginal ? JSON.stringify(promosOriginal) : null,
        pagos: pagosOriginal,
        descuento_forma_pago: venta.descuento_forma_pago,
        tipo: 'venta',
        venta_origen_id: venta_id,
      })
      .select()
      .single()

    if (nvErr) throw nvErr

    res.json({
      ok: true,
      nota_credito_id: notaCredito.id,
      nueva_venta_id: nuevaVenta.id,
    })
  } catch (err) {
    console.error('[POS] Error al corregir cliente:', err.message)
    res.status(500).json({ error: 'Error al procesar corrección' })
  }
})

// POST /api/pos/devolucion-precio — diferencia de precio → NC + saldo
router.post('/devolucion-precio', verificarAuth, async (req, res) => {
  try {
    const { venta_id, id_cliente_centum, nombre_cliente, items_corregidos, observacion } = req.body

    if (!venta_id || !id_cliente_centum || !items_corregidos?.length) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Obtener venta original
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_pos')
      .select('*')
      .eq('id', venta_id)
      .single()

    if (ventaErr || !venta) return res.status(404).json({ error: 'Venta no encontrada' })

    const subtotalVenta = parseFloat(venta.subtotal) || 0
    const totalVenta = parseFloat(venta.total) || 0
    const factorDescuento = subtotalVenta > 0 ? totalVenta / subtotalVenta : 1

    // Calcular diferencia total
    let diferenciaTotal = 0
    const itemsNC = items_corregidos.map(ic => {
      const dif = (ic.precio_cobrado - ic.precio_correcto) * ic.cantidad
      diferenciaTotal += dif
      return {
        nombre: ic.nombre,
        cantidad: ic.cantidad,
        precioUnitario: Math.round((ic.precio_cobrado - ic.precio_correcto) * factorDescuento * 100) / 100,
        precio: Math.round((ic.precio_cobrado - ic.precio_correcto) * factorDescuento * 100) / 100,
        precio_cobrado: ic.precio_cobrado,
        precio_correcto: ic.precio_correcto,
      }
    })

    const saldoAFavor = Math.round(diferenciaTotal * factorDescuento * 100) / 100

    if (saldoAFavor <= 0) {
      return res.status(400).json({ error: 'No hay diferencia a favor del cliente' })
    }

    // Crear nota de crédito por la diferencia
    const { data: notaCredito, error: ncErr } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: venta.sucursal_id,
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        subtotal: -diferenciaTotal,
        descuento_total: -Math.round((diferenciaTotal - saldoAFavor) * 100) / 100,
        total: -saldoAFavor,
        monto_pagado: 0,
        vuelto: 0,
        items: JSON.stringify(itemsNC),
        pagos: [],
        tipo: 'nota_credito',
        venta_origen_id: venta_id,
      })
      .select()
      .single()

    if (ncErr) throw ncErr

    // Crear movimiento de saldo
    const motivo = items_corregidos.map(ic => `${ic.cantidad}x ${ic.nombre}: cobrado ${ic.precio_cobrado} → góndola ${ic.precio_correcto}`).join(' | ')
    const { error: saldoErr } = await supabase
      .from('movimientos_saldo_pos')
      .insert({
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        monto: saldoAFavor,
        motivo: `Diferencia de precio. ${motivo}${observacion ? '. Obs: ' + observacion : ''}`,
        venta_pos_id: notaCredito.id,
        created_by: req.perfil.id,
      })

    if (saldoErr) throw saldoErr

    res.json({
      ok: true,
      saldo_generado: saldoAFavor,
      nota_credito_id: notaCredito.id,
    })
  } catch (err) {
    console.error('[POS] Error al procesar corrección de precio:', err.message)
    res.status(500).json({ error: 'Error al procesar corrección de precio' })
  }
})

module.exports = router
