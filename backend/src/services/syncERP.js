// Servicio de sincronización con ERP Centum
const crypto = require('crypto')
const supabase = require('../config/supabase')
const { registrarLlamada } = require('./apiLogger')
const logger = require('../config/logger')

// Guard de concurrencia: evita que dos syncs de stock corran a la vez
let stockSyncRunning = false

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
async function sincronizarERP(origen = 'cron', { skipBarcodes = false, skipSucursales = false } = {}) {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'
  const clientId = parseInt(process.env.CENTUM_CLIENT_ID) || 2

  if (!apiKey) {
    throw new Error('Falta CENTUM_API_KEY en las variables de entorno')
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
    logger.error('Error del ERP Centum:', response.status, texto)
    registrarLlamada({
      servicio: 'centum_articulos', endpoint, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: duracion,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen,
    })
    throw new Error(`Error al conectar con ERP Centum (HTTP ${response.status})`)
  }

  const erpData = await response.json()

  // Los artículos están en Articulos.Items[]
  const items = erpData?.Articulos?.Items || erpData?.Items || (Array.isArray(erpData) ? erpData : [])

  // Separar combos de artículos regulares
  const combosERP = []
  const articulosERP = []
  for (const art of items) {
    if (art.Habilitado === false) continue
    const nombre = (art.NombreFantasia || art.Nombre || '').toUpperCase()
    if (art.EsCombo === true || nombre.startsWith('COMBO')) {
      combosERP.push(art)
    } else {
      articulosERP.push(art)
    }
  }

  if (articulosERP.length === 0 && combosERP.length === 0) {
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
    precio: art.Precio != null ? Math.round(art.Precio * 100) / 100 : null,
    subrubro: art.SubRubro?.Nombre || null,
    rubro_id_centum: art.Rubro?.IdRubro || null,
    subrubro_id_centum: art.SubRubro?.IdSubRubro || null,
    descuento1: art.PorcentajeDescuento1 || 0,
    descuento2: art.PorcentajeDescuento2 || 0,
    descuento3: art.PorcentajeDescuento3 || 0,
    iva_tasa: art.CategoriaImpuestoIVA?.Tasa != null ? art.CategoriaImpuestoIVA.Tasa : 21,
    atributos: (art.AtributosArticulo || art.Atributos || []).flatMap(attr => {
      // Formato nested: { IdAtributoArticulo, Nombre, Valores: [{ IdAtributoArticuloValor, Valor }] }
      if (attr.Valores && Array.isArray(attr.Valores)) {
        return attr.Valores.map(v => ({
          id: attr.IdAtributoArticulo,
          nombre: attr.Nombre || '',
          valor: v.Valor || '',
          id_valor: v.IdAtributoArticuloValor,
        }))
      }
      // Formato plano
      return [{
        id: attr.IdAtributoArticulo || attr.IdAtributo,
        nombre: attr.Nombre || attr.NombreAtributo || '',
        valor: attr.Valor || '',
        id_valor: attr.IdAtributoArticuloValor || attr.IdValor || null,
      }]
    }),
  }))

  // Comparar con precios actuales para solo actualizar los que cambiaron
  const BATCH_SIZE = 500
  let todosLosArticulos = []

  // 1. Leer artículos actuales de Supabase (codigo, precio, descuentos)
  const articulosActuales = {}
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('articulos')
      .select('id, codigo, precio, descuento1, descuento2, descuento3, iva_tasa, nombre, es_pesable')
      .eq('tipo', 'automatico')
      .range(from, from + BATCH_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const a of data) {
      articulosActuales[a.codigo] = a
    }
    if (data.length < BATCH_SIZE) break
    from += BATCH_SIZE
  }

  // 2. Separar artículos nuevos y los que cambiaron
  const nuevos = []
  const actualizados = []
  let sinCambios = 0

  for (const art of articulosMapeados) {
    const actual = articulosActuales[art.codigo]
    if (!actual) {
      nuevos.push(art)
    } else {
      const cambioPrecio = Math.abs((parseFloat(actual.precio) || 0) - (art.precio || 0)) > 0.001
      const cambioDesc1 = Math.abs((parseFloat(actual.descuento1) || 0) - (art.descuento1 || 0)) > 0.001
      const cambioDesc2 = Math.abs((parseFloat(actual.descuento2) || 0) - (art.descuento2 || 0)) > 0.001
      const cambioDesc3 = Math.abs((parseFloat(actual.descuento3) || 0) - (art.descuento3 || 0)) > 0.001
      const cambioIva = Math.abs((parseFloat(actual.iva_tasa) || 21) - (art.iva_tasa || 21)) > 0.001
      const cambioNombre = actual.nombre !== art.nombre
      const cambioPesable = (actual.es_pesable || false) !== (art.es_pesable || false)

      if (cambioPrecio || cambioDesc1 || cambioDesc2 || cambioDesc3 || cambioIva || cambioNombre || cambioPesable) {
        actualizados.push(art)
      } else {
        sinCambios++
      }
    }
  }

  // 3. Upsert solo nuevos + actualizados (con updated_at para tracking)
  const ahora = new Date().toISOString()
  const aUpsertear = [...nuevos, ...actualizados].map(art => ({ ...art, updated_at: ahora }))
  let totalInsertados = 0

  for (let i = 0; i < aUpsertear.length; i += BATCH_SIZE) {
    const lote = aUpsertear.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('articulos')
      .upsert(lote, { onConflict: 'codigo' })
      .select('id')

    if (error) throw error
    todosLosArticulos = todosLosArticulos.concat(data)
    totalInsertados += data.length
  }

  // Si no hubo cambios, igual necesitamos los IDs para relaciones de sucursales
  if (aUpsertear.length === 0) {
    todosLosArticulos = Object.values(articulosActuales).map(a => ({ id: a.id }))
  }

  logger.info(`[Sync] ${nuevos.length} nuevos, ${actualizados.length} actualizados, ${sinCambios} sin cambios`)

  // Crear relaciones con sucursales (skip en sync rápida)
  if (!skipSucursales) {
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
  }

  // Sincronizar códigos de barra con factor de unidad desde Centum BI (SQL Server) — skip en sync rápida
  let barcodesSincronizados = 0
  if (!skipBarcodes) try {
    const { getPool } = require('../config/centum')
    const db = await getPool()

    // Traer barcodes con nivel de unidad
    const barcodeResult = await db.request().query(`
      SELECT ArticuloID, CodigoBarras, UnidadNivelDefectoVentasID
      FROM ArticulosCodigosBarras_VIEW
      WHERE CodigoBarras IS NOT NULL AND CodigoBarras != ''
        AND LEN(CodigoBarras) >= 8
    `)

    // Traer factores de unidad alternativa por artículo
    const unidadesResult = await db.request().query(`
      SELECT ArticuloID, UnidadNivel1, UnidadNivel2
      FROM Articulos_VIEW
      WHERE UnidadNivel1 > 1 OR UnidadNivel2 > 1
    `)
    const unidadMap = {}
    for (const row of unidadesResult.recordset) {
      unidadMap[row.ArticuloID] = { n1: row.UnidadNivel1 || 1, n2: row.UnidadNivel2 || 1 }
    }

    // Agrupar barcodes por ArticuloID con factor calculado
    const barcodeMap = {}
    for (const row of barcodeResult.recordset) {
      const id = row.ArticuloID
      if (!barcodeMap[id]) barcodeMap[id] = []
      const nivel = row.UnidadNivelDefectoVentasID || 0
      const u = unidadMap[id] || { n1: 1, n2: 1 }
      // nivel 0 = unidad base (factor 1), nivel 1 = UnidadNivel1, nivel 2 = UnidadNivel1 * UnidadNivel2
      const factor = nivel === 0 ? 1 : nivel === 1 ? u.n1 : u.n1 * u.n2
      barcodeMap[id].push({ codigo: row.CodigoBarras.trim(), factor })
    }

    // Actualizar artículos que tienen barcodes (en paralelo, lotes de 50)
    const entries = Object.entries(barcodeMap)
    const BC_BATCH = 50
    for (let i = 0; i < entries.length; i += BC_BATCH) {
      const lote = entries.slice(i, i + BC_BATCH)
      await Promise.all(lote.map(([idCentum, codigos]) =>
        supabase
          .from('articulos')
          .update({ codigos_barras: codigos })
          .eq('id_centum', parseInt(idCentum))
          .then(() => barcodesSincronizados++)
      ))
    }
    logger.info(`[Sync] ${barcodesSincronizados} artículos con códigos de barra sincronizados`)
  } catch (err) {
    logger.error('[Sync] Error al sincronizar códigos de barra:', err.message)
  }

  // Sincronizar atributos de artículos desde Centum BI
  let atributosSincronizados = 0
  if (!skipBarcodes) try {
    const { getPool } = require('../config/centum')
    const db = await getPool()

    // 1. Traer nombres de atributos
    const attrNombresResult = await db.request().query(`
      SELECT AtributoArticuloID, NombreAtributoArticulo
      FROM AtributosArticulos_VIEW
    `)
    const attrNombres = {}
    for (const row of attrNombresResult.recordset) {
      attrNombres[row.AtributoArticuloID] = row.NombreAtributoArticulo
    }

    // 2. Traer valores de atributos
    const attrValoresResult = await db.request().query(`
      SELECT AtributoArticuloValorID, AtributoArticuloID, ValorAtributoArticulo
      FROM AtributosArticulosValores_VIEW
    `)
    const attrValores = {}
    for (const row of attrValoresResult.recordset) {
      attrValores[row.AtributoArticuloValorID] = {
        id: row.AtributoArticuloID,
        nombre: attrNombres[row.AtributoArticuloID] || '',
        valor: row.ValorAtributoArticulo,
        id_valor: row.AtributoArticuloValorID,
      }
    }

    // 3. Traer relación artículo → atributo valor
    const relResult = await db.request().query(`
      SELECT ArticuloID, AtributoArticuloValorID
      FROM Articulos_AtributosArticulosValores_VIEW
    `)
    const attrPorArticulo = {}
    for (const row of relResult.recordset) {
      const val = attrValores[row.AtributoArticuloValorID]
      if (!val) continue
      if (!attrPorArticulo[row.ArticuloID]) attrPorArticulo[row.ArticuloID] = []
      attrPorArticulo[row.ArticuloID].push(val)
    }

    // 4. Actualizar artículos en Supabase
    const attrEntries = Object.entries(attrPorArticulo)
    const ATTR_BATCH = 50
    for (let i = 0; i < attrEntries.length; i += ATTR_BATCH) {
      const lote = attrEntries.slice(i, i + ATTR_BATCH)
      await Promise.all(lote.map(([idCentum, attrs]) =>
        supabase
          .from('articulos')
          .update({ atributos: attrs })
          .eq('id_centum', parseInt(idCentum))
          .then(() => atributosSincronizados++)
      ))
    }
    logger.info(`[Sync] ${atributosSincronizados} artículos con atributos sincronizados`)
  } catch (err) {
    logger.error('[Sync] Error al sincronizar atributos:', err.message)
  }

  // Sincronizar combos al catálogo local
  let combosSincronizados = 0
  try {
    if (combosERP.length > 0) {
      const combosMapeados = combosERP.map(art => ({
        codigo: art.Codigo != null ? String(art.Codigo).trim() : '',
        nombre: art.NombreFantasia || art.Nombre || 'Sin nombre',
        rubro: art.Rubro?.Nombre || null,
        marca: art.MarcaArticulo?.Nombre || null,
        tipo: 'combo',
        es_pesable: art.EsPesable === true,
        id_centum: art.IdArticulo || null,
        precio: art.Precio != null ? Math.round(art.Precio * 100) / 100 : null,
        subrubro: art.SubRubro?.Nombre || null,
        rubro_id_centum: art.Rubro?.IdRubro || null,
        subrubro_id_centum: art.SubRubro?.IdSubRubro || null,
        descuento1: art.PorcentajeDescuento1 || 0,
        descuento2: art.PorcentajeDescuento2 || 0,
        descuento3: art.PorcentajeDescuento3 || 0,
        iva_tasa: art.CategoriaImpuestoIVA?.Tasa != null ? art.CategoriaImpuestoIVA.Tasa : 21,
        updated_at: ahora,
      }))

      for (let i = 0; i < combosMapeados.length; i += BATCH_SIZE) {
        const lote = combosMapeados.slice(i, i + BATCH_SIZE)
        const { data, error } = await supabase
          .from('articulos')
          .upsert(lote, { onConflict: 'codigo' })
          .select('id')
        if (error) throw error
        // Agregar a todosLosArticulos para crear relaciones con sucursales
        if (!skipSucursales && data) todosLosArticulos = todosLosArticulos.concat(data)
        combosSincronizados += lote.length
      }

      // Reclasificar artículos que eran "automatico" pero son combos
      await supabase
        .from('articulos')
        .update({ tipo: 'combo' })
        .eq('tipo', 'automatico')
        .ilike('nombre', 'COMBO%')

      logger.info(`[Sync] ${combosSincronizados} combos sincronizados al catálogo local`)
    }
  } catch (err) {
    logger.error('[Sync] Error al sincronizar combos:', err.message)
  }

  const duracion = Date.now() - inicioFetch
  registrarLlamada({
    servicio: 'centum_articulos', endpoint, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: duracion,
    items_procesados: totalInsertados, origen,
  })

  return {
    mensaje: `Sync ERP: ${nuevos.length} nuevos, ${actualizados.length} actualizados, ${sinCambios} sin cambios (${barcodesSincronizados} con códigos de barra, ${combosSincronizados} combos)`,
    cantidad: totalInsertados,
    nuevos: nuevos.length,
    actualizados: actualizados.length,
    sin_cambios: sinCambios,
    combos: combosSincronizados,
  }
}

