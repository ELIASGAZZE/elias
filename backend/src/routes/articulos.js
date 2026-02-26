// Rutas para gestión de artículos
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const { sincronizarERP, generateAccessToken } = require('../services/syncERP')

// GET /api/articulos
// Con sucursal_id: devuelve artículos habilitados para esa sucursal (rápido, cualquier rol)
// Sin sucursal_id (admin): devuelve todos los artículos con relaciones por sucursal
router.get('/', verificarAuth, async (req, res) => {
  try {
    const sucursalId = req.query.sucursal_id

    // Path rápido: artículos habilitados para una sucursal específica
    if (sucursalId) {
      const { data, error } = await supabase
        .from('articulos_por_sucursal')
        .select('articulos(id, codigo, nombre, tipo, rubro, marca), habilitado, stock_ideal')
        .eq('sucursal_id', sucursalId)
        .eq('habilitado', true)

      if (error) throw error

      const articulosHabilitados = data.map(item => ({
        ...item.articulos,
        habilitado: item.habilitado,
        stock_ideal: item.stock_ideal,
      }))

      return res.json(articulosHabilitados)
    }

    // Path admin: todos los artículos con estado por sucursal
    if (req.perfil.rol !== 'admin') {
      return res.status(400).json({ error: 'Se requiere sucursal_id' })
    }

    const tipo = req.query.tipo
    const PAGE_SIZE = 1000
    let allData = []
    let from = 0

    while (true) {
      let query = supabase
        .from('articulos')
        .select('*, articulos_por_sucursal(sucursal_id, habilitado, stock_ideal)')
        .order('nombre')
        .range(from, from + PAGE_SIZE - 1)

      if (tipo) {
        query = query.eq('tipo', tipo)
      }

      const { data, error } = await query
      if (error) throw error

      allData = allData.concat(data)

      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    res.json(allData)
  } catch (err) {
    console.error('Error al obtener artículos:', err)
    res.status(500).json({ error: 'Error al obtener artículos' })
  }
})

// GET /api/articulos/erp
// Cualquier usuario autenticado: artículos ERP paginados con búsqueda
// Usado para pedidos extraordinarios (todos los artículos ERP, sin filtro por sucursal)
router.get('/erp', verificarAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = parseInt(req.query.limit) || 20
    const buscar = req.query.buscar?.trim() || ''
    const from = (page - 1) * limit
    const to = from + limit - 1

    // Si vienen IDs específicos, devolver solo esos (sin paginación)
    const ids = req.query.ids
    if (ids) {
      const idsArray = ids.split(',').filter(Boolean)
      if (idsArray.length > 0) {
        const { data, error } = await supabase
          .from('articulos')
          .select('id, codigo, nombre, rubro, marca')
          .eq('tipo', 'automatico')
          .eq('es_pesable', false)
          .in('id', idsArray)
          .order('nombre')
        if (error) throw error
        return res.json({ articulos: data, total: data.length })
      }
    }

    let query = supabase
      .from('articulos')
      .select('id, codigo, nombre, rubro, marca', { count: 'exact' })
      .eq('tipo', 'automatico')
      .eq('es_pesable', false)
      .order('nombre')
      .range(from, to)

    if (buscar) {
      query = query.or(`nombre.ilike.%${buscar}%,codigo.ilike.%${buscar}%`)
    }

    const { data, error, count } = await query
    if (error) throw error

    res.json({ articulos: data, total: count })
  } catch (err) {
    console.error('Error al obtener artículos ERP:', err)
    res.status(500).json({ error: 'Error al obtener artículos ERP' })
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
      .upsert(upsertData, { onConflict: 'articulo_id,sucursal_id' })
      .select()

    if (error) throw error
    res.json(data?.[0] || upsertData)
  } catch (err) {
    console.error('Error al actualizar estado del artículo:', err)
    res.status(500).json({ error: 'Error al actualizar artículo' })
  }
})

// PUT /api/articulos/:articuloId/sucursal/:sucursalId/stock-ideal
// Cualquier usuario autenticado puede actualizar el stock ideal
router.put('/:articuloId/sucursal/:sucursalId/stock-ideal', verificarAuth, async (req, res) => {
  try {
    const { articuloId, sucursalId } = req.params
    const { stock_ideal } = req.body

    if (typeof stock_ideal !== 'number' || stock_ideal < 0) {
      return res.status(400).json({ error: 'stock_ideal debe ser un número >= 0' })
    }

    const { data, error } = await supabase
      .from('articulos_por_sucursal')
      .update({ stock_ideal })
      .eq('articulo_id', articuloId)
      .eq('sucursal_id', sucursalId)
      .select()

    if (error) throw error
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Relación artículo-sucursal no encontrada' })
    }

    res.json(data[0])
  } catch (err) {
    console.error('Error al actualizar stock ideal:', err)
    res.status(500).json({ error: 'Error al actualizar stock ideal' })
  }
})

// PUT /api/articulos/:id
// Admin: edita nombre y/o rubro de un artículo manual
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { nombre, rubro } = req.body

    // Verificar que el artículo existe y es manual
    const { data: existente, error: errBuscar } = await supabase
      .from('articulos')
      .select('id, tipo')
      .eq('id', id)
      .single()

    if (errBuscar || !existente) {
      return res.status(404).json({ error: 'Artículo no encontrado' })
    }

    if (existente.tipo !== 'manual') {
      return res.status(400).json({ error: 'Solo se pueden editar artículos manuales' })
    }

    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre.trim()
    if (rubro !== undefined) updates.rubro = rubro.trim()

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' })
    }

    const { data, error } = await supabase
      .from('articulos')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al editar artículo:', err)
    res.status(500).json({ error: 'Error al editar artículo' })
  }
})

