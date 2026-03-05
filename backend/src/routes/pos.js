// Rutas para el Punto de Venta (POS) con promociones de Centum
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth } = require('../middleware/auth')
const { generateAccessToken } = require('../services/syncERP')
const { registrarLlamada } = require('../services/apiLogger')

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
}

// Cache de promociones (5 minutos)
let promosCache = null
let promosCacheTime = 0
const PROMOS_CACHE_TTL = 5 * 60 * 1000

// GET /api/pos/articulos?id_cliente_centum=X
// Obtiene artículos de Centum con precios para el cliente dado
router.get('/articulos', verificarAuth, async (req, res) => {
  try {
    const idCliente = parseInt(req.query.id_cliente_centum)
    if (!idCliente || isNaN(idCliente)) {
      return res.status(400).json({ error: 'id_cliente_centum es requerido' })
    }

    const url = `${BASE_URL}/Articulos/Venta`
    const inicio = Date.now()

    const hoy = new Date().toISOString().split('T')[0]
    const body = {
      FechaDocumento: hoy,
      FechaListaPrecio: hoy,
      IdCliente: idCliente,
      Habilitado: true,
    }

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
      })
    } catch (err) {
      registrarLlamada({
        servicio: 'centum_pos_articulos', endpoint: url, metodo: 'POST',
        estado: 'error', duracion_ms: Date.now() - inicio,
        error_mensaje: err.message, origen: 'api',
      })
      throw new Error('Error al conectar con Centum: ' + err.message)
    }

    if (!response.ok) {
      const texto = await response.text()
      registrarLlamada({
        servicio: 'centum_pos_articulos', endpoint: url, metodo: 'POST',
        estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
        error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
      })
      throw new Error(`Error Centum (${response.status}): ${texto.slice(0, 200)}`)
    }

    const data = await response.json()
    const items = data.Articulos?.Items || data.Items || (Array.isArray(data) ? data : [])

    registrarLlamada({
      servicio: 'centum_pos_articulos', endpoint: url, metodo: 'POST',
      estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
      items_procesados: items.length, origen: 'api',
    })

    // Mapear solo campos relevantes para el POS
    const articulos = items
      .filter(a => a.Habilitado !== false)
      .map(a => ({
        id: a.IdArticulo,
        codigo: a.Codigo || '',
        nombre: a.NombreFantasia || a.Nombre || '',
        precio: a.Precio || 0,
        rubro: a.Rubro ? { id: a.Rubro.IdRubro, nombre: a.Rubro.Nombre } : null,
        subRubro: a.SubRubro ? { id: a.SubRubro.IdSubRubro, nombre: a.SubRubro.Nombre } : null,
        iva: a.CategoriaImpuestoIVA ? {
          id: a.CategoriaImpuestoIVA.IdCategoriaImpuestoIVA,
          tasa: a.CategoriaImpuestoIVA.Tasa || 21,
        } : { id: null, tasa: 21 },
        descuento1: a.PorcentajeDescuento1 || 0,
        descuento2: a.PorcentajeDescuento2 || 0,
        descuento3: a.PorcentajeDescuento3 || 0,
        esPesable: a.EsPesable || false,
        esCombo: a.EsCombo || false,
      }))

    res.json({ articulos, total: articulos.length })
  } catch (err) {
    console.error('[POS] Error al obtener artículos:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/pos/promociones
// Obtiene promociones comerciales activas de Centum
router.get('/promociones', verificarAuth, async (req, res) => {
  try {
    // Devolver cache si es válido
    if (promosCache && Date.now() - promosCacheTime < PROMOS_CACHE_TTL) {
      return res.json({ promociones: promosCache, cached: true })
    }

    const url = `${BASE_URL}/PromocionesComerciales/FiltrosPromocionComercial?numeroPagina=1&cantidadItemsPorPagina=500`
    const inicio = Date.now()

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ Activa: true }),
      })
    } catch (err) {
      registrarLlamada({
        servicio: 'centum_pos_promos', endpoint: url, metodo: 'POST',
        estado: 'error', duracion_ms: Date.now() - inicio,
        error_mensaje: err.message, origen: 'api',
      })
      throw new Error('Error al conectar con Centum: ' + err.message)
    }

    if (!response.ok) {
      const texto = await response.text()
      registrarLlamada({
        servicio: 'centum_pos_promos', endpoint: url, metodo: 'POST',
        estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
        error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
      })
      throw new Error(`Error Centum (${response.status}): ${texto.slice(0, 200)}`)
    }

    const data = await response.json()
    // Centum retorna array plano con duplicados (mismo id repetido)
    const rawItems = Array.isArray(data) ? data : data.PromocionesComerciales?.Items || data.Items || []

    registrarLlamada({
      servicio: 'centum_pos_promos', endpoint: url, metodo: 'POST',
      estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
      items_procesados: rawItems.length, origen: 'api',
    })

    // Deduplicar por IdPromocionComercial
    const promosMap = {}
    for (const p of rawItems) {
      if (!p.IdPromocionComercial) continue
      if (!promosMap[p.IdPromocionComercial]) {
        promosMap[p.IdPromocionComercial] = p
      }
    }

    // Parsear: campo real es PromocionComercialResultados, TipoEntidad es string
    const promociones = Object.values(promosMap).map(p => {
      const resultados = p.PromocionComercialResultados || []
      return {
        id: p.IdPromocionComercial,
        nombre: p.Nombre || '',
        activa: p.Activo !== false,
        fechaDesde: p.FechaPromocionDesde,
        fechaHasta: p.FechaPromocionHasta,
        detalles: resultados.map(d => {
          // TipoEntidad: "Sub Rubro", "Rubro", "Artículo", "Atributo de Artículo"
          let tipo = 'Otro'
          if (d.TipoEntidad === 'Sub Rubro') tipo = 'SubRubro'
          else if (d.TipoEntidad === 'Rubro') tipo = 'Rubro'
          else if (d.TipoEntidad === 'Artículo') tipo = 'Articulo'
          return {
            tipo,
            entidadId: d.IdEntidad,
            porcentajeDescuento: d.Descuento || 0,
            unidades: d.Unidades || 0,
          }
        }).filter(d => d.tipo !== 'Otro'),
      }
    }).filter(p => p.activa && p.detalles.length > 0)

    promosCache = promociones
    promosCacheTime = Date.now()

    res.json({ promociones, cached: false })
  } catch (err) {
    console.error('[POS] Error al obtener promociones:', err.message)
    // Si hay cache viejo, usarlo como fallback
    if (promosCache) {
      return res.json({ promociones: promosCache, cached: true, fallback: true })
    }
    res.status(500).json({ error: err.message })
  }
})

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
