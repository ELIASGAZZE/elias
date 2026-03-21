// Rutas para el Punto de Venta (POS) con promociones locales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { sincronizarERP } = require('../services/syncERP')
const { registrarVentaPOSEnCentum, crearVentaPOS, crearNotaCreditoPOS, crearNotaCreditoConceptoPOS, extraerPuntoVentaDeComprobante, obtenerVentaCentum, fetchAndSaveCAE, retrySyncCAE } = require('../services/centumVentasPOS')
const OPERADOR_MOVIL_USER_PRUEBA = process.env.CENTUM_OPERADOR_PRUEBA_USER || 'api123'

// GET /api/pos/articulos
// Lee artículos con precios minoristas desde la tabla local (sincronizada 1x/día)
router.get('/articulos', verificarAuth, async (req, res) => {
  try {
    const campos = 'id, id_centum, codigo, nombre, rubro, subrubro, rubro_id_centum, subrubro_id_centum, marca, precio, descuento1, descuento2, descuento3, iva_tasa, es_pesable, codigos_barras, atributos, updated_at'

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
    }))

    res.json({ articulos, total: articulos.length })
  } catch (err) {
    console.error('[POS] Error al obtener artículos:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pos/sincronizar-articulos (admin/gestor)
// Sincroniza artículos desde Centum manualmente
router.post('/sincronizar-articulos', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const resultado = await sincronizarERP('manual_pos')
    res.json(resultado)
  } catch (err) {
    console.error('[POS] Error al sincronizar artículos:', err.message)
    res.status(500).json({ error: 'Error al sincronizar: ' + err.message })
  }
})

// ============ ARTÍCULOS DELIVERY ============

// GET /api/pos/articulos-delivery — artículos con precio delivery configurado
router.get('/articulos-delivery', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('articulos_delivery')
      .select('id, articulo_id_centum, nombre, precio_delivery, activo')
      .order('nombre')
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('[POS] Error al obtener artículos delivery:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pos/articulos-delivery — upsert artículo delivery (admin)
router.post('/articulos-delivery', verificarAuth, soloAdmin, async (req, res) => {
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
    console.error('[POS] Error al guardar artículo delivery:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/pos/articulos-delivery/:id — eliminar config delivery (admin)
router.delete('/articulos-delivery/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('articulos_delivery')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[POS] Error al eliminar artículo delivery:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ============ RUBROS / SUBRUBROS ============

// GET /api/pos/rubros — rubros distintos de artículos Centum
router.get('/rubros', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error al obtener rubros:', err.message)
    res.status(500).json({ error: 'Error al obtener rubros' })
  }
})

// GET /api/pos/marcas — marcas distintas de artículos
router.get('/marcas', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error al obtener marcas:', err.message)
    res.status(500).json({ error: 'Error al obtener marcas' })
  }
})

// GET /api/pos/subrubros — subrubros distintos de artículos Centum
router.get('/subrubros', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error al obtener subrubros:', err.message)
    res.status(500).json({ error: 'Error al obtener subrubros' })
  }
})

// GET /api/pos/atributos-articulo
// Lista atributos únicos desde la columna JSONB de artículos
router.get('/atributos-articulo', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error al listar atributos:', err.message)
    res.status(500).json({ error: 'Error al listar atributos' })
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

// POST /api/pos/promociones (admin/gestor)
router.post('/promociones', verificarAuth, soloGestorOAdmin, async (req, res) => {
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
    console.error('[POS] Error al crear promoción:', err.message)
    res.status(500).json({ error: 'Error al crear promoción: ' + err.message })
  }
})

// PUT /api/pos/promociones/:id (admin/gestor)
router.put('/promociones/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
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
    console.error('[POS] Error al editar promoción:', err.message)
    res.status(500).json({ error: 'Error al editar promoción: ' + err.message })
  }
})

