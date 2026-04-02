// Rutas de cajas registradoras
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { crearCajaSchema, editarCajaSchema } = require('../schemas/cajas')
const asyncHandler = require('../middleware/asyncHandler')

// GET /api/cajas — lista cajas (operario/gestor: solo su sucursal, admin: todas)
router.get('/', verificarAuth, asyncHandler(async (req, res) => {
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
    logger.error('Error al obtener cajas:', err)
    res.status(500).json({ error: 'Error al obtener cajas' })
  }
}))

// POST /api/cajas — admin crea caja
router.post('/', verificarAuth, soloAdmin, validate(crearCajaSchema), asyncHandler(async (req, res) => {
  const { nombre, sucursal_id } = req.body

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
    logger.error('Error al crear caja:', err)
    res.status(500).json({ error: 'Error al crear caja' })
  }
}))

// PUT /api/cajas/:id — admin edita nombre/activo/punto_venta_centum
router.put('/:id', verificarAuth, soloAdmin, validate(editarCajaSchema), asyncHandler(async (req, res) => {
  const { id } = req.params
  const { nombre, activo, punto_venta_centum } = req.body

  const updateData = {}
  if (nombre !== undefined && nombre !== null) updateData.nombre = String(nombre).trim()
  if (activo !== undefined) updateData.activo = activo
  if (punto_venta_centum !== undefined) updateData.punto_venta_centum = punto_venta_centum ? Number(punto_venta_centum) : null

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
    logger.error('Error al editar caja:', err)
    res.status(500).json({ error: 'Error al editar caja' })
  }
}))

// DELETE /api/cajas/:id — admin elimina caja
router.delete('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { id } = req.params
    const { error } = await supabase
      .from('cajas')
      .delete()
      .eq('id', id)

    if (error) throw error
    res.json({ mensaje: 'Caja eliminada correctamente' })
  } catch (err) {
    logger.error('Error al eliminar caja:', err)
    res.status(500).json({ error: 'Error al eliminar caja' })
  }
}))

module.exports = router
