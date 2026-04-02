// Rutas para feriados
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { crearFeriadoSchema, importarFeriadosSchema } = require('../schemas/rrhh')
const asyncHandler = require('../middleware/asyncHandler')

// GET /api/feriados
router.get('/', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { anio } = req.query
    let query = supabase.from('feriados').select('*').order('fecha')

    if (anio) {
      query = query.gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`)
    }

    const { data, error } = await query
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    logger.error('Error al listar feriados:', err)
    res.status(500).json({ error: 'Error al listar feriados' })
  }
}))

// POST /api/feriados
router.post('/', verificarAuth, soloGestorOAdmin, validate(crearFeriadoSchema), asyncHandler(async (req, res) => {
  try {
    const { fecha, descripcion, tipo, anio } = req.body

    if (!fecha || !descripcion) {
      return res.status(400).json({ error: 'fecha y descripcion son requeridos' })
    }

    const { data, error } = await supabase
      .from('feriados')
      .insert({ fecha, descripcion, tipo: tipo || 'empresa', anio: anio || null })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un feriado para esa fecha' })
      }
      throw error
    }
    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al crear feriado:', err)
    res.status(500).json({ error: 'Error al crear feriado' })
  }
}))

// DELETE /api/feriados/:id
router.delete('/:id', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { error } = await supabase.from('feriados').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ mensaje: 'Feriado eliminado' })
  } catch (err) {
    logger.error('Error al eliminar feriado:', err)
    res.status(500).json({ error: 'Error al eliminar feriado' })
  }
}))

// POST /api/feriados/importar — Importar feriados nacionales de Argentina
router.post('/importar', verificarAuth, soloGestorOAdmin, validate(importarFeriadosSchema), asyncHandler(async (req, res) => {
  try {
    const { anio } = req.body
    const year = anio || new Date().getFullYear()

    // Feriados nacionales inamovibles de Argentina
    const feriadosNacionales = [
      { fecha: `${year}-01-01`, descripcion: 'Año Nuevo' },
      { fecha: `${year}-02-24`, descripcion: 'Carnaval' },
      { fecha: `${year}-02-25`, descripcion: 'Carnaval' },
      { fecha: `${year}-03-24`, descripcion: 'Día de la Memoria' },
      { fecha: `${year}-04-02`, descripcion: 'Día del Veterano y de los Caídos en Malvinas' },
      { fecha: `${year}-05-01`, descripcion: 'Día del Trabajador' },
      { fecha: `${year}-05-25`, descripcion: 'Día de la Revolución de Mayo' },
      { fecha: `${year}-06-17`, descripcion: 'Paso a la Inmortalidad del Gral. Güemes' },
      { fecha: `${year}-06-20`, descripcion: 'Paso a la Inmortalidad del Gral. Belgrano' },
      { fecha: `${year}-07-09`, descripcion: 'Día de la Independencia' },
      { fecha: `${year}-08-17`, descripcion: 'Paso a la Inmortalidad del Gral. San Martín' },
      { fecha: `${year}-10-12`, descripcion: 'Día del Respeto a la Diversidad Cultural' },
      { fecha: `${year}-11-20`, descripcion: 'Día de la Soberanía Nacional' },
      { fecha: `${year}-12-08`, descripcion: 'Día de la Inmaculada Concepción' },
      { fecha: `${year}-12-25`, descripcion: 'Navidad' },
    ].map(f => ({ ...f, tipo: 'nacional', anio: year }))

    let insertados = 0
    let existentes = 0

    for (const feriado of feriadosNacionales) {
      const { error } = await supabase.from('feriados').insert(feriado)
      if (error && error.code === '23505') {
        existentes++
      } else if (!error) {
        insertados++
      }
    }

    res.json({ insertados, existentes, total: feriadosNacionales.length })
  } catch (err) {
    logger.error('Error al importar feriados:', err)
    res.status(500).json({ error: 'Error al importar feriados' })
  }
}))

module.exports = router
