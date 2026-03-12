// Rutas para gestión de tareas operativas por sucursal
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { obtenerTareasPendientes } = require('../services/tareasScheduler')

// ── CRUD Tareas (admin) ─────────────────────────────────────────────────────

// GET /api/tareas — Listar tareas (admin: todas, otros: solo activas)
router.get('/', verificarAuth, async (req, res) => {
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
    console.error('Error al obtener tareas:', err)
    res.status(500).json({ error: 'Error al obtener tareas' })
  }
})

// POST /api/tareas — Crear tarea + subtareas opcionales
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, enlace_manual, subtareas, checklist_imprimible } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la tarea es requerido' })
    }

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
    console.error('Error al crear tarea:', err)
    res.status(500).json({ error: 'Error al crear tarea' })
  }
})

// PUT /api/tareas/:id — Editar tarea
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
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
    console.error('Error al editar tarea:', err)
    res.status(500).json({ error: 'Error al editar tarea' })
  }
})

// DELETE /api/tareas/:id — Eliminar tarea (cascade)
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase.from('tareas').delete().eq('id', id)
    if (error) throw error
    res.json({ mensaje: 'Tarea eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar tarea:', err)
    res.status(500).json({ error: 'Error al eliminar tarea' })
  }
})

// ── CRUD Subtareas (admin) ──────────────────────────────────────────────────

// GET /api/tareas/:tareaId/subtareas
router.get('/:tareaId/subtareas', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subtareas')
      .select('*')
      .eq('tarea_id', req.params.tareaId)
      .order('orden')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener subtareas:', err)
    res.status(500).json({ error: 'Error al obtener subtareas' })
  }
})

// POST /api/tareas/:tareaId/subtareas
router.post('/:tareaId/subtareas', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, orden } = req.body
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la subtarea es requerido' })
    }

    const { data, error } = await supabase
      .from('subtareas')
      .insert({ tarea_id: req.params.tareaId, nombre: nombre.trim(), orden: orden ?? 0 })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear subtarea:', err)
    res.status(500).json({ error: 'Error al crear subtarea' })
  }
})

// PUT /api/tareas/subtareas/:id
router.put('/subtareas/:id', verificarAuth, soloAdmin, async (req, res) => {
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
    console.error('Error al editar subtarea:', err)
    res.status(500).json({ error: 'Error al editar subtarea' })
  }
})

// DELETE /api/tareas/subtareas/:id
router.delete('/subtareas/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('subtareas').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Subtarea eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar subtarea:', err)
    res.status(500).json({ error: 'Error al eliminar subtarea' })
  }
})

// ── Config por Sucursal (admin) ─────────────────────────────────────────────

// GET /api/tareas/:tareaId/config
router.get('/:tareaId/config', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tareas_config_sucursal')
      .select('*, sucursal:sucursales(id, nombre)')
      .eq('tarea_id', req.params.tareaId)
      .order('sucursal_id')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener config:', err)
    res.status(500).json({ error: 'Error al obtener configuración' })
  }
})

// POST /api/tareas/:tareaId/config
router.post('/:tareaId/config', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { sucursal_id, frecuencia_dias, dia_preferencia, reprogramar_siguiente, fecha_inicio } = req.body

    if (!sucursal_id) {
      return res.status(400).json({ error: 'La sucursal es requerida' })
    }

    const insert = {
      tarea_id: req.params.tareaId,
      sucursal_id,
      frecuencia_dias: frecuencia_dias || 7,
      dia_preferencia: dia_preferencia || null,
      reprogramar_siguiente: reprogramar_siguiente !== false,
      fecha_inicio: fecha_inicio || new Date().toISOString().split('T')[0],
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
    console.error('Error al crear config:', err)
    res.status(500).json({ error: 'Error al crear configuración' })
  }
})

// PUT /api/tareas/config/:id
router.put('/config/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { frecuencia_dias, dia_preferencia, reprogramar_siguiente, fecha_inicio, activo } = req.body
    const updates = {}
    if (frecuencia_dias !== undefined) updates.frecuencia_dias = frecuencia_dias
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
    console.error('Error al editar config:', err)
    res.status(500).json({ error: 'Error al editar configuración' })
  }
})

// DELETE /api/tareas/config/:id
router.delete('/config/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('tareas_config_sucursal').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Configuración eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar config:', err)
    res.status(500).json({ error: 'Error al eliminar configuración' })
  }
})

