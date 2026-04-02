// Rutas para gestión de tareas operativas por sucursal
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { obtenerTareasPendientes, fechaArgentina, calcularProximaFecha, evaluarConfigParaFecha } = require('../services/tareasScheduler')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { crearTareaSchema, editarTareaSchema, crearSubtareaSchema, editarSubtareaSchema, crearConfigSchema, editarConfigSchema, ejecutarTareaSchema } = require('../schemas/tareas')
const asyncHandler = require('../middleware/asyncHandler')

// ── CRUD Tareas (admin) ─────────────────────────────────────────────────────

// GET /api/tareas — Listar tareas (admin: todas, otros: solo activas)
router.get('/', verificarAuth, asyncHandler(async (req, res) => {
  try {
    let query = supabase
      .from('tareas')
      .select('*, subtareas(id, nombre, orden, activo)')
      .order('created_at', { ascending: false })

    if (req.perfil.rol !== 'admin') {
      query = query.eq('activo', true)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al obtener tareas:', err)
    res.status(500).json({ error: 'Error al obtener tareas' })
  }
}))

// POST /api/tareas — Crear tarea + subtareas opcionales
router.post('/', verificarAuth, soloAdmin, validate(crearTareaSchema), asyncHandler(async (req, res) => {
  try {
    const { nombre, descripcion, enlace_manual, subtareas, checklist_imprimible } = req.body

    // Crear tarea
    const { data: tarea, error } = await supabase
      .from('tareas')
      .insert({
        nombre: nombre.trim(),
        descripcion: descripcion?.trim() || null,
        enlace_manual: enlace_manual?.trim() || null,
        checklist_imprimible: checklist_imprimible?.trim() || null,
      })
      .select()
      .single()

    if (error) throw error

    // Crear subtareas si vienen
    if (subtareas && subtareas.length > 0) {
      const subtareasInsert = subtareas.map((s, i) => ({
        tarea_id: tarea.id,
        nombre: s.nombre.trim(),
        orden: s.orden ?? i,
      }))
      const { error: errSub } = await supabase
        .from('subtareas')
        .insert(subtareasInsert)
      if (errSub) throw errSub
    }

    // Retornar tarea con subtareas
    const { data: tareaCompleta } = await supabase
      .from('tareas')
      .select('*, subtareas(id, nombre, orden, activo)')
      .eq('id', tarea.id)
      .single()

    res.status(201).json(tareaCompleta)
  } catch (err) {
    logger.error('Error al crear tarea:', err)
    res.status(500).json({ error: 'Error al crear tarea' })
  }
}))

// PUT /api/tareas/:id — Editar tarea
router.put('/:id', verificarAuth, soloAdmin, validate(editarTareaSchema), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, descripcion, enlace_manual, activo, checklist_imprimible } = req.body

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (descripcion !== undefined) updates.descripcion = descripcion?.trim() || null
    if (enlace_manual !== undefined) updates.enlace_manual = enlace_manual?.trim() || null
    if (activo !== undefined) updates.activo = activo
    if (checklist_imprimible !== undefined) updates.checklist_imprimible = checklist_imprimible?.trim() || null

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('tareas')
      .update(updates)
      .eq('id', id)
      .select('*, subtareas(id, nombre, orden, activo)')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al editar tarea:', err)
    res.status(500).json({ error: 'Error al editar tarea' })
  }
}))

// DELETE /api/tareas/:id — Eliminar tarea (cascade)
router.delete('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase.from('tareas').delete().eq('id', id)
    if (error) throw error
    res.json({ mensaje: 'Tarea eliminada correctamente' })
  } catch (err) {
    logger.error('Error al eliminar tarea:', err)
    res.status(500).json({ error: 'Error al eliminar tarea' })
  }
}))

// ── CRUD Subtareas (admin) ──────────────────────────────────────────────────

// GET /api/tareas/:tareaId/subtareas
router.get('/:tareaId/subtareas', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subtareas')
      .select('*')
      .eq('tarea_id', req.params.tareaId)
      .order('orden')

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al obtener subtareas:', err)
    res.status(500).json({ error: 'Error al obtener subtareas' })
  }
}))

// POST /api/tareas/:tareaId/subtareas
router.post('/:tareaId/subtareas', verificarAuth, soloAdmin, validate(crearSubtareaSchema), asyncHandler(async (req, res) => {
  try {
    const { nombre, orden } = req.body

    const { data, error } = await supabase
      .from('subtareas')
      .insert({ tarea_id: req.params.tareaId, nombre: nombre.trim(), orden: orden ?? 0 })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear subtarea:', err)
    res.status(500).json({ error: 'Error al crear subtarea' })
  }
}))

// PUT /api/tareas/subtareas/:id
router.put('/subtareas/:id', verificarAuth, soloAdmin, validate(editarSubtareaSchema), asyncHandler(async (req, res) => {
  try {
    const { nombre, orden, activo } = req.body
    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (orden !== undefined) updates.orden = orden
    if (activo !== undefined) updates.activo = activo

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('subtareas')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al editar subtarea:', err)
    res.status(500).json({ error: 'Error al editar subtarea' })
  }
}))

// DELETE /api/tareas/subtareas/:id
router.delete('/subtareas/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase.from('subtareas').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Subtarea eliminada correctamente' })
  } catch (err) {
    logger.error('Error al eliminar subtarea:', err)
    res.status(500).json({ error: 'Error al eliminar subtarea' })
  }
}))

// ── Config por Sucursal (admin) ─────────────────────────────────────────────

// GET /api/tareas/:tareaId/config
router.get('/:tareaId/config', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tareas_config_sucursal')
      .select('*, sucursal:sucursales(id, nombre)')
      .eq('tarea_id', req.params.tareaId)
      .order('sucursal_id')

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al obtener config:', err)
    res.status(500).json({ error: 'Error al obtener configuración' })
  }
}))

// POST /api/tareas/:tareaId/config
router.post('/:tareaId/config', verificarAuth, soloAdmin, validate(crearConfigSchema), asyncHandler(async (req, res) => {
  try {
    const { sucursal_id, tipo, frecuencia_dias, dias_semana, dia_preferencia, reprogramar_siguiente, fecha_inicio } = req.body

    const insert = {
      tarea_id: req.params.tareaId,
      sucursal_id,
      tipo: tipo || 'frecuencia',
      frecuencia_dias: frecuencia_dias || 7,
      dias_semana: dias_semana || null,
      dia_preferencia: dia_preferencia || null,
      reprogramar_siguiente: reprogramar_siguiente !== false,
      fecha_inicio: fecha_inicio || fechaArgentina().hoyStr,
    }

    const { data, error } = await supabase
      .from('tareas_config_sucursal')
      .insert(insert)
      .select('*, sucursal:sucursales(id, nombre)')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Esta tarea ya está configurada para esa sucursal' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear config:', err)
    res.status(500).json({ error: 'Error al crear configuración' })
  }
}))

// PUT /api/tareas/config/:id
router.put('/config/:id', verificarAuth, soloAdmin, validate(editarConfigSchema), asyncHandler(async (req, res) => {
  try {
    const { tipo, frecuencia_dias, dias_semana, dia_preferencia, reprogramar_siguiente, fecha_inicio, activo } = req.body
    const updates = {}
    if (tipo !== undefined) updates.tipo = tipo
    if (frecuencia_dias !== undefined) updates.frecuencia_dias = frecuencia_dias
    if (dias_semana !== undefined) updates.dias_semana = dias_semana
    if (dia_preferencia !== undefined) updates.dia_preferencia = dia_preferencia || null
    if (reprogramar_siguiente !== undefined) updates.reprogramar_siguiente = reprogramar_siguiente
    if (fecha_inicio !== undefined) updates.fecha_inicio = fecha_inicio
    if (activo !== undefined) updates.activo = activo

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('tareas_config_sucursal')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, sucursal:sucursales(id, nombre)')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al editar config:', err)
    res.status(500).json({ error: 'Error al editar configuración' })
  }
}))

// DELETE /api/tareas/config/:id
router.delete('/config/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase.from('tareas_config_sucursal').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Configuración eliminada correctamente' })
  } catch (err) {
    logger.error('Error al eliminar config:', err)
    res.status(500).json({ error: 'Error al eliminar configuración' })
  }
}))

// ── Panel general: todas las sucursales (admin/gestor) ─────────────────────