/**
 * Sincroniza stock del depósito central (sucursal física Centum ID 6087) desde ERP.
 * Usa GET /ArticulosExistencias (rápido, ~1.5s/página) con filtro por sucursal.
 * Fase 1: descarga existencias paginando.
 * Fase 2: batch upsert contra la BD matcheando por id_centum.
 */
async function sincronizarStock(fullSync = false, origen = 'cron') {
  if (stockSyncRunning) {
    return { mensaje: 'Sincronización de stock ya en curso, omitiendo', actualizados: 0, procesados: 0 }
  }
  stockSyncRunning = true

  try {
    return await _sincronizarStockInternal(fullSync, origen)
  } finally {
    stockSyncRunning = false
  }
}

async function _sincronizarStockInternal(fullSync, origen) {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'

  if (!apiKey) {
    throw new Error('Falta CENTUM_API_KEY en las variables de entorno')
  }

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

  logger.info(`[Stock] Fase 1: descargando existencias del depósito (${fullSync ? 'full sync' : fechaDesde ? `incremental desde ${fechaDesde}` : 'primera sync completa'})...`)
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
      throw new Error(`Error al consultar existencias ERP página ${pagina} (HTTP ${response.status})`)
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

    logger.info(`[Stock] Página ${pagina}: ${items.length} items (acumulado: ${Object.keys(stockPorIdCentum).length}/${total})`)

    if (items.length < PAGE_SIZE) break
    pagina++
    if (pagina > 1000) {
      logger.warn('[Stock] Se alcanzó el límite de 1000 páginas, deteniendo sync')
      break
    }
  }

  const totalProcesados = Object.keys(stockPorIdCentum).length
  if (totalProcesados === 0) {
    return { mensaje: 'No se encontraron datos de stock en el ERP', actualizados: 0, procesados: 0 }
  }

  // Fase 2: leer artículos de BD y agrupar por stock para batch updates
  logger.info(`[Stock] Fase 2: actualizando BD (${totalProcesados} items del ERP)...`)
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
  logger.info(`[Stock] ${valoresUnicos.length} valores de stock distintos para actualizar`)

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
        logger.error(`[Stock] Error update stock=${stock}:`, error.message)
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
    logger.error('[Stock] Error guardando fecha de sync:', configError.message)
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

