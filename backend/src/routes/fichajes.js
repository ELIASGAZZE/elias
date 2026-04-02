// Rutas para fichajes (control de horario)
const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { fichajesPinSchema, fichajeManualSchema, autorizacionSchema } = require('../schemas/fichajes')
const asyncHandler = require('../middleware/asyncHandler')

// ── Fichaje público (solo requiere PIN, no JWT) ─────────────────────────────

// POST /api/fichajes/pin — Fichar con código de empleado (entrada o salida automática)
router.post('/pin', validate(fichajesPinSchema), asyncHandler(async (req, res) => {
  try {
    const { pin, sucursal_id } = req.body

    // Buscar empleado activo por código
    const { data: empleado, error: empError } = await supabase
      .from('empleados')
      .select('id, nombre, codigo')
      .eq('codigo', pin.trim())
      .eq('activo', true)
      .maybeSingle()

    if (empError) throw empError

    if (!empleado) {
      return res.status(401).json({ error: 'Código no encontrado' })
    }

    // Determinar si es entrada o salida
    // Buscar último fichaje del día
    const hoy = new Date()
    const inicioDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    const finDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()

    const { data: fichajesHoy, error: fichError } = await supabase
      .from('fichajes')
      .select('id, tipo, fecha_hora')
      .eq('empleado_id', empleado.id)
      .gte('fecha_hora', inicioDelDia)
      .lte('fecha_hora', finDelDia)
      .order('fecha_hora', { ascending: false })
      .limit(1)

    if (fichError) throw fichError

    const ultimoFichaje = fichajesHoy?.[0]
    const tipoNuevo = (!ultimoFichaje || ultimoFichaje.tipo === 'salida') ? 'entrada' : 'salida'

    // Registrar fichaje
    const { data: fichaje, error: insertError } = await supabase
      .from('fichajes')
      .insert({
        empleado_id: empleado.id,
        sucursal_id: sucursal_id || null,
        tipo: tipoNuevo,
        metodo: 'pin',
      })
      .select()
      .single()

    if (insertError) throw insertError

    res.json({
      fichaje,
      empleado: { id: empleado.id, nombre: empleado.nombre },
      tipo: tipoNuevo,
    })
  } catch (err) {
    logger.error('Error al fichar con PIN:', err)
    res.status(500).json({ error: 'Error al registrar fichaje' })
  }
}))

// GET /api/fichajes/estado/:empleadoId — Estado actual del empleado
router.get('/estado/:empleadoId', asyncHandler(async (req, res) => {
  try {
    const { empleadoId } = req.params
    const hoy = new Date()
    const inicioDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    const finDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()

    const { data: fichajesHoy, error } = await supabase
      .from('fichajes')
      .select('id, tipo, fecha_hora')
      .eq('empleado_id', empleadoId)
      .gte('fecha_hora', inicioDelDia)
      .lte('fecha_hora', finDelDia)
      .order('fecha_hora', { ascending: false })

    if (error) throw error

    const ultimo = fichajesHoy?.[0]
    const presente = ultimo?.tipo === 'entrada'

    res.json({ presente, ultimoFichaje: ultimo || null, fichajesHoy: fichajesHoy || [] })
  } catch (err) {
    logger.error('Error al obtener estado fichaje:', err)
    res.status(500).json({ error: 'Error al obtener estado' })
  }
}))

// GET /api/fichajes/ultimos — Últimos fichajes (para pantalla kiosk)
router.get('/ultimos', asyncHandler(async (req, res) => {
  try {
    const { sucursal_id, limit: lim, dias } = req.query
    const hoy = new Date()
    const diasAtras = Math.min(parseInt(dias) || 1, 30)
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (diasAtras - 1)).toISOString()

    let query = supabase
      .from('fichajes')
      .select('id, tipo, fecha_hora, empleados(id, nombre)')
      .gte('fecha_hora', desde)
      .order('fecha_hora', { ascending: false })
      .limit(parseInt(lim) || 5)

    if (sucursal_id) {
      query = query.eq('sucursal_id', sucursal_id)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al obtener últimos fichajes:', err)
    res.status(500).json({ error: 'Error al obtener fichajes' })
  }
}))

