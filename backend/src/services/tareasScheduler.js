// Lógica de cálculo de tareas pendientes por sucursal
const supabase = require('../config/supabase')

/**
 * Obtiene la fecha actual en zona horaria Argentina (UTC-3).
 * Retorna { hoy: Date (midnight local), hoyStr: 'YYYY-MM-DD' }
 */
function fechaArgentina() {
  const ahora = new Date()
  // Convertir a string en timezone Argentina para obtener la fecha correcta
  const fechaStr = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  // fechaStr = 'YYYY-MM-DD'
  const [y, m, d] = fechaStr.split('-').map(Number)
  const hoy = new Date(y, m - 1, d) // midnight local
  return { hoy, hoyStr: fechaStr }
}

/**
 * Parsea 'YYYY-MM-DD' como fecha local (no UTC) para evitar desfase de timezone.
 */
function parseFechaLocal(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const DIAS_SEMANA = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3,
  jueves: 4, viernes: 5, sabado: 6,
}

const NOMBRE_DIA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

/**
 * Para tipo "dia_fijo": determina si hoy es un día programado
 * considerando los días de la semana y el período (cada N semanas o mes).
 * Retorna { programada: bool, fechaProgramada: Date|null }
 */
function evaluarDiaFijo(config, hoy, ultimaEjecucionFecha) {
  const diasSemana = config.dias_semana || []
  if (diasSemana.length === 0) return { programada: false }

  const hoyNombre = NOMBRE_DIA[hoy.getDay()]
  const fechaInicio = parseFechaLocal(config.fecha_inicio)

  if (hoy < fechaInicio) return { programada: false }

  const periodo = config.frecuencia_dias // 7=1sem, 14=2sem, 21=3sem, 30=1mes

  // Calcular si estamos en una semana/período activo
  if (periodo <= 21) {
    // Lógica semanal: cada N semanas
    const semanas = periodo / 7
    // Calcular número de semana desde fecha_inicio (ambas alineadas al lunes)
    const inicioLunes = new Date(fechaInicio)
    inicioLunes.setDate(inicioLunes.getDate() - ((inicioLunes.getDay() + 6) % 7)) // ir al lunes de esa semana
    const hoyLunes = new Date(hoy)
    hoyLunes.setDate(hoyLunes.getDate() - ((hoyLunes.getDay() + 6) % 7)) // ir al lunes de esta semana

    const diffSemanas = Math.round((hoyLunes - inicioLunes) / (7 * 24 * 60 * 60 * 1000))
    const esSemanActiva = diffSemanas >= 0 && (diffSemanas % semanas === 0)

    if (!esSemanActiva) return { programada: false }
  } else {
    // Lógica mensual (periodo = 30): mismo día del mes que fecha_inicio, pero en los días configurados
    // Simplificación: la tarea aparece en la semana que contiene el día del mes de inicio
    const diaDelMes = fechaInicio.getDate()
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), diaDelMes)
    inicioMes.setHours(0, 0, 0, 0)
    // La semana activa es la del día de referencia del mes
    const inicioLunes = new Date(inicioMes)
    inicioLunes.setDate(inicioLunes.getDate() - ((inicioLunes.getDay() + 6) % 7))
    const finDomingo = new Date(inicioLunes)
    finDomingo.setDate(finDomingo.getDate() + 6)

    if (hoy < inicioLunes || hoy > finDomingo) return { programada: false }
  }

  // Estamos en período activo, verificar si hoy es uno de los días configurados
  if (diasSemana.includes(hoyNombre)) {
    return { programada: true, fechaProgramada: new Date(hoy) }
  }

  return { programada: false }
}

/**
 * Para tipo "dia_fijo": calcula la próxima fecha programada después de una ejecución.
 * Busca el siguiente día de la semana configurado en el período activo.
 */