// GET /api/tareas/panel-dia?fecha=YYYY-MM-DD — Registros + pendientes por sucursal para una fecha
// Optimizado: solo 3 queries a DB en vez de N por sucursal
router.get('/panel-dia', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { hoyStr } = fechaArgentina()
    const fecha = req.query.fecha || hoyStr

    // Query 1: Todas las configs activas con su tarea
    const { data: allConfigs, error: errCfg } = await supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id, tipo, frecuencia_dias, dias_semana, fecha_inicio, reprogramar_siguiente, sucursal:sucursales(id, nombre), tarea:tareas(id, nombre, activo, subtareas(id, activo))')
      .eq('activo', true)

    if (errCfg) throw errCfg
    if (!allConfigs || allConfigs.length === 0) return res.json([])

    // Filtrar solo configs con tarea activa
    const configs = allConfigs.filter(c => c.tarea?.activo)
    const configIds = configs.map(c => c.id)

    // Query 2: Ejecuciones del día con detalle completo
    const { data: ejecucionesDia, error: errEj } = await supabase
      .from('ejecuciones_tarea')
      .select(`
        id, tarea_config_id, fecha_programada, fecha_ejecucion, observaciones, calificacion, created_at,
        completada_por:perfiles(nombre),
        ejecuciones_empleados(empleado:empleados(nombre)),
        ejecuciones_subtareas(subtarea:subtareas(nombre), completada)
      `)
      .eq('fecha_ejecucion', fecha)
      .in('tarea_config_id', configIds)
      .order('created_at', { ascending: false })

    if (errEj) throw errEj

    // Query 3: Última ejecución ANTES de la fecha por cada config (para calcular pendientes)
    // Usamos una sola query con distinct on emulado
    const { data: ultimasEjecuciones } = await supabase
      .from('ejecuciones_tarea')
      .select('tarea_config_id, fecha_ejecucion')
      .in('tarea_config_id', configIds)
      .lt('fecha_ejecucion', fecha)
      .order('fecha_ejecucion', { ascending: false })

    // Mapear última ejecución por config (tomar la primera que aparece = más reciente)
    const ultimaEjMap = {}
    for (const ej of (ultimasEjecuciones || [])) {
      if (!ultimaEjMap[ej.tarea_config_id]) {
        ultimaEjMap[ej.tarea_config_id] = ej.fecha_ejecucion
      }
    }

    // Set de configs ejecutadas el día consultado
    const ejConfigIds = new Set()
    const ejPorSuc = {}
    for (const ej of (ejecucionesDia || [])) {
      ejConfigIds.add(ej.tarea_config_id)
      // Buscar sucursal_id del config
      const cfg = configs.find(c => c.id === ej.tarea_config_id)
      const sucId = String(cfg?.sucursal_id)
      if (!ejPorSuc[sucId]) ejPorSuc[sucId] = []
      ejPorSuc[sucId].push({
        id: ej.id,
        tarea: cfg?.tarea?.nombre || '-',
        hora: ej.created_at,
        empleados: (ej.ejecuciones_empleados || []).map(e => e.empleado?.nombre).filter(Boolean),
        registrado_por: ej.completada_por?.nombre || '-',
        calificacion: ej.calificacion,
        observaciones: ej.observaciones,
        a_tiempo: ej.fecha_programada ? ej.fecha_ejecucion <= ej.fecha_programada : null,
        dias_tarde: ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada
          ? Math.round((new Date(ej.fecha_ejecucion) - new Date(ej.fecha_programada)) / 86400000) : 0,
        subtareas_completadas: (ej.ejecuciones_subtareas || []).filter(s => s.completada).length,
        subtareas_total: (ej.ejecuciones_subtareas || []).length,
      })
    }

    // Agrupar configs por sucursal y evaluar pendientes (pura lógica, sin queries)
    const sucursalesMap = {}
    for (const c of configs) {
      const sucId = String(c.sucursal?.id || c.sucursal_id)
      if (!sucursalesMap[sucId]) {
        sucursalesMap[sucId] = {
          sucursal_id: sucId,
          sucursal_nombre: c.sucursal?.nombre || 'Sin sucursal',
          configs: [],
        }
      }
      sucursalesMap[sucId].configs.push(c)
    }

    const resultado = []
    for (const [sucId, suc] of Object.entries(sucursalesMap)) {
      const registros = ejPorSuc[sucId] || []
      const noRealizadas = []

      for (const cfg of suc.configs) {
        // Si ya fue ejecutada ese día, skip
        if (ejConfigIds.has(cfg.id)) continue

        // Evaluar si estaba programada para esa fecha
        const ultimaFecha = ultimaEjMap[cfg.id] || null
        const esRepetitiva = (cfg.tarea.subtareas || []).filter(s => s.activo).length > 0

        let programada = false
        let atrasada = false
        let dias_atraso = 0

        if (esRepetitiva) {
          // Repetitivas: usar misma lógica que el scheduler
          // Si tiene tipo/dias_semana, respetar la programación
          const resultado_eval = evaluarConfigParaFecha(cfg, fecha, ultimaFecha)
          if (resultado_eval.programada) {
            programada = true
            atrasada = resultado_eval.atrasada || false
            dias_atraso = resultado_eval.dias_atraso || 0
          } else {
            // Fallback: si fecha >= fecha_inicio y no tiene tipo específico, aparece
            const fechaInicio = new Date(cfg.fecha_inicio + 'T12:00:00')
            const fechaConsulta = new Date(fecha + 'T12:00:00')
            programada = fechaConsulta >= fechaInicio && (!cfg.tipo || cfg.tipo === 'frecuencia')
          }
        } else {
          const resultado_eval = evaluarConfigParaFecha(cfg, fecha, ultimaFecha)
          programada = resultado_eval.programada
          atrasada = resultado_eval.atrasada || false
          dias_atraso = resultado_eval.dias_atraso || 0
        }

        if (!programada) continue

        // Calcular próxima fecha
        let proxima_fecha = null
        let reprogramada = false
        if (cfg.reprogramar_siguiente) {
          // Calcular próxima según la lógica real del scheduler
          const prox = calcularProximaFecha(cfg, fecha)
          if (prox) {
            proxima_fecha = prox.toISOString().split('T')[0]
          } else {
            // Fallback: día siguiente
            const sig = new Date(new Date(fecha + 'T12:00:00').getTime() + 86400000)
            proxima_fecha = sig.toISOString().split('T')[0]
          }
          reprogramada = true
        } else {
          const prox = calcularProximaFecha(cfg, ultimaFecha || fecha)
          if (prox) proxima_fecha = prox.toISOString().split('T')[0]
        }

        noRealizadas.push({
          tarea_config_id: cfg.id,
          nombre: cfg.tarea.nombre,
          atrasada,
          dias_atraso,
          proxima_fecha,
          reprogramada,
        })
      }

      resultado.push({
        sucursal_id: sucId,
        sucursal_nombre: suc.sucursal_nombre,
        registros,
        no_realizadas: noRealizadas,
        total_realizadas: registros.length,
        total_no_realizadas: noRealizadas.length,
      })
    }

    resultado.sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre))
    res.json(resultado)
  } catch (err) {
    logger.error('Error panel-dia:', err)
    res.status(500).json({ error: 'Error al obtener panel por día' })
  }
}))