// ── Fichajes admin (requiere JWT) ───────────────────────────────────────────

// GET /api/fichajes — Listar fichajes con filtros
router.get('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, sucursal_id, fecha_desde, fecha_hasta } = req.query

    let query = supabase
      .from('fichajes')
      .select('*, empleados(id, nombre, codigo)')
      .order('fecha_hora', { ascending: false })
      .limit(500)

    if (empleado_id) query = query.eq('empleado_id', empleado_id)
    if (sucursal_id) query = query.eq('sucursal_id', sucursal_id)
    if (fecha_desde) query = query.gte('fecha_hora', fecha_desde)
    if (fecha_hasta) query = query.lte('fecha_hora', fecha_hasta)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al listar fichajes:', err)
    res.status(500).json({ error: 'Error al listar fichajes' })
  }
}))

// POST /api/fichajes/manual — Registrar fichaje manual (admin corrige)
router.post('/manual', verificarAuth, soloGestorOAdmin, validate(fichajeManualSchema), asyncHandler(async (req, res) => {
  try {
    const { empleado_id, sucursal_id, tipo, fecha_hora, observaciones } = req.body

    const { data, error } = await supabase
      .from('fichajes')
      .insert({
        empleado_id,
        sucursal_id: sucursal_id || null,
        tipo,
        fecha_hora,
        metodo: 'manual',
        registrado_por: req.perfil.id,
        observaciones,
      })
      .select('*, empleados(id, nombre)')
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear fichaje manual:', err)
    res.status(500).json({ error: 'Error al crear fichaje manual' })
  }
}))

// DELETE /api/fichajes/:id — Eliminar fichaje erróneo
router.delete('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase.from('fichajes').delete().eq('id', id)
    if (error) throw error
    res.json({ mensaje: 'Fichaje eliminado' })
  } catch (err) {
    logger.error('Error al eliminar fichaje:', err)
    res.status(500).json({ error: 'Error al eliminar fichaje' })
  }
}))

