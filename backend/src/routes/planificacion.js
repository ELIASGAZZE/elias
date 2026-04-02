// Rutas para planificacion semanal multi-sucursal
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')

// GET /api/planificacion — Lista planificacion de un rango
router.get('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query

    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'fecha_inicio y fecha_fin son requeridos' })
    }

    const { data, error } = await supabase
      .from('planificacion_semanal')
      .select('*, empleados(id, nombre), turnos(id, nombre, hora_entrada, hora_salida, tolerancia_entrada_min), sucursales(id, nombre)')
      .gte('fecha', fecha_inicio)
      .lte('fecha', fecha_fin)
      .order('fecha')

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al listar planificacion:', err)
    res.status(500).json({ error: 'Error al listar planificacion' })
  }
}))

// POST /api/planificacion — Upsert individual
router.post('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, turno_id, sucursal_id, fecha } = req.body

    if (!empleado_id || !turno_id || !fecha) {
      return res.status(400).json({ error: 'empleado_id, turno_id y fecha son requeridos' })
    }

    const { data, error } = await supabase
      .from('planificacion_semanal')
      .upsert({
        empleado_id,
        turno_id,
        sucursal_id: sucursal_id || null,
        fecha,
        created_by: req.perfil?.id || null,
      }, { onConflict: 'empleado_id,fecha' })
      .select('*, empleados(id, nombre), turnos(id, nombre, hora_entrada, hora_salida), sucursales(id, nombre)')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al guardar planificacion:', err)
    res.status(500).json({ error: 'Error al guardar planificacion' })
  }
}))

// POST /api/planificacion/bulk — Upsert masivo
router.post('/bulk', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { asignaciones } = req.body

    if (!asignaciones || !Array.isArray(asignaciones) || asignaciones.length === 0) {
      return res.status(400).json({ error: 'asignaciones es requerido (array)' })
    }

    const rows = asignaciones.map(a => ({
      empleado_id: a.empleado_id,
      turno_id: a.turno_id,
      sucursal_id: a.sucursal_id || null,
      fecha: a.fecha,
      created_by: req.perfil?.id || null,
    }))

    const { data, error } = await supabase
      .from('planificacion_semanal')
      .upsert(rows, { onConflict: 'empleado_id,fecha' })
      .select('*, empleados(id, nombre), turnos(id, nombre), sucursales(id, nombre)')

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al guardar planificacion masiva:', err)
    res.status(500).json({ error: 'Error al guardar planificacion masiva' })
  }
}))

// DELETE /api/planificacion/:id — Eliminar asignacion
router.delete('/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase
      .from('planificacion_semanal')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ mensaje: 'Asignacion eliminada' })
  } catch (err) {
    logger.error('Error al eliminar planificacion:', err)
    res.status(500).json({ error: 'Error al eliminar planificacion' })
  }
}))

// POST /api/planificacion/copiar-semana — Copiar semana origen a destino
router.post('/copiar-semana', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { fecha_origen, fecha_destino } = req.body

    if (!fecha_origen || !fecha_destino) {
      return res.status(400).json({ error: 'fecha_origen y fecha_destino son requeridos (lunes de cada semana)' })
    }

    // Obtener planificacion de la semana origen (lunes a domingo)
    const origenInicio = fecha_origen
    const origenFin = sumarDias(fecha_origen, 6)

    const { data: planOrigen, error: fetchErr } = await supabase
      .from('planificacion_semanal')
      .select('empleado_id, turno_id, sucursal_id, fecha')
      .gte('fecha', origenInicio)
      .lte('fecha', origenFin)

    if (fetchErr) throw fetchErr

    if (!planOrigen || planOrigen.length === 0) {
      return res.status(400).json({ error: 'No hay planificacion en la semana origen' })
    }

    // Calcular offset en dias entre origen y destino
    const diffDias = Math.round((new Date(fecha_destino) - new Date(fecha_origen)) / (1000 * 60 * 60 * 24))

    const nuevasAsignaciones = planOrigen.map(p => ({
      empleado_id: p.empleado_id,
      turno_id: p.turno_id,
      sucursal_id: p.sucursal_id,
      fecha: sumarDias(p.fecha, diffDias),
      created_by: req.perfil?.id || null,
    }))

    const { data, error } = await supabase
      .from('planificacion_semanal')
      .upsert(nuevasAsignaciones, { onConflict: 'empleado_id,fecha' })
      .select('*, empleados(id, nombre), turnos(id, nombre), sucursales(id, nombre)')

    if (error) throw error
    res.json({ copiadas: (data || []).length, data })
  } catch (err) {
    logger.error('Error al copiar semana:', err)
    res.status(500).json({ error: 'Error al copiar semana' })
  }
}))

function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr)
  d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}

module.exports = router
