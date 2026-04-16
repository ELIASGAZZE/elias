// Servicio de posventa Mercado Libre — Reclamos, Devoluciones, Mensajes
const supabase = require('../config/supabase')
const logger = require('../config/logger')
const { mlFetch, getSellerId } = require('./mercadolibreAuth')

const delay = (ms) => new Promise(r => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════
// Contadores (para badges)
// ═══════════════════════════════════════════════════════════════

async function getContadoresPosventa() {
  const [mensajes, reclamos, devoluciones] = await Promise.all([
    supabase.from('ml_mensajes_pendientes').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
    supabase.from('ml_reclamos').select('id', { count: 'exact', head: true }).eq('status', 'opened'),
    supabase.from('ml_devoluciones').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
  ])

  return {
    mensajes_pendientes: mensajes.count || 0,
    reclamos_abiertos: reclamos.count || 0,
    devoluciones_activas: devoluciones.count || 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// Reclamos (Claims)
// ═══════════════════════════════════════════════════════════════

async function syncReclamos() {
  const sellerId = await getSellerId()
  if (!sellerId) throw new Error('ML no conectado')

  let offset = 0
  const limit = 50
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    const resp = await mlFetch(
      `/post-purchase/v1/claims/search?seller_id=${sellerId}&status=opened&offset=${offset}&limit=${limit}`
    )

    if (!resp.ok) {
      // Intentar endpoint alternativo de órdenes con claims
      const errText = await resp.text()
      logger.warn(`[ML Posventa] Claims search ${resp.status}: ${errText}. Intentando vía órdenes...`)
      break
    }

    const data = await resp.json()
    const claims = data.data || data.results || []

    if (claims.length === 0) break

    for (const claim of claims) {
      try {
        await syncClaimDetalle(claim.id || claim.claim_id || claim)
        totalSynced++
        await delay(200) // Rate limiting
      } catch (err) {
        logger.error({ err, claim }, '[ML Posventa] Error sincronizando claim')
      }
    }

    offset += limit
    hasMore = claims.length === limit
  }

  // También buscar claims cerrados recientes para actualizar estado
  await syncReclamosCerrados(sellerId)

  logger.info(`[ML Posventa] ${totalSynced} reclamos sincronizados`)
  return { sincronizados: totalSynced }
}

async function syncReclamosCerrados(sellerId) {
  try {
    const resp = await mlFetch(
      `/post-purchase/v1/claims/search?seller_id=${sellerId}&status=closed&sort=date_closed_desc&limit=20`
    )
    if (!resp.ok) return

    const data = await resp.json()
    const claims = data.data || data.results || []

    for (const claim of claims) {
      const claimId = claim.id || claim.claim_id || claim
      // Actualizar si existe localmente como abierto
      const { data: existing } = await supabase
        .from('ml_reclamos')
        .select('id, status')
        .eq('claim_id', String(claimId))
        .single()

      if (existing && existing.status !== 'closed') {
        await syncClaimDetalle(claimId)
        await delay(200)
      }
    }
  } catch (err) {
    logger.warn({ err }, '[ML Posventa] Error sincronizando claims cerrados')
  }
}

async function syncClaimDetalle(claimId) {
  const resp = await mlFetch(`/post-purchase/v2/claims/${claimId}/detail`)

  if (!resp.ok) {
    // Fallback a v1
    const respV1 = await mlFetch(`/post-purchase/v1/claims/${claimId}`)
    if (!respV1.ok) {
      const err = await respV1.text()
      throw new Error(`Error obteniendo claim ${claimId}: ${respV1.status} ${err}`)
    }
    const claim = await respV1.json()
    return await upsertReclamo(claim)
  }

  const claim = await resp.json()
  await upsertReclamo(claim)

  // Buscar devolución asociada
  try {
    const retResp = await mlFetch(`/post-purchase/v2/claims/${claimId}/returns`)
    if (retResp.ok) {
      const retData = await retResp.json()
      if (retData && (retData.id || retData.return_id)) {
        await upsertDevolucion(claimId, retData)
      }
    }
  } catch (err) {
    // No todas las claims tienen devolución
  }
}

async function upsertReclamo(claim) {
  const claimId = String(claim.id || claim.claim_id)
  const resource = claim.resource || {}
  const players = claim.players || {}
  const complainant = players.complainant || {}

  const record = {
    claim_id: claimId,
    ml_order_id: resource.id_order ? String(resource.id_order) : (claim.resource_id ? String(claim.resource_id) : null),
    pack_id: claim.pack_id ? String(claim.pack_id) : null,
    stage: claim.stage || 'claim',
    status: claim.status || 'opened',
    razon: claim.reason_id || claim.reason || null,
    tipo_recurso: claim.resource_type || resource.type || null,
    comprador_id: complainant.user_id ? String(complainant.user_id) : null,
    comprador_nickname: complainant.nickname || null,
    comprador_nombre: complainant.name || null,
    fecha_creacion: claim.date_created || null,
    fecha_actualizacion: claim.last_updated || claim.date_updated || null,
    resolucion: claim.resolution ? JSON.stringify(claim.resolution) : null,
    items: claim.claim_items || claim.items || [],
    detalle: claim,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('ml_reclamos')
    .upsert(record, { onConflict: 'claim_id' })

  if (error) {
    logger.error({ error, claimId }, '[ML Posventa] Error guardando reclamo')
  }
}

async function upsertDevolucion(claimId, retData) {
  const record = {
    return_id: retData.id ? String(retData.id) : (retData.return_id ? String(retData.return_id) : null),
    claim_id: String(claimId),
    ml_order_id: retData.order_id ? String(retData.order_id) : null,
    status: retData.status || null,
    tracking_number: retData.tracking_number || null,
    shipping_id: retData.shipping_id ? String(retData.shipping_id) : null,
    fecha_limite: retData.deadline || retData.date_limit || null,
    detalle: retData,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('ml_devoluciones')
    .upsert(record, { onConflict: 'claim_id' })

  if (error) {
    logger.error({ error, claimId }, '[ML Posventa] Error guardando devolución')
  }
}

async function listarReclamos({ page = 1, limit = 20, stage, status }) {
  let query = supabase
    .from('ml_reclamos')
    .select('*', { count: 'exact' })
    .order('fecha_creacion', { ascending: false })

  if (stage) query = query.eq('stage', stage)
  if (status) query = query.eq('status', status)

  const from = (page - 1) * limit
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query
  if (error) throw error

  return {
    reclamos: data || [],
    total: count || 0,
    pagina: page,
    paginas: Math.ceil((count || 0) / limit),
  }
}

async function getReclamoDetalle(claimId) {
  // Obtener de ML en vivo
  const resp = await mlFetch(`/post-purchase/v2/claims/${claimId}/detail`)
  if (!resp.ok) {
    // Fallback a datos locales
    const { data } = await supabase.from('ml_reclamos').select('*').eq('claim_id', String(claimId)).single()
    return data
  }
  const claim = await resp.json()

  // Actualizar local
  await upsertReclamo(claim)

  // Buscar devolución
  let devolucion = null
  try {
    const retResp = await mlFetch(`/post-purchase/v2/claims/${claimId}/returns`)
    if (retResp.ok) {
      devolucion = await retResp.json()
      if (devolucion && (devolucion.id || devolucion.return_id)) {
        await upsertDevolucion(claimId, devolucion)
      }
    }
  } catch {}

  return { ...claim, devolucion }
}

// ═══════════════════════════════════════════════════════════════
// Mensajes
// ═══════════════════════════════════════════════════════════════

async function syncMensajesPendientes() {
  const sellerId = await getSellerId()
  if (!sellerId) throw new Error('ML no conectado')

  // Obtener packs con mensajes sin leer
  const resp = await mlFetch(`/messages/unread?seller_id=${sellerId}`)
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error obteniendo mensajes sin leer: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  const packs = data.packs || data.results || []

  let totalSynced = 0

  for (const pack of packs) {
    const packId = pack.pack_id || pack.id
    const unreadCount = pack.unread || pack.unread_count || 0

    if (!packId || unreadCount === 0) continue

    try {
      // Obtener último mensaje del pack
      const msgResp = await mlFetch(
        `/messages/packs/${packId}/sellers/${sellerId}?limit=1&offset=0`
      )

      let ultimoMensaje = null
      let compradorId = null
      let compradorNickname = null
      let orderId = null

      if (msgResp.ok) {
        const msgData = await msgResp.json()
        const messages = msgData.messages || msgData.results || []
        if (messages.length > 0) {
          const msg = messages[0]
          ultimoMensaje = msg.text || msg.message_text || ''
          compradorId = msg.from?.user_id ? String(msg.from.user_id) : null
          // Si el último mensaje es del vendedor, no es pendiente
          if (String(msg.from?.user_id) === String(sellerId)) continue
        }

        // Intentar obtener info de la orden
        if (msgData.conversation_status?.order_id) {
          orderId = String(msgData.conversation_status.order_id)
        }
      }

      // Buscar nickname del comprador en órdenes locales
      if (!compradorNickname && orderId) {
        const { data: orden } = await supabase
          .from('ml_ordenes')
          .select('comprador_nickname')
          .eq('ml_order_id', orderId)
          .single()
        compradorNickname = orden?.comprador_nickname || null
      }

      // Buscar por pack_id en órdenes
      if (!compradorNickname) {
        const { data: orden } = await supabase
          .from('ml_ordenes')
          .select('comprador_nickname, ml_order_id')
          .eq('pack_id', String(packId))
          .limit(1)
          .single()
        if (orden) {
          compradorNickname = orden.comprador_nickname
          if (!orderId) orderId = orden.ml_order_id
        }
      }

      const record = {
        pack_id: String(packId),
        ml_order_id: orderId,
        comprador_id: compradorId,
        comprador_nickname: compradorNickname,
        ultimo_mensaje_texto: ultimoMensaje,
        ultimo_mensaje_fecha: new Date().toISOString(),
        cantidad_sin_leer: unreadCount,
        estado: 'pendiente',
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase
        .from('ml_mensajes_pendientes')
        .upsert(record, { onConflict: 'pack_id' })

      if (error) {
        logger.error({ error, packId }, '[ML Posventa] Error guardando mensaje pendiente')
      } else {
        totalSynced++
      }

      await delay(200)
    } catch (err) {
      logger.error({ err, packId }, '[ML Posventa] Error procesando pack')
    }
  }

  // Limpiar packs que ya no están pendientes
  const packIds = packs.map(p => String(p.pack_id || p.id)).filter(Boolean)
  if (packIds.length > 0) {
    await supabase
      .from('ml_mensajes_pendientes')
      .update({ estado: 'respondido', updated_at: new Date().toISOString() })
      .eq('estado', 'pendiente')
      .not('pack_id', 'in', `(${packIds.join(',')})`)
  } else {
    // Si no hay packs pendientes, marcar todos como respondidos
    await supabase
      .from('ml_mensajes_pendientes')
      .update({ estado: 'respondido', updated_at: new Date().toISOString() })
      .eq('estado', 'pendiente')
  }

  logger.info(`[ML Posventa] ${totalSynced} mensajes pendientes sincronizados`)
  return { sincronizados: totalSynced }
}

async function listarMensajesPendientes({ page = 1, limit = 20, estado }) {
  let query = supabase
    .from('ml_mensajes_pendientes')
    .select('*', { count: 'exact' })
    .order('ultimo_mensaje_fecha', { ascending: false })

  if (estado) query = query.eq('estado', estado)

  const from = (page - 1) * limit
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query
  if (error) throw error

  return {
    mensajes: data || [],
    total: count || 0,
    pagina: page,
    paginas: Math.ceil((count || 0) / limit),
  }
}

async function getMensajesPack(packId) {
  const sellerId = await getSellerId()
  if (!sellerId) throw new Error('ML no conectado')

  const resp = await mlFetch(
    `/messages/packs/${packId}/sellers/${sellerId}?limit=50&offset=0`
  )

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error obteniendo mensajes del pack ${packId}: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  const messages = data.messages || data.results || []

  return {
    mensajes: messages.reverse(), // Cronológico: más viejo primero
    seller_id: sellerId,
    pack_id: packId,
  }
}

async function responderMensaje(packId, texto) {
  const sellerId = await getSellerId()
  if (!sellerId) throw new Error('ML no conectado')

  const resp = await mlFetch(`/messages/packs/${packId}/sellers/${sellerId}`, {
    method: 'POST',
    body: JSON.stringify({ text: texto }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error enviando mensaje: ${resp.status} ${err}`)
  }

  // Marcar como respondido localmente
  await supabase
    .from('ml_mensajes_pendientes')
    .update({
      estado: 'respondido',
      cantidad_sin_leer: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('pack_id', String(packId))

  const result = await resp.json()
  logger.info(`[ML Posventa] Mensaje enviado a pack ${packId}`)
  return result
}

// ═══════════════════════════════════════════════════════════════
// Devoluciones
// ═══════════════════════════════════════════════════════════════

async function listarDevoluciones({ page = 1, limit = 20, status }) {
  let query = supabase
    .from('ml_devoluciones')
    .select('*, ml_reclamos!inner(claim_id, razon, stage, comprador_nickname, comprador_nombre, ml_order_id)', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const from = (page - 1) * limit
  query = query.range(from, from + limit - 1)

  const { data, error, count } = await query

  if (error) {
    // Fallback sin join si la FK no existe
    logger.warn({ error }, '[ML Posventa] Error con join, usando fallback')
    let fallbackQuery = supabase
      .from('ml_devoluciones')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (status) fallbackQuery = fallbackQuery.eq('status', status)
    fallbackQuery = fallbackQuery.range(from, from + limit - 1)
    const fallback = await fallbackQuery
    return {
      devoluciones: fallback.data || [],
      total: fallback.count || 0,
      pagina: page,
      paginas: Math.ceil((fallback.count || 0) / limit),
    }
  }

  return {
    devoluciones: data || [],
    total: count || 0,
    pagina: page,
    paginas: Math.ceil((count || 0) / limit),
  }
}

async function getDevolucionDetalle(claimId) {
  // Obtener de ML en vivo
  const resp = await mlFetch(`/post-purchase/v2/claims/${claimId}/returns`)
  if (!resp.ok) {
    // Fallback a local
    const { data } = await supabase.from('ml_devoluciones').select('*').eq('claim_id', String(claimId)).single()
    return data
  }
  const retData = await resp.json()
  if (retData && (retData.id || retData.return_id)) {
    await upsertDevolucion(claimId, retData)
  }
  return retData
}

// ═══════════════════════════════════════════════════════════════
// Sync completo (reclamos + mensajes)
// ═══════════════════════════════════════════════════════════════

async function syncPosventa() {
  const [reclamos, mensajes] = await Promise.allSettled([
    syncReclamos(),
    syncMensajesPendientes(),
  ])

  return {
    reclamos: reclamos.status === 'fulfilled' ? reclamos.value : { error: reclamos.reason?.message },
    mensajes: mensajes.status === 'fulfilled' ? mensajes.value : { error: mensajes.reason?.message },
  }
}

module.exports = {
  getContadoresPosventa,
  syncReclamos,
  listarReclamos,
  getReclamoDetalle,
  syncMensajesPendientes,
  listarMensajesPendientes,
  getMensajesPack,
  responderMensaje,
  listarDevoluciones,
  getDevolucionDetalle,
  syncPosventa,
}
