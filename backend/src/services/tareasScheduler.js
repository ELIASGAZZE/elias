// Lógica de cálculo de tareas pendientes por sucursal
const supabase = require('../config/supabase')

const DIAS_SEMANA = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,
}

/**
 * Ajusta una fecha al próximo día de la semana indicado (o el mismo si coincide).
 */
function ajustarAlDia(fecha, diaPref) {
  const target = DIAS_SEMANA[diaPref]
  if (target === undefined) return fecha
  const actual = fecha.getDay()
  let diff = target - actual
  if (diff < 0) diff += 7
  if (diff === 0) return fecha
  const ajustada = new Date(fecha)
  ajustada.setDate(ajustada.getDate() + diff)
  return ajustada
}

/**
 * Calcula la fecha programada de la próxima ejecución.
 */
function calcularProximaFecha(config, ultimaEjecucionFecha) {
  let base
  if (ultimaEjecucionFecha) {
    base = new Date(ultimaEjecucionFecha)
    base.setDate(base.getDate() + config.frecuencia_dias)
  } else {
    base = new Date(config.fecha_inicio)
  }

  if (config.dia_preferencia) {
    base = ajustarAlDia(base, config.dia_preferencia)
  }

  return base
}

/**
 * Obtiene las tareas pendientes para una sucursal en la fecha actual.
 * Retorna array de objetos con info de la tarea, config, estado (a_tiempo/atrasada), etc.
 */