// GET /api/tareas/panel-general — Estado de todas las tareas en todas las sucursales
// Reutiliza obtenerTareasPendientes para que la lógica sea idéntica a la vista de sucursal
router.get('/panel-general', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { hoyStr } = fechaArgentina()

    // Obtener todas las sucursales que tienen configs activas
    const { data: configs, error: errCfg } = await supabase
      .from('tareas_config_sucursal')
      .select('sucursal_id, sucursal:sucursales(id, nombre)')
      .eq('activo', true)

    if (errCfg) throw errCfg
    if (!configs || configs.length === 0) return res.json([])

    // Sucursales únicas
    const sucursalesMap = {}
    for (const c of configs) {
      const id = c.sucursal?.id || c.sucursal_id
      if (!sucursalesMap[id]) {
        sucursalesMap[id] = c.sucursal?.nombre || 'Sin sucursal'
      }
    }

    // Traer ejecuciones de hoy para saber cuáles están completadas
    const { data: ejecucionesHoy, error: errEj } = await supabase
      .from('ejecuciones_tarea')
      .select('tarea_config_id, completada_por:perfiles(nombre), created_at')
      .eq('fecha_ejecucion', hoyStr)

    if (errEj) throw errEj

    const ejMap = {}
    for (const ej of (ejecucionesHoy || [])) {
      ejMap[ej.tarea_config_id] = ej
    }

    // Traer configs con nombre de tarea para enriquecer ejecuciones sin pendiente
    const { data: allConfigs } = await supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id, tarea:tareas(id, nombre, descripcion), frecuencia_dias')
      .eq('activo', true)

    const configMap = {}
    for (const c of (allConfigs || [])) {
      configMap[c.id] = c
    }

    // Para cada sucursal, usar la misma lógica que la vista de operario
    const resultado = []
    for (const [sucId, sucNombre] of Object.entries(sucursalesMap)) {
      const pendientes = await obtenerTareasPendientes(sucId)
      const pendientesIds = new Set(pendientes.map(t => t.tarea_config_id))

      const tareas = pendientes.map(t => {
        const ejecucion = ejMap[t.tarea_config_id]
        const completada = !!ejecucion
        return {
          tarea_config_id: t.tarea_config_id,
          tarea_id: t.tarea_id,
          nombre: t.nombre,
          descripcion: t.descripcion,
          frecuencia_dias: t.frecuencia_dias,
          fecha_programada: t.fecha_programada,
          completada,
          atrasada: t.atrasada,
          dias_atraso: t.dias_atraso,
          completada_por: ejecucion?.completada_por?.nombre || null,
          hora_completada: ejecucion?.created_at || null,
        }
      })

      // Agregar tareas ejecutadas hoy que ya no están en pendientes
      // (porque obtenerTareasPendientes las saltea al estar completas)
      for (const ej of (ejecucionesHoy || [])) {
        const cfg = configMap[ej.tarea_config_id]
        if (!cfg || String(cfg.sucursal_id) !== String(sucId)) continue
        if (pendientesIds.has(ej.tarea_config_id)) continue
        tareas.push({
          tarea_config_id: ej.tarea_config_id,
          tarea_id: cfg.tarea?.id,
          nombre: cfg.tarea?.nombre || '-',
          descripcion: cfg.tarea?.descripcion || null,
          frecuencia_dias: cfg.frecuencia_dias,
          fecha_programada: hoyStr,
          completada: true,
          atrasada: false,
          dias_atraso: 0,
          completada_por: ej.completada_por?.nombre || null,
          hora_completada: ej.created_at || null,
        })
      }

      resultado.push({
        sucursal_id: sucId,
        sucursal_nombre: sucNombre,
        tareas,
        total: tareas.length,
        completadas: tareas.filter(t => t.completada).length,
        pendientes: tareas.filter(t => !t.completada).length,
      })
    }

    resultado.sort((a, b) => b.pendientes - a.pendientes || a.sucursal_nombre.localeCompare(b.sucursal_nombre))
    res.json(resultado)
  } catch (err) {
    logger.error('Error panel general:', err)
    res.status(500).json({ error: 'Error al obtener panel general' })
  }
}))

// ── Operario: Pendientes + Ejecutar ─────────────────────────────────────────

// GET /api/tareas/pendientes — Tareas pendientes hoy
router.get('/pendientes', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const sucursalId = req.perfil.rol === 'admin'
      ? req.query.sucursal_id || req.perfil.sucursal_id || null
      : req.perfil.sucursal_id

    if (!sucursalId && req.perfil.rol !== 'admin') {
      return res.status(400).json({ error: 'Sucursal no determinada' })
    }

    // Admin sin sucursal: traer pendientes de todas las sucursales
    if (!sucursalId) {
      const { data: sucursales } = await supabase.from('sucursales').select('id')
      const todas = await Promise.all(
        (sucursales || []).map(s => obtenerTareasPendientes(s.id))
      )
      return res.json(todas.flat())
    }

    const pendientes = await obtenerTareasPendientes(sucursalId)
    res.json(pendientes)
  } catch (err) {
    logger.error('Error al obtener pendientes:', err)
    res.status(500).json({ error: 'Error al obtener tareas pendientes' })
  }
}))

// GET /api/tareas/recomendacion/:tarea_config_id — Días desde última ejecución por empleado
router.get('/recomendacion/:tarea_config_id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { tarea_config_id } = req.params

    // Traer empleados activos de empresa zaatar
    const { data: empleados, error: errEmp } = await supabase
      .from('empleados')
      .select('id, nombre')
      .eq('activo', true)
      .eq('empresa', 'zaatar')
      .order('nombre')

    if (errEmp) throw errEmp

    // Traer todas las ejecuciones de esta tarea con sus empleados
    const { data: ejecuciones, error: errExec } = await supabase
      .from('ejecuciones_tarea')
      .select('id, fecha_ejecucion')
      .eq('tarea_config_id', tarea_config_id)
      .order('fecha_ejecucion', { ascending: false })

    if (errExec) throw errExec

    const { hoy } = fechaArgentina()

    if (!ejecuciones || ejecuciones.length === 0) {
      // Nunca ejecutada: todos los empleados con dias_desde = null
      return res.json(empleados.map(e => ({
        ...e,
        dias_desde: null,
        ultima_fecha: null,
      })))
    }

    // Traer relación ejecución-empleado
    const execIds = ejecuciones.map(e => e.id)
    const { data: relaciones, error: errRel } = await supabase
      .from('ejecuciones_empleados')
      .select('ejecucion_id, empleado_id')
      .in('ejecucion_id', execIds)

    if (errRel) throw errRel

    // Mapear última fecha de ejecución por empleado
    const execFechaMap = {}
    for (const e of ejecuciones) {
      execFechaMap[e.id] = e.fecha_ejecucion
    }

    const ultimaFechaPorEmpleado = {}
    for (const rel of (relaciones || [])) {
      const fecha = execFechaMap[rel.ejecucion_id]
      if (!ultimaFechaPorEmpleado[rel.empleado_id] || fecha > ultimaFechaPorEmpleado[rel.empleado_id]) {
        ultimaFechaPorEmpleado[rel.empleado_id] = fecha
      }
    }

    const resultado = empleados.map(emp => {
      const ultimaFecha = ultimaFechaPorEmpleado[emp.id] || null
      let dias_desde = null
      if (ultimaFecha) {
        const f = new Date(ultimaFecha)
        f.setHours(0, 0, 0, 0)
        dias_desde = Math.floor((hoy - f) / (1000 * 60 * 60 * 24))
      }
      return {
        ...emp,
        dias_desde,
        ultima_fecha: ultimaFecha,
      }
    })

    // Ordenar: nunca hicieron primero, luego por más días sin hacer
    resultado.sort((a, b) => {
      if (a.dias_desde === null && b.dias_desde === null) return a.nombre.localeCompare(b.nombre)
      if (a.dias_desde === null) return -1
      if (b.dias_desde === null) return 1
      return b.dias_desde - a.dias_desde
    })

    res.json(resultado)
  } catch (err) {
    logger.error('Error al obtener recomendación:', err)
    res.status(500).json({ error: 'Error al obtener recomendación' })
  }
}))

// POST /api/tareas/ejecutar — Completar tarea
router.post('/ejecutar', verificarAuth, validate(ejecutarTareaSchema), asyncHandler(async (req, res) => {
  try {
    const { tarea_config_id, empleados_ids, subtareas_completadas, observaciones, calificacion } = req.body

    // Verificar que la config existe y pertenece a la sucursal del usuario
    const { data: config, error: errConfig } = await supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id')
      .eq('id', tarea_config_id)
      .single()

    if (errConfig || !config) {
      return res.status(404).json({ error: 'Configuración de tarea no encontrada' })
    }

    if (req.perfil.rol !== 'admin' && config.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No puede completar tareas de otra sucursal' })
    }

    // Calcular fecha programada con query liviana (sin cargar todas las pendientes)
    const { calcularProximaFecha, fechaArgentina } = require('../services/tareasScheduler')
    const [{ data: configFull }, { data: ultimaEjec }] = await Promise.all([
      supabase.from('tareas_config_sucursal').select('frecuencia_dias, dia_preferencia, fecha_inicio').eq('id', tarea_config_id).single(),
      supabase.from('ejecuciones_tarea').select('fecha_ejecucion').eq('tarea_config_id', tarea_config_id).order('fecha_ejecucion', { ascending: false }).limit(1).maybeSingle(),
    ])
    const proximaFecha = calcularProximaFecha(configFull, ultimaEjec?.fecha_ejecucion || null)
    const { hoy: hoyDate, hoyStr } = fechaArgentina()
    const fechaProgramada = proximaFecha <= hoyDate ? proximaFecha.toISOString().split('T')[0] : hoyStr

    // Validar calificación si viene
    const calif = calificacion ? parseInt(calificacion) : null
    if (calif !== null && (calif < 1 || calif > 5)) {
      return res.status(400).json({ error: 'La calificación debe ser entre 1 y 5' })
    }

    // Crear ejecución
    const { data: ejecucion, error: errEjec } = await supabase
      .from('ejecuciones_tarea')
      .insert({
        tarea_config_id,
        fecha_programada: fechaProgramada,
        fecha_ejecucion: hoyStr,
        completada_por_id: req.perfil.id,
        observaciones: observaciones?.trim() || null,
        calificacion: calif,
      })
      .select()
      .single()

    if (errEjec) throw errEjec

    // Registrar empleados y subtareas en paralelo
    const promesas = []
    if (empleados_ids && empleados_ids.length > 0) {
      promesas.push(
        supabase.from('ejecuciones_empleados').insert(
          empleados_ids.map(eid => ({ ejecucion_id: ejecucion.id, empleado_id: eid }))
        )
      )
    }
    if (subtareas_completadas && subtareas_completadas.length > 0) {
      promesas.push(
        supabase.from('ejecuciones_subtareas').insert(
          subtareas_completadas.map(s => ({ ejecucion_id: ejecucion.id, subtarea_id: s.subtarea_id, completada: s.completada !== false }))
        )
      )
    }
    if (promesas.length > 0) {
      const resultados = await Promise.all(promesas)
      for (const r of resultados) {
        if (r.error) throw r.error
      }
    }

    res.status(201).json(ejecucion)
  } catch (err) {
    logger.error('Error al ejecutar tarea:', err)
    res.status(500).json({ error: 'Error al registrar ejecución' })
  }
}))

