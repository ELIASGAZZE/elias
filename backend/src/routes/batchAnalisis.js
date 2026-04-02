// Rutas de análisis batch de cierres de caja
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const { analizarBatch } = require('../services/patronesIA')
const logger = require('../config/logger')
const asyncHandler = require('../middleware/asyncHandler')

// POST /api/batch-analisis — ejecutar análisis batch para una fecha
router.post('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { fecha, sucursal_id } = req.body

    if (!fecha) {
      return res.status(400).json({ error: 'La fecha es requerida (YYYY-MM-DD)' })
    }

    // Verificar que no haya un batch en curso para esa fecha
    const { data: existente } = await supabase
      .from('batch_analisis')
      .select('id, estado')
      .eq('fecha', fecha)
      .eq('estado', 'procesando')
      .limit(1)

    if (existente && existente.length > 0) {
      return res.status(409).json({ error: 'Ya hay un análisis en curso para esta fecha' })
    }

    const resultado = await analizarBatch(fecha, sucursal_id || null, req.perfil.id)
    res.json(resultado)
  } catch (err) {
    logger.error('Error en batch análisis:', err)
    res.status(500).json({ error: err.message || 'Error al ejecutar análisis batch' })
  }
}))

// GET /api/batch-analisis — historial de batch analyses
router.get('/', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { desde, hasta, sucursal_id, limit: limitStr } = req.query
    const limit = Math.min(parseInt(limitStr) || 30, 100)

    let query = supabase
      .from('batch_analisis')
      .select('*, iniciado_por_perfil:perfiles!iniciado_por(id, nombre)')
      .order('fecha', { ascending: false })
      .limit(limit)

    if (desde) query = query.gte('fecha', desde)
    if (hasta) query = query.lte('fecha', hasta)
    if (sucursal_id) query = query.eq('sucursal_id', sucursal_id)

    const { data, error } = await query
    if (error) throw error

    res.json(data || [])
  } catch (err) {
    logger.error('Error al obtener historial batch:', err)
    res.status(500).json({ error: 'Error al obtener historial' })
  }
}))

// GET /api/batch-analisis/:id — detalle de un batch
router.get('/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('batch_analisis')
      .select('*, iniciado_por_perfil:perfiles!iniciado_por(id, nombre)')
      .eq('id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'Batch no encontrado' })
    }

    // Buscar análisis individuales de los cierres de esa fecha
    let cierresQuery = supabase
      .from('cierres')
      .select('id, planilla_id, fecha, estado, total_general, caja:cajas(nombre, sucursales(nombre)), empleado:empleados!empleado_id(nombre)')
      .eq('fecha', data.fecha)
      .neq('estado', 'abierta')
      .order('created_at', { ascending: true })

    if (data.sucursal_id) {
      const { data: cajas } = await supabase.from('cajas').select('id').eq('sucursal_id', data.sucursal_id)
      if (cajas && cajas.length > 0) {
        cierresQuery = cierresQuery.in('caja_id', cajas.map(c => c.id))
      }
    }

    const { data: cierres } = await cierresQuery

    // Fetch IA analyses for these cierres
    let analisisMap = {}
    if (cierres && cierres.length > 0) {
      const { data: analisis } = await supabase
        .from('analisis_ia')
        .select('cierre_id, puntaje, nivel_riesgo, resumen')
        .in('cierre_id', cierres.map(c => c.id))

      if (analisis) analisis.forEach(a => { analisisMap[a.cierre_id] = a })
    }

    const cierresConAnalisis = (cierres || []).map(c => ({
      ...c,
      analisis: analisisMap[c.id] || null,
    }))

    res.json({ ...data, cierres: cierresConAnalisis })
  } catch (err) {
    logger.error('Error al obtener detalle batch:', err)
    res.status(500).json({ error: 'Error al obtener detalle' })
  }
}))

module.exports = router
