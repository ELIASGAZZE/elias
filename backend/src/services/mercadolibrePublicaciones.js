// Servicio de publicaciones (items/listings) Mercado Libre
const supabase = require('../config/supabase')
const logger = require('../config/logger')
const { mlFetch, getSellerId } = require('./mercadolibreAuth')

const delay = (ms) => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════
// Sync publicaciones
// ═══════════════════════════════════════════════════════════════

/**
 * Sincroniza todas las publicaciones del vendedor desde ML
 * Flujo: 1) obtener IDs → 2) multi-get de a 20 → 3) upsert en Supabase
 */
async function syncPublicaciones({ estado } = {}) {
  const sellerId = await getSellerId()
  if (!sellerId) throw new Error('ML no conectado')

  // Si no se especifica estado, sincronizar todos
  const statuses = estado ? [estado] : ['active', 'paused', 'inactive', 'closed']
  let totalSynced = 0

  for (const statusFilter of statuses) {
    const synced = await syncByStatus(sellerId, statusFilter)
    totalSynced += synced
  }

  logger.info(`[ML Publicaciones] ${totalSynced} publicaciones sincronizadas en total`)
  return { sincronizadas: totalSynced, estado: estado || 'todos' }
}

async function syncByStatus(sellerId, statusFilter) {
  // Paso 1: obtener todos los IDs de items
  // ML limita offset a 1000 max, usamos scroll_id para paginar más allá
  let allIds = []

  // Primera llamada para obtener total y scroll_id
  const firstResp = await mlFetch(
    `/users/${sellerId}/items/search?status=${statusFilter}&limit=50&offset=0&search_type=scan`
  )

  if (!firstResp.ok) {
    // Fallback sin scan
    const fallbackResp = await mlFetch(`/users/${sellerId}/items/search?status=${statusFilter}&limit=50&offset=0`)
    if (!fallbackResp.ok) {
      const err = await fallbackResp.text()
      throw new Error(`Error buscando items ML: ${fallbackResp.status} ${err}`)
    }
    const fallbackData = await fallbackResp.json()
    allIds = fallbackData.results || []
  } else {
    const firstData = await firstResp.json()
    allIds = firstData.results || []
    let scrollId = firstData.scroll_id
    const totalItems = firstData.paging?.total || 0

    // Paginar con scroll_id
    while (scrollId && allIds.length < totalItems) {
      await delay(200)
      const scrollResp = await mlFetch(
        `/users/${sellerId}/items/search?status=${statusFilter}&limit=50&scroll_id=${scrollId}&search_type=scan`
      )
      if (!scrollResp.ok) break

      const scrollData = await scrollResp.json()
      const ids = scrollData.results || []
      if (ids.length === 0) break

      allIds = allIds.concat(ids)
      scrollId = scrollData.scroll_id
    }
  }

  logger.info(`[ML Publicaciones] ${allIds.length} items encontrados (${statusFilter})`)

  // Paso 2: multi-get de a 20
  let totalSynced = 0
  const chunks = chunkArray(allIds, 20)

  for (const chunk of chunks) {
    try {
      const resp = await mlFetch(
        `/items?ids=${chunk.join(',')}&attributes=id,title,price,base_price,original_price,currency_id,available_quantity,sold_quantity,condition,status,permalink,thumbnail,secure_thumbnail,category_id,listing_type_id,seller_custom_field,attributes,variations,shipping,date_created,last_updated,catalog_listing`
      )

      if (!resp.ok) {
        logger.warn(`[ML Publicaciones] Multi-get error: ${resp.status}`)
        continue
      }

      const items = await resp.json()

      const records = []
      for (const item of items) {
        if (item.code === 200 && item.body) {
          records.push(buildRecord(item.body))
        }
      }

      if (records.length > 0) {
        const { error } = await supabase
          .from('ml_publicaciones')
          .upsert(records, { onConflict: 'ml_item_id' })
        if (error) logger.error({ error }, '[ML Publicaciones] Error en batch upsert')
        else totalSynced += records.length
      }

      await delay(150) // Rate limiting
    } catch (err) {
      logger.error({ err }, '[ML Publicaciones] Error en multi-get')
    }
  }

  logger.info(`[ML Publicaciones] ${totalSynced} publicaciones sincronizadas (${statusFilter})`)
  return totalSynced
}

function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