// ── Analytics (gestor o admin) ──────────────────────────────────────────────

// GET /api/tareas/analytics/resumen
router.get('/analytics/resumen', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    // Obtener todas las configs activas
    let configQuery = supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id, frecuencia_dias, fecha_inicio, tarea:tareas(nombre), sucursal:sucursales(nombre)')
      .eq('activo', true)

    if (sucursal_id) configQuery = configQuery.eq('sucursal_id', sucursal_id)

    const { data: configs, error: errConfigs } = await configQuery
    if (errConfigs) throw errConfigs

    // Obtener ejecuciones en rango con detalle
    let ejQuery = supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_programada, fecha_ejecucion, completada_por:perfiles(nombre)')
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)

    const { data: ejecuciones, error: errEj } = await ejQuery
    if (errEj) throw errEj

    // Calcular total esperado vs ejecutado
    const totalEjecutadas = ejecuciones.length
    const totalConfigs = configs.length

    // Calcular total esperado: cuántas ejecuciones debería haber por config en el rango
    const dDesde = new Date(fechaDesde)
    const dHasta = new Date(fechaHasta)
    let totalEsperadas = 0

    // Agrupar ejecuciones por sucursal
    const porSucursal = {}
    for (const config of configs) {
      const sucNombre = config.sucursal?.nombre || 'Sin sucursal'
      if (!porSucursal[sucNombre]) porSucursal[sucNombre] = { ejecutadas: 0, esperadas: 0, a_tiempo: 0, atrasadas: 0, configs: 0 }
      porSucursal[sucNombre].configs++

      // Calcular cuántas veces debía ejecutarse en el rango
      const inicio = new Date(config.fecha_inicio)
      const desde = inicio > dDesde ? inicio : dDesde
      if (desde > dHasta) continue
      const diasEnRango = Math.floor((dHasta - desde) / (1000 * 60 * 60 * 24)) + 1
      const esperadas = Math.max(1, Math.floor(diasEnRango / (config.frecuencia_dias || 7)))
      totalEsperadas += esperadas
      porSucursal[sucNombre].esperadas += esperadas
    }
    for (const ej of ejecuciones) {
      const config = configs.find(c => c.id === ej.tarea_config_id)
      if (config) {
        const sucNombre = config.sucursal?.nombre || 'Sin sucursal'
        if (porSucursal[sucNombre]) {
          porSucursal[sucNombre].ejecutadas++
          if (ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada) {
            porSucursal[sucNombre].atrasadas++
          } else {
            porSucursal[sucNombre].a_tiempo++
          }
        }
      }
    }

    // Clasificar a_tiempo vs atrasadas con detalle
    let a_tiempo = 0
    let atrasadas = 0
    const detalle_a_tiempo = []
    const detalle_atrasadas = []

    // Mapa config -> info para enriquecer detalle
    const configMap = {}
    for (const c of configs) {
      configMap[c.id] = { tarea: c.tarea?.nombre, sucursal: c.sucursal?.nombre }
    }

    for (const ej of ejecuciones) {
      const info = configMap[ej.tarea_config_id] || {}
      const item = {
        tarea: info.tarea || 'Tarea',
        sucursal: info.sucursal || '',
        fecha_ejecucion: ej.fecha_ejecucion,
        fecha_programada: ej.fecha_programada,
        completada_por: ej.completada_por?.nombre || null,
      }
      if (ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada) {
        atrasadas++
        const diffDias = Math.ceil((new Date(ej.fecha_ejecucion) - new Date(ej.fecha_programada)) / (1000 * 60 * 60 * 24))
        detalle_atrasadas.push({ ...item, dias_atraso: diffDias })
      } else {
        a_tiempo++
        detalle_a_tiempo.push(item)
      }
    }

    res.json({
      periodo: { desde: fechaDesde, hasta: fechaHasta },
      total_ejecutadas: totalEjecutadas,
      total_esperadas: totalEsperadas,
      total_configs_activas: totalConfigs,
      a_tiempo,
      atrasadas,
      detalle_a_tiempo,
      detalle_atrasadas,
      por_sucursal: Object.entries(porSucursal).map(([nombre, v]) => ({
        sucursal: nombre,
        ejecutadas: v.ejecutadas,
        esperadas: v.esperadas,
        no_ejecutadas: Math.max(0, v.esperadas - v.ejecutadas),
        a_tiempo: v.a_tiempo,
        atrasadas: v.atrasadas,
        configs_activas: v.configs,
      })),
    })
  } catch (err) {
    logger.error('Error analytics resumen:', err)
    res.status(500).json({ error: 'Error al obtener resumen' })
  }
}))

// GET /api/tareas/analytics/timeline
router.get('/analytics/timeline', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    let ejQuery = supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_programada, fecha_ejecucion')
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)
      .order('fecha_ejecucion')

    const { data: ejecuciones, error } = await ejQuery
    if (error) throw error

    // Filtrar por sucursal si se pide
    let ejecsFiltradas = ejecuciones
    if (sucursal_id) {
      const { data: configIds } = await supabase
        .from('tareas_config_sucursal')
        .select('id')
        .eq('sucursal_id', sucursal_id)
      const ids = (configIds || []).map(c => c.id)
      ejecsFiltradas = ejecuciones.filter(e => ids.includes(e.tarea_config_id))
    }

    // Agrupar por día
    const porDia = {}
    for (const ej of ejecsFiltradas) {
      const dia = ej.fecha_ejecucion
      if (!porDia[dia]) porDia[dia] = { fecha: dia, a_tiempo: 0, atrasadas: 0 }
      if (ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada) {
        porDia[dia].atrasadas++
      } else {
        porDia[dia].a_tiempo++
      }
    }

    const timeline = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha))
    res.json(timeline)
  } catch (err) {
    logger.error('Error analytics timeline:', err)
    res.status(500).json({ error: 'Error al obtener timeline' })
  }
}))