/**
 * Sincroniza stock de todas las sucursales marcadas con mostrar_en_consulta = true.
 * Guarda en tabla stock_sucursales para consulta rápida desde el POS.
 */
async function sincronizarStockMultiSucursal(origen = 'cron') {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'

  if (!apiKey) throw new Error('Falta CENTUM_API_KEY')

  // Leer sucursales con mostrar_en_consulta = true
  const { data: sucursales, error: errSuc } = await supabase
    .from('sucursales')
    .select('id, nombre, centum_sucursal_id')
    .eq('mostrar_en_consulta', true)

  if (errSuc) throw errSuc
  if (!sucursales || sucursales.length === 0) {
    return { mensaje: 'No hay sucursales con mostrar_en_consulta', sucursales: 0, total: 0 }
  }

  const inicioTotal = Date.now()
  let totalUpserted = 0

  for (const suc of sucursales) {
    if (!suc.centum_sucursal_id) continue
    const PAGE_SIZE = 500
    let pagina = 1
    const rows = []

    while (true) {
      const accessToken = generateAccessToken(apiKey)
      const url = `${baseUrl}/ArticulosExistencias?idsSucursalesFisicas=${suc.centum_sucursal_id}&numeroPagina=${pagina}&cantidadItemsPorPagina=${PAGE_SIZE}`

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'CentumSuiteConsumidorApiPublicaId': consumerId,
            'CentumSuiteAccessToken': accessToken,
          },
        })

        if (!response.ok) break

        const data = await response.json()
        const items = data.Items || []
        if (items.length === 0) break

        for (const item of items) {
          if (item.IdArticulo) {
            rows.push({
              id_centum: item.IdArticulo,
              centum_sucursal_id: suc.centum_sucursal_id,
              existencias: Math.floor(item.ExistenciasSucursales || 0),
              updated_at: new Date().toISOString(),
            })
          }
        }

        if (items.length < PAGE_SIZE) break
        pagina++
        if (pagina > 500) break
      } catch (err) {
        logger.error(`[StockMulti] Error sucursal ${suc.nombre} página ${pagina}:`, err.message)
        break
      }
    }

    // Upsert en lotes
    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      const lote = rows.slice(i, i + BATCH)
      const { error } = await supabase
        .from('stock_sucursales')
        .upsert(lote, { onConflict: 'id_centum,centum_sucursal_id' })
      if (error) logger.error(`[StockMulti] Error upsert ${suc.nombre}:`, error.message)
      else totalUpserted += lote.length
    }

    logger.info(`[StockMulti] ${suc.nombre}: ${rows.length} items`)
  }

  const duracion = Date.now() - inicioTotal
  registrarLlamada({
    servicio: 'centum_stock_multi', endpoint: 'sincronizarStockMultiSucursal', metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: duracion,
    items_procesados: totalUpserted, origen,
  })

  return { mensaje: `Stock multi-sucursal: ${totalUpserted} filas actualizadas`, sucursales: sucursales.length, total: totalUpserted }
}

