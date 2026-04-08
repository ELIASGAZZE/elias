// Rutas para el Punto de Venta (POS) con promociones locales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { sincronizarERP } = require('../services/syncERP')
const { getVentasCentumByFecha, getResumenVentasCentumBI, getVentasCentumDetallado, getVentasPOSParaDuplicados, getVentasCentumPaginado, getVentaCentumDetalle } = require('../config/centum')
const { registrarVentaPOSEnCentum, crearVentaPOS, crearNotaCreditoPOS, crearNotaCreditoConceptoPOS, extraerPuntoVentaDeComprobante, obtenerVentaCentum, buscarVentaExistenteEnCentum, verificarEnBI, fetchAndSaveCAE, retrySyncCAE } = require('../services/centumVentasPOS')
const { crearClienteEnCentum } = require('../services/centumClientes')
const crypto = require('crypto')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { crearVentaSchema } = require('../schemas/pos')
const asyncHandler = require('../middleware/asyncHandler')
const OPERADOR_MOVIL_USER_PRUEBA = process.env.CENTUM_OPERADOR_PRUEBA_USER || 'api123'

// Lock en memoria para prevenir ventas duplicadas por doble-submit concurrente
const ventaTicketLock = new Set()

// Token HMAC para links de descarga de comprobantes (no requiere auth)
const COMPROBANTE_SECRET = process.env.COMPROBANTE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'comprobante-secret'
function generarTokenDescarga(ventaId) {
  return crypto.createHmac('sha256', COMPROBANTE_SECRET).update(String(ventaId)).digest('hex').slice(0, 32)
}
function generarLinkDescarga(ventaId) {
  const token = generarTokenDescarga(ventaId)
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
  return `${backendUrl}/api/pos/ventas/${ventaId}/comprobante.pdf?token=${token}`
}

// Calcular desglose de forma_pago_origen proporcional al monto del saldo
function calcularFormaPagoOrigen(pagos, montoSaldo, totalVenta) {
  if (!Array.isArray(pagos) || pagos.length === 0 || !totalVenta || totalVenta <= 0) return null
  const desglose = {}
  for (const p of pagos) {
    const tipo = p.tipo || 'Efectivo'
    const monto = parseFloat(p.monto) || 0
    if (monto <= 0) continue
    const proporcion = monto / totalVenta
    const montoOrigen = Math.round(proporcion * montoSaldo * 100) / 100
    if (montoOrigen > 0) {
      desglose[tipo] = (desglose[tipo] || 0) + montoOrigen
    }
  }
  // Ajustar redondeo para que sume exactamente montoSaldo
  const sumaDesglose = Object.values(desglose).reduce((s, v) => s + v, 0)
  const diff = Math.round((montoSaldo - sumaDesglose) * 100) / 100
  if (diff !== 0 && Object.keys(desglose).length > 0) {
    const primerKey = Object.keys(desglose)[0]
    desglose[primerKey] = Math.round((desglose[primerKey] + diff) * 100) / 100
  }
  return Object.keys(desglose).length > 0 ? desglose : null
}

// GET /api/pos/articulos
// Lee artículos con precios minoristas desde la tabla local (sincronizada 1x/día)
router.get('/articulos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const campos = 'id, id_centum, codigo, nombre, tipo, rubro, subrubro, rubro_id_centum, subrubro_id_centum, marca, precio, descuento1, descuento2, descuento3, iva_tasa, es_pesable, codigos_barras, atributos, updated_at, tiene_imagen, peso_promedio_pieza, peso_minimo, peso_maximo, peso_muestras'

    // Obtener IDs de combos habilitados (al menos en una sucursal)
    const { data: combosHab } = await supabase
      .from('articulos_por_sucursal')
      .select('articulo_id, articulos!inner(tipo)')
      .eq('habilitado', true)
      .eq('articulos.tipo', 'combo')
    const comboIdsHabilitados = new Set((combosHab || []).map(c => c.articulo_id))

    // Supabase limita a 1000 por defecto — paginar para traer todos
    const PAGE_SIZE = 1000
    let allData = []
    let from = 0

    while (true) {
      let query = supabase
        .from('articulos')
        .select(campos)
        .in('tipo', ['automatico', 'combo'])
        .gt('precio', 0)
        .range(from, from + PAGE_SIZE - 1)

      if (req.query.buscar) {
        query = query.or(`nombre.ilike.%${req.query.buscar}%,codigo.ilike.%${req.query.buscar}%`)
        query = query.limit(100)
      }

      const { data, error } = await query
      if (error) throw error
      if (!data || data.length === 0) break
      // Filtrar combos no habilitados
      const filtered = data.filter(a => a.tipo !== 'combo' || comboIdsHabilitados.has(a.id))
      allData = allData.concat(filtered)
      if (req.query.buscar) break // con búsqueda, no paginar (ya tiene limit)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const articulos = allData.map(a => ({
      id: a.id_centum || a.id,
      dbId: a.id,
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
      marca: a.marca || null,
      atributos: a.atributos || [],
      updatedAt: a.updated_at || null,
      tieneImagen: a.tiene_imagen || false,
      pesoPromedioPieza: a.peso_promedio_pieza ? parseFloat(a.peso_promedio_pieza) : null,
      pesoMinimo: a.peso_minimo ? parseFloat(a.peso_minimo) : null,
      pesoMaximo: a.peso_maximo ? parseFloat(a.peso_maximo) : null,
      pesoMuestras: a.peso_muestras || 0,
    }))

    res.json({ articulos, total: articulos.length })
  } catch (err) {
    logger.error('[POS] Error al obtener artículos:', err.message)
    res.status(500).json({ error: err.message })
  }
}))

// POST /api/pos/sincronizar-articulos (admin/gestor)
// Sincroniza artículos desde Centum manualmente
router.post('/sincronizar-articulos', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const resultado = await sincronizarERP('manual_pos')
    res.json(resultado)
  } catch (err) {
    logger.error('[POS] Error al sincronizar artículos:', err.message)
    res.status(500).json({ error: 'Error al sincronizar: ' + err.message })
  }
}))

// ============ ARTÍCULOS DELIVERY ============

// GET /api/pos/articulos-delivery — artículos con precio delivery configurado
router.get('/articulos-delivery', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('articulos_delivery')
      .select('id, articulo_id_centum, nombre, precio_delivery, activo')
      .order('nombre')
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('[POS] Error al obtener artículos delivery:', err.message)
    res.status(500).json({ error: err.message })
  }
}))

// POST /api/pos/articulos-delivery — upsert artículo delivery (admin)
router.post('/articulos-delivery', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { articulo_id_centum, nombre, precio_delivery, activo } = req.body
    if (!articulo_id_centum || !nombre || precio_delivery == null) {
      return res.status(400).json({ error: 'articulo_id_centum, nombre y precio_delivery son requeridos' })
    }
    const { data, error } = await supabase
      .from('articulos_delivery')
      .upsert({
        articulo_id_centum,
        nombre,
        precio_delivery,
        activo: activo !== false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'articulo_id_centum' })
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('[POS] Error al guardar artículo delivery:', err.message)
    res.status(500).json({ error: err.message })
  }
}))

// DELETE /api/pos/articulos-delivery/:id — eliminar config delivery (admin)
router.delete('/articulos-delivery/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase
      .from('articulos_delivery')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    logger.error('[POS] Error al eliminar artículo delivery:', err.message)
    res.status(500).json({ error: err.message })
  }
}))

// ============ RUBROS / SUBRUBROS ============

// GET /api/pos/rubros — rubros distintos de artículos Centum
router.get('/rubros', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const PAGE_SIZE = 1000
    const map = {}
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('articulos')
        .select('rubro, rubro_id_centum')
        .in('tipo', ['automatico', 'combo'])
        .not('rubro', 'is', null)
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw error
      if (!data || data.length === 0) break

      for (const row of data) {
        if (row.rubro_id_centum && !map[row.rubro_id_centum]) {
          map[row.rubro_id_centum] = { id: row.rubro_id_centum, nombre: row.rubro }
        }
      }

      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const rubros = Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
    res.json({ rubros })
  } catch (err) {
    logger.error('[POS] Error al obtener rubros:', err.message)
    res.status(500).json({ error: 'Error al obtener rubros' })
  }
}))

// GET /api/pos/marcas — marcas distintas de artículos
router.get('/marcas', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const PAGE_SIZE = 1000
    const set = new Set()
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('articulos')
        .select('marca')
        .in('tipo', ['automatico', 'combo'])
        .not('marca', 'is', null)
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      for (const row of data) { if (row.marca) set.add(row.marca) }
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    const marcas = [...set].sort((a, b) => a.localeCompare(b)).map(m => ({ nombre: m }))
    res.json({ marcas })
  } catch (err) {
    logger.error('[POS] Error al obtener marcas:', err.message)
    res.status(500).json({ error: 'Error al obtener marcas' })
  }
}))

// GET /api/pos/subrubros — subrubros distintos de artículos Centum
router.get('/subrubros', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const PAGE_SIZE = 1000
    const map = {}
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('articulos')
        .select('subrubro, subrubro_id_centum')
        .in('tipo', ['automatico', 'combo'])
        .not('subrubro', 'is', null)
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw error
      if (!data || data.length === 0) break

      for (const row of data) {
        if (row.subrubro_id_centum && !map[row.subrubro_id_centum]) {
          map[row.subrubro_id_centum] = { id: row.subrubro_id_centum, nombre: row.subrubro }
        }
      }

      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const subrubros = Object.values(map).sort((a, b) => a.nombre.localeCompare(b.nombre))
    res.json({ subrubros })
  } catch (err) {
    logger.error('[POS] Error al obtener subrubros:', err.message)
    res.status(500).json({ error: 'Error al obtener subrubros' })
  }
}))

// GET /api/pos/atributos-articulo
// Lista atributos únicos desde la columna JSONB de artículos
router.get('/atributos-articulo', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // Leer artículos que tengan atributos no vacíos (paginar para traer todos)
    let allData = []
    let from = 0
    const pageSize = 1000
    while (true) {
      const { data: page, error } = await supabase
        .from('articulos')
        .select('atributos')
        .not('atributos', 'eq', '[]')
        .not('atributos', 'is', null)
        .range(from, from + pageSize - 1)
      if (error) throw error
      allData = allData.concat(page || [])
      if (!page || page.length < pageSize) break
      from += pageSize
    }
    const data = allData

    // Extraer atributos únicos agrupados por nombre
    const attrMap = {} // { nombreAttr: { id, nombre, valores: { id_valor: valor } } }
    for (const art of (data || [])) {
      for (const attr of (art.atributos || [])) {
        if (!attr.id || !attr.id_valor) continue
        if (!attrMap[attr.id]) {
          attrMap[attr.id] = { id: attr.id, nombre: attr.nombre, valores: {} }
        }
        attrMap[attr.id].valores[attr.id_valor] = attr.valor
      }
    }

    // Convertir a array con valores como sub-array
    const atributos = Object.values(attrMap).map(a => ({
      id: a.id,
      nombre: a.nombre,
      valores: Object.entries(a.valores).map(([id_valor, valor]) => ({
        id_valor: parseInt(id_valor),
        valor,
      })),
    }))

    res.json({ atributos })
  } catch (err) {
    logger.error('[POS] Error al listar atributos:', err.message)
    res.status(500).json({ error: 'Error al listar atributos' })
  }
}))

// ============ PROMOCIONES LOCALES ============

// GET /api/pos/promociones
// Lista promos activas (POS) o todas si ?todas=1 (admin)
router.get('/promociones', verificarAuth, asyncHandler(async (req, res) => {
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
    logger.error('[POS] Error al listar promociones:', err.message)
    res.status(500).json({ error: 'Error al listar promociones' })
  }
}))

// POST /api/pos/promociones (admin/gestor)
router.post('/promociones', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { nombre, tipo, fecha_desde, fecha_hasta, reglas } = req.body

    if (!nombre || !tipo || !reglas) {
      return res.status(400).json({ error: 'nombre, tipo y reglas son requeridos' })
    }
    if (!['porcentaje', 'monto_fijo', 'nxm', 'combo', 'forma_pago', 'condicional'].includes(tipo)) {
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
    logger.error('[POS] Error al crear promoción:', err.message)
    res.status(500).json({ error: 'Error al crear promoción: ' + err.message })
  }
}))

// PUT /api/pos/promociones/:id (admin/gestor)
router.put('/promociones/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { nombre, tipo, activa, fecha_desde, fecha_hasta, reglas } = req.body
    const updates = { updated_at: new Date().toISOString() }

    if (nombre !== undefined) updates.nombre = nombre
    if (tipo !== undefined) {
      if (!['porcentaje', 'monto_fijo', 'nxm', 'combo', 'forma_pago', 'condicional'].includes(tipo)) {
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
    logger.error('[POS] Error al editar promoción:', err.message)
    res.status(500).json({ error: 'Error al editar promoción: ' + err.message })
  }
}))

// DELETE /api/pos/promociones/:id (admin/gestor) — soft delete
router.delete('/promociones/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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
    logger.error('[POS] Error al eliminar promoción:', err.message)
    res.status(500).json({ error: 'Error al eliminar promoción: ' + err.message })
  }
}))

// ============ VENTAS ============

// POST /api/pos/ventas
// Guarda una venta POS localmente
router.post('/ventas', verificarAuth, validate(crearVentaSchema), asyncHandler(async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, items, promociones_aplicadas, subtotal, descuento_total, total, monto_pagado, vuelto, pagos, descuento_forma_pago, pedido_pos_id, saldo_aplicado, saldo_forma_pago_origen, gift_cards_aplicadas, gift_cards_a_activar, caja_id, canal, descuento_grupo_cliente, grupo_descuento_nombre, created_at_offline, condicion_iva, ticket_uid } = req.body

    // === IDEMPOTENCIA: prevenir ventas duplicadas por doble-submit ===
    if (!ticket_uid) {
      logger.warn(`[POS] Venta SIN ticket_uid — sin protección anti-duplicado. Cliente: ${nombre_cliente}, Total: ${total}, Cajero: ${req.perfil?.id}`)
    }
    if (ticket_uid) {
      // Capa 1: lock en memoria — bloquea requests concurrentes con mismo ticket_uid
      if (ventaTicketLock.has(ticket_uid)) {
        logger.warn(`[POS] Venta duplicada bloqueada (lock) — ticket_uid ${ticket_uid} ya está siendo procesado`)
        return res.status(409).json({ error: 'Esta venta ya se está procesando', duplicada: true })
      }
      ventaTicketLock.add(ticket_uid)

      // Capa 2: check en DB — por si el lock se perdió (restart del server, etc)
      try {
        const { data: ventaExistente } = await supabase
          .from('ventas_pos')
          .select('id, numero_venta')
          .eq('ticket_uid', ticket_uid)
          .maybeSingle()
        if (ventaExistente) {
          ventaTicketLock.delete(ticket_uid)
          logger.warn(`[POS] Venta duplicada bloqueada (DB) — ticket_uid ${ticket_uid} ya existe como venta #${ventaExistente.numero_venta}`)
          return res.json({ venta: ventaExistente, duplicada: true })
        }
      } catch (dbCheckErr) {
        // Si la columna ticket_uid no existe aún, ignorar el check de DB (no bloquear la venta)
        if (!dbCheckErr.message?.includes('ticket_uid')) {
          ventaTicketLock.delete(ticket_uid)
          throw dbCheckErr
        }
      }
    }

    // Calcular total de gift cards a activar (se resta del total para ventas_pos)
    const totalGCActivar = (gift_cards_a_activar || []).reduce((s, gc) => s + (parseFloat(gc.monto) || 0), 0)
    const totalItemsSolo = Math.round((total - totalGCActivar) * 100) / 100

    // Validar que haya items o gift cards a activar
    const tieneItems = items && Array.isArray(items) && items.length > 0
    const tieneGC = gift_cards_a_activar && Array.isArray(gift_cards_a_activar) && gift_cards_a_activar.length > 0
    if (!tieneItems && !tieneGC) return res.status(400).json({ error: 'items o gift_cards_a_activar es requerido' })

    const saldoApl = parseFloat(saldo_aplicado) || 0
    const totalACobrar = total - saldoApl
    const montoPagadoNum = parseFloat(monto_pagado) || 0
    const totalGCAplicadas = (gift_cards_aplicadas && Array.isArray(gift_cards_aplicadas))
      ? gift_cards_aplicadas.reduce((s, gc) => s + (parseFloat(gc.monto) || 0), 0) : 0

    // Validar que monto_pagado + saldo + gift cards >= total
    if (montoPagadoNum + saldoApl + totalGCAplicadas < total - 0.01) {
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

    // Determinar sucursal desde la caja (no del perfil del cajero)
    let sucursalDeCaja = null
    if (caja_id) {
      const { data: cajaInfo } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
      sucursalDeCaja = cajaInfo?.sucursal_id || null
    }

    // Prorratear pagos entre items y gift cards cuando es venta mixta
    // La proporción se basa en el monto real (total incluye descuentos ya aplicados)
    const proporcionItems = (tieneGC && total > 0) ? totalItemsSolo / total : 1
    let pagosItems = pagos || []
    let pagosGC = pagos || []
    if (tieneGC && tieneItems) {
      pagosItems = (pagos || []).map(p => ({
        ...p,
        monto: parseFloat((parseFloat(p.monto) * proporcionItems).toFixed(2)),
      }))
      const proporcionGC = totalGCActivar / total
      pagosGC = (pagos || []).map(p => ({
        ...p,
        monto: parseFloat((parseFloat(p.monto) * proporcionGC).toFixed(2)),
      }))
    }

    // Crear ventas_pos: si hay items va con items+total, si solo GC va como venta de GC
    let data = null
    if (!tieneItems && tieneGC) {
      // Solo gift cards desde POS — crear ventas_pos para trazabilidad (no se envía a Centum)
      const totalRealCobradoGC = pagosGC.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
      const gcItems = gift_cards_a_activar.map(gc => ({
        nombre: `Gift Card ${gc.codigo.trim()}`, cantidad: 1, precio_unitario: gc.monto, precio_final: gc.monto, es_gift_card: true,
      }))
      const insertGCOnly = {
        cajero_id: req.perfil.id,
        sucursal_id: sucursalDeCaja || req.perfil.sucursal_id || null,
        caja_id: caja_id || null,
        id_cliente_centum,
        nombre_cliente: nombre_cliente || null,
        subtotal: totalGCActivar,
        descuento_total: 0,
        total: totalRealCobradoGC,
        monto_pagado: totalRealCobradoGC,
        vuelto: 0,
        items: JSON.stringify(gcItems),
        pagos: pagosGC,
        gift_cards_vendidas: gift_cards_a_activar.map(gc => ({
          codigo: gc.codigo.trim(), monto_nominal: gc.monto, comprador: gc.comprador_nombre || null,
        })),
        centum_sync: false, // Gift cards SÍ se sincronizan a Centum como concepto
        condicion_iva: condicion_iva || null,
        ticket_uid: ticket_uid || null,
      }
      if (created_at_offline) insertGCOnly.created_at = created_at_offline

      const { data: ventaGCData, error: ventaGCErr } = await supabase
        .from('ventas_pos')
        .insert(insertGCOnly)
        .select()
        .single()

      if (ventaGCErr) throw ventaGCErr
      data = ventaGCData
    } else if (tieneItems) {
      const montoPagadoItems = tieneGC ? pagosItems.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0) : montoPagadoNum
      const vueltoItems = tieneGC ? 0 : (vuelto || 0) // El vuelto se da una sola vez, va en la parte de items
      const insertData = {
        cajero_id: req.perfil.id,
        sucursal_id: sucursalDeCaja || req.perfil.sucursal_id || null,
        caja_id: caja_id || null,
        id_cliente_centum,
        nombre_cliente: nombre_cliente || null,
        subtotal: subtotal || 0,
        descuento_total: descuento_total || 0,
        total: totalItemsSolo,
        monto_pagado: tieneGC ? montoPagadoItems : montoPagadoNum,
        vuelto: vueltoItems,
        items: JSON.stringify(items),
        promociones_aplicadas: promociones_aplicadas ? JSON.stringify(promociones_aplicadas) : null,
        pagos: tieneGC ? pagosItems : (pagos || []),
        descuento_forma_pago: descuento_forma_pago || null,
        descuento_grupo_cliente: parseFloat(descuento_grupo_cliente) || 0,
        grupo_descuento_nombre: grupo_descuento_nombre || null,
        condicion_iva: condicion_iva || null,
      }
      if (tieneGC) {
        insertData.gift_cards_vendidas = gift_cards_a_activar.map(gc => ({
          codigo: gc.codigo.trim(),
          monto_nominal: gc.monto,
          comprador: gc.comprador_nombre || null,
        }))
      }
      if (ticket_uid) insertData.ticket_uid = ticket_uid
      if (pedido_pos_id) insertData.pedido_pos_id = pedido_pos_id
      if (canal && canal !== 'pos') insertData.canal = canal
      if (created_at_offline) insertData.created_at = created_at_offline
      // GC aplicada como pago: guardar monto para forzar B PRUEBA + NC concepto en Centum
      if (gift_cards_aplicadas && Array.isArray(gift_cards_aplicadas) && gift_cards_aplicadas.length > 0) {
        const totalGCMonto = gift_cards_aplicadas.reduce((s, gc) => s + (parseFloat(gc.monto) || 0), 0)
        if (totalGCMonto > 0) insertData.gc_aplicada_monto = totalGCMonto
      }

      const { data: ventaData, error } = await supabase
        .from('ventas_pos')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error
      data = ventaData

      // Si la venta está vinculada a un pedido, actualizar total_pagado del pedido
      if (pedido_pos_id && data) {
        await supabase
          .from('pedidos_pos')
          .update({ total_pagado: total })
          .eq('id', pedido_pos_id)
      }

      // Registrar cambios de precio (async, no bloquea)
      if (data) {
        const cambiosItems = items.filter(i => i.cambio_precio)
        if (cambiosItems.length > 0) {
          // Buscar cierre activo para la caja
          let cierreId = null
          if (caja_id) {
            const { data: cierreData } = await supabase
              .from('cierres_pos')
              .select('id')
              .eq('caja_id', caja_id)
              .eq('estado', 'abierta')
              .maybeSingle()
            cierreId = cierreData?.id || null
          }
          const registros = cambiosItems.map(i => ({
            venta_pos_id: data.id,
            cierre_id: cierreId,
            cajero_id: req.perfil.id,
            cajero_nombre: req.perfil?.nombre || 'Desconocido',
            caja_id: caja_id || null,
            sucursal_id: sucursalDeCaja || req.perfil.sucursal_id || null,
            articulo_id: i.id_articulo,
            articulo_codigo: i.codigo || null,
            articulo_nombre: i.nombre || null,
            precio_original: i.cambio_precio.precio_original,
            precio_nuevo: i.cambio_precio.precio_nuevo,
            diferencia: i.cambio_precio.precio_nuevo - i.cambio_precio.precio_original,
            cantidad: i.cantidad || 1,
            motivo: i.cambio_precio.motivo,
          }))
          supabase.from('pos_cambios_precio_log').insert(registros)
            .then(({ error: logErr }) => {
              if (logErr) logger.warn('[POS] No se pudo registrar cambios de precio:', logErr.message)
              else logger.info(`[POS] ${registros.length} cambio(s) de precio registrados para venta ${data.id}`)
            })
        }
      }

      // Sync a Centum se hace via cron cada 1 minuto (retrySyncVentasCentum)
      // La venta queda con centum_sync=false y el cron la procesa secuencialmente
      if (data) {
        logger.info(`[Centum POS] Venta ${data.id} guardada con centum_sync=false, será procesada por el cron`)
      }
    }

    const ventaId = data?.id || null

    // Vincular eliminaciones de artículos del mismo ticket (auditoría)
    if (ticket_uid && ventaId && data?.numero_venta) {
      supabase
        .from('pos_eliminaciones_log')
        .update({ venta_pos_id: ventaId, numero_venta: data.numero_venta })
        .eq('ticket_uid', ticket_uid)
        .is('venta_pos_id', null)
        .then(({ error: linkErr }) => {
          if (linkErr) logger.warn('[POS] No se pudo vincular eliminaciones al ticket:', linkErr.message)
        })
    }

    // Registrar movimiento negativo de saldo si se aplicó
    if (saldoApl > 0 && id_cliente_centum) {
      const insertSaldo = {
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        monto: -saldoApl,
        motivo: 'Aplicado en venta',
        venta_pos_id: ventaId,
        created_by: req.perfil.id,
      }
      // Guardar desglose de forma de pago del saldo consumido (enviado por frontend)
      if (saldo_forma_pago_origen && typeof saldo_forma_pago_origen === 'object') {
        // Negar los valores para reflejar consumo
        const consumido = {}
        for (const [k, v] of Object.entries(saldo_forma_pago_origen)) {
          if (v > 0) consumido[k] = -Math.round(v * 100) / 100
        }
        insertSaldo.forma_pago_origen = consumido
      }
      const { error: saldoError } = await supabase
        .from('movimientos_saldo_pos')
        .insert(insertSaldo)
      if (saldoError) {
        logger.error('[POS] Error al registrar movimiento de saldo:', saldoError.message)
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
          const saldoActual = parseFloat(giftCard.saldo)
          const montoDescontar = Math.min(gc.monto, saldoActual)
          const nuevoSaldo = Math.round((saldoActual - montoDescontar) * 100) / 100
          const nuevoEstado = nuevoSaldo <= 0 ? 'agotada' : 'activa'

          // Update atómico: solo actualiza si el saldo no cambió desde que lo leímos
          const { data: updated, error: gcErr } = await supabase
            .from('gift_cards')
            .update({ saldo: Math.max(0, nuevoSaldo), estado: nuevoEstado })
            .eq('id', giftCard.id)
            .eq('saldo', giftCard.saldo)
            .select('id')

          if (gcErr || !updated || updated.length === 0) {
            logger.error(`[POS] Gift card ${gc.codigo} conflicto de concurrencia — saldo cambió durante la operación`)
            continue
          }

          await supabase
            .from('movimientos_gift_card')
            .insert({
              gift_card_id: giftCard.id,
              monto: -montoDescontar,
              motivo: 'Uso en venta',
              venta_pos_id: ventaId,
              created_by: req.perfil.id,
            })
        }
      }
    }

    // Activar gift cards vendidas (NO se incluyen en ventas_pos)
    if (tieneGC) {
      // Prorratear pagosGC entre las gift cards individuales por su monto nominal
      const totalGCNominal = gift_cards_a_activar.reduce((sum, gc) => sum + (parseFloat(gc.monto) || 0), 0)

      for (const gc of gift_cards_a_activar) {
        // Verificar que no exista ya
        const { data: existente } = await supabase
          .from('gift_cards')
          .select('id')
          .eq('codigo', gc.codigo.trim())
          .maybeSingle()

        if (existente) {
          return res.status(400).json({ error: `La gift card ${gc.codigo} ya existe en el sistema` })
        }

        // Prorratear pagosGC entre las GC individuales proporcionalmente a su monto nominal
        const proporcionGCIndividual = totalGCNominal > 0 ? (parseFloat(gc.monto) || 0) / totalGCNominal : 1
        const pagosEstaGC = pagosGC.map(p => ({
          ...p,
          monto: parseFloat((parseFloat(p.monto) * proporcionGCIndividual).toFixed(2)),
        }))

        const { data: giftCard } = await supabase
          .from('gift_cards')
          .insert({
            codigo: gc.codigo.trim(),
            monto_inicial: gc.monto,
            saldo: gc.monto,
            estado: 'activa',
            comprador_nombre: gc.comprador_nombre || null,
            pagos: pagosEstaGC,
            created_by: req.perfil.id,
            caja_id: caja_id || null,
            sucursal_id: sucursalDeCaja || req.perfil.sucursal_id || null,
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

    if (ticket_uid) ventaTicketLock.delete(ticket_uid)
    res.status(201).json({ venta: data, mensaje: tieneItems ? 'Venta registrada correctamente' : 'Gift card activada correctamente' })
  } catch (err) {
    if (ticket_uid) ventaTicketLock.delete(ticket_uid)
    logger.error('[POS] Error al guardar venta:', err.message)
    res.status(500).json({ error: 'Error al guardar venta: ' + err.message })
  }
}))

