// Rutas de resoluciones de diferencias en cierres de caja
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')

// POST /api/resoluciones — crear una resolución de diferencia
router.post('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { cierre_id, tipo_diferencia, monto_diferencia, causa, descripcion, evidencia } = req.body

    if (!cierre_id || !tipo_diferencia || !causa) {
      return res.status(400).json({ error: 'cierre_id, tipo_diferencia y causa son requeridos' })
    }

    // Validar que el cierre existe
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, planilla_id, cajero_id, caja:cajas(sucursal_id)')
      .eq('id', cierre_id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const { data, error } = await supabase
      .from('resoluciones_diferencias')
      .insert({
        cierre_id,
        tipo_diferencia,
        monto_diferencia: monto_diferencia || 0,
        causa,
        descripcion: descripcion || null,
        evidencia: evidencia || {},
        resuelta_por: req.perfil.id,
        cajero_id: cierre.cajero_id || null,
        sucursal_id: cierre.caja?.sucursal_id || null,
        planilla_id: cierre.planilla_id ? parseInt(cierre.planilla_id) : null,
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear resolución:', err)
    res.status(500).json({ error: 'Error al crear resolución' })
  }
}))

// GET /api/resoluciones?cierre_id=X — resoluciones de un cierre específico
router.get('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { cierre_id, cajero_id, sucursal_id, causa, limit: limitStr } = req.query
    const limit = Math.min(parseInt(limitStr) || 50, 200)

    let query = supabase
      .from('resoluciones_diferencias')
      .select('*, resuelta_por_perfil:perfiles!resuelta_por(id, nombre, username)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (cierre_id) query = query.eq('cierre_id', cierre_id)
    if (cajero_id) query = query.eq('cajero_id', cajero_id)
    if (sucursal_id) query = query.eq('sucursal_id', sucursal_id)
    if (causa) query = query.eq('causa', causa)

    const { data, error } = await query
    if (error) throw error

    res.json(data || [])
  } catch (err) {
    logger.error('Error al obtener resoluciones:', err)
    res.status(500).json({ error: 'Error al obtener resoluciones' })
  }
}))

// DELETE /api/resoluciones/:id — eliminar una resolución
router.delete('/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase
      .from('resoluciones_diferencias')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    logger.error('Error al eliminar resolución:', err)
    res.status(500).json({ error: 'Error al eliminar resolución' })
  }
}))

// GET /api/resoluciones/estadisticas — estadísticas agregadas de resoluciones
router.get('/estadisticas', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { sucursal_id, cajero_id, desde, hasta } = req.query

    let query = supabase
      .from('resoluciones_diferencias')
      .select('tipo_diferencia, causa, monto_diferencia, cajero_id, sucursal_id, created_at')

    if (sucursal_id) query = query.eq('sucursal_id', sucursal_id)
    if (cajero_id) query = query.eq('cajero_id', cajero_id)
    if (desde) query = query.gte('created_at', desde)
    if (hasta) query = query.lte('created_at', hasta)

    const { data, error } = await query
    if (error) throw error

    const resoluciones = data || []

    // Agrupar por causa
    const porCausa = {}
    const porTipo = {}
    for (const r of resoluciones) {
      if (!porCausa[r.causa]) porCausa[r.causa] = { cantidad: 0, monto_total: 0 }
      porCausa[r.causa].cantidad++
      porCausa[r.causa].monto_total += Math.abs(parseFloat(r.monto_diferencia) || 0)

      if (!porTipo[r.tipo_diferencia]) porTipo[r.tipo_diferencia] = { cantidad: 0, monto_total: 0 }
      porTipo[r.tipo_diferencia].cantidad++
      porTipo[r.tipo_diferencia].monto_total += Math.abs(parseFloat(r.monto_diferencia) || 0)
    }

    res.json({
      total: resoluciones.length,
      por_causa: Object.entries(porCausa).map(([causa, stats]) => ({
        causa, ...stats, monto_total: parseFloat(stats.monto_total.toFixed(2)),
      })).sort((a, b) => b.cantidad - a.cantidad),
      por_tipo: Object.entries(porTipo).map(([tipo, stats]) => ({
        tipo, ...stats, monto_total: parseFloat(stats.monto_total.toFixed(2)),
      })).sort((a, b) => b.cantidad - a.cantidad),
    })
  } catch (err) {
    logger.error('Error al obtener estadísticas:', err)
    res.status(500).json({ error: 'Error al obtener estadísticas' })
  }
}))

// GET /api/resoluciones/similares — buscar resoluciones similares (para IA)
router.get('/similares', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { tipo_diferencia, cajero_id, sucursal_id, monto, tolerancia: tolStr } = req.query
    const tolerancia = parseFloat(tolStr) || 5000
    const montoNum = parseFloat(monto) || 0

    let query = supabase
      .from('resoluciones_diferencias')
      .select('*, resuelta_por_perfil:perfiles!resuelta_por(id, nombre)')
      .order('created_at', { ascending: false })
      .limit(20)

    if (tipo_diferencia) query = query.eq('tipo_diferencia', tipo_diferencia)

    // Buscar por cajero o sucursal (OR logic not available, so filter in JS)
    const { data, error } = await query
    if (error) throw error

    // Filtrar por proximidad de monto y relevancia
    const filtradas = (data || []).filter(r => {
      if (cajero_id && r.cajero_id === cajero_id) return true
      if (sucursal_id && r.sucursal_id === sucursal_id) return true
      if (montoNum && Math.abs(Math.abs(parseFloat(r.monto_diferencia)) - Math.abs(montoNum)) <= tolerancia) return true
      return false
    })

    res.json(filtradas.slice(0, 10))
  } catch (err) {
    logger.error('Error al buscar similares:', err)
    res.status(500).json({ error: 'Error al buscar resoluciones similares' })
  }
}))

module.exports = router
