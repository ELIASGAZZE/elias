// Rutas para Gift Cards POS
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// POST /api/gift-cards/activar — Cajero escanea barcode + elige monto
router.post('/activar', verificarAuth, async (req, res) => {
  try {
    const { codigo, monto, comprador_nombre, pagos, caja_id, sucursal_id, cierre_id, cajero_nombre } = req.body

    if (!codigo || !codigo.trim()) return res.status(400).json({ error: 'Código es requerido' })
    if (codigo.trim().length !== 19) return res.status(400).json({ error: 'El código debe tener exactamente 19 dígitos' })
    if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto debe ser mayor a 0' })

    // Verificar que el código no exista ya
    const { data: existente } = await supabase
      .from('gift_cards')
      .select('id')
      .eq('codigo', codigo.trim())
      .maybeSingle()

    if (existente) return res.status(400).json({ error: 'Este código de gift card ya fue activado' })

    // Insertar gift card
    const insertData = {
      codigo: codigo.trim(),
      monto_inicial: monto,
      saldo: monto,
      estado: 'activa',
      comprador_nombre: comprador_nombre || null,
      created_by: req.perfil.id,
    }
    if (caja_id) insertData.caja_id = caja_id
    if (sucursal_id) insertData.sucursal_id = sucursal_id
    if (cierre_id) insertData.cierre_id = cierre_id
    if (pagos && Array.isArray(pagos)) insertData.pagos = pagos
    if (cajero_nombre) insertData.cajero_nombre = cajero_nombre

    const { data: giftCard, error } = await supabase
      .from('gift_cards')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    // Crear ventas_pos para tener numero_venta y trazabilidad
    // El total es lo que realmente se cobró (puede ser menor al nominal por descuento forma pago)
    const totalRealCobrado = (pagos || []).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0) || monto
    let ventaId = null
    const ventaInsert = {
      cajero_id: req.perfil.id,
      id_cliente_centum: 0,
      sucursal_id: sucursal_id || req.perfil.sucursal_id || null,
      caja_id: caja_id || null,
      nombre_cliente: comprador_nombre || null,
      subtotal: monto,
      descuento_total: 0,
      total: totalRealCobrado,
      monto_pagado: totalRealCobrado,
      vuelto: 0,
      items: JSON.stringify([{ nombre: `Gift Card ${codigo.trim()}`, cantidad: 1, precio_unitario: monto, precio_final: monto, es_gift_card: true }]),
      pagos: pagos || [],
      gift_cards_vendidas: [{ codigo: codigo.trim(), monto_nominal: monto, comprador: comprador_nombre || null }],
      centum_sync: true, // Gift cards no se sincronizan a Centum
    }

    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_pos')
      .insert(ventaInsert)
      .select('id, numero_venta')
      .single()

    if (ventaErr) {
      console.error('[GiftCards] Error al crear venta_pos:', ventaErr.message, ventaErr.details, ventaErr.hint, JSON.stringify(ventaInsert))
      throw new Error('No se pudo registrar la venta de la gift card: ' + ventaErr.message)
    }
    ventaId = venta.id

    // Insertar movimiento de activación con venta_pos_id
    await supabase
      .from('movimientos_gift_card')
      .insert({
        gift_card_id: giftCard.id,
        monto: monto,
        motivo: 'Activación',
        venta_pos_id: ventaId,
        created_by: req.perfil.id,
      })

    res.status(201).json({ gift_card: giftCard, numero_venta: venta?.numero_venta, mensaje: 'Gift card activada correctamente' })
  } catch (err) {
    console.error('[GiftCards] Error al activar:', err.message)
    res.status(500).json({ error: 'Error al activar gift card: ' + err.message })
  }
})

