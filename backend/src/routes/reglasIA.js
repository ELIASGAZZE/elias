// Rutas para gestionar reglas de la IA
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')

// GET /api/reglas-ia — listar reglas activas
router.get('/', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reglas_ia')
      .select('*, creador:perfiles!creado_por(nombre)')
      .order('created_at', { ascending: true })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('Error al obtener reglas IA:', err)
    res.status(500).json({ error: 'Error al obtener reglas' })
  }
})

// POST /api/reglas-ia — crear nueva regla
router.post('/', verificarAuth, soloGestorOAdmin, async (req, res) => {
  const { regla } = req.body
  if (!regla || !regla.trim()) {
    return res.status(400).json({ error: 'La regla es requerida' })
  }

  try {
    const { data, error } = await supabase
      .from('reglas_ia')
      .insert({
        regla: regla.trim(),
        creado_por: req.perfil.id,
      })
      .select('*, creador:perfiles!creado_por(nombre)')
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear regla IA:', err)
    res.status(500).json({ error: 'Error al guardar regla' })
  }
})

// DELETE /api/reglas-ia/:id — eliminar regla
router.delete('/:id', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('reglas_ia')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('Error al eliminar regla IA:', err)
    res.status(500).json({ error: 'Error al eliminar regla' })
  }
})

module.exports = router