// DELETE /api/pos/promociones/:id (admin/gestor) — soft delete
router.delete('/promociones/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
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
    const { id_cliente_centum, nombre_cliente, items, promociones_aplicadas, subtotal, descuento_total, total, monto_pagado, vuelto, pagos, descuento_forma_pago, pedido_pos_id, saldo_aplicado, gift_cards_aplicadas, gift_cards_a_activar, caja_id, canal, descuento_grupo_cliente, grupo_descuento_nombre } = req.body

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

    // Determinar sucursal desde la caja (no del perfil del cajero)
    let sucursalDeCaja = null
    if (caja_id) {
      const { data: cajaInfo } = await supabase.from('cajas').select('sucursal_id').eq('id', caja_id).single()
      sucursalDeCaja = cajaInfo?.sucursal_id || null
    }

    // Si solo hay gift cards (sin artículos), no crear ventas_pos
    let data = null
    if (tieneItems) {
      const insertData = {
        cajero_id: req.perfil.id,
        sucursal_id: sucursalDeCaja || req.perfil.sucursal_id || null,
        caja_id: caja_id || null,
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
        descuento_grupo_cliente: parseFloat(descuento_grupo_cliente) || 0,
        grupo_descuento_nombre: grupo_descuento_nombre || null,
      }
      if (pedido_pos_id) insertData.pedido_pos_id = pedido_pos_id
      if (canal && canal !== 'pos') insertData.canal = canal

      const { data: ventaData, error } = await supabase
        .from('ventas_pos')
        .insert(insertData)
        .select()
        .single()

      if (error) throw error
      data = ventaData

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
            cajero_id: req.usuario.id,
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
              if (logErr) console.warn('[POS] No se pudo registrar cambios de precio:', logErr.message)
              else console.log(`[POS] ${registros.length} cambio(s) de precio registrados para venta ${data.id}`)
            })
        }
      }

      // Registrar venta en Centum ERP (async, no bloquea la respuesta)
      if (data) {
        (async () => {
          try {
            console.log(`[Centum POS] Intentando registrar venta ${data.id} (caja_id=${caja_id || 'null'})`)
            let puntoVenta, sucursalFisicaId, centumOperadorEmpresa, centumOperadorPrueba

            if (caja_id) {
              // Obtener config de caja y sucursal
              const { data: cajaData } = await supabase
                .from('cajas')
                .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
                .eq('id', caja_id)
                .single()

              puntoVenta = cajaData?.punto_venta_centum
              sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
              centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
              centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
            }

            if (!puntoVenta || !sucursalFisicaId) {
              const falta = !caja_id
                ? 'La venta no tiene caja asignada'
                : !puntoVenta
                  ? 'La caja no tiene punto de venta Centum configurado'
                  : 'La sucursal no tiene ID de sucursal física Centum configurado'
              const errorMsg = `Sin config Centum: ${falta}. Configure el punto de venta en la caja y reenvíe manualmente.`
              console.log(`[Centum POS] ${errorMsg}`)
              await supabase
                .from('ventas_pos')
                .update({ centum_error: errorMsg })
                .eq('id', data.id)
              return
            }

            // Si el cliente no tiene id_centum, intentar resolver desde DB local
            if (!data.id_cliente_centum || data.id_cliente_centum === 0) {
              if (data.nombre_cliente && data.nombre_cliente !== 'Consumidor Final') {
                const { data: cliLocal } = await supabase
                  .from('clientes')
                  .select('id_centum')
                  .ilike('razon_social', data.nombre_cliente)
                  .not('id_centum', 'is', null)
                  .gt('id_centum', 0)
                  .limit(1)
                  .single()
                if (cliLocal?.id_centum) {
                  data.id_cliente_centum = cliLocal.id_centum
                  await supabase.from('ventas_pos').update({ id_cliente_centum: cliLocal.id_centum }).eq('id', data.id)
                  console.log(`[Centum POS] Cliente resuelto: ${data.nombre_cliente} → id_centum=${cliLocal.id_centum}`)
                } else {
                  const errorMsg = `Cliente "${data.nombre_cliente}" aún no tiene ID en Centum. Se reintentará automáticamente.`
                  console.log(`[Centum POS] ${errorMsg}`)
                  await supabase.from('ventas_pos').update({ centum_error: errorMsg }).eq('id', data.id)
                  return
                }
              }
            }

            const resultado = await registrarVentaPOSEnCentum(data, {
              sucursalFisicaId,
              puntoVenta,
              centum_operador_empresa: centumOperadorEmpresa,
              centum_operador_prueba: centumOperadorPrueba,
            })

            if (resultado) {
              // Armar comprobante legible: "B PV9-7"
              const numDoc = resultado.NumeroDocumento
              const comprobante = numDoc
                ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
                : null

              // Guardar referencia de Centum en la venta local
              await supabase
                .from('ventas_pos')
                .update({
                  id_venta_centum: resultado.IdVenta || null,
                  centum_comprobante: comprobante,
                  centum_sync: true,
                  centum_error: null,
                  numero_cae: resultado.CAE || null,
                })
                .eq('id', data.id)
              console.log(`[Centum POS] Venta ${data.id} registrada en Centum: IdVenta=${resultado.IdVenta}, Comprobante=${comprobante}`)
              // Obtener CAE desde Centum (best effort, async)
              fetchAndSaveCAE(data.id, resultado.IdVenta)
            } else {
              await supabase
                .from('ventas_pos')
                .update({ centum_error: 'Centum no retornó resultado (posible error interno)' })
                .eq('id', data.id)
            }
          } catch (err) {
            console.error(`[Centum POS] Error async al registrar venta ${data.id}:`, err.message)
            await supabase
              .from('ventas_pos')
              .update({ centum_error: err.message })
              .eq('id', data.id).catch(updateErr => console.error(`[Centum POS] No se pudo guardar centum_error para venta ${data.id}:`, updateErr.message))
          }
        })()
      }
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
            console.error(`[POS] Gift card ${gc.codigo} conflicto de concurrencia — saldo cambió durante la operación`)
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

