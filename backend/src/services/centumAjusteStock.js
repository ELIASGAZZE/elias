// Servicio para ajustes de stock en Centum ERP (traspasos entre sucursales)
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')
const logger = require('../config/logger')
const { createClient } = require('@supabase/supabase-js')
const { fetchWithTimeout } = require('../utils/fetchWithTimeout')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'
const CONCEPTO_VARIOS_TRASPASO = parseInt(process.env.CENTUM_CONCEPTO_VARIOS_TRASPASO || '42')

function getHeaders(operadorMovilUser) {
  const headers = {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
  if (operadorMovilUser) {
    headers['CentumSuiteOperadorMovilUser'] = operadorMovilUser
  }
  return headers
}

/**
 * Ajuste negativo de stock en Centum (baja por traspaso saliente)
 * Se llama al confirmar la preparación de una orden de traspaso.
 * Usa cantidades NEGATIVAS para decrementar stock en la sucursal origen.
 *
 * @param {Object} params
 * @param {string} params.ordenId - UUID de la orden de traspaso
 * @param {number} params.centumSucursalId - IdSucursalFisica en Centum
 * @param {Array} params.items - [{articulo_id, codigo, nombre, cantidad, es_pesable}]
 * @param {string} params.ordenNumero - Número de orden (ej: OT-000003)
 * @param {string} params.operadorMovilUser - Operador Centum de la sucursal (ej: APIPAE)
 * @returns {Promise<{ok: boolean, ajusteId: number|null, error: string|null}>}
 */
async function ajusteStockNegativo({ ordenId, centumSucursalId, items, ordenNumero, operadorMovilUser }) {
  const inicio = Date.now()

  // ── Anti-duplicación: verificar si ya se hizo el ajuste ──
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('centum_ajuste_origen_id')
      .eq('id', ordenId)
      .single()

    if (orden?.centum_ajuste_origen_id && !orden.centum_ajuste_origen_id.startsWith('STUB-')) {
      logger.info(`[Centum Stock] Ajuste negativo ya existe para orden ${ordenNumero}: ${orden.centum_ajuste_origen_id}`)
      return { ok: true, ajusteId: orden.centum_ajuste_origen_id, error: null, duplicado: true }
    }
  } catch (checkErr) {
    logger.warn(`[Centum Stock] No se pudo verificar duplicación para ${ordenNumero}:`, checkErr.message)
    // Continuar — preferimos arriesgar un intento que fallar silenciosamente
  }

  // ── Filtrar items válidos (que tengan articulo_id numérico) ──
  const itemsValidos = items.filter(it => it.articulo_id && !isNaN(parseInt(it.articulo_id)) && parseFloat(it.cantidad) > 0)

  if (itemsValidos.length === 0) {
    const msg = `No hay items válidos para ajustar stock en orden ${ordenNumero}`
    logger.warn(`[Centum Stock] ${msg}`)
    return { ok: false, ajusteId: null, error: msg }
  }

  // ── Construir body del ajuste ──
  const body = {
    FechaImputacion: new Date().toISOString(),
    ConceptoVarios: { IdConceptoVarios: CONCEPTO_VARIOS_TRASPASO },
    SucursalFisica: { IdSucursalFisica: centumSucursalId },
    AjusteMovimientoStockItems: itemsValidos.map((it, idx) => ({
      IdAjusteMovimientoStockItem: idx + 1,
      Articulo: { IdArticulo: parseInt(it.articulo_id) },
      Cantidad: -Math.abs(parseFloat(it.cantidad)),  // Negativo = baja de stock
      Existencias: 0,
      CostoReposicion: 0,
      SegundoControlStock: 0,
      ExistenciasSegundoControlStock: 0,
      NumeroLote: '',
      FechaVencimiento: '0001-01-01T00:00:00',
      Observacion: `Traspaso ${ordenNumero}`,
    })),
  }

  const url = `${BASE_URL}/AjustesMovimientoStock?bAjustePrevioACero=false`

  try {
    logger.info(`[Centum Stock] Ajuste negativo — Sucursal: ${centumSucursalId}, Operador: ${operadorMovilUser}, Orden: ${ordenNumero}, Items: ${itemsValidos.length}`)

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders(operadorMovilUser),
      body: JSON.stringify(body),
    }, 30000)

    const responseText = await response.text()
    let responseData
    try { responseData = JSON.parse(responseText) } catch { responseData = responseText }

    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjustesMovimientoStock (negativo)',
      metodo: 'POST',
      request_body: { url, body, ordenNumero },
      response_body: responseData,
      status: response.status,
      duracion: Date.now() - inicio,
      exito: response.status === 201 || response.status === 200,
    })

    if (response.status === 201 || response.status === 200) {
      const ajusteId = responseData?.IdAjusteMovimientoStock || null
      logger.info(`[Centum Stock] Ajuste negativo creado OK — ID: ${ajusteId}, Orden: ${ordenNumero}`)
      return { ok: true, ajusteId: ajusteId ? String(ajusteId) : `HTTP${response.status}-${Date.now()}`, error: null }
    }

    // Error de Centum
    const errorMsg = responseData?.Message || responseData?.ExceptionMessage || JSON.stringify(responseData)
    logger.error(`[Centum Stock] Error ajuste negativo HTTP ${response.status} — Orden: ${ordenNumero}: ${errorMsg}`)
    return { ok: false, ajusteId: null, error: `HTTP ${response.status}: ${errorMsg}` }

  } catch (err) {
    logger.error(`[Centum Stock] Excepción ajuste negativo — Orden: ${ordenNumero}:`, err.message)

    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjustesMovimientoStock (negativo)',
      metodo: 'POST',
      request_body: { url, body, ordenNumero },
      response_body: { error: err.message },
      status: 0,
      duracion: Date.now() - inicio,
      exito: false,
    })

    return { ok: false, ajusteId: null, error: err.message }
  }
}

