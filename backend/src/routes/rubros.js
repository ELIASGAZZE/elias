// Rutas para gestión de rubros
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/rubros
// Cualquier usuario autenticado: lista todos los rubros
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rubros')
      .select('*')
      .order('nombre')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener rubros:', err)
    res.status(500).json({ error: 'Error al obtener rubros' })
  }
})

// POST /api/rubros
// Admin: crea un nuevo rubro
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
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
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear rubro:', err)
    res.status(500).json({ error: 'Error al crear rubro' })
  }
})

// DELETE /api/rubros/:id
// Admin: elimina un rubro
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from('rubros')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Rubro eliminado correctamente' })
  } catch (err) {
    console.error('Error al eliminar rubro:', err)
    res.status(500).json({ error: 'Error al eliminar rubro' })
  }
})

module.exports = router
