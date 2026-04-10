// Servicio de autenticación OAuth 2.0 con Mercado Libre
const supabase = require('../config/supabase')
const logger = require('../config/logger')

const ML_BASE = 'https://api.mercadolibre.com'
const ML_AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization'
const ML_APP_ID = process.env.ML_APP_ID
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI // ej: https://tubackend.com/api/mercadolibre/callback

// Cache en memoria del token (evita hits a Supabase en cada request)
let cachedToken = null
let tokenExpiry = 0

/**
 * Genera la URL de autorización para redirigir al usuario
 */
function getAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ML_APP_ID,
    redirect_uri: ML_REDIRECT_URI,
  })
  return `${ML_AUTH_URL}?${params.toString()}`
}

/**
 * Intercambia el authorization code por tokens
 */
async function exchangeCode(code) {
  const resp = await fetch(`${ML_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      code,
      redirect_uri: ML_REDIRECT_URI,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error intercambiando code ML: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  // data: { access_token, token_type, expires_in (21600=6h), refresh_token, scope, user_id }

  await guardarTokens(data)
  return data
}

/**
 * Refresca el access_token usando el refresh_token
 */
async function refreshAccessToken(refreshToken) {
  const resp = await fetch(`${ML_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: ML_APP_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    logger.error(`[ML Auth] Error refreshing token: ${resp.status} ${err}`)
    // Invalidar cache y config
    cachedToken = null
    tokenExpiry = 0
    await supabase.from('ml_config').update({ activo: false }).eq('id', 1)
    throw new Error(`Error refreshing ML token: ${resp.status}`)
  }

  const data = await resp.json()
  await guardarTokens(data)
  return data
}

/**
 * Guarda los tokens en Supabase y en cache
 */
async function guardarTokens(tokenData) {
  const ahora = new Date()
  const expiraEn = new Date(ahora.getTime() + (tokenData.expires_in - 300) * 1000) // 5 min de margen

  cachedToken = tokenData.access_token
  tokenExpiry = expiraEn.getTime()

  const config = {
    id: 1, // singleton
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expiry: expiraEn.toISOString(),
    seller_id: String(tokenData.user_id),
    activo: true,
    updated_at: ahora.toISOString(),
  }

  const { error } = await supabase
    .from('ml_config')
    .upsert(config, { onConflict: 'id' })

  if (error) {
    logger.error({ error }, '[ML Auth] Error guardando tokens en Supabase')
    throw error
  }

  logger.info(`[ML Auth] Tokens guardados. Seller ID: ${tokenData.user_id}. Expira: ${expiraEn.toISOString()}`)
}

/**
 * Obtiene un access_token válido (con auto-refresh si está por expirar)
 */
async function getAccessToken() {
  // Check cache primero
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken
  }

  // Leer de Supabase
  const { data: config, error } = await supabase
    .from('ml_config')
    .select('*')
    .eq('id', 1)
    .single()

  if (error || !config || !config.activo) {
    throw new Error('Mercado Libre no está conectado. Autorizá la cuenta primero.')
  }

  const expiry = new Date(config.token_expiry).getTime()

  // Si el token todavía es válido, cachearlo y devolverlo
  if (Date.now() < expiry) {
    cachedToken = config.access_token
    tokenExpiry = expiry
    return cachedToken
  }

  // Token expirado → refrescar
  logger.info('[ML Auth] Token expirado, refrescando...')
  const newTokens = await refreshAccessToken(config.refresh_token)
  return newTokens.access_token
}

/**
 * Obtiene el seller_id configurado
 */
async function getSellerId() {
  const { data: config } = await supabase
    .from('ml_config')
    .select('seller_id')
    .eq('id', 1)
    .single()

  return config?.seller_id || null
}

/**
 * Verifica si ML está conectado
 */
async function getConnectionStatus() {
  const { data: config } = await supabase
    .from('ml_config')
    .select('activo, seller_id, updated_at, token_expiry')
    .eq('id', 1)
    .single()

  if (!config) return { conectado: false }

  return {
    conectado: config.activo,
    seller_id: config.seller_id,
    ultima_actualizacion: config.updated_at,
    token_expira: config.token_expiry,
  }
}

/**
 * Desconecta la cuenta de ML
 */
async function desconectar() {
  cachedToken = null
  tokenExpiry = 0

  await supabase.from('ml_config').update({
    activo: false,
    access_token: null,
    refresh_token: null,
    updated_at: new Date().toISOString(),
  }).eq('id', 1)

  logger.info('[ML Auth] Cuenta desconectada')
}

/**
 * Hace un request autenticado a la API de ML
 */
async function mlFetch(path, options = {}) {
  const token = await getAccessToken()
  const url = path.startsWith('http') ? path : `${ML_BASE}${path}`

  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  // Si 401, intentar refresh y reintentar una vez
  if (resp.status === 401) {
    logger.warn('[ML API] 401 recibido, intentando refresh...')
    const { data: config } = await supabase.from('ml_config').select('refresh_token').eq('id', 1).single()
    if (config?.refresh_token) {
      await refreshAccessToken(config.refresh_token)
      const newToken = await getAccessToken()
      const retryResp = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })
      return retryResp
    }
  }

  return resp
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  getAccessToken,
  getSellerId,
  getConnectionStatus,
  desconectar,
  mlFetch,
}