// GET /api/pos/ventas/reportes/promociones?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Datos crudos de ventas para reporte de promociones (admin/gestor)
router.get('/ventas/reportes/promociones', verificarAuth, soloGestorOAdmin, async (req, res) => {
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

    // Mapear nombre cajero al nivel raíz
    const ventas = allData.map(v => ({
      ...v,
      cajero_nombre: v.perfiles?.nombre || 'Sin nombre',
    }))

    res.json({ ventas })
  } catch (err) {
    console.error('[POS] Error reporte promociones:', err.message)
    res.status(500).json({ error: 'Error al generar reporte de promociones' })
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

    // Filtro por número de factura (POS o Centum) — tiene prioridad sobre otros filtros
    const numFactura = req.query.numero_factura?.trim()
    if (numFactura) {
      // numero_venta es integer, centum_comprobante es texto tipo "B PV2-7740"
      const esNumero = /^\d+$/.test(numFactura)
      if (esNumero) {
        // Buscar nro exacto en POS, o que el comprobante Centum termine con ese número (después del guión)
        query = query.or(`numero_venta.eq.${numFactura},centum_comprobante.ilike.%-${numFactura}`)
      } else {
        query = query.ilike('centum_comprobante', `%${numFactura}%`)
      }
      query = query.limit(50)
    }
    // Filtros normales (fecha, cliente, etc.)
    else {
      const buscar = req.query.buscar?.trim()
      if (buscar) {
        query = query.ilike('nombre_cliente', `%${buscar}%`)
      }
      // Aplicar fecha si viene (ya no es obligatoria)
      if (req.query.fecha) {
        const desde = `${req.query.fecha}T00:00:00`
        const hasta = `${req.query.fecha}T23:59:59`
        query = query.gte('created_at', desde).lte('created_at', hasta)
      }
      query = query.limit(50)
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
        const items = (() => { try { return typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || []) } catch { return [] } })()
        return items.some(i => (i.nombre || '').toLowerCase().includes(articulo))
      })
    }

    // Lookup nombres de cajas (no hay FK en Supabase)
    const cajaIds = [...new Set(ventas.map(v => v.caja_id).filter(Boolean))]
    let cajasMap = {}
    if (cajaIds.length > 0) {
      const { data: cajasData } = await supabase.from('cajas').select('id, nombre').in('id', cajaIds)
      if (cajasData) cajasData.forEach(c => { cajasMap[c.id] = c.nombre })
    }
    ventas = ventas.map(v => ({ ...v, cajas: v.caja_id && cajasMap[v.caja_id] ? { nombre: cajasMap[v.caja_id] } : null }))

    // Clasificar ventas: EMPRESA o PRUEBA
    // RI/MT (Factura A) → siempre EMPRESA
    // CF + solo efectivo/saldo/gift_card/cta_cte → PRUEBA
    // CF + pago electrónico → EMPRESA
    const clienteIds = [...new Set(ventas.map(v => v.id_cliente_centum).filter(Boolean))]
    let condicionesIva = {}
    if (clienteIds.length > 0) {
      const { data: clientes } = await supabase
        .from('clientes')
        .select('id_centum, condicion_iva')
        .in('id_centum', clienteIds)
      if (clientes) {
        clientes.forEach(c => { condicionesIva[c.id_centum] = c.condicion_iva })
      }
    }
    const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    ventas = ventas.map(v => {
      const condIva = condicionesIva[v.id_cliente_centum] || 'CF'
      const esFacturaA = condIva === 'RI' || condIva === 'MT'
      if (esFacturaA) return { ...v, clasificacion: 'EMPRESA' }
      const pagos = Array.isArray(v.pagos) ? v.pagos : []
      const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
      return { ...v, clasificacion: soloEfectivo ? 'PRUEBA' : 'EMPRESA' }
    })

    // Filtro por clasificación
    if (req.query.clasificacion) {
      ventas = ventas.filter(v => v.clasificacion === req.query.clasificacion.toUpperCase())
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
      .select('*, perfiles:cajero_id(nombre), sucursales:sucursal_id(nombre), pedido:pedido_pos_id(id, numero, nombre_cliente)')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' })

    // No-admin solo puede ver sus propias ventas
    if (req.perfil.rol !== 'admin' && data.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta venta' })
    }

    // Clasificar: EMPRESA o PRUEBA
    let condIva = 'CF'
    if (data.id_cliente_centum) {
      const { data: cli } = await supabase.from('clientes').select('condicion_iva, email').eq('id_centum', data.id_cliente_centum).single()
      condIva = cli?.condicion_iva || 'CF'
      if (cli?.email) data.email_cliente = cli.email
    }
    const esFacturaA = condIva === 'RI' || condIva === 'MT'
    const pagos = Array.isArray(data.pagos) ? data.pagos : []
    const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
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

    res.json({ venta: data })
  } catch (err) {
    console.error('[POS] Error al obtener detalle de venta:', err.message)
    res.status(500).json({ error: 'Error al obtener detalle de venta' })
  }
})