async function obtenerTareasPendientes(sucursalId) {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const hoyStr = hoy.toISOString().split('T')[0]

  // Traer todas las configs activas de esta sucursal con su tarea y subtareas
  const { data: configs, error } = await supabase
    .from('tareas_config_sucursal')
    .select('*, tarea:tareas(id, nombre, descripcion, enlace_manual, activo, subtareas(id, nombre, orden, activo))')
    .eq('sucursal_id', sucursalId)
    .eq('activo', true)

  if (error) throw error
  if (!configs || configs.length === 0) return []

  // Filtrar solo configs cuya tarea está activa
  const configsActivas = configs.filter(c => c.tarea && c.tarea.activo)

  const pendientes = []

  for (const config of configsActivas) {
    const subtareasActivas = (config.tarea.subtareas || [])
      .filter(s => s.activo)
      .sort((a, b) => a.orden - b.orden)

    const esRepetitiva = subtareasActivas.length > 0

    // Buscar última ejecución de esta config
    const { data: ultimaEjecucion } = await supabase
      .from('ejecuciones_tarea')
      .select('fecha_ejecucion, fecha_programada')
      .eq('tarea_config_id', config.id)
      .order('fecha_ejecucion', { ascending: false })
      .limit(1)
      .single()

    const ultimaFecha = ultimaEjecucion?.fecha_ejecucion || null
    const proximaFecha = calcularProximaFecha(config, ultimaFecha)
    proximaFecha.setHours(0, 0, 0, 0)

    // Tareas repetitivas: siempre aparecen si fecha_inicio <= hoy
    if (esRepetitiva) {
      const fechaInicio = new Date(config.fecha_inicio)
      fechaInicio.setHours(0, 0, 0, 0)
      if (fechaInicio > hoy) continue

      // Contar ejecuciones de hoy
      const { count: ejecucionesHoy } = await supabase
        .from('ejecuciones_tarea')
        .select('id', { count: 'exact', head: true })
        .eq('tarea_config_id', config.id)
        .eq('fecha_ejecucion', hoyStr)

      pendientes.push({
        tarea_config_id: config.id,
        tarea_id: config.tarea.id,
        sucursal_id: config.sucursal_id,
        nombre: config.tarea.nombre,
        descripcion: config.tarea.descripcion,
        enlace_manual: config.tarea.enlace_manual,
        frecuencia_dias: config.frecuencia_dias,
        dia_preferencia: config.dia_preferencia,
        fecha_programada: hoyStr,
        atrasada: false,
        dias_atraso: 0,
        subtareas: subtareasActivas,
        repetitiva: true,
        ejecuciones_hoy: ejecucionesHoy || 0,
      })
      continue
    }

    // Tareas únicas: lógica original
    // Si la proxima fecha es en el futuro, no es pendiente
    if (proximaFecha > hoy) continue

    // Si no reprogramar y ya pasó, skip
    if (!config.reprogramar_siguiente && proximaFecha < hoy) continue

    // Es pendiente
    const atrasada = proximaFecha < hoy

    pendientes.push({
      tarea_config_id: config.id,
      tarea_id: config.tarea.id,
      sucursal_id: config.sucursal_id,
      nombre: config.tarea.nombre,
      descripcion: config.tarea.descripcion,
      enlace_manual: config.tarea.enlace_manual,
      frecuencia_dias: config.frecuencia_dias,
      dia_preferencia: config.dia_preferencia,
      fecha_programada: proximaFecha.toISOString().split('T')[0],
      atrasada,
      dias_atraso: atrasada ? Math.floor((hoy - proximaFecha) / (1000 * 60 * 60 * 24)) : 0,
      subtareas: [],
      repetitiva: false,
      ejecuciones_hoy: 0,
    })
  }

  // Enriquecer subtareas de tareas repetitivas con última fecha de ejecución
  const repetitivas = pendientes.filter(p => p.repetitiva && p.subtareas.length > 0)
  if (repetitivas.length > 0) {
    const allSubtareaIds = repetitivas.flatMap(p => p.subtareas.map(s => s.id))
    const repConfigIds = repetitivas.map(p => p.tarea_config_id)

    // Traer ejecuciones de estas configs
    const { data: execsRep } = await supabase
      .from('ejecuciones_tarea')
      .select('id, tarea_config_id, fecha_ejecucion')
      .in('tarea_config_id', repConfigIds)
      .order('fecha_ejecucion', { ascending: false })
      .limit(500)

    if (execsRep && execsRep.length > 0) {
      const execIds = execsRep.map(e => e.id)
      const execDateMap = {}
      const execConfigMap = {}
      for (const e of execsRep) {
        execDateMap[e.id] = e.fecha_ejecucion
        execConfigMap[e.id] = e.tarea_config_id
      }

      // Traer subtareas completadas de esas ejecuciones
      const { data: subExecs } = await supabase
        .from('ejecuciones_subtareas')
        .select('subtarea_id, completada, ejecucion_id')
        .in('ejecucion_id', execIds)
        .eq('completada', true)

      // Mapa: configId+subtareaId → última fecha y todas las fechas completadas
      const ultimaMap = {}
      const fechasMap = {} // key → [fechas ordenadas desc]
      for (const se of (subExecs || [])) {
        const configId = execConfigMap[se.ejecucion_id]
        const fecha = execDateMap[se.ejecucion_id]
        const key = `${configId}_${se.subtarea_id}`
        if (!ultimaMap[key] || fecha > ultimaMap[key]) {
          ultimaMap[key] = fecha
        }
        if (!fechasMap[key]) fechasMap[key] = []
        if (!fechasMap[key].includes(fecha)) fechasMap[key].push(fecha)
      }

      // Calcular frecuencia promedio real por subtarea
      const promedioMap = {}
      for (const [key, fechas] of Object.entries(fechasMap)) {
        if (fechas.length < 2) continue
        fechas.sort((a, b) => a.localeCompare(b))
        let totalDias = 0
        for (let i = 1; i < fechas.length; i++) {
          const diff = (new Date(fechas[i]) - new Date(fechas[i - 1])) / (1000 * 60 * 60 * 24)
          totalDias += diff
        }
        promedioMap[key] = Math.round(totalDias / (fechas.length - 1))
      }

      // Asignar a cada subtarea
      for (const p of repetitivas) {
        for (const s of p.subtareas) {
          const key = `${p.tarea_config_id}_${s.id}`
          s.ultima_ejecucion = ultimaMap[key] || null
          s.frecuencia_promedio = promedioMap[key] || null
        }
      }
    }
  }

  return pendientes
}

module.exports = { obtenerTareasPendientes, calcularProximaFecha }
