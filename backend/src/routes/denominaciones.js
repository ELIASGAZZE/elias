// Rutas para gestión de denominaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/denominaciones
// Cualquier usuario autenticado: lista todas las denominaciones
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('denominaciones')
      .select('*')
      .order('orden')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener denominaciones:', err)
    res.status(500).json({ error: 'Error al obtener denominaciones' })
  }
})

// POST /api/denominaciones
// Admin: crea una nueva denominación
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { valor, tipo, orden } = req.body

    if (valor == null || valor === '') {
      return res.status(400).json({ error: 'El valor de la denominación es requerido' })
    }

    if (!tipo || !['billete', 'moneda'].includes(tipo)) {
      return res.status(400).json({ error: 'El tipo debe ser "billete" o "moneda"' })
    }

    const insert = { valor: parseInt(valor), tipo }
    if (orden != null) insert.orden = parseInt(orden)

    const { data, error } = await supabase
      .from('denominaciones')
      .insert(insert)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una denominación con ese valor y tipo' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear denominación:', err)
    res.status(500).json({ error: 'Error al crear denominación' })
  }
})

// PUT /api/denominaciones/:id
// Admin: edita una denominación
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { valor, tipo, activo, orden } = req.body

    const updates = {}
    if (valor != null) updates.valor = parseInt(valor)
    if (tipo != null) {
      if (!['billete', 'moneda'].includes(tipo)) {
        return res.status(400).json({ error: 'El tipo debe ser "billete" o "moneda"' })
      }
      updates.tipo = tipo
    }
    if (activo != null) updates.activo = activo
    if (orden != null) updates.orden = parseInt(orden)

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('denominaciones')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una denominación con ese valor y tipo' })
      }
      throw error
    }
    res.json(data)
  } catch (err) {
    console.error('Error al editar denominación:', err)
    res.status(500).json({ error: 'Error al editar denominación' })
  }
})

// DELETE /api/denominaciones/:id
// Admin: elimina una denominación
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('denominaciones')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Denominación eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar denominación:', err)
    res.status(500).json({ error: 'Error al eliminar denominación' })
  }
})

module.exports = router