// GET /api/pos/ventas/reportes/promociones?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Datos crudos de ventas para reporte de promociones (admin/gestor)
router.get('/ventas/reportes/promociones', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const desde = req.query.desde || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const hasta = req.query.hasta || new Date().toISOString().split('T')[0]

    const PAGE_SIZE = 1000
    let allData = []
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('ventas_pos')
        .select('id, items, subtotal, total, descuento_total, promociones_aplicadas, created_at, nombre_cliente, cajero_id, perfiles:cajero_id(nombre)')
        .eq('tipo', 'venta')
        .gte('created_at', `${desde}T00:00:00`)
        .lte('created_at', `${hasta}T23:59:59`)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw error
      if (!data || data.length === 0) break
      allData = allData.concat(data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Resolver empleado del cierre activo para cada venta
    const cajaIdsPromo = [...new Set(allData.map(v => v.caja_id).filter(Boolean))]
    let cierresMapPromo = {}
    if (cajaIdsPromo.length > 0) {
      const { data: cierresPromo } = await supabase
        .from('cierres_pos')
        .select('id, caja_id, created_at, cierre_at, empleado:empleados!empleado_id(nombre)')
        .in('caja_id', cajaIdsPromo)
        .gte('created_at', `${desde}T00:00:00`)
        .order('created_at', { ascending: false })
      if (cierresPromo) cierresMapPromo = cierresPromo
    }

    const ventas = allData.map(v => {
      let empleadoNombre = null
      if (v.caja_id && cierresMapPromo.length > 0) {
        const cierre = cierresMapPromo.find(c =>
          c.caja_id === v.caja_id &&
          c.created_at <= v.created_at &&
          (!c.cierre_at || c.cierre_at >= v.created_at)
        )
        if (cierre?.empleado?.nombre) empleadoNombre = cierre.empleado.nombre
      }
      return {
        ...v,
        cajero_nombre: empleadoNombre || v.perfiles?.nombre || 'Sin nombre',
      }
    })

    res.json({ ventas })
  } catch (err) {
    logger.error('[POS] Error reporte promociones:', err.message)
    res.status(500).json({ error: 'Error al generar reporte de promociones' })
  }
}))

// GET /api/pos/ventas?fecha=YYYY-MM-DD&sucursal_id=X&cajero_id=X&buscar=texto&articulo=texto
// Lista ventas del día con filtros opcionales
router.get('/ventas', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const pageSize = 50
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = supabase
      .from('ventas_pos')
      .select('*, perfiles:cajero_id(nombre), sucursales:sucursal_id(nombre), pedido:pedido_pos_id(id, numero, nombre_cliente)', { count: 'exact' })
      .order('created_at', { ascending: false })

    // Filtro por número de factura (POS o Centum) — tiene prioridad sobre otros filtros
    let numFactura = req.query.numero_factura?.trim()
    if (numFactura) {
      // numero_venta es integer, centum_comprobante es texto tipo "B PV7-2942"
      const esNumero = /^\d+$/.test(numFactura)
      if (esNumero) {
        // Buscar nro exacto en POS, o que el comprobante Centum termine con ese número (después del guión)
        query = query.or(`numero_venta.eq.${numFactura},centum_comprobante.ilike.%-${numFactura}`)
      } else {
        // Normalizar formato Centum: "B00007-00002942" → buscar por letra + PV sin ceros + numero sin ceros
        const matchCentum = numFactura.match(/^([A-Za-z])\s*0*(\d+)-0*(\d+)$/)
        if (matchCentum) {
          const [, letra, pv, num] = matchCentum
          // Buscar tanto el formato normalizado como el original
          query = query.or(`centum_comprobante.ilike.${letra.toUpperCase()} PV${pv}-${num},centum_comprobante.ilike.%${numFactura}%`)
        } else {
          query = query.ilike('centum_comprobante', `%${numFactura}%`)
        }
      }
      query = query.range(from, to)
    }
    // Filtros normales (fecha, cliente, etc.)
    else {
      const buscar = req.query.buscar?.trim()
      if (buscar) {
        const esNumero = /^\d+$/.test(buscar)
        if (esNumero) {
          // Si es número, buscar por numero_venta O nombre_cliente
          query = query.or(`numero_venta.eq.${buscar},nombre_cliente.ilike.%${buscar}%`)
        } else {
          query = query.ilike('nombre_cliente', `%${buscar}%`)
        }
      }
      // Aplicar fecha "desde" si viene (horario Argentina UTC-3)
      if (req.query.fecha) {
        const desde = `${req.query.fecha}T00:00:00-03:00`
        query = query.gte('created_at', desde)
      }
      // Aplicar fecha "hasta" si viene
      if (req.query.fecha_hasta) {
        const hasta = `${req.query.fecha_hasta}T23:59:59-03:00`
        query = query.lte('created_at', hasta)
      }
      // Filtro "Sin Centum": ventas que no fueron creadas en Centum
      if (req.query.sin_centum === '1') {
        query = query.is('centum_comprobante', null)
      }
      // Filtro "Sin CAE": ventas sin número de CAE (clasificacion EMPRESA se filtra en JS)
      if (req.query.sin_cae === '1') {
        query = query.is('numero_cae', null)
      }
      // Filtro "Sin Email": facturas A donde no se envió email (se filtra por centum_comprobante ^A en JS)
      if (req.query.sin_email === '1') {
        query = query.or('email_enviado.is.null,email_enviado.eq.false')
      }
      // Filtro empleados: solo ventas de empleados o solo no-empleados
      if (req.query.filtro_empleado === 'empleados') {
        query = query.ilike('nombre_cliente', 'Empleado:%')
      } else if (req.query.filtro_empleado === 'no_empleados') {
        query = query.not('nombre_cliente', 'ilike', 'Empleado:%')
      }
      // Filtro por tipo (venta / nota_credito)
      if (req.query.tipo === 'nota_credito') {
        query = query.eq('tipo', 'nota_credito')
      } else if (req.query.tipo === 'venta') {
        query = query.neq('tipo', 'nota_credito')
      }
      // Admin siempre trae todo para calcular resumen exacto de lo filtrado
      // Non-admin pagina en SQL si no hay filtros JS
      const articuloFilter = req.query.articulo?.trim()
      const needsJSFilter = articuloFilter || req.query.sin_cae === '1' || req.query.sin_email === '1' || req.query.clasificacion
      if (needsJSFilter || req.perfil.rol === 'admin') {
        query = query.range(0, 9999)
      } else {
        query = query.range(from, to)
      }
    }

    // No-admin solo ve sus ventas (excepto al reportar problema, que necesita ver todas)
    const esProblema = req.query.problema === '1'
    if (req.perfil.rol !== 'admin' && !esProblema) {
      query = query.eq('cajero_id', req.perfil.id)
    } else {
      if (req.query.sucursales) {
        const sucIds = req.query.sucursales.split(',').filter(Boolean)
        if (sucIds.length === 1) query = query.eq('sucursal_id', sucIds[0])
        else if (sucIds.length > 1) query = query.in('sucursal_id', sucIds)
      } else if (req.query.sucursal_id) {
        query = query.eq('sucursal_id', req.query.sucursal_id)
      }
      if (req.query.cajero_id) {
        query = query.eq('cajero_id', req.query.cajero_id)
      }
    }

    const { data, error, count } = await query
    if (error) throw error

    let ventas = data || []

    // Filtro por artículo en JS (items es JSONB, no soporta ilike)
    const articulo = req.query.articulo?.trim()?.toLowerCase()
    let articuloFilterApplied = false
    if (articulo) {
      ventas = ventas.filter(v => {
        const items = (() => { try { return typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || []) } catch { return [] } })()
        return items.some(i => (i.nombre || '').toLowerCase().includes(articulo))
      })
      articuloFilterApplied = true
    }

    // Lookup nombres de cajas (no hay FK en Supabase)
    const cajaIds = [...new Set(ventas.map(v => v.caja_id).filter(Boolean))]
    let cajasMap = {}
    if (cajaIds.length > 0) {
      const { data: cajasData } = await supabase.from('cajas').select('id, nombre, punto_venta_centum').in('id', cajaIds)
      if (cajasData) cajasData.forEach(c => { cajasMap[c.id] = c })
    }
    ventas = ventas.map(v => {
      const caja = v.caja_id && cajasMap[v.caja_id] ? cajasMap[v.caja_id] : null
      return { ...v, cajas: caja ? { nombre: caja.nombre } : null, punto_venta_centum: caja?.punto_venta_centum || null }
    })

    // Clasificar ventas: EMPRESA o PRUEBA
    // Usa condicion_iva guardada en la venta (momento de la venta), no la actual del cliente
    // RI/MT (Factura A) → siempre EMPRESA
    // CF + solo efectivo/saldo/gift_card/cta_cte → PRUEBA
    // CF + pago electrónico → EMPRESA
    const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    // Para NCs: buscar datos de la venta original (pagos + condicion_iva al momento de venta)
    const ncOrigenIds = [...new Set(ventas.filter(v => v.tipo === 'nota_credito' && v.venta_origen_id).map(v => v.venta_origen_id))]
    let origenesMap = {}
    if (ncOrigenIds.length > 0) {
      const { data: origenes } = await supabase
        .from('ventas_pos')
        .select('id, pagos, condicion_iva')
        .in('id', ncOrigenIds)
      if (origenes) origenes.forEach(o => { origenesMap[o.id] = o })
    }
    ventas = ventas.map(v => {
      // Si ya tiene clasificacion guardada de Centum, usarla directamente
      if (v.clasificacion) return v
      // Fallback: calcular para ventas no sincronizadas
      let condIva = v.condicion_iva || 'CF'
      let pagosClasif = Array.isArray(v.pagos) ? v.pagos : []
      // NCs: usar condicion_iva y pagos de la venta original
      if (v.tipo === 'nota_credito' && v.venta_origen_id && origenesMap[v.venta_origen_id]) {
        const origen = origenesMap[v.venta_origen_id]
        if (origen.condicion_iva) condIva = origen.condicion_iva
        pagosClasif = Array.isArray(origen.pagos) ? origen.pagos : []
      }
      const esFacturaA = condIva === 'RI' || condIva === 'MT'
      if (esFacturaA) return { ...v, condicion_iva: condIva, clasificacion: 'EMPRESA' }
      const soloEfectivo = pagosClasif.length === 0 || pagosClasif.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
      return { ...v, condicion_iva: condIva, clasificacion: soloEfectivo ? 'PRUEBA' : 'EMPRESA' }
    })

    // Resolver empleado y cierre activo para cada venta
    if (cajaIds.length > 0) {
      const { data: cierresData } = await supabase
        .from('cierres_pos')
        .select('id, numero, caja_id, apertura_at, cierre_at, empleado:empleados!empleado_id(nombre)')
        .in('caja_id', cajaIds)
        .order('apertura_at', { ascending: false })
      if (cierresData && cierresData.length > 0) {
        ventas = ventas.map(v => {
          if (!v.caja_id) return v
          // Tolerancia de 60s para ventas delivery (se crean fracciones de segundo antes del cierre)
          const ventaTime = new Date(v.created_at).getTime()
          const cierre = cierresData.find(c => {
            if (c.caja_id !== v.caja_id) return false
            const aperturaTime = new Date(c.apertura_at).getTime()
            const cierreTime = c.cierre_at ? new Date(c.cierre_at).getTime() : null
            return aperturaTime <= ventaTime + 60000 &&
              (!cierreTime || cierreTime >= ventaTime - 60000)
          })
          if (!cierre) return v
          return {
            ...v,
            ...(cierre.empleado?.nombre ? { empleado_nombre: cierre.empleado.nombre } : {}),
            cierre_pos_id: cierre.id,
            cierre_pos_numero: cierre.numero || null,
          }
        })
      }
    }

    // Filtro por clasificación
    if (req.query.clasificacion) {
      ventas = ventas.filter(v => v.clasificacion === req.query.clasificacion.toUpperCase())
    }
    // Sin CAE: solo mostrar ventas EMPRESA (prueba nunca tiene CAE)
    if (req.query.sin_cae === '1') {
      ventas = ventas.filter(v => v.clasificacion === 'EMPRESA')
    }
    // Sin Email: solo facturas A cuyo cliente SÍ tiene email (excluir los que no tienen email cargado)
    if (req.query.sin_email === '1') {
      ventas = ventas.filter(v => v.centum_comprobante && /^A\s/.test(v.centum_comprobante))
      // Obtener ids de clientes para verificar cuáles tienen email
      const clienteIds = [...new Set(ventas.map(v => v.id_cliente_centum).filter(Boolean))]
      if (clienteIds.length > 0) {
        const { data: clientes } = await supabase.from('clientes')
          .select('id_centum, email')
          .in('id_centum', clienteIds)
        const clientesConEmail = new Set(
          (clientes || []).filter(c => c.email && c.email.trim()).map(c => c.id_centum)
        )
        ventas = ventas.filter(v => v.id_cliente_centum && clientesConEmail.has(v.id_cliente_centum))
      }
    }

    // Admin siempre trae todo para resumen; JS filters también requieren conteo manual
    const jsFilterApplied = articuloFilterApplied || req.query.sin_cae === '1' || req.query.sin_email === '1' || req.query.clasificacion || req.perfil.rol === 'admin'
    const totalCount = jsFilterApplied ? ventas.length : (count ?? ventas.length)
    const totalPages = Math.ceil(totalCount / pageSize)

    // --- Resumen calculado de TODAS las ventas filtradas (ANTES de paginar) ---
    let resumen = null
    if (req.perfil.rol === 'admin' && !numFactura) {
      let totalVentasR = 0, totalNCR = 0, totalEmpresaR = 0, totalPruebaR = 0, cantVentas = 0, cantNC = 0
      const desgloseMediosR = {}
      ventas.forEach(v => {
        const total = parseFloat(v.total) || 0
        if (v.tipo === 'nota_credito') { totalNCR += total; cantNC++ }
        else { totalVentasR += total; cantVentas++ }
        if (v.clasificacion === 'EMPRESA') totalEmpresaR += total
        else totalPruebaR += total
        const pagos = Array.isArray(v.pagos) ? v.pagos : []
        pagos.forEach(p => {
          const medio = p.medio || 'efectivo'
          desgloseMediosR[medio] = (desgloseMediosR[medio] || 0) + (parseFloat(p.monto) || 0)
        })
      })
      resumen = { totalVentas: totalVentasR, totalNC: totalNCR, totalEmpresa: totalEmpresaR, totalPrueba: totalPruebaR, cantVentas, cantNC, desgloseMedios: desgloseMediosR }
    }

    // Paginación manual post-filtro cuando se filtró en JS
    if (jsFilterApplied) {
      ventas = ventas.slice(from, from + pageSize)
    }

    res.json({ ventas, page, totalPages, totalCount, resumen })
  } catch (err) {
    logger.error('[POS] Error al listar ventas:', err.message)
    res.status(500).json({ error: 'Error al listar ventas' })
  }
}))

// GET /api/pos/ventas/reconciliacion — Legacy (mantener por compat)
router.get('/ventas/reconciliacion', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  // Redirigir al nuevo endpoint
  req.url = req.url.replace('reconciliacion', 'conciliacion')
  router.handle(req, res)
}))

// GET /api/pos/ventas/conciliacion — Cruzar ventas POS vs Centum BI (mejorado)
router.get('/ventas/conciliacion', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { fecha, fecha_hasta, sucursal_id, estado, page: pageStr, page_size: pageSizeStr } = req.query
    if (!fecha) return res.status(400).json({ error: 'Parámetro fecha requerido (YYYY-MM-DD)' })

    const fechaDesde = fecha
    const fechaHasta = fecha_hasta || fecha
    const pageNum = Math.max(1, parseInt(pageStr) || 1)
    const pageSize = Math.min(200, Math.max(10, parseInt(pageSizeStr) || 50))

    // 1. Obtener cajas/PVs (filtrar por sucursal si se pide)
    let cajasQuery = supabase.from('cajas').select('id, punto_venta_centum, sucursal_id, nombre').not('punto_venta_centum', 'is', null)
    if (sucursal_id) cajasQuery = cajasQuery.eq('sucursal_id', sucursal_id)
    const { data: cajas } = await cajasQuery
    const pvsPos = new Set((cajas || []).map(c => c.punto_venta_centum))

    // 2. Obtener sucursales para nombres
    const { data: sucursalesData } = await supabase.from('sucursales').select('id, nombre')
    const sucursalesMap = new Map((sucursalesData || []).map(s => [s.id, s.nombre]))

    // Helper: parsear NumeroDocumento "B00007-00002942" → { pv: 7, num: 2942 }
    function parsearNumeroDocumento(str) {
      if (!str) return null
      const match = str.trim().match(/^[A-Z](\d+)-(\d+)$/)
      if (!match) return null
      return { pv: parseInt(match[1], 10), num: parseInt(match[2], 10) }
    }

    // 3. Consultar Centum BI (detallado con cliente y usuario)
    const ventasCentum = await getVentasCentumDetallado(fechaDesde, fechaHasta)

    // Filtrar por PVs del POS y solo ventas del Usuario API (UsuarioID 1301)
    const USUARIO_API_ID = 1301
    const centumPOS = ventasCentum.filter(v => {
      if (v.UsuarioID !== USUARIO_API_ID) return false
      const parsed = parsearNumeroDocumento(v.NumeroDocumento)
      return parsed && pvsPos.has(parsed.pv)
    })

    // 4. Consultar ventas POS del mismo rango
    let posQuery = supabase
      .from('ventas_pos')
      .select('id, total, centum_sync, id_venta_centum, created_at, nombre_cliente, tipo, sucursal_id, centum_error, centum_comprobante, cajero_id, numero_venta')
      .gte('created_at', `${fechaDesde}T00:00:00-03:00`)
      .lte('created_at', `${fechaHasta}T23:59:59-03:00`)
    if (sucursal_id) posQuery = posQuery.eq('sucursal_id', sucursal_id)
    const { data: ventasPOS, error: posError } = await posQuery
    if (posError) logger.error('[Conciliacion] Error Supabase ventas_pos:', posError.message)

    // Indexar POS por id_venta_centum
    const posPorVentaId = new Map()
    for (const v of (ventasPOS || [])) {
      if (v.id_venta_centum) posPorVentaId.set(v.id_venta_centum, v)
    }

    // Buscar ventas POS faltantes que matchean con Centum pero cayeron fuera del rango de fecha POS
    // (por diferencia de timezone entre FechaDocumento Centum y created_at POS)
    const centumIdsNoMatcheados = centumPOS
      .map(v => v.VentaID)
      .filter(id => !posPorVentaId.has(id))
    if (centumIdsNoMatcheados.length > 0) {
      const { data: ventasPOSExtra } = await supabase
        .from('ventas_pos')
        .select('id, total, centum_sync, id_venta_centum, created_at, nombre_cliente, tipo, sucursal_id, centum_error, centum_comprobante, cajero_id, numero_venta')
        .in('id_venta_centum', centumIdsNoMatcheados)
      for (const v of (ventasPOSExtra || [])) {
        if (v.id_venta_centum && !posPorVentaId.has(v.id_venta_centum)) {
          posPorVentaId.set(v.id_venta_centum, v)
          ventasPOS.push(v)
        }
      }
    }

    // Indexar Centum por VentaID
    const centumPorId = new Map(centumPOS.map(v => [v.VentaID, v]))

    // Tolerancia de matching: <= $1 O <= 0.5%
    function totalesCoinciden(totalPOS, totalCentum) {
      const diff = Math.abs(totalCentum - totalPOS)
      if (diff <= 1) return true
      if (totalPOS > 0 && (diff / totalPOS) <= 0.005) return true
      return false
    }

    // 5. Clasificar todas las filas
    const allRows = []
    const matchedCentumIds = new Set()

    // Recorrer ventas POS
    for (const vp of (ventasPOS || [])) {
      const totalPOS = parseFloat(vp.total) || 0
      const sucNombre = sucursalesMap.get(vp.sucursal_id) || '—'

      if (!vp.centum_sync && !vp.centum_comprobante) {
        // Pendiente de sync
        allRows.push({
          pos_id: vp.id, centum_venta_id: null, status: 'pending_sync', tipo: vp.tipo || 'venta',
          fecha_pos: vp.created_at, numero_venta: vp.numero_venta,
          cliente_pos: vp.nombre_cliente || 'Consumidor Final', sucursal_pos: sucNombre,
          total_pos: totalPOS,
          fecha_centum: null, comprobante: null, cliente_centum: null,
          sucursal_centum: null, division_centum: null, total_centum: null,
          diferencia: null, centum_error: vp.centum_error,
        })
        continue
      }

      if (vp.id_venta_centum && centumPorId.has(vp.id_venta_centum)) {
        // Tiene match en Centum
        const vc = centumPorId.get(vp.id_venta_centum)
        matchedCentumIds.add(vc.VentaID)
        const totalCentum = parseFloat(vc.Total) || 0
        const diff = Math.round((totalCentum - totalPOS) * 100) / 100
        const coincide = totalesCoinciden(totalPOS, totalCentum)

        allRows.push({
          pos_id: vp.id, centum_venta_id: vc.VentaID, status: coincide ? 'matched' : 'mismatch', tipo: vp.tipo || 'venta',
          fecha_pos: vp.created_at, numero_venta: vp.numero_venta,
          cliente_pos: vp.nombre_cliente || 'Consumidor Final', sucursal_pos: sucNombre,
          total_pos: totalPOS,
          fecha_centum: vc.FechaDocumento, comprobante: vc.NumeroDocumento?.trim() || '—',
          cliente_centum: vc.RazonSocialCliente || '—', sucursal_centum: vc.NombreSucursalFisica?.trim() || '—',
          division_centum: vc.DivisionEmpresaGrupoEconomicoID === 2 ? 'PRUEBA' : vc.DivisionEmpresaGrupoEconomicoID === 3 ? 'EMPRESA' : null,
          total_centum: totalCentum, diferencia: diff, centum_error: null,
        })
      } else if (vp.centum_sync && vp.id_venta_centum) {
        // Sync=true pero no encontrada en BI
        allRows.push({
          pos_id: vp.id, centum_venta_id: vp.id_venta_centum, status: 'missing_centum', tipo: vp.tipo || 'venta',
          fecha_pos: vp.created_at, numero_venta: vp.numero_venta,
          cliente_pos: vp.nombre_cliente || 'Consumidor Final', sucursal_pos: sucNombre,
          total_pos: totalPOS,
          fecha_centum: null, comprobante: vp.centum_comprobante || '—',
          cliente_centum: null, sucursal_centum: null, division_centum: null, total_centum: null,
          diferencia: null, centum_error: null,
        })
      } else if (vp.centum_sync && !vp.id_venta_centum) {
        // Sync marcado pero sin ID centum (error de sync)
        allRows.push({
          pos_id: vp.id, centum_venta_id: null, status: 'pending_sync', tipo: vp.tipo || 'venta',
          fecha_pos: vp.created_at, numero_venta: vp.numero_venta,
          cliente_pos: vp.nombre_cliente || 'Consumidor Final', sucursal_pos: sucNombre,
          total_pos: totalPOS,
          fecha_centum: null, comprobante: null, cliente_centum: null,
          sucursal_centum: null, division_centum: null, total_centum: null,
          diferencia: null, centum_error: vp.centum_error,
        })
      }
    }

    // Ventas en Centum sin match en POS (missing_pos / "fantasmas")
    for (const vc of centumPOS) {
      if (matchedCentumIds.has(vc.VentaID)) continue
      // Verificar que no haya match por otro medio
      if (posPorVentaId.has(vc.VentaID)) continue

      const totalCentum = parseFloat(vc.Total) || 0
      const tiposNC = [3, 6, 7, 8]
      allRows.push({
        pos_id: null, centum_venta_id: vc.VentaID, status: 'missing_pos',
        tipo: tiposNC.includes(vc.TipoComprobanteID) ? 'nota_credito' : 'venta',
        fecha_pos: null, numero_venta: null, cliente_pos: null, sucursal_pos: null, total_pos: null,
        fecha_centum: vc.FechaDocumento, comprobante: vc.NumeroDocumento?.trim() || '—',
        cliente_centum: vc.RazonSocialCliente || `ClienteID ${vc.ClienteID}`,
        sucursal_centum: vc.NombreSucursalFisica?.trim() || '—',
        division_centum: vc.DivisionEmpresaGrupoEconomicoID === 2 ? 'PRUEBA' : vc.DivisionEmpresaGrupoEconomicoID === 3 ? 'EMPRESA' : null,
        total_centum: totalCentum, diferencia: null, centum_error: null,
      })
    }

    // 6. KPIs sobre todas las filas (antes de filtrar por estado)
    const kpis = {
      pos: { count: (ventasPOS || []).length, total: (ventasPOS || []).reduce((s, v) => s + (parseFloat(v.total) || 0), 0) },
      centum: { count: centumPOS.length, total: centumPOS.reduce((s, v) => s + (parseFloat(v.Total) || 0), 0) },
      matched: { count: 0, total: 0 },
      mismatch: { count: 0, total_diff: 0 },
      missing_centum: { count: 0, total: 0 },
      missing_pos: { count: 0, total: 0 },
      pending_sync: { count: 0, total: 0 },
    }
    for (const r of allRows) {
      switch (r.status) {
        case 'matched': kpis.matched.count++; kpis.matched.total += r.total_pos || 0; break
        case 'mismatch': kpis.mismatch.count++; kpis.mismatch.total_diff += Math.abs(r.diferencia || 0); break
        case 'missing_centum': kpis.missing_centum.count++; kpis.missing_centum.total += r.total_pos || 0; break
        case 'missing_pos': kpis.missing_pos.count++; kpis.missing_pos.total += r.total_centum || 0; break
        case 'pending_sync': kpis.pending_sync.count++; kpis.pending_sync.total += r.total_pos || 0; break
      }
    }

    // Redondear KPIs
    kpis.pos.total = Math.round(kpis.pos.total * 100) / 100
    kpis.centum.total = Math.round(kpis.centum.total * 100) / 100
    kpis.matched.total = Math.round(kpis.matched.total * 100) / 100
    kpis.mismatch.total_diff = Math.round(kpis.mismatch.total_diff * 100) / 100
    kpis.missing_centum.total = Math.round(kpis.missing_centum.total * 100) / 100
    kpis.missing_pos.total = Math.round(kpis.missing_pos.total * 100) / 100
    kpis.pending_sync.total = Math.round(kpis.pending_sync.total * 100) / 100

    // 7. Filtrar por estado si se pide
    const filtered = estado ? allRows.filter(r => r.status === estado) : allRows

    // Ordenar: problemas primero
    const statusOrder = { pending_sync: 0, missing_centum: 1, mismatch: 2, missing_pos: 3, matched: 4 }
    filtered.sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5))

    // 8. Paginar
    const totalFiltered = filtered.length
    const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
    const rows = filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize)

    res.json({ kpis, rows, page: pageNum, totalPages, totalFiltered })
  } catch (err) {
    logger.error('[POS] Error en conciliación:', err.message)
    res.status(500).json({ error: 'Error al ejecutar conciliación', detalle: err.message })
  }
}))

