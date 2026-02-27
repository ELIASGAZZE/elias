// Rutas para gestión de formas de cobro
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/formas-cobro
// Cualquier usuario autenticado: lista todas las formas de cobro
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('formas_cobro')
      .select('*')
      .order('orden')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener formas de cobro:', err)
    res.status(500).json({ error: 'Error al obtener formas de cobro' })
  }
})

// POST /api/formas-cobro
// Admin: crea una nueva forma de cobro
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, orden } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la forma de cobro es requerido' })
    }

    const insert = { nombre: nombre.trim() }
    if (orden != null) insert.orden = parseInt(orden)

    const { data, error } = await supabase
      .from('formas_cobro')
      .insert(insert)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una forma de cobro con ese nombre' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear forma de cobro:', err)
    res.status(500).json({ error: 'Error al crear forma de cobro' })
  }
})

// PUT /api/formas-cobro/:id
// Admin: edita una forma de cobro
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, activo, orden } = req.body

    const updates = {}
    if (nombre != null) {
      if (!nombre.trim()) {
        return res.status(400).json({ error: 'El nombre de la forma de cobro no puede estar vacío' })
      }
      updates.nombre = nombre.trim()
    }
    if (activo != null) updates.activo = activo
    if (orden != null) updates.orden = parseInt(orden)

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('formas_cobro')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una forma de cobro con ese nombre' })
      }
      throw error
    }
    res.json(data)
  } catch (err) {
    console.error('Error al editar forma de cobro:', err)
    res.status(500).json({ error: 'Error al editar forma de cobro' })
  }
})

// DELETE /api/formas-cobro/:id
// Admin: elimina una forma de cobro
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('formas_cobro')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Forma de cobro eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar forma de cobro:', err)
    res.status(500).json({ error: 'Error al eliminar forma de cobro' })
  }
})

module.exports = router