// GET /api/fichajes/dashboard — KPIs del día
router.get('/dashboard', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const hoy = new Date()
    const inicioDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString()
    const finDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).toISOString()
    const diaSemana = hoy.getDay()

    // Fichajes de hoy
    const { data: fichajesHoy, error: fErr } = await supabase
      .from('fichajes')
      .select('empleado_id, tipo, fecha_hora, empleados(id, nombre)')
      .gte('fecha_hora', inicioDelDia)
      .lte('fecha_hora', finDelDia)
      .order('fecha_hora', { ascending: false })

    if (fErr) throw fErr

    const hoyStr = hoy.toISOString().split('T')[0]

    // Planificacion semanal de hoy (prioridad sobre asignaciones)
    const { data: planHoy } = await supabase
      .from('planificacion_semanal')
      .select('empleado_id, turno_id, sucursal_id, turnos(hora_entrada, hora_salida, tolerancia_entrada_min), empleados(id, nombre)')
      .eq('fecha', hoyStr)

    const empleadosConPlan = new Set((planHoy || []).map(p => p.empleado_id))

    // Empleados con turno asignado hoy (fallback — solo los que NO tienen planificacion)
    const { data: asignacionesHoy, error: aErr } = await supabase
      .from('asignaciones_turno')
      .select('empleado_id, turno_id, turnos(hora_entrada, hora_salida, tolerancia_entrada_min), empleados(id, nombre)')
      .eq('dia_semana', diaSemana)
      .lte('vigente_desde', hoyStr)
      .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoyStr}`)

    if (aErr) throw aErr

    // Licencias activas hoy
    const { data: licenciasHoy } = await supabase
      .from('licencias')
      .select('empleado_id')
      .eq('estado', 'aprobada')
      .lte('fecha_desde', hoyStr)
      .gte('fecha_hasta', hoyStr)

    const enLicencia = new Set((licenciasHoy || []).map(l => l.empleado_id))

    // Feriado hoy?
    const { data: feriadoHoy } = await supabase
      .from('feriados')
      .select('id')
      .eq('fecha', hoyStr)
      .limit(1)

    const esFeriado = feriadoHoy && feriadoHoy.length > 0

    // Combinar: planificacion + asignaciones (fallback para los sin plan)
    const asignacionesFallback = (asignacionesHoy || []).filter(a => !empleadosConPlan.has(a.empleado_id))
    const todosConTurnoHoy = [
      ...(planHoy || []).map(p => ({ empleado_id: p.empleado_id, empleados: p.empleados, turnos: p.turnos, sucursal_id: p.sucursal_id })),
      ...asignacionesFallback,
    ]

    // Calcular estado por empleado
    const empleadosConTurno = todosConTurnoHoy.filter(a => !enLicencia.has(a.empleado_id))
    const fichajesPorEmpleado = {}
    for (const f of (fichajesHoy || [])) {
      if (!fichajesPorEmpleado[f.empleado_id]) {
        fichajesPorEmpleado[f.empleado_id] = []
      }
      fichajesPorEmpleado[f.empleado_id].push(f)
    }

    let presentes = 0
    let ausentes = 0
    let tarde = 0
    const detalle = []

    for (const asig of empleadosConTurno) {
      const fichajes = fichajesPorEmpleado[asig.empleado_id] || []
      const ultimoFichaje = fichajes[0]

      if (!ultimoFichaje) {
        ausentes++
        detalle.push({ empleado: asig.empleados, estado: 'ausente' })
        continue
      }

      const estaPresente = ultimoFichaje.tipo === 'entrada'
      if (estaPresente) presentes++

      // Check tardanza (primer entrada del día)
      const primeraEntrada = [...fichajes].reverse().find(f => f.tipo === 'entrada')
      if (primeraEntrada && asig.turnos) {
        const horaEntrada = new Date(primeraEntrada.fecha_hora)
        const [h, m] = asig.turnos.hora_entrada.split(':').map(Number)
        const limiteEntrada = new Date(horaEntrada)
        limiteEntrada.setHours(h, m + (asig.turnos.tolerancia_entrada_min || 0), 0, 0)

        if (horaEntrada > limiteEntrada) {
          tarde++
          detalle.push({ empleado: asig.empleados, estado: 'tarde', hora: primeraEntrada.fecha_hora })
          continue
        }
      }

      detalle.push({
        empleado: asig.empleados,
        estado: estaPresente ? 'presente' : 'salio',
        hora: ultimoFichaje.fecha_hora,
      })
    }

    res.json({
      presentes,
      ausentes,
      tarde,
      enLicencia: enLicencia.size,
      esFeriado,
      totalConTurno: empleadosConTurno.length,
      detalle,
    })
  } catch (err) {
    logger.error('Error al obtener dashboard fichajes:', err)
    res.status(500).json({ error: 'Error al obtener dashboard' })
  }
}))

// GET /api/fichajes/reporte — Reporte calculado
router.get('/reporte', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, fecha_desde, fecha_hasta } = req.query

    if (!fecha_desde || !fecha_hasta) {
      return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' })
    }

    // Obtener fichajes del rango
    let query = supabase
      .from('fichajes')
      .select('*, empleados(id, nombre, codigo)')
      .gte('fecha_hora', fecha_desde)
      .lte('fecha_hora', fecha_hasta + 'T23:59:59')
      .order('fecha_hora', { ascending: true })

    if (empleado_id) query = query.eq('empleado_id', empleado_id)

    const { data: fichajes, error } = await query
    if (error) throw error

    // Obtener asignaciones de turno para los empleados
    const empleadoIds = [...new Set((fichajes || []).map(f => f.empleado_id))]

    let asignaciones = []
    let planificaciones = []
    if (empleadoIds.length > 0) {
      const [asigRes, planRes] = await Promise.all([
        supabase
          .from('asignaciones_turno')
          .select('*, turnos(*)')
          .in('empleado_id', empleadoIds),
        supabase
          .from('planificacion_semanal')
          .select('*, turnos(*)')
          .in('empleado_id', empleadoIds)
          .gte('fecha', fecha_desde)
          .lte('fecha', fecha_hasta),
      ])

      asignaciones = asigRes.data || []
      planificaciones = planRes.data || []
    }

    // Obtener autorizaciones del rango
    let autorizaciones = []
    if (empleadoIds.length > 0) {
      const { data: autz } = await supabase
        .from('autorizaciones_horario')
        .select('*')
        .in('empleado_id', empleadoIds)
        .gte('fecha', fecha_desde)
        .lte('fecha', fecha_hasta)

      autorizaciones = autz || []
    }

    // Agrupar fichajes por empleado y día
    const reportePorEmpleado = {}

    for (const f of (fichajes || [])) {
      const empId = f.empleado_id
      const fecha = new Date(f.fecha_hora).toISOString().split('T')[0]

      if (!reportePorEmpleado[empId]) {
        reportePorEmpleado[empId] = {
          empleado: f.empleados,
          dias: {},
          totales: { horas: 0, extras: 0, tardes: 0, diasTrabajados: 0 },
        }
      }

      if (!reportePorEmpleado[empId].dias[fecha]) {
        reportePorEmpleado[empId].dias[fecha] = { fichajes: [], horas: 0 }
      }

      reportePorEmpleado[empId].dias[fecha].fichajes.push(f)
    }

    // Calcular horas por día
    for (const empId of Object.keys(reportePorEmpleado)) {
      const rep = reportePorEmpleado[empId]
      const empAsignaciones = asignaciones.filter(a => a.empleado_id === empId)

      for (const [fecha, dia] of Object.entries(rep.dias)) {
        const fichajesOrdenados = dia.fichajes.sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))

        // Calcular horas trabajadas (pares entrada→salida)
        let horasDelDia = 0
        for (let i = 0; i < fichajesOrdenados.length - 1; i += 2) {
          if (fichajesOrdenados[i].tipo === 'entrada' && fichajesOrdenados[i + 1]?.tipo === 'salida') {
            const entrada = new Date(fichajesOrdenados[i].fecha_hora)
            const salida = new Date(fichajesOrdenados[i + 1].fecha_hora)
            horasDelDia += (salida - entrada) / (1000 * 60 * 60)
          }
        }

        dia.horas = Math.round(horasDelDia * 100) / 100
        rep.totales.horas += dia.horas
        if (dia.horas > 0) rep.totales.diasTrabajados++

        // Calcular tardanza — priorizar planificacion sobre asignaciones
        const planDelDia = planificaciones.find(p => p.empleado_id === empId && p.fecha === fecha)
        const diaSemana = new Date(fecha).getDay()
        const asigDelDia = planDelDia
          ? { turnos: planDelDia.turnos }
          : empAsignaciones.find(a =>
              a.dia_semana === diaSemana &&
              a.vigente_desde <= fecha &&
              (!a.vigente_hasta || a.vigente_hasta >= fecha)
            )

        if (asigDelDia?.turnos) {
          const turno = asigDelDia.turnos
          const primeraEntrada = fichajesOrdenados.find(f => f.tipo === 'entrada')
          if (primeraEntrada) {
            const horaEntrada = new Date(primeraEntrada.fecha_hora)
            const [h, m] = turno.hora_entrada.split(':').map(Number)
            const limiteEntrada = new Date(horaEntrada)
            limiteEntrada.setHours(h, m + (turno.tolerancia_entrada_min || 0), 0, 0)

            if (horaEntrada > limiteEntrada) {
              // Verificar autorización
              const autorizacion = autorizaciones.find(a =>
                a.empleado_id === empId && a.fecha === fecha && a.tipo === 'entrada_tarde'
              )
              dia.tarde = true
              dia.tardeAutorizada = !!autorizacion
              if (!autorizacion) rep.totales.tardes++
            }
          }

          // Horas extra
          const [hE, mE] = turno.hora_entrada.split(':').map(Number)
          const [hS, mS] = turno.hora_salida.split(':').map(Number)
          const horasTurno = (hS + mS / 60) - (hE + mE / 60)
          if (dia.horas > horasTurno + (turno.tolerancia_salida_min || 0) / 60) {
            const extras = dia.horas - horasTurno
            dia.extras = Math.round(extras * 100) / 100
            rep.totales.extras += dia.extras
          }
        }
      }

      rep.totales.horas = Math.round(rep.totales.horas * 100) / 100
      rep.totales.extras = Math.round(rep.totales.extras * 100) / 100
    }

    res.json(Object.values(reportePorEmpleado))
  } catch (err) {
    logger.error('Error al generar reporte:', err)
    res.status(500).json({ error: 'Error al generar reporte' })
  }
}))

// GET /api/fichajes/export — Exportar CSV
router.get('/export', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, fecha_desde, fecha_hasta } = req.query

    if (!fecha_desde || !fecha_hasta) {
      return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' })
    }

    let query = supabase
      .from('fichajes')
      .select('*, empleados(nombre, codigo)')
      .gte('fecha_hora', fecha_desde)
      .lte('fecha_hora', fecha_hasta + 'T23:59:59')
      .order('fecha_hora', { ascending: true })

    if (empleado_id) query = query.eq('empleado_id', empleado_id)

    const { data, error } = await query
    if (error) throw error

    // Generar CSV
    const header = 'Empleado,Código,Tipo,Fecha/Hora,Método,Observaciones\n'
    const rows = (data || []).map(f => {
      const fecha = new Date(f.fecha_hora).toLocaleString('es-AR')
      return `"${f.empleados?.nombre || ''}","${f.empleados?.codigo || ''}","${f.tipo}","${fecha}","${f.metodo}","${f.observaciones || ''}"`
    }).join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=fichajes_${fecha_desde}_${fecha_hasta}.csv`)
    res.send('\uFEFF' + header + rows) // BOM for Excel UTF-8
  } catch (err) {
    logger.error('Error al exportar fichajes:', err)
    res.status(500).json({ error: 'Error al exportar' })
  }
}))