// GET /api/pos/ventas/duplicados-centum — Detectar facturas duplicadas en Centum BI
router.get('/ventas/duplicados-centum', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    // 1. Traer todos los id_venta_centum conocidos desde ventas_pos (Supabase)
    const PAGE_SIZE = 1000
    let allVentasPos = []
    let from = 0
    while (true) {
      const { data } = await supabase
        .from('ventas_pos')
        .select('id, numero_venta, id_venta_centum, total, nombre_cliente, centum_comprobante')
        .not('id_venta_centum', 'is', null)
        .range(from, from + PAGE_SIZE - 1)
      if (!data || data.length === 0) break
      allVentasPos = allVentasPos.concat(data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Set de VentaIDs "reales" (linkeados a una venta POS)
    const ventaIdsReales = new Set(allVentasPos.map(v => v.id_venta_centum))
    // Map VentaID → venta POS para lookup rápido
    const posPorVentaId = new Map()
    for (const vp of allVentasPos) {
      posPorVentaId.set(vp.id_venta_centum, vp)
    }

    // 2. Traer TODAS las ventas del usuario API desde Centum BI + NCs
    const { ventas: ventasCentum, notasCredito } = await getVentasPOSParaDuplicados()

    // 3. Identificar huérfanos: VentaIDs en Centum que NO están linkeados en ventas_pos
    const huerfanos = ventasCentum.filter(v => !ventaIdsReales.has(v.VentaID))

    // Si no hay huérfanos, no hay duplicados
    if (huerfanos.length === 0) {
      return res.json({
        resumen: { total_duplicados: 0, con_nc: 0, sin_nc: 0, monto_sin_nc: 0 },
        duplicados: [],
      })
    }

    // 4. Para cada huérfano, buscar la venta "real" correspondiente
    //    Criterio: mismo ClienteID + mismo Total + misma SucursalFisicaID + VentaID correlativo
    const MAX_VENTA_ID_DIFF = 50 // VentaIDs duplicados son casi consecutivos
    const ventasRealesCentum = ventasCentum.filter(v => ventaIdsReales.has(v.VentaID))
    // Indexar por ClienteID+SucursalID+Total para matching rápido
    const indexReal = new Map()
    for (const v of ventasRealesCentum) {
      const key = `${v.ClienteID}-${v.SucursalFisicaID}-${parseFloat(v.Total).toFixed(2)}`
      if (!indexReal.has(key)) indexReal.set(key, [])
      indexReal.get(key).push(v)
    }

    // 5. Construir resultado — solo incluir huérfanos con VentaID correlativo a una venta real
    const duplicados = []
    const ncsUsadas = new Set() // Evitar que una NC matchee con múltiples huérfanos
    for (const huerf of huerfanos) {
      const total = parseFloat(huerf.Total)
      const key = `${huerf.ClienteID}-${huerf.SucursalFisicaID}-${total.toFixed(2)}`
      const candidatas = indexReal.get(key) || []

      // Buscar la venta real con VentaID más cercano (correlativo)
      let ventaReal = null
      let ventaPOS = null
      let minIdDiff = Infinity
      for (const c of candidatas) {
        const idDiff = Math.abs(c.VentaID - huerf.VentaID)
        if (idDiff < minIdDiff) {
          minIdDiff = idDiff
          ventaReal = c
          ventaPOS = posPorVentaId.get(c.VentaID)
        }
      }

      // Si no hay venta real con VentaID correlativo, no es duplicado — ignorar
      if (!ventaReal || minIdDiff > MAX_VENTA_ID_DIFF) continue

      // Buscar NC existente para este huérfano
      // NC.Referencia = comprobante sin letra (ej "00002-00000957" para factura "A00002-00000957")
      const numDoc = huerf.NumeroDocumento?.trim()
      // Extraer parte sin letra: "A00002-00000957" → "00002-00000957"
      const refDup = numDoc?.replace(/^[A-Z]/, '') || null

      const ncsDelCliente = notasCredito.filter(nc => nc.ClienteID === huerf.ClienteID && !ncsUsadas.has(nc.VentaID))

      let ncEncontrada = null
      // Match por Referencia = comprobante sin letra
      if (refDup) {
        for (const nc of ncsDelCliente) {
          const ref = nc.Referencia?.toString().trim()
          if (ref === refDup) {
            ncEncontrada = nc
            break
          }
        }
      }
      // Sin fallback — solo match exacto por referencia para evitar falsos positivos

      // Marcar NC como usada para que no matchee con otro huérfano
      if (ncEncontrada) {
        ncsUsadas.add(ncEncontrada.VentaID)
      }

      const divisionId = huerf.DivisionEmpresaGrupoEconomicoID
      duplicados.push({
        pos_id: ventaPOS?.id || null,
        numero_venta_pos: ventaPOS?.numero_venta || null,
        cliente: huerf.RazonSocialCliente?.trim() || 'DESCONOCIDO',
        venta_real: ventaReal ? {
          venta_id: ventaReal.VentaID,
          comprobante: ventaReal.NumeroDocumento?.trim() || null,
          total: parseFloat(ventaReal.Total),
          fecha: ventaReal.FechaCreacion,
        } : null,
        duplicado: {
          venta_id: huerf.VentaID,
          comprobante: numDoc || null,
          total,
          fecha: huerf.FechaCreacion,
          sucursal: huerf.NombreSucursalFisica?.trim() || null,
          division: divisionId === 3 ? 'EMPRESA' : divisionId === 2 ? 'PRUEBA' : `ID${divisionId}`,
        },
        nc_existente: ncEncontrada ? {
          comprobante: ncEncontrada.NumeroDocumento?.trim() || null,
          total: parseFloat(ncEncontrada.Total),
        } : null,
        estado: ncEncontrada ? 'resuelta' : 'pendiente_nc',
      })
    }

    // Ordenar: pendientes primero, luego por monto desc
    duplicados.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'pendiente_nc' ? -1 : 1
      return (b.duplicado?.total || 0) - (a.duplicado?.total || 0)
    })

    const sinNC = duplicados.filter(d => d.estado === 'pendiente_nc')
    const conNC = duplicados.filter(d => d.estado === 'resuelta')

    res.json({
      resumen: {
        total_duplicados: duplicados.length,
        con_nc: conNC.length,
        sin_nc: sinNC.length,
        monto_sin_nc: Math.round(sinNC.reduce((s, d) => s + (d.duplicado?.total || 0), 0) * 100) / 100,
      },
      duplicados,
    })
  } catch (err) {
    logger.error('[POS] Error en duplicados-centum:', err.message)
    res.status(500).json({ error: 'Error al detectar duplicados', detalle: err.message })
  }
}))

// GET /api/pos/ventas/resumen-centum — resumen de ventas desde Centum BI para comparar con POS
router.get('/ventas/resumen-centum', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { fecha, fecha_hasta, sucursales: sucursalesParam, clasificacion } = req.query
    if (!fecha) return res.status(400).json({ error: 'Falta parámetro fecha' })
    const hasta = fecha_hasta || fecha

    // Resolver sucursales POS → sucursalFisicaId Centum
    // Si no se filtra por sucursal, usar TODAS las sucursales POS (Centum tiene más sucursales que POS)
    let sucursalIds = null
    const sucFiltro = sucursalesParam ? sucursalesParam.split(',').filter(Boolean) : []
    if (sucFiltro.length > 0) {
      const { data: sucs } = await supabase
        .from('sucursales')
        .select('centum_sucursal_id')
        .in('id', sucFiltro)
        .not('centum_sucursal_id', 'is', null)
      if (sucs?.length) sucursalIds = sucs.map(s => s.centum_sucursal_id).filter(Boolean)
    } else {
      // Solo sucursales que tienen cajas POS configuradas
      const { data: cajas } = await supabase.from('cajas').select('sucursal_id')
      const sucConCaja = [...new Set((cajas || []).map(c => c.sucursal_id).filter(Boolean))]
      if (sucConCaja.length) {
        const { data: allSucs } = await supabase
          .from('sucursales')
          .select('centum_sucursal_id')
          .in('id', sucConCaja)
          .not('centum_sucursal_id', 'is', null)
        if (allSucs?.length) sucursalIds = allSucs.map(s => s.centum_sucursal_id).filter(Boolean)
      }
    }

    // Clasificación: EMPRESA=3, PRUEBA=2
    let divisionId = null
    if (clasificacion === 'EMPRESA') divisionId = 3
    else if (clasificacion === 'PRUEBA') divisionId = 2

    const resumen = await getResumenVentasCentumBI(fecha, hasta, sucursalIds, divisionId)
    res.json(resumen)
  } catch (err) {
    logger.error('[POS] Error al obtener resumen Centum BI:', err.message)
    res.status(500).json({ error: 'Error al consultar Centum BI' })
  }
}))

// GET /api/pos/ventas/auditoria-centum — Lista paginada de ventas Centum BI (Usuario Api)
router.get('/ventas/auditoria-centum', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { fecha, fecha_hasta, sucursales: sucursalesParam, clasificacion, tipo, buscar, numero_factura, page: pageParam } = req.query
    if (!fecha) return res.status(400).json({ error: 'Falta parámetro fecha' })
    const hasta = fecha_hasta || fecha
    const page = parseInt(pageParam) || 1

    // Resolver sucursales POS → centum_sucursal_id
    let sucursalIds = null
    const sucFiltro = sucursalesParam ? sucursalesParam.split(',').filter(Boolean) : []
    if (sucFiltro.length > 0) {
      const { data: sucs } = await supabase
        .from('sucursales')
        .select('centum_sucursal_id')
        .in('id', sucFiltro)
        .not('centum_sucursal_id', 'is', null)
      if (sucs?.length) sucursalIds = sucs.map(s => s.centum_sucursal_id).filter(Boolean)
    } else {
      const { data: cajas } = await supabase.from('cajas').select('sucursal_id')
      const sucConCaja = [...new Set((cajas || []).map(c => c.sucursal_id).filter(Boolean))]
      if (sucConCaja.length) {
        const { data: allSucs } = await supabase
          .from('sucursales')
          .select('centum_sucursal_id')
          .in('id', sucConCaja)
          .not('centum_sucursal_id', 'is', null)
        if (allSucs?.length) sucursalIds = allSucs.map(s => s.centum_sucursal_id).filter(Boolean)
      }
    }

    let divisionId = null
    if (clasificacion === 'EMPRESA') divisionId = 3
    else if (clasificacion === 'PRUEBA') divisionId = 2

    // Tipo comprobante: factura vs nota_credito
    const tiposNC = [3, 6, 7, 8]
    let tiposComprobante = null
    if (tipo === 'nota_credito') tiposComprobante = tiposNC
    // Para "factura" usamos exclusión, pero la función acepta IN, así que usamos los tipos de factura
    else if (tipo === 'factura') tiposComprobante = [1, 4, 2, 5, 9, 10, 11] // todos excepto NC

    const [listResult, resumen] = await Promise.all([
      getVentasCentumPaginado(fecha, hasta, {
        sucursalIds, divisionId, tiposComprobante,
        buscarCliente: buscar || null,
        buscarNumero: numero_factura || null,
        page, pageSize: 50,
      }),
      getResumenVentasCentumBI(fecha, hasta, sucursalIds, divisionId, 1301),
    ])

    const { ventas, totalCount } = listResult
    res.json({
      ventas,
      page,
      totalPages: Math.ceil(totalCount / 50),
      totalCount,
      resumen,
    })
  } catch (err) {
    logger.error('[POS] Error en auditoría Centum:', err.message)
    res.status(500).json({ error: 'Error al consultar Centum BI' })
  }
}))

// GET /api/pos/ventas/auditoria-centum/:ventaId — Detalle completo de una venta Centum BI
router.get('/ventas/auditoria-centum/:ventaId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const ventaId = parseInt(req.params.ventaId)
    if (!ventaId || isNaN(ventaId)) return res.status(400).json({ error: 'VentaID inválido' })

    const venta = await getVentaCentumDetalle(ventaId)
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada en Centum BI' })

    res.json({ venta })
  } catch (err) {
    logger.error('[POS] Error en detalle auditoría Centum:', err.message)
    res.status(500).json({ error: 'Error al consultar Centum BI' })
  }
}))

// GET /api/pos/ventas/:id — Detalle de una venta
router.get('/ventas/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ventas_pos')
      .select('*, perfiles:cajero_id(nombre), sucursales:sucursal_id(nombre), pedido:pedido_pos_id(id, numero, nombre_cliente, tipo, observaciones, fecha_entrega, turno_entrega, total_pagado, sucursal_id, estado, created_at, venta_anticipada_id)')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' })

    // No-admin solo puede ver sus propias ventas
    if (req.perfil.rol !== 'admin' && data.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta venta' })
    }

    // Resolver empleado y cierre activo (más relevante que el usuario logueado)
    if (data.caja_id && data.created_at) {
      const { data: cierre } = await supabase
        .from('cierres_pos')
        .select('id, numero, empleado:empleados!empleado_id(id, nombre)')
        .eq('caja_id', data.caja_id)
        .lte('created_at', data.created_at)
        .or('cierre_at.is.null,cierre_at.gte.' + data.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cierre?.empleado?.nombre) {
        data.empleado_nombre = cierre.empleado.nombre
      }
      if (cierre?.id) {
        data.cierre_id = cierre.id
        data.cierre_numero = cierre.numero
      }
    }

    // Si la venta viene de un pedido, traer info de guía de delivery
    if (data.pedido?.id) {
      const { data: gdp } = await supabase
        .from('guia_delivery_pedidos')
        .select('id, forma_pago, monto, estado_entrega, guia:guias_delivery(id, fecha, turno, cadete_nombre, estado, despachada_at, cerrada_at)')
        .eq('pedido_pos_id', data.pedido.id)
        .limit(1)
        .maybeSingle()
      if (gdp) {
        data.pedido.guia_delivery = {
          forma_pago: gdp.forma_pago,
          monto: gdp.monto,
          estado_entrega: gdp.estado_entrega,
          ...gdp.guia,
        }
      }
      // Resolver nombre de sucursal del pedido
      if (data.pedido.sucursal_id) {
        const { data: sucPedido } = await supabase.from('sucursales').select('nombre').eq('id', data.pedido.sucursal_id).single()
        if (sucPedido) data.pedido.sucursal_nombre = sucPedido.nombre
      }
      // Si tiene venta anticipada distinta a esta venta, traer info básica
      if (data.pedido.venta_anticipada_id && data.pedido.venta_anticipada_id !== data.id) {
        const { data: ventaAnt } = await supabase.from('ventas_pos').select('id, pagos, total, created_at, centum_comprobante').eq('id', data.pedido.venta_anticipada_id).single()
        if (ventaAnt) data.pedido.venta_anticipada = ventaAnt
      }
    }

    // Gift card: respuesta simplificada (no necesita clasificación Centum)
    const itemsCheck = (() => {
      try { return typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || []) }
      catch { return [] }
    })()
    if (itemsCheck.length > 0 && itemsCheck.every(it => it.es_gift_card === true)) {
      data.clasificacion = 'GIFT_CARD'
      if (data.caja_id) {
        const { data: caja } = await supabase.from('cajas').select('nombre').eq('id', data.caja_id).single()
        data.cajas = caja ? { nombre: caja.nombre } : null
      }
      return res.json({ venta: data })
    }

    // Clasificar: EMPRESA o PRUEBA — usar condicion_iva guardada en la venta
    let condIva = data.condicion_iva || 'CF'
    let idClienteCentum = data.id_cliente_centum
    let pagosClasif = Array.isArray(data.pagos) ? data.pagos : []
    // NCs: usar condicion_iva, pagos e id_cliente de la venta original si la NC no tiene
    if (data.tipo === 'nota_credito' && data.venta_origen_id) {
      const { data: ventaOrigen } = await supabase.from('ventas_pos').select('pagos, condicion_iva, id_cliente_centum').eq('id', data.venta_origen_id).maybeSingle()
      if (ventaOrigen) {
        if (ventaOrigen.condicion_iva) condIva = ventaOrigen.condicion_iva
        pagosClasif = Array.isArray(ventaOrigen.pagos) ? ventaOrigen.pagos : []
        if (!idClienteCentum && ventaOrigen.id_cliente_centum) idClienteCentum = ventaOrigen.id_cliente_centum
      }
    }
    if (idClienteCentum) {
      const { data: cli } = await supabase.from('clientes').select('condicion_iva, email, cuit, razon_social, direccion, localidad, telefono, codigo').eq('id_centum', idClienteCentum).single()
      if (cli?.email) data.email_cliente = cli.email
      if (cli) data.cliente_info = {
        cuit: cli.cuit, razon_social: cli.razon_social, direccion: cli.direccion,
        localidad: cli.localidad, telefono: cli.telefono, email: cli.email,
        condicion_iva: cli.condicion_iva, codigo: cli.codigo,
      }
    }
    const esFacturaA = condIva === 'RI' || condIva === 'MT'
    const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivo = pagosClasif.length === 0 || pagosClasif.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
    data.clasificacion = esFacturaA ? 'EMPRESA' : (soloEfectivo ? 'PRUEBA' : 'EMPRESA')

    // Lookup caja (no hay FK)
    if (data.caja_id) {
      const { data: caja } = await supabase.from('cajas').select('nombre').eq('id', data.caja_id).single()
      data.cajas = caja ? { nombre: caja.nombre } : null
    }

    // Info del incidente: venta origen, NCs hijas, movimiento de saldo, venta nueva (corrección)
    // 1. Si esta venta tiene venta_origen_id → traer la venta original
    if (data.venta_origen_id) {
      const { data: origen } = await supabase
        .from('ventas_pos')
        .select('id, numero_venta, nombre_cliente, centum_comprobante, tipo, total, created_at')
        .eq('id', data.venta_origen_id)
        .single()
      data.venta_origen = origen || null
    }

    // 2. Traer NCs/hijas + movimiento saldo en paralelo
    const [hijasRes, movSaldoRes] = await Promise.all([
      supabase
        .from('ventas_pos')
        .select('id, numero_venta, nombre_cliente, centum_comprobante, tipo, total, created_at')
        .eq('venta_origen_id', data.id)
        .order('created_at', { ascending: true }),
      data.tipo === 'nota_credito'
        ? supabase
            .from('movimientos_saldo_pos')
            .select('id, monto, motivo, nombre_cliente, id_cliente_centum, created_at')
            .eq('venta_pos_id', data.id)
            .single()
        : Promise.resolve({ data: null }),
    ])
    data.ventas_relacionadas = hijasRes.data || []
    data.movimiento_saldo = movSaldoRes.data || null

    // Si es NC de corrección cliente, buscar la venta nueva (hermana con tipo=venta y mismo venta_origen_id)
    if (data.tipo === 'nota_credito' && data.venta_origen_id && !data.movimiento_saldo) {
      const { data: ventaNueva } = await supabase
        .from('ventas_pos')
        .select('id, numero_venta, nombre_cliente, centum_comprobante, tipo, total, created_at')
        .eq('venta_origen_id', data.venta_origen_id)
        .eq('tipo', 'venta')
        .single()
      data.venta_nueva_correccion = ventaNueva || null
    }

    // Si es venta de empleado y los items no tienen descuento_pct, enriquecer desde ventas_empleados
    const esEmpleado = (data.nombre_cliente || '').startsWith('Empleado:')
    if (esEmpleado) {
      let itemsParsed = (() => { try { return typeof data.items === 'string' ? JSON.parse(data.items) : (data.items || []) } catch { return [] } })()
      const faltaDesc = itemsParsed.length > 0 && !itemsParsed.some(it => it.descuento_pct > 0)
      if (faltaDesc) {
        // Buscar en ventas_empleados por fecha cercana y total igual
        const { data: ventaEmp } = await supabase
          .from('ventas_empleados')
          .select('items')
          .eq('total', data.total)
          .gte('created_at', new Date(new Date(data.created_at).getTime() - 60000).toISOString())
          .lte('created_at', new Date(new Date(data.created_at).getTime() + 60000).toISOString())
          .limit(1)
          .single()
        if (ventaEmp?.items) {
          const empItems = (() => { try { return typeof ventaEmp.items === 'string' ? JSON.parse(ventaEmp.items) : ventaEmp.items } catch { return [] } })()
          // Enriquecer cada item con precio_original y descuento_pct
          for (const item of itemsParsed) {
            const match = empItems.find(ei => String(ei.articulo_id || ei.id_articulo) === String(item.id_articulo) && ei.codigo === item.codigo)
            if (match && match.descuento_pct > 0) {
              item.precio_original = match.precio_original
              item.descuento_pct = match.descuento_pct
            }
          }
          data.items = typeof data.items === 'string' ? JSON.stringify(itemsParsed) : itemsParsed
        }
      }
    }

    // Buscar saldo aplicado en esta venta (movimiento negativo con motivo "Aplicado en venta")
    if (!data.saldo_aplicado && data.tipo !== 'nota_credito') {
      const { data: movSaldo } = await supabase
        .from('movimientos_saldo_pos')
        .select('monto')
        .eq('venta_pos_id', data.id)
        .lt('monto', 0)
        .maybeSingle()
      if (movSaldo) {
        data.saldo_aplicado = Math.abs(movSaldo.monto)
      }
    }

    // Si la venta usó saldo, buscar la(s) NC que generaron ese saldo
    const saldoAplicadoFinal = parseFloat(data.saldo_aplicado) || 0
    if (saldoAplicadoFinal > 0 && data.id_cliente_centum) {
      // Buscar movimientos positivos (NCs) del mismo cliente que tienen venta_pos_id (la NC)
      const { data: movsPositivos } = await supabase
        .from('movimientos_saldo_pos')
        .select('venta_pos_id, monto, motivo, created_at')
        .eq('id_cliente_centum', data.id_cliente_centum)
        .gt('monto', 0)
        .not('venta_pos_id', 'is', null)
        .order('created_at', { ascending: false })
      if (movsPositivos && movsPositivos.length > 0) {
        // Obtener las NCs referenciadas
        const ncIds = [...new Set(movsPositivos.map(m => m.venta_pos_id))]
        const { data: ncs } = await supabase
          .from('ventas_pos')
          .select('id, numero_venta, total, created_at, venta_origen_id, centum_comprobante')
          .in('id', ncIds)
          .eq('tipo', 'nota_credito')
          .order('created_at', { ascending: false })
        if (ncs && ncs.length > 0) {
          // Para cada NC, obtener la venta origen (factura original)
          const origenIds = [...new Set(ncs.filter(nc => nc.venta_origen_id).map(nc => nc.venta_origen_id))]
          let ventasOrigen = []
          if (origenIds.length > 0) {
            const { data: origenes } = await supabase
              .from('ventas_pos')
              .select('id, numero_venta, total, created_at, centum_comprobante, nombre_cliente')
              .in('id', origenIds)
            ventasOrigen = origenes || []
          }
          data.saldo_notas_credito = ncs.map(nc => ({
            id: nc.id,
            numero_venta: nc.numero_venta,
            total: nc.total,
            centum_comprobante: nc.centum_comprobante,
            created_at: nc.created_at,
            venta_origen: ventasOrigen.find(v => v.id === nc.venta_origen_id) || null,
          }))
        }
      }
    }

    res.json({ venta: data })
  } catch (err) {
    logger.error('[POS] Error al obtener detalle de venta:', err.message)
    res.status(500).json({ error: 'Error al obtener detalle de venta' })
  }
}))

