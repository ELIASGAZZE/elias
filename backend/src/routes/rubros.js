// Rutas para gestión de rubros
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')
const { appCache } = require('../config/cache')

// GET /api/rubros
// Cualquier usuario autenticado: lista todos los rubros
router.get('/', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const cached = appCache.get('rubros:all')
    if (cached) return res.json(cached)

    const { data, error } = await supabase
      .from('rubros')
      .select('*')
      .order('nombre')

    if (error) throw error
    appCache.set('rubros:all', data, 5 * 60 * 1000)
    res.json(data)
  } catch (err) {
    logger.error('Error al obtener rubros:', err)
    res.status(500).json({ error: 'Error al obtener rubros' })
  }
}))

// POST /api/rubros
// Admin: crea un nuevo rubro
router.post('/', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { nombre } = req.body

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del rubro es requerido' })
    }

    const { data, error } = await supabase
      .from('rubros')
      .insert({ nombre: nombre.trim() })
      .select()
      .single()

    if (error) throw error
    appCache.del('rubros:all')
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear rubro:', err)
    res.status(500).json({ error: 'Error al crear rubro' })
  }
}))

// PUT /api/rubros/:id
// Admin: edita un rubro
router.put('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { nombre } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del rubro es requerido' })
    }

    const { data, error } = await supabase
      .from('rubros')
      .update({ nombre: nombre.trim() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    appCache.del('rubros:all')
    res.json(data)
  } catch (err) {
    logger.error('Error al editar rubro:', err)
    res.status(500).json({ error: 'Error al editar rubro' })
  }
}))

// DELETE /api/rubros/:id
// Admin: elimina un rubro
router.delete('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from('rubros')
      .delete()
      .eq('id', id)

    if (error) throw error
    appCache.del('rubros:all')
    res.json({ mensaje: 'Rubro eliminado correctamente' })
  } catch (err) {
    logger.error('Error al eliminar rubro:', err)
    res.status(500).json({ error: 'Error al eliminar rubro' })
  }
}))

module.exports = router
