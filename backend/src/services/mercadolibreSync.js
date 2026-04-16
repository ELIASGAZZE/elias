// Servicio de sincronización de datos de Mercado Libre
const supabase = require('../config/supabase')
const logger = require('../config/logger')
const { mlFetch, getSellerId } = require('./mercadolibreAuth')

/**
 * Sincroniza órdenes recientes del vendedor
 * @param {number} diasAtras - Cantidad de días hacia atrás a sincronizar (default 30)
 */
async function syncOrdenes(diasAtras = 30) {
  const sellerId = await getSellerId()
  if (!sellerId) throw new Error('ML no conectado')

  const desde = new Date()
  desde.setDate(desde.getDate() - diasAtras)
  const desdeISO = desde.toISOString()

  let offset = 0
  const limit = 50
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    const resp = await mlFetch(
      `/orders/search?seller=${sellerId}&order.date_created.from=${desdeISO}&sort=date_desc&limit=${limit}&offset=${offset}`
    )

    if (!resp.ok) {
      const err = await resp.text()
      logger.error(`[ML Sync] Error buscando órdenes: ${resp.status} ${err}`)
      throw new Error(`Error buscando órdenes ML: ${resp.status}`)
    }

    const data = await resp.json()
    const ordenes = data.results || []

    for (const orden of ordenes) {
      await upsertOrden(orden)
      totalSynced++
    }

    offset += limit
    hasMore = ordenes.length === limit && offset < (data.paging?.total || 0)
  }

  logger.info(`[ML Sync] ${totalSynced} órdenes sincronizadas (últimos ${diasAtras} días)`)
  return { sincronizadas: totalSynced }
}

/**
 * Inserta o actualiza una orden en Supabase
 */
async function upsertOrden(orden) {
  const items = (orden.order_items || []).map(item => ({
    titulo: item.item?.title,
    ml_item_id: item.item?.id,
    cantidad: item.quantity,
    precio_unitario: item.unit_price,
    sku: item.item?.seller_sku || null,
    variacion_id: item.item?.variation_id || null,
  }))

  const comprador = orden.buyer || {}
  const envio = orden.shipping || {}

  const record = {
    ml_order_id: String(orden.id),
    pack_id: orden.pack_id ? String(orden.pack_id) : null,
    estado: orden.status, // paid, cancelled, etc.
    estado_detalle: orden.status_detail || null,
    fecha_creacion: orden.date_created,
    fecha_cierre: orden.date_closed || null,
    total: orden.total_amount,
    moneda: orden.currency_id || 'ARS',
    items,
    // Comprador
    comprador_id: String(comprador.id || ''),
    comprador_nickname: comprador.nickname || '',
    comprador_nombre: `${comprador.first_name || ''} ${comprador.last_name || ''}`.trim(),
    // Envío
    envio_id: envio.id ? String(envio.id) : null,
    envio_estado: envio.status || null,
    // Metadata
    tags: orden.tags || [],
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('ml_ordenes')
    .upsert(record, { onConflict: 'ml_order_id' })

  if (error) {
    logger.error({ error, ml_order_id: orden.id }, '[ML Sync] Error guardando orden')
  }
}

/**
 * Obtiene el detalle de una orden específica de ML
 */
async function getOrdenDetalle(mlOrderId) {
  const resp = await mlFetch(`/orders/${mlOrderId}`)
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error obteniendo orden ${mlOrderId}: ${resp.status} ${err}`)
  }
  return resp.json()
}

/**
 * Obtiene el detalle de envío de una orden
 */
async function getEnvioDetalle(envioId) {
  if (!envioId) return null
  const resp = await mlFetch(`/shipments/${envioId}`)
  if (!resp.ok) return null
  return resp.json()
}

/**
 * Dashboard con métricas de ML
 */
async function getDashboard() {
  // Totales generales
  const { data: ordenes, error } = await supabase
    .from('ml_ordenes')
    .select('estado, total, fecha_creacion')
    .order('fecha_creacion', { ascending: false })

  if (error) throw error

  const ahora = new Date()
  const hace7dias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000)
  const hace30dias = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000)

  const todas = ordenes || []
  const ultimos7 = todas.filter(o => new Date(o.fecha_creacion) >= hace7dias)
  const ultimos30 = todas.filter(o => new Date(o.fecha_creacion) >= hace30dias)

  const pagadas7 = ultimos7.filter(o => o.estado === 'paid')
  const pagadas30 = ultimos30.filter(o => o.estado === 'paid')

  return {
    total_ordenes: todas.length,
    ultimos_7_dias: {
      ordenes: ultimos7.length,
      pagadas: pagadas7.length,
      facturacion: pagadas7.reduce((s, o) => s + (o.total || 0), 0),
    },
    ultimos_30_dias: {
      ordenes: ultimos30.length,
      pagadas: pagadas30.length,
      facturacion: pagadas30.reduce((s, o) => s + (o.total || 0), 0),
    },
    por_estado: todas.reduce((acc, o) => {
      acc[o.estado] = (acc[o.estado] || 0) + 1
      return acc
    }, {}),
  }
}

/**
 * Lista órdenes con filtros y paginación
 */
async function listarOrdenes({ estado, desde, hasta, busqueda, page = 1, limit = 20 }) {
  let query = supabase
    .from('ml_ordenes')
    .select('*', { count: 'exact' })
    .order('fecha_creacion', { ascending: false })

  if (estado) query = query.eq('estado', estado)
  if (desde) query = query.gte('fecha_creacion', desde)
  if (hasta) query = query.lte('fecha_creacion', hasta)
  if (busqueda) {
    query = query.or(`comprador_nickname.ilike.%${busqueda}%,comprador_nombre.ilike.%${busqueda}%,ml_order_id.ilike.%${busqueda}%`)
  }

  const from = (page - 1) * limit
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query
  if (error) throw error

  return {
    ordenes: data || [],
    total: count || 0,
    pagina: page,
    paginas: Math.ceil((count || 0) / limit),
  }
}

module.exports = {
  syncOrdenes,
  upsertOrden,
  getOrdenDetalle,
  getEnvioDetalle,
  getDashboard,
  listarOrdenes,
}
