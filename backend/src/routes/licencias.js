// Rutas para licencias / ausencias
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { crearLicenciaSchema, editarLicenciaSchema } = require('../schemas/rrhh')
const asyncHandler = require('../middleware/asyncHandler')

// GET /api/licencias
router.get('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { empleado_id, estado, fecha_desde, fecha_hasta } = req.query

    let query = supabase
      .from('licencias')
      .select('*, empleados(id, nombre)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (empleado_id) query = query.eq('empleado_id', empleado_id)
    if (estado) query = query.eq('estado', estado)
    if (fecha_desde) query = query.gte('fecha_desde', fecha_desde)
    if (fecha_hasta) query = query.lte('fecha_hasta', fecha_hasta)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al listar licencias:', err)
    res.status(500).json({ error: 'Error al listar licencias' })
  }
}))

// POST /api/licencias
router.post('/', verificarAuth, soloGestorOAdmin, validate(crearLicenciaSchema), asyncHandler(async (req, res) => {
  try {
    const { empleado_id, tipo, fecha_desde, fecha_hasta, observaciones } = req.body

    if (!empleado_id || !tipo || !fecha_desde || !fecha_hasta) {
      return res.status(400).json({ error: 'empleado_id, tipo, fecha_desde y fecha_hasta son requeridos' })
    }

    const { data, error } = await supabase
      .from('licencias')
      .insert({ empleado_id, tipo, fecha_desde, fecha_hasta, observaciones })
      .select('*, empleados(id, nombre)')
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear licencia:', err)
    res.status(500).json({ error: 'Error al crear licencia' })
  }
}))

// PUT /api/licencias/:id — Aprobar/rechazar
router.put('/:id', verificarAuth, soloGestorOAdmin, validate(editarLicenciaSchema), asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { estado, observaciones } = req.body

    const updates = {}
    if (estado) {
      updates.estado = estado
      if (estado === 'aprobada' || estado === 'rechazada') {
        updates.aprobado_por = req.perfil.id
      }
    }
    if (observaciones !== undefined) updates.observaciones = observaciones

    const { data, error } = await supabase
      .from('licencias')
      .update(updates)
      .eq('id', id)
      .select('*, empleados(id, nombre)')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al actualizar licencia:', err)
    res.status(500).json({ error: 'Error al actualizar licencia' })
  }
}))

// DELETE /api/licencias/:id
router.delete('/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase.from('licencias').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Licencia eliminada' })
  } catch (err) {
    logger.error('Error al eliminar licencia:', err)
    res.status(500).json({ error: 'Error al eliminar licencia' })
  }
}))

module.exports = router