// POST /api/pos/ventas/sync-caes — buscar CAE para ventas EMPRESA que aún no tienen
router.post('/ventas/sync-caes', verificarAuth, async (req, res) => {
  try {
    const result = await retrySyncCAE()
    res.json(result)
  } catch (err) {
    console.error('[POS] Error al sincronizar CAEs:', err.message)
    res.status(500).json({ error: 'Error al sincronizar CAEs' })
  }
})

// GET /api/pos/ventas/:id/cae — obtener CAE de AFIP desde Centum
router.get('/ventas/:id/cae', verificarAuth, async (req, res) => {
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

    res.json({ ...baseResponse, cae, cae_vencimiento: caeVto })
  } catch (err) {
    console.error('[POS] Error al obtener CAE:', err.message)
    res.status(500).json({ error: 'Error al obtener CAE: ' + err.message })
  }
})

// POST /api/pos/ventas/:id/enviar-email — enviar comprobante por email
router.post('/ventas/:id/enviar-email', verificarAuth, async (req, res) => {
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
          console.error('[Email] Error obteniendo CAE:', err.message)
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

    // Generar HTML del comprobante y convertir a PDF
    const { generarComprobanteHTML } = require('../services/comprobanteHTML')
    const comprobanteHTML = await generarComprobanteHTML(venta, caeData)

    // Generar PDF con Puppeteer
    const puppeteer = require('puppeteer')
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    await page.setContent(comprobanteHTML, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } })
    await browser.close()

    // Determinar tipo y número para el asunto
    const esNC = venta.tipo === 'nota_credito'
    const tipoDoc = esNC ? 'Nota de Crédito' : 'Comprobante'
    const numDoc = venta.centum_comprobante || `#${venta.numero_venta || ''}`
    const pdfFilename = `${tipoDoc.replace(/ /g, '_')}_${numDoc.replace(/\s+/g, '_')}.pdf`

    // Enviar email con PDF adjunto
    const { enviarEmail } = require('../services/email')
    await enviarEmail({
      to: email.trim(),
      subject: `${tipoDoc} ${numDoc} - Almacen Zaatar`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <p>Estimado/a <strong>${escapeHtml(venta.nombre_cliente || 'Cliente')}</strong>,</p>
        <p>Adjuntamos su comprobante de ${esNC ? 'nota de crédito' : 'compra'} en formato PDF.</p>
        <p style="color:#555;font-size:13px">Número: <strong>${escapeHtml(numDoc)}</strong><br>
        Fecha: ${new Date(venta.created_at).toLocaleDateString('es-AR')}<br>
        Total: <strong>$${parseFloat(venta.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></p>
        <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
        <p style="font-size:11px;color:#999">Comercial Padano SRL - Brasil 313, Rosario<br>
        Este email fue enviado desde un sistema automatizado. No responder a esta dirección.</p>
      </div>`,
      pdfBuffer: Buffer.from(pdfBuffer),
      pdfFilename,
    })

    // Marcar email enviado en la venta
    await supabase.from('ventas_pos').update({
      email_enviado: true,
      email_enviado_a: email.trim(),
      email_enviado_at: new Date().toISOString()
    }).eq('id', req.params.id)

    res.json({ ok: true, mensaje: `Comprobante enviado a ${email.trim()}` })
  } catch (err) {
    console.error('[POS] Error al enviar email:', err.message)
    res.status(500).json({ error: 'Error al enviar email: ' + err.message })
  }
})

function escapeHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// DELETE /api/pos/ventas/:id — eliminar venta no sincronizada con Centum (solo admin)
router.delete('/ventas/:id', verificarAuth, soloAdmin, async (req, res) => {
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

    const { error: delErr } = await supabase
      .from('ventas_pos')
      .delete()
      .eq('id', req.params.id)

    if (delErr) throw delErr

    res.json({ ok: true })
  } catch (err) {
    console.error('[POS] Error al eliminar venta:', err.message)
    res.status(500).json({ error: 'Error al eliminar venta' })
  }
})

// GET /api/pos/ventas/:id/devoluciones — cantidades ya devueltas por item
router.get('/ventas/:id/devoluciones', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error al obtener devoluciones:', err.message)
    res.status(500).json({ error: 'Error al obtener devoluciones' })
  }
})

// ============ PEDIDOS POS ============

// POST /api/pos/pedidos — crear pedido (carrito guardado para retiro posterior)
router.post('/pedidos', verificarAuth, async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, items, total, observaciones, tipo, direccion_entrega, sucursal_retiro, estado, fecha_entrega, total_pagado, turno_entrega, sucursal_id } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items es requerido' })
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
        query = query.gte('created_at', `${fecha}T00:00:00`).lte('created_at', `${fecha}T23:59:59`)
      }
      if (sucursal_id) {
        query = query.eq('sucursal_id', sucursal_id)
      }
    }

    const { data, error } = await query
    if (error) throw error

    res.json({ pedidos: data || [] })
  } catch (err) {
    console.error('[POS] Error al listar pedidos:', err.message)
    res.status(500).json({ error: 'Error al listar pedidos' })
  }
})

// GET /api/pos/pedidos/guia-delivery — pedidos delivery para guía de envíos
router.get('/pedidos/guia-delivery', verificarAuth, async (req, res) => {
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

    res.json({ pedidos: data || [] })
  } catch (err) {
    console.error('[POS] Error al obtener guía delivery:', err.message)
    res.status(500).json({ error: 'Error al obtener guía delivery' })
  }
})

// ============ GUIAS DELIVERY ============

// GET /api/pos/guias-delivery — listar guías
router.get('/guias-delivery', verificarAuth, async (req, res) => {
  try {
    const { fecha, estado } = req.query
    let query = supabase
      .from('guias_delivery')
      .select('*, guia_delivery_pedidos(*, pedido:pedidos_pos(id, numero, nombre_cliente, total, observaciones, items))')
      .order('fecha', { ascending: false })

    if (fecha) query = query.eq('fecha', fecha)
    if (estado) query = query.eq('estado', estado)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/pos/guias-delivery/:id — detalle de una guía
router.get('/guias-delivery/:id', verificarAuth, async (req, res) => {
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
})

// POST /api/pos/guias-delivery/despachar — crear guía + ventas automáticas + cambiar estado pedidos
router.post('/guias-delivery/despachar', verificarAuth, async (req, res) => {
  try {
    const { fecha, turno, cadete_id, cadete_nombre, cambio_entregado, caja_id } = req.body
    if (!fecha || !turno) return res.status(400).json({ error: 'fecha y turno son requeridos' })
    if (!caja_id) return res.status(400).json({ error: 'caja_id es requerido (caja delivery)' })

    // Verificar que no exista guía para fecha+turno
    const { data: existente } = await supabase
      .from('guias_delivery')
      .select('id')
      .eq('fecha', fecha)
      .eq('turno', turno)
      .single()

    if (existente) return res.status(400).json({ error: `Ya existe una guía despachada para ${fecha} turno ${turno}` })

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

    // Obtener config de caja para Centum
    const { data: cajaData } = await supabase
      .from('cajas')
      .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
      .eq('id', caja_id)
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

      // Crear venta_pos para cada pedido
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
        caja_id,
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

      const { data: venta, error: errVenta } = await supabase
        .from('ventas_pos')
        .insert(insertVenta)
        .select()
        .single()

      if (errVenta) {
        console.error(`[Guía Delivery] Error creando venta para pedido ${pedido.id}:`, errVenta.message)
        continue
      }

      ventasCreadas.push(venta)

      // Registrar en Centum ERP (async)
      if (venta && cajaData?.punto_venta_centum && cajaData?.sucursales?.centum_sucursal_id) {
        ;(async () => {
          try {
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
              console.log(`[Guía Delivery] Venta ${venta.id} registrada en Centum: ${comprobante}`)
              fetchAndSaveCAE(venta.id, resultado.IdVenta)
            }
          } catch (err) {
            console.error(`[Guía Delivery] Error Centum para venta ${venta.id}:`, err.message)
            await supabase.from('ventas_pos').update({ centum_error: err.message }).eq('id', venta.id).catch(e => console.error(`[Guía Delivery] No se pudo guardar centum_error para venta ${venta.id}:`, e.message))
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
      if (errGP) console.error('[Guía Delivery] Error insertando guia_delivery_pedidos:', errGP.message)
    }

    // Cambiar estado de todos los pedidos a 'entregado'
    const pedidoIds = pedidos.map(p => p.id)
    await supabase
      .from('pedidos_pos')
      .update({ estado: 'entregado' })
      .in('id', pedidoIds)

    // Crear cierre delivery en Control Caja POS (pendiente de verificación)
    const cambioNum = parseFloat(cambio_entregado) || 0
    const totalADevolver = totalEfectivo + cambioNum
    const fechaFormateada = fecha.split('-').reverse().join('/')
    const labelDelivery = `Delivery ${fechaFormateada} ${turno}`

    const { data: cierreDelivery, error: errCierre } = await supabase
      .from('cierres_pos')
      .insert({
        caja_id,
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
      console.error('[Guía Delivery] Error creando cierre delivery:', errCierre.message)
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
        console.log(`[Guía Delivery] Retiro de $${cambioNum} registrado en cierre ${cierreAbierto.id}`)
      } else {
        console.log('[Guía Delivery] No hay caja abierta para registrar retiro del cambio')
      }
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
      ventas_creadas: ventasCreadas.length,
      pedidos_despachados: pedidoIds.length,
      total_efectivo: totalEfectivo,
      total_anticipado: totalAnticipado,
      total_descuento: totalDescuento,
      descuento_efectivo_pct: descEfectivoPct,
      cambio_entregado: cambioNum,
      total_a_devolver: totalADevolver,
      cierre_delivery_id: cierreDelivery?.id || null,
    })
  } catch (err) {
    console.error('[Guía Delivery] Error al despachar:', err.message)
    res.status(500).json({ error: 'Error al despachar guía: ' + err.message })
  }
})

// PUT /api/pos/guias-delivery/:id/cerrar — cierre delivery (cuando vuelve el cadete)
router.put('/guias-delivery/:id/cerrar', verificarAuth, async (req, res) => {
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
        const { data: pedidoData } = await supabase.from('pedidos_pos').select('id_cliente_centum, nombre_cliente, numero').eq('id', pe.id).single()
        if (pedidoData && pedidoData.id_cliente_centum) {
          await supabase.from('movimientos_saldo_pos').insert({
            id_cliente_centum: pedidoData.id_cliente_centum,
            nombre_cliente: pedidoData.nombre_cliente || 'Cliente',
            monto: parseFloat(gp.monto) || 0,
            motivo: `No entregado - Pedido #${pedidoData.numero || pe.id}`,
            pedido_pos_id: pe.id,
            created_by: req.perfil.id,
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
    console.error('[Guía Delivery] Error al cerrar:', err.message)
    res.status(500).json({ error: 'Error al cerrar guía: ' + err.message })
  }
})

// GET /api/pos/pedidos/articulos-por-dia — artículos necesarios agrupados por fecha de entrega
router.get('/pedidos/articulos-por-dia', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error artículos por día:', err.message)
    res.status(500).json({ error: 'Error al obtener artículos por día' })
  }
})