// POST /api/pos/ventas/sync-caes — buscar CAE para ventas EMPRESA que aún no tienen
router.post('/ventas/sync-caes', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const result = await retrySyncCAE()
    res.json(result)
  } catch (err) {
    logger.error('[POS] Error al sincronizar CAEs:', err.message)
    res.status(500).json({ error: 'Error al sincronizar CAEs' })
  }
}))

// POST /api/pos/ventas/refresh-comprobantes — re-consulta Centum y corrige PV/número
router.post('/ventas/refresh-comprobantes', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: ventas } = await supabase.from('ventas_pos')
      .select('id, id_venta_centum, centum_comprobante')
      .eq('centum_sync', true)
      .not('id_venta_centum', 'is', null)
      .gte('created_at', hace7d)
      .limit(50)

    if (!ventas || ventas.length === 0) return res.json({ actualizadas: 0 })

    let actualizadas = 0
    let limpiadas = 0
    for (const v of ventas) {
      try {
        const centumData = await obtenerVentaCentum(v.id_venta_centum)
        const numDoc = centumData?.NumeroDocumento
        if (numDoc && numDoc.PuntoVenta && numDoc.Numero) {
          const comprobanteReal = `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
          if (comprobanteReal !== v.centum_comprobante) {
            const updates = { centum_comprobante: comprobanteReal }
            if (centumData.CAE) updates.numero_cae = centumData.CAE
            await supabase.from('ventas_pos').update(updates).eq('id', v.id)
            logger.info(`[RefreshComprobantes] Venta ${v.id}: ${v.centum_comprobante} → ${comprobanteReal}`)
            actualizadas++
          }
        }
      } catch (e) {
        // Venta no encontrada en Centum — limpiar datos falsos
        if (e.message?.includes('no encontrada')) {
          await supabase.from('ventas_pos').update({
            id_venta_centum: null, centum_comprobante: null,
            centum_sync: false, centum_error: 'Venta no existe en Centum', numero_cae: null,
          }).eq('id', v.id)
          logger.info(`[RefreshComprobantes] Venta ${v.id}: NO existe en Centum, limpiada`)
          limpiadas++
        } else {
          logger.warn(`[RefreshComprobantes] Error venta ${v.id}:`, e.message)
        }
      }
    }
    res.json({ revisadas: ventas.length, actualizadas, limpiadas })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/pos/ventas/:id/cae — obtener CAE de AFIP desde Centum
router.get('/ventas/:id/cae', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: venta, error } = await supabase
      .from('ventas_pos')
      .select('id, id_venta_centum, centum_comprobante, id_cliente_centum, pagos')
      .eq('id', req.params.id)
      .single()

    if (error || !venta) return res.status(404).json({ error: 'Venta no encontrada' })

    // Si no hay id_venta_centum, no podemos consultar Centum
    if (!venta.id_venta_centum) {
      return res.json({ cae: null, cae_vencimiento: null, comprobante: venta.centum_comprobante, mensaje: 'Venta no registrada en Centum' })
    }

    // Obtener datos del cliente para determinar tipo factura y para el comprobante
    let cliente = null
    let condIva = 'CF'
    if (venta.id_cliente_centum && venta.id_cliente_centum > 0) {
      const { data: cli } = await supabase.from('clientes')
        .select('razon_social, cuit, direccion, localidad, codigo_postal, telefono, condicion_iva, codigo')
        .eq('id_centum', venta.id_cliente_centum).single()
      if (cli) {
        condIva = cli.condicion_iva || 'CF'
        cliente = cli
      }
    }
    const esFacturaA = condIva === 'RI' || condIva === 'MT'
    const pagos = Array.isArray(venta.pagos) ? venta.pagos : []
    const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
    const esPrueba = !esFacturaA && soloEfectivo

    const baseResponse = { comprobante: venta.centum_comprobante, esFacturaA, cliente }

    if (esPrueba) {
      return res.json({ ...baseResponse, cae: null, cae_vencimiento: null, mensaje: 'Factura manual (División Prueba) - sin CAE' })
    }

    // Consultar Centum REST API para obtener CAE (solo funciona para factura electrónica / div 3)
    const centumData = await obtenerVentaCentum(venta.id_venta_centum)

    const cae = centumData.CAE || null
    const caeVto = centumData.FechaVencimientoCAE || null

    // Actualizar comprobante real y CAE en la DB
    const numDocReal = centumData?.NumeroDocumento
    const updates = {}
    if (cae) updates.numero_cae = cae
    if (numDocReal && numDocReal.PuntoVenta && numDocReal.Numero) {
      updates.centum_comprobante = `${numDocReal.LetraDocumento || ''} PV${numDocReal.PuntoVenta}-${numDocReal.Numero}`
      baseResponse.comprobante = updates.centum_comprobante
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('ventas_pos').update(updates).eq('id', venta.id)
    }

    res.json({ ...baseResponse, cae, cae_vencimiento: caeVto })
  } catch (err) {
    logger.error('[POS] Error al obtener CAE:', err.message)
    res.status(500).json({ error: 'Error al obtener CAE: ' + err.message })
  }
}))

// POST /api/pos/ventas/:id/enviar-email — enviar comprobante por email
router.post('/ventas/:id/enviar-email', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { email } = req.body
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email requerido' })
    }

    // Obtener venta completa
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_pos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (ventaErr || !venta) return res.status(404).json({ error: 'Venta no encontrada' })

    // Obtener datos CAE y cliente (misma lógica que /cae)
    let caeData = { cae: null, cae_vencimiento: null, esFacturaA: false, cliente: null }
    if (venta.id_cliente_centum && venta.id_cliente_centum > 0) {
      const { data: cli } = await supabase.from('clientes')
        .select('razon_social, cuit, direccion, localidad, codigo_postal, telefono, condicion_iva, codigo')
        .eq('id_centum', venta.id_cliente_centum).single()
      if (cli) {
        const condIva = cli.condicion_iva || 'CF'
        caeData.esFacturaA = condIva === 'RI' || condIva === 'MT'
        caeData.cliente = cli
      }
    }

    // Obtener CAE si tiene factura en Centum (solo div empresa)
    if (venta.id_venta_centum) {
      const pagos = Array.isArray(venta.pagos) ? venta.pagos : []
      const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
      const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
      const esPrueba = !caeData.esFacturaA && soloEfectivo
      if (!esPrueba) {
        try {
          const centumData = await obtenerVentaCentum(venta.id_venta_centum)
          caeData.cae = centumData.CAE || null
          caeData.cae_vencimiento = centumData.FechaVencimientoCAE || null
        } catch (err) {
          logger.error('[Email] Error obteniendo CAE:', err.message)
        }
      }
    }

    // Validar: solo comprobantes de EMPRESA con CAE
    const pagosVal = Array.isArray(venta.pagos) ? venta.pagos : []
    const tiposEfVal = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivoVal = pagosVal.length === 0 || pagosVal.every(p => tiposEfVal.includes((p.tipo || '').toLowerCase()))
    const esPruebaVal = !caeData.esFacturaA && soloEfectivoVal
    if (esPruebaVal) {
      return res.status(400).json({ error: 'Solo se pueden enviar por email comprobantes de división Empresa' })
    }
    if (!caeData.cae) {
      return res.status(400).json({ error: 'Solo se pueden enviar por email comprobantes que tengan CAE' })
    }

    // Generar link de descarga
    const esNC = venta.tipo === 'nota_credito'
    const tipoDoc = esNC ? 'Nota de Crédito' : 'Comprobante'
    const numDoc = venta.centum_comprobante || `#${venta.numero_venta || ''}`
    const linkPDF = generarLinkDescarga(req.params.id)

    // Enviar email con link de descarga
    const { enviarEmail } = require('../services/email')
    await enviarEmail({
      to: email.trim(),
      subject: `${tipoDoc} ${numDoc} - Almacen Zaatar`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <p>Estimado/a <strong>${escapeHtml(venta.nombre_cliente || 'Cliente')}</strong>,</p>
        <p>Su ${esNC ? 'nota de crédito' : 'comprobante de compra'} está disponible para descargar.</p>
        <p style="color:#555;font-size:13px">Número: <strong>${escapeHtml(numDoc)}</strong><br>
        Fecha: ${new Date(venta.created_at).toLocaleDateString('es-AR')}<br>
        Total: <strong>$${parseFloat(venta.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></p>
        <div style="text-align:center;margin:25px 0">
          <a href="${linkPDF}" style="background:#7c3aed;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">Descargar ${tipoDoc} PDF</a>
        </div>
        <p style="font-size:11px;color:#999;text-align:center">Si el botón no funciona, copiá y pegá este link en tu navegador:<br>
        <a href="${linkPDF}" style="color:#7c3aed;word-break:break-all">${linkPDF}</a></p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
        <p style="font-size:11px;color:#999">Comercial Padano SRL - Brasil 313, Rosario<br>
        Este email fue enviado desde un sistema automatizado. No responder a esta dirección.</p>
      </div>`,
    })

    // Marcar email enviado en la venta
    await supabase.from('ventas_pos').update({
      email_enviado: true,
      email_enviado_a: email.trim(),
      email_enviado_at: new Date().toISOString()
    }).eq('id', req.params.id)

    res.json({ ok: true, mensaje: `Comprobante enviado a ${email.trim()}` })
  } catch (err) {
    logger.error('[POS] Error al enviar email:', err.message)
    res.status(500).json({ error: 'Error al enviar email: ' + err.message })
  }
}))

function escapeHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// DELETE /api/pos/ventas/:id — eliminar venta no sincronizada con Centum (solo admin)
router.delete('/ventas/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_pos')
      .select('id, centum_sync, centum_comprobante, tipo, venta_origen_id')
      .eq('id', req.params.id)
      .single()

    if (ventaErr || !venta) return res.status(404).json({ error: 'Venta no encontrada' })

    if (venta.centum_sync || venta.centum_comprobante) {
      return res.status(400).json({ error: 'No se puede eliminar una venta ya sincronizada con Centum' })
    }

    // Si es una NC, eliminar también el movimiento de saldo asociado
    if (venta.tipo === 'nota_credito') {
      await supabase
        .from('movimientos_saldo_pos')
        .delete()
        .eq('venta_pos_id', venta.id)
    }

    // Eliminar NC hijas que tampoco estén sincronizadas
    const { data: ncHijas } = await supabase
      .from('ventas_pos')
      .select('id, centum_sync, centum_comprobante')
      .eq('venta_origen_id', venta.id)
      .eq('tipo', 'nota_credito')

    if (ncHijas) {
      for (const nc of ncHijas) {
        if (!nc.centum_sync && !nc.centum_comprobante) {
          await supabase.from('movimientos_saldo_pos').delete().eq('venta_pos_id', nc.id)
          await supabase.from('ventas_pos').delete().eq('id', nc.id)
        }
      }
    }

    // Eliminar movimientos de gift card asociados
    await supabase.from('movimientos_gift_card').delete().eq('venta_pos_id', req.params.id)

    const { error: delErr } = await supabase
      .from('ventas_pos')
      .delete()
      .eq('id', req.params.id)

    if (delErr) throw delErr

    res.json({ ok: true })
  } catch (err) {
    logger.error('[POS] Error al eliminar venta:', err.message, err.details || '', err.hint || '')
    res.status(500).json({ error: 'Error al eliminar venta', detalle: err.message })
  }
}))

// GET /api/pos/ventas/:id/devoluciones — cantidades ya devueltas por item
router.get('/ventas/:id/devoluciones', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: ncPrevias } = await supabase
      .from('ventas_pos')
      .select('items')
      .eq('venta_origen_id', req.params.id)
      .eq('tipo', 'nota_credito')

    const yaDevuelto = {} // { indice: cantidadDevuelta }
    if (ncPrevias) {
      for (const nc of ncPrevias) {
        const ncItems = (() => { try { return typeof nc.items === 'string' ? JSON.parse(nc.items) : (nc.items || []) } catch { return [] } })()
        for (const ncItem of ncItems) {
          if (ncItem.indice_original != null) {
            yaDevuelto[ncItem.indice_original] = (yaDevuelto[ncItem.indice_original] || 0) + (ncItem.cantidad || 0)
          }
        }
      }
    }

    res.json({ ya_devuelto: yaDevuelto })
  } catch (err) {
    logger.error('[POS] Error al obtener devoluciones:', err.message)
    res.status(500).json({ error: 'Error al obtener devoluciones' })
  }
}))

// ============ PEDIDOS POS ============

// POST /api/pos/pedidos — crear pedido (carrito guardado para retiro posterior)
router.post('/pedidos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, items, total, observaciones, tipo, direccion_entrega, sucursal_retiro, estado, fecha_entrega, total_pagado, turno_entrega, sucursal_id, tarjeta_regalo, observaciones_pedido, cajero_nombre, pagos_anticipado, caja_cobro_id } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items es requerido' })
    }

    // No permitir pedidos sin cliente real
    if (!id_cliente_centum || id_cliente_centum === 0) {
      return res.status(400).json({ error: 'Debe seleccionar un cliente para crear un pedido' })
    }

    // Validar: productos perecederos no pueden tener fecha de entrega > mañana
    if (fecha_entrega) {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const manana = new Date()
      manana.setDate(manana.getDate() + 1)
      const mananaISO = manana.toISOString().split('T')[0]
      const tienePerecedor = items.some(i => {
        const rubro = (i.rubro || '').toLowerCase()
        return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
      })
      if (tienePerecedor && fecha_entrega > mananaISO) {
        return res.status(400).json({ error: 'Los pedidos con Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana' })
      }
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
      sucursal_id: sucursal_id || req.perfil.sucursal_id || null,
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
      turno_entrega: turno_entrega || null,
    }
    if (total_pagado) insertData.total_pagado = total_pagado
    if (tarjeta_regalo?.trim()) insertData.tarjeta_regalo = tarjeta_regalo.trim()
    if (observaciones_pedido?.trim()) insertData.observaciones_pedido = observaciones_pedido.trim()
    if (cajero_nombre?.trim()) {
      insertData.cajero_nombre = cajero_nombre.trim()
    } else {
      // Buscar empleado del cierre activo
      const { data: cierreAbierto } = await supabase
        .from('cierres_pos')
        .select('empleado:empleados!empleado_id(nombre)')
        .eq('cajero_id', req.perfil.id)
        .is('cierre_at', null)
        .order('apertura_at', { ascending: false })
        .limit(1)
      if (cierreAbierto?.[0]?.empleado?.nombre) {
        insertData.cajero_nombre = cierreAbierto[0].empleado.nombre
      }
    }

    const { data, error } = await supabase
      .from('pedidos_pos')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    // Si hay pagos anticipados reales, crear venta_pos en la caja del cobrador
    let ventaAnticipada = null
    if (data && pagos_anticipado && Array.isArray(pagos_anticipado) && pagos_anticipado.length > 0 && (parseFloat(total_pagado) || 0) > 0) {
      try {
        // Obtener sucursal de la caja del cobrador
        let sucursalCaja = null
        if (caja_cobro_id) {
          const { data: cajaInfo } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_cobro_id).single()
          sucursalCaja = cajaInfo?.sucursal_id || null
        }

        const { data: venta, error: errVenta } = await supabase
          .from('ventas_pos')
          .insert({
            cajero_id: req.perfil.id,
            sucursal_id: sucursalCaja || req.perfil.sucursal_id || null,
            caja_id: caja_cobro_id || null,
            id_cliente_centum: id_cliente_centum ?? 0,
            nombre_cliente: nombre_cliente || 'Consumidor Final',
            subtotal: total || 0,
            descuento_total: 0,
            total: total || 0,
            monto_pagado: parseFloat(total_pagado) || 0,
            vuelto: 0,
            items: JSON.stringify(items),
            pagos: pagos_anticipado,
            pedido_pos_id: data.id,
          })
          .select()
          .single()

        if (!errVenta && venta) {
          ventaAnticipada = venta
          // Vincular venta al pedido
          await supabase.from('pedidos_pos').update({ venta_anticipada_id: venta.id }).eq('id', data.id)
          data.venta_anticipada_id = venta.id

          // Registrar en Centum ERP (async)
          if (caja_cobro_id) {
            const { data: cajaData } = await supabase.from('cajas').select('*, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)').eq('id', caja_cobro_id).single()
            if (cajaData?.punto_venta_centum && cajaData?.sucursales?.centum_sucursal_id) {
              ;(async () => {
                try {
                  await supabase.from('ventas_pos').update({
                    centum_intentos: 1,
                    centum_ultimo_intento: new Date().toISOString(),
                  }).eq('id', venta.id)
                  const resultado = await registrarVentaPOSEnCentum(venta, {
                    sucursalFisicaId: cajaData.sucursales.centum_sucursal_id,
                    puntoVenta: cajaData.punto_venta_centum,
                    centum_operador_empresa: cajaData.sucursales.centum_operador_empresa,
                    centum_operador_prueba: cajaData.sucursales.centum_operador_prueba,
                  })
                  if (resultado) {
                    const numDoc = resultado.NumeroDocumento
                    const comprobante = numDoc ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}` : null
                    await supabase.from('ventas_pos').update({
                      id_venta_centum: resultado.IdVenta || null,
                      centum_comprobante: comprobante,
                      centum_sync: true,
                      centum_error: null,
                      numero_cae: resultado.CAE || null,
                    }).eq('id', venta.id)
                    fetchAndSaveCAE(venta.id, resultado.IdVenta)
                  }
                } catch (err) {
                  logger.error(`[POS] Error Centum para venta anticipada ${venta.id}:`, err.message)
                  try {
                    await supabase.from('ventas_pos').update({
                      centum_error: `UNVERIFIED|anticipado: ${(err.message || '').slice(0, 150)}`,
                      centum_ultimo_intento: new Date().toISOString(),
                    }).eq('id', venta.id)
                  } catch (e) {}
                }
              })()
            }
          }
        } else if (errVenta) {
          logger.error('[POS] Error creando venta anticipada:', errVenta.message)
        }
      } catch (errAnticipado) {
        logger.error('[POS] Error en flujo venta anticipada:', errAnticipado.message)
      }
    }

    res.status(201).json({ pedido: data, ventaAnticipada, mensaje: 'Pedido registrado correctamente' })
  } catch (err) {
    logger.error('[POS] Error al crear pedido:', err.message)
    res.status(500).json({ error: 'Error al crear pedido: ' + err.message })
  }
}))

// GET /api/pos/pedidos — listar pedidos (default: pendientes)
router.get('/pedidos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const estado = req.query.estado || 'pendiente'
    const { fecha, sucursal_id, busqueda, tipo } = req.query

    let query = supabase
      .from('pedidos_pos')
      .select('*, perfiles:cajero_id(nombre), sucursales:sucursal_id(nombre)')
      .order('created_at', { ascending: false })

    if (estado !== 'todos') {
      query = query.eq('estado', estado)
    }
    if (tipo && tipo !== 'todos') {
      query = query.eq('tipo', tipo)
    }

    // Si hay búsqueda por nombre, ignorar fecha y sucursal
    if (busqueda && busqueda.trim()) {
      query = query.ilike('nombre_cliente', `%${busqueda.trim()}%`)
    } else {
      // Filtros de fecha y sucursal solo cuando no hay búsqueda
      if (fecha) {
        query = query.eq('fecha_entrega', fecha)
      }
      if (sucursal_id) {
        query = query.eq('sucursal_id', sucursal_id)
      }
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ pedidos: data || [] })
  } catch (err) {
    logger.error('[POS] Error al listar pedidos:', err.message)
    res.status(500).json({ error: 'Error al listar pedidos' })
  }
}))

// GET /api/pos/pedidos/guia-delivery — pedidos delivery para guía de envíos
router.get('/pedidos/guia-delivery', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { fecha } = req.query
    if (!fecha) return res.status(400).json({ error: 'fecha es requerido' })

    let query = supabase
      .from('pedidos_pos')
      .select('*, perfiles:cajero_id(nombre), sucursales:sucursal_id(nombre)')
      .eq('tipo', 'delivery')
      .eq('estado', 'pendiente')
      .eq('fecha_entrega', fecha)
      .order('turno_entrega', { ascending: true })
      .order('created_at', { ascending: true })

    const { data, error } = await query
    if (error) throw error

    // Enriquecer pedidos con celular del cliente desde tabla clientes
    const pedidos = data || []
    const idsCliente = [...new Set(pedidos.map(p => p.id_cliente_centum).filter(Boolean))]
    let celularMap = {}
    if (idsCliente.length > 0) {
      const { data: clientes } = await supabase
        .from('clientes')
        .select('id_centum, celular')
        .in('id_centum', idsCliente)
      if (clientes) {
        clientes.forEach(c => { if (c.celular) celularMap[c.id_centum] = c.celular })
      }
    }
    pedidos.forEach(p => {
      p.celular_cliente = celularMap[p.id_cliente_centum] || null
    })

    res.json({ pedidos })
  } catch (err) {
    logger.error('[POS] Error al obtener guía delivery:', err.message)
    res.status(500).json({ error: 'Error al obtener guía delivery' })
  }
}))

// ============ GUIAS DELIVERY ============