// GET /api/tareas/analytics/por-empleado
router.get('/analytics/por-empleado', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    // Traer ejecuciones con empleados, calificación y config de tarea
    let ejQuery = supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_ejecucion, calificacion, ejecuciones_empleados(empleado:empleados(id, nombre))')
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)

    const { data: ejecuciones, error } = await ejQuery
    if (error) throw error

    // Traer nombres de tareas por config
    const configIds = [...new Set(ejecuciones.map(e => e.tarea_config_id))]
    const { data: configsData } = await supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id, tarea:tareas(nombre)')
      .in('id', configIds.length > 0 ? configIds : ['none'])

    const configNombreMap = {}
    for (const c of (configsData || [])) {
      configNombreMap[c.id] = c.tarea?.nombre || 'Tarea'
    }

    // Filtrar por sucursal si se pide
    let ejecsFiltradas = ejecuciones
    if (sucursal_id) {
      const ids = (configsData || []).filter(c => c.sucursal_id === sucursal_id).map(c => c.id)
      ejecsFiltradas = ejecuciones.filter(e => ids.includes(e.tarea_config_id))
    }

    // Contar por empleado + detalle de tareas + calificaciones
    // Deduplicar: misma tarea (nombre) + mismo día + mismo empleado = 1 ejecución
    const conteo = {}
    for (const ej of ejecsFiltradas) {
      const nombreTarea = configNombreMap[ej.tarea_config_id] || 'Tarea'
      for (const ee of (ej.ejecuciones_empleados || [])) {
        const emp = ee.empleado
        if (emp) {
          if (!conteo[emp.id]) conteo[emp.id] = { nombre: emp.nombre, cantidad: 0, tareas: {}, sumaCalif: 0, countCalif: 0, _visto: {} }
          const dedupKey = `${nombreTarea}|${ej.fecha_ejecucion}`
          if (conteo[emp.id]._visto[dedupKey]) continue // ya contada
          conteo[emp.id]._visto[dedupKey] = true
          conteo[emp.id].cantidad++
          conteo[emp.id].tareas[nombreTarea] = (conteo[emp.id].tareas[nombreTarea] || 0) + 1
          if (ej.calificacion != null) {
            conteo[emp.id].sumaCalif += ej.calificacion
            conteo[emp.id].countCalif++
          }
        }
      }
    }

    const ranking = Object.values(conteo)
      .map(e => {
        const califProm = e.countCalif > 0 ? Math.round((e.sumaCalif / e.countCalif) * 10) / 10 : null
        // Score = completadas × (calificación promedio / 5)
        // Si no hay calificaciones, score = completadas × 0.6 (penalización por falta de dato)
        const factorCalidad = califProm != null ? califProm / 5 : 0.6
        const score = Math.round(e.cantidad * factorCalidad * 10) / 10
        return {
          nombre: e.nombre,
          cantidad: e.cantidad,
          calificacion_promedio: califProm,
          score,
          tareas: Object.entries(e.tareas)
            .map(([nombre, cantidad]) => ({ nombre, cantidad }))
            .sort((a, b) => b.cantidad - a.cantidad),
        }
      })
      .sort((a, b) => b.score - a.score)
    res.json(ranking)
  } catch (err) {
    logger.error('Error analytics por-empleado:', err)
    res.status(500).json({ error: 'Error al obtener ranking' })
  }
}))

// GET /api/tareas/analytics/incumplimiento
router.get('/analytics/incumplimiento', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { sucursal_id, desde, hasta } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    // Obtener todas las configs activas
    let configQuery = supabase
      .from('tareas_config_sucursal')
      .select('id, tarea:tareas(nombre), sucursal:sucursales(nombre), frecuencia_dias, fecha_inicio')
      .eq('activo', true)

    if (sucursal_id) configQuery = configQuery.eq('sucursal_id', sucursal_id)

    const { data: configs, error: errConfigs } = await configQuery
    if (errConfigs) throw errConfigs

    // Traer ejecuciones en rango
    const configIds = configs.map(c => c.id)
    const { data: ejecuciones } = await supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_programada, fecha_ejecucion, calificacion')
      .in('tarea_config_id', configIds.length > 0 ? configIds : ['none'])
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)

    // Agrupar ejecuciones por config
    const ejPorConfig = {}
    for (const ej of (ejecuciones || [])) {
      if (!ejPorConfig[ej.tarea_config_id]) ejPorConfig[ej.tarea_config_id] = []
      ejPorConfig[ej.tarea_config_id].push(ej)
    }

    const dDesde = new Date(fechaDesde)
    const dHasta = new Date(fechaHasta)

    const resultado = configs.map(config => {
      const inicio = new Date(config.fecha_inicio)
      const desde = inicio > dDesde ? inicio : dDesde
      const diasEnRango = Math.max(1, Math.floor((dHasta - desde) / (1000 * 60 * 60 * 24)) + 1)
      const esperadas = Math.max(1, Math.floor(diasEnRango / (config.frecuencia_dias || 7)))

      const ejecs = ejPorConfig[config.id] || []
      const ejecutadas = ejecs.length
      const atrasadas = ejecs.filter(e => e.fecha_programada && e.fecha_ejecucion > e.fecha_programada).length
      const a_tiempo = ejecutadas - atrasadas

      const califs = ejecs.filter(e => e.calificacion > 0).map(e => e.calificacion)
      const promCalif = califs.length > 0 ? Math.round((califs.reduce((s, c) => s + c, 0) / califs.length) * 10) / 10 : null

      const cumplimiento = esperadas > 0 ? Math.round((ejecutadas / esperadas) * 100) : 0

      return {
        tarea: config.tarea?.nombre,
        sucursal: config.sucursal?.nombre,
        frecuencia_dias: config.frecuencia_dias,
        esperadas,
        ejecutadas,
        a_tiempo,
        atrasadas,
        no_ejecutadas: Math.max(0, esperadas - ejecutadas),
        cumplimiento: Math.min(cumplimiento, 100),
        promedio_calificacion: promCalif,
      }
    })

    // Si no se filtra por sucursal, agrupar por tarea
    let final
    if (sucursal_id) {
      final = resultado
    } else {
      const agrupado = {}
      for (const r of resultado) {
        const key = r.tarea
        if (!agrupado[key]) {
          agrupado[key] = { tarea: r.tarea, sucursal: 'Todas', frecuencia_dias: r.frecuencia_dias, esperadas: 0, ejecutadas: 0, a_tiempo: 0, atrasadas: 0, no_ejecutadas: 0, sum_calif: 0, count_calif: 0 }
        }
        agrupado[key].esperadas += r.esperadas
        agrupado[key].ejecutadas += r.ejecutadas
        agrupado[key].a_tiempo += r.a_tiempo
        agrupado[key].atrasadas += r.atrasadas
        agrupado[key].no_ejecutadas += r.no_ejecutadas
        if (r.promedio_calificacion) {
          agrupado[key].sum_calif += r.promedio_calificacion * r.ejecutadas
          agrupado[key].count_calif += r.ejecutadas
        }
      }
      final = Object.values(agrupado).map(r => ({
        ...r,
        cumplimiento: r.esperadas > 0 ? Math.min(100, Math.round((r.ejecutadas / r.esperadas) * 100)) : 0,
        promedio_calificacion: r.count_calif > 0 ? Math.round((r.sum_calif / r.count_calif) * 10) / 10 : null,
      }))
      // Limpiar campos internos
      final.forEach(r => { delete r.sum_calif; delete r.count_calif })
    }

    final.sort((a, b) => a.cumplimiento - b.cumplimiento)
    res.json(final)
  } catch (err) {
    logger.error('Error analytics incumplimiento:', err)
    res.status(500).json({ error: 'Error al obtener incumplimiento' })
  }
}))

// GET /api/tareas/analytics/historial
router.get('/analytics/historial', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { desde, hasta, sucursal_id, tarea_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    let query = supabase
      .from('ejecuciones_tarea')
      .select(`
        id, fecha_programada, fecha_ejecucion, observaciones, calificacion, created_at,
        completada_por:perfiles(nombre),
        tarea_config:tareas_config_sucursal(
          tarea:tareas(nombre),
          sucursal:sucursales(nombre)
        ),
        ejecuciones_empleados(empleado:empleados(nombre)),
        ejecuciones_subtareas(subtarea:subtareas(nombre), completada)
      `)
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)
      .order('fecha_ejecucion', { ascending: false })
      .limit(100)

    const { data, error } = await query
    if (error) throw error

    // Filtrar en JS si se pide sucursal o tarea
    let resultado = data
    if (sucursal_id || tarea_id) {
      // Obtener config ids que matchean
      let cfgQuery = supabase.from('tareas_config_sucursal').select('id')
      if (sucursal_id) cfgQuery = cfgQuery.eq('sucursal_id', sucursal_id)
      if (tarea_id) cfgQuery = cfgQuery.eq('tarea_id', tarea_id)
      const { data: cfgIds } = await cfgQuery
      const ids = (cfgIds || []).map(c => c.id)
      resultado = data.filter(e => ids.includes(e.tarea_config?.id))
    }

    res.json(resultado)
  } catch (err) {
    logger.error('Error analytics historial:', err)
    res.status(500).json({ error: 'Error al obtener historial' })
  }
}))

// ── Ranking de empleados ─────────────────────────────────────────────────────

