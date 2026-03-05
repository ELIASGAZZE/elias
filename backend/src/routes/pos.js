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
    let query = supabase
      .from('articulos')
      .select('id, id_centum, codigo, nombre, rubro, subrubro, rubro_id_centum, subrubro_id_centum, precio, descuento1, descuento2, descuento3, iva_tasa, es_pesable')
      .eq('tipo', 'automatico')
      .gt('precio', 0)

    if (req.query.buscar) {
      query = query.or(`nombre.ilike.%${req.query.buscar}%,codigo.ilike.%${req.query.buscar}%`)
    }

    const { data, error } = await query
    if (error) throw error

    const articulos = (data || []).map(a => ({
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
    if (!['porcentaje', 'monto_fijo', 'nxm', 'combo'].includes(tipo)) {
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
      if (!['porcentaje', 'monto_fijo', 'nxm', 'combo'].includes(tipo)) {
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
    const { id_cliente_centum, nombre_cliente, items, promociones_aplicadas, subtotal, descuento_total, total, monto_pagado, vuelto } = req.body

    if (!id_cliente_centum) return res.status(400).json({ error: 'id_cliente_centum es requerido' })
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items es requerido' })
    if (total == null || total <= 0) return res.status(400).json({ error: 'total debe ser mayor a 0' })
    if (monto_pagado == null || monto_pagado < total) return res.status(400).json({ error: 'monto_pagado debe ser >= total' })

    const { data, error } = await supabase
      .from('ventas_pos')
      .insert({
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
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ venta: data, mensaje: 'Venta registrada correctamente' })
  } catch (err) {
    console.error('[POS] Error al guardar venta:', err.message)
    res.status(500).json({ error: 'Error al guardar venta: ' + err.message })
  }
})

// GET /api/pos/ventas?fecha=YYYY-MM-DD
// Lista ventas del día
router.get('/ventas', verificarAuth, async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0]
    const desde = `${fecha}T00:00:00`
    const hasta = `${fecha}T23:59:59`

    let query = supabase
      .from('ventas_pos')
      .select('*, perfiles:cajero_id(nombre)')
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('created_at', { ascending: false })

    // No-admin solo ve sus ventas
    if (req.perfil.rol !== 'admin') {
      query = query.eq('cajero_id', req.perfil.id)
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ ventas: data || [] })
  } catch (err) {
    console.error('[POS] Error al listar ventas:', err.message)
    res.status(500).json({ error: 'Error al listar ventas' })
  }
})

module.exports = router