// GET /api/pos/guias-delivery — listar guías
router.get('/guias-delivery', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { fecha, estado } = req.query
    let query = supabase
      .from('guias_delivery')
      .select('*, cierre:cierres_pos(id, numero), guia_delivery_pedidos(*, pedido:pedidos_pos(id, numero, nombre_cliente, total, observaciones, items), venta:ventas_pos(id, caja_id, caja:cajas(id, nombre)))')
      .order('fecha', { ascending: false })

    if (fecha) query = query.eq('fecha', fecha)
    if (estado) query = query.eq('estado', estado)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/pos/guias-delivery/:id — detalle de una guía
router.get('/guias-delivery/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('guias_delivery')
      .select('*, guia_delivery_pedidos(*, pedido:pedidos_pos(id, numero, nombre_cliente, total, observaciones, items, id_cliente_centum))')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Guía no encontrada' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// POST /api/pos/guias-delivery/despachar — crear guía + ventas automáticas + cambiar estado pedidos
router.post('/guias-delivery/despachar', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { fecha, turno, cadete_id, cadete_nombre, cambio_entregado, caja_id } = req.body
    if (!fecha || !turno) return res.status(400).json({ error: 'fecha y turno son requeridos' })
    if (!caja_id) return res.status(400).json({ error: 'caja_id es requerido (caja delivery)' })

    // Obtener pedidos delivery pendientes para fecha+turno
    const { data: pedidos, error: errPedidos } = await supabase
      .from('pedidos_pos')
      .select('*')
      .eq('tipo', 'delivery')
      .eq('estado', 'pendiente')
      .eq('fecha_entrega', fecha)
      .eq('turno_entrega', turno)
      .order('created_at', { ascending: true })

    if (errPedidos) throw errPedidos
    if (!pedidos || pedidos.length === 0) {
      return res.status(400).json({ error: 'No hay pedidos pendientes para despachar' })
    }

    // Verificar que no haya pedidos sin forma de pago
    const sinPago = pedidos.filter(p => {
      const obs = p.observaciones || ''
      return !obs.includes('PAGO ANTICIPADO') && !obs.includes('PAGO EN ENTREGA: EFECTIVO')
    })
    if (sinPago.length > 0) {
      return res.status(400).json({ error: `Hay ${sinPago.length} pedido(s) sin forma de pago definida` })
    }

    // Obtener promo de descuento por pago en efectivo
    let descEfectivoPct = 0
    const { data: promos } = await supabase
      .from('promociones_pos')
      .select('*')
      .eq('activa', true)
      .eq('tipo', 'forma_pago')
    const promoEfectivo = (promos || []).find(p => (p.reglas?.forma_cobro_nombre || '').toLowerCase() === 'efectivo')
    if (promoEfectivo) {
      descEfectivoPct = parseFloat(promoEfectivo.reglas?.valor) || 0
    }

    // Calcular totales (efectivo con descuento aplicado)
    let totalEfectivo = 0
    let totalAnticipado = 0
    let totalDescuento = 0
    pedidos.forEach(p => {
      const obs = p.observaciones || ''
      const pedidoTotal = parseFloat(p.total) || 0
      if (obs.includes('PAGO ANTICIPADO')) {
        totalAnticipado += pedidoTotal
      } else {
        const desc = descEfectivoPct > 0 ? Math.round(pedidoTotal * descEfectivoPct / 100 * 100) / 100 : 0
        totalEfectivo += Math.round((pedidoTotal - desc) * 100) / 100
        totalDescuento += desc
      }
    })

    // Buscar caja delivery de la misma sucursal (para ventas y cierre)
    const { data: cajaOrigen } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
    let cajaDeliveryId = caja_id // fallback: usar la caja del cajero
    if (cajaOrigen?.sucursal_id) {
      const { data: cajaDeliv } = await supabase
        .from('cajas')
        .select('id')
        .eq('sucursal_id', cajaOrigen.sucursal_id)
        .ilike('nombre', '%delivery%')
        .limit(1)
        .single()
      if (cajaDeliv) cajaDeliveryId = cajaDeliv.id
    }

    // Obtener config de caja delivery para Centum
    const { data: cajaData } = await supabase
      .from('cajas')
      .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
      .eq('id', cajaDeliveryId)
      .single()

    // Crear la guía
    const { data: guia, error: errGuia } = await supabase
      .from('guias_delivery')
      .insert({
        fecha,
        turno,
        cadete_id: cadete_id || null,
        cadete_nombre: cadete_nombre || null,
        cambio_entregado: cambio_entregado || 0,
        total_efectivo: totalEfectivo,
        total_anticipado: totalAnticipado,
        cantidad_pedidos: pedidos.length,
        estado: 'despachada',
        despachada_por: req.perfil.id,
        sucursal_id: cajaData?.sucursal_id || null,
      })
      .select()
      .single()

    if (errGuia) throw errGuia

    // Crear ventas y vincular pedidos a la guía
    const guiaPedidos = []
    const ventasCreadas = []

    for (const pedido of pedidos) {
      const obs = pedido.observaciones || ''
      const esAnticipado = obs.includes('PAGO ANTICIPADO')
      const formaPago = esAnticipado ? 'anticipado' : 'efectivo'

      // Si es anticipado y ya tiene venta creada, reutilizarla
      let venta = null
      if (esAnticipado && pedido.venta_anticipada_id) {
        const { data: ventaExistente } = await supabase
          .from('ventas_pos')
          .select('*')
          .eq('id', pedido.venta_anticipada_id)
          .single()
        if (ventaExistente) {
          venta = ventaExistente
          ventasCreadas.push(venta)
          guiaPedidos.push({
            guia_id: guia.id,
            pedido_pos_id: pedido.id,
            venta_pos_id: venta.id,
            forma_pago: formaPago,
            monto: parseFloat(venta.total) || 0,
            estado_entrega: 'pendiente',
          })
          continue
        }
      }

      // Crear venta_pos para cada pedido (legacy o no anticipado)
      const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()
      const pedidoTotal = parseFloat(pedido.total) || 0

      // Aplicar descuento efectivo si corresponde
      let descuento = 0
      let totalVenta = pedidoTotal
      if (!esAnticipado && descEfectivoPct > 0) {
        descuento = Math.round(pedidoTotal * descEfectivoPct / 100 * 100) / 100
        totalVenta = Math.round((pedidoTotal - descuento) * 100) / 100
      }

      const pagos = esAnticipado
        ? [{ tipo: 'Pago anticipado', monto: pedidoTotal }]
        : [{ tipo: 'efectivo', monto: totalVenta }]

      const insertVenta = {
        cajero_id: req.perfil.id,
        sucursal_id: cajaData?.sucursal_id || null,
        caja_id: cajaDeliveryId,
        id_cliente_centum: pedido.id_cliente_centum || 0,
        nombre_cliente: pedido.nombre_cliente || null,
        subtotal: pedidoTotal,
        descuento_total: descuento,
        total: totalVenta,
        monto_pagado: totalVenta,
        vuelto: 0,
        items: typeof pedido.items === 'string' ? pedido.items : JSON.stringify(pedido.items),
        pagos,
        descuento_forma_pago: descuento > 0 ? { total: descuento, detalle: [{ formaCobro: 'Efectivo', porcentaje: descEfectivoPct, descuento }] } : null,
        pedido_pos_id: pedido.id,
      }

      const { data: ventaNueva, error: errVenta } = await supabase
        .from('ventas_pos')
        .insert(insertVenta)
        .select()
        .single()

      if (errVenta) {
        logger.error(`[Guía Delivery] Error creando venta para pedido ${pedido.id}:`, errVenta.message)
        continue
      }

      venta = ventaNueva

      ventasCreadas.push(venta)

      // Registrar en Centum ERP (async) — con pre-write de intentos para anti-duplicación
      if (venta && cajaData?.punto_venta_centum && cajaData?.sucursales?.centum_sucursal_id) {
        ;(async () => {
          try {
            // Pre-write: registrar intento ANTES del POST (si crashea después, el cron verificará en BI)
            await supabase.from('ventas_pos').update({
              centum_intentos: 1,
              centum_ultimo_intento: new Date().toISOString(),
            }).eq('id', venta.id)

            const resultado = await registrarVentaPOSEnCentum(venta, {
              sucursalFisicaId: cajaData.sucursales.centum_sucursal_id,
              puntoVenta: cajaData.punto_venta_centum,
              centum_operador_empresa: cajaData.sucursales.centum_operador_empresa,
              centum_operador_prueba: cajaData.sucursales.centum_operador_prueba,
            })
            if (resultado) {
              const numDoc = resultado.NumeroDocumento
              const comprobante = numDoc ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}` : null
              await supabase.from('ventas_pos').update({
                id_venta_centum: resultado.IdVenta || null,
                centum_comprobante: comprobante,
                centum_sync: true,
                centum_error: null,
                numero_cae: resultado.CAE || null,
              }).eq('id', venta.id)
              logger.info(`[Guía Delivery] Venta ${venta.id} registrada en Centum: ${comprobante}`)
              fetchAndSaveCAE(venta.id, resultado.IdVenta)
            }
          } catch (err) {
            logger.error(`[Guía Delivery] Error Centum para venta ${venta.id}:`, err.message)
            try {
              // Marcar UNVERIFIED — el cron verificará en BI antes de reintentar
              await supabase.from('ventas_pos').update({
                centum_error: `UNVERIFIED|delivery: ${(err.message || '').slice(0, 150)}`,
                centum_ultimo_intento: new Date().toISOString(),
              }).eq('id', venta.id)
            } catch (e) {
              logger.error(`[Guía Delivery] No se pudo guardar centum_error para venta ${venta.id}:`, e.message)
            }
          }
        })()
      }

      // Vincular pedido a la guía
      guiaPedidos.push({
        guia_id: guia.id,
        pedido_pos_id: pedido.id,
        venta_pos_id: venta.id,
        forma_pago: formaPago,
        monto: totalVenta,
        estado_entrega: 'pendiente',
      })
    }

    // Insertar relaciones guía-pedidos
    if (guiaPedidos.length > 0) {
      const { error: errGP } = await supabase.from('guia_delivery_pedidos').insert(guiaPedidos)
      if (errGP) logger.error('[Guía Delivery] Error insertando guia_delivery_pedidos:', errGP.message)
    }

    // Cambiar estado de todos los pedidos a 'entregado' y marcar total_pagado
    const pedidoIds = pedidos.map(p => p.id)
    for (const pedido of pedidos) {
      const obs = pedido.observaciones || ''
      const pedidoTotal = parseFloat(pedido.total) || 0
      let totalPagado = parseFloat(pedido.total_pagado) || 0

      // Si paga en efectivo y no tenía total_pagado, calcular con descuento aplicado
      if (obs.includes('PAGO EN ENTREGA: EFECTIVO') && totalPagado === 0) {
        const desc = descEfectivoPct > 0 ? Math.round(pedidoTotal * descEfectivoPct / 100 * 100) / 100 : 0
        totalPagado = Math.round((pedidoTotal - desc) * 100) / 100
      }

      await supabase
        .from('pedidos_pos')
        .update({ estado: 'entregado', total_pagado: totalPagado || pedidoTotal })
        .eq('id', pedido.id)
    }

    // Crear cierre delivery SOLO si hay efectivo a cobrar
    const cambioNum = parseFloat(cambio_entregado) || 0
    const totalADevolver = totalEfectivo + cambioNum
    const fechaFormateada = fecha.split('-').reverse().join('/')
    const labelDelivery = `Delivery ${fechaFormateada} ${turno}`

    let cierreDelivery = null

    if (totalEfectivo > 0) {
      // Obtener siguiente numero de cierre
      const { data: ultimoCierre } = await supabase
        .from('cierres_pos')
        .select('numero')
        .not('numero', 'is', null)
        .order('numero', { ascending: false })
        .limit(1)
      const siguienteNumero = (ultimoCierre?.[0]?.numero || 0) + 1

      const { data: cierreData, error: errCierre } = await supabase
        .from('cierres_pos')
        .insert({
          numero: siguienteNumero,
          caja_id: cajaDeliveryId,
          empleado_id: null,
          cajero_id: req.perfil.id,
          apertura_at: new Date().toISOString(),
          cierre_at: new Date().toISOString(),
          fecha,
          fondo_fijo: cambioNum,
          fondo_fijo_billetes: {},
          fondo_fijo_monedas: {},
          tipo: 'delivery',
          estado: 'pendiente_gestor',
          total_efectivo: totalADevolver,
          total_general: totalADevolver,
          medios_pago: totalAnticipado > 0 ? [{ nombre: 'Pago anticipado (MP)', total: totalAnticipado }] : [],
          billetes: {},
          monedas: {},
          observaciones_apertura: labelDelivery,
          observaciones: `Guía delivery ${turno} - ${pedidos.length} pedidos. Cadete: ${cadete_nombre || 'Sin asignar'}. Efectivo a cobrar: $${totalEfectivo}. Cambio entregado: $${cambioNum}. Total a devolver: $${totalADevolver}.`,
        })
        .select()
        .single()

      if (errCierre) {
        logger.error('[Guía Delivery] Error creando cierre delivery:', errCierre.message)
      } else {
        cierreDelivery = cierreData
      }

      // Registrar retiro en la caja que despacha (el cambio dado al cadete)
      if (cambioNum > 0) {
        // Buscar cierre abierto de la caja que despacha
        const { data: cierreAbierto } = await supabase
          .from('cierres_pos')
          .select('id')
          .eq('caja_id', caja_id)
          .eq('estado', 'abierta')
          .limit(1)
          .single()

        if (cierreAbierto) {
          // Calcular número secuencial del retiro
          const { data: maxRetiro } = await supabase
            .from('retiros_pos')
            .select('numero')
            .eq('cierre_pos_id', cierreAbierto.id)
            .order('numero', { ascending: false })
            .limit(1)

          const numRetiro = (maxRetiro && maxRetiro.length > 0 ? maxRetiro[0].numero : 0) + 1

          await supabase
            .from('retiros_pos')
            .insert({
              cierre_pos_id: cierreAbierto.id,
              empleado_id: null,
              numero: numRetiro,
              billetes: {},
              monedas: {},
              total: cambioNum,
              oculto: true,
              observaciones: `Cambio para delivery ${turno} ${fechaFormateada} - Cadete: ${cadete_nombre || 'Sin asignar'}`,
            })
          logger.info(`[Guía Delivery] Retiro de $${cambioNum} registrado en cierre ${cierreAbierto.id}`)
        } else {
          logger.info('[Guía Delivery] No hay caja abierta para registrar retiro del cambio')
        }
      }
    } else {
      logger.info(`[Guía Delivery] Sin efectivo a cobrar — no se crea cierre delivery`)
    }

    // Vincular cierre al registro de guía
    if (cierreDelivery) {
      await supabase
        .from('guias_delivery')
        .update({ cierre_pos_id: cierreDelivery.id })
        .eq('id', guia.id)
    }

    res.json({
      guia,
      ventas_creadas: ventasCreadas,
      pedidos_despachados: pedidoIds.length,
      total_efectivo: totalEfectivo,
      total_anticipado: totalAnticipado,
      total_descuento: totalDescuento,
      descuento_efectivo_pct: descEfectivoPct,
      cambio_entregado: cambioNum,
      total_a_devolver: totalADevolver,
      cierre_delivery_id: cierreDelivery?.id || null,
      punto_venta: cajaData?.punto_venta_centum || null,
    })
  } catch (err) {
    logger.error('[Guía Delivery] Error al despachar:', err.message)
    res.status(500).json({ error: 'Error al despachar guía: ' + err.message })
  }
}))

// PUT /api/pos/guias-delivery/:id/cerrar — cierre delivery (cuando vuelve el cadete)
router.put('/guias-delivery/:id/cerrar', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { efectivo_recibido, observaciones, pedidos_no_entregados } = req.body

    // Obtener guía con pedidos
    const { data: guia, error: errGuia } = await supabase
      .from('guias_delivery')
      .select('*, guia_delivery_pedidos(*)')
      .eq('id', req.params.id)
      .single()

    if (errGuia || !guia) return res.status(404).json({ error: 'Guía no encontrada' })
    if (guia.estado !== 'despachada') return res.status(400).json({ error: 'La guía ya fue cerrada' })

    // Marcar pedidos no entregados
    const noEntregadosIds = (pedidos_no_entregados || []).map(p => p.id)
    for (const pe of (pedidos_no_entregados || [])) {
      await supabase
        .from('guia_delivery_pedidos')
        .update({ estado_entrega: pe.estado || 'no_entregado', motivo_no_entrega: pe.motivo || null })
        .eq('guia_id', guia.id)
        .eq('pedido_pos_id', pe.id)

      // Cambiar estado del pedido
      await supabase
        .from('pedidos_pos')
        .update({ estado: pe.estado || 'no_entregado' })
        .eq('id', pe.id)
    }

    // Marcar el resto como entregados
    const entregadosGP = guia.guia_delivery_pedidos.filter(gp => !noEntregadosIds.includes(gp.pedido_pos_id))
    for (const gp of entregadosGP) {
      await supabase
        .from('guia_delivery_pedidos')
        .update({ estado_entrega: 'entregado' })
        .eq('id', gp.id)

      await supabase
        .from('pedidos_pos')
        .update({ estado: 'entregado' })
        .eq('id', gp.pedido_pos_id)
    }

    // Calcular efectivo esperado (solo pedidos entregados que pagan en efectivo)
    const efectivoEntregados = guia.guia_delivery_pedidos
      .filter(gp => gp.forma_pago === 'efectivo' && !noEntregadosIds.includes(gp.pedido_pos_id))
      .reduce((s, gp) => s + (parseFloat(gp.monto) || 0), 0)

    const totalEsperado = efectivoEntregados + (parseFloat(guia.cambio_entregado) || 0)
    const efectivoRec = parseFloat(efectivo_recibido) || 0
    const diferencia = Math.round((efectivoRec - totalEsperado) * 100) / 100

    // Actualizar guía
    const nuevoEstado = Math.abs(diferencia) < 0.01 ? 'cerrada' : 'con_diferencia'
    const { data: guiaActualizada, error: errUpdate } = await supabase
      .from('guias_delivery')
      .update({
        estado: nuevoEstado,
        efectivo_recibido: efectivoRec,
        diferencia,
        observaciones_cierre: observaciones || null,
        cerrada_por: req.perfil.id,
        cerrada_at: new Date().toISOString(),
      })
      .eq('id', guia.id)
      .select()
      .single()

    if (errUpdate) throw errUpdate

    // Generar saldo a favor para pedidos anticipados no entregados
    for (const pe of (pedidos_no_entregados || [])) {
      const gp = guia.guia_delivery_pedidos.find(g => g.pedido_pos_id === pe.id && g.forma_pago === 'anticipado')
      if (gp) {
        const { data: pedidoData } = await supabase.from('pedidos_pos').select('id_cliente_centum, nombre_cliente, numero, pagos, total_pagado, total').eq('id', pe.id).single()
        if (pedidoData && pedidoData.id_cliente_centum) {
          const montoSaldo = parseFloat(gp.monto) || 0
          const pagosArr = Array.isArray(pedidoData.pagos) ? pedidoData.pagos : []
          const totalPedido = parseFloat(pedidoData.total_pagado) || parseFloat(pedidoData.total) || 0
          await supabase.from('movimientos_saldo_pos').insert({
            id_cliente_centum: pedidoData.id_cliente_centum,
            nombre_cliente: pedidoData.nombre_cliente || 'Cliente',
            monto: montoSaldo,
            motivo: `No entregado - Pedido #${pedidoData.numero || pe.id}`,
            pedido_pos_id: pe.id,
            created_by: req.perfil.id,
            forma_pago_origen: calcularFormaPagoOrigen(pagosArr, montoSaldo, totalPedido),
          })
        }
      }
    }

    res.json({
      guia: guiaActualizada,
      efectivo_esperado: totalEsperado,
      efectivo_recibido: efectivoRec,
      diferencia,
      pedidos_entregados: entregadosGP.length,
      pedidos_no_entregados: noEntregadosIds.length,
    })
  } catch (err) {
    logger.error('[Guía Delivery] Error al cerrar:', err.message)
    res.status(500).json({ error: 'Error al cerrar guía: ' + err.message })
  }
}))

// GET /api/pos/pedidos/articulos-por-dia — artículos necesarios agrupados por fecha de entrega
router.get('/pedidos/articulos-por-dia', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { sucursal_id, fecha_desde, fecha_hasta } = req.query

    let query = supabase
      .from('pedidos_pos')
      .select('items, fecha_entrega, created_at, sucursal_id')
      .eq('estado', 'pendiente')

    if (sucursal_id) {
      query = query.eq('sucursal_id', sucursal_id)
    }

    // Filtro de rango de fechas sobre fecha_entrega
    if (fecha_desde) {
      query = query.gte('fecha_entrega', fecha_desde)
    }
    if (fecha_hasta) {
      query = query.lte('fecha_entrega', fecha_hasta)
    }

    const { data, error } = await query
    if (error) throw error

    // Agrupar artículos por fecha de entrega
    const porDia = {}
    for (const pedido of (data || [])) {
      // Usar fecha_entrega o la fecha de creación si no tiene
      const fecha = pedido.fecha_entrega || (pedido.created_at ? pedido.created_at.split('T')[0] : null)
      if (!fecha) continue

      if (!porDia[fecha]) porDia[fecha] = {}

      const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()
      for (const item of (items || [])) {
        const key = item.articulo_id || item.nombre
        if (!porDia[fecha][key]) {
          porDia[fecha][key] = {
            articulo_id: item.articulo_id || null,
            codigo: item.codigo || null,
            nombre: item.nombre,
            cantidad: 0,
          }
        }
        porDia[fecha][key].cantidad += item.cantidad || 1
      }
    }

    // Convertir a array ordenado por fecha
    const resultado = Object.entries(porDia)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fecha, articulosMap]) => ({
        fecha,
        articulos: Object.values(articulosMap).sort((a, b) => a.nombre.localeCompare(b.nombre)),
        total_articulos: Object.values(articulosMap).reduce((s, a) => s + a.cantidad, 0),
      }))

    res.json({ dias: resultado })
  } catch (err) {
    logger.error('[POS] Error artículos por día:', err.message)
    res.status(500).json({ error: 'Error al obtener artículos por día' })
  }
}))