// ── Panel general: todas las sucursales (admin/gestor) ─────────────────────

// GET /api/tareas/panel-general — Estado de todas las tareas en todas las sucursales
router.get('/panel-general', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const hoyStr = hoy.toISOString().split('T')[0]

    // Traer TODAS las configs activas con tarea y sucursal
    const { data: configs, error: errCfg } = await supabase
      .from('tareas_config_sucursal')
      .select('*, tarea:tareas(id, nombre, descripcion, activo), sucursal:sucursales(id, nombre)')
      .eq('activo', true)

    if (errCfg) throw errCfg
    if (!configs || configs.length === 0) return res.json([])

    const configsActivas = configs.filter(c => c.tarea && c.tarea.activo)

    // Traer todas las ejecuciones de hoy de una sola vez
    const { data: ejecucionesHoy, error: errEj } = await supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_ejecucion, completada_por:perfiles(nombre), created_at')
      .eq('fecha_ejecucion', hoyStr)

    if (errEj) throw errEj

    const ejMap = {}
    for (const ej of (ejecucionesHoy || [])) {
      ejMap[ej.tarea_config_id] = ej
    }

    // Para cada config, obtener última ejecución para calcular si está pendiente hoy
    // Traer últimas ejecuciones de cada config (más eficiente: una sola query)
    const configIds = configsActivas.map(c => c.id)
    const { data: ultimasEjecuciones, error: errUlt } = await supabase
      .from('ejecuciones_tarea')
      .select('tarea_config_id, fecha_ejecucion')
      .in('tarea_config_id', configIds)
      .order('fecha_ejecucion', { ascending: false })

    if (errUlt) throw errUlt

    // Mapear última ejecución por config
    const ultimaMap = {}
    for (const ej of (ultimasEjecuciones || [])) {
      if (!ultimaMap[ej.tarea_config_id]) {
        ultimaMap[ej.tarea_config_id] = ej.fecha_ejecucion
      }
    }

    // Importar lógica del scheduler
    const { calcularProximaFecha } = require('../services/tareasScheduler')

    // Construir resultado agrupado por sucursal
    const porSucursal = {}

    for (const config of configsActivas) {
      const sucNombre = config.sucursal?.nombre || 'Sin sucursal'
      const sucId = config.sucursal?.id || config.sucursal_id

      if (!porSucursal[sucId]) {
        porSucursal[sucId] = {
          sucursal_id: sucId,
          sucursal_nombre: sucNombre,
          tareas: [],
        }
      }

      const ultimaFecha = ultimaMap[config.id] || null
      const proximaFecha = calcularProximaFecha(config, ultimaFecha)
      proximaFecha.setHours(0, 0, 0, 0)

      // Determinar si debía hacerse hoy o antes
      const debiaHacerse = proximaFecha <= hoy
      // Si no reprogramar y ya pasó, no aplica
      if (!config.reprogramar_siguiente && proximaFecha < hoy) continue

      if (!debiaHacerse) continue // No toca hoy, skip

      const ejecucion = ejMap[config.id]
      const completada = !!ejecucion
      const atrasada = proximaFecha < hoy

      porSucursal[sucId].tareas.push({
        tarea_config_id: config.id,
        tarea_id: config.tarea.id,
        nombre: config.tarea.nombre,
        descripcion: config.tarea.descripcion,
        frecuencia_dias: config.frecuencia_dias,
        fecha_programada: proximaFecha.toISOString().split('T')[0],
        completada,
        atrasada,
        dias_atraso: atrasada ? Math.floor((hoy - proximaFecha) / (1000 * 60 * 60 * 24)) : 0,
        completada_por: ejecucion?.completada_por?.nombre || null,
        hora_completada: ejecucion?.created_at || null,
      })
    }

    // Convertir a array y ordenar: sucursales con pendientes primero
    const resultado = Object.values(porSucursal)
      .map(s => ({
        ...s,
        total: s.tareas.length,
        completadas: s.tareas.filter(t => t.completada).length,
        pendientes: s.tareas.filter(t => !t.completada).length,
      }))
      .sort((a, b) => b.pendientes - a.pendientes || a.sucursal_nombre.localeCompare(b.sucursal_nombre))

    res.json(resultado)
  } catch (err) {
    console.error('Error panel general:', err)
    res.status(500).json({ error: 'Error al obtener panel general' })
  }
})

