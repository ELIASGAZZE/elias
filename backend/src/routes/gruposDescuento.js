// Rutas CRUD para grupos de descuento
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')

// GET /api/grupos-descuento — listar todos (con count de clientes + rubros)
router.get('/', verificarAuth, asyncHandler(async (req, res) => {
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

    // Cargar rubros por grupo
    const { data: rubros } = await supabase
      .from('grupos_descuento_rubros')
      .select('*')
      .order('rubro')

    const rubrosMap = {}
    for (const r of (rubros || [])) {
      if (!rubrosMap[r.grupo_descuento_id]) rubrosMap[r.grupo_descuento_id] = []
      rubrosMap[r.grupo_descuento_id].push(r)
    }

    const resultado = (grupos || []).map(g => ({
      ...g,
      cantidad_clientes: countMap[g.id] || 0,
      rubros: rubrosMap[g.id] || [],
    }))

    res.json({ grupos: resultado })
  } catch (err) {
    logger.error('Error al obtener grupos descuento:', err)
    res.status(500).json({ error: 'Error al obtener grupos de descuento' })
  }
}))

// POST /api/grupos-descuento — crear grupo
router.post('/', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
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
    logger.error('Error al crear grupo descuento:', err)
    res.status(500).json({ error: 'Error al crear grupo de descuento' })
  }
}))

// PUT /api/grupos-descuento/:id — editar grupo
router.put('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
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
    logger.error('Error al editar grupo descuento:', err)
    res.status(500).json({ error: 'Error al editar grupo de descuento' })
  }
}))

// GET /api/grupos-descuento/:id/clientes — listar clientes del grupo
router.get('/:id/clientes', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('id, razon_social, cuit, condicion_iva, activo')
      .eq('grupo_descuento_id', req.params.id)
      .eq('activo', true)
      .order('razon_social')
    if (error) throw error
    res.json({ clientes: data || [] })
  } catch (err) {
    logger.error('Error al obtener clientes del grupo:', err)
    res.status(500).json({ error: 'Error al obtener clientes' })
  }
}))

// POST /api/grupos-descuento/:id/clientes — agregar cliente al grupo
router.post('/:id/clientes', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { cliente_id } = req.body
    if (!cliente_id) return res.status(400).json({ error: 'Se requiere cliente_id' })

    const { data, error } = await supabase
      .from('clientes')
      .update({ grupo_descuento_id: req.params.id })
      .eq('id', cliente_id)
      .select('id, razon_social, cuit')
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al agregar cliente al grupo:', err)
    res.status(500).json({ error: 'Error al agregar cliente' })
  }
}))

// DELETE /api/grupos-descuento/:id/clientes/:clienteId — quitar cliente del grupo
router.delete('/:id/clientes/:clienteId', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase
      .from('clientes')
      .update({ grupo_descuento_id: null })
      .eq('id', req.params.clienteId)
      .eq('grupo_descuento_id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    logger.error('Error al quitar cliente del grupo:', err)
    res.status(500).json({ error: 'Error al quitar cliente' })
  }
}))

// GET /api/grupos-descuento/buscar-clientes — buscar clientes para agregar (sin grupo o de otro grupo)
router.get('/buscar-clientes/search', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const q = req.query.q?.trim()
    if (!q || q.length < 2) return res.json({ clientes: [] })

    const { data, error } = await supabase
      .from('clientes')
      .select('id, razon_social, cuit, condicion_iva, grupo_descuento_id')
      .eq('activo', true)
      .or(`razon_social.ilike.%${q}%,cuit.ilike.%${q}%`)
      .order('razon_social')
      .limit(15)
    if (error) throw error
    res.json({ clientes: data || [] })
  } catch (err) {
    logger.error('Error al buscar clientes:', err)
    res.status(500).json({ error: 'Error al buscar clientes' })
  }
}))

// DELETE /api/grupos-descuento/:id — eliminar grupo (solo si no tiene clientes)
router.delete('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
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
    logger.error('Error al eliminar grupo descuento:', err)
    res.status(500).json({ error: 'Error al eliminar grupo de descuento' })
  }
}))

// ─── RUBROS POR GRUPO ────────────────────────────────────────────────────────

// GET /api/grupos-descuento/:id/rubros — listar rubros con descuento del grupo
router.get('/:id/rubros', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('grupos_descuento_rubros')
      .select('*')
      .eq('grupo_descuento_id', req.params.id)
      .order('rubro')
    if (error) throw error
    res.json({ rubros: data || [] })
  } catch (err) {
    logger.error('Error al obtener rubros del grupo:', err)
    res.status(500).json({ error: 'Error al obtener rubros' })
  }
}))

// POST /api/grupos-descuento/:id/rubros — guardar rubros (array completo, reemplaza todos)
router.post('/:id/rubros', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { rubros } = req.body // [{ rubro, rubro_id_centum, porcentaje }]
    if (!Array.isArray(rubros)) {
      return res.status(400).json({ error: 'rubros debe ser un array' })
    }

    const grupoId = req.params.id

    // Eliminar rubros existentes del grupo
    const { error: delError } = await supabase
      .from('grupos_descuento_rubros')
      .delete()
      .eq('grupo_descuento_id', grupoId)
    if (delError) throw delError

    // Insertar nuevos (solo los que tienen porcentaje distinto de null)
    const toInsert = rubros
      .filter(r => r.rubro && r.porcentaje !== '' && r.porcentaje !== null && r.porcentaje !== undefined)
      .map(r => ({
        grupo_descuento_id: grupoId,
        rubro: r.rubro,
        rubro_id_centum: r.rubro_id_centum || null,
        porcentaje: parseFloat(r.porcentaje) || 0,
      }))

    if (toInsert.length > 0) {
      const { error: insError } = await supabase
        .from('grupos_descuento_rubros')
        .insert(toInsert)
      if (insError) throw insError
    }

    // Devolver rubros actualizados
    const { data } = await supabase
      .from('grupos_descuento_rubros')
      .select('*')
      .eq('grupo_descuento_id', grupoId)
      .order('rubro')

    res.json({ rubros: data || [] })
  } catch (err) {
    logger.error('Error al guardar rubros del grupo:', err)
    res.status(500).json({ error: 'Error al guardar rubros' })
  }
}))

module.exports = router
