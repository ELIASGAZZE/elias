// Rutas para gestión de artículos
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/articulos
// Operario: devuelve artículos habilitados para su sucursal
// Admin: devuelve todos los artículos
router.get('/', verificarAuth, async (req, res) => {
  try {
    const esAdmin = req.perfil.rol === 'admin'

    if (esAdmin) {
      // Admin ve todos los artículos
      const { data, error } = await supabase
        .from('articulos')
        .select('*')
        .order('nombre')

      if (error) throw error
      return res.json(data)
    }

    // Operario ve solo los habilitados para su sucursal
    const sucursalId = req.perfil.sucursal_id
    const { data, error } = await supabase
      .from('articulos_por_sucursal')
      .select('articulos(id, codigo, nombre), habilitado')
      .eq('sucursal_id', sucursalId)
      .eq('habilitado', true)

    if (error) throw error

    // Aplanamos la respuesta para que sea más simple
    const articulosHabilitados = data.map(item => ({
      ...item.articulos,
      habilitado: item.habilitado,
    }))

    res.json(articulosHabilitados)
  } catch (err) {
    console.error('Error al obtener artículos:', err)
    res.status(500).json({ error: 'Error al obtener artículos' })
  }
})

// GET /api/articulos/sucursal/:sucursalId
// Admin: ver artículos con su estado para una sucursal específica
router.get('/sucursal/:sucursalId', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { sucursalId } = req.params

    const { data, error } = await supabase
      .from('articulos_por_sucursal')
      .select('habilitado, articulos(id, codigo, nombre)')
      .eq('sucursal_id', sucursalId)
      .order('articulos(nombre)')

    if (error) throw error

    const resultado = data.map(item => ({
      ...item.articulos,
      habilitado: item.habilitado,
    }))

    res.json(resultado)
  } catch (err) {
    console.error('Error al obtener artículos por sucursal:', err)
    res.status(500).json({ error: 'Error al obtener artículos' })
  }
})

// PUT /api/articulos/:articuloId/sucursal/:sucursalId
// Admin: habilitar o deshabilitar un artículo para una sucursal
router.put('/:articuloId/sucursal/:sucursalId', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { articuloId, sucursalId } = req.params
    const { habilitado } = req.body

    if (typeof habilitado !== 'boolean') {
      return res.status(400).json({ error: 'El campo "habilitado" debe ser true o false' })
    }

    // Hacemos upsert (insertar o actualizar si ya existe)
    const { data, error } = await supabase
      .from('articulos_por_sucursal')
      .upsert({ articulo_id: articuloId, sucursal_id: sucursalId, habilitado })
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al actualizar estado del artículo:', err)
    res.status(500).json({ error: 'Error al actualizar artículo' })
  }
})

// POST /api/articulos
// Admin: crea un artículo individual
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { codigo, nombre } = req.body

    if (!codigo || !nombre) {
      return res.status(400).json({ error: 'Se requiere "codigo" y "nombre"' })
    }

    // Verificar duplicado por código
    const { data: existente } = await supabase
      .from('articulos')
      .select('id')
      .eq('codigo', codigo)
      .single()

    if (existente) {
      return res.status(409).json({ error: `Ya existe un artículo con el código "${codigo}"` })
    }

    // Crear el artículo
    const { data: articulo, error } = await supabase
      .from('articulos')
      .insert({ codigo, nombre })
      .select()
      .single()

    if (error) throw error

    // Insertar filas en articulos_por_sucursal para todas las sucursales (habilitado: false)
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id')

    if (sucursales && sucursales.length > 0) {
      const filas = sucursales.map(s => ({
        articulo_id: articulo.id,
        sucursal_id: s.id,
        habilitado: false,
      }))

      await supabase
        .from('articulos_por_sucursal')
        .insert(filas)
    }

    res.status(201).json(articulo)
  } catch (err) {
    console.error('Error al crear artículo:', err)
    res.status(500).json({ error: 'Error al crear artículo' })
  }
})

// POST /api/articulos/importar
// Admin: importa artículos desde Google Sheets (o futura API externa)
router.post('/importar', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { articulos } = req.body

    if (!Array.isArray(articulos) || articulos.length === 0) {
      return res.status(400).json({ error: 'Se requiere un array de artículos' })
    }

    // Validamos que cada artículo tenga código y nombre
    for (const art of articulos) {
      if (!art.codigo || !art.nombre) {
        return res.status(400).json({ error: 'Cada artículo debe tener "codigo" y "nombre"' })
      }
    }

    // Upsert: actualiza si el código ya existe, inserta si es nuevo
    const { data, error } = await supabase
      .from('articulos')
      .upsert(articulos, { onConflict: 'codigo' })
      .select()

    if (error) throw error
    res.json({ mensaje: `${data.length} artículos importados correctamente`, articulos: data })
  } catch (err) {
    console.error('Error al importar artículos:', err)
    res.status(500).json({ error: 'Error al importar artículos' })
  }
})

module.exports = router