// ── Operario: Pendientes + Ejecutar ─────────────────────────────────────────

// GET /api/tareas/pendientes — Tareas pendientes hoy
router.get('/pendientes', verificarAuth, async (req, res) => {
  try {
    const sucursalId = req.perfil.rol === 'admin'
      ? req.query.sucursal_id || req.perfil.sucursal_id
      : req.perfil.sucursal_id

    if (!sucursalId) {
      return res.status(400).json({ error: 'Sucursal no determinada' })
    }

    const pendientes = await obtenerTareasPendientes(sucursalId)
    res.json(pendientes)
  } catch (err) {
    console.error('Error al obtener pendientes:', err)
    res.status(500).json({ error: 'Error al obtener tareas pendientes' })
  }
})

// POST /api/tareas/ejecutar — Completar tarea
router.post('/ejecutar', verificarAuth, async (req, res) => {
  try {
    const { tarea_config_id, empleados_ids, subtareas_completadas, observaciones } = req.body

    if (!tarea_config_id) {
      return res.status(400).json({ error: 'tarea_config_id es requerido' })
    }

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

    // Calcular fecha programada (usar scheduler para obtener la fecha que corresponde)
    const pendientes = await obtenerTareasPendientes(config.sucursal_id)
    const tareaPendiente = pendientes.find(p => p.tarea_config_id === tarea_config_id)
    const fechaProgramada = tareaPendiente?.fecha_programada || new Date().toISOString().split('T')[0]

    // Crear ejecución
    const { data: ejecucion, error: errEjec } = await supabase
      .from('ejecuciones_tarea')
      .insert({
        tarea_config_id,
        fecha_programada: fechaProgramada,
        fecha_ejecucion: new Date().toISOString().split('T')[0],
        completada_por_id: req.perfil.id,
        observaciones: observaciones?.trim() || null,
      })
      .select()
      .single()

    if (errEjec) throw errEjec

    // Registrar empleados
    if (empleados_ids && empleados_ids.length > 0) {
      const empInsert = empleados_ids.map(eid => ({
        ejecucion_id: ejecucion.id,
        empleado_id: eid,
      }))
      const { error: errEmp } = await supabase
        .from('ejecuciones_empleados')
        .insert(empInsert)
      if (errEmp) throw errEmp
    }

    // Registrar subtareas completadas
    if (subtareas_completadas && subtareas_completadas.length > 0) {
      const subInsert = subtareas_completadas.map(s => ({
        ejecucion_id: ejecucion.id,
        subtarea_id: s.subtarea_id,
        completada: s.completada !== false,
      }))
      const { error: errSub } = await supabase
        .from('ejecuciones_subtareas')
        .insert(subInsert)
      if (errSub) throw errSub
    }

    res.status(201).json(ejecucion)
  } catch (err) {
    console.error('Error al ejecutar tarea:', err)
    res.status(500).json({ error: 'Error al registrar ejecución' })
  }
})

// ── Analytics (gestor o admin) ──────────────────────────────────────────────

// GET /api/tareas/analytics/resumen
router.get('/analytics/resumen', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || new Date().toISOString().split('T')[0]

    // Obtener todas las configs activas
    let configQuery = supabase
      .from('tareas_config_sucursal')
      .select('id, sucursal_id, frecuencia_dias, fecha_inicio, tarea:tareas(nombre), sucursal:sucursales(nombre)')
      .eq('activo', true)

    if (sucursal_id) configQuery = configQuery.eq('sucursal_id', sucursal_id)

    const { data: configs, error: errConfigs } = await configQuery
    if (errConfigs) throw errConfigs

    // Obtener ejecuciones en rango
    let ejQuery = supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_programada, fecha_ejecucion')
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)

    const { data: ejecuciones, error: errEj } = await ejQuery
    if (errEj) throw errEj

    // Calcular total esperado vs ejecutado
    const totalEjecutadas = ejecuciones.length
    const totalConfigs = configs.length

    // Agrupar ejecuciones por sucursal
    const porSucursal = {}
    for (const config of configs) {
      const sucNombre = config.sucursal?.nombre || 'Sin sucursal'
      if (!porSucursal[sucNombre]) porSucursal[sucNombre] = { ejecutadas: 0, configs: 0 }
      porSucursal[sucNombre].configs++
    }
    for (const ej of ejecuciones) {
      const config = configs.find(c => c.id === ej.tarea_config_id)
      if (config) {
        const sucNombre = config.sucursal?.nombre || 'Sin sucursal'
        if (porSucursal[sucNombre]) porSucursal[sucNombre].ejecutadas++
      }
    }

    // Contar a_tiempo vs atrasadas
    let a_tiempo = 0
    let atrasadas = 0
    for (const ej of ejecuciones) {
      if (ej.fecha_programada && ej.fecha_ejecucion > ej.fecha_programada) {
        atrasadas++
      } else {
        a_tiempo++
      }
    }

    res.json({
      periodo: { desde: fechaDesde, hasta: fechaHasta },
      total_ejecutadas: totalEjecutadas,
      total_configs_activas: totalConfigs,
      a_tiempo,
      atrasadas,
      por_sucursal: Object.entries(porSucursal).map(([nombre, v]) => ({
        sucursal: nombre,
        ejecutadas: v.ejecutadas,
        configs_activas: v.configs,
      })),
    })
  } catch (err) {
    console.error('Error analytics resumen:', err)
    res.status(500).json({ error: 'Error al obtener resumen' })
  }
})