// GET /api/gift-cards/consultar/:codigo — Consulta saldo y movimientos
router.get('/consultar/:codigo', verificarAuth, async (req, res) => {
  try {
    const { data: giftCard, error } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('codigo', req.params.codigo.trim())
      .maybeSingle()

    if (error) throw error
    if (!giftCard) return res.status(404).json({ error: 'Gift card no encontrada' })

    // Obtener nombre del cajero (empleado real) que activó
    let cajero_nombre = giftCard.cajero_nombre || null
    // Si no tiene cajero_nombre guardado, intentar obtenerlo del cierre
    if (!cajero_nombre && giftCard.cierre_id) {
      const { data: cierre } = await supabase
        .from('cierres_pos')
        .select('empleado_id, empleado:empleados!empleado_id(nombre)')
        .eq('id', giftCard.cierre_id)
        .single()
      if (cierre?.empleado?.nombre) cajero_nombre = cierre.empleado.nombre
    }

    // Obtener venta de activación (primer movimiento con motivo Activación)
    let venta_activacion = null
    const { data: movActivacion } = await supabase
      .from('movimientos_gift_card')
      .select('venta_pos_id')
      .eq('gift_card_id', giftCard.id)
      .eq('motivo', 'Activación')
      .not('venta_pos_id', 'is', null)
      .limit(1)
      .maybeSingle()

    if (movActivacion?.venta_pos_id) {
      const { data: venta } = await supabase
        .from('ventas_pos')
        .select('id, numero_venta, cajero_id, sucursal_id, created_at')
        .eq('id', movActivacion.venta_pos_id)
        .single()
      if (venta) {
        // Obtener nombre de cajero de la venta
        let ventaCajeroNombre = null
        if (venta.cajero_id) {
          const { data: p } = await supabase.from('perfiles').select('nombre').eq('id', venta.cajero_id).single()
          if (p) ventaCajeroNombre = p.nombre
        }
        // Obtener nombre de sucursal
        const { data: suc } = await supabase
          .from('sucursales')
          .select('nombre')
          .eq('id', venta.sucursal_id)
          .single()
        venta_activacion = { ...venta, cajero_nombre: ventaCajeroNombre, sucursal_nombre: suc?.nombre || null }
      }
    }

    // Obtener nombre de caja — primero desde gift_card directa, sino desde la venta
    let caja_nombre = null
    let sucursal_nombre = null
    const cajaId = giftCard.caja_id || (venta_activacion ? (await supabase.from('ventas_pos').select('caja_id').eq('id', venta_activacion.id).single()).data?.caja_id : null)
    if (cajaId) {
      const { data: caja } = await supabase.from('cajas').select('nombre, sucursal_id').eq('id', cajaId).single()
      if (caja) {
        caja_nombre = caja.nombre
        if (!venta_activacion?.sucursal_nombre && caja.sucursal_id) {
          const { data: suc } = await supabase.from('sucursales').select('nombre').eq('id', caja.sucursal_id).single()
          if (suc) sucursal_nombre = suc.nombre
        }
      }
    }
    // Sucursal desde gift_card directa si no se obtuvo de la caja
    if (!sucursal_nombre && giftCard.sucursal_id) {
      const { data: suc } = await supabase.from('sucursales').select('nombre').eq('id', giftCard.sucursal_id).single()
      if (suc) sucursal_nombre = suc.nombre
    }

    const { data: movimientos } = await supabase
      .from('movimientos_gift_card')
      .select('*')
      .eq('gift_card_id', giftCard.id)
      .order('created_at', { ascending: false })

    // Enriquecer movimientos con número de venta
    const movEnriquecidos = await Promise.all((movimientos || []).map(async (m) => {
      if (m.venta_pos_id) {
        const { data: v } = await supabase
          .from('ventas_pos')
          .select('numero_venta, cajero_nombre')
          .eq('id', m.venta_pos_id)
          .single()
        return { ...m, numero_venta: v?.numero_venta, venta_cajero: v?.cajero_nombre }
      }
      return m
    }))

    res.json({
      gift_card: { ...giftCard, cajero_nombre, venta_activacion, caja_nombre, sucursal_nombre: venta_activacion?.sucursal_nombre || sucursal_nombre },
      movimientos: movEnriquecidos,
    })
  } catch (err) {
    console.error('[GiftCards] Error al consultar:', err.message)
    res.status(500).json({ error: 'Error al consultar gift card' })
  }
})

