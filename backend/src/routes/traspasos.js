// Rutas del módulo de traspasos entre sucursales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { ajusteStockNegativo, ajusteStockPositivo } = require('../services/centumAjusteStock')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')

// ═══════════════════════════════════════════════════════════════
// Artículos ligero — solo los campos necesarios para preparación
// ═══════════════════════════════════════════════════════════════

// Buscar artículo por código (para control ciego)
router.get('/articulo-por-codigo/:codigo', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const codigo = req.params.codigo.trim()
    if (!codigo) return res.status(400).json({ error: 'Código requerido' })

    // Buscar por codigo, id_centum, o codigos_barras
    let articulo = null

    // Por código exacto
    const { data: porCodigo } = await supabase
      .from('articulos')
      .select('id, id_centum, codigo, nombre, rubro, es_pesable, codigos_barras, peso_promedio_pieza, peso_minimo, peso_maximo')
      .eq('codigo', codigo)
      .limit(1)
      .maybeSingle()

    if (porCodigo) articulo = porCodigo

    // Por codigos_barras — formato jsonb: [{codigo:"...",factor:1}] o ["..."]
    // Supabase ilike castea jsonb a text para comparar
    if (!articulo) {
      const { data: porCB } = await supabase
        .from('articulos')
        .select('id, id_centum, codigo, nombre, rubro, es_pesable, codigos_barras, peso_promedio_pieza, peso_minimo, peso_maximo')
        .like('codigos_barras::text', `%${codigo}%`)
        .limit(1)

      if (porCB && porCB.length > 0) articulo = porCB[0]
    }

    if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' })

    res.json({
      id: articulo.id_centum || articulo.id,
      codigo: articulo.codigo || '',
      nombre: articulo.nombre || '',
      esPesable: articulo.es_pesable || false,
      codigosBarras: articulo.codigos_barras || [],
      pesoPromedioPieza: articulo.peso_promedio_pieza ? parseFloat(articulo.peso_promedio_pieza) : null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.post('/articulos-enriquecer', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { ids } = req.body // array de id_centum (articulo_id en ordenes)
    if (!Array.isArray(ids) || ids.length === 0) return res.json([])

    const { data, error } = await supabase
      .from('articulos')
      .select('id, id_centum, codigo, nombre, rubro, rubro_id_centum, marca, es_pesable, codigos_barras, peso_promedio_pieza, peso_minimo, peso_maximo')
      .in('id_centum', ids)

    if (error) throw error

    const articulos = (data || []).map(a => ({
      id: a.id_centum || a.id,
      codigo: a.codigo || '',
      nombre: a.nombre || '',
      rubro: a.rubro ? { nombre: a.rubro } : null,
      marca: a.marca || null,
      esPesable: a.es_pesable || false,
      codigosBarras: a.codigos_barras || [],
      pesoPromedioPieza: a.peso_promedio_pieza ? parseFloat(a.peso_promedio_pieza) : null,
      pesoMinimo: a.peso_minimo ? parseFloat(a.peso_minimo) : null,
      pesoMaximo: a.peso_maximo ? parseFloat(a.peso_maximo) : null,
    }))

    res.json(articulos)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Actualizar peso min/max de un artículo pesable (auto-ajuste desde preparación)
router.put('/articulos/:id/pesos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { peso } = req.body
    if (!peso || peso <= 0) return res.status(400).json({ error: 'Peso inválido' })

    // Buscar artículo por id_centum
    const { data: art } = await supabase
      .from('articulos')
      .select('id, peso_minimo, peso_maximo, es_pesable')
      .eq('id_centum', id)
      .single()

    if (!art) return res.status(404).json({ error: 'Artículo no encontrado' })
    if (!art.es_pesable) return res.status(400).json({ error: 'No es pesable' })

    const updates = {}
    const pesoMin = art.peso_minimo ? parseFloat(art.peso_minimo) : null
    const pesoMax = art.peso_maximo ? parseFloat(art.peso_maximo) : null

    if (pesoMin === null || peso < pesoMin) updates.peso_minimo = peso
    if (pesoMax === null || peso > pesoMax) updates.peso_maximo = peso

    if (Object.keys(updates).length === 0) return res.json({ updated: false })

    await supabase.from('articulos').update(updates).eq('id', art.id)
    res.json({ updated: true, peso_minimo: updates.peso_minimo ?? pesoMin, peso_maximo: updates.peso_maximo ?? pesoMax })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Stock por sucursal (para mostrar en picker de artículos)
// ═══════════════════════════════════════════════════════════════

router.get('/stock/:sucursalId', verificarAuth, asyncHandler(async (req, res) => {
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
}))

// ═══════════════════════════════════════════════════════════════
// Config
// ═══════════════════════════════════════════════════════════════

router.get('/config', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase.from('traspaso_config').select('*')
    if (error) throw error
    const config = {}
    for (const row of (data || [])) config[row.clave] = row.valor
    res.json(config)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/config', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const entries = Object.entries(req.body)
    for (const [clave, valor] of entries) {
      await supabase.from('traspaso_config').upsert({ clave, valor: String(valor) })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0]

    const { data: ordenes } = await supabase
      .from('ordenes_traspaso')
      .select('estado, recibido_at')
      .not('estado', 'eq', 'cancelado')

    const all = ordenes || []
    const pendientes = all.filter(o => o.estado === 'pendiente').length
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
}))

// ═══════════════════════════════════════════════════════════════
// Órdenes CRUD
// ═══════════════════════════════════════════════════════════════

router.get('/ordenes', verificarAuth, asyncHandler(async (req, res) => {
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

    // Traer nombres de preparadores
    const preparadorIds = [...new Set((data || []).map(o => o.preparado_por).filter(Boolean))]
    let prepMap = {}
    if (preparadorIds.length > 0) {
      const { data: perfiles } = await supabase
        .from('perfiles')
        .select('id, user_id, nombre')
        .or(preparadorIds.map(id => `id.eq.${id}`).join(',') + ',' + preparadorIds.map(id => `user_id.eq.${id}`).join(','))
      for (const p of (perfiles || [])) {
        prepMap[p.id] = p.nombre
        prepMap[p.user_id] = p.nombre
      }
    }

    const enriquecidas = (data || []).map(o => ({
      ...o,
      sucursal_origen_nombre: sucMap[o.sucursal_origen_id] || 'Desconocida',
      sucursal_destino_nombre: sucMap[o.sucursal_destino_id] || 'Desconocida',
      preparado_por_nombre: o.preparado_por ? (prepMap[o.preparado_por] || null) : null,
    }))

    res.json(enriquecidas)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.get('/ordenes/:id', verificarAuth, asyncHandler(async (req, res) => {
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

    // Traer nombre de quien prepara (puede ser perfiles.id o auth user_id)
    let preparado_por_nombre = null
    if (data.preparado_por) {
      const { data: perfil } = await supabase
        .from('perfiles')
        .select('nombre')
        .eq('id', data.preparado_por)
        .single()
      if (perfil?.nombre) {
        preparado_por_nombre = perfil.nombre
      } else {
        // Fallback: buscar por user_id (auth.users UUID)
        const { data: perfil2 } = await supabase
          .from('perfiles')
          .select('nombre')
          .eq('user_id', data.preparado_por)
          .single()
        preparado_por_nombre = perfil2?.nombre || null
      }
    }

    // Determinar si el usuario actual es quien prepara (comparar contra perfiles.id y user_id)
    const esPreparador = data.preparado_por
      ? (data.preparado_por === req.perfil?.id || data.preparado_por === req.usuario?.id)
      : false

    res.json({
      ...data,
      canastos: canastos || [],
      preparado_por_nombre,
      es_mi_preparacion: esPreparador,
      sucursal_origen_nombre: sucMap[data.sucursal_origen_id] || 'Desconocida',
      sucursal_destino_nombre: sucMap[data.sucursal_destino_id] || 'Desconocida',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.post('/ordenes', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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
        creado_por: req.perfil?.id,
      })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/ordenes/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    // Solo editar pendientees
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden || orden.estado !== 'pendiente') {
      return res.status(400).json({ error: 'Solo se pueden editar órdenes en pendiente' })
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
}))

router.delete('/ordenes/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })
    if (orden.estado === 'cancelado') return res.status(400).json({ error: 'La orden ya está cancelada' })

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
}))

// ═══════════════════════════════════════════════════════════════
// Transiciones de estado
// ═══════════════════════════════════════════════════════════════

// GET /api/traspasos/asignar-preparacion
// Busca la orden pendiente más antigua, la pasa a en_preparacion y la devuelve
router.get('/asignar-preparacion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // Buscar la orden pendiente más antigua
    const { data: pendientes, error: errBuscar } = await supabase
      .from('ordenes_traspaso')
      .select('id')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: true })
      .limit(1)

    const orden = pendientes?.[0]

    if (errBuscar || !orden) {
      // Si no hay pendientes, buscar si hay alguna en_preparacion sin terminar
      const { data: enPrepList } = await supabase
        .from('ordenes_traspaso')
        .select('id')
        .eq('estado', 'en_preparacion')
        .order('updated_at', { ascending: true })
        .limit(1)

      const enPrep = enPrepList?.[0]

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
        preparado_por: req.perfil?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orden.id)
      .eq('estado', 'pendiente')
      .select('id')

    if (error) throw error
    res.json({ orden: data?.[0] || orden, ya_en_preparacion: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/ordenes/:id/iniciar-preparacion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'en_preparacion',
        preparado_por: req.perfil?.id,
        preparacion_state: { last_heartbeat: now, last_activity: now },
        updated_at: now,
      })
      .eq('id', req.params.id)
      .eq('estado', 'pendiente')
      .select()

    if (error) throw error
    if (!data || data.length === 0) return res.status(400).json({ error: 'Solo se puede iniciar preparación de órdenes en pendiente' })
    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/ordenes/:id/tomar-preparacion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        preparado_por: req.perfil?.id,
        preparacion_state: { last_heartbeat: now, last_activity: now },
        updated_at: now,
      })
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')
      .select()

    if (error) throw error
    if (!data || data.length === 0) return res.status(400).json({ error: 'La orden no está en preparación' })
    res.json(data[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Heartbeat: el frontend lo llama cada 2 min para indicar que sigue en la pantalla
router.put('/ordenes/:id/heartbeat', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { es_accion } = req.body // true si el usuario hizo algo (scan, pick, etc.)
    const now = new Date().toISOString()

    // Leer orden actual para obtener preparacion_state
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('preparacion_state')
      .eq('id', req.params.id)
      .single()

    const state = orden?.preparacion_state || {}
    state.last_heartbeat = now
    if (es_accion) state.last_activity = now

    const { error } = await supabase
      .from('ordenes_traspaso')
      .update({ preparacion_state: state })
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/ordenes/:id/preparado', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
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

    // Auto-calcular pesos de pesables a partir de escaneos reales en items de la orden
    try {
      const pesosPorArticulo = {}
      for (const item of (data.items || [])) {
        if (item.es_pesable && Array.isArray(item.pesos_escaneados) && item.pesos_escaneados.length > 0) {
          if (!pesosPorArticulo[item.articulo_id]) pesosPorArticulo[item.articulo_id] = []
          pesosPorArticulo[item.articulo_id].push(...item.pesos_escaneados)
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
      logger.error('Error actualizando pesos automáticos:', pesoErr)
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
        if (faltErr) logger.error('Error insertando faltantes:', faltErr)
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

        const itemsOrigen = data.items || []
        const nuevosItems = articulos_faltantes.map(f => {
          const orig = itemsOrigen.find(i => String(i.articulo_id) === String(f.articulo_id))
          return {
            articulo_id: f.articulo_id, nombre: f.nombre, codigo: f.codigo,
            cantidad_solicitada: f.cantidad_faltante, cantidad: f.cantidad_faltante,
            es_pesable: orig?.es_pesable || f.es_pesable || false,
            peso_promedio_pieza: orig?.peso_promedio_pieza || f.peso_promedio_pieza || null,
          }
        })

        const { data: nuevaOrden, error: nuevaErr } = await supabase
          .from('ordenes_traspaso')
          .insert({
            numero,
            sucursal_origen_id: data.sucursal_origen_id,
            sucursal_destino_id: data.sucursal_destino_id,
            items: nuevosItems,
            notas: `Pendientes de ${data.numero}`,
            creado_por: req.perfil?.id,
          })
          .select()
          .single()

        if (nuevaErr) {
          logger.error('Error creando orden con faltantes:', nuevaErr)
        } else {
          nueva_orden_id = nuevaOrden.id
          nueva_orden_numero = nuevaOrden.numero
        }
      }
    } catch (faltantesErr) {
      logger.error('Error procesando faltantes:', faltantesErr)
      // No falla la operación principal
    }

    res.json({ ...data, nueva_orden_id, nueva_orden_numero })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/ordenes/:id/despachar', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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

    // Actualizar canastos a en_transito
    await supabase
      .from('traspaso_canastos')
      .update({ estado: 'en_transito', updated_at: new Date().toISOString() })
      .eq('orden_traspaso_id', req.params.id)
      .eq('estado', 'en_origen')

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'despachado',
        despachado_por: req.perfil?.id,
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
}))

router.put('/ordenes/:id/recibir', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // Validar que todos los canastos estén verificados
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('orden_traspaso_id', req.params.id)

    if (!canastos || canastos.length === 0) {
      return res.status(400).json({ error: 'No hay canastos para recibir' })
    }

    const estadosFinales = ['controlado', 'con_diferencia']
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
        recibido_por: req.perfil?.id,
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
}))

// ═══════════════════════════════════════════════════════════════
// Pick (guardar progreso de preparación en items de la orden)
// ═══════════════════════════════════════════════════════════════

router.put('/ordenes/:id/pick', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { items, preparacion_state } = req.body
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items requerido' })

    const updateObj = { items, updated_at: new Date().toISOString() }
    if (preparacion_state !== undefined) {
      updateObj.preparacion_state = preparacion_state
    }

    const { data, error } = await supabase
      .from('ordenes_traspaso')
      .update(updateObj)
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')
      .select()
      .single()

    if (error) throw error
    if (!data) return res.status(400).json({ error: 'La orden debe estar en preparación' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Canastos (legacy)
// ═══════════════════════════════════════════════════════════════

router.post('/ordenes/:id/canastos', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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
}))

// Despachar canasto por escaneo (DEBE ir antes de /canastos/:id para evitar conflicto)
router.put('/canastos/despachar-scan', verificarAuth, asyncHandler(async (req, res) => {
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
      logger.error('[despachar-scan] No encontrado:', { canasto_id, precinto, errBuscar: errBuscar?.message || errBuscar, canasto })
      return res.status(404).json({ error: canasto_id ? 'Canasto no encontrado' : `Canasto con precinto "${precinto}" no encontrado`, debug: { errBuscar: errBuscar?.message, canasto_id, precinto } })
    }

    // Si ya está en_transito, devolver sin error
    if (canasto.estado === 'en_transito') {
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
      const enTransito = (hermanos || []).filter(c => c.estado === 'en_transito').length

      return res.json({
        ya_escaneado: true,
        canasto,
        orden,
        orden_completada: orden?.estado === 'despachado',
        canastos_restantes: total - enTransito,
        total_canastos: total,
      })
    }

    // Solo despachar canastos en estado en_origen
    if (canasto.estado !== 'en_origen') {
      return res.status(400).json({ error: `Canasto en estado "${canasto.estado}", debe estar en origen para despachar` })
    }

    // Pasar canasto a en_transito
    const { data: canastoActualizado, error: errUpdate } = await supabase
      .from('traspaso_canastos')
      .update({ estado: 'en_transito', updated_at: new Date().toISOString() })
      .eq('id', canasto.id)
      .select()
      .single()

    if (errUpdate) throw errUpdate

    // Verificar si TODOS los canastos de la orden están en_transito
    const { data: todosCanastos } = await supabase
      .from('traspaso_canastos')
      .select('id, estado')
      .eq('orden_traspaso_id', canasto.orden_traspaso_id)

    const total = (todosCanastos || []).length
    const despachados = (todosCanastos || []).filter(c => c.estado === 'en_transito').length
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
            despachado_por: req.perfil?.id,
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
}))

// ═══════════════════════════════════════════════════════════════
// Recibir canasto por escaneo libre (sin seleccionar orden)
// ═══════════════════════════════════════════════════════════════

router.put('/canastos/recibir-scan', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { canasto_id } = req.body
    if (!canasto_id) return res.status(400).json({ error: 'canasto_id requerido' })

    // Buscar canasto
    const { data: canasto, error: errCanasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', canasto_id)
      .single()

    if (errCanasto || !canasto) {
      return res.status(404).json({ error: 'Canasto no encontrado' })
    }

    // Idempotente: si ya está en_destino
    if (canasto.estado === 'en_destino') {
      const { data: orden } = await supabase
        .from('ordenes_traspaso')
        .select('id, numero, estado, sucursal_origen_id, sucursal_destino_id')
        .eq('id', canasto.orden_traspaso_id)
        .single()
      return res.json({ ya_recibido: true, accion: 'recibido', canasto, orden })
    }

    // Solo canastos en tránsito se pueden recibir/devolver
    if (canasto.estado !== 'en_transito') {
      return res.status(400).json({ error: `Canasto en estado "${canasto.estado}", debe estar en tránsito` })
    }

    // Obtener orden para saber origen y destino
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('id, numero, estado, sucursal_origen_id, sucursal_destino_id')
      .eq('id', canasto.orden_traspaso_id)
      .single()

    if (!orden) {
      return res.status(404).json({ error: 'Orden de traspaso no encontrada' })
    }

    // Sucursal del usuario
    const userSucursalId = req.perfil.sucursales?.id || req.perfil.sucursal_id
    if (!userSucursalId) {
      return res.status(400).json({ error: 'Tu usuario no tiene sucursal asignada' })
    }

    let accion, nuevoEstado, updates

    if (userSucursalId === orden.sucursal_destino_id) {
      // Recibir en destino
      accion = 'recibido'
      nuevoEstado = 'en_destino'
      updates = {
        estado: nuevoEstado,
        updated_at: new Date().toISOString(),
      }
    } else if (userSucursalId === orden.sucursal_origen_id) {
      // Devolver a origen
      accion = 'devuelto'
      nuevoEstado = 'en_origen'
      updates = {
        estado: nuevoEstado,
        updated_at: new Date().toISOString(),
      }
    } else {
      return res.status(403).json({ error: 'Tu sucursal no es origen ni destino de este traspaso' })
    }

    const { data: canastoActualizado, error: errUpdate } = await supabase
      .from('traspaso_canastos')
      .update(updates)
      .eq('id', canasto.id)
      .select()
      .single()

    if (errUpdate) throw errUpdate

    res.json({ accion, canasto: canastoActualizado, orden })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Canastos en tránsito hacia la sucursal del usuario
// ═══════════════════════════════════════════════════════════════

router.get('/canastos/en-transito-mi-sucursal', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const userSucursalId = req.perfil.sucursales?.id || req.perfil.sucursal_id
    if (!userSucursalId) {
      return res.json([])
    }

    // Ordenes cuyo destino es la sucursal del usuario
    const { data: ordenes } = await supabase
      .from('ordenes_traspaso')
      .select('id, numero, sucursal_origen_id, sucursal_destino_id')
      .eq('sucursal_destino_id', userSucursalId)
      .in('estado', ['preparado', 'despachado', 'en_transito', 'recibido'])

    if (!ordenes || ordenes.length === 0) return res.json([])

    const ordenIds = ordenes.map(o => o.id)
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .in('orden_traspaso_id', ordenIds)
      .eq('estado', 'en_transito')
      .order('updated_at', { ascending: false })

    // Enriquecer con datos de orden
    const ordenMap = Object.fromEntries(ordenes.map(o => [o.id, o]))
    const resultado = (canastos || []).map(c => ({
      canasto: c,
      orden: ordenMap[c.orden_traspaso_id] || null,
    }))

    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Canastos con diferencia pendientes de control en mi sucursal
router.get('/canastos/con-diferencia-mi-sucursal', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const userSucursalId = req.perfil.sucursales?.id || req.perfil.sucursal_id
    if (!userSucursalId) return res.json([])

    const { data: ordenes } = await supabase
      .from('ordenes_traspaso')
      .select('id, numero, sucursal_origen_id, sucursal_destino_id')
      .eq('sucursal_destino_id', userSucursalId)
      .in('estado', ['preparado', 'despachado', 'en_transito', 'recibido'])

    if (!ordenes || ordenes.length === 0) return res.json([])

    const ordenIds = ordenes.map(o => o.id)
    const { data: canastos } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .in('orden_traspaso_id', ordenIds)
      .in('estado', ['con_diferencia', 'en_destino'])
      .order('updated_at', { ascending: false })

    // Filtrar: con_diferencia sin control de artículos, o en_destino con requiere_control_articulos
    const filtrados = (canastos || []).filter(c =>
      (c.estado === 'con_diferencia' && !c.control_articulos_at) ||
      (c.requiere_control_articulos && !c.control_articulos_at)
    )

    const ordenMap = Object.fromEntries(ordenes.map(o => [o.id, o]))
    const resultado = filtrados.map(c => ({
      canasto: c,
      orden: ordenMap[c.orden_traspaso_id] || null,
    }))

    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/canastos/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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
    // Canastos en_origen permiten actualizar peso_origen e items (para mover artículos)
    if (canasto.estado !== 'en_preparacion' && precinto !== undefined) {
      return res.status(400).json({ error: 'No se puede cambiar el precinto de un canasto en origen' })
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
}))

router.put('/canastos/:id/cerrar', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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

    // Bultos se marcan en_origen directamente sin validación de precinto
    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({ estado: 'en_origen', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/canastos/:id/pesar-destino', verificarAuth, asyncHandler(async (req, res) => {
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

    if (!canasto || canasto.estado !== 'en_destino') {
      return res.status(400).json({ error: 'Solo se pueden pesar canastos en destino' })
    }

    // Obtener tolerancia en gramos
    const { data: configRows } = await supabase
      .from('traspaso_config')
      .select('valor')
      .eq('clave', 'tolerancia_peso_gramos')
      .single()

    const toleranciaGramos = parseFloat(configRows?.valor || '500')
    const pesoOrigen = parseFloat(canasto.peso_origen)
    const pesoDestino = parseFloat(peso_destino)
    const diferenciaGramos = Math.abs(pesoDestino - pesoOrigen) * 1000

    let nuevoEstado
    if (diferenciaGramos <= toleranciaGramos) {
      nuevoEstado = 'controlado'
    } else {
      nuevoEstado = 'con_diferencia'
    }

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        peso_destino: pesoDestino,
        estado: nuevoEstado,
        verificado_por: req.perfil?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ...data, dentro_tolerancia: nuevoEstado === 'controlado', diferencia_gramos: Math.round(diferenciaGramos) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Conteo ciego para bultos en recepción
router.put('/canastos/:id/conteo-ciego', verificarAuth, asyncHandler(async (req, res) => {
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

    if (!canasto || canasto.estado !== 'en_destino') {
      return res.status(400).json({ error: 'Solo se pueden contar bultos en destino' })
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

    const nuevoEstado = hayDiferencias ? 'con_diferencia' : 'controlado'

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        estado: nuevoEstado,
        diferencias: hayDiferencias ? diferencias : null,
        verificado_por: req.perfil?.id,
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
}))

// Items consolidados para control de artículos (incluye hijos si es pallet)
router.get('/canastos/:id/items-control', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto) return res.status(404).json({ error: 'Canasto no encontrado' })

    let allItems = []

    if (canasto.tipo === 'pallet') {
      // Pallet: consolidar items de todos los bultos/canastos hijos
      const { data: hijos } = await supabase
        .from('traspaso_canastos')
        .select('items')
        .eq('pallet_id', canasto.id)

      for (const hijo of (hijos || [])) {
        for (const item of (hijo.items || [])) {
          const existing = allItems.find(i => i.articulo_id === item.articulo_id)
          if (existing) {
            existing.cantidad = (existing.cantidad || 0) + (item.cantidad || 0)
            if (item.pesos_escaneados) {
              existing.pesos_escaneados = [...(existing.pesos_escaneados || []), ...item.pesos_escaneados]
            }
          } else {
            allItems.push({ ...item })
          }
        }
      }
    } else {
      allItems = canasto.items || []
    }

    res.json({ items: allItems, tipo: canasto.tipo })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Control de artículos individuales (post-diferencia en peso/bultos)
router.put('/canastos/:id/control-articulos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { items_recibidos, fotos } = req.body
    if (!Array.isArray(items_recibidos) || items_recibidos.length === 0) {
      return res.status(400).json({ error: 'items_recibidos requeridos' })
    }

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || !['en_destino', 'con_diferencia'].includes(canasto.estado)) {
      return res.status(400).json({ error: 'Solo se pueden controlar canastos en destino o con diferencia' })
    }

    // Obtener tolerancia para pesables
    const { data: configRow } = await supabase
      .from('traspaso_config')
      .select('valor')
      .eq('clave', 'tolerancia_peso_gramos')
      .single()
    const toleranciaKg = parseFloat(configRow?.valor || '500') / 1000

    // Consolidar items (para pallets, obtener de hijos)
    let itemsCanasto = canasto.items || []
    if (canasto.tipo === 'pallet') {
      itemsCanasto = []
      const { data: hijos } = await supabase
        .from('traspaso_canastos')
        .select('items')
        .eq('pallet_id', canasto.id)
      for (const hijo of (hijos || [])) {
        for (const item of (hijo.items || [])) {
          const existing = itemsCanasto.find(i => i.articulo_id === item.articulo_id)
          if (existing) {
            existing.cantidad = (existing.cantidad || 0) + (item.cantidad || 0)
            if (item.pesos_escaneados) existing.pesos_escaneados = [...(existing.pesos_escaneados || []), ...item.pesos_escaneados]
          } else {
            itemsCanasto.push({ ...item })
          }
        }
      }
    }

    const diferencias_articulos = []
    let hayDiferencias = false

    // Comparar items recibidos vs preparados
    const recibidosMap = {}
    for (const ir of items_recibidos) {
      recibidosMap[ir.articulo_id] = ir
    }

    // Items preparados
    for (const itemOrig of itemsCanasto) {
      const recibido = recibidosMap[itemOrig.articulo_id]
      const cantEsperada = itemOrig.es_pesable
        ? (itemOrig.pesos_escaneados || []).reduce((s, p) => s + p, 0) || itemOrig.cantidad
        : itemOrig.cantidad
      const cantRecibida = recibido?.cantidad_recibida || 0

      let tipo = 'ok'
      if (cantRecibida === 0) {
        tipo = 'faltante'
        hayDiferencias = true
      } else if (itemOrig.es_pesable) {
        const tol = Math.max(toleranciaKg, cantEsperada * 0.02)
        if (Math.abs(cantRecibida - cantEsperada) > tol) {
          tipo = 'diferencia'
          hayDiferencias = true
        }
      } else if (cantRecibida !== cantEsperada) {
        tipo = 'diferencia'
        hayDiferencias = true
      }

      diferencias_articulos.push({
        articulo_id: itemOrig.articulo_id,
        nombre: itemOrig.nombre || '',
        codigo: itemOrig.codigo || '',
        cantidad_esperada: cantEsperada,
        cantidad_recibida: cantRecibida,
        pesos_escaneados_destino: recibido?.pesos_escaneados_destino || [],
        tipo,
        es_extra: false,
      })

      delete recibidosMap[itemOrig.articulo_id]
    }

    // Extras (no estaban en canasto) — buscar nombre/código en DB
    const extrasIds = Object.entries(recibidosMap).filter(([, ir]) => ir.es_extra).map(([id]) => id)
    let extrasMap = {}
    if (extrasIds.length > 0) {
      const numIds = extrasIds.filter(id => /^\d+$/.test(id)).map(Number)
      const uuidIds = extrasIds.filter(id => !/^\d+$/.test(id))
      if (numIds.length > 0) {
        const { data } = await supabase.from('articulos').select('id, id_centum, codigo, nombre').in('id_centum', numIds)
        if (data) data.forEach(a => { extrasMap[String(a.id)] = a; extrasMap[String(a.id_centum)] = a })
      }
      if (uuidIds.length > 0) {
        const { data } = await supabase.from('articulos').select('id, id_centum, codigo, nombre').in('id', uuidIds)
        if (data) data.forEach(a => { extrasMap[String(a.id)] = a; extrasMap[String(a.id_centum)] = a })
      }
    }
    for (const [artId, ir] of Object.entries(recibidosMap)) {
      if (ir.es_extra) {
        hayDiferencias = true
        const artDB = extrasMap[artId] || {}
        diferencias_articulos.push({
          articulo_id: artId,
          nombre: artDB.nombre || ir.nombre || '',
          codigo: artDB.codigo || ir.codigo || '',
          cantidad_esperada: 0,
          cantidad_recibida: ir.cantidad_recibida,
          pesos_escaneados_destino: ir.pesos_escaneados_destino || [],
          tipo: 'extra',
          es_extra: true,
        })
      }
    }

    const nuevoEstado = hayDiferencias ? 'con_diferencia' : 'controlado'

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        diferencias_articulos,
        control_articulos_at: new Date().toISOString(),
        control_articulos_fotos: Array.isArray(fotos) ? fotos : null,
        estado: nuevoEstado,
        verificado_por: req.perfil?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ hay_diferencias: hayDiferencias, diferencias_articulos, canasto: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Verificar artículo extra: ¿está en la orden? ¿en qué canasto fue preparado?
router.post('/canastos/:id/verificar-articulo-extra', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { articulo_id, codigo } = req.body
    if (!articulo_id && !codigo) {
      return res.status(400).json({ error: 'articulo_id o codigo requerido' })
    }

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('orden_traspaso_id')
      .eq('id', req.params.id)
      .single()

    if (!canasto) return res.status(404).json({ error: 'Canasto no encontrado' })

    // Obtener la orden
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('items')
      .eq('id', canasto.orden_traspaso_id)
      .single()

    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' })

    // ¿Está en la orden?
    const itemsOrden = orden.items || []
    const en_orden = itemsOrden.some(i =>
      String(i.articulo_id) === String(articulo_id) ||
      (codigo && i.codigo === codigo)
    )

    let canasto_origen = null

    if (en_orden) {
      // Buscar en qué canasto de esta orden fue preparado
      const { data: canastos } = await supabase
        .from('traspaso_canastos')
        .select('id, precinto, items')
        .eq('orden_traspaso_id', canasto.orden_traspaso_id)
        .neq('id', req.params.id)

      for (const c of (canastos || [])) {
        const cItems = c.items || []
        const tiene = cItems.some(i =>
          String(i.articulo_id) === String(articulo_id) ||
          (codigo && i.codigo === codigo)
        )
        if (tiene) {
          canasto_origen = { id: c.id, precinto: c.precinto }
          // Marcar ese canasto como requiere control
          await supabase
            .from('traspaso_canastos')
            .update({
              requiere_control_articulos: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', c.id)
          break
        }
      }
    }

    res.json({ en_orden, canasto_origen })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.put('/canastos/:id/verificar', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { diferencias } = req.body
    if (!diferencias) return res.status(400).json({ error: 'diferencias requeridas' })

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('estado')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.estado !== 'con_diferencia') {
      return res.status(400).json({ error: 'Solo se pueden verificar canastos con diferencia' })
    }

    const hayDiferencias = diferencias.some(d => d.cantidad_esperada !== d.cantidad_real)

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        diferencias,
        estado: hayDiferencias ? 'con_diferencia' : 'controlado',
        verificado_por: req.perfil?.id,
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
}))

router.delete('/canastos/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
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
}))

// ═══════════════════════════════════════════════════════════════
// Reparto — escaneo de canastos para despacho
// ═══════════════════════════════════════════════════════════════

router.get('/ordenes-reparto', verificarAuth, asyncHandler(async (req, res) => {
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
      .select('id, orden_traspaso_id, precinto, estado, tipo, nombre, numero_pallet, cantidad_bultos_origen')
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
        canastos_despachados: cs.filter(c => c.estado === 'en_transito').length,
      }
    })

    res.json(resultado)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Listar bultos (canastos + pallets) de órdenes preparadas/despachadas/recibidas
router.get('/bultos', verificarAuth, asyncHandler(async (req, res) => {
  try {
    // Obtener órdenes que ya pasaron de preparación
    const estadosValidos = ['preparado', 'despachado', 'recibido', 'con_diferencia']
    let qOrdenes = supabase
      .from('ordenes_traspaso')
      .select('id, numero, estado, sucursal_origen_id, sucursal_destino_id, preparado_at, despachado_at, recibido_at')
      .in('estado', estadosValidos)
      .order('preparado_at', { ascending: false })

    if (req.query.sucursal_origen) qOrdenes = qOrdenes.eq('sucursal_origen_id', req.query.sucursal_origen)
    if (req.query.sucursal_destino) qOrdenes = qOrdenes.eq('sucursal_destino_id', req.query.sucursal_destino)

    const { data: ordenesData, error: ordErr } = await qOrdenes
    if (ordErr) throw ordErr
    if (!ordenesData?.length) return res.json([])

    const ordenIds = ordenesData.map(o => o.id)
    const ordenMap = {}
    ordenesData.forEach(o => { ordenMap[o.id] = o })

    // Obtener sucursales para nombres
    const sucIds = [...new Set([...ordenesData.map(o => o.sucursal_origen_id), ...ordenesData.map(o => o.sucursal_destino_id)].filter(Boolean))]
    const { data: sucs } = await supabase.from('sucursales').select('id, nombre').in('id', sucIds)
    const sucMap = {}
    if (sucs) sucs.forEach(s => { sucMap[s.id] = s.nombre })

    // Obtener canastos/pallets de esas órdenes
    const { data: bultos, error: bulErr } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .in('orden_traspaso_id', ordenIds)
      .order('created_at', { ascending: false })
    if (bulErr) throw bulErr

    // Recopilar articulo_ids sin nombre en diferencias_articulos para enriquecer
    const artIdsSinNombre = new Set()
    for (const b of (bultos || [])) {
      if (Array.isArray(b.diferencias_articulos)) {
        for (const d of b.diferencias_articulos) {
          if (!d.nombre && d.articulo_id) artIdsSinNombre.add(d.articulo_id)
        }
      }
    }
    let artNombreMap = {}
    if (artIdsSinNombre.size > 0) {
      // articulo_id puede ser id_centum (número) o UUID — buscar por ambos
      const ids = [...artIdsSinNombre]
      const numIds = ids.filter(id => /^\d+$/.test(id)).map(Number)
      const uuidIds = ids.filter(id => !/^\d+$/.test(id))
      const results = []
      if (numIds.length > 0) {
        const { data } = await supabase.from('articulos').select('id, id_centum, codigo, nombre').in('id_centum', numIds)
        if (data) results.push(...data)
      }
      if (uuidIds.length > 0) {
        const { data } = await supabase.from('articulos').select('id, id_centum, codigo, nombre').in('id', uuidIds)
        if (data) results.push(...data)
      }
      for (const a of results) {
        artNombreMap[String(a.id)] = a
        artNombreMap[String(a.id_centum)] = a
      }
    }

    // Enriquecer con datos de la orden + nombres faltantes
    const resultado = (bultos || []).map(b => {
      const orden = ordenMap[b.orden_traspaso_id] || {}
      let diferencias_articulos = b.diferencias_articulos
      if (Array.isArray(diferencias_articulos) && artIdsSinNombre.size > 0) {
        diferencias_articulos = diferencias_articulos.map(d => {
          if (!d.nombre && artNombreMap[d.articulo_id]) {
            return { ...d, nombre: artNombreMap[d.articulo_id].nombre, codigo: d.codigo || artNombreMap[d.articulo_id].codigo }
          }
          return d
        })
      }
      return {
        ...b,
        diferencias_articulos,
        orden_numero: orden.numero,
        orden_estado: orden.estado,
        sucursal_origen: sucMap[orden.sucursal_origen_id] || null,
        sucursal_destino: sucMap[orden.sucursal_destino_id] || null,
        preparado_at: orden.preparado_at,
        despachado_at: orden.despachado_at,
        recibido_at: orden.recibido_at,
      }
    })

    res.json(resultado)
  } catch (err) {
    logger.error('[Traspasos] Error al listar bultos:', err.message)
    res.status(500).json({ error: err.message })
  }
}))

// Buscar canasto/pallet por precinto (sin despachar) — para confirmar antes de cargar
// Verificar si un canasto está en uso en otra orden activa
router.get('/canastos/verificar-precinto/:precinto', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const precinto = req.params.precinto.trim()
    if (!precinto) return res.json({ en_uso: false })

    // Buscar canastos con este precinto en estados activos (no recibido/cancelado)
    const excluirOrden = req.query.excluir_orden
    let query = supabase
      .from('traspaso_canastos')
      .select('id, precinto, estado, orden_traspaso_id')
      .eq('precinto', precinto)
      .in('estado', ['en_origen', 'en_transito'])
    if (excluirOrden) query = query.neq('orden_traspaso_id', excluirOrden)
    const { data, error } = await query.limit(1)

    if (error) throw error

    if (data && data.length > 0) {
      const canasto = data[0]
      // Traer número de orden
      const { data: orden } = await supabase
        .from('ordenes_traspaso')
        .select('numero')
        .eq('id', canasto.orden_traspaso_id)
        .single()

      return res.json({
        en_uso: true,
        estado: canasto.estado,
        orden_numero: orden?.numero || null,
        orden_id: canasto.orden_traspaso_id,
      })
    }

    res.json({ en_uso: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

router.get('/canastos/buscar-precinto/:precinto', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const precinto = req.params.precinto.trim()
    if (!precinto) return res.status(400).json({ error: 'Precinto requerido' })

    const { data: canasto, error } = await supabase
      .from('traspaso_canastos')
      .select('*, orden_traspaso_id')
      .ilike('precinto', precinto)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !canasto) {
      return res.status(404).json({ error: `No se encontró canasto/pallet con precinto "${precinto}"` })
    }

    // Traer datos de la orden
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('id, numero, estado, sucursal_origen_id, sucursal_destino_id')
      .eq('id', canasto.orden_traspaso_id)
      .single()

    // Enriquecer con nombres de sucursal
    let ordenEnriquecida = orden
    if (orden) {
      const { data: sucs } = await supabase
        .from('sucursales')
        .select('id, nombre')
        .in('id', [orden.sucursal_origen_id, orden.sucursal_destino_id].filter(Boolean))
      const sucMap = {}
      for (const s of (sucs || [])) sucMap[s.id] = s.nombre
      ordenEnriquecida = {
        ...orden,
        sucursal_origen_nombre: sucMap[orden.sucursal_origen_id] || 'Desconocida',
        sucursal_destino_nombre: sucMap[orden.sucursal_destino_id] || 'Desconocida',
      }
    }

    res.json({
      canasto,
      orden: ordenEnriquecida,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Preparar con canastos (batch) — crea canastos + pallets y marca preparada
// ═══════════════════════════════════════════════════════════════

router.post('/ordenes/:id/preparar-con-canastos', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { canastos: canastosBody, pallets: palletsBody, bultos: bultosBody, articulos_faltantes, crear_nueva_orden, observacion } = req.body

    // Validar orden en en_preparacion
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('*')
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')
      .single()

    if (!orden) return res.status(400).json({ error: 'La orden debe estar en preparación' })

    const canastosArr = Array.isArray(canastosBody) ? canastosBody : []
    const palletsArr = Array.isArray(palletsBody) ? palletsBody : []
    const bultosArr = Array.isArray(bultosBody) ? bultosBody : []

    if (canastosArr.length === 0 && palletsArr.length === 0 && bultosArr.length === 0) {
      return res.status(400).json({ error: 'Debe haber al menos un canasto, pallet o bulto' })
    }

    // Validar que cada canasto tiene peso
    for (const c of canastosArr) {
      if (!c.precinto) return res.status(400).json({ error: 'Cada canasto debe tener precinto' })
      if (!c.peso_origen || parseFloat(c.peso_origen) <= 0) {
        return res.status(400).json({ error: `Canasto "${c.precinto}" debe tener peso` })
      }
    }

    // Validar que cada bulto tiene items
    for (const b of bultosArr) {
      if (!Array.isArray(b.items) || b.items.length === 0) {
        return res.status(400).json({ error: `Cada bulto debe tener al menos un item` })
      }
    }

    // Validar precintos únicos y no en uso en otra orden activa
    const precintos = canastosArr.map(c => c.precinto)
    const precintosUnicos = new Set(precintos)
    if (precintosUnicos.size !== precintos.length) {
      return res.status(400).json({ error: 'Hay precintos duplicados' })
    }

    if (precintos.length > 0) {
      const { data: existentes } = await supabase
        .from('traspaso_canastos')
        .select('precinto, orden_traspaso_id')
        .in('precinto', precintos)
        .neq('orden_traspaso_id', req.params.id)

      if (existentes && existentes.length > 0) {
        const ordenIds = [...new Set(existentes.map(c => c.orden_traspaso_id))]
        const { data: ordenesActivas } = await supabase
          .from('ordenes_traspaso')
          .select('id, numero, estado')
          .in('id', ordenIds)
          .in('estado', ['en_preparacion', 'preparado', 'despachado'])

        if (ordenesActivas && ordenesActivas.length > 0) {
          const precintosEnUso = existentes
            .filter(e => ordenesActivas.some(o => o.id === e.orden_traspaso_id))
            .map(e => e.precinto)
          return res.status(400).json({ error: `Precintos en uso en otra orden: ${precintosEnUso.join(', ')}` })
        }
      }
    }

    // Crear canastos
    const canastosCreados = []
    for (const c of canastosArr) {
      const { data: nuevo, error: errC } = await supabase
        .from('traspaso_canastos')
        .insert({
          orden_traspaso_id: req.params.id,
          precinto: c.precinto,
          peso_origen: parseFloat(c.peso_origen),
          tipo: 'canasto',
          estado: 'en_origen',
          items: Array.isArray(c.items) ? c.items : [],
        })
        .select()
        .single()
      if (errC) throw errC
      canastosCreados.push(nuevo)
    }

    // Crear pallets
    const palletsCreados = []
    for (const p of palletsArr) {
      if (!p.cantidad_bultos || parseInt(p.cantidad_bultos) <= 0) {
        return res.status(400).json({ error: 'Cada pallet debe tener cantidad de bultos' })
      }

      // Generar numero de pallet via secuencia
      const { data: seqData } = await supabase.rpc('nextval_traspaso_pallet')
      let numeroPallet
      if (seqData) {
        numeroPallet = `PAL-${String(seqData).padStart(6, '0')}`
      } else {
        // Fallback si la función RPC no existe
        numeroPallet = `PAL-${Date.now()}`
      }

      const { data: nuevo, error: errP } = await supabase
        .from('traspaso_canastos')
        .insert({
          orden_traspaso_id: req.params.id,
          precinto: numeroPallet,
          tipo: 'pallet',
          numero_pallet: numeroPallet,
          cantidad_bultos_origen: parseInt(p.cantidad_bultos),
          nombre: p.items_descripcion || 'Pallet',
          estado: 'en_origen',
          items: [],
        })
        .select()
        .single()
      if (errP) throw errP
      palletsCreados.push({ ...nuevo, items_descripcion: p.items_descripcion })
    }

    // Crear bultos y vincular a pallets
    const bultosCreados = []
    const bultoTimestamp = Date.now()
    // Mapear qué bulto (por índice) va a qué pallet
    const bultoToPallet = {}
    for (let pi = 0; pi < palletsArr.length; pi++) {
      const indices = palletsArr[pi].bulto_indices || []
      for (const bIdx of indices) {
        bultoToPallet[bIdx] = palletsCreados[pi]?.id || null
      }
    }
    for (let i = 0; i < bultosArr.length; i++) {
      const b = bultosArr[i]
      const precintoBulto = `BULTO-${bultoTimestamp}-${i + 1}`
      const { data: nuevo, error: errB } = await supabase
        .from('traspaso_canastos')
        .insert({
          orden_traspaso_id: req.params.id,
          precinto: precintoBulto,
          tipo: 'bulto',
          nombre: b.nombre || 'Bulto',
          estado: 'en_origen',
          items: Array.isArray(b.items) ? b.items : [],
          ...(bultoToPallet[i] ? { pallet_id: bultoToPallet[i] } : {}),
        })
        .select()
        .single()
      if (errB) throw errB
      bultosCreados.push(nuevo)
    }

    // Marcar orden como preparada (misma lógica que PUT /preparado)
    const notasActualizadas = observacion
      ? (orden.notas ? orden.notas + '\nObs. preparación: ' + observacion : 'Obs. preparación: ' + observacion)
      : orden.notas
    const { data: ordenPreparada, error: errPrep } = await supabase
      .from('ordenes_traspaso')
      .update({
        estado: 'preparado',
        preparado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notas: notasActualizadas,
      })
      .eq('id', req.params.id)
      .eq('estado', 'en_preparacion')
      .select()
      .single()

    if (errPrep) throw errPrep

    // Auto-learn weights (copiado de PUT /preparado)
    try {
      const pesosPorArticulo = {}
      for (const item of (ordenPreparada.items || [])) {
        if (item.es_pesable && Array.isArray(item.pesos_escaneados) && item.pesos_escaneados.length > 0) {
          if (!pesosPorArticulo[item.articulo_id]) pesosPorArticulo[item.articulo_id] = []
          pesosPorArticulo[item.articulo_id].push(...item.pesos_escaneados)
        }
      }
      for (const [articuloId, pesos] of Object.entries(pesosPorArticulo)) {
        if (pesos.length === 0) continue
        const nuevoMin = Math.min(...pesos)
        const nuevoMax = Math.max(...pesos)
        const nuevoPromedio = pesos.reduce((s, p) => s + p, 0) / pesos.length
        const { data: art } = await supabase
          .from('articulos').select('id, peso_promedio_pieza, peso_minimo, peso_maximo, peso_muestras')
          .eq('id_centum', articuloId).single()
        if (!art) continue
        const muestrasAnteriores = art.peso_muestras || 0
        const muestrasNuevas = pesos.length
        const totalMuestras = muestrasAnteriores + muestrasNuevas
        const promedioAnterior = art.peso_promedio_pieza ? parseFloat(art.peso_promedio_pieza) : nuevoPromedio
        const promedioActualizado = muestrasAnteriores > 0
          ? (promedioAnterior * muestrasAnteriores + nuevoPromedio * muestrasNuevas) / totalMuestras
          : nuevoPromedio
        const minActualizado = art.peso_minimo ? Math.min(parseFloat(art.peso_minimo), nuevoMin) : nuevoMin
        const maxActualizado = art.peso_maximo ? Math.max(parseFloat(art.peso_maximo), nuevoMax) : nuevoMax
        await supabase.from('articulos').update({
          peso_promedio_pieza: Math.round(promedioActualizado * 1000) / 1000,
          peso_minimo: Math.round(minActualizado * 1000) / 1000,
          peso_maximo: Math.round(maxActualizado * 1000) / 1000,
          peso_muestras: totalMuestras,
        }).eq('id', art.id)
      }
    } catch (pesoErr) {
      logger.error('Error actualizando pesos automáticos:', pesoErr)
    }

    // Manejar faltantes
    let nueva_orden_id = null
    let nueva_orden_numero = null
    try {
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
          sucursal_id: ordenPreparada.sucursal_origen_id,
        }))
        await supabase.from('traspaso_articulos_faltantes').insert(rows)
      }
      if (crear_nueva_orden && Array.isArray(articulos_faltantes) && articulos_faltantes.length > 0) {
        let numero
        try {
          const { count } = await supabase.from('ordenes_traspaso').select('*', { count: 'exact', head: true })
          numero = `OT-${String((count || 0) + 1).padStart(6, '0')}`
        } catch { numero = `OT-${Date.now()}` }
        const itemsOrigen = ordenPreparada.items || []
        const nuevosItems = articulos_faltantes.map(f => {
          const orig = itemsOrigen.find(i => String(i.articulo_id) === String(f.articulo_id))
          return {
            articulo_id: f.articulo_id, nombre: f.nombre, codigo: f.codigo,
            cantidad_solicitada: f.cantidad_faltante, cantidad: f.cantidad_faltante,
            es_pesable: orig?.es_pesable || f.es_pesable || false,
            peso_promedio_pieza: orig?.peso_promedio_pieza || f.peso_promedio_pieza || null,
          }
        })
        const { data: nuevaOrden } = await supabase.from('ordenes_traspaso').insert({
          numero, sucursal_origen_id: ordenPreparada.sucursal_origen_id,
          sucursal_destino_id: ordenPreparada.sucursal_destino_id,
          items: nuevosItems, notas: `Pendientes de ${ordenPreparada.numero}`,
          creado_por: req.perfil?.id,
        }).select().single()
        if (nuevaOrden) { nueva_orden_id = nuevaOrden.id; nueva_orden_numero = nuevaOrden.numero }
      }
    } catch (faltantesErr) {
      logger.error('Error procesando faltantes:', faltantesErr)
    }

    res.json({
      ...ordenPreparada,
      canastos_creados: canastosCreados,
      pallets_creados: palletsCreados,
      bultos_creados: bultosCreados,
      nueva_orden_id,
      nueva_orden_numero,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Verificar pallet por conteo de bultos
// ═══════════════════════════════════════════════════════════════

router.put('/canastos/:id/verificar-pallet', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { cantidad_bultos_destino } = req.body
    if (cantidad_bultos_destino === undefined || cantidad_bultos_destino === null) {
      return res.status(400).json({ error: 'cantidad_bultos_destino requerido' })
    }

    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto || canasto.tipo !== 'pallet') {
      return res.status(400).json({ error: 'Solo se pueden verificar pallets' })
    }
    if (canasto.estado !== 'en_destino') {
      return res.status(400).json({ error: 'El pallet debe estar en destino' })
    }

    const bultosOrigen = canasto.cantidad_bultos_origen || 0
    const bultosDestino = parseInt(cantidad_bultos_destino)
    const coincide = bultosOrigen === bultosDestino

    const nuevoEstado = coincide ? 'controlado' : 'con_diferencia'

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        cantidad_bultos_destino: bultosDestino,
        estado: nuevoEstado,
        verificado_por: req.perfil?.id,
        verificado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ...data, bultos_coinciden: coincide })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Recibir canasto/pallet en destino (en_transito → en_destino)
// ═══════════════════════════════════════════════════════════════

router.put('/canastos/:id/recibir-en-destino', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: canasto } = await supabase
      .from('traspaso_canastos')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (!canasto) {
      return res.status(404).json({ error: 'Canasto no encontrado' })
    }

    // Ya está en destino o más avanzado
    if (['en_destino', 'controlado', 'con_diferencia'].includes(canasto.estado)) {
      return res.json({ ya_recibido: true, canasto })
    }

    if (canasto.estado !== 'en_transito') {
      return res.status(400).json({ error: `Canasto en estado "${canasto.estado}", debe estar en tránsito para recibir en destino` })
    }

    const { data, error } = await supabase
      .from('traspaso_canastos')
      .update({
        estado: 'en_destino',
        recibido_destino_por: req.perfil?.id,
        recibido_destino_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ ya_recibido: false, canasto: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// ═══════════════════════════════════════════════════════════════
// Registro de canastos — CRUD + generación de códigos CAN-XXXX
// ═══════════════════════════════════════════════════════════════

const generarCodigoCanasto = () => {
  // Formato: CAN-XXXX-NNNN (ej: CAN-7K3M-0001)
  // XXXX = 4 chars alfanuméricos random (sin vocales para evitar palabras)
  // NNNN = secuencial 4 dígitos
  const chars = 'BCDFGHJKLMNPQRSTVWXYZ23456789'
  let seg = ''
  for (let i = 0; i < 4; i++) seg += chars[Math.floor(Math.random() * chars.length)]
  return seg
}

const siguienteCodigoCanasto = async () => {
  const { count } = await supabase
    .from('canastos_registro')
    .select('*', { count: 'exact', head: true })

  const num = (count || 0) + 1
  const seg = generarCodigoCanasto()
  return `CAN-${seg}-${String(num).padStart(4, '0')}`
}

// Listar todos los canastos registrados
router.get('/canastos-registro', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('canastos_registro')
      .select('*')
      .order('codigo', { ascending: true })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Siguiente código disponible
router.get('/canastos-registro/siguiente-codigo', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const codigo = await siguienteCodigoCanasto()
    res.json({ codigo })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Crear N canastos (batch)
router.post('/canastos-registro', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const cantidad = Math.min(Math.max(parseInt(req.body.cantidad) || 1, 1), 100)

    const { count } = await supabase
      .from('canastos_registro')
      .select('*', { count: 'exact', head: true })

    const registros = []
    for (let i = 0; i < cantidad; i++) {
      const num = (count || 0) + 1 + i
      const seg = generarCodigoCanasto()
      registros.push({ codigo: `CAN-${seg}-${String(num).padStart(4, '0')}` })
    }

    const { data, error } = await supabase
      .from('canastos_registro')
      .insert(registros)
      .select()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

// Cambiar estado activo/baja
router.put('/canastos-registro/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { estado } = req.body
    if (!['activo', 'baja'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' })
    }

    const { data, error } = await supabase
      .from('canastos_registro')
      .update({ estado })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}))

module.exports = router