// GET /api/tareas/ranking?periodo=mensual|anual&mes=2026-03
router.get('/ranking', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { periodo, mes } = req.query
    const { hoyStr: hoyArgStr } = fechaArgentina()
    const [hoyY, hoyM] = hoyArgStr.split('-')

    let fechaDesde, fechaHasta, etiqueta
    if (periodo === 'anual') {
      const anio = mes ? mes.split('-')[0] : hoyY
      fechaDesde = `${anio}-01-01`
      fechaHasta = `${anio}-12-31`
      etiqueta = anio
    } else {
      // mensual por defecto
      const ref = mes || `${hoyY}-${hoyM}`
      const [y, m] = ref.split('-')
      fechaDesde = `${y}-${m}-01`
      const ultimo = new Date(parseInt(y), parseInt(m), 0).getDate()
      fechaHasta = `${y}-${m}-${String(ultimo).padStart(2, '0')}`
      const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
      etiqueta = `${meses[parseInt(m) - 1]} ${y}`
    }

    // Traer ejecuciones en rango con empleados y calificación
    const { data: ejecuciones, error: errEj } = await supabase
      .from('ejecuciones_tarea')
      .select('id, calificacion, ejecuciones_empleados(empleado_id)')
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)

    if (errEj) throw errEj

    // Traer empleados activos de empresa zaatar con fecha de cumpleaños
    const { data: empleados, error: errEmp } = await supabase
      .from('empleados')
      .select('id, nombre, fecha_cumpleanos')
      .eq('activo', true)
      .eq('empresa', 'zaatar')
      .order('nombre')

    if (errEmp) throw errEmp

    // Calcular score por empleado: total_tareas y suma de calificaciones
    const scoreMap = {}
    for (const ej of (ejecuciones || [])) {
      const calif = ej.calificacion || 0
      for (const ee of (ej.ejecuciones_empleados || [])) {
        if (!scoreMap[ee.empleado_id]) {
          scoreMap[ee.empleado_id] = { tareas: 0, suma_calif: 0, count_calif: 0 }
        }
        scoreMap[ee.empleado_id].tareas++
        if (calif > 0) {
          scoreMap[ee.empleado_id].suma_calif += calif
          scoreMap[ee.empleado_id].count_calif++
        }
      }
    }

    // Construir ranking
    const ranking = empleados.map(emp => {
      const s = scoreMap[emp.id] || { tareas: 0, suma_calif: 0, count_calif: 0 }
      const promedio = s.count_calif > 0 ? s.suma_calif / s.count_calif : 0
      // Score = promedio calificación × cantidad de tareas
      const score = Math.round(promedio * s.tareas * 10) / 10
      return {
        id: emp.id,
        nombre: emp.nombre,
        fecha_cumpleanos: emp.fecha_cumpleanos,
        tareas: s.tareas,
        promedio_calificacion: Math.round(promedio * 10) / 10,
        score,
      }
    }).sort((a, b) => b.score - a.score)

    res.json({ periodo: periodo || 'mensual', etiqueta, desde: fechaDesde, hasta: fechaHasta, ranking })
  } catch (err) {
    logger.error('Error ranking:', err)
    res.status(500).json({ error: 'Error al obtener ranking' })
  }
}))

// GET /api/tareas/analytics/tarea-detalle?tarea_id=...&desde=...&hasta=...&sucursal_id=...
router.get('/analytics/tarea-detalle', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { tarea_id, desde, hasta, sucursal_id } = req.query
    if (!tarea_id) return res.status(400).json({ error: 'tarea_id es requerido' })

    const fechaDesde = desde || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    // Configs de esta tarea
    let cfgQuery = supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id, frecuencia_dias')
      .eq('tarea_id', tarea_id)
      .eq('activo', true)
    if (sucursal_id) cfgQuery = cfgQuery.eq('sucursal_id', sucursal_id)

    const { data: configs } = await cfgQuery
    const cfgIds = (configs || []).map(c => c.id)
    if (cfgIds.length === 0) return res.json({ ejecuciones: [], timeline: [], empleados: [], subtareas_cumplimiento: [] })

    // Ejecuciones en rango
    const { data: ejecuciones } = await supabase
      .from('ejecuciones_tarea')
      .select(`
        id, tarea_config_id, fecha_programada, fecha_ejecucion, calificacion, observaciones, created_at,
        completada_por:perfiles(nombre),
        ejecuciones_empleados(empleado:empleados(id, nombre)),
        ejecuciones_subtareas(subtarea:subtareas(id, nombre), completada)
      `)
      .in('tarea_config_id', cfgIds)
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)
      .order('fecha_ejecucion', { ascending: true })

    // 1. Timeline: por fecha, calificación + puntualidad
    const timeline = (ejecuciones || []).map(ej => {
      const atrasada = ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada
      const diasAtraso = atrasada ? Math.ceil((new Date(ej.fecha_ejecucion) - new Date(ej.fecha_programada)) / (1000 * 60 * 60 * 24)) : 0
      return {
        fecha: ej.fecha_ejecucion,
        calificacion: ej.calificacion || null,
        puntualidad: atrasada ? 'atrasada' : 'a_tiempo',
        dias_atraso: diasAtraso,
        completada_por: ej.completada_por?.nombre || null,
        observaciones: ej.observaciones || null,
      }
    })

    // 2. Evolución calificación por fecha (promedio si hay varias el mismo día)
    const califPorDia = {}
    for (const ej of (ejecuciones || [])) {
      if (!ej.calificacion) continue
      if (!califPorDia[ej.fecha_ejecucion]) califPorDia[ej.fecha_ejecucion] = { sum: 0, count: 0 }
      califPorDia[ej.fecha_ejecucion].sum += ej.calificacion
      califPorDia[ej.fecha_ejecucion].count++
    }
    const evolucion_calificacion = Object.entries(califPorDia)
      .map(([fecha, v]) => ({ fecha, calificacion: Math.round((v.sum / v.count) * 10) / 10 }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

    // 3. Evolución puntualidad por fecha
    const puntPorDia = {}
    for (const ej of (ejecuciones || [])) {
      const dia = ej.fecha_ejecucion
      if (!puntPorDia[dia]) puntPorDia[dia] = { fecha: dia, a_tiempo: 0, atrasadas: 0 }
      if (ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada) {
        puntPorDia[dia].atrasadas++
      } else {
        puntPorDia[dia].a_tiempo++
      }
    }
    const evolucion_puntualidad = Object.values(puntPorDia).sort((a, b) => a.fecha.localeCompare(b.fecha))

    // 4. Concentración de empleados
    const empConteo = {}
    for (const ej of (ejecuciones || [])) {
      for (const ee of (ej.ejecuciones_empleados || [])) {
        const emp = ee.empleado
        if (emp) {
          if (!empConteo[emp.id]) empConteo[emp.id] = { nombre: emp.nombre, cantidad: 0 }
          empConteo[emp.id].cantidad++
        }
      }
    }
    const totalEjecuciones = (ejecuciones || []).length
    const empleados = Object.values(empConteo)
      .map(e => ({ ...e, porcentaje: totalEjecuciones > 0 ? Math.round((e.cantidad / totalEjecuciones) * 100) : 0 }))
      .sort((a, b) => b.cantidad - a.cantidad)

    // 5. Cumplimiento de subtareas
    const subConteo = {}
    for (const ej of (ejecuciones || [])) {
      for (const es of (ej.ejecuciones_subtareas || [])) {
        const nombre = es.subtarea?.nombre || 'Subtarea'
        const id = es.subtarea?.id || nombre
        if (!subConteo[id]) subConteo[id] = { nombre, completadas: 0, total: 0 }
        subConteo[id].total++
        if (es.completada) subConteo[id].completadas++
      }
    }
    const subtareas_cumplimiento = Object.values(subConteo)
      .map(s => ({ ...s, porcentaje: s.total > 0 ? Math.round((s.completadas / s.total) * 100) : 0 }))
      .sort((a, b) => a.porcentaje - b.porcentaje)

    // 6. Resumen rápido
    const califs = (ejecuciones || []).filter(e => e.calificacion).map(e => e.calificacion)
    const totalAtrasadas = (ejecuciones || []).filter(e => e.fecha_programada && e.fecha_ejecucion > e.fecha_programada).length

    const resumen = {
      total_ejecuciones: totalEjecuciones,
      a_tiempo: totalEjecuciones - totalAtrasadas,
      atrasadas: totalAtrasadas,
      promedio_calificacion: califs.length > 0 ? Math.round((califs.reduce((s, c) => s + c, 0) / califs.length) * 10) / 10 : null,
      mejor_calificacion: califs.length > 0 ? Math.max(...califs) : null,
      peor_calificacion: califs.length > 0 ? Math.min(...califs) : null,
    }

    res.json({
      resumen,
      evolucion_calificacion,
      evolucion_puntualidad,
      empleados,
      subtareas_cumplimiento,
      ejecuciones: timeline,
    })
  } catch (err) {
    logger.error('Error analytics tarea-detalle:', err)
    res.status(500).json({ error: 'Error al obtener detalle de tarea' })
  }
}))

