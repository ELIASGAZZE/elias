// Rutas de cajas registradoras
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/cajas — lista cajas (operario/gestor: solo su sucursal, admin: todas)
router.get('/', verificarAuth, async (req, res) => {
  try {
    let query = supabase
      .from('cajas')
      .select('*, sucursales(id, nombre)')
      .order('created_at', { ascending: false })

    // Operario y gestor solo ven cajas de su sucursal
    if (req.perfil.rol !== 'admin') {
      if (!req.perfil.sucursal_id) {
        return res.json([])
      }
      query = query.eq('sucursal_id', req.perfil.sucursal_id)
    }

    // Filtro opcional por sucursal (admin)
    if (req.query.sucursal_id) {
      query = query.eq('sucursal_id', req.query.sucursal_id)
    }

    // Por defecto solo activas, salvo que pidan todas
    if (req.query.todas !== 'true') {
      query = query.eq('activo', true)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener cajas:', err)
    res.status(500).json({ error: 'Error al obtener cajas' })
  }
})

// POST /api/cajas — admin crea caja
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  const { nombre, sucursal_id } = req.body

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre de la caja es requerido' })
  }
  if (!sucursal_id) {
    return res.status(400).json({ error: 'La sucursal es requerida' })
  }

  try {
    const { data, error } = await supabase
      .from('cajas')
      .insert({ nombre: nombre.trim(), sucursal_id })
      .select('*, sucursales(id, nombre)')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una caja con ese nombre en esta sucursal' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear caja:', err)
    res.status(500).json({ error: 'Error al crear caja' })
  }
})

// PUT /api/cajas/:id — admin edita nombre/activo
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  const { id } = req.params
  const { nombre, activo } = req.body

  const updateData = {}
  if (nombre !== undefined) updateData.nombre = nombre.trim()
  if (activo !== undefined) updateData.activo = activo

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' })
  }

  try {
    const { data, error } = await supabase
      .from('cajas')
      .update(updateData)
      .eq('id', id)
      .select('*, sucursales(id, nombre)')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe una caja con ese nombre en esta sucursal' })
      }
      throw error
    }
    res.json(data)
  } catch (err) {
    console.error('Error al editar caja:', err)
    res.status(500).json({ error: 'Error al editar caja' })
  }
})

// DELETE /api/cajas/:id — admin elimina caja
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('cajas')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Caja eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar caja:', err)
    res.status(500).json({ error: 'Error al eliminar caja' })
  }
})

module.exports = router