// GET /api/tareas/analytics/timeline
router.get('/analytics/timeline', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || new Date().toISOString().split('T')[0]

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
    console.error('Error analytics timeline:', err)
    res.status(500).json({ error: 'Error al obtener timeline' })
  }
})

// GET /api/tareas/analytics/por-empleado
router.get('/analytics/por-empleado', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || new Date().toISOString().split('T')[0]

    // Traer ejecuciones con empleados
    let ejQuery = supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_ejecucion, ejecuciones_empleados(empleado:empleados(id, nombre))')
      .gte('fecha_ejecucion', fechaDesde)
      .lte('fecha_ejecucion', fechaHasta)

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

    // Contar por empleado
    const conteo = {}
    for (const ej of ejecsFiltradas) {
      for (const ee of (ej.ejecuciones_empleados || [])) {
        const emp = ee.empleado
        if (emp) {
          if (!conteo[emp.id]) conteo[emp.id] = { nombre: emp.nombre, cantidad: 0 }
          conteo[emp.id].cantidad++
        }
      }
    }

    const ranking = Object.values(conteo).sort((a, b) => b.cantidad - a.cantidad)
    res.json(ranking)
  } catch (err) {
    console.error('Error analytics por-empleado:', err)
    res.status(500).json({ error: 'Error al obtener ranking' })
  }
})

// GET /api/tareas/analytics/incumplimiento
router.get('/analytics/incumplimiento', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { sucursal_id } = req.query

    // Obtener todas las configs activas
    let configQuery = supabase
      .from('tareas_config_sucursal')
      .select('id, tarea:tareas(nombre), sucursal:sucursales(nombre), frecuencia_dias')
      .eq('activo', true)

    if (sucursal_id) configQuery = configQuery.eq('sucursal_id', sucursal_id)

    const { data: configs, error: errConfigs } = await configQuery
    if (errConfigs) throw errConfigs

    // Para cada config, contar ejecuciones totales
    const resultado = []
    for (const config of configs) {
      const { count } = await supabase
        .from('ejecuciones_tarea')
        .select('id', { count: 'exact', head: true })
        .eq('tarea_config_id', config.id)

      resultado.push({
        tarea: config.tarea?.nombre,
        sucursal: config.sucursal?.nombre,
        frecuencia_dias: config.frecuencia_dias,
        total_ejecuciones: count || 0,
      })
    }

    // Ordenar por menor cumplimiento
    resultado.sort((a, b) => a.total_ejecuciones - b.total_ejecuciones)
    res.json(resultado)
  } catch (err) {
    console.error('Error analytics incumplimiento:', err)
    res.status(500).json({ error: 'Error al obtener incumplimiento' })
  }
})

// GET /api/tareas/analytics/historial
router.get('/analytics/historial', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { desde, hasta, sucursal_id, tarea_id } = req.query
    const fechaDesde = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const fechaHasta = hasta || new Date().toISOString().split('T')[0]

    let query = supabase
      .from('ejecuciones_tarea')
      .select(`
        id, fecha_programada, fecha_ejecucion, observaciones, created_at,
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
    console.error('Error analytics historial:', err)
    res.status(500).json({ error: 'Error al obtener historial' })
  }
})

module.exports = router
