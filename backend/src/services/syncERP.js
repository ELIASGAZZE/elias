// Servicio de sincronización con ERP Centum
const crypto = require('crypto')
const supabase = require('../config/supabase')
const { registrarLlamada } = require('./apiLogger')

// Genera el access token para la API de Centum
// Algoritmo: fechaUTC + " " + uuid + " " + SHA1(fechaUTC + " " + uuid + " " + clavePublica)
function generateAccessToken(clavePublica) {
  const now = new Date()
  const fechaUTC = now.getUTCFullYear() + '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(now.getUTCDate()).padStart(2, '0') + 'T' +
    String(now.getUTCHours()).padStart(2, '0') + ':' +
    String(now.getUTCMinutes()).padStart(2, '0') + ':' +
    String(now.getUTCSeconds()).padStart(2, '0')

  const uuid = crypto.randomUUID().replace(/-/g, '').toLowerCase()
  const textoParaHash = fechaUTC + ' ' + uuid + ' ' + clavePublica
  const hashHex = crypto.createHash('sha1').update(textoParaHash, 'utf8').digest('hex').toUpperCase()

  return fechaUTC + ' ' + uuid + ' ' + hashHex
}

/**
 * Sincroniza artículos desde ERP Centum.
 * Retorna { mensaje, cantidad } o lanza error.
 */
async function sincronizarERP(origen = 'cron') {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'
  const clientId = process.env.CENTUM_CLIENT_ID || '2'

  if (!baseUrl || !apiKey) {
    throw new Error('Faltan credenciales del ERP Centum en las variables de entorno')
  }

  const accessToken = generateAccessToken(apiKey)
  const endpoint = `${baseUrl}/Articulos/Venta`
  const inicioFetch = Date.now()

  // Llamar al ERP Centum
  const hoy = new Date().toISOString().split('T')[0]
  let response
  try {
    response = await fetch(endpoint, {
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
        EsCombo: false,
      }),
    })
  } catch (fetchErr) {
    const duracion = Date.now() - inicioFetch
    registrarLlamada({
      servicio: 'centum_articulos', endpoint, metodo: 'POST',
      estado: 'error', duracion_ms: duracion,
      error_mensaje: fetchErr.message, origen,
    })
    throw fetchErr
  }

  if (!response.ok) {
    const texto = await response.text()
    const duracion = Date.now() - inicioFetch
    console.error('Error del ERP Centum:', response.status, texto)
    registrarLlamada({
      servicio: 'centum_articulos', endpoint, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: duracion,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen,
    })
    throw new Error(`Error al conectar con ERP Centum (${response.status})`)
  }

  const erpData = await response.json()

  // Los artículos están en Articulos.Items[]
  const items = erpData?.Articulos?.Items || erpData?.Items || (Array.isArray(erpData) ? erpData : [])
  const articulosERP = items.filter(art => {
    if (art.Habilitado === false) return false
    if (art.EsCombo === true) return false
    const nombre = (art.NombreFantasia || art.Nombre || '').toUpperCase()
    if (nombre.startsWith('COMBO ') || nombre.startsWith('COMBO\t')) return false
    return true
  })

  if (articulosERP.length === 0) {
    return { mensaje: 'No se encontraron artículos habilitados en el ERP', cantidad: 0 }
  }

  // Mapear campos del ERP a nuestro schema
  const articulosMapeados = articulosERP.map(art => ({
    codigo: art.Codigo != null ? String(art.Codigo).trim() : '',
    nombre: art.NombreFantasia || art.Nombre || 'Sin nombre',
    rubro: art.Rubro?.Nombre || null,
    marca: art.MarcaArticulo?.Nombre || null,
    tipo: 'automatico',
    es_pesable: art.EsPesable === true,
    id_centum: art.IdArticulo || null,
  }))

  // Upsert en lotes de 500
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

  // Crear relaciones con sucursales
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

    for (let i = 0; i < filasRelacion.length; i += BATCH_SIZE) {
      const lote = filasRelacion.slice(i, i + BATCH_SIZE)
      await supabase
        .from('articulos_por_sucursal')
        .upsert(lote, { onConflict: 'articulo_id,sucursal_id', ignoreDuplicates: true })
    }
  }

  const duracion = Date.now() - inicioFetch
  registrarLlamada({
    servicio: 'centum_articulos', endpoint, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: duracion,
    items_procesados: totalInsertados, origen,
  })

  return {
    mensaje: `${totalInsertados} artículos sincronizados desde el ERP`,
    cantidad: totalInsertados,
  }
}

/**
 * Sincroniza stock del depósito central (sucursal física Centum ID 6087) desde ERP.
 * Usa GET /ArticulosExistencias (rápido, ~1.5s/página) con filtro por sucursal.
 * Fase 1: descarga existencias paginando.
 * Fase 2: batch upsert contra la BD matcheando por id_centum.
 */