// POST /api/gift-cards/usar — Usa saldo como pago
router.post('/usar', verificarAuth, async (req, res) => {
  try {
    const { codigo, monto, venta_pos_id } = req.body

    if (!codigo) return res.status(400).json({ error: 'Código es requerido' })
    if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto debe ser mayor a 0' })

    const { data: giftCard, error: gcErr } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('codigo', codigo.trim())
      .maybeSingle()

    if (gcErr) throw gcErr
    if (!giftCard) return res.status(404).json({ error: 'Gift card no encontrada' })
    if (giftCard.estado !== 'activa') return res.status(400).json({ error: 'Gift card no está activa' })

    const saldoActual = parseFloat(giftCard.saldo)
    if (monto > saldoActual + 0.01) {
      return res.status(400).json({ error: `Saldo insuficiente. Disponible: $${saldoActual.toFixed(2)}` })
    }

    const nuevoSaldo = Math.round((saldoActual - monto) * 100) / 100
    const nuevoEstado = nuevoSaldo <= 0 ? 'agotada' : 'activa'

    // Actualizar saldo
    const { error: upErr } = await supabase
      .from('gift_cards')
      .update({ saldo: nuevoSaldo, estado: nuevoEstado })
      .eq('id', giftCard.id)

    if (upErr) throw upErr

    // Registrar movimiento negativo
    await supabase
      .from('movimientos_gift_card')
      .insert({
        gift_card_id: giftCard.id,
        monto: -monto,
        motivo: 'Uso en venta',
        venta_pos_id: venta_pos_id || null,
        created_by: req.perfil.id,
      })

    res.json({
      gift_card: { ...giftCard, saldo: nuevoSaldo, estado: nuevoEstado },
      mensaje: nuevoEstado === 'agotada' ? 'Gift card agotada' : `Saldo restante: $${nuevoSaldo.toFixed(2)}`,
    })
  } catch (err) {
    console.error('[GiftCards] Error al usar:', err.message)
    res.status(500).json({ error: 'Error al usar gift card: ' + err.message })
  }
})

// GET /api/gift-cards — Lista gift cards con filtros
router.get('/', verificarAuth, async (req, res) => {
  try {
    let query = supabase
      .from('gift_cards')
      .select('*')
      .order('created_at', { ascending: false })

    if (req.query.estado) {
      query = query.eq('estado', req.query.estado)
    }
    if (req.query.buscar) {
      query = query.ilike('codigo', `%${req.query.buscar}%`)
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ gift_cards: data || [] })
  } catch (err) {
    console.error('[GiftCards] Error al listar:', err.message)
    res.status(500).json({ error: 'Error al listar gift cards' })
  }
})

// PUT /api/gift-cards/:id/anular — Admin anula gift card
router.put('/:id/anular', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data: giftCard, error: gcErr } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle()

    if (gcErr) throw gcErr
    if (!giftCard) return res.status(404).json({ error: 'Gift card no encontrada' })
    if (giftCard.estado === 'anulada') return res.status(400).json({ error: 'Gift card ya está anulada' })

    const saldoAnterior = parseFloat(giftCard.saldo)

    const { error: upErr } = await supabase
      .from('gift_cards')
      .update({ estado: 'anulada', saldo: 0 })
      .eq('id', giftCard.id)

    if (upErr) throw upErr

    // Registrar movimiento de anulación
    if (saldoAnterior > 0) {
      await supabase
        .from('movimientos_gift_card')
        .insert({
          gift_card_id: giftCard.id,
          monto: -saldoAnterior,
          motivo: 'Anulación',
          created_by: req.perfil.id,
        })
    }

    res.json({ gift_card: { ...giftCard, estado: 'anulada', saldo: 0 }, mensaje: 'Gift card anulada' })
  } catch (err) {
    console.error('[GiftCards] Error al anular:', err.message)
    res.status(500).json({ error: 'Error al anular gift card: ' + err.message })
  }
})

module.exports = router