/**
 * Marca en articulos.tiene_imagen = true los artículos que poseen imagen en Centum.
 */
async function sincronizarImagenesPresencia(origen = 'cron') {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'

  if (!apiKey) throw new Error('Falta CENTUM_API_KEY')

  const accessToken = generateAccessToken(apiKey)
  const hoy = new Date().toISOString().split('T')[0]
  const url = `${baseUrl}/Articulos/PoseenImagenModificada?fechaArchivoImagenDesde=2020-01-01&fechaArchivoImagenHasta=${hoy}`

  const inicio = Date.now()
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
    throw new Error(`Error consultando imágenes: HTTP ${response.status} - ${texto.slice(0, 200)}`)
  }

  const data = await response.json()
  const items = data.Items || data || []
  const idsConImagen = []

  for (const item of items) {
    if (item.IdArticulo) idsConImagen.push(item.IdArticulo)
  }

  if (idsConImagen.length === 0) {
    return { mensaje: 'No se encontraron artículos con imagen', total: 0 }
  }

  // Reset todos a false primero
  await supabase.from('articulos').update({ tiene_imagen: false }).eq('tipo', 'automatico')

  // Marcar los que sí tienen
  const BATCH = 500
  let marcados = 0
  for (let i = 0; i < idsConImagen.length; i += BATCH) {
    const lote = idsConImagen.slice(i, i + BATCH)
    const { error } = await supabase
      .from('articulos')
      .update({ tiene_imagen: true })
      .in('id_centum', lote)
    if (!error) marcados += lote.length
  }

  const duracion = Date.now() - inicio
  registrarLlamada({
    servicio: 'centum_imagenes', endpoint: 'sincronizarImagenesPresencia', metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: duracion,
    items_procesados: marcados, origen,
  })

  logger.info(`[SyncImágenes] ${marcados} artículos marcados con imagen`)
  return { mensaje: `${marcados} artículos marcados con imagen`, total: marcados }
}

module.exports = { sincronizarERP, sincronizarStock, generateAccessToken, sincronizarStockMultiSucursal, sincronizarImagenesPresencia }