// PUT /api/pos/pedidos/:id — editar items/total/observaciones de un pedido pendiente
router.put('/pedidos/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { items, total, observaciones, tipo, fecha_entrega, direccion_entrega, nombre_cliente, id_cliente_centum, turno_entrega, sucursal_id, tarjeta_regalo, observaciones_pedido } = req.body

    // Permitir actualización parcial (solo campos extras sin items/total)
    const esActualizacionParcial = !items && total == null
    if (!esActualizacionParcial) {
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items es requerido' })
      }
      if (total == null || total <= 0) {
        return res.status(400).json({ error: 'total debe ser mayor a 0' })
      }
    }

    // Validar perecederos si cambia fecha_entrega (solo si hay items)
    if (fecha_entrega && !esActualizacionParcial) {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const manana = new Date()
      manana.setDate(manana.getDate() + 1)
      const mananaISO = manana.toISOString().split('T')[0]
      const tienePerecedor = items.some(i => {
        const rubro = (i.rubro || '').toLowerCase()
        return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
      })
      if (tienePerecedor && fecha_entrega > mananaISO) {
        return res.status(400).json({ error: 'Los pedidos con Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana' })
      }
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
    const nuevoTotal = esActualizacionParcial ? parseFloat(pedidoActual.total) : parseFloat(total)
    const updateData = {}
    if (!esActualizacionParcial) {
      updateData.items = JSON.stringify(items)
      updateData.total = nuevoTotal
    }
    if (observaciones !== undefined) updateData.observaciones = observaciones || null
    if (tipo !== undefined) updateData.tipo = tipo
    if (fecha_entrega !== undefined) updateData.fecha_entrega = fecha_entrega || null
    if (nombre_cliente !== undefined) updateData.nombre_cliente = nombre_cliente
    if (id_cliente_centum !== undefined) updateData.id_cliente_centum = id_cliente_centum
    if (turno_entrega !== undefined) updateData.turno_entrega = turno_entrega || null
    if (sucursal_id !== undefined) updateData.sucursal_id = sucursal_id
    if (direccion_entrega !== undefined) {
      // Actualizar observaciones con nueva dirección
      let obs = (updateData.observaciones || '').replace(/Dirección: [^|]+\|?\s*/g, '').trim()
      if (direccion_entrega) {
        obs = obs ? `${obs} | Dirección: ${direccion_entrega}` : `Dirección: ${direccion_entrega}`
      }
      updateData.observaciones = obs || null
    }
    if (tarjeta_regalo !== undefined) updateData.tarjeta_regalo = tarjeta_regalo?.trim() || null
    if (observaciones_pedido !== undefined) updateData.observaciones_pedido = observaciones_pedido?.trim() || null

    // Si el pedido estaba pagado y el nuevo total es menor, ajustar total_pagado y generar saldo
    let saldoGenerado = null
    if (!esActualizacionParcial && totalPagado > 0 && nuevoTotal < totalPagado) {
      const diferencia = totalPagado - nuevoTotal
      updateData.total_pagado = nuevoTotal

      if (pedidoActual.id_cliente_centum) {
        const pagosArr = Array.isArray(pedidoActual.pagos) ? pedidoActual.pagos : []
        const totalPedido = parseFloat(pedidoActual.total_pagado) || parseFloat(pedidoActual.total) || 0
        const { data: mov } = await supabase
          .from('movimientos_saldo_pos')
          .insert({
            id_cliente_centum: pedidoActual.id_cliente_centum,
            nombre_cliente: pedidoActual.nombre_cliente || 'Cliente',
            monto: diferencia,
            motivo: `Edición pedido #${pedidoActual.numero || pedidoActual.id} (bajó de ${pedidoActual.total} a ${nuevoTotal})`,
            pedido_pos_id: pedidoActual.id,
            created_by: req.perfil.id,
            forma_pago_origen: calcularFormaPagoOrigen(pagosArr, diferencia, totalPedido),
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
    logger.error('[POS] Error al editar pedido:', err.message)
    res.status(500).json({ error: 'Error al editar pedido: ' + err.message })
  }
}))

// PUT /api/pos/pedidos/:id/pago — registrar pago en caja de un pedido pendiente
router.put('/pedidos/:id/pago', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { total_pagado, observaciones, pagos_anticipado, caja_cobro_id } = req.body

    const { data: pedido } = await supabase
      .from('pedidos_pos')
      .select('id, estado, total, total_pagado, id_cliente_centum, nombre_cliente, items, venta_anticipada_id')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'pendiente') {
      return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })
    }

    const nuevoTotalPagado = (parseFloat(pedido.total_pagado) || 0) + (parseFloat(total_pagado) || 0)

    // Validar sobrepago (no permitir pagar más del total)
    const totalPedido = parseFloat(pedido.total) || 0
    if (total_pagado > 0 && nuevoTotalPagado > totalPedido * 1.01) { // 1% tolerancia por redondeo
      return res.status(400).json({ error: `El monto excede el total del pedido. Total: $${totalPedido.toFixed(2)}, ya pagado: $${(parseFloat(pedido.total_pagado) || 0).toFixed(2)}` })
    }

    const updateData = {
      total_pagado: nuevoTotalPagado,
      observaciones: observaciones || pedido.observaciones || 'PAGO ANTICIPADO',
    }

    // Crear venta anticipada si hay pagos reales y no existe ya una
    let ventaAnticipada = null
    if (!pedido.venta_anticipada_id && pagos_anticipado && Array.isArray(pagos_anticipado) && pagos_anticipado.length > 0 && (parseFloat(total_pagado) || 0) > 0) {
      try {
        let sucursalCaja = null
        if (caja_cobro_id) {
          const { data: cajaInfo } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_cobro_id).single()
          sucursalCaja = cajaInfo?.sucursal_id || null
        }

        const itemsPedido = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()

        const { data: venta, error: errVenta } = await supabase
          .from('ventas_pos')
          .insert({
            cajero_id: req.perfil.id,
            sucursal_id: sucursalCaja || req.perfil.sucursal_id || null,
            caja_id: caja_cobro_id || null,
            id_cliente_centum: pedido.id_cliente_centum ?? 0,
            nombre_cliente: pedido.nombre_cliente || 'Consumidor Final',
            subtotal: totalPedido,
            descuento_total: 0,
            total: totalPedido,
            monto_pagado: parseFloat(total_pagado) || 0,
            vuelto: 0,
            items: typeof pedido.items === 'string' ? pedido.items : JSON.stringify(pedido.items),
            pagos: pagos_anticipado,
            pedido_pos_id: pedido.id,
          })
          .select()
          .single()

        if (!errVenta && venta) {
          ventaAnticipada = venta
          updateData.venta_anticipada_id = venta.id

          // Registrar en Centum ERP (async)
          if (caja_cobro_id) {
            const { data: cajaData } = await supabase.from('cajas').select('*, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)').eq('id', caja_cobro_id).single()
            if (cajaData?.punto_venta_centum && cajaData?.sucursales?.centum_sucursal_id) {
              ;(async () => {
                try {
                  await supabase.from('ventas_pos').update({
                    centum_intentos: 1,
                    centum_ultimo_intento: new Date().toISOString(),
                  }).eq('id', venta.id)
                  const resultado = await registrarVentaPOSEnCentum(venta, {
                    sucursalFisicaId: cajaData.sucursales.centum_sucursal_id,
                    puntoVenta: cajaData.punto_venta_centum,
                    centum_operador_empresa: cajaData.sucursales.centum_operador_empresa,
                    centum_operador_prueba: cajaData.sucursales.centum_operador_prueba,
                  })
                  if (resultado) {
                    const numDoc = resultado.NumeroDocumento
                    const comprobante = numDoc ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}` : null
                    await supabase.from('ventas_pos').update({
                      id_venta_centum: resultado.IdVenta || null,
                      centum_comprobante: comprobante,
                      centum_sync: true,
                      centum_error: null,
                      numero_cae: resultado.CAE || null,
                    }).eq('id', venta.id)
                    fetchAndSaveCAE(venta.id, resultado.IdVenta)
                  }
                } catch (err) {
                  logger.error(`[POS] Error Centum para venta anticipada ${venta.id}:`, err.message)
                  try {
                    await supabase.from('ventas_pos').update({
                      centum_error: `UNVERIFIED|anticipado: ${(err.message || '').slice(0, 150)}`,
                      centum_ultimo_intento: new Date().toISOString(),
                    }).eq('id', venta.id)
                  } catch (e) {}
                }
              })()
            }
          }
        } else if (errVenta) {
          logger.error('[POS] Error creando venta anticipada en cobro:', errVenta.message)
        }
      } catch (errAnticipado) {
        logger.error('[POS] Error en flujo venta anticipada cobro:', errAnticipado.message)
      }
    }

    const { data, error } = await supabase
      .from('pedidos_pos')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ...data, ventaAnticipada })
  } catch (err) {
    logger.error('Error registrando pago de pedido:', err)
    res.status(500).json({ error: 'Error al registrar pago: ' + err.message })
  }
}))

// PUT /api/pos/pedidos/:id/estado — cambiar estado (entregado/cancelado)
router.put('/pedidos/:id/estado', verificarAuth, asyncHandler(async (req, res) => {
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
      const pagosArr = Array.isArray(pedidoActual.pagos) ? pedidoActual.pagos : []
      const { data: mov } = await supabase
        .from('movimientos_saldo_pos')
        .insert({
          id_cliente_centum: pedidoActual.id_cliente_centum,
          nombre_cliente: pedidoActual.nombre_cliente || 'Cliente',
          monto: totalPagado,
          motivo: `Cancelación pedido #${pedidoActual.numero || pedidoActual.id}`,
          pedido_pos_id: pedidoActual.id,
          created_by: req.perfil.id,
          forma_pago_origen: calcularFormaPagoOrigen(pagosArr, totalPagado, totalPagado),
        })
        .select()
        .single()
      saldoGenerado = mov
    }

    res.json({ pedido: data, mensaje: `Pedido marcado como ${estado}`, saldoGenerado })
  } catch (err) {
    logger.error('[POS] Error al cambiar estado pedido:', err.message)
    res.status(500).json({ error: 'Error al cambiar estado: ' + err.message })
  }
}))

// PUT /api/pos/pedidos/:id/revertir — revertir pedido entregado/no_entregado a pendiente
router.put('/pedidos/:id/revertir', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { motivo } = req.body
    if (!motivo || !motivo.trim()) {
      return res.status(400).json({ error: 'Debe indicar un motivo para revertir' })
    }

    // 1. Obtener pedido
    const { data: pedido, error: errPedido } = await supabase
      .from('pedidos_pos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (errPedido || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
    if (!['entregado', 'no_entregado'].includes(pedido.estado)) {
      return res.status(400).json({ error: `Solo se pueden revertir pedidos entregados o no entregados. Estado actual: ${pedido.estado}` })
    }

    // Bloquear reversión de retiros no pre-pagados (solo delivery o retiro anticipado)
    const obsRetiro = pedido.observaciones || ''
    if (pedido.tipo === 'retiro' && !obsRetiro.includes('PAGO ANTICIPADO') && !pedido.venta_anticipada_id) {
      return res.status(400).json({ error: 'No se pueden revertir pedidos de retiro que se abonaron al momento del retiro. Solo se permiten reversiones de pedidos delivery o retiros con pago anticipado.' })
    }

    // 2. Buscar si fue despachado via guía
    const { data: guiaPedido } = await supabase
      .from('guia_delivery_pedidos')
      .select('*, guia:guias_delivery(*)')
      .eq('pedido_pos_id', pedido.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    let ventaEliminada = false
    let notaCreditoCreada = null
    // Variables para vincular cancelación al cierre delivery (se setean en A5)
    let cierreDeliveryId = null
    let cierreDeliveryCajaId = null

    // === CASO A: Despachado via guía ===
    if (guiaPedido) {
      // A1: Efectivo — anular la venta auto-creada
      if (guiaPedido.forma_pago === 'efectivo' && guiaPedido.venta_pos_id) {
        const { data: venta } = await supabase
          .from('ventas_pos')
          .select('*')
          .eq('id', guiaPedido.venta_pos_id)
          .single()

        if (venta) {
          if (!venta.centum_sync) {
            // Venta no sincronizada — eliminar directamente
            await supabase.from('ventas_pos').delete().eq('id', venta.id)
            ventaEliminada = true
            logger.info(`[POS] Reversión: venta ${venta.id} eliminada (no sync Centum)`)
          } else {
            // Venta sincronizada — crear Nota de Crédito completa
            const itemsVenta = (() => { try { return typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []) } catch { return [] } })()
            const totalNC = Math.abs(parseFloat(venta.total)) || 0

            const itemsNC = itemsVenta.map(item => ({
              ...item,
              cantidad: item.cantidad || 1,
              precioUnitario: item.precioUnitario || item.precio_unitario || item.precio || 0,
              precio: item.precioUnitario || item.precio_unitario || item.precio || 0,
            }))

            // Crear NC en ventas_pos
            const { data: nc, error: ncErr } = await supabase
              .from('ventas_pos')
              .insert({
                cajero_id: req.perfil.id,
                sucursal_id: venta.sucursal_id,
                caja_id: venta.caja_id,
                id_cliente_centum: venta.id_cliente_centum || 0,
                nombre_cliente: venta.nombre_cliente || pedido.nombre_cliente || 'Cliente',
                subtotal: -(parseFloat(venta.subtotal) || totalNC),
                descuento_total: -(parseFloat(venta.descuento_total) || 0),
                total: -totalNC,
                monto_pagado: 0,
                vuelto: 0,
                items: JSON.stringify(itemsNC),
                pagos: [],
                tipo: 'nota_credito',
                venta_origen_id: venta.id,
              })
              .select()
              .single()

            if (ncErr) throw ncErr
            notaCreditoCreada = nc

            // NC en Centum si la venta original tiene comprobante
            if (venta.centum_comprobante) {
              try {
                const pvOriginal = extraerPuntoVentaDeComprobante(venta.centum_comprobante)
                if (pvOriginal) {
                  let sucursalFisicaId = null
                  let centumOperadorEmpresa = null
                  let centumOperadorPrueba = null
                  if (venta.caja_id) {
                    const { data: cajaData } = await supabase
                      .from('cajas')
                      .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
                      .eq('id', venta.caja_id)
                      .single()
                    sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
                    centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
                    centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
                  }

                  let condicionIva = 'CF'
                  let vendedorCentumId = null
                  if (venta.id_cliente_centum) {
                    const { data: cli } = await supabase
                      .from('clientes').select('condicion_iva, vendedor_centum_id')
                      .eq('id_centum', venta.id_cliente_centum).single()
                    condicionIva = cli?.condicion_iva || 'CF'
                    vendedorCentumId = cli?.vendedor_centum_id || null
                  }

                  const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
                  const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
                  const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : []
                  const soloEfectivo = pagosVenta.length === 0 || pagosVenta.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
                  const idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

                  const operadorMovilUser = idDivisionEmpresa === 2
                    ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
                    : (centumOperadorEmpresa || null)

                  const centumNC = await crearNotaCreditoPOS({
                    idCliente: venta.id_cliente_centum || 2,
                    sucursalFisicaId,
                    idDivisionEmpresa,
                    puntoVenta: pvOriginal.puntoVenta,
                    items: itemsNC,
                    total: totalNC,
                    condicionIva,
                    operadorMovilUser,
                    comprobanteOriginal: venta.centum_comprobante,
                    ventaPosId: nc.id,
                    idVendedor: vendedorCentumId,
                  })

                  const numDoc = centumNC.NumeroDocumento
                  const comprobante = numDoc
                    ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
                    : null
                  await supabase.from('ventas_pos').update({
                    id_venta_centum: centumNC.IdVenta || null,
                    centum_comprobante: comprobante,
                    centum_sync: true,
                    numero_cae: centumNC.CAE || null,
                    clasificacion: idDivisionEmpresa === 3 ? 'EMPRESA' : 'PRUEBA',
                  }).eq('id', nc.id)

                  logger.info(`[POS] NC Centum por reversión pedido #${pedido.numero}: ${comprobante}`)
                  fetchAndSaveCAE(nc.id, centumNC.IdVenta)
                }
              } catch (centumErr) {
                logger.error('[POS] Error NC Centum en reversión:', centumErr.message)
                await supabase.from('ventas_pos').update({
                  centum_error: centumErr.message,
                }).eq('id', nc.id)
              }
            }
          }
        }

        // Resetear total_pagado (efectivo: el dinero se devuelve)
        await supabase.from('pedidos_pos').update({ total_pagado: 0 }).eq('id', pedido.id)
      }
      // A2: Anticipado — NO tocar la venta anticipada, mantener total_pagado

      // A3: Actualizar guia_delivery_pedidos
      await supabase
        .from('guia_delivery_pedidos')
        .update({ estado_entrega: 'revertido', motivo_no_entrega: motivo.trim() })
        .eq('id', guiaPedido.id)

      // A4: Actualizar guia — restar montos
      if (guiaPedido.guia) {
        const montoRestar = parseFloat(guiaPedido.monto) || 0
        const updateGuia = { cantidad_pedidos: Math.max(0, (guiaPedido.guia.cantidad_pedidos || 0) - 1) }
        if (guiaPedido.forma_pago === 'efectivo') {
          updateGuia.total_efectivo = Math.max(0, Math.round(((parseFloat(guiaPedido.guia.total_efectivo) || 0) - montoRestar) * 100) / 100)
        } else if (guiaPedido.forma_pago === 'anticipado') {
          updateGuia.total_anticipado = Math.max(0, Math.round(((parseFloat(guiaPedido.guia.total_anticipado) || 0) - montoRestar) * 100) / 100)
        }
        await supabase.from('guias_delivery').update(updateGuia).eq('id', guiaPedido.guia.id)

        // A5: Ajustar cierre delivery si existe y el pedido era efectivo
        if (guiaPedido.guia.cierre_pos_id && guiaPedido.forma_pago === 'efectivo') {
          const { data: cierreDelivery } = await supabase
            .from('cierres_pos')
            .select('id, estado, total_efectivo, total_general, fondo_fijo, observaciones, caja_id')
            .eq('id', guiaPedido.guia.cierre_pos_id)
            .single()

          if (cierreDelivery && cierreDelivery.estado === 'pendiente_gestor') {
            const nuevoTotalEfectivo = Math.max(0, Math.round(((parseFloat(cierreDelivery.total_efectivo) || 0) - montoRestar) * 100) / 100)
            const nuevoTotalGeneral = Math.max(0, Math.round(((parseFloat(cierreDelivery.total_general) || 0) - montoRestar) * 100) / 100)
            const obsAnterior = cierreDelivery.observaciones || ''
            const obsReversion = `\n⚠️ Pedido #${pedido.numero || pedido.id} ($${montoRestar}) REVERTIDO: ${motivo.trim()}. Efectivo ajustado a $${nuevoTotalEfectivo}. Cambio de $${cierreDelivery.fondo_fijo || 0} a devolver a caja.`

            await supabase.from('cierres_pos').update({
              total_efectivo: nuevoTotalEfectivo,
              total_general: nuevoTotalGeneral,
              observaciones: obsAnterior + obsReversion,
            }).eq('id', cierreDelivery.id)
          }

          // Vincular la cancelación al cierre delivery en vez del cierre del cajero
          if (cierreDelivery) {
            cierreDeliveryId = cierreDelivery.id
            cierreDeliveryCajaId = cierreDelivery.caja_id
          }
        }
      }
    }
    // === CASO B: Entregado individualmente — solo revertir estado ===

    // Actualizar pedido a pendiente
    const obsActual = pedido.observaciones || ''
    const obsAppend = `${obsActual ? obsActual + ' ' : ''}| REVERTIDO: ${motivo.trim()} por ${req.perfil.nombre || req.perfil.username} el ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`

    const { data: pedidoActualizado, error: errUpdate } = await supabase
      .from('pedidos_pos')
      .update({ estado: 'pendiente', observaciones: obsAppend })
      .eq('id', pedido.id)
      .select()
      .single()

    if (errUpdate) throw errUpdate

    // Registrar en auditoría (ventas_pos_canceladas)
    const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()

    // Buscar cierre activo del cajero
    let cierreActivoId = null
    let cajaActivaId = null
    const { data: cierreAbierto } = await supabase
      .from('cierres_pos')
      .select('id, caja_id')
      .eq('cajero_id', req.perfil.id)
      .eq('estado', 'abierta')
      .limit(1)
      .single()
    if (cierreAbierto) {
      cierreActivoId = cierreAbierto.id
      cajaActivaId = cierreAbierto.caja_id
    }

    // Si el pedido pertenece a una guía con cierre delivery, vincular la cancelación ahí
    if (cierreDeliveryId) {
      cierreActivoId = cierreDeliveryId
      cajaActivaId = cierreDeliveryCajaId
    }

    await supabase.from('ventas_pos_canceladas').insert({
      cajero_id: req.perfil.id,
      cajero_nombre: req.perfil?.nombre || req.perfil?.username || 'Desconocido',
      sucursal_id: req.perfil.sucursal_id,
      caja_id: cajaActivaId,
      motivo: `Reversión pedido #${pedido.numero || pedido.id}: ${motivo.trim()}`,
      items: items,
      subtotal: parseFloat(pedido.total) || 0,
      total: parseFloat(pedido.total) || 0,
      cliente_nombre: pedido.nombre_cliente || null,
      cierre_id: cierreActivoId,
    })

    logger.info(`[POS] Pedido #${pedido.numero || pedido.id} revertido a pendiente. Motivo: ${motivo.trim()}. Por: ${req.perfil.nombre || req.perfil.username}. Via guía: ${!!guiaPedido}. Forma pago: ${guiaPedido?.forma_pago || 'N/A'}. Venta eliminada: ${ventaEliminada}. NC creada: ${!!notaCreditoCreada}`)

    res.json({
      ok: true,
      pedido: pedidoActualizado,
      venta_eliminada: ventaEliminada,
      nota_credito: notaCreditoCreada ? { id: notaCreditoCreada.id, numero: notaCreditoCreada.numero_venta } : null,
      via_guia: !!guiaPedido,
    })
  } catch (err) {
    logger.error('[POS] Error al revertir pedido:', err.message)
    res.status(500).json({ error: 'Error al revertir pedido: ' + err.message })
  }
}))

// ============ TALO (Links de pago) ============

const { crearPagoTalo, obtenerPagoTalo } = require('../services/talo')

// POST /api/pos/pedidos/:id/link-pago
// Genera link de pago de Talo para un pedido POS
router.post('/pedidos/:id/link-pago', verificarAuth, asyncHandler(async (req, res) => {
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

    const totalPagado = parseFloat(pedido.total_pagado) || 0
    const esPagoAnticipado = (pedido.observaciones || '').includes('PAGO ANTICIPADO') || totalPagado > 0
    let montoACobrar = Math.round(pedido.total * 100) / 100
    let titulo = `Pedido POS #${pedido.numero}`

    if (esPagoAnticipado) {
      const diferencia = pedido.total - totalPagado
      if (diferencia <= 0) {
        return res.status(400).json({ error: 'El pedido ya está completamente pagado' })
      }
      montoACobrar = Math.round(diferencia * 100) / 100
      titulo = `Diferencia Pedido POS #${pedido.numero}`
    }

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

    const pago = await crearPagoTalo({
      idPedido: pedido.id,
      titulo,
      monto: montoACobrar,
      webhookUrl: `${backendUrl}/api/pos/webhook-talo`,
      redirectUrl: 'https://zaatar.com.ar',
    })

    // Responder con el link inmediatamente
    res.json({ link: pago.payment_url })

    // Guardar referencia y marcar como pendiente de pago (async, no bloquea respuesta)
    const obsActual = pedido.observaciones || ''
    const yaEsPago = obsActual.includes('PAGO ANTICIPADO') || obsActual.includes('PAGO PENDIENTE')
    const updateData = { mp_preference_id: pago.id || null }
    if (!yaEsPago) {
      updateData.observaciones = obsActual ? `PAGO PENDIENTE: LINK TALO | ${obsActual}` : 'PAGO PENDIENTE: LINK TALO'
    }
    supabase
      .from('pedidos_pos')
      .update(updateData)
      .eq('id', pedido.id)
  } catch (err) {
    logger.error('[POS Link Talo] Error:', err)
    res.status(500).json({ error: 'Error al generar link de pago: ' + err.message })
  }
}))

// POST /api/pos/webhook-talo
// Webhook de Talo — SIN auth (viene de servidores de Talo)
// Talo envía solo { message, paymentId } — se re-consulta el pago para validar
router.post('/webhook-talo', asyncHandler(async (req, res) => {
  // Responder 200 inmediatamente
  res.sendStatus(200)

  try {
    const { paymentId } = req.body || {}
    if (!paymentId) return

    logger.info(`[Talo Webhook] Pago actualizado: ${paymentId}`)

    const pago = await obtenerPagoTalo(paymentId)
    const status = (pago.status || '').toUpperCase()

    // Solo procesar pagos exitosos (SUCCESS, OVERPAID)
    if (status !== 'SUCCESS' && status !== 'OVERPAID') {
      logger.info(`[Talo Webhook] Pago ${paymentId} status: ${status} — ignorado`)
      return
    }

    const externalId = pago.external_id
    if (!externalId) return
    // external_id tiene formato "pedidoUUID_timestamp" — extraer solo el UUID
    const pedidoId = externalId.replace(/_\d+$/, '')

    const { data: pedido } = await supabase
      .from('pedidos_pos')
      .select('id, estado, observaciones, total, total_pagado')
      .eq('id', pedidoId)
      .maybeSingle()

    if (!pedido || pedido.estado !== 'pendiente') return

    const obsActual = pedido.observaciones || ''
    const yaEsPagoAnticipado = obsActual.includes('PAGO ANTICIPADO')
    const totalPagadoActual = parseFloat(pedido.total_pagado) || 0
    const montoPago = parseFloat(pago.price?.amount) || parseFloat(pedido.total) || 0

    if (yaEsPagoAnticipado) {
      await supabase
        .from('pedidos_pos')
        .update({
          total_pagado: totalPagadoActual + montoPago,
          mp_payment_id: String(paymentId),
        })
        .eq('id', pedidoId)
      logger.info(`[Talo Webhook] Pedido ${pedidoId} — diferencia pagada $${montoPago} (payment ${paymentId})`)
    } else {
      const nuevaObs = obsActual ? `PAGO ANTICIPADO | ${obsActual}` : 'PAGO ANTICIPADO'
      await supabase
        .from('pedidos_pos')
        .update({
          observaciones: nuevaObs,
          mp_payment_id: String(paymentId),
          total_pagado: parseFloat(pedido.total) || 0,
        })
        .eq('id', pedidoId)
      logger.info(`[Talo Webhook] Pedido ${pedidoId} marcado como pagado (payment ${paymentId})`)
    }
  } catch (err) {
    logger.error('[Talo Webhook] Error:', err)
  }
}))

// ============ SALDO A FAVOR ============

// GET /api/pos/saldo/:idClienteCentum — saldo y movimientos de un cliente
router.get('/saldo/:idClienteCentum', verificarAuth, asyncHandler(async (req, res) => {
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

    // Calcular desglose acumulado de forma_pago_origen para el saldo vigente
    const desglose_forma_pago = {}
    for (const m of (movimientos || [])) {
      if (m.forma_pago_origen && typeof m.forma_pago_origen === 'object') {
        for (const [tipo, monto] of Object.entries(m.forma_pago_origen)) {
          desglose_forma_pago[tipo] = (desglose_forma_pago[tipo] || 0) + parseFloat(monto)
        }
      }
    }
    // Redondear valores
    for (const k of Object.keys(desglose_forma_pago)) {
      desglose_forma_pago[k] = Math.round(desglose_forma_pago[k] * 100) / 100
      if (desglose_forma_pago[k] === 0) delete desglose_forma_pago[k]
    }

    res.json({ saldo: Math.round(saldo * 100) / 100, desglose_forma_pago, movimientos: movimientos || [] })
  } catch (err) {
    logger.error('[POS] Error al obtener saldo:', err.message)
    res.status(500).json({ error: 'Error al obtener saldo' })
  }
}))

// GET /api/pos/saldos — lista todos los clientes con saldo > 0
router.get('/saldos', verificarAuth, asyncHandler(async (req, res) => {
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
    logger.error('[POS] Error al listar saldos:', err.message)
    res.status(500).json({ error: 'Error al listar saldos' })
  }
}))