// PUT /api/pos/pedidos/:id — editar items/total/observaciones de un pedido pendiente
router.put('/pedidos/:id', verificarAuth, async (req, res) => {
  try {
    const { items, total, observaciones, tipo, fecha_entrega, direccion_entrega, nombre_cliente, id_cliente_centum, turno_entrega, sucursal_id } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items es requerido' })
    }
    if (total == null || total <= 0) {
      return res.status(400).json({ error: 'total debe ser mayor a 0' })
    }

    // Validar perecederos si cambia fecha_entrega
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

// PUT /api/pos/pedidos/:id/pago — registrar pago en caja de un pedido pendiente
router.put('/pedidos/:id/pago', verificarAuth, async (req, res) => {
  try {
    const { total_pagado, observaciones } = req.body

    const { data: pedido } = await supabase
      .from('pedidos_pos')
      .select('id, estado, total, total_pagado')
      .eq('id', req.params.id)
      .single()

    if (!pedido || pedido.estado !== 'pendiente') {
      return res.status(404).json({ error: 'Pedido no encontrado o ya procesado' })
    }

    const nuevoTotalPagado = (parseFloat(pedido.total_pagado) || 0) + (parseFloat(total_pagado) || 0)

    const { data, error } = await supabase
      .from('pedidos_pos')
      .update({
        total_pagado: nuevoTotalPagado,
        observaciones: observaciones || pedido.observaciones || 'PAGO ANTICIPADO',
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error registrando pago de pedido:', err)
    res.status(500).json({ error: 'Error al registrar pago: ' + err.message })
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
// Se valida re-consultando el pago a la API de MP (no se confía en el body)
router.post('/webhook-mp', async (req, res) => {
  try {
    // Validar que el request tenga estructura esperada de MP
    if (!req.body || !req.body.type || !req.body.data) {
      return res.sendStatus(400)
    }
    if (req.body.type === 'payment') {
      const paymentId = req.body.data?.id
      if (!paymentId || isNaN(Number(paymentId))) {
        return res.sendStatus(400)
      }
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

// GET /api/pos/saldos/buscar-cuit?cuit=XXX — buscar saldo por DNI/CUIT
router.get('/saldos/buscar-cuit', verificarAuth, async (req, res) => {
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
    console.error('[POS] Error buscando saldo por CUIT:', err.message)
    res.status(500).json({ error: 'Error al buscar saldo' })
  }
})

// POST /api/pos/saldos/ajuste — ajuste manual de saldo (solo admin)
router.post('/saldos/ajuste', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id_cliente_centum, nombre_cliente, monto, motivo } = req.body
    if (!id_cliente_centum) return res.status(400).json({ error: 'id_cliente_centum requerido' })
    if (!monto || parseFloat(monto) === 0) return res.status(400).json({ error: 'Monto requerido y distinto de 0' })
    if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'Motivo requerido' })

    const { data, error } = await supabase
      .from('movimientos_saldo_pos')
      .insert({
        id_cliente_centum,
        nombre_cliente: nombre_cliente || 'Sin nombre',
        monto: parseFloat(monto),
        motivo: `Ajuste manual: ${motivo.trim()}`,
        created_by: req.perfil.id,
      })
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
    console.error('[POS] Error al ajustar saldo:', err.message)
    res.status(500).json({ error: 'Error al ajustar saldo' })
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
        caja_id: caja_id || null,
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
        // Usar la caja donde se procesa la NC (no la caja de la venta original)
        const cajaParaCentum = caja_id || venta.caja_id
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
        if (venta.id_cliente_centum) {
          const { data: cli } = await supabase
            .from('clientes').select('condicion_iva')
            .eq('id_centum', venta.id_cliente_centum).single()
          condicionIva = cli?.condicion_iva || 'CF'
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
        }).eq('id', notaCredito.id)

        console.log(`[POS] NC Centum creada para devolución: ${comprobante}`)
        fetchAndSaveCAE(notaCredito.id, centumNC.IdVenta)
      } catch (centumErr) {
        console.error('[POS] Error al crear NC en Centum (devolución):', centumErr.message)
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

    const itemsOriginal = (() => { try { return typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || []) } catch { return [] } })()
    const pagosOriginal = (() => { try { return typeof venta.pagos === 'string' ? JSON.parse(venta.pagos) : (venta.pagos || []) } catch { return [] } })()
    const promosOriginal = (() => { try { return venta.promociones_aplicadas ? (typeof venta.promociones_aplicadas === 'string' ? JSON.parse(venta.promociones_aplicadas) : venta.promociones_aplicadas) : null } catch { return null } })()

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
          let condicionIvaOrig = 'CF'
          if (venta.id_cliente_centum) {
            const { data: cli } = await supabase
              .from('clientes').select('condicion_iva')
              .eq('id_centum', venta.id_cliente_centum).single()
            condicionIvaOrig = cli?.condicion_iva || 'CF'
          }
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
          })

          const numDocNC = centumNC.NumeroDocumento
          const comprobanteNC = numDocNC
            ? `${numDocNC.LetraDocumento || ''} PV${numDocNC.PuntoVenta}-${numDocNC.Numero}`
            : null
          await supabase.from('ventas_pos').update({
            id_venta_centum: centumNC.IdVenta || null,
            centum_comprobante: comprobanteNC,
            centum_sync: true,
            numero_cae: centumNC.CAE || null,
          }).eq('id', notaCredito.id)
          centumNCOk = true
          console.log(`[POS] NC Centum corrección cliente: ${comprobanteNC}`)
          fetchAndSaveCAE(notaCredito.id, centumNC.IdVenta)
        } catch (centumErr) {
          console.error('[POS] Error NC Centum (corrección cliente):', centumErr.message)
          await supabase.from('ventas_pos').update({
            centum_error: centumErr.message,
          }).eq('id', notaCredito.id)
        }

        // 2. Nueva FCV al cliente correcto
        try {
          let condicionIvaNuevo = 'CF'
          if (id_cliente_centum) {
            const { data: cli } = await supabase
              .from('clientes').select('condicion_iva')
              .eq('id_centum', id_cliente_centum).single()
            condicionIvaNuevo = cli?.condicion_iva || 'CF'
          }
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
          })

          const numDocFCV = centumFCV.NumeroDocumento
          const comprobanteFCV = numDocFCV
            ? `${numDocFCV.LetraDocumento || ''} PV${numDocFCV.PuntoVenta}-${numDocFCV.Numero}`
            : null
          await supabase.from('ventas_pos').update({
            id_venta_centum: centumFCV.IdVenta || null,
            centum_comprobante: comprobanteFCV,
            centum_sync: true,
            numero_cae: centumFCV.CAE || null,
          }).eq('id', nuevaVenta.id)
          centumFCVOk = true
          console.log(`[POS] FCV Centum corrección cliente: ${comprobanteFCV}`)
          fetchAndSaveCAE(nuevaVenta.id, centumFCV.IdVenta)
        } catch (centumErr) {
          console.error('[POS] Error FCV Centum (corrección cliente):', centumErr.message)
          await supabase.from('ventas_pos').update({
            centum_error: centumErr.message,
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
    console.error('[POS] Error al corregir cliente:', err.message)
    res.status(500).json({ error: 'Error al procesar corrección' })
  }
})

// POST /api/pos/devolucion-precio — diferencia de precio → NC + saldo
router.post('/devolucion-precio', verificarAuth, async (req, res) => {
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
        caja_id: caja_id || null,
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

    // Si la venta original estaba sincronizada con Centum, crear NC por concepto
    let centumNC = null
    if (venta.centum_sync && venta.centum_comprobante) {
      try {
        const pvOriginal = extraerPuntoVentaDeComprobante(venta.centum_comprobante)
        if (!pvOriginal) throw new Error('No se pudo extraer PuntoVenta del comprobante original')

        let sucursalFisicaId = null
        let centumOperadorEmpresa = null
        let centumOperadorPrueba = null
        // Usar la caja donde se procesa la NC (no la caja de la venta original)
        const cajaParaCentum = caja_id || venta.caja_id
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
        if (venta.id_cliente_centum) {
          const { data: cli } = await supabase
            .from('clientes').select('condicion_iva')
            .eq('id_centum', venta.id_cliente_centum).single()
          condicionIva = cli?.condicion_iva || 'CF'
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
        }).eq('id', notaCredito.id)

        console.log(`[POS] NC Concepto Centum creada para dif. precio: ${comprobante}`)
        fetchAndSaveCAE(notaCredito.id, centumNC.IdVenta)
      } catch (centumErr) {
        console.error('[POS] Error NC Concepto Centum (dif. precio):', centumErr.message)
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
    console.error('[POS] Error al procesar corrección de precio:', err.message)
    res.status(500).json({ error: 'Error al procesar corrección de precio' })
  }
})

// POST /api/pos/log-eliminacion
// Registra eliminación de artículos del ticket (auditoría anti-robo)
router.post('/log-eliminacion', verificarAuth, async (req, res) => {
  try {
    const { items, usuario_nombre, cierre_id } = req.body
    if (!items || !items.length) return res.status(400).json({ error: 'Items requeridos' })

    const { error } = await supabase.from('pos_eliminaciones_log').insert({
      usuario_id: req.usuario.id,
      usuario_nombre: usuario_nombre || req.usuario.nombre || 'Desconocido',
      items,
      fecha: new Date().toISOString(),
      cierre_id: cierre_id || null,
    })

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[POS] Error al registrar eliminación:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Reintentar envío de venta a Centum
router.post('/ventas/:id/reenviar-centum', verificarAuth, async (req, res) => {
  try {
    const ventaId = req.params.id

    // Obtener la venta
    const { data: venta, error } = await supabase
      .from('ventas_pos')
      .select('*')
      .eq('id', ventaId)
      .single()

    if (error || !venta) return res.status(404).json({ error: 'Venta no encontrada' })
    if (venta.centum_sync) return res.status(400).json({ error: 'Esta venta ya fue sincronizada con Centum' })

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

    // Obtener condición IVA del cliente
    let condicionIva = 'CF'
    if (venta.id_cliente_centum) {
      const { data: cliente } = await supabase
        .from('clientes')
        .select('condicion_iva')
        .eq('id_centum', venta.id_cliente_centum)
        .single()
      condicionIva = cliente?.condicion_iva || 'CF'
    }

    const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
    const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
    const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
    const idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

    // Obtener operador móvil según división
    const operadorMovilUser = idDivisionEmpresa === 2
      ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
      : (centumOperadorEmpresa || null)

    let resultado
    if (venta.tipo === 'nota_credito') {
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

          // Obtener condición IVA del cliente original
          let condIvaOrig = 'CF'
          if (ventaOrigen.id_cliente_centum) {
            const { data: cliOrig } = await supabase
              .from('clientes').select('condicion_iva')
              .eq('id_centum', ventaOrigen.id_cliente_centum).single()
            condIvaOrig = cliOrig?.condicion_iva || 'CF'
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
        })
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

    console.log(`[Centum POS] Reenvío venta ${ventaId} OK: IdVenta=${resultado.IdVenta}, Comprobante=${comprobante}`)
    // Obtener CAE (await para que la respuesta ya lo incluya)
    const cae = await fetchAndSaveCAE(ventaId, resultado.IdVenta)
    return res.json({ ok: true, comprobante, idVentaCentum: resultado.IdVenta, cae })

  } catch (err) {
    console.error(`[Centum POS] Error reenvío venta ${req.params.id}:`, err.message)

    try {
      await supabase
        .from('ventas_pos')
        .update({ centum_error: err.message })
        .eq('id', req.params.id)
    } catch (_) { /* ignorar error al guardar */ }

    res.status(500).json({ error: err.message })
  }
})

// ===================== BLOQUEOS DE PEDIDOS =====================

// GET /api/pos/bloqueos — listar bloqueos activos
router.get('/bloqueos', verificarAuth, async (req, res) => {
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
})

// POST /api/pos/bloqueos — crear bloqueo
router.post('/bloqueos', verificarAuth, soloAdmin, async (req, res) => {
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
})

// DELETE /api/pos/bloqueos/:id — eliminar bloqueo
router.delete('/bloqueos/:id', verificarAuth, soloAdmin, async (req, res) => {
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
})

// GET /api/pos/bloqueos/verificar — verificar si una fecha/turno/tipo está bloqueado
router.get('/bloqueos/verificar', verificarAuth, async (req, res) => {
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
})

// GET /api/pos/favoritos — obtener lista global de favoritos
router.get('/favoritos', verificarAuth, async (req, res) => {
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
})

// POST /api/pos/favoritos — guardar lista global de favoritos (solo admin)
router.post('/favoritos', verificarAuth, soloAdmin, async (req, res) => {
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
})

module.exports = router