// POST /api/articulos
// Admin: crea un artículo individual (manual) con código autogenerado
router.post('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { nombre, rubro } = req.body

    if (!nombre) {
      return res.status(400).json({ error: 'Se requiere "nombre"' })
    }

    if (!rubro) {
      return res.status(400).json({ error: 'Se requiere "rubro"' })
    }

    // Generar código automático: M-0001, M-0002, etc.
    const { data: ultimo } = await supabase
      .from('articulos')
      .select('codigo')
      .like('codigo', 'M-%')
      .order('codigo', { ascending: false })
      .limit(1)
      .single()

    let siguienteNumero = 1
    if (ultimo) {
      const num = parseInt(ultimo.codigo.replace('M-', ''))
      if (!isNaN(num)) siguienteNumero = num + 1
    }

    const codigo = `M-${String(siguienteNumero).padStart(4, '0')}`

    // Crear el artículo (forzamos tipo manual)
    const { data: articulo, error } = await supabase
      .from('articulos')
      .insert({ codigo, nombre: nombre.trim(), tipo: 'manual', rubro: rubro.trim() })
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

// GET /api/articulos/diagnostico-erp
// Admin: consulta la API de Centum y devuelve info de diagnóstico sin importar/filtrar nada
router.get('/diagnostico-erp', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
    const apiKey = process.env.CENTUM_API_KEY
    const consumerId = process.env.CENTUM_CONSUMER_ID || '2'
    const clientId = process.env.CENTUM_CLIENT_ID || '2'

    const accessToken = generateAccessToken(apiKey)
    const hoy = new Date().toISOString().split('T')[0]

    // Llamada SIN filtro de Habilitado
    const response = await fetch(`${baseUrl}/Articulos/Venta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': consumerId,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify({
        IdCliente: parseInt(clientId),
        FechaDocumento: hoy,
      }),
    })

    if (!response.ok) {
      const texto = await response.text()
      return res.status(502).json({ error: `ERP respondió ${response.status}`, detalle: texto })
    }

    const erpData = await response.json()
    const items = erpData?.Articulos?.Items || erpData?.Items || (Array.isArray(erpData) ? erpData : [])

    // Buscar artículos que contengan el término de búsqueda (si se pasa ?buscar=cagnoli)
    const buscar = req.query.buscar?.toLowerCase()
    let resultado = items

    if (buscar) {
      resultado = items.filter(art => {
        const nombre = (art.Nombre || '').toLowerCase()
        const fantasia = (art.NombreFantasia || '').toLowerCase()
        const codigo = String(art.Codigo || '').toLowerCase()
        return nombre.includes(buscar) || fantasia.includes(buscar) || codigo.includes(buscar)
      })
    }

    // Estadísticas
    const habilitados = items.filter(a => a.Habilitado === true).length
    const deshabilitados = items.filter(a => a.Habilitado === false).length
    const sinCampo = items.filter(a => a.Habilitado === undefined || a.Habilitado === null).length

    res.json({
      total_items_erp: items.length,
      habilitados,
      deshabilitados,
      sin_campo_habilitado: sinCampo,
      busqueda: buscar || null,
      resultados_busqueda: resultado.length,
      muestra: resultado.slice(0, 20).map(a => ({
        Codigo: a.Codigo,
        Nombre: a.Nombre,
        NombreFantasia: a.NombreFantasia,
        Habilitado: a.Habilitado,
        EsCombo: a.EsCombo,
        Rubro: a.Rubro?.Nombre,
        Marca: a.MarcaArticulo?.Nombre,
      })),
    })
  } catch (err) {
    console.error('Error en diagnóstico ERP:', err)
    res.status(500).json({ error: 'Error al consultar ERP', detalle: err.message })
  }
})

// GET /api/articulos/diagnostico-stock
// Admin: consulta la API de stock de Centum y devuelve estructura de respuesta
router.get('/diagnostico-stock', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
    const apiKey = process.env.CENTUM_API_KEY
    const consumerId = process.env.CENTUM_CONSUMER_ID || '2'

    const accessToken = generateAccessToken(apiKey)

    const url = `${baseUrl}/ArticulosSucursalesFisicas?idsSucursalesFisicas=6087&numeroPagina=1&cantidadItemsPorPagina=5`
    console.log('[Diagnostico Stock] URL:', url)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': consumerId,
        'CentumSuiteAccessToken': accessToken,
      },
    })

    if (!response.ok) {
      const texto = await response.text()
      return res.status(502).json({ error: `ERP respondió ${response.status}`, detalle: texto })
    }

    const data = await response.json()

    res.json({
      mensaje: 'Respuesta cruda de ArticulosSucursalesFisicas',
      keys_raiz: Object.keys(data),
      total: data.CantidadTotalItems || data.TotalItems || null,
      pagina: data.Pagina || data.NumeroPagina || null,
      muestra: (data.Items || []).slice(0, 3),
      data_cruda_parcial: JSON.stringify(data).slice(0, 3000),
    })
  } catch (err) {
    console.error('Error en diagnóstico stock:', err)
    res.status(500).json({ error: 'Error al consultar stock ERP', detalle: err.message })
  }
})

// POST /api/articulos/sincronizar-erp
// Admin: sincroniza artículos desde ERP Centum
router.post('/sincronizar-erp', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const resultado = await sincronizarERP()
    res.json(resultado)
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
