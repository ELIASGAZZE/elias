// Rutas para gestión de grupos de descuento
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/grupos-descuento
// Admin: lista todos los grupos con count de clientes
router.get('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data: grupos, error } = await supabase
      .from('grupos_descuento')
      .select('*')
      .order('nombre')

    if (error) throw error

    // Contar clientes por grupo
    const { data: counts, error: errCounts } = await supabase
      .from('clientes')
      .select('grupo_descuento_id')
      .not('grupo_descuento_id', 'is', null)

    if (errCounts) throw errCounts

    const countMap = {}
    for (const c of (counts || [])) {
      countMap[c.grupo_descuento_id] = (countMap[c.grupo_descuento_id] || 0) + 1
    }

    const result = grupos.map(g => ({
      ...g,
      clientes_count: countMap[g.id] || 0,
    }))

    res.json(result)
  } catch (err) {
    console.error('Error al obtener grupos de descuento:', err)
    res.status(500).json({ error: 'Error al obtener grupos de descuento' })
  }
})

// POST /api/grupos-descuento
// Admin: crea un nuevo grupo
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, porcentaje } = req.body

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del grupo es requerido' })
    }
    if (porcentaje == null || porcentaje < 0 || porcentaje > 100) {
      return res.status(400).json({ error: 'El porcentaje debe estar entre 0 y 100' })
    }

    const { data, error } = await supabase
      .from('grupos_descuento')
      .insert({ nombre: nombre.trim(), porcentaje: Number(porcentaje) })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear grupo de descuento:', err)
    res.status(500).json({ error: 'Error al crear grupo de descuento' })
  }
})

// PUT /api/grupos-descuento/:id
// Admin: edita un grupo
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const updates = {}

    if (req.body.nombre !== undefined) {
      if (!req.body.nombre || !req.body.nombre.trim()) {
        return res.status(400).json({ error: 'El nombre del grupo es requerido' })
      }
      updates.nombre = req.body.nombre.trim()
    }
    if (req.body.porcentaje !== undefined) {
      if (req.body.porcentaje < 0 || req.body.porcentaje > 100) {
        return res.status(400).json({ error: 'El porcentaje debe estar entre 0 y 100' })
      }
      updates.porcentaje = Number(req.body.porcentaje)
    }
    if (req.body.activo !== undefined) {
      updates.activo = req.body.activo
    }

    const { data, error } = await supabase
      .from('grupos_descuento')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: 'Ya existe un grupo con ese nombre' })
      }
      throw error
    }
    res.json(data)
  } catch (err) {
    console.error('Error al editar grupo de descuento:', err)
    res.status(500).json({ error: 'Error al editar grupo de descuento' })
  }
})

// DELETE /api/grupos-descuento/:id
// Admin: elimina un grupo (solo si no tiene clientes)
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // Verificar que no tenga clientes asignados
    const { count, error: errCount } = await supabase
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('grupo_descuento_id', id)

    if (errCount) throw errCount

    if (count > 0) {
      return res.status(400).json({ error: `No se puede eliminar: el grupo tiene ${count} cliente(s) asignado(s)` })
    }

    const { error } = await supabase
      .from('grupos_descuento')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Grupo eliminado correctamente' })
  } catch (err) {
    console.error('Error al eliminar grupo de descuento:', err)
    res.status(500).json({ error: 'Error al eliminar grupo de descuento' })
  }
})

// GET /api/grupos-descuento/:id/clientes
// Admin: lista clientes de un grupo
router.get('/:id/clientes', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const { data, error } = await supabase
      .from('clientes')
      .select('id, nombre, email, celular, condicion_iva')
      .eq('grupo_descuento_id', id)
      .order('nombre')

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener clientes del grupo:', err)
    res.status(500).json({ error: 'Error al obtener clientes del grupo' })
  }
})

// POST /api/grupos-descuento/:id/clientes
// Admin: agregar cliente al grupo
router.post('/:id/clientes', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { cliente_id } = req.body

    if (!cliente_id) {
      return res.status(400).json({ error: 'El cliente_id es requerido' })
    }

    const { data, error } = await supabase
      .from('clientes')
      .update({ grupo_descuento_id: id })
      .eq('id', cliente_id)
      .select('id, nombre')
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al agregar cliente al grupo:', err)
    res.status(500).json({ error: 'Error al agregar cliente al grupo' })
  }
})

// DELETE /api/grupos-descuento/:id/clientes/:clienteId
// Admin: quitar cliente del grupo
router.delete('/:id/clientes/:clienteId', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { clienteId } = req.params

    const { error } = await supabase
      .from('clientes')
      .update({ grupo_descuento_id: null })
      .eq('id', clienteId)

    if (error) throw error
    res.json({ mensaje: 'Cliente removido del grupo' })
  } catch (err) {
    console.error('Error al quitar cliente del grupo:', err)
    res.status(500).json({ error: 'Error al quitar cliente del grupo' })
  }
})

module.exports = router