function buildRecord(item) {
  const shipping = item.shipping || {}
  const variaciones = (item.variations || []).map(v => ({
    id: v.id,
    atributos: (v.attribute_combinations || []).map(a => ({
      nombre: a.name,
      valor: a.value_name,
    })),
    precio: v.price,
    stock: v.available_quantity,
    vendidos: v.sold_quantity,
    sku: v.seller_custom_field || null,
    fotos: v.picture_ids || [],
  }))

  const tieneVariaciones = variaciones.length > 0
  const stockTotal = tieneVariaciones
    ? variaciones.reduce((sum, v) => sum + (v.stock || 0), 0)
    : (item.available_quantity || 0)

  return {
    ml_item_id: item.id,
    titulo: item.title,
    precio: item.price,
    precio_original: item.original_price || null,
    moneda: item.currency_id || 'ARS',
    stock_disponible: stockTotal,
    vendidos: item.sold_quantity || 0,
    condicion: item.condition,
    estado: item.status,
    permalink: item.permalink,
    thumbnail: item.secure_thumbnail || item.thumbnail,
    categoria_id: item.category_id,
    tipo_publicacion: item.listing_type_id,
    sku: item.seller_custom_field
      || (item.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name
      || (variaciones.length > 0 ? variaciones[0].sku : null),
    tiene_variaciones: tieneVariaciones,
    variaciones,
    envio_gratis: shipping.free_shipping || false,
    fulfillment: shipping.logistic_type === 'fulfillment',
    logistic_type: shipping.logistic_type || null,
    shipping_mode: shipping.mode || null,
    catalogo: item.catalog_listing || false,
    fecha_creacion: item.date_created,
    fecha_actualizacion: item.last_updated,
    updated_at: new Date().toISOString(),
  }
}

// ═══════════════════════════════════════════════════════════════
// Listar publicaciones (desde cache local)
// ═══════════════════════════════════════════════════════════════

async function listarPublicaciones({ page = 1, limit = 20, estado, busqueda, sinStock, orderBy }) {
  let query = supabase
    .from('ml_publicaciones')
    .select('*', { count: 'exact' })

  if (estado) query = query.eq('estado', estado)
  if (sinStock) query = query.eq('stock_disponible', 0)
  if (busqueda) {
    query = query.or(`titulo.ilike.%${busqueda}%,ml_item_id.ilike.%${busqueda}%,sku.ilike.%${busqueda}%`)
  }

  // Ordenamiento
  switch (orderBy) {
    case 'precio_asc': query = query.order('precio', { ascending: true }); break
    case 'precio_desc': query = query.order('precio', { ascending: false }); break
    case 'stock_asc': query = query.order('stock_disponible', { ascending: true }); break
    case 'vendidos_desc': query = query.order('vendidos', { ascending: false }); break
    default: query = query.order('updated_at', { ascending: false })
  }

  const from = (page - 1) * limit
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query
  if (error) throw error

  return {
    publicaciones: data || [],
    total: count || 0,
    pagina: page,
    paginas: Math.ceil((count || 0) / limit),
  }
}

// ═══════════════════════════════════════════════════════════════
// Contadores
// ═══════════════════════════════════════════════════════════════

async function getContadoresPublicaciones() {
  const [activas, pausadas, inactivas, sinStock] = await Promise.all([
    supabase.from('ml_publicaciones').select('id', { count: 'exact', head: true }).eq('estado', 'active'),
    supabase.from('ml_publicaciones').select('id', { count: 'exact', head: true }).eq('estado', 'paused'),
    supabase.from('ml_publicaciones').select('id', { count: 'exact', head: true }).eq('estado', 'inactive'),
    supabase.from('ml_publicaciones').select('id', { count: 'exact', head: true }).eq('stock_disponible', 0),
  ])

  return {
    activas: activas.count || 0,
    pausadas: pausadas.count || 0,
    inactivas: inactivas.count || 0,
    sin_stock: sinStock.count || 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// Costos de venta (Simulador)
// ═══════════════════════════════════════════════════════════════

// Cache de tarifas (evita llamadas repetidas)
const tarifasCache = new Map()
const TARIFA_CACHE_TTL = 3600000 // 1h

/**
 * Obtiene el costo de venta para un item específico
 * Incluye category_id, logistic_type y shipping_mode para cálculo preciso
 */
async function getCostosVenta(precio, listingTypeId, categoryId, logisticType, shippingMode, billableWeight) {
  const cacheKey = `${Math.round(precio)}_${listingTypeId}_${categoryId || ''}_${logisticType || ''}_${shippingMode || ''}_${billableWeight || ''}`
  const cached = tarifasCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < TARIFA_CACHE_TTL) return cached.data

  let url = `/sites/MLA/listing_prices?price=${precio}&listing_type_id=${listingTypeId}`
  if (categoryId) url += `&category_id=${categoryId}`
  if (logisticType) url += `&logistic_type=${logisticType}`
  if (shippingMode) url += `&shipping_mode=${shippingMode}`
  if (billableWeight) url += `&billable_weight=${billableWeight}`

  const resp = await mlFetch(url)
  if (!resp.ok) return null

  const data = await resp.json()
  // Cuando se filtra por listing_type_id, ML devuelve un objeto directo o array con 1 elemento
  const tarifa = Array.isArray(data)
    ? data.find(t => t.listing_type_id === listingTypeId)
    : data

  if (!tarifa || !tarifa.sale_fee_details) return null

  const result = {
    precio,
    listing_type: listingTypeId,
    categoria: categoryId || null,
    cargo_venta: tarifa.sale_fee_amount,
    porcentaje: tarifa.sale_fee_details.percentage_fee,
    porcentaje_ml: tarifa.sale_fee_details.meli_percentage_fee,
    cargo_fijo: tarifa.sale_fee_details.fixed_fee,
    cargo_cuotas: tarifa.sale_fee_details.financing_add_on_fee,
    recibis: precio - tarifa.sale_fee_amount,
  }

  tarifasCache.set(cacheKey, { data: result, ts: Date.now() })
  return result
}

async function getCostosBatch(items) {
  // items: [{ precio, listing_type_id, category_id }]
  const uniqueKeys = new Map()
  for (const item of items) {
    const lt = item.listing_type_id || 'gold_special'
    const cat = item.category_id || ''
    const key = `${Math.round(item.precio)}_${lt}_${cat}`
    if (!uniqueKeys.has(key)) {
      uniqueKeys.set(key, { precio: item.precio, listing_type_id: lt, category_id: cat })
    }
  }

  const resultMap = new Map()
  for (const [key, { precio, listing_type_id, category_id }] of uniqueKeys) {
    const costo = await getCostosVenta(precio, listing_type_id, category_id || null)
    if (costo) resultMap.set(key, costo)
    await delay(100)
  }

  return items.map(item => {
    const lt = item.listing_type_id || 'gold_special'
    const cat = item.category_id || ''
    const key = `${Math.round(item.precio)}_${lt}_${cat}`
    return resultMap.get(key) || null
  })
}

/**
 * Obtiene el costo de envío estimado y el peso facturable del item
 * Devuelve { costo, billable_weight } — costo es 0 si no ofrece envío gratis
 */
async function getCostoEnvio(itemId, ofreceFreeShipping) {
  const sellerId = await getSellerId()
  if (!sellerId) return null

  // Siempre consultamos para obtener billable_weight (necesario para comisión exacta)
  // Pasamos free_shipping según el item para obtener el costo correcto
  const resp = await mlFetch(
    `/users/${sellerId}/shipping_options/free?item_id=${itemId}&free_shipping=${ofreceFreeShipping ? 'true' : 'false'}`
  )
  if (!resp.ok) return { costo: 0, billable_weight: null }

  const data = await resp.json()
  const all = data?.coverage?.all_country || {}
  return {
    costo: ofreceFreeShipping ? (all.list_cost || 0) : 0,
    billable_weight: all.billable_weight || null,
  }
}

/**
 * Calcula y guarda los costos de venta + envío para todas las publicaciones activas
 */
async function syncCostos() {
  // Paginar para superar el límite de 1000 filas de Supabase
  let items = []
  let page = 0
  const pageSize = 1000
  while (true) {
    const { data, error: pageErr } = await supabase
      .from('ml_publicaciones')
      .select('ml_item_id, precio, tipo_publicacion, categoria_id, envio_gratis, logistic_type, shipping_mode')
      .eq('estado', 'active')
      .gt('precio', 0)
      .range(page * pageSize, (page + 1) * pageSize - 1)
    if (pageErr) throw pageErr
    if (!data || data.length === 0) break
    items = items.concat(data)
    if (data.length < pageSize) break
    page++
  }

  if (items.length === 0) return { actualizados: 0 }

  // --- Fase 1: Shipping options (costo envío + billable_weight) en paralelo de a 5 ---
  logger.info(`[ML Costos] Fase 1: Obteniendo envíos + peso facturable de ${items.length} items`)

  const envioMap = new Map() // ml_item_id -> { costo, billable_weight }
  const envioChunks = chunkArray(items, 5)
  for (const chunk of envioChunks) {
    const results = await Promise.allSettled(
      chunk.map(item => getCostoEnvio(item.ml_item_id, item.envio_gratis).catch(() => null))
    )
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value !== null) {
        envioMap.set(chunk[i].ml_item_id, r.value)
      }
    })
    await delay(200)
  }

  logger.info(`[ML Costos] Envíos obtenidos: ${envioMap.size}/${items.length}`)

  // --- Fase 2: Comisiones (dedup por precio+tipo+cat+logística+peso) ---
  const uniqueCombos = new Map()
  for (const item of items) {
    const lt = item.tipo_publicacion || 'gold_special'
    const cat = item.categoria_id || ''
    const log = item.logistic_type || ''
    const sm = item.shipping_mode || ''
    const bw = envioMap.get(item.ml_item_id)?.billable_weight || ''
    const key = `${Math.round(item.precio)}_${lt}_${cat}_${log}_${sm}_${bw}`
    if (!uniqueCombos.has(key)) {
      uniqueCombos.set(key, {
        precio: item.precio,
        listing_type_id: lt,
        category_id: cat || null,
        logistic_type: log || null,
        shipping_mode: sm || null,
        billable_weight: bw || null,
      })
    }
  }

  logger.info(`[ML Costos] Fase 2: Calculando comisiones (${uniqueCombos.size} combos únicos)`)

  const costosMap = new Map()
  for (const [key, combo] of uniqueCombos) {
    const costo = await getCostosVenta(combo.precio, combo.listing_type_id, combo.category_id, combo.logistic_type, combo.shipping_mode, combo.billable_weight)
    if (costo) costosMap.set(key, costo)
    await delay(100)
  }

  // --- Fase 3: Guardar en Supabase ---
  let actualizados = 0
  const updateBatch = []

  for (const item of items) {
    const lt = item.tipo_publicacion || 'gold_special'
    const cat = item.categoria_id || ''
    const log = item.logistic_type || ''
    const sm = item.shipping_mode || ''
    const envioData = envioMap.get(item.ml_item_id) || { costo: 0, billable_weight: null }
    const bw = envioData.billable_weight || ''
    const key = `${Math.round(item.precio)}_${lt}_${cat}_${log}_${sm}_${bw}`
    const costo = costosMap.get(key)
    if (!costo) continue

    const costoEnvio = envioData.costo || 0
    const costoTotal = costo.cargo_venta + costoEnvio

    updateBatch.push({
      ml_item_id: item.ml_item_id,
      costo_venta: costo.cargo_venta,
      porcentaje_comision: costo.porcentaje,
      cargo_fijo: costo.cargo_fijo,
      cargo_cuotas: costo.cargo_cuotas,
      costo_envio: costoEnvio,
      costo_total: costoTotal,
      recibis: item.precio - costoTotal,
      costos_updated_at: new Date().toISOString(),
    })

    if (updateBatch.length >= 50) {
      const { error: batchErr } = await supabase
        .from('ml_publicaciones')
        .upsert(updateBatch, { onConflict: 'ml_item_id' })
      if (batchErr) logger.error({ error: batchErr }, '[ML Costos] Error en batch update')
      else actualizados += updateBatch.length
      updateBatch.length = 0
    }
  }

  if (updateBatch.length > 0) {
    const { error: batchErr } = await supabase
      .from('ml_publicaciones')
      .upsert(updateBatch, { onConflict: 'ml_item_id' })
    if (batchErr) logger.error({ error: batchErr }, '[ML Costos] Error en último batch')
    else actualizados += updateBatch.length
  }

  logger.info(`[ML Costos] ${actualizados} publicaciones actualizadas con costos + envío`)
  return { actualizados, combos_comision: uniqueCombos.size, envios_calculados: envioMap.size }
}

module.exports = {
  syncPublicaciones,
  syncCostos,
  listarPublicaciones,
  getContadoresPublicaciones,
  getCostosVenta,
  getCostosBatch,
}