function proximaFechaDiaFijo(config, desdeDate) {
  const diasSemana = config.dias_semana || []
  if (diasSemana.length === 0) return null

  const periodo = config.frecuencia_dias
  const fechaInicio = parseFechaLocal(config.fecha_inicio)

  // Buscar el próximo día configurado (máx 60 días adelante)
  const cursor = new Date(desdeDate)
  cursor.setDate(cursor.getDate() + 1) // empezar desde mañana
  for (let i = 0; i < 60; i++) {
    const resultado = evaluarDiaFijo(config, cursor, null)
    if (resultado.programada) return new Date(cursor)
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

/**
 * Para tipo "frecuencia": calcula la próxima fecha (cada N días desde última ejecución o fecha_inicio).
 * Parsea fechas como locales (no UTC) para evitar desfase de timezone.
 */
function calcularProximaFechaFrecuencia(config, ultimaEjecucionFecha) {
  if (ultimaEjecucionFecha) {
    // Parsear como fecha local (YYYY-MM-DD → año, mes, día)
    const [y, m, d] = ultimaEjecucionFecha.split('-').map(Number)
    const base = new Date(y, m - 1, d)
    base.setDate(base.getDate() + config.frecuencia_dias)
    return base
  }
  // fecha_inicio también como local
  const [y, m, d] = config.fecha_inicio.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Wrapper general que delega según tipo.
 */
function calcularProximaFecha(config, ultimaEjecucionFecha) {
  if (config.tipo === 'dia_fijo') {
    if (ultimaEjecucionFecha) {
      return proximaFechaDiaFijo(config, parseFechaLocal(ultimaEjecucionFecha))
    }
    return parseFechaLocal(config.fecha_inicio)
  }
  // tipo = 'frecuencia' (default, también para configs legacy)
  return calcularProximaFechaFrecuencia(config, ultimaEjecucionFecha)
}

/**
 * Obtiene las tareas pendientes para una sucursal en la fecha actual.
 */
async function obtenerTareasPendientes(sucursalId) {
  const { hoy, hoyStr } = fechaArgentina()

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
    const tipo = config.tipo || 'frecuencia'

    // Buscar última ejecución de esta config
    const { data: ultimaEjecucion } = await supabase
      .from('ejecuciones_tarea')
      .select('fecha_ejecucion, fecha_programada')
      .eq('tarea_config_id', config.id)
      .order('fecha_ejecucion', { ascending: false })
      .limit(1)
      .single()

    const ultimaFecha = ultimaEjecucion?.fecha_ejecucion || null

    // ── Tareas repetitivas (con subtareas): siempre aparecen ──
    if (esRepetitiva) {
      const fechaInicio = parseFechaLocal(config.fecha_inicio)
      if (fechaInicio > hoy) continue

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
        tipo,
        frecuencia_dias: config.frecuencia_dias,
        dias_semana: config.dias_semana,
        fecha_programada: hoyStr,
        atrasada: false,
        dias_atraso: 0,
        subtareas: subtareasActivas,
        repetitiva: true,
        ejecuciones_hoy: ejecucionesHoy || 0,
      })
      continue
    }

    // ── Tareas sin subtareas: lógica según tipo ──

    if (tipo === 'dia_fijo') {
      // Verificar si hoy es día programado
      const { programada } = evaluarDiaFijo(config, hoy, ultimaFecha)

      // Ya ejecutada hoy → no mostrar
      if (ultimaFecha === hoyStr) continue

      if (programada) {
        // Hoy toca, verificar si ya se completó
        pendientes.push({
          tarea_config_id: config.id,
          tarea_id: config.tarea.id,
          sucursal_id: config.sucursal_id,
          nombre: config.tarea.nombre,
          descripcion: config.tarea.descripcion,
          enlace_manual: config.tarea.enlace_manual,
          tipo,
          frecuencia_dias: config.frecuencia_dias,
          dias_semana: config.dias_semana,
          fecha_programada: hoyStr,
          atrasada: false,
          dias_atraso: 0,
          subtareas: [],
          repetitiva: false,
          ejecuciones_hoy: 0,
        })
        continue
      }

      // Hoy NO toca. Verificar si hay tarea pendiente reprogramada de días anteriores.
      if (config.reprogramar_siguiente && ultimaFecha) {
        // Buscar la última fecha programada que no fue completada
        const proxDespuesUltima = proximaFechaDiaFijo(config, parseFechaLocal(ultimaFecha))
        if (proxDespuesUltima) {
          proxDespuesUltima.setHours(0, 0, 0, 0)
          if (proxDespuesUltima <= hoy) {
            // Hay tarea atrasada que se reprograma
            const diasAtraso = Math.floor((hoy - proxDespuesUltima) / (1000 * 60 * 60 * 24))
            pendientes.push({
              tarea_config_id: config.id,
              tarea_id: config.tarea.id,
              sucursal_id: config.sucursal_id,
              nombre: config.tarea.nombre,
              descripcion: config.tarea.descripcion,
              enlace_manual: config.tarea.enlace_manual,
              tipo,
              frecuencia_dias: config.frecuencia_dias,
              dias_semana: config.dias_semana,
              fecha_programada: proxDespuesUltima.toISOString().split('T')[0],
              atrasada: true,
              dias_atraso: diasAtraso,
              subtareas: [],
              repetitiva: false,
              ejecuciones_hoy: 0,
            })
          }
        }
      } else if (config.reprogramar_siguiente && !ultimaFecha) {
        // Nunca ejecutada, verificar si ya pasó algún día programado
        const fechaInicio = parseFechaLocal(config.fecha_inicio)
          if (fechaInicio <= hoy) {
          // Buscar primer día programado desde fecha_inicio
          const cursor = new Date(fechaInicio)
          let primerDia = null
          for (let i = 0; i < 60; i++) {
            const res = evaluarDiaFijo(config, cursor, null)
            if (res.programada && cursor <= hoy) {
              primerDia = new Date(cursor)
              break
            }
            cursor.setDate(cursor.getDate() + 1)
          }
          if (primerDia) {
            const diasAtraso = Math.floor((hoy - primerDia) / (1000 * 60 * 60 * 24))
            pendientes.push({
              tarea_config_id: config.id,
              tarea_id: config.tarea.id,
              sucursal_id: config.sucursal_id,
              nombre: config.tarea.nombre,
              descripcion: config.tarea.descripcion,
              enlace_manual: config.tarea.enlace_manual,
              tipo,
              frecuencia_dias: config.frecuencia_dias,
              dias_semana: config.dias_semana,
              fecha_programada: primerDia.toISOString().split('T')[0],
              atrasada: diasAtraso > 0,
              dias_atraso: diasAtraso,
              subtareas: [],
              repetitiva: false,
              ejecuciones_hoy: 0,
            })
          }
        }
      }
      // Si no reprograma y hoy no toca → no aparece (incumplida)
      continue
    }

    // ── tipo = 'frecuencia' (o legacy sin tipo) ──
    const proximaFecha = calcularProximaFechaFrecuencia(config, ultimaFecha)
    proximaFecha.setHours(0, 0, 0, 0)

    // Si la próxima fecha es en el futuro, no es pendiente
    if (proximaFecha > hoy) continue

    // Si no reprogramar y ya pasó, skip (incumplida)
    if (!config.reprogramar_siguiente && proximaFecha < hoy) continue

    const atrasada = proximaFecha < hoy

    pendientes.push({
      tarea_config_id: config.id,
      tarea_id: config.tarea.id,
      sucursal_id: config.sucursal_id,
      nombre: config.tarea.nombre,
      descripcion: config.tarea.descripcion,
      enlace_manual: config.tarea.enlace_manual,
      tipo,
      frecuencia_dias: config.frecuencia_dias,
      dias_semana: config.dias_semana,
      fecha_programada: proximaFecha.toISOString().split('T')[0],
      atrasada,
      dias_atraso: atrasada ? Math.floor((hoy - proximaFecha) / (1000 * 60 * 60 * 24)) : 0,
      subtareas: [],
      repetitiva: false,
      ejecuciones_hoy: 0,
    })
  }

  // Enriquecer con empleado recomendado (quien hace más tiempo no la hizo)
  if (pendientes.length > 0) {
    const configIds = pendientes.map(p => p.tarea_config_id)

    // Traer empleados activos de zaatar
    const { data: empleadosZaatar } = await supabase
      .from('empleados')
      .select('id, nombre')
      .eq('activo', true)
      .eq('empresa', 'zaatar')

    if (empleadosZaatar && empleadosZaatar.length > 0) {
      // Traer ejecuciones de todas las tareas pendientes
      const { data: execsRecom } = await supabase
        .from('ejecuciones_tarea')
        .select('id, tarea_config_id, fecha_ejecucion')
        .in('tarea_config_id', configIds)
        .order('fecha_ejecucion', { ascending: false })

      let relRecom = []
      if (execsRecom && execsRecom.length > 0) {
        const execRecomIds = execsRecom.map(e => e.id)
        const { data: rels } = await supabase
          .from('ejecuciones_empleados')
          .select('ejecucion_id, empleado_id')
          .in('ejecucion_id', execRecomIds)
        relRecom = rels || []
      }

      const execFechaRecom = {}
      const execConfigRecom = {}
      for (const e of (execsRecom || [])) {
        execFechaRecom[e.id] = e.fecha_ejecucion
        execConfigRecom[e.id] = e.tarea_config_id
      }

      for (const p of pendientes) {
        // Última fecha por empleado para esta tarea
        const ultimaPorEmp = {}
        for (const rel of relRecom) {
          if (execConfigRecom[rel.ejecucion_id] !== p.tarea_config_id) continue
          const fecha = execFechaRecom[rel.ejecucion_id]
          if (!ultimaPorEmp[rel.empleado_id] || fecha > ultimaPorEmp[rel.empleado_id]) {
            ultimaPorEmp[rel.empleado_id] = fecha
          }
        }

        // Encontrar el que hace más tiempo no la hizo (o nunca)
        let mejorEmp = null
        let mejorDias = -1
        for (const emp of empleadosZaatar) {
          const ultima = ultimaPorEmp[emp.id] || null
          if (ultima === null) {
            // Nunca la hizo → máxima prioridad
            mejorEmp = emp
            mejorDias = null
            break
          }
          const f = new Date(ultima)
          f.setHours(0, 0, 0, 0)
          const dias = Math.floor((hoy - f) / (1000 * 60 * 60 * 24))
          if (dias > mejorDias) {
            mejorDias = dias
            mejorEmp = emp
          }
        }

        if (mejorEmp) {
          p.empleado_recomendado = mejorEmp.nombre
          p.dias_sin_hacer = mejorDias
        }
      }
    }
  }

  // Enriquecer subtareas de tareas repetitivas con última fecha de ejecución
  const repetitivas = pendientes.filter(p => p.repetitiva && p.subtareas.length > 0)
  if (repetitivas.length > 0) {
    const allSubtareaIds = repetitivas.flatMap(p => p.subtareas.map(s => s.id))
    const repConfigIds = repetitivas.map(p => p.tarea_config_id)

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

      const { data: subExecs } = await supabase
        .from('ejecuciones_subtareas')
        .select('subtarea_id, completada, ejecucion_id')
        .in('ejecucion_id', execIds)
        .eq('completada', true)

      const ultimaMap = {}
      const fechasMap = {}
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

module.exports = { obtenerTareasPendientes, calcularProximaFecha, fechaArgentina, parseFechaLocal }
