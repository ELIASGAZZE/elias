// Servicio de integración con Talo (pagos crypto/stablecoin)
const TALO_BASE = 'https://api.talo.com.ar'
const TALO_USER_ID = process.env.TALO_USER_ID
const TALO_CLIENT_ID = process.env.TALO_CLIENT_ID
const TALO_CLIENT_SECRET = process.env.TALO_CLIENT_SECRET

let cachedToken = null
let tokenExpiry = 0

async function obtenerToken() {
  // Reusar token si no expiró (margen de 60s)
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken

  const resp = await fetch(`${TALO_BASE}/users/${TALO_USER_ID}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: TALO_CLIENT_ID,
      client_secret: TALO_CLIENT_SECRET,
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error obteniendo token Talo: ${resp.status} ${err}`)
  }
  const data = await resp.json()
  cachedToken = data.data?.token || data.token
  // JWT: expirar en 50 min (asumimos 1h de vida)
  tokenExpiry = Date.now() + 50 * 60 * 1000
  return cachedToken
}

async function crearPagoTalo({ idPedido, titulo, monto, webhookUrl, redirectUrl }) {
  const resp = await fetch(`${TALO_BASE}/payments/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price: { currency: 'ARS', amount: monto },
      user_id: TALO_USER_ID,
      payment_options: ['transfer'],
      redirect_url: redirectUrl,
      external_id: `${idPedido}_${Date.now()}`,
      webhook_url: webhookUrl,
      motive: titulo,
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error creando pago Talo: ${resp.status} ${err}`)
  }
  const result = await resp.json()
  // result.data contiene el pago creado con payment_url
  return result.data || result
}

async function obtenerPagoTalo(paymentId) {
  const token = await obtenerToken()
  const resp = await fetch(`${TALO_BASE}/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Error consultando pago Talo: ${resp.status} ${err}`)
  }
  const result = await resp.json()
  return result.data || result
}

module.exports = { crearPagoTalo, obtenerPagoTalo, obtenerToken }
