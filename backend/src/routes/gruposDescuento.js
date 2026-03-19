// Rutas CRUD para grupos de descuento
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/grupos-descuento — listar todos (con count de clientes)
router.get('/', verificarAuth, async (req, res) => {
  try {
    const { data: grupos, error } = await supabase
      .from('grupos_descuento')
      .select('*')
      .order('nombre', { ascending: true })

    if (error) throw error

    // Contar clientes por grupo
    const { data: clientes } = await supabase
      .from('clientes')
      .select('grupo_descuento_id')
      .not('grupo_descuento_id', 'is', null)
      .eq('activo', true)

    const countMap = {}
    for (const c of (clientes || [])) {
      countMap[c.grupo_descuento_id] = (countMap[c.grupo_descuento_id] || 0) + 1
    }

    const resultado = (grupos || []).map(g => ({
      ...g,
      cantidad_clientes: countMap[g.id] || 0,
    }))

    res.json({ grupos: resultado })
  } catch (err) {
    console.error('Error al obtener grupos descuento:', err)
    res.status(500).json({ error: 'Error al obtener grupos de descuento' })
  }
})

// POST /api/grupos-descuento — crear grupo
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, porcentaje } = req.body

    if (!nombre?.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' })
    }
    const pct = parseFloat(porcentaje)
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'El porcentaje debe estar entre 0 y 100' })
    }

    const { data, error } = await supabase
      .from('grupos_descuento')
      .insert({ nombre: nombre.trim(), porcentaje: pct })
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
    console.error('Error al crear grupo descuento:', err)
    res.status(500).json({ error: 'Error al crear grupo de descuento' })
  }
})

// PUT /api/grupos-descuento/:id — editar grupo
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, porcentaje, activo } = req.body
    const updates = {}

    if (nombre !== undefined) {
      if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' })
      updates.nombre = nombre.trim()
    }
    if (porcentaje !== undefined) {
      const pct = parseFloat(porcentaje)
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'El porcentaje debe estar entre 0 y 100' })
      }
      updates.porcentaje = pct
    }
    if (activo !== undefined) updates.activo = activo

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('grupos_descuento')
      .update(updates)
      .eq('id', req.params.id)
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
    console.error('Error al editar grupo descuento:', err)
    res.status(500).json({ error: 'Error al editar grupo de descuento' })
  }
})

// DELETE /api/grupos-descuento/:id — eliminar grupo (solo si no tiene clientes)
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    // Verificar que no tenga clientes asignados
    const { count } = await supabase
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('grupo_descuento_id', req.params.id)
      .eq('activo', true)

    if (count > 0) {
      return res.status(400).json({ error: `No se puede eliminar: hay ${count} cliente(s) asignado(s) a este grupo` })
    }

    const { error } = await supabase
      .from('grupos_descuento')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error

    res.json({ ok: true })
  } catch (err) {
    console.error('Error al eliminar grupo descuento:', err)
    res.status(500).json({ error: 'Error al eliminar grupo de descuento' })
  }
})

module.exports = router