// ── Autorizaciones ──────────────────────────────────────────────────────────

// GET /api/fichajes/autorizaciones
router.get('/autorizaciones', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, fecha_desde, fecha_hasta } = req.query

    let query = supabase
      .from('autorizaciones_horario')
      .select('*, empleados(id, nombre)')
      .order('fecha', { ascending: false })
      .limit(200)

    if (empleado_id) query = query.eq('empleado_id', empleado_id)
    if (fecha_desde) query = query.gte('fecha', fecha_desde)
    if (fecha_hasta) query = query.lte('fecha', fecha_hasta)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al listar autorizaciones:', err)
    res.status(500).json({ error: 'Error al listar autorizaciones' })
  }
}))

// POST /api/fichajes/autorizaciones
router.post('/autorizaciones', verificarAuth, soloGestorOAdmin, validate(autorizacionSchema), asyncHandler(async (req, res) => {
  try {
    const { empleado_id, fecha, tipo, hora_autorizada, motivo } = req.body

    if (!empleado_id || !fecha || !tipo) {
      return res.status(400).json({ error: 'empleado_id, fecha y tipo son requeridos' })
    }

    const { data, error } = await supabase
      .from('autorizaciones_horario')
      .insert({
        empleado_id,
        fecha,
        tipo,
        hora_autorizada: hora_autorizada || null,
        motivo,
        autorizado_por: req.perfil.id,
      })
      .select('*, empleados(id, nombre)')
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear autorización:', err)
    res.status(500).json({ error: 'Error al crear autorización' })
  }
}))

// DELETE /api/fichajes/autorizaciones/:id
router.delete('/autorizaciones/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase.from('autorizaciones_horario').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Autorización eliminada' })
  } catch (err) {
    logger.error('Error al eliminar autorización:', err)
    res.status(500).json({ error: 'Error al eliminar autorización' })
  }
}))

module.exports = router