async function sincronizarStock(fullSync = false, origen = 'cron') {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'

  const syncInicio = new Date().toISOString()
  const inicioTotal = Date.now()
  const endpointBase = `${baseUrl}/ArticulosExistencias`

  // Leer última fecha de sync para filtro incremental
  let fechaDesde = null
  if (!fullSync) {
    const { data: configRow } = await supabase
      .from('config')
      .select('valor')
      .eq('clave', 'ultima_sync_stock')
      .single()
    if (configRow?.valor) {
      fechaDesde = configRow.valor
    }
  }

  // Fase 1: descargar existencias del depósito (sucursal 6087)
  const PAGE_SIZE = 500
  let pagina = 1
  const stockPorIdCentum = {}

  console.log(`[Stock] Fase 1: descargando existencias del depósito (${fullSync ? 'full sync' : fechaDesde ? `incremental desde ${fechaDesde}` : 'primera sync completa'})...`)
  while (true) {
    const accessToken = generateAccessToken(apiKey)
    let url = `${baseUrl}/ArticulosExistencias?idsSucursalesFisicas=6087&numeroPagina=${pagina}&cantidadItemsPorPagina=${PAGE_SIZE}`
    if (fechaDesde) {
      url += `&fechaTrazaArticuloDesde=${encodeURIComponent(fechaDesde)}`
    }

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
      const duracion = Date.now() - inicioTotal
      registrarLlamada({
        servicio: 'centum_stock', endpoint: endpointBase, metodo: 'GET',
        estado: 'error', status_code: response.status, duracion_ms: duracion,
        error_mensaje: `Página ${pagina} - HTTP ${response.status}: ${texto.slice(0, 500)}`, origen,
      })
      throw new Error(`Error al consultar existencias ERP página ${pagina} (${response.status}): ${texto}`)
    }

    const data = await response.json()
    const items = data.Items || []
    const total = data.CantidadTotalItems || '?'

    if (items.length === 0) break

    for (const item of items) {
      if (item.IdArticulo) {
        // ExistenciasSucursales = stock en la sucursal filtrada (depósito 6087)
        stockPorIdCentum[item.IdArticulo] = Math.floor(item.ExistenciasSucursales || 0)
      }
    }

    console.log(`[Stock] Página ${pagina}: ${items.length} items (acumulado: ${Object.keys(stockPorIdCentum).length}/${total})`)

    if (items.length < PAGE_SIZE) break
    pagina++
  }

  const totalProcesados = Object.keys(stockPorIdCentum).length
  if (totalProcesados === 0) {
    return { mensaje: 'No se encontraron datos de stock en el ERP', actualizados: 0, procesados: 0 }
  }

  // Fase 2: leer artículos de BD y agrupar por stock para batch updates
  console.log(`[Stock] Fase 2: actualizando BD (${totalProcesados} items del ERP)...`)
  const BATCH = 500
  let totalActualizados = 0
  const allIdsCentum = Object.keys(stockPorIdCentum).map(Number)

  // Leer todos los artículos matcheados y agrupar por valor de stock
  const stockPorValor = {} // { stockValue: [uuid, uuid, ...] }
  for (let i = 0; i < allIdsCentum.length; i += BATCH) {
    const lote = allIdsCentum.slice(i, i + BATCH)

    const { data: articulosDB } = await supabase
      .from('articulos')
      .select('id, id_centum')
      .in('id_centum', lote)

    if (!articulosDB) continue

    for (const art of articulosDB) {
      const stock = stockPorIdCentum[art.id_centum] || 0
      if (!stockPorValor[stock]) stockPorValor[stock] = []
      stockPorValor[stock].push(art.id)
    }
  }

  // Batch update: un UPDATE por cada valor de stock distinto
  const valoresUnicos = Object.keys(stockPorValor)
  console.log(`[Stock] ${valoresUnicos.length} valores de stock distintos para actualizar`)

  for (const stockStr of valoresUnicos) {
    const stock = parseInt(stockStr)
    const ids = stockPorValor[stockStr]

    // Supabase .in() tiene límite, hacemos lotes
    for (let i = 0; i < ids.length; i += BATCH) {
      const loteIds = ids.slice(i, i + BATCH)
      const { error } = await supabase
        .from('articulos')
        .update({ stock_deposito: stock })
        .in('id', loteIds)

      if (error) {
        console.error(`[Stock] Error update stock=${stock}:`, error.message)
      } else {
        totalActualizados += loteIds.length
      }
    }
  }

  // Guardar fecha de inicio de esta sync para la próxima incremental
  const { error: configError } = await supabase
    .from('config')
    .upsert({ clave: 'ultima_sync_stock', valor: syncInicio, updated_at: new Date().toISOString() }, { onConflict: 'clave' })
  if (configError) {
    console.error('[Stock] Error guardando fecha de sync:', configError.message)
  }

  const duracionTotal = Date.now() - inicioTotal
  registrarLlamada({
    servicio: 'centum_stock', endpoint: endpointBase, metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: duracionTotal,
    items_procesados: totalProcesados, origen,
  })

  return {
    mensaje: `Stock sincronizado: ${totalActualizados} artículos actualizados (${totalProcesados} procesados del ERP, ${fullSync ? 'full' : fechaDesde ? 'incremental' : 'primera sync'})`,
    actualizados: totalActualizados,
    procesados: totalProcesados,
  }
}

module.exports = { sincronizarERP, sincronizarStock, generateAccessToken }
