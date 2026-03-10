// Rutas para Gift Cards POS
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// POST /api/gift-cards/activar — Cajero escanea barcode + elige monto
router.post('/activar', verificarAuth, async (req, res) => {
  try {
    const { codigo, monto, comprador_nombre, pagos } = req.body

    if (!codigo || !codigo.trim()) return res.status(400).json({ error: 'Código es requerido' })
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
    if (pagos && Array.isArray(pagos)) insertData.pagos = pagos

    const { data: giftCard, error } = await supabase
      .from('gift_cards')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    // Insertar movimiento de activación
    await supabase
      .from('movimientos_gift_card')
      .insert({
        gift_card_id: giftCard.id,
        monto: monto,
        motivo: 'Activación',
        created_by: req.perfil.id,
      })

    res.status(201).json({ gift_card: giftCard, mensaje: 'Gift card activada correctamente' })
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

    const { data: movimientos } = await supabase
      .from('movimientos_gift_card')
      .select('*')
      .eq('gift_card_id', giftCard.id)
      .order('created_at', { ascending: false })

    res.json({ gift_card: giftCard, movimientos: movimientos || [] })
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