// GET /api/pos/saldos/buscar-cuit?cuit=XXX — buscar saldo por DNI/CUIT
router.get('/saldos/buscar-cuit', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { cuit } = req.query
    if (!cuit || cuit.trim().length < 3) return res.status(400).json({ error: 'Ingresá al menos 3 dígitos de DNI/CUIT' })

    const termino = cuit.trim()
    const soloDigitos = termino.replace(/\D/g, '')

    // Buscar cliente por CUIT en tabla clientes
    let orFilter = `cuit.ilike.%${soloDigitos}%`
    if (soloDigitos.length === 11) {
      const conGuiones = `${soloDigitos.slice(0,2)}-${soloDigitos.slice(2,10)}-${soloDigitos.slice(10)}`
      orFilter += `,cuit.ilike.%${conGuiones}%`
    }
    if (termino !== soloDigitos) orFilter += `,cuit.ilike.%${termino}%`

    const { data: clientes, error: errCli } = await supabase
      .from('clientes')
      .select('id, id_centum, razon_social, cuit')
      .eq('activo', true)
      .or(orFilter)
      .limit(5)

    if (errCli) throw errCli
    if (!clientes || clientes.length === 0) {
      return res.json({ clientes: [] })
    }

    // Para cada cliente, buscar su saldo
    const resultado = []
    for (const cli of clientes) {
      const idCentum = cli.id_centum
      if (!idCentum) continue

      const { data: movs } = await supabase
        .from('movimientos_saldo_pos')
        .select('monto')
        .eq('id_cliente_centum', idCentum)

      const saldo = (movs || []).reduce((s, m) => s + parseFloat(m.monto), 0)
      resultado.push({
        id_cliente_centum: idCentum,
        nombre_cliente: cli.razon_social,
        cuit: cli.cuit,
        saldo: Math.round(saldo * 100) / 100,
      })
    }

    res.json({ clientes: resultado })
  } catch (err) {
    logger.error('[POS] Error buscando saldo por CUIT:', err.message)
    res.status(500).json({ error: 'Error al buscar saldo' })
  }
}))

// POST /api/pos/saldos/ajuste — ajuste manual de saldo (solo admin)
router.post('/saldos/ajuste', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, monto, motivo, forma_pago_origen } = req.body
    if (!id_cliente_centum) return res.status(400).json({ error: 'id_cliente_centum requerido' })
    if (!monto || parseFloat(monto) === 0) return res.status(400).json({ error: 'Monto requerido y distinto de 0' })
    if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'Motivo requerido' })

    const insertData = {
      id_cliente_centum,
      nombre_cliente: nombre_cliente || 'Sin nombre',
      monto: parseFloat(monto),
      motivo: `Ajuste manual: ${motivo.trim()}`,
      created_by: req.perfil.id,
    }
    if (forma_pago_origen && typeof forma_pago_origen === 'object') {
      insertData.forma_pago_origen = forma_pago_origen
    }
    const { data, error } = await supabase
      .from('movimientos_saldo_pos')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error

    // Recalcular saldo total
    const { data: movs } = await supabase
      .from('movimientos_saldo_pos')
      .select('monto')
      .eq('id_cliente_centum', id_cliente_centum)

    const saldoActual = (movs || []).reduce((s, m) => s + parseFloat(m.monto), 0)

    res.status(201).json({ movimiento: data, saldo: Math.round(saldoActual * 100) / 100 })
  } catch (err) {
    logger.error('[POS] Error al ajustar saldo:', err.message)
    res.status(500).json({ error: 'Error al ajustar saldo' })
  }
}))

// PUT /api/pos/ventas/:id/cliente — corregir cliente de una venta
router.put('/ventas/:id/cliente', verificarAuth, asyncHandler(async (req, res) => {
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
    logger.error('[POS] Error al corregir cliente:', err.message)
    res.status(500).json({ error: 'Error al corregir cliente' })
  }
}))

// ============ DEVOLUCIONES ============

// POST /api/pos/devolucion — registra devolución y genera saldo a favor
router.post('/devolucion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { venta_id, id_cliente_centum, nombre_cliente, items_devueltos, tipo_problema, observacion, caja_id } = req.body

    if (!venta_id || !id_cliente_centum || !items_devueltos?.length) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Determinar sucursal desde la caja actual (donde se procesa la devolución)
    let sucursalNC = null
    if (caja_id) {
      const { data: cajaData } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
      sucursalNC = cajaData?.sucursal_id || null
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

    // Verificar items ya devueltos en NC previas de esta venta
    const { data: ncPrevias } = await supabase
      .from('ventas_pos')
      .select('items')
      .eq('venta_origen_id', venta_id)
      .eq('tipo', 'nota_credito')

    // Acumular cantidades ya devueltas por índice
    const yaDevuelto = {} // { indice: cantidadDevuelta }
    if (ncPrevias) {
      for (const nc of ncPrevias) {
        const ncItems = (() => { try { return typeof nc.items === 'string' ? JSON.parse(nc.items) : (nc.items || []) } catch { return [] } })()
        for (const ncItem of ncItems) {
          if (ncItem.indice_original != null) {
            yaDevuelto[ncItem.indice_original] = (yaDevuelto[ncItem.indice_original] || 0) + (ncItem.cantidad || 0)
          }
        }
      }
    }

    // Calcular subtotal de items devueltos, validando que no se excedan cantidades
    const itemsVenta = (() => { try { return typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []) } catch { return [] } })()
    let subtotalDevuelto = 0
    for (const dev of items_devueltos) {
      const itemOriginal = itemsVenta[dev.indice]
      if (!itemOriginal) continue
      const cantOriginal = itemOriginal.cantidad || 1
      const cantYaDevuelta = yaDevuelto[dev.indice] || 0
      const cantDisponible = cantOriginal - cantYaDevuelta
      if (cantDisponible <= 0) {
        return res.status(400).json({ error: `"${itemOriginal.nombre}" ya fue devuelto en su totalidad` })
      }
      if (dev.cantidad > cantDisponible) {
        return res.status(400).json({ error: `"${itemOriginal.nombre}": solo quedan ${cantDisponible} unidad(es) por devolver (ya se devolvieron ${cantYaDevuelta})` })
      }
      const precioUnit = itemOriginal.precio_unitario || itemOriginal.precioUnitario || itemOriginal.precio || 0
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

    if (saldoAFavor <= 0) {
      return res.status(400).json({ error: 'El importe de la devolución es $0. No se puede generar una nota de crédito con importe cero.' })
    }

    // Armar items de la nota de crédito (con precio proporcional al descuento)
    const factorDescuento = subtotalVenta > 0 ? totalVenta / subtotalVenta : 1
    const itemsNC = items_devueltos.map(dev => {
      const itemOriginal = itemsVenta[dev.indice] || {}
      const precioOriginal = itemOriginal.precio_unitario || itemOriginal.precioUnitario || itemOriginal.precio || 0
      return {
        ...itemOriginal,
        indice_original: dev.indice,
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
        sucursal_id: sucursalNC || venta.sucursal_id,
        caja_id: caja_id || venta.caja_id || null,
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
    const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : []
    const totalMontoPagado = parseFloat(venta.monto_pagado) || parseFloat(venta.total) || 0
    const { error: saldoErr } = await supabase
      .from('movimientos_saldo_pos')
      .insert({
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        monto: saldoAFavor,
        motivo: `Devolución - ${tipo_problema || 'Producto en mal estado'}. ${motivo}${observacion ? '. Obs: ' + observacion : ''}`,
        venta_pos_id: notaCredito.id,
        created_by: req.perfil.id,
        forma_pago_origen: calcularFormaPagoOrigen(pagosVenta, saldoAFavor, totalMontoPagado),
      })

    if (saldoErr) throw saldoErr

    // Si la venta original estaba sincronizada con Centum, crear NC en Centum
    let centumNC = null
    if (venta.centum_sync && venta.centum_comprobante) {
      try {
        const pvOriginal = extraerPuntoVentaDeComprobante(venta.centum_comprobante)
        if (!pvOriginal) throw new Error('No se pudo extraer PuntoVenta del comprobante original')

        // Buscar sucursal física y operadores
        let sucursalFisicaId = null
        let centumOperadorEmpresa = null
        let centumOperadorPrueba = null
        // Usar la caja de la venta original (reconciliación de caja)
        const cajaParaCentum = venta.caja_id || caja_id
        if (cajaParaCentum) {
          const { data: cajaData } = await supabase
            .from('cajas')
            .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
            .eq('id', cajaParaCentum)
            .single()
          sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
          centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
          centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
        }
        if (!sucursalFisicaId) {
          const { data: cajaFallback } = await supabase
            .from('cajas')
            .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
            .not('punto_venta_centum', 'is', null)
            .limit(1)
            .single()
          sucursalFisicaId = cajaFallback?.sucursales?.centum_sucursal_id
          if (!centumOperadorEmpresa) centumOperadorEmpresa = cajaFallback?.sucursales?.centum_operador_empresa
          if (!centumOperadorPrueba) centumOperadorPrueba = cajaFallback?.sucursales?.centum_operador_prueba
        }

        // Obtener condición IVA del cliente de la venta original
        let condicionIva = 'CF'
        let vendedorCentumId = null
        if (venta.id_cliente_centum) {
          const { data: cli } = await supabase
            .from('clientes').select('condicion_iva, vendedor_centum_id')
            .eq('id_centum', venta.id_cliente_centum).single()
          condicionIva = cli?.condicion_iva || 'CF'
          vendedorCentumId = cli?.vendedor_centum_id || null
        }

        const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
        const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
        const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : []
        const soloEfectivo = pagosVenta.length === 0 || pagosVenta.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
        const idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

        const operadorMovilUser = idDivisionEmpresa === 2
          ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
          : (centumOperadorEmpresa || null)

        centumNC = await crearNotaCreditoPOS({
          idCliente: venta.id_cliente_centum || 2,
          sucursalFisicaId,
          idDivisionEmpresa,
          puntoVenta: pvOriginal.puntoVenta,
          items: itemsNC,
          total: saldoAFavor,
          condicionIva,
          operadorMovilUser,
          comprobanteOriginal: venta.centum_comprobante,
          ventaPosId: notaCredito.id,
          idVendedor: vendedorCentumId,
        })

        // Guardar info de NC Centum en la nota de crédito local
        const numDoc = centumNC.NumeroDocumento
        const comprobante = numDoc
          ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
          : null
        await supabase.from('ventas_pos').update({
          id_venta_centum: centumNC.IdVenta || null,
          centum_comprobante: comprobante,
          centum_sync: true,
          numero_cae: centumNC.CAE || null,
          clasificacion: idDivisionEmpresa === 3 ? 'EMPRESA' : 'PRUEBA',
        }).eq('id', notaCredito.id)

        logger.info(`[POS] NC Centum creada para devolución: ${comprobante}`)
        fetchAndSaveCAE(notaCredito.id, centumNC.IdVenta)
      } catch (centumErr) {
        logger.error('[POS] Error al crear NC en Centum (devolución):', centumErr.message)
        await supabase.from('ventas_pos').update({
          centum_error: centumErr.message,
        }).eq('id', notaCredito.id)
      }
    }

    res.json({
      ok: true,
      saldo_generado: saldoAFavor,
      subtotal_devuelto: subtotalDevuelto,
      proporcion: Math.round(proporcion * 10000) / 100,
      nota_credito_id: notaCredito.id,
      numero_nc: notaCredito.numero_venta,
      centum_nc: centumNC ? true : false,
      items_nc: itemsNC,
      factor_descuento: Math.round(factorDescuento * 10000) / 10000,
    })
  } catch (err) {
    logger.error('[POS] Error al procesar devolución:', err.message)
    res.status(500).json({ error: 'Error al procesar devolución' })
  }
}))

// POST /api/pos/correccion-cliente — NC de venta original + nueva venta al cliente correcto
router.post('/correccion-cliente', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { venta_id, id_cliente_centum, nombre_cliente, caja_id } = req.body

    if (!venta_id || !id_cliente_centum || !nombre_cliente) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Determinar sucursal desde la caja actual (donde se procesa la corrección)
    let sucursalNC = null
    if (caja_id) {
      const { data: cajaData } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
      sucursalNC = cajaData?.sucursal_id || null
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

    const itemsOriginal = (() => { try { return typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []) } catch { return [] } })()
    const pagosOriginal = (() => { try { return typeof venta.pagos === 'string' ? JSON.parse(venta.pagos) : (venta.pagos || []) } catch { return [] } })()
    const promosOriginal = (() => { try { return venta.promociones_aplicadas ? (typeof venta.promociones_aplicadas === 'string' ? JSON.parse(venta.promociones_aplicadas) : venta.promociones_aplicadas) : null } catch { return null } })()

    // Obtener condicion_iva de ambos clientes para clasificación correcta
    let condicionIvaOrig = venta.condicion_iva || 'CF'
    let vendedorCentumIdOrig = null
    if (venta.id_cliente_centum) {
      const { data: cliOrig } = await supabase.from('clientes').select('condicion_iva, vendedor_centum_id').eq('id_centum', venta.id_cliente_centum).single()
      if (!venta.condicion_iva) condicionIvaOrig = cliOrig?.condicion_iva || 'CF'
      vendedorCentumIdOrig = cliOrig?.vendedor_centum_id || null
    }
    let condicionIvaNuevo = 'CF'
    let vendedorCentumIdNuevo = null
    if (id_cliente_centum) {
      const { data: cliNuevo } = await supabase.from('clientes').select('condicion_iva, vendedor_centum_id').eq('id_centum', id_cliente_centum).single()
      condicionIvaNuevo = cliNuevo?.condicion_iva || 'CF'
      vendedorCentumIdNuevo = cliNuevo?.vendedor_centum_id || null
    }

    // 1. Crear nota de crédito (anula la venta original)
    const { data: notaCredito, error: ncErr } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: sucursalNC || venta.sucursal_id,
        caja_id: caja_id || venta.caja_id || null,
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
        condicion_iva: condicionIvaOrig,
      })
      .select()
      .single()

    if (ncErr) throw ncErr

    // 2. Crear nueva venta al cliente correcto (mismos items, montos y pagos)
    const { data: nuevaVenta, error: nvErr } = await supabase
      .from('ventas_pos')
      .insert({
        cajero_id: req.perfil.id,
        sucursal_id: sucursalNC || venta.sucursal_id,
        caja_id: caja_id || venta.caja_id || null,
        id_cliente_centum,
        nombre_cliente,
        condicion_iva: condicionIvaNuevo,
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

    // Si la venta original estaba sincronizada con Centum, crear NC + nueva FCV
    let centumNCOk = false, centumFCVOk = false
    if (venta.centum_sync && venta.centum_comprobante) {
      const pvOriginal = extraerPuntoVentaDeComprobante(venta.centum_comprobante)

      // Buscar sucursal física y operadores
      let sucursalFisicaId = null
      let centumOperadorEmpresa = null
      let centumOperadorPrueba = null
      if (venta.caja_id) {
        const { data: cajaData } = await supabase
          .from('cajas')
          .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
          .eq('id', venta.caja_id)
          .single()
        sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
        centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
        centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
      }
      if (!sucursalFisicaId) {
        const { data: cajaFallback } = await supabase
          .from('cajas')
          .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
          .not('punto_venta_centum', 'is', null)
          .limit(1)
          .single()
        sucursalFisicaId = cajaFallback?.sucursales?.centum_sucursal_id
        if (!centumOperadorEmpresa) centumOperadorEmpresa = cajaFallback?.sucursales?.centum_operador_empresa
        if (!centumOperadorPrueba) centumOperadorPrueba = cajaFallback?.sucursales?.centum_operador_prueba
      }

      if (pvOriginal && sucursalFisicaId) {
        // 1. NC al cliente original
        try {
          const esFacturaAOrig = condicionIvaOrig === 'RI' || condicionIvaOrig === 'MT'
          const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : []
          const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
          const soloEfectivoOrig = pagosVenta.length === 0 || pagosVenta.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
          const idDivOrig = esFacturaAOrig ? 3 : (soloEfectivoOrig ? 2 : 3)

          const operadorMovilUser = idDivOrig === 2
            ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
            : (centumOperadorEmpresa || null)

          const centumNC = await crearNotaCreditoPOS({
            idCliente: venta.id_cliente_centum || 2,
            sucursalFisicaId,
            idDivisionEmpresa: idDivOrig,
            puntoVenta: pvOriginal.puntoVenta,
            items: itemsOriginal,
            total: Math.abs(parseFloat(venta.total) || 0),
            condicionIva: condicionIvaOrig,
            operadorMovilUser,
            comprobanteOriginal: venta.centum_comprobante,
            ventaPosId: notaCredito.id,
            idVendedor: vendedorCentumIdOrig,
          })

          const numDocNC = centumNC.NumeroDocumento
          const comprobanteNC = numDocNC
            ? `${numDocNC.LetraDocumento || ''} PV${numDocNC.PuntoVenta}-${numDocNC.Numero}`
            : null
          await supabase.from('ventas_pos').update({
            id_venta_centum: centumNC.IdVenta || null,
            centum_comprobante: comprobanteNC,
            centum_sync: true,
            centum_error: null,
            numero_cae: centumNC.CAE || null,
            centum_intentos: 1,
            centum_ultimo_intento: new Date().toISOString(),
            clasificacion: idDivOrig === 3 ? 'EMPRESA' : 'PRUEBA',
          }).eq('id', notaCredito.id)
          centumNCOk = true
          logger.info(`[POS] NC Centum corrección cliente: ${comprobanteNC}`)
          fetchAndSaveCAE(notaCredito.id, centumNC.IdVenta)
        } catch (centumErr) {
          logger.error('[POS] Error NC Centum (corrección cliente):', centumErr.message)
          await supabase.from('ventas_pos').update({
            centum_error: `UNVERIFIED|NC corrección: ${(centumErr.message || '').slice(0, 150)}`,
            centum_intentos: 1,
            centum_ultimo_intento: new Date().toISOString(),
          }).eq('id', notaCredito.id)
        }

        // 2. Nueva FCV al cliente correcto
        try {
          // Pre-write: registrar intento antes del POST
          await supabase.from('ventas_pos').update({
            centum_intentos: 1,
            centum_ultimo_intento: new Date().toISOString(),
          }).eq('id', nuevaVenta.id)

          const esFacturaANuevo = condicionIvaNuevo === 'RI' || condicionIvaNuevo === 'MT'
          const tiposEfectivo2 = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
          const soloEfectivoNuevo = pagosOriginal.length === 0 || pagosOriginal.every(p => tiposEfectivo2.includes((p.tipo || '').toLowerCase()))
          const idDivNuevo = esFacturaANuevo ? 3 : (soloEfectivoNuevo ? 2 : 3)

          const operadorMovilUserNuevo = idDivNuevo === 2
            ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
            : (centumOperadorEmpresa || null)

          const centumFCV = await crearVentaPOS({
            idCliente: id_cliente_centum || 2,
            sucursalFisicaId,
            idDivisionEmpresa: idDivNuevo,
            puntoVenta: pvOriginal.puntoVenta,
            items: itemsOriginal,
            pagos: pagosOriginal,
            total: parseFloat(venta.total) || 0,
            condicionIva: condicionIvaNuevo,
            operadorMovilUser: operadorMovilUserNuevo,
            ventaPosId: nuevaVenta.id,
            idVendedor: vendedorCentumIdNuevo,
          })

          const numDocFCV = centumFCV.NumeroDocumento
          const comprobanteFCV = numDocFCV
            ? `${numDocFCV.LetraDocumento || ''} PV${numDocFCV.PuntoVenta}-${numDocFCV.Numero}`
            : null
          await supabase.from('ventas_pos').update({
            id_venta_centum: centumFCV.IdVenta || null,
            centum_comprobante: comprobanteFCV,
            centum_sync: true,
            centum_error: null,
            numero_cae: centumFCV.CAE || null,
            clasificacion: idDivNuevo === 3 ? 'EMPRESA' : 'PRUEBA',
          }).eq('id', nuevaVenta.id)
          centumFCVOk = true
          logger.info(`[POS] FCV Centum corrección cliente: ${comprobanteFCV}`)
          fetchAndSaveCAE(nuevaVenta.id, centumFCV.IdVenta)
        } catch (centumErr) {
          logger.error('[POS] Error FCV Centum (corrección cliente):', centumErr.message)
          await supabase.from('ventas_pos').update({
            centum_error: `UNVERIFIED|corrección cliente: ${(centumErr.message || '').slice(0, 150)}`,
            centum_ultimo_intento: new Date().toISOString(),
          }).eq('id', nuevaVenta.id)
        }
      }
    }

    res.json({
      ok: true,
      nota_credito_id: notaCredito.id,
      nueva_venta_id: nuevaVenta.id,
      centum_nc: centumNCOk,
      centum_fcv: centumFCVOk,
    })
  } catch (err) {
    logger.error('[POS] Error al corregir cliente:', err.message)
    res.status(500).json({ error: 'Error al procesar corrección' })
  }
}))

// POST /api/pos/devolucion-precio — diferencia de precio → NC + saldo
router.post('/devolucion-precio', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { venta_id, id_cliente_centum, nombre_cliente, items_corregidos, observacion, caja_id } = req.body

    if (!venta_id || !id_cliente_centum || !items_corregidos?.length) {
      return res.status(400).json({ error: 'Datos incompletos' })
    }

    // Determinar sucursal desde la caja actual
    let sucursalNC = null
    if (caja_id) {
      const { data: cajaData } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
      sucursalNC = cajaData?.sucursal_id || null
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
        sucursal_id: sucursalNC || venta.sucursal_id,
        caja_id: caja_id || venta.caja_id || null,
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
    const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : []
    const totalMontoPagado = parseFloat(venta.monto_pagado) || parseFloat(venta.total) || 0
    const { error: saldoErr } = await supabase
      .from('movimientos_saldo_pos')
      .insert({
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Cliente',
        monto: saldoAFavor,
        motivo: `Diferencia de precio. ${motivo}${observacion ? '. Obs: ' + observacion : ''}`,
        venta_pos_id: notaCredito.id,
        created_by: req.perfil.id,
        forma_pago_origen: calcularFormaPagoOrigen(pagosVenta, saldoAFavor, totalMontoPagado),
      })

    if (saldoErr) throw saldoErr

    // Si la venta original estaba sincronizada con Centum, crear NC por concepto
    let centumNC = null
    if (venta.centum_sync && venta.centum_comprobante) {
      try {
        const pvOriginal = extraerPuntoVentaDeComprobante(venta.centum_comprobante)
        if (!pvOriginal) throw new Error('No se pudo extraer PuntoVenta del comprobante original')

        let sucursalFisicaId = null
        let centumOperadorEmpresa = null
        let centumOperadorPrueba = null
        // Usar la caja de la venta original (reconciliación de caja)
        const cajaParaCentum = venta.caja_id || caja_id
        if (cajaParaCentum) {
          const { data: cajaData } = await supabase
            .from('cajas')
            .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
            .eq('id', cajaParaCentum)
            .single()
          sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
          centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
          centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
        }
        if (!sucursalFisicaId) {
          const { data: cajaFallback } = await supabase
            .from('cajas')
            .select('sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
            .not('punto_venta_centum', 'is', null)
            .limit(1)
            .single()
          sucursalFisicaId = cajaFallback?.sucursales?.centum_sucursal_id
          if (!centumOperadorEmpresa) centumOperadorEmpresa = cajaFallback?.sucursales?.centum_operador_empresa
          if (!centumOperadorPrueba) centumOperadorPrueba = cajaFallback?.sucursales?.centum_operador_prueba
        }

        let condicionIva = 'CF'
        let vendedorCentumId = null
        if (venta.id_cliente_centum) {
          const { data: cli } = await supabase
            .from('clientes').select('condicion_iva, vendedor_centum_id')
            .eq('id_centum', venta.id_cliente_centum).single()
          condicionIva = cli?.condicion_iva || 'CF'
          vendedorCentumId = cli?.vendedor_centum_id || null
        }

        const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
        const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
        const pagosVenta = Array.isArray(venta.pagos) ? venta.pagos : []
        const soloEfectivo = pagosVenta.length === 0 || pagosVenta.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
        const idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

        const operadorMovilUser = idDivisionEmpresa === 2
          ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
          : (centumOperadorEmpresa || null)

        const descripcionItems = items_corregidos.map(ic =>
          `${ic.cantidad}x ${ic.nombre}: $${ic.precio_cobrado} → $${ic.precio_correcto}`
        ).join(', ')

        centumNC = await crearNotaCreditoConceptoPOS({
          idCliente: venta.id_cliente_centum || 2,
          sucursalFisicaId,
          idDivisionEmpresa,
          puntoVenta: pvOriginal.puntoVenta,
          total: saldoAFavor,
          condicionIva,
          descripcion: `DIFERENCIA EN PRECIO DE GONDOLA - ${descripcionItems}`,
          operadorMovilUser,
          comprobanteOriginal: venta.centum_comprobante,
          ventaPosId: notaCredito.id,
          idVendedor: vendedorCentumId,
        })

        const numDoc = centumNC.NumeroDocumento
        const comprobante = numDoc
          ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
          : null
        await supabase.from('ventas_pos').update({
          id_venta_centum: centumNC.IdVenta || null,
          centum_comprobante: comprobante,
          centum_sync: true,
          numero_cae: centumNC.CAE || null,
          clasificacion: idDivisionEmpresa === 3 ? 'EMPRESA' : 'PRUEBA',
        }).eq('id', notaCredito.id)

        logger.info(`[POS] NC Concepto Centum creada para dif. precio: ${comprobante}`)
        fetchAndSaveCAE(notaCredito.id, centumNC.IdVenta)
      } catch (centumErr) {
        logger.error('[POS] Error NC Concepto Centum (dif. precio):', centumErr.message)
        await supabase.from('ventas_pos').update({
          centum_error: centumErr.message,
        }).eq('id', notaCredito.id)
      }
    }

    res.json({
      ok: true,
      saldo_generado: saldoAFavor,
      nota_credito_id: notaCredito.id,
      centum_nc: centumNC ? true : false,
    })
  } catch (err) {
    logger.error('[POS] Error al procesar corrección de precio:', err.message)
    res.status(500).json({ error: 'Error al procesar corrección de precio' })
  }
}))