// GET /api/tareas/analytics/calidad — Análisis de calidad/calificaciones
router.get('/analytics/calidad', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    // Traer ejecuciones con calificación, observaciones, empleados, tarea
    let cfgFilter = supabase
      .from('tareas_config_sucursal')
      .select('id, tarea:tareas(nombre), sucursal:sucursales(nombre)')
      .eq('activo', true)
    if (sucursal_id) cfgFilter = cfgFilter.eq('sucursal_id', sucursal_id)
    const { data: configs } = await cfgFilter
    const cfgIds = (configs || []).map(c => c.id)
    if (cfgIds.length === 0) return res.json({ distribucion: [], evolucion: [], peores_tareas: [], peores_empleados: [], observaciones_criticas: [], tendencia: null })

    const cfgMap = {}
    for (const c of configs) cfgMap[c.id] = { tarea: c.tarea?.nombre, sucursal: c.sucursal?.nombre }

    const { data: ejecuciones } = await supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_ejecucion, calificacion, observaciones, completada_por:perfiles(nombre), ejecuciones_empleados(empleado:empleados(id, nombre))')
      .in('tarea_config_id', cfgIds)
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)
      .order('fecha_ejecucion', { ascending: true })

    const ejecs = ejecuciones || []
    const conCalif = ejecs.filter(e => e.calificacion > 0)

    // 1. Distribución de calificaciones (1-5)
    const distribucion = [1, 2, 3, 4, 5].map(n => ({
      estrellas: n,
      cantidad: conCalif.filter(e => e.calificacion === n).length,
    }))

    // 2. Evolución promedio por semana
    const porSemana = {}
    for (const ej of conCalif) {
      const d = new Date(ej.fecha_ejecucion)
      // Agrupar por semana (lunes)
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const lunes = new Date(d.setDate(diff))
      const key = lunes.toISOString().split('T')[0]
      if (!porSemana[key]) porSemana[key] = { fecha: key, sum: 0, count: 0 }
      porSemana[key].sum += ej.calificacion
      porSemana[key].count++
    }
    const evolucion = Object.values(porSemana)
      .map(s => ({ fecha: s.fecha, promedio: Math.round((s.sum / s.count) * 10) / 10, cantidad: s.count }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))

    // 3. Peores tareas (promedio calificación más bajo)
    const porTarea = {}
    for (const ej of conCalif) {
      const info = cfgMap[ej.tarea_config_id]
      const key = info?.tarea || 'Tarea'
      if (!porTarea[key]) porTarea[key] = { tarea: key, sum: 0, count: 0, bajas: 0, observaciones_count: 0 }
      porTarea[key].sum += ej.calificacion
      porTarea[key].count++
      if (ej.calificacion <= 2) porTarea[key].bajas++
      if (ej.observaciones) porTarea[key].observaciones_count++
    }
    const peores_tareas = Object.values(porTarea)
      .map(t => ({
        tarea: t.tarea,
        promedio: Math.round((t.sum / t.count) * 10) / 10,
        total: t.count,
        bajas: t.bajas,
        con_observaciones: t.observaciones_count,
      }))
      .sort((a, b) => a.promedio - b.promedio)

    // 4. Empleados con peores calificaciones
    const porEmpleado = {}
    for (const ej of conCalif) {
      for (const ee of (ej.ejecuciones_empleados || [])) {
        const emp = ee.empleado
        if (!emp) continue
        if (!porEmpleado[emp.id]) porEmpleado[emp.id] = { nombre: emp.nombre, sum: 0, count: 0, bajas: 0 }
        porEmpleado[emp.id].sum += ej.calificacion
        porEmpleado[emp.id].count++
        if (ej.calificacion <= 2) porEmpleado[emp.id].bajas++
      }
    }
    const peores_empleados = Object.values(porEmpleado)
      .map(e => ({
        nombre: e.nombre,
        promedio: Math.round((e.sum / e.count) * 10) / 10,
        total: e.count,
        bajas: e.bajas,
        pct_bajas: e.count > 0 ? Math.round((e.bajas / e.count) * 100) : 0,
      }))
      .sort((a, b) => a.promedio - b.promedio)

    // 5. Observaciones de ejecuciones con calificación baja (<=2)
    const observaciones_criticas = ejecs
      .filter(e => e.calificacion && e.calificacion <= 2 && e.observaciones)
      .map(e => ({
        fecha: e.fecha_ejecucion,
        tarea: cfgMap[e.tarea_config_id]?.tarea || 'Tarea',
        sucursal: cfgMap[e.tarea_config_id]?.sucursal || '',
        calificacion: e.calificacion,
        observaciones: e.observaciones,
        completada_por: e.completada_por?.nombre || null,
        empleados: (e.ejecuciones_empleados || []).map(ee => ee.empleado?.nombre).filter(Boolean),
      }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 20)

    // 6. Tendencia (comparar primera mitad vs segunda mitad del periodo)
    let tendencia = null
    if (conCalif.length >= 4) {
      const mitad = Math.floor(conCalif.length / 2)
      const primera = conCalif.slice(0, mitad)
      const segunda = conCalif.slice(mitad)
      const prom1 = primera.reduce((s, e) => s + e.calificacion, 0) / primera.length
      const prom2 = segunda.reduce((s, e) => s + e.calificacion, 0) / segunda.length
      const diff = Math.round((prom2 - prom1) * 10) / 10
      tendencia = {
        primera_mitad: Math.round(prom1 * 10) / 10,
        segunda_mitad: Math.round(prom2 * 10) / 10,
        diferencia: diff,
        direccion: diff > 0.2 ? 'mejorando' : diff < -0.2 ? 'empeorando' : 'estable',
      }
    }

    // 7. Promedio general
    const promedio_general = conCalif.length > 0
      ? Math.round((conCalif.reduce((s, e) => s + e.calificacion, 0) / conCalif.length) * 10) / 10
      : null

    res.json({
      promedio_general,
      total_calificadas: conCalif.length,
      total_sin_calificar: ejecs.length - conCalif.length,
      distribucion,
      evolucion,
      peores_tareas,
      peores_empleados,
      observaciones_criticas,
      tendencia,
    })
  } catch (err) {
    logger.error('Error analytics calidad:', err)
    res.status(500).json({ error: 'Error al obtener análisis de calidad' })
  }
}))