/**
 * Ajuste positivo de stock en Centum (alta por traspaso entrante)
 * Se llama al confirmar la recepción de una orden de traspaso.
 * Usa cantidades POSITIVAS para incrementar stock en la sucursal destino.
 *
 * @param {Object} params
 * @param {string} params.ordenId - UUID de la orden de traspaso
 * @param {number} params.centumSucursalId - IdSucursalFisica en Centum (destino)
 * @param {Array} params.items - [{articulo_id, codigo, nombre, cantidad, es_pesable}]
 * @param {string} params.ordenNumero - Número de orden (ej: OT-000003)
 * @param {string} params.operadorMovilUser - Operador Centum de la sucursal destino (ej: APICE)
 * @returns {Promise<{ok: boolean, ajusteId: number|null, error: string|null}>}
 */
async function ajusteStockPositivo({ ordenId, centumSucursalId, items, ordenNumero, operadorMovilUser }) {
  const inicio = Date.now()

  // ── Anti-duplicación: verificar si ya se hizo el ajuste ──
  try {
    const { data: orden } = await supabase
      .from('ordenes_traspaso')
      .select('centum_ajuste_destino_id')
      .eq('id', ordenId)
      .single()

    if (orden?.centum_ajuste_destino_id && !orden.centum_ajuste_destino_id.startsWith('STUB-')) {
      logger.info(`[Centum Stock] Ajuste positivo ya existe para orden ${ordenNumero}: ${orden.centum_ajuste_destino_id}`)
      return { ok: true, ajusteId: orden.centum_ajuste_destino_id, error: null, duplicado: true }
    }
  } catch (checkErr) {
    logger.warn(`[Centum Stock] No se pudo verificar duplicación positivo para ${ordenNumero}:`, checkErr.message)
  }

  // ── Filtrar items válidos (que tengan articulo_id numérico) ──
  const itemsValidos = items.filter(it => it.articulo_id && !isNaN(parseInt(it.articulo_id)) && parseFloat(it.cantidad) > 0)

  if (itemsValidos.length === 0) {
    const msg = `No hay items válidos para ajustar stock en orden ${ordenNumero}`
    logger.warn(`[Centum Stock] ${msg}`)
    return { ok: false, ajusteId: null, error: msg }
  }

  // ── Construir body del ajuste ──
  const body = {
    FechaImputacion: new Date().toISOString(),
    ConceptoVarios: { IdConceptoVarios: CONCEPTO_VARIOS_TRASPASO },
    SucursalFisica: { IdSucursalFisica: centumSucursalId },
    AjusteMovimientoStockItems: itemsValidos.map((it, idx) => ({
      IdAjusteMovimientoStockItem: idx + 1,
      Articulo: { IdArticulo: parseInt(it.articulo_id) },
      Cantidad: Math.abs(parseFloat(it.cantidad)),  // Positivo = alta de stock
      Existencias: 0,
      CostoReposicion: 0,
      SegundoControlStock: 0,
      ExistenciasSegundoControlStock: 0,
      NumeroLote: '',
      FechaVencimiento: '0001-01-01T00:00:00',
      Observacion: `Traspaso ${ordenNumero}`,
    })),
  }

  const url = `${BASE_URL}/AjustesMovimientoStock?bAjustePrevioACero=false`

  try {
    logger.info(`[Centum Stock] Ajuste positivo — Sucursal: ${centumSucursalId}, Operador: ${operadorMovilUser}, Orden: ${ordenNumero}, Items: ${itemsValidos.length}`)

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: getHeaders(operadorMovilUser),
      body: JSON.stringify(body),
    }, 30000)

    const responseText = await response.text()
    let responseData
    try { responseData = JSON.parse(responseText) } catch { responseData = responseText }

    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjustesMovimientoStock (positivo)',
      metodo: 'POST',
      request_body: { url, body, ordenNumero },
      response_body: responseData,
      status: response.status,
      duracion: Date.now() - inicio,
      exito: response.status === 201 || response.status === 200,
    })

    if (response.status === 201 || response.status === 200) {
      const ajusteId = responseData?.IdAjusteMovimientoStock || null
      logger.info(`[Centum Stock] Ajuste positivo creado OK — ID: ${ajusteId}, Orden: ${ordenNumero}`)
      return { ok: true, ajusteId: ajusteId ? String(ajusteId) : `HTTP${response.status}-${Date.now()}`, error: null }
    }

    // Error de Centum
    const errorMsg = responseData?.Message || responseData?.ExceptionMessage || JSON.stringify(responseData)
    logger.error(`[Centum Stock] Error ajuste positivo HTTP ${response.status} — Orden: ${ordenNumero}: ${errorMsg}`)
    return { ok: false, ajusteId: null, error: `HTTP ${response.status}: ${errorMsg}` }

  } catch (err) {
    logger.error(`[Centum Stock] Excepción ajuste positivo — Orden: ${ordenNumero}:`, err.message)

    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjustesMovimientoStock (positivo)',
      metodo: 'POST',
      request_body: { url, body, ordenNumero },
      response_body: { error: err.message },
      status: 0,
      duracion: Date.now() - inicio,
      exito: false,
    })

    return { ok: false, ajusteId: null, error: err.message }
  }
}

module.exports = { ajusteStockNegativo, ajusteStockPositivo }
