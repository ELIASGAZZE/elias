// Rutas para gestión de artículos
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

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

// Genera el access token para la API de Centum
// Algoritmo: fechaUTC + " " + uuid + " " + SHA1(fechaUTC + " " + uuid + " " + clavePublica)
const crypto = require('crypto')

function generateAccessToken(clavePublica) {
  // 1. Fecha UTC: yyyy-MM-dd'T'HH:mm:ss
  const now = new Date()
  const fechaUTC = now.getUTCFullYear() + '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(now.getUTCDate()).padStart(2, '0') + 'T' +
    String(now.getUTCHours()).padStart(2, '0') + ':' +
    String(now.getUTCMinutes()).padStart(2, '0') + ':' +
    String(now.getUTCSeconds()).padStart(2, '0')

  // 2. UUID sin guiones en minúsculas
  const uuid = crypto.randomUUID().replace(/-/g, '').toLowerCase()

  // 3. Concatenar
  const textoParaHash = fechaUTC + ' ' + uuid + ' ' + clavePublica

  // 4-5. SHA-1 en hex mayúsculas
  const hashHex = crypto.createHash('sha1').update(textoParaHash, 'utf8').digest('hex').toUpperCase()

  // 6. Token final
  return fechaUTC + ' ' + uuid + ' ' + hashHex
}

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
        Rubro: a.Rubro?.Nombre,
        Marca: a.MarcaArticulo?.Nombre,
      })),
    })
  } catch (err) {
    console.error('Error en diagnóstico ERP:', err)
    res.status(500).json({ error: 'Error al consultar ERP', detalle: err.message })
  }
})

// POST /api/articulos/sincronizar-erp
// Admin: sincroniza artículos desde ERP Centum
router.post('/sincronizar-erp', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
    const apiKey = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
    const consumerId = process.env.CENTUM_CONSUMER_ID || '2'
    const clientId = process.env.CENTUM_CLIENT_ID || '2'

    if (!baseUrl || !apiKey) {
      return res.status(500).json({ error: 'Faltan credenciales del ERP Centum en las variables de entorno' })
    }

    const accessToken = generateAccessToken(apiKey)

    // Llamar al ERP Centum
    const hoy = new Date().toISOString().split('T')[0]
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
        Habilitado: true,
      }),
    })

    if (!response.ok) {
      const texto = await response.text()
      console.error('Error del ERP Centum:', response.status, texto)
      return res.status(502).json({ error: `Error al conectar con ERP Centum (${response.status})` })
    }

    const erpData = await response.json()

    // Los artículos están en Articulos.Items[]
    const items = erpData?.Articulos?.Items || erpData?.Items || (Array.isArray(erpData) ? erpData : [])
    const articulosERP = items.filter(art => art.Habilitado === true || art.Habilitado === undefined)

    if (articulosERP.length === 0) {
      return res.json({ mensaje: 'No se encontraron artículos habilitados en el ERP', cantidad: 0 })
    }

    // Mapear campos del ERP a nuestro schema
    // Preservamos el código original tal cual viene del ERP (con ceros a la izquierda si los tiene)
    const articulosMapeados = articulosERP.map(art => ({
      codigo: art.Codigo != null ? String(art.Codigo).trim() : '',
      nombre: art.NombreFantasia || art.Nombre || 'Sin nombre',
      rubro: art.Rubro?.Nombre || null,
      marca: art.MarcaArticulo?.Nombre || null,
      tipo: 'automatico',
    }))

    // Upsert en lotes de 500 para no superar el límite de Supabase
    const BATCH_SIZE = 500
    let totalInsertados = 0
    let todosLosArticulos = []

    for (let i = 0; i < articulosMapeados.length; i += BATCH_SIZE) {
      const lote = articulosMapeados.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase
        .from('articulos')
        .upsert(lote, { onConflict: 'codigo' })
        .select('id')

      if (error) throw error
      todosLosArticulos = todosLosArticulos.concat(data)
      totalInsertados += data.length
    }

    // Obtener todas las sucursales para crear filas en articulos_por_sucursal
    const { data: sucursales } = await supabase
      .from('sucursales')
      .select('id')

    if (sucursales && sucursales.length > 0 && todosLosArticulos.length > 0) {
      const filasRelacion = []
      for (const art of todosLosArticulos) {
        for (const suc of sucursales) {
          filasRelacion.push({
            articulo_id: art.id,
            sucursal_id: suc.id,
            habilitado: false,
          })
        }
      }

      // Upsert en lotes para las relaciones también
      for (let i = 0; i < filasRelacion.length; i += BATCH_SIZE) {
        const lote = filasRelacion.slice(i, i + BATCH_SIZE)
        await supabase
          .from('articulos_por_sucursal')
          .upsert(lote, { onConflict: 'articulo_id,sucursal_id', ignoreDuplicates: true })
      }
    }

    res.json({
      mensaje: `${totalInsertados} artículos sincronizados desde el ERP`,
      cantidad: totalInsertados,
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