// POST /api/pos/log-eliminacion
// Registra eliminación de artículos del ticket (auditoría anti-robo)
router.post('/log-eliminacion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { items, usuario_nombre, cierre_id, ticket_uid } = req.body
    if (!items || !items.length) return res.status(400).json({ error: 'Items requeridos' })

    const { error } = await supabase.from('pos_eliminaciones_log').insert({
      usuario_id: req.perfil.id,
      usuario_nombre: usuario_nombre || req.perfil.nombre || 'Desconocido',
      items,
      fecha: new Date().toISOString(),
      cierre_id: cierre_id || null,
      ticket_uid: ticket_uid || null,
    })

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    logger.error('[POS] Error al registrar eliminación:', err.message)
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/pos/ventas/:id/centum — obtener detalle completo de la venta en Centum (diagnóstico)
router.get('/ventas/:id/centum', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { data: venta, error } = await supabase
      .from('ventas_pos')
      .select('id, numero_venta, total, items, id_venta_centum, centum_comprobante')
      .eq('id', req.params.id)
      .single()

    if (error || !venta) return res.status(404).json({ error: 'Venta no encontrada' })
    if (!venta.id_venta_centum) return res.status(400).json({ error: 'La venta no tiene ID de Centum' })

    const centumData = await obtenerVentaCentum(venta.id_venta_centum)
    const centumTotal = centumData?.Total || 0
    const posTotal = parseFloat(venta.total) || 0
    const discrepancia = Math.abs(centumTotal - posTotal) > posTotal * 0.05

    res.json({
      pos: { id: venta.id, numero_venta: venta.numero_venta, total: posTotal, items_count: Array.isArray(venta.items) ? venta.items.length : 0 },
      centum: {
        IdVenta: centumData.IdVenta,
        Total: centumTotal,
        NumeroDocumento: centumData.NumeroDocumento,
        CAE: centumData.CAE,
        VentaArticulos: centumData.VentaArticulos,
        VentaValoresEfectivos: centumData.VentaValoresEfectivos,
      },
      discrepancia,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Reintentar envío de venta a Centum
router.post('/ventas/:id/reenviar-centum', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const ventaId = req.params.id

    // Obtener la venta (incluye columnas anti-duplicación)
    const { data: venta, error } = await supabase
      .from('ventas_pos')
      .select('*, centum_intentos, centum_ultimo_intento')
      .eq('id', ventaId)
      .single()

    if (error || !venta) return res.status(404).json({ error: 'Venta no encontrada' })
    if (venta.centum_sync && venta.centum_comprobante) return res.status(400).json({ error: 'Esta venta ya fue sincronizada con Centum' })

    // ATOMIC CLAIM: prevenir procesamiento concurrente con el cron
    const ahoraClaim = new Date().toISOString()
    const hace5min = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    await supabase
      .from('ventas_pos')
      .update({ centum_ultimo_intento: ahoraClaim })
      .eq('id', ventaId)
      .eq('centum_sync', false)
      .or(`centum_ultimo_intento.is.null,centum_ultimo_intento.lt.${hace5min}`)

    const { data: claimed } = await supabase
      .from('ventas_pos')
      .select('id')
      .eq('id', ventaId)
      .eq('centum_ultimo_intento', ahoraClaim)

    if (!claimed || claimed.length === 0) {
      return res.status(409).json({ error: 'Esta venta está siendo procesada por otro proceso. Reintente en unos minutos.' })
    }

    // Buscar config de caja/sucursal
    let puntoVenta, sucursalFisicaId, centumOperadorEmpresa, centumOperadorPrueba

    if (venta.caja_id) {
      const { data: cajaData } = await supabase
        .from('cajas')
        .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
        .eq('id', venta.caja_id)
        .single()

      puntoVenta = cajaData?.punto_venta_centum
      sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
      centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
      centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
    }

    if (!puntoVenta || !sucursalFisicaId) {
      const falta = !venta.caja_id
        ? 'La venta no tiene caja asignada'
        : !puntoVenta
          ? 'La caja no tiene punto de venta Centum configurado'
          : 'La sucursal no tiene ID de sucursal física Centum configurado'
      return res.status(400).json({ error: `${falta}. Configure el punto de venta en la caja y reintente.` })
    }

    // Preparar datos igual que registrarVentaPOSEnCentum pero sin catch silencioso
    const items = (() => { try { return typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []) } catch { return [] } })()
    const pagos = Array.isArray(venta.pagos) ? venta.pagos : []

    // Ventas de empleados → Consumidor Final (id=2), siempre PRUEBA
    const esEmpleado = venta.nombre_cliente && venta.nombre_cliente.startsWith('Empleado:')
    if (esEmpleado) {
      venta.id_cliente_centum = 2
    }

    // Si el cliente no tiene id_centum, intentar resolver o crearlo en Centum
    if (!esEmpleado && (!venta.id_cliente_centum || venta.id_cliente_centum === 0)) {
      if (venta.nombre_cliente && venta.nombre_cliente !== 'Consumidor Final') {
        const { data: cliLocal } = await supabase
          .from('clientes')
          .select('*')
          .ilike('razon_social', venta.nombre_cliente)
          .limit(1)
          .maybeSingle()

        if (cliLocal?.id_centum) {
          venta.id_cliente_centum = cliLocal.id_centum
          await supabase.from('ventas_pos').update({ id_cliente_centum: cliLocal.id_centum }).eq('id', venta.id)
        } else if (cliLocal) {
          try {
            const condIva = venta.condicion_iva || cliLocal.condicion_iva || 'CF'
            const dir = cliLocal.direccion ? { direccion: cliLocal.direccion, localidad: cliLocal.localidad } : null
            const resultado = await crearClienteEnCentum(cliLocal, condIva, dir)
            const idCentum = resultado.IdCliente || resultado.Id
            if (idCentum) {
              await supabase.from('clientes').update({ id_centum: idCentum }).eq('id', cliLocal.id)
              venta.id_cliente_centum = idCentum
              await supabase.from('ventas_pos').update({ id_cliente_centum: idCentum }).eq('id', venta.id)
              logger.info(`[Centum Reenvío] Cliente "${venta.nombre_cliente}" creado en Centum → id_centum=${idCentum}`)
            } else {
              return res.status(400).json({ error: `No se pudo crear el cliente "${venta.nombre_cliente}" en Centum: no devolvió IdCliente` })
            }
          } catch (errCli) {
            return res.status(400).json({ error: `Error creando cliente "${venta.nombre_cliente}" en Centum: ${errCli.message}` })
          }
        } else {
          return res.status(400).json({ error: `Cliente "${venta.nombre_cliente}" no encontrado en DB local` })
        }
      }
    }

    // Obtener condición IVA y vendedor del cliente
    let condicionIva = 'CF'
    let vendedorCentumId = null
    if (!esEmpleado && venta.id_cliente_centum) {
      const { data: cliente } = await supabase
        .from('clientes')
        .select('condicion_iva, vendedor_centum_id')
        .eq('id_centum', venta.id_cliente_centum)
        .single()
      condicionIva = cliente?.condicion_iva || 'CF'
      vendedorCentumId = cliente?.vendedor_centum_id || null
    }

    const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
    const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
    let idDivisionEmpresa = esEmpleado ? 2 : (esFacturaA ? 3 : (soloEfectivo ? 2 : 3))

    // GC aplicada como pago → forzar B PRUEBA (división 2)
    if (parseFloat(venta.gc_aplicada_monto) > 0) {
      idDivisionEmpresa = 2
    }

    // Obtener operador móvil según división
    const operadorMovilUser = idDivisionEmpresa === 2
      ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
      : (centumOperadorEmpresa || null)

    // --- Anti-duplicación: verificar en BI antes de crear (ventas Y NCs) ---
    {
      const totalParaBI = venta.tipo === 'nota_credito'
        ? Math.abs(parseFloat(venta.total) || 0)
        : (parseFloat(venta.total) || 0)
      const check = await verificarEnBI(ventaId, sucursalFisicaId, puntoVenta, totalParaBI)

      if (check.found) {
        logger.info(`[Centum POS] Venta ${ventaId} ya existe en Centum (IdVenta=${check.data.IdVenta}). Vinculando sin crear duplicado.`)
        const numDoc = check.data.NumeroDocumento
        const comprobante = numDoc
          ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
          : null
        await supabase
          .from('ventas_pos')
          .update({
            id_venta_centum: check.data.IdVenta || null,
            centum_comprobante: comprobante,
            centum_sync: true,
            centum_error: null,
            numero_cae: check.data.CAE || null,
          })
          .eq('id', ventaId)
        const cae = await fetchAndSaveCAE(ventaId, check.data.IdVenta)
        return res.json({ ok: true, comprobante, idVentaCentum: check.data.IdVenta, cae, reutilizada: true })
      }

      if (check.biDown) {
        return res.status(503).json({ error: `Centum BI no disponible. No se puede verificar si la venta ya existe. Reintente en unos minutos. (${check.error})` })
      }
    }

    // Pre-write: incrementar intentos antes del POST
    await supabase.from('ventas_pos').update({
      centum_intentos: (venta.centum_intentos || 0) + 1,
      centum_ultimo_intento: new Date().toISOString(),
    }).eq('id', ventaId)

    let resultado
    if (venta.tipo === 'nota_credito') {
      // NC Gift Card: concepto VENTA GIFT CARD, siempre B PRUEBA
      if (venta.nc_concepto_tipo === 'gift_card') {
        const comprobanteRef = venta.centum_comprobante || null
        const idClienteNC = venta.id_cliente_centum || 2
        const operadorNC = centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA
        resultado = await crearNotaCreditoConceptoPOS({
          idCliente: idClienteNC, sucursalFisicaId, idDivisionEmpresa: 2, puntoVenta,
          total: Math.abs(parseFloat(venta.total) || 0), condicionIva: 'CF',
          descripcion: `NC GIFT CARD - Venta origen: ${comprobanteRef || 'N/A'}`,
          operadorMovilUser: operadorNC, comprobanteOriginal: comprobanteRef,
          concepto: { idConcepto: 20, codigoConcepto: 'GIFTCARD', nombreConcepto: 'VENTA GIFT CARD' },
          ventaPosId: ventaId,
          idVendedor: vendedorCentumId,
        })
      } else {
      // NC: enviar con valores positivos (abs), Centum maneja el signo por tipo comprobante
      const itemsPositivos = items.map(it => ({
        ...it,
        precio_unitario: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
        precioUnitario: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
        precio: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
        cantidad: Math.abs(parseFloat(it.cantidad || 1)),
      }))

      // NC en Centum debe ser espejo de la factura original: mismo cliente y misma división
      let comprobanteOriginal = null
      let idClienteNC = venta.id_cliente_centum || 2
      let condicionIvaNC = condicionIva
      let idDivisionNC = idDivisionEmpresa
      let operadorNC = operadorMovilUser
      let vendedorCentumIdNC = vendedorCentumId

      if (venta.venta_origen_id) {
        const { data: ventaOrigen } = await supabase
          .from('ventas_pos')
          .select('centum_comprobante, id_cliente_centum, pagos')
          .eq('id', venta.venta_origen_id)
          .single()
        comprobanteOriginal = ventaOrigen?.centum_comprobante || null

        if (ventaOrigen) {
          // Usar cliente de la venta original
          idClienteNC = ventaOrigen.id_cliente_centum || 2

          // Obtener condición IVA y vendedor del cliente original
          let condIvaOrig = 'CF'
          if (ventaOrigen.id_cliente_centum) {
            const { data: cliOrig } = await supabase
              .from('clientes').select('condicion_iva, vendedor_centum_id')
              .eq('id_centum', ventaOrigen.id_cliente_centum).single()
            condIvaOrig = cliOrig?.condicion_iva || 'CF'
            vendedorCentumIdNC = cliOrig?.vendedor_centum_id || null
          }
          condicionIvaNC = condIvaOrig

          // Recalcular división según venta original
          const esFacturaAOrig = condIvaOrig === 'RI' || condIvaOrig === 'MT'
          const pagosOrig = Array.isArray(ventaOrigen.pagos) ? ventaOrigen.pagos : []
          const soloEfectivoOrig = pagosOrig.length === 0 || pagosOrig.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
          idDivisionNC = esFacturaAOrig ? 3 : (soloEfectivoOrig ? 2 : 3)
          operadorNC = idDivisionNC === 2
            ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
            : (centumOperadorEmpresa || null)
        }
      }

      // Detectar si es NC por concepto (diferencia de precio) o NC con artículos
      const esNCConcepto = items.some(it => it.precio_cobrado != null && it.precio_correcto != null)

      if (esNCConcepto) {
        // NC por concepto: diferencia de precio
        const descripcionItems = items.map(it =>
          `${it.cantidad || 1}x ${it.nombre}: $${it.precio_cobrado} → $${it.precio_correcto}`
        ).join(', ')
        resultado = await crearNotaCreditoConceptoPOS({
          idCliente: idClienteNC,
          sucursalFisicaId,
          idDivisionEmpresa: idDivisionNC,
          puntoVenta,
          total: Math.abs(parseFloat(venta.total) || 0),
          condicionIva: condicionIvaNC,
          descripcion: `DIFERENCIA EN PRECIO DE GONDOLA - ${descripcionItems}`,
          operadorMovilUser: operadorNC,
          comprobanteOriginal,
          ventaPosId: ventaId,
          idVendedor: vendedorCentumIdNC,
        })
      } else {
        resultado = await crearNotaCreditoPOS({
          idCliente: idClienteNC,
          sucursalFisicaId,
          idDivisionEmpresa: idDivisionNC,
          puntoVenta,
          items: itemsPositivos,
          total: Math.abs(parseFloat(venta.total) || 0),
          condicionIva: condicionIvaNC,
          operadorMovilUser: operadorNC,
          comprobanteOriginal,
          ventaPosId: ventaId,
          idVendedor: vendedorCentumIdNC,
        })
      }
      }
    } else {
      resultado = await crearVentaPOS({
        idCliente: venta.id_cliente_centum || 2,
        sucursalFisicaId,
        idDivisionEmpresa,
        puntoVenta,
        items,
        pagos,
        total: parseFloat(venta.total) || 0,
        condicionIva,
        operadorMovilUser,
        ventaPosId: ventaId,
        idVendedor: vendedorCentumId,
      })
    }

    const numDoc = resultado.NumeroDocumento
    const comprobante = numDoc
      ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
      : null

    await supabase
      .from('ventas_pos')
      .update({
        id_venta_centum: resultado.IdVenta || null,
        centum_comprobante: comprobante,
        centum_sync: true,
        centum_error: null,
        numero_cae: resultado.CAE || null,
      })
      .eq('id', ventaId)

    logger.info(`[Centum POS] Reenvío venta ${ventaId} OK: IdVenta=${resultado.IdVenta}, Comprobante=${comprobante}`)
    // Obtener CAE (await para que la respuesta ya lo incluya)
    const cae = await fetchAndSaveCAE(ventaId, resultado.IdVenta)
    return res.json({ ok: true, comprobante, idVentaCentum: resultado.IdVenta, cae })

  } catch (err) {
    logger.error(`[Centum POS] Error reenvío venta ${req.params.id}:`, err.message)

    try {
      // Marcar como UNVERIFIED — el cron verificará en BI antes de reintentar
      await supabase
        .from('ventas_pos')
        .update({
          centum_error: `UNVERIFIED|reenvío manual: ${(err.message || '').slice(0, 150)}`,
          centum_ultimo_intento: new Date().toISOString(),
        })
        .eq('id', req.params.id)
    } catch (_) { /* ignorar error al guardar */ }

    res.status(500).json({ error: err.message })
  }
}))

// ===================== BLOQUEOS DE PEDIDOS =====================

// GET /api/pos/bloqueos — listar bloqueos activos
router.get('/bloqueos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pedidos_bloqueos')
      .select('*')
      .eq('activo', true)
      .order('tipo', { ascending: true })
      .order('dia_semana', { ascending: true })
      .order('fecha', { ascending: true })
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// POST /api/pos/bloqueos — crear bloqueo
router.post('/bloqueos', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { tipo, dia_semana, fecha, turno, aplica_a, motivo } = req.body
    if (!tipo || !turno) return res.status(400).json({ error: 'tipo y turno son requeridos' })
    if (tipo === 'semanal' && (dia_semana === undefined || dia_semana === null)) return res.status(400).json({ error: 'dia_semana es requerido para bloqueo semanal' })
    if (tipo === 'fecha' && !fecha) return res.status(400).json({ error: 'fecha es requerida para bloqueo por fecha' })

    const { data, error } = await supabase
      .from('pedidos_bloqueos')
      .insert({ tipo, dia_semana: tipo === 'semanal' ? dia_semana : null, fecha: tipo === 'fecha' ? fecha : null, turno, aplica_a: aplica_a || 'todos', motivo: motivo || null })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// DELETE /api/pos/bloqueos/:id — eliminar bloqueo
router.delete('/bloqueos/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase
      .from('pedidos_bloqueos')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/pos/bloqueos/verificar — verificar si una fecha/turno/tipo está bloqueado
router.get('/bloqueos/verificar', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { fecha, turno, tipo_pedido } = req.query
    if (!fecha) return res.status(400).json({ error: 'fecha es requerida' })

    const diaSemana = new Date(fecha + 'T12:00:00').getDay()

    const { data, error } = await supabase
      .from('pedidos_bloqueos')
      .select('*')
      .eq('activo', true)

    if (error) throw error

    const bloqueo = (data || []).find(b => {
      // Verificar si aplica al tipo de pedido
      if (b.aplica_a !== 'todos' && b.aplica_a !== tipo_pedido) return false
      // Verificar turno: si no se envía turno (retiro), solo aplican bloqueos con turno=todo
      if (!turno && b.turno !== 'todo') return false
      if (turno && b.turno !== 'todo' && b.turno !== turno) return false
      // Verificar fecha
      if (b.tipo === 'fecha' && b.fecha === fecha) return true
      if (b.tipo === 'semanal' && b.dia_semana === diaSemana) return true
      return false
    })

    res.json({ bloqueado: !!bloqueo, bloqueo: bloqueo || null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/pos/favoritos — obtener lista global de favoritos
router.get('/favoritos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('favoritos_pos')
      .select('articulo_ids')
      .eq('id', 1)
      .single()

    if (error || !data) {
      return res.json({ articulo_ids: [] })
    }

    res.json({ articulo_ids: data.articulo_ids || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// POST /api/pos/favoritos — guardar lista global de favoritos (solo admin)
router.post('/favoritos', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { articulo_ids } = req.body

    if (!Array.isArray(articulo_ids)) {
      return res.status(400).json({ error: 'articulo_ids debe ser un array' })
    }

    const { data, error } = await supabase
      .from('favoritos_pos')
      .upsert({ id: 1, articulo_ids }, { onConflict: 'id' })
      .select('articulo_ids')
      .single()

    if (error) throw error

    res.json({ articulo_ids: data.articulo_ids })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/pos/consulta-data
// Devuelve sucursales con mostrar_en_consulta + stock multi-sucursal para pestaña Consulta
router.get('/consulta-data', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // Sucursales visibles en consulta
    const { data: sucursales, error: errSuc } = await supabase
      .from('sucursales')
      .select('id, nombre, centum_sucursal_id')
      .eq('mostrar_en_consulta', true)
      .order('nombre')

    if (errSuc) throw errSuc

    // Todo el stock cacheado
    const BATCH = 1000
    let allStock = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('stock_sucursales')
        .select('id_centum, centum_sucursal_id, existencias')
        .range(from, from + BATCH - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      allStock = allStock.concat(data)
      if (data.length < BATCH) break
      from += BATCH
    }

    res.json({ sucursales: sucursales || [], stock: allStock })
  } catch (err) {
    logger.error('Error consulta-data:', err)
    res.status(500).json({ error: 'Error al obtener datos de consulta' })
  }
}))

// POST /api/pos/emails-pendientes/enviar — re-enviar emails de Factura A que no se enviaron
// Auth: verificarAuth normal O header X-Admin-Key con SUPABASE_SERVICE_KEY
router.post('/emails-pendientes/enviar', asyncHandler(async (req, res) => {
  const adminKey = req.headers['x-admin-key']
  if (adminKey && adminKey === process.env.SUPABASE_SERVICE_KEY) {
    // OK — acceso admin directo
  } else {
    // Fallback a auth normal
    return verificarAuth(req, res, () => handleEmailBatch(req, res))
  }
  return handleEmailBatch(req, res)
}))

async function handleEmailBatch(req, res) {
  try {
    const { enviarComprobanteAutomatico } = require('../services/centumVentasPOS')

    // Buscar ventas con CAE, cliente asignado, email no enviado
    const { data: ventas, error } = await supabase
      .from('ventas_pos')
      .select('id, numero_venta, numero_cae, id_cliente_centum')
      .eq('email_enviado', false)
      .not('numero_cae', 'is', null)
      .gt('id_cliente_centum', 0)
      .order('numero_venta', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })

    let enviados = 0, fallidos = 0, saltados = 0
    const detalles = []

    for (const v of (ventas || [])) {
      try {
        // Obtener CAE vencimiento de Centum (best effort, no bloquea)
        await enviarComprobanteAutomatico(v.id, v.numero_cae, null)
        // Verificar si realmente se envió (pudo haber saltado por sin email, esPrueba, etc)
        const { data: check } = await supabase.from('ventas_pos').select('email_enviado').eq('id', v.id).single()
        if (check?.email_enviado) {
          enviados++
          detalles.push({ venta: v.numero_venta, status: 'enviado' })
        } else {
          saltados++
          detalles.push({ venta: v.numero_venta, status: 'saltado (sin email/prueba/CF)' })
        }
      } catch (err) {
        fallidos++
        detalles.push({ venta: v.numero_venta, status: 'error', error: err.message })
        logger.error(`[Email Batch] Error venta ${v.numero_venta}:`, err.message)
      }
    }

    logger.info(`[Email Batch] Resultado: ${enviados} enviados, ${saltados} saltados, ${fallidos} fallidos de ${(ventas || []).length} pendientes`)
    res.json({ total: (ventas || []).length, enviados, saltados, fallidos, detalles })
  } catch (err) {
    logger.error('[Email Batch] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
}

// GET /api/pos/ventas/:id/comprobante.pdf — descarga pública de comprobante (con token HMAC)
router.get('/ventas/:id/comprobante.pdf', asyncHandler(async (req, res) => {
  try {
    const { token } = req.query
    const ventaId = req.params.id
    const tokenEsperado = generarTokenDescarga(ventaId)
    if (!token || token !== tokenEsperado) {
      return res.status(403).json({ error: 'Token inválido' })
    }

    const { data: venta, error: ventaErr } = await supabase.from('ventas_pos').select('*').eq('id', ventaId).single()
    if (ventaErr || !venta) return res.status(404).json({ error: 'Venta no encontrada' })

    // Obtener datos del cliente y CAE
    let caeData = { cae: null, cae_vencimiento: null, esFacturaA: false, cliente: null }
    if (venta.id_cliente_centum && venta.id_cliente_centum > 0) {
      const { data: cli } = await supabase.from('clientes')
        .select('razon_social, cuit, direccion, localidad, codigo_postal, telefono, condicion_iva, codigo')
        .eq('id_centum', venta.id_cliente_centum).single()
      if (cli) {
        const condIva = cli.condicion_iva || venta.condicion_iva || 'CF'
        caeData.esFacturaA = condIva === 'RI' || condIva === 'MT'
        caeData.cliente = cli
      }
    }

    // Obtener CAE
    if (venta.cae) {
      caeData.cae = venta.cae
      caeData.cae_vencimiento = venta.cae_vencimiento
    } else if (venta.id_venta_centum) {
      try {
        const centumData = await obtenerVentaCentum(venta.id_venta_centum)
        caeData.cae = centumData.CAE || null
        caeData.cae_vencimiento = centumData.FechaVencimientoCAE || null
      } catch (err) {
        logger.error('[PDF] Error obteniendo CAE:', err.message)
      }
    }

    if (!caeData.cae) {
      return res.status(400).json({ error: 'Este comprobante aún no tiene CAE' })
    }

    // Generar HTML y PDF
    const { generarComprobanteHTML } = require('../services/comprobanteHTML')
    const comprobanteHTML = await generarComprobanteHTML(venta, caeData)

    const { generarPDF } = require('../services/pdfGenerator')
    const pdfBuffer = await generarPDF(comprobanteHTML)

    const esNC = venta.tipo === 'nota_credito'
    const tipoDoc = esNC ? 'Nota_de_Credito' : 'Comprobante'
    const numDoc = (venta.centum_comprobante || `${venta.numero_venta || ''}`).replace(/\s+/g, '_')

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${tipoDoc}_${numDoc}.pdf"`)
    res.send(pdfBuffer)
  } catch (err) {
    logger.error('[PDF] Error generando comprobante:', err.message)
    res.status(500).json({ error: 'Error generando comprobante' })
  }
}))

module.exports = router
