// Rutas del módulo de traspasos entre sucursales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { ajusteStockNegativo, ajusteStockPositivo } = require('../services/centumAjusteStock')

// ═══════════════════════════════════════════════════════════════
// Stock por sucursal (para mostrar en picker de artículos)
// ═══════════════════════════════════════════════════════════════

router.get('/stock/:sucursalId', verificarAuth, async (req, res) => {
  try {
    // Obtener centum_sucursal_id de la sucursal
    const { data: suc } = await supabase
      .from('sucursales')
      .select('centum_sucursal_id')
      .eq('id', req.params.sucursalId)
      .single()

    if (!suc?.centum_sucursal_id) return res.json({})

    // Traer stock en lotes
    const BATCH = 1000
    let allStock = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('stock_sucursales')
        .select('id_centum, existencias')
        .eq('centum_sucursal_id', suc.centum_sucursal_id)
        .range(from, from + BATCH - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      allStock = allStock.concat(data)
      if (data.length < BATCH) break
      from += BATCH
    }

    // Devolver como mapa { id_centum: existencias }
    const mapa = {}
    for (const s of allStock) mapa[s.id_centum] = s.existencias
    res.json(mapa)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

router.get('/config', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('traspaso_config').select('*')
    if (error) throw error
    const config = {}
    for (const row of (data || [])) config[row.clave] = row.valor
    res.json(config)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/config', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const entries = Object.entries(req.body)
    for (const [clave, valor] of entries) {
      await supabase.from('traspaso_config').upsert({ clave, valor: String(valor) })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard', verificarAuth, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0]

    const { data: ordenes } = await supabase
      .from('ordenes_traspaso')
      .select('estado, recibido_at')
      .not('estado', 'eq', 'cancelado')

    const all = ordenes || []
    const pendientes = all.filter(o => o.estado === 'borrador').length
    const en_preparacion = all.filter(o => o.estado === 'en_preparacion').length
    const preparados = all.filter(o => o.estado === 'preparado').length
    const despachados = all.filter(o => o.estado === 'despachado').length
    const recibidos_hoy = all.filter(o =>
      (o.estado === 'recibido' || o.estado === 'con_diferencia') &&
      o.recibido_at && o.recibido_at.startsWith(hoy)
    ).length

    res.json({ pendientes, en_preparacion, preparados, despachados, recibidos_hoy })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Órdenes CRUD
// ═══════════════════════════════════════════════════════════════

router.get('/ordenes', verificarAuth, async (req, res) => {
  try {
    const { estado, sucursal, desde, hasta } = req.query
    let query = supabase
      .from('ordenes_traspaso')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (estado) query = query.eq('estado', estado)
    if (sucursal) query = query.or(`sucursal_origen_id.eq.${sucursal},sucursal_destino_id.eq.${sucursal}`)
    if (desde) query = query.gte('created_at', desde)
    if (hasta) query = query.lte('created_at', hasta)

    const { data, error } = await query
    if (error) throw error

    // Enriquecer con nombres de sucursal
    const sucursalIds = new Set()
    for (const o of (data || [])) {
      sucursalIds.add(o.sucursal_origen_id)
      sucursalIds.add(o.sucursal_destino_id)
    }
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id, nombre')
      .in('id', [...sucursalIds].length > 0 ? [...sucursalIds] : ['_none_'])

    const sucMap = {}
    for (const s of (sucursales || [])) sucMap[s.id] = s.nombre

    const enriquecidas = (data || []).map(o => ({
      ...o,
      sucursal_origen_nombre: sucMap[o.sucursal_origen_id] || 'Desconocida',
      sucursal_destino_nombre: sucMap[o.sucursal_destino_id] || 'Desconocida',
    }))

    res.json(enriquecidas)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/ordenes/:id', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error) throw error

    // Traer canastos
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('orden_traspaso_id', req.params.id)
      .order('created_at')

    // Traer nombres de sucursal
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id, nombre')
      .in('id', [data.sucursal_origen_id, data.sucursal_destino_id])

    const sucMap = {}
    for (const s of (sucursales || [])) sucMap[s.id] = s.nombre

    res.json({
      ...data,
      canastos: canastos || [],
      sucursal_origen_nombre: sucMap[data.sucursal_origen_id] || 'Desconocida',
      sucursal_destino_nombre: sucMap[data.sucursal_destino_id] || 'Desconocida',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/ordenes', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { sucursal_origen_id, sucursal_destino_id, items, notas } = req.body
    if (!sucursal_origen_id || !sucursal_destino_id) {
      return res.status(400).json({ error: 'Sucursal origen y destino requeridas' })
    }
    if (sucursal_origen_id === sucursal_destino_id) {
      return res.status(400).json({ error: 'Origen y destino deben ser diferentes' })
    }

    // Generar número — contar órdenes existentes + 1 como fallback seguro
    let numero
    try {
      const { count } = await supabase.from('ordenes_traspaso').select('*', { count: 'exact', head: true })
      numero = `OT-${String((count || 0) + 1).padStart(6, '0')}`
    } catch {
      numero = `OT-${Date.now()}`
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .insert({
        numero,
        sucursal_origen_id,
        sucursal_destino_id,
        items: items || [],
        notas,
        creado_por: req.usuario?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Solo editar borradores
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || orden.estado !== 'borrador') {
      return res.status(400).json({ error: 'Solo se pueden editar órdenes en borrador' })
    }

    const { items, notas, sucursal_destino_id } = req.body
    const updates = { updated_at: new Date().toISOString() }
    if (items !== undefined) updates.items = items
    if (notas !== undefined) updates.notas = notas
    if (sucursal_destino_id !== undefined) updates.sucursal_destino_id = sucursal_destino_id

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/ordenes/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || !['borrador', 'en_preparacion'].includes(orden.estado)) {
      return res.status(400).json({ error: 'Solo se pueden cancelar órdenes en borrador o en preparación' })
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Transiciones de estado
// ═══════════════════════════════════════════════════════════════

// GET /api/traspasos/asignar-preparacion
// Busca la orden borrador más antigua, la pasa a en_preparacion y la devuelve
router.get('/asignar-preparacion', verificarAuth, async (req, res) => {
  try {
    // Buscar la orden borrador más antigua
    const { data: orden, error: errBuscar } = await supabase
      .from('ordenes_traspaso')
      .select('id')
      .eq('estado', 'borrador')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (errBuscar || !orden) {
      // Si no hay borradores, buscar si hay alguna en_preparacion sin terminar
      const { data: enPrep } = await supabase
        .from('ordenes_traspaso')
        .select('id')
        .eq('estado', 'en_preparacion')
        .order('updated_at', { ascending: true })
        .limit(1)
        .single()

      if (!enPrep) {
        return res.status(404).json({ error: 'No hay órdenes pendientes de preparación' })
      }
      return res.json({ orden: enPrep, ya_en_preparacion: true })
    }

    // Pasar a en_preparacion
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'en_preparacion',
        preparado_por: req.usuario?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orden.id)
      .eq('estado', 'borrador')
      .select('id')
      .single()

    if (error) throw error
    res.json({ orden: data, ya_en_preparacion: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/iniciar-preparacion', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'en_preparacion',
        preparado_por: req.usuario?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('estado', 'borrador')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'Solo se puede iniciar preparación de órdenes en borrador' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/preparado', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Validar que todos los canastos estén cerrados
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('estado, items')
      .eq('orden_traspaso_id', req.params.id)

    if (!canastos || canastos.length === 0) {
      return res.status(400).json({ error: 'Debe crear al menos un canasto antes de marcar como preparado' })
    }

    const noCerrados = canastos.filter(c => c.estado !== 'cerrado')
    if (noCerrados.length > 0) {
      return res.status(400).json({ error: `Hay ${noCerrados.length} canasto(s) sin cerrar` })
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'preparado',
        preparado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'La orden debe estar en preparación' })

    // Auto-calcular pesos de pesables a partir de escaneos reales
    try {
      // Agregar todos los pesos escaneados por artículo
      const pesosPorArticulo = {}
      for (const c of canastos) {
        for (const item of (c.items || [])) {
          if (item.es_pesable && Array.isArray(item.pesos_escaneados) && item.pesos_escaneados.length > 0) {
            if (!pesosPorArticulo[item.articulo_id]) pesosPorArticulo[item.articulo_id] = []
            pesosPorArticulo[item.articulo_id].push(...item.pesos_escaneados)
          }
        }
      }

      // Actualizar cada artículo pesable con nuevos datos
      for (const [articuloId, pesos] of Object.entries(pesosPorArticulo)) {
        if (pesos.length === 0) continue

        const nuevoMin = Math.min(...pesos)
        const nuevoMax = Math.max(...pesos)
        const nuevoPromedio = pesos.reduce((s, p) => s + p, 0) / pesos.length

        // Buscar artículo por id_centum (articulo_id en traspasos = id_centum)
        const { data: art } = await supabase
          .from('articulos')
          .select('id, peso_promedio_pieza, peso_minimo, peso_maximo, peso_muestras')
          .eq('id_centum', articuloId)
          .single()

        if (!art) continue

        const muestrasAnteriores = art.peso_muestras || 0
        const muestrasNuevas = pesos.length
        const totalMuestras = muestrasAnteriores + muestrasNuevas

        // Promedio acumulativo ponderado
        const promedioAnterior = art.peso_promedio_pieza ? parseFloat(art.peso_promedio_pieza) : nuevoPromedio
        const promedioActualizado = muestrasAnteriores > 0
          ? (promedioAnterior * muestrasAnteriores + nuevoPromedio * muestrasNuevas) / totalMuestras
          : nuevoPromedio

        // Min/Max: expandir rango con datos reales
        const minActualizado = art.peso_minimo
          ? Math.min(parseFloat(art.peso_minimo), nuevoMin)
          : nuevoMin
        const maxActualizado = art.peso_maximo
          ? Math.max(parseFloat(art.peso_maximo), nuevoMax)
          : nuevoMax

        await supabase
          .from('articulos')
          .update({
            peso_promedio_pieza: Math.round(promedioActualizado * 1000) / 1000,
            peso_minimo: Math.round(minActualizado * 1000) / 1000,
            peso_maximo: Math.round(maxActualizado * 1000) / 1000,
            peso_muestras: totalMuestras,
          })
          .eq('id', art.id)
      }
    } catch (pesoErr) {
      console.error('Error actualizando pesos automáticos:', pesoErr)
      // No falla la operación principal
    }

    // ── Artículos faltantes (pendientes) ──
    const { articulos_faltantes, crear_nueva_orden } = req.body || {}
    let nueva_orden_id = null
    let nueva_orden_numero = null

    try {
      // Insertar registros de faltantes si vienen
      if (Array.isArray(articulos_faltantes) && articulos_faltantes.length > 0) {
        const rows = articulos_faltantes.map(f => ({
          orden_traspaso_id: req.params.id,
          articulo_id: f.articulo_id,
          nombre: f.nombre || null,
          codigo: f.codigo || null,
          cantidad_solicitada: f.cantidad_solicitada,
          cantidad_preparada: f.cantidad_preparada,
          cantidad_faltante: f.cantidad_faltante,
          motivo: f.motivo || null,
          sucursal_id: data.sucursal_origen_id,
        }))
        const { error: faltErr } = await supabase
          .from('traspaso_articulos_faltantes')
          .insert(rows)
        if (faltErr) console.error('Error insertando faltantes:', faltErr)
      }

      // Crear nueva orden con los faltantes si se pidió
      if (crear_nueva_orden && Array.isArray(articulos_faltantes) && articulos_faltantes.length > 0) {
        let numero
        try {
          const { count } = await supabase.from('ordenes_traspaso').select('*', { count: 'exact', head: true })
          numero = `OT-${String((count || 0) + 1).padStart(6, '0')}`
        } catch {
          numero = `OT-${Date.now()}`
        }

        const nuevosItems = articulos_faltantes.map(f => ({
          articulo_id: f.articulo_id,
          nombre: f.nombre,
          codigo: f.codigo,
          cantidad_solicitada: f.cantidad_faltante,
          cantidad: f.cantidad_faltante,
        }))

        const { data: nuevaOrden, error: nuevaErr } = await supabase
          .from('ordenes_traspaso')
          .insert({
            numero,
            sucursal_origen_id: data.sucursal_origen_id,
            sucursal_destino_id: data.sucursal_destino_id,
            items: nuevosItems,
            notas: `Pendientes de ${data.numero}`,
            creado_por: req.usuario?.id,
          })
          .select()
          .single()

        if (nuevaErr) {
          console.error('Error creando orden con faltantes:', nuevaErr)
        } else {
          nueva_orden_id = nuevaOrden.id
          nueva_orden_numero = nuevaOrden.numero
        }
      }
    } catch (faltantesErr) {
      console.error('Error procesando faltantes:', faltantesErr)
      // No falla la operación principal
    }

    res.json({ ...data, nueva_orden_id, nueva_orden_numero })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/despachar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .eq('estado', 'preparado')
      .single()

    if (!orden) return res.status(400).json({ error: 'La orden debe estar preparada para despachar' })

    // Ajuste negativo de stock en origen (stub)
    const resultado = await ajusteStockNegativo(
      orden.sucursal_origen_id,
      orden.items || [],
      orden.numero
    )

    // Actualizar canastos a despachado
    await supabase
      .from('traspaso_canastos')
      .update({ estado: 'despachado', updated_at: new Date().toISOString() })
      .eq('orden_traspaso_id', req.params.id)
      .eq('estado', 'cerrado')

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'despachado',
        despachado_por: req.usuario?.id,
        despachado_at: new Date().toISOString(),
        centum_ajuste_origen_id: resultado.ajusteId,
        centum_error: resultado.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error

    // TODO: Push notification a operarios de sucursal destino

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/ordenes/:id/recibir', verificarAuth, async (req, res) => {
  try {
    // Validar que todos los canastos estén verificados
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('orden_traspaso_id', req.params.id)

    if (!canastos || canastos.length === 0) {
      return res.status(400).json({ error: 'No hay canastos para recibir' })
    }

    const estadosFinales = ['aprobado', 'con_diferencia']
    const noVerificados = canastos.filter(c => !estadosFinales.includes(c.estado))
    if (noVerificados.length > 0) {
      return res.status(400).json({ error: `Hay ${noVerificados.length} canasto(s) sin verificar` })
    }

    const hayDiferencias = canastos.some(c => c.estado === 'con_diferencia')

    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .eq('estado', 'despachado')
      .single()

    if (!orden) return res.status(400).json({ error: 'La orden debe estar despachada para recibir' })

    // Ajuste positivo de stock en destino (stub)
    const resultado = await ajusteStockPositivo(
      orden.sucursal_destino_id,
      orden.items || [],
      orden.numero
    )

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: hayDiferencias ? 'con_diferencia' : 'recibido',
        recibido_por: req.usuario?.id,
        recibido_at: new Date().toISOString(),
        centum_ajuste_destino_id: resultado.ajusteId,
        centum_error: resultado.error ? (orden.centum_error ? orden.centum_error + ' | ' + resultado.error : resultado.error) : orden.centum_error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Canastos
// ═══════════════════════════════════════════════════════════════

router.post('/ordenes/:id/canastos', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Validar que la orden esté en preparación
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || orden.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden crear canastos en órdenes en preparación' })
    }

    const { precinto, items, tipo, nombre } = req.body
    const esBulto = tipo === 'bulto'

    if (!esBulto && !precinto) return res.status(400).json({ error: 'Código de precinto requerido' })

    const precintoFinal = esBulto ? `BULTO-${Date.now()}` : precinto

    // Verificar que el precinto no esté en uso en otra orden activa (solo para canastos normales)
    if (!esBulto) {
      const { data: canastosConMismoPrecinto } = await supabase
        .from('traspaso_canastos')
        .select('id, orden_traspaso_id')
        .eq('precinto', precintoFinal)
        .neq('orden_traspaso_id', req.params.id)

      if (canastosConMismoPrecinto && canastosConMismoPrecinto.length > 0) {
        const ordenIds = [...new Set(canastosConMismoPrecinto.map(c => c.orden_traspaso_id))]
        const { data: ordenesActivas } = await supabase
          .from('ordenes_traspaso')
          .select('id, numero, estado')
          .in('id', ordenIds)
          .in('estado', ['en_preparacion', 'preparado'])

        if (ordenesActivas && ordenesActivas.length > 0) {
          const num = ordenesActivas[0].numero || ordenesActivas[0].id.slice(0, 8)
          return res.status(400).json({ error: `Este canasto ya está en uso en la orden #${num} (${ordenesActivas[0].estado.replace(/_/g, ' ')})` })
        }
      }
    }

    const insertData = {
      orden_traspaso_id: req.params.id,
      precinto: precintoFinal,
      items: items || [],
    }
    if (esBulto) {
      insertData.tipo = 'bulto'
      insertData.nombre = nombre || 'Bulto'
    }

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .insert(insertData)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    const { items, peso_origen, precinto } = req.body

    if (!canasto) {
      return res.status(404).json({ error: 'Canasto no encontrado' })
    }
    // Canastos cerrados permiten actualizar peso_origen e items (para mover artículos)
    if (canasto.estado !== 'en_preparacion' && precinto !== undefined) {
      return res.status(400).json({ error: 'No se puede cambiar el precinto de un canasto cerrado' })
    }
    const updates = { updated_at: new Date().toISOString() }
    if (items !== undefined) updates.items = items
    if (peso_origen !== undefined) updates.peso_origen = peso_origen
    if (precinto !== undefined) updates.precinto = precinto

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id/cerrar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden cerrar canastos en preparación' })
    }

    if (!canasto.items || canasto.items.length === 0) {
      // Canasto vacío → eliminarlo
      const { error: delError } = await supabase
        .from('traspaso_canastos')
        .delete()
        .eq('id', req.params.id)
      if (delError) throw delError
      return res.json({ eliminado: true, id: req.params.id })
    }

    // Bultos se cierran directamente sin validación de precinto
    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({ estado: 'cerrado', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id/pesar-destino', verificarAuth, async (req, res) => {
  try {
    const { peso_destino } = req.body
    if (peso_destino === undefined || peso_destino === null) {
      return res.status(400).json({ error: 'peso_destino requerido' })
    }

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'despachado') {
      return res.status(400).json({ error: 'Solo se pueden pesar canastos despachados' })
    }

    // Obtener tolerancia
    const { data: configRows } = await supabase
      .from('traspaso_config')
      .select('valor')
      .eq('clave', 'tolerancia_peso_porcentaje')
      .single()

    const tolerancia = parseFloat(configRows?.valor || '2') / 100
    const pesoOrigen = parseFloat(canasto.peso_origen)
    const pesoDestino = parseFloat(peso_destino)
    const diferenciaPct = Math.abs(pesoDestino - pesoOrigen) / pesoOrigen

    let nuevoEstado
    if (diferenciaPct <= tolerancia) {
      nuevoEstado = 'aprobado'
    } else {
      nuevoEstado = 'verificacion_manual'
    }

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        peso_destino: pesoDestino,
        estado: nuevoEstado,
        verificado_por: req.usuario?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ...data, dentro_tolerancia: nuevoEstado === 'aprobado' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Conteo ciego para bultos en recepción
router.put('/canastos/:id/conteo-ciego', verificarAuth, async (req, res) => {
  try {
    const { items } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items con cantidades recibidas requeridos' })
    }

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'despachado') {
      return res.status(400).json({ error: 'Solo se pueden contar bultos despachados' })
    }

    if (canasto.tipo !== 'bulto') {
      return res.status(400).json({ error: 'Conteo ciego solo aplica a bultos' })
    }

    // Comparar cantidades recibidas vs enviadas
    const itemsCanasto = canasto.items || []
    const diferencias = []
    let hayDiferencias = false

    for (const itemRecibido of items) {
      const itemOriginal = itemsCanasto.find(i => i.articulo_id === itemRecibido.articulo_id)
      const cantidadEsperada = itemOriginal ? itemOriginal.cantidad : 0
      const cantidadRecibida = itemRecibido.cantidad_recibida || 0

      if (cantidadEsperada !== cantidadRecibida) hayDiferencias = true

      diferencias.push({
        articulo_id: itemRecibido.articulo_id,
        nombre: itemOriginal?.nombre || itemRecibido.nombre || '',
        codigo: itemOriginal?.codigo || '',
        cantidad_esperada: cantidadEsperada,
        cantidad_real: cantidadRecibida,
        tipo: cantidadEsperada === cantidadRecibida ? 'ok' : 'diferencia',
      })
    }

    const nuevoEstado = hayDiferencias ? 'con_diferencia' : 'aprobado'

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        estado: nuevoEstado,
        diferencias: hayDiferencias ? diferencias : null,
        verificado_por: req.usuario?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ...data, hay_diferencias: hayDiferencias })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/:id/verificar', verificarAuth, async (req, res) => {
  try {
    const { diferencias } = req.body
    if (!diferencias) return res.status(400).json({ error: 'diferencias requeridas' })

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'verificacion_manual') {
      return res.status(400).json({ error: 'Solo se pueden verificar canastos en verificación manual' })
    }

    const hayDiferencias = diferencias.some(d => d.cantidad_esperada !== d.cantidad_real)

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        diferencias,
        estado: hayDiferencias ? 'con_diferencia' : 'aprobado',
        verificado_por: req.usuario?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/canastos/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'en_preparacion') {
      return res.status(400).json({ error: 'Solo se pueden eliminar canastos en preparación' })
    }

    const { error } = await supabase
      .from('traspaso_canastos')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ═══════════════════════════════════════════════════════════════
// Reparto — escaneo de canastos para despacho
// ═══════════════════════════════════════════════════════════════

router.get('/ordenes-reparto', verificarAuth, async (req, res) => {
  try {
    // Órdenes en estado preparado
    const { data: ordenes, error } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('estado', 'preparado')
      .order('preparado_at', { ascending: true })

    if (error) throw error
    if (!ordenes || ordenes.length === 0) return res.json([])

    // Nombres de sucursal
    const sucursalIds = new Set()
    for (const o of ordenes) {
      sucursalIds.add(o.sucursal_origen_id)
      sucursalIds.add(o.sucursal_destino_id)
    }
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id, nombre')
      .in('id', [...sucursalIds])

    const sucMap = {}
    for (const s of (sucursales || [])) sucMap[s.id] = s.nombre

    // Canastos de cada orden
    const ordenIds = ordenes.map(o => o.id)
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('id, orden_traspaso_id, precinto, estado, tipo, nombre')
      .in('orden_traspaso_id', ordenIds)

    const canastosPorOrden = {}
    for (const c of (canastos || [])) {
      if (!canastosPorOrden[c.orden_traspaso_id]) canastosPorOrden[c.orden_traspaso_id] = []
      canastosPorOrden[c.orden_traspaso_id].push(c)
    }

    const resultado = ordenes.map(o => {
      const cs = canastosPorOrden[o.id] || []
      return {
        ...o,
        sucursal_origen_nombre: sucMap[o.sucursal_origen_id] || 'Desconocida',
        sucursal_destino_nombre: sucMap[o.sucursal_destino_id] || 'Desconocida',
        canastos: cs,
        total_canastos: cs.length,
        canastos_despachados: cs.filter(c => c.estado === 'despachado').length,
      }
    })

    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/canastos/despachar-scan', verificarAuth, async (req, res) => {
  try {
    const { precinto, canasto_id } = req.body
    if (!precinto && !canasto_id) return res.status(400).json({ error: 'Precinto o canasto_id requerido' })

    // Buscar canasto por ID (bultos) o por precinto (canastos normales)
    let canasto, errBuscar
    if (canasto_id) {
      const result = await supabase
        .from('traspaso_canastos')
        .select('*, orden_traspaso_id')
        .eq('id', canasto_id)
        .single()
      canasto = result.data
      errBuscar = result.error
    } else {
      const result = await supabase
        .from('traspaso_canastos')
        .select('*, orden_traspaso_id')
        .eq('precinto', precinto)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      canasto = result.data
      errBuscar = result.error
    }

    if (errBuscar || !canasto) {
      return res.status(404).json({ error: canasto_id ? 'Canasto no encontrado' : `Canasto con precinto "${precinto}" no encontrado` })
    }

    // Si ya está despachado, devolver sin error
    if (canasto.estado === 'despachado') {
      const { data: orden } = await supabase
        .from('ordenes_traspaso')
        .select('id, numero, estado')
        .eq('id', canasto.orden_traspaso_id)
        .single()

      const { data: hermanos } = await supabase
        .from('traspaso_canastos')
        .select('id, estado')
        .eq('orden_traspaso_id', canasto.orden_traspaso_id)

      const total = (hermanos || []).length
      const despachados = (hermanos || []).filter(c => c.estado === 'despachado').length

      return res.json({
        ya_escaneado: true,
        canasto,
        orden,
        orden_completada: orden?.estado === 'despachado',
        canastos_restantes: total - despachados,
        total_canastos: total,
      })
    }

    // Solo despachar canastos en estado cerrado
    if (canasto.estado !== 'cerrado') {
      return res.status(400).json({ error: `Canasto en estado "${canasto.estado}", debe estar cerrado para despachar` })
    }

    // Pasar canasto a despachado
    const { data: canastoActualizado, error: errUpdate } = await supabase
      .from('traspaso_canastos')
      .update({ estado: 'despachado', updated_at: new Date().toISOString() })
      .eq('id', canasto.id)
      .select()
      .single()

    if (errUpdate) throw errUpdate

    // Verificar si TODOS los canastos de la orden están despachados
    const { data: todosCanastos } = await supabase
      .from('traspaso_canastos')
      .select('id, estado')
      .eq('orden_traspaso_id', canasto.orden_traspaso_id)

    const total = (todosCanastos || []).length
    const despachados = (todosCanastos || []).filter(c => c.estado === 'despachado').length
    let ordenCompletada = false
    let ordenData = null

    if (despachados === total) {
      // Traer orden para ajuste stock
      const { data: orden } = await supabase
        .from('ordenes_traspaso')
        .select('*')
        .eq('id', canasto.orden_traspaso_id)
        .eq('estado', 'preparado')
        .single()

      if (orden) {
        const resultado = await ajusteStockNegativo(
          orden.sucursal_origen_id,
          orden.items || [],
          orden.numero
        )

        const { data: ordenActualizada } = await supabase
          .from('ordenes_traspaso')
          .update({
            estado: 'despachado',
            despachado_por: req.usuario?.id,
            despachado_at: new Date().toISOString(),
            centum_ajuste_origen_id: resultado.ajusteId,
            centum_error: resultado.error,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orden.id)
          .select()
          .single()

        ordenCompletada = true
        ordenData = ordenActualizada
      }
    }

    if (!ordenData) {
      const { data: orden } = await supabase
        .from('ordenes_traspaso')
        .select('id, numero, estado')
        .eq('id', canasto.orden_traspaso_id)
        .single()
      ordenData = orden
    }

    res.json({
      ya_escaneado: false,
      canasto: canastoActualizado,
      orden: ordenData,
      orden_completada: ordenCompletada,
      canastos_restantes: total - despachados,
      total_canastos: total,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
