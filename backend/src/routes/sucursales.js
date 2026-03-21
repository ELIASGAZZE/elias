// Rutas para gestión de sucursales
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/sucursales
// Admin: lista todas las sucursales
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sucursales')
      .select('*')
      .order('nombre')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener sucursales:', err)
    res.status(500).json({ error: 'Error al obtener sucursales' })
  }
})

// POST /api/sucursales
// Admin: crea una nueva sucursal
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre } = req.body

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre de la sucursal es requerido' })
    }

    const { data, error } = await supabase
      .from('sucursales')
      .insert({ nombre })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear sucursal:', err)
    res.status(500).json({ error: 'Error al crear sucursal' })
  }
})

// PUT /api/sucursales/:id
// Admin: edita una sucursal
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, centum_sucursal_id, centum_operador_empresa, centum_operador_prueba, mostrar_en_consulta } = req.body

    const updateData = {}
    if (nombre !== undefined) {
      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre de la sucursal es requerido' })
      }
      updateData.nombre = nombre.trim()
    }
    if (centum_sucursal_id !== undefined) {
      updateData.centum_sucursal_id = centum_sucursal_id ? Number(centum_sucursal_id) : null
    }
    if (centum_operador_empresa !== undefined) {
      updateData.centum_operador_empresa = centum_operador_empresa?.trim() || null
    }
    if (centum_operador_prueba !== undefined) {
      updateData.centum_operador_prueba = centum_operador_prueba?.trim() || null
    }
    if (typeof mostrar_en_consulta === 'boolean') {
      updateData.mostrar_en_consulta = mostrar_en_consulta
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' })
    }

    const { data, error } = await supabase
      .from('sucursales')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al editar sucursal:', err)
    res.status(500).json({ error: 'Error al editar sucursal' })
  }
})

// DELETE /api/sucursales/:id
// Admin: elimina una sucursal
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { error } = await supabase
      .from('sucursales')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Sucursal eliminada correctamente' })
  } catch (err) {
    console.error('Error al eliminar sucursal:', err)
    res.status(500).json({ error: 'Error al eliminar sucursal' })
  }
})

module.exports = router
