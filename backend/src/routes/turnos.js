// Rutas para turnos y asignaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')

// ── Turnos CRUD ─────────────────────────────────────────────────────────────

// GET /api/turnos
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('turnos')
      .select('*')
      .order('hora_entrada')

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('Error al listar turnos:', err)
    res.status(500).json({ error: 'Error al listar turnos' })
  }
})

// POST /api/turnos
router.post('/', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { nombre, hora_entrada, hora_salida, tolerancia_entrada_min, tolerancia_salida_min } = req.body

    if (!nombre || !hora_entrada || !hora_salida) {
      return res.status(400).json({ error: 'nombre, hora_entrada y hora_salida son requeridos' })
    }

    const { data, error } = await supabase
      .from('turnos')
      .insert({
        nombre: nombre.trim(),
        hora_entrada,
        hora_salida,
        tolerancia_entrada_min: tolerancia_entrada_min ?? 10,
        tolerancia_salida_min: tolerancia_salida_min ?? 10,
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear turno:', err)
    res.status(500).json({ error: 'Error al crear turno' })
  }
})

// PUT /api/turnos/:id
router.put('/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, hora_entrada, hora_salida, tolerancia_entrada_min, tolerancia_salida_min, activo } = req.body

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (hora_entrada !== undefined) updates.hora_entrada = hora_entrada
    if (hora_salida !== undefined) updates.hora_salida = hora_salida
    if (tolerancia_entrada_min !== undefined) updates.tolerancia_entrada_min = tolerancia_entrada_min
    if (tolerancia_salida_min !== undefined) updates.tolerancia_salida_min = tolerancia_salida_min
    if (activo !== undefined) updates.activo = activo

    const { data, error } = await supabase
      .from('turnos')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al editar turno:', err)
    res.status(500).json({ error: 'Error al editar turno' })
  }
})

// DELETE /api/turnos/:id
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('turnos').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Turno eliminado' })
  } catch (err) {
    console.error('Error al eliminar turno:', err)
    res.status(500).json({ error: 'Error al eliminar turno' })
  }
})

// ── Asignaciones ────────────────────────────────────────────────────────────

// GET /api/turnos/asignaciones
router.get('/asignaciones', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { empleado_id } = req.query

    let query = supabase
      .from('asignaciones_turno')
      .select('*, empleados(id, nombre), turnos(id, nombre, hora_entrada, hora_salida)')
      .order('empleado_id')

    if (empleado_id) query = query.eq('empleado_id', empleado_id)

    // Solo vigentes
    const hoy = new Date().toISOString().split('T')[0]
    query = query.lte('vigente_desde', hoy)
    query = query.or(`vigente_hasta.is.null,vigente_hasta.gte.${hoy}`)

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('Error al listar asignaciones:', err)
    res.status(500).json({ error: 'Error al listar asignaciones' })
  }
})

// POST /api/turnos/asignaciones
router.post('/asignaciones', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { empleado_id, turno_id, dia_semana, vigente_desde, vigente_hasta } = req.body

    if (!empleado_id || !turno_id || dia_semana === undefined) {
      return res.status(400).json({ error: 'empleado_id, turno_id y dia_semana son requeridos' })
    }

    const { data, error } = await supabase
      .from('asignaciones_turno')
      .insert({
        empleado_id,
        turno_id,
        dia_semana,
        vigente_desde: vigente_desde || new Date().toISOString().split('T')[0],
        vigente_hasta: vigente_hasta || null,
      })
      .select('*, empleados(id, nombre), turnos(id, nombre, hora_entrada, hora_salida)')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una asignación para ese empleado, día y fecha' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear asignación:', err)
    res.status(500).json({ error: 'Error al crear asignación' })
  }
})

// PUT /api/turnos/asignaciones/:id
router.put('/asignaciones/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { turno_id, vigente_hasta } = req.body

    const updates = {}
    if (turno_id !== undefined) updates.turno_id = turno_id
    if (vigente_hasta !== undefined) updates.vigente_hasta = vigente_hasta

    const { data, error } = await supabase
      .from('asignaciones_turno')
      .update(updates)
      .eq('id', id)
      .select('*, empleados(id, nombre), turnos(id, nombre, hora_entrada, hora_salida)')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al editar asignación:', err)
    res.status(500).json({ error: 'Error al editar asignación' })
  }
})

// DELETE /api/turnos/asignaciones/:id
router.delete('/asignaciones/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('asignaciones_turno').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Asignación eliminada' })
  } catch (err) {
    console.error('Error al eliminar asignación:', err)
    res.status(500).json({ error: 'Error al eliminar asignación' })
  }
})

module.exports = router
