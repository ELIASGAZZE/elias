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

    // Operario ve solo los habilitados para la sucursal indicada
    const sucursalId = req.query.sucursal_id
    if (!sucursalId) {
      return res.status(400).json({ error: 'Se requiere sucursal_id' })
    }

    const { data, error } = await supabase
      .from('articulos_por_sucursal')
      .select('articulos(id, codigo, nombre, tipo, rubro, marca), habilitado, stock_ideal')
      .eq('sucursal_id', sucursalId)
      .eq('habilitado', true)

    if (error) throw error

    // Aplanamos la respuesta para que sea más simple
    const articulosHabilitados = data.map(item => ({
      ...item.articulos,
      habilitado: item.habilitado,
      stock_ideal: item.stock_ideal,
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
      .select('habilitado, stock_ideal, articulos(id, codigo, nombre, tipo, rubro, marca)')
      .eq('sucursal_id', sucursalId)
      .order('articulos(nombre)')

    if (error) throw error

    const resultado = data.map(item => ({
      ...item.articulos,
      habilitado: item.habilitado,
      stock_ideal: item.stock_ideal,
    }))

    res.json(resultado)
  } catch (err) {
    console.error('Error al obtener artículos por sucursal:', err)
    res.status(500).json({ error: 'Error al obtener artículos' })
  }
})

// PUT /api/articulos/:articuloId/sucursal/:sucursalId
// Admin: habilitar/deshabilitar un artículo y/o actualizar stock_ideal
router.put('/:articuloId/sucursal/:sucursalId', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { articuloId, sucursalId } = req.params
    const { habilitado, stock_ideal } = req.body

    const upsertData = { articulo_id: articuloId, sucursal_id: sucursalId }

    if (typeof habilitado === 'boolean') {
      upsertData.habilitado = habilitado
    }
    if (typeof stock_ideal === 'number') {
      upsertData.stock_ideal = stock_ideal
    }

    // Hacemos upsert (insertar o actualizar si ya existe)
    const { data, error } = await supabase
      .from('articulos_por_sucursal')
      .upsert(upsertData)
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
// Admin: crea un artículo individual (manual)
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

    // Crear el artículo (forzamos tipo manual)
    const { data: articulo, error } = await supabase
      .from('articulos')
      .insert({ codigo, nombre, tipo: 'manual' })
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

// POST /api/articulos/sincronizar-erp
// Admin: sincroniza artículos desde ERP Centum
router.post('/sincronizar-erp', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const baseUrl = process.env.CENTUM_BASE_URL
    const apiKey = process.env.CENTUM_API_KEY
    const consumerId = process.env.CENTUM_CONSUMER_ID
    const clientId = process.env.CENTUM_CLIENT_ID

    if (!baseUrl || !apiKey) {
      return res.status(500).json({ error: 'Faltan credenciales del ERP Centum en las variables de entorno' })
    }

    // Llamar al ERP Centum
    const response = await fetch(`${baseUrl}/Articulos/Venta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ConsumidorApiPublicaID': consumerId,
      },
      body: JSON.stringify({
        Clave: apiKey,
        IdCliente: parseInt(clientId),
      }),
    })

    if (!response.ok) {
      const texto = await response.text()
      console.error('Error del ERP Centum:', response.status, texto)
      return res.status(502).json({ error: `Error al conectar con ERP Centum (${response.status})` })
    }

    const erpData = await response.json()

    // Filtrar solo habilitados
    const articulosERP = (Array.isArray(erpData) ? erpData : erpData.Datos || erpData.datos || [])
      .filter(art => art.Habilitado === true)

    if (articulosERP.length === 0) {
      return res.json({ mensaje: 'No se encontraron artículos habilitados en el ERP', cantidad: 0 })
    }

    // Mapear campos del ERP a nuestro schema
    const articulosMapeados = articulosERP.map(art => ({
      codigo: String(art.Codigo),
      nombre: art.NombreFantasia || art.Nombre || 'Sin nombre',
      rubro: art.Rubro?.Nombre || null,
      marca: art.MarcaArticulo?.Nombre || null,
      tipo: 'automatico',
    }))

    // Upsert en articulos por codigo
    const { data: articulosInsertados, error: errorUpsert } = await supabase
      .from('articulos')
      .upsert(articulosMapeados, { onConflict: 'codigo' })
      .select()

    if (errorUpsert) throw errorUpsert

    // Obtener todas las sucursales para crear filas en articulos_por_sucursal
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id')

    if (sucursales && sucursales.length > 0 && articulosInsertados && articulosInsertados.length > 0) {
      const filasRelacion = []
      for (const art of articulosInsertados) {
        for (const suc of sucursales) {
          filasRelacion.push({
            articulo_id: art.id,
            sucursal_id: suc.id,
            habilitado: false,
          })
        }
      }

      // Upsert para no duplicar si ya existen
      await supabase
        .from('articulos_por_sucursal')
        .upsert(filasRelacion, { onConflict: 'articulo_id,sucursal_id', ignoreDuplicates: true })
    }

    res.json({
      mensaje: `${articulosInsertados.length} artículos sincronizados desde el ERP`,
      cantidad: articulosInsertados.length,
    })
  } catch (err) {
    console.error('Error al sincronizar con ERP:', err)
    res.status(500).json({ error: 'Error al sincronizar con el ERP Centum' })
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