// GET /api/tareas/analytics/rendimiento-empleado — Análisis individual de un empleado
router.get('/analytics/rendimiento-empleado', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, desde, hasta, sucursal_id } = req.query
    if (!empleado_id) return res.status(400).json({ error: 'empleado_id requerido' })

    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || fechaArgentina().hoyStr

    // Traer info del empleado
    const { data: empleado } = await supabase
      .from('empleados')
      .select('id, nombre, sucursal_id')
      .eq('id', empleado_id)
      .single()

    if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' })

    // Traer ejecuciones del empleado en el rango
    const { data: participaciones, error: errPart } = await supabase
      .from('ejecuciones_empleados')
      .select('ejecucion:ejecuciones_tarea(id, tarea_config_id, fecha_programada, fecha_ejecucion, calificacion, observaciones, created_at)')
      .eq('empleado_id', empleado_id)

    if (errPart) throw errPart

    // Filtrar por rango de fecha
    const ejecs = (participaciones || [])
      .map(p => p.ejecucion)
      .filter(e => e && e.fecha_ejecucion >= fechaDesde && e.fecha_ejecucion <= fechaHasta)

    // Traer configs con nombres de tarea y sucursal
    const configIds = [...new Set(ejecs.map(e => e.tarea_config_id))]
    let configsData = []
    if (configIds.length > 0) {
      const { data } = await supabase
        .from('tareas_config_sucursal')
        .select('id, sucursal_id, tarea:tareas(nombre), sucursal:sucursales(nombre)')
        .in('id', configIds)
      configsData = data || []
    }

    const configMap = {}
    for (const c of configsData) {
      configMap[c.id] = { tarea: c.tarea?.nombre || 'Tarea', sucursal: c.sucursal?.nombre || '', sucursal_id: c.sucursal_id }
    }

    // Filtrar por sucursal si se pide
    let ejecutadas = ejecs
    if (sucursal_id) {
      const idsConfig = configsData.filter(c => c.sucursal_id === sucursal_id).map(c => c.id)
      ejecutadas = ejecs.filter(e => idsConfig.includes(e.tarea_config_id))
    }

    // Deduplicar: si la misma tarea (por nombre) se ejecutó varias veces el mismo día
    // (ej: configurada en múltiples sucursales), contar solo 1 vez.
    // Se queda con la mejor calificación si hay varias.
    const dedup = {}
    for (const e of ejecutadas) {
      const nombre = configMap[e.tarea_config_id]?.tarea || 'Tarea'
      const key = `${nombre}|${e.fecha_ejecucion}`
      if (!dedup[key]) {
        dedup[key] = { ...e, _nombre: nombre }
      } else {
        // Quedarse con la mejor calificación
        if (e.calificacion != null && (dedup[key].calificacion == null || e.calificacion > dedup[key].calificacion)) {
          dedup[key] = { ...e, _nombre: nombre }
        }
      }
    }
    ejecutadas = Object.values(dedup)

    // --- KPIs ---
    const total = ejecutadas.length
    let aTiempo = 0
    let atrasadas = 0
    let sumaCalif = 0
    let countCalif = 0
    const detalleAtrasadas = []

    for (const e of ejecutadas) {
      const prog = new Date(e.fecha_programada)
      const ejec = new Date(e.fecha_ejecucion)
      const diffDias = Math.ceil((ejec - prog) / (1000 * 60 * 60 * 24))
      if (diffDias <= 0) {
        aTiempo++
      } else {
        atrasadas++
        detalleAtrasadas.push({
          tarea: configMap[e.tarea_config_id]?.tarea || 'Tarea',
          sucursal: configMap[e.tarea_config_id]?.sucursal || '',
          fecha_programada: e.fecha_programada,
          fecha_ejecucion: e.fecha_ejecucion,
          dias_atraso: diffDias,
        })
      }
      if (e.calificacion != null) {
        sumaCalif += e.calificacion
        countCalif++
      }
    }

    const diasEnRango = Math.max(1, Math.floor((new Date(fechaHasta) - new Date(fechaDesde)) / (1000 * 60 * 60 * 24)) + 1)

    // --- Evolución diaria ---
    const porDia = {}
    for (const e of ejecutadas) {
      const f = e.fecha_ejecucion
      if (!porDia[f]) porDia[f] = { fecha: f, completadas: 0, a_tiempo: 0, atrasadas: 0 }
      porDia[f].completadas++
      const prog = new Date(e.fecha_programada)
      const ejec = new Date(e.fecha_ejecucion)
      if (ejec <= prog) porDia[f].a_tiempo++
      else porDia[f].atrasadas++
    }
    const evolucionDiaria = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha))

    // --- Por tipo de tarea ---
    const porTarea = {}
    for (const e of ejecutadas) {
      const nombre = configMap[e.tarea_config_id]?.tarea || 'Tarea'
      if (!porTarea[nombre]) porTarea[nombre] = { tarea: nombre, cantidad: 0, a_tiempo: 0, sumaCalif: 0, countCalif: 0 }
      porTarea[nombre].cantidad++
      const prog = new Date(e.fecha_programada)
      const ejec = new Date(e.fecha_ejecucion)
      if (ejec <= prog) porTarea[nombre].a_tiempo++
      if (e.calificacion != null) {
        porTarea[nombre].sumaCalif += e.calificacion
        porTarea[nombre].countCalif++
      }
    }
    const porTipoTarea = Object.values(porTarea)
      .map(t => ({
        tarea: t.tarea,
        cantidad: t.cantidad,
        puntualidad_pct: t.cantidad > 0 ? Math.round((t.a_tiempo / t.cantidad) * 100) : 0,
        calificacion_promedio: t.countCalif > 0 ? Math.round((t.sumaCalif / t.countCalif) * 10) / 10 : null,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)

    // --- Calidad: distribución de calificaciones ---
    const distribucion = [1, 2, 3, 4, 5].map(n => ({ estrellas: n, cantidad: 0 }))
    for (const e of ejecutadas) {
      if (e.calificacion != null && e.calificacion >= 1 && e.calificacion <= 5) {
        distribucion[e.calificacion - 1].cantidad++
      }
    }

    // --- Comparación vs equipo ---
    // Traer TODAS las ejecuciones del rango (todos los empleados)
    const { data: todasPart } = await supabase
      .from('ejecuciones_empleados')
      .select('empleado_id, ejecucion:ejecuciones_tarea(fecha_programada, fecha_ejecucion, calificacion, tarea_config_id)')

    const todosEjecs = (todasPart || [])
      .map(p => ({ ...p.ejecucion, empleado_id: p.empleado_id }))
      .filter(e => e && e.fecha_ejecucion >= fechaDesde && e.fecha_ejecucion <= fechaHasta)

    // Filtrar por sucursal si aplica
    let todosFiltrados = todosEjecs
    if (sucursal_id) {
      const idsConfig = configsData.filter(c => c.sucursal_id === sucursal_id).map(c => c.id)
      // Necesitamos todas las configs, no solo las del empleado
      const { data: allConfigs } = await supabase
        .from('tareas_config_sucursal')
        .select('id')
        .eq('sucursal_id', sucursal_id)
      const allIds = (allConfigs || []).map(c => c.id)
      todosFiltrados = todosEjecs.filter(e => allIds.includes(e.tarea_config_id))
    }

    // Agrupar por empleado para promedios
    const porEmpleado = {}
    for (const e of todosFiltrados) {
      if (!porEmpleado[e.empleado_id]) porEmpleado[e.empleado_id] = { total: 0, aTiempo: 0, sumaCalif: 0, countCalif: 0 }
      const p = porEmpleado[e.empleado_id]
      p.total++
      const prog = new Date(e.fecha_programada)
      const ejec = new Date(e.fecha_ejecucion)
      if (ejec <= prog) p.aTiempo++
      if (e.calificacion != null) { p.sumaCalif += e.calificacion; p.countCalif++ }
    }

    const empleadosIds = Object.keys(porEmpleado)
    const cantEmpleados = empleadosIds.length || 1
    let equipoTotalComp = 0, equipoTotalATiempo = 0, equipoTotalEjecs = 0, equipoSumaCalif = 0, equipoCountCalif = 0
    for (const id of empleadosIds) {
      const p = porEmpleado[id]
      equipoTotalComp += p.total
      equipoTotalATiempo += p.aTiempo
      equipoTotalEjecs += p.total
      equipoSumaCalif += p.sumaCalif
      equipoCountCalif += p.countCalif
    }

    res.json({
      empleado: { id: empleado.id, nombre: empleado.nombre },
      periodo: { desde: fechaDesde, hasta: fechaHasta },
      kpis: {
        total_completadas: total,
        puntualidad_pct: total > 0 ? Math.round((aTiempo / total) * 100) : 0,
        calificacion_promedio: countCalif > 0 ? Math.round((sumaCalif / countCalif) * 10) / 10 : null,
        tareas_por_dia: Math.round((total / diasEnRango) * 10) / 10,
      },
      evolucion_diaria: evolucionDiaria,
      por_tipo_tarea: porTipoTarea,
      puntualidad: {
        a_tiempo: aTiempo,
        atrasadas,
        detalle_atrasadas: detalleAtrasadas.sort((a, b) => b.dias_atraso - a.dias_atraso),
      },
      calidad: {
        promedio: countCalif > 0 ? Math.round((sumaCalif / countCalif) * 10) / 10 : null,
        total_calificadas: countCalif,
        distribucion,
      },
      comparacion_equipo: {
        empleado_completadas: total,
        equipo_promedio_completadas: Math.round(equipoTotalComp / cantEmpleados),
        empleado_puntualidad: total > 0 ? Math.round((aTiempo / total) * 100) : 0,
        equipo_promedio_puntualidad: equipoTotalEjecs > 0 ? Math.round((equipoTotalATiempo / equipoTotalEjecs) * 100) : 0,
        empleado_calificacion: countCalif > 0 ? Math.round((sumaCalif / countCalif) * 10) / 10 : null,
        equipo_promedio_calificacion: equipoCountCalif > 0 ? Math.round((equipoSumaCalif / equipoCountCalif) * 10) / 10 : null,
      },
    })
  } catch (err) {
    logger.error('Error analytics rendimiento-empleado:', err)
    res.status(500).json({ error: 'Error al obtener rendimiento del empleado' })
  }
}))

module.exports = router
