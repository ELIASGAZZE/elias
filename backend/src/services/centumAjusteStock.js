// Servicio para ajustes de stock en Centum ERP (traspasos entre sucursales)
// Fase 1: stub que loguea la operación y permite funcionar sin Centum
const { registrarLlamada } = require('./apiLogger')

/**
 * Ajuste negativo de stock (salida de depósito origen)
 * @param {string} sucursalId - ID sucursal origen
 * @param {Array} items - [{articulo_id, codigo, nombre, cantidad, es_pesable}]
 * @param {string} ordenNumero - Número de orden de traspaso
 * @returns {Promise<{ok: boolean, ajusteId: string|null, error: string|null}>}
 */
async function ajusteStockNegativo(sucursalId, items, ordenNumero) {
  const inicio = Date.now()
  try {
    // STUB: loguear operación para implementar con endpoint real de Centum
    console.log(`[Centum Stub] Ajuste negativo — Sucursal: ${sucursalId}, Orden: ${ordenNumero}, Items: ${items.length}`)

    const ajusteId = `STUB-NEG-${Date.now()}`

    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjusteStockNegativo (STUB)',
      metodo: 'POST',
      request_body: { sucursalId, items, ordenNumero },
      response_body: { ajusteId, stub: true },
      status: 200,
      duracion: Date.now() - inicio,
      exito: true,
    })

    return { ok: true, ajusteId, error: null }
  } catch (err) {
    console.error('[Centum] Error ajuste negativo:', err.message)
    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjusteStockNegativo (STUB)',
      metodo: 'POST',
      request_body: { sucursalId, items, ordenNumero },
      response_body: { error: err.message },
      status: 500,
      duracion: Date.now() - inicio,
      exito: false,
    })
    return { ok: false, ajusteId: null, error: err.message }
  }
}

/**
 * Ajuste positivo de stock (entrada en sucursal destino)
 * @param {string} sucursalId - ID sucursal destino
 * @param {Array} items - [{articulo_id, codigo, nombre, cantidad, es_pesable}]
 * @param {string} ordenNumero - Número de orden de traspaso
 * @returns {Promise<{ok: boolean, ajusteId: string|null, error: string|null}>}
 */
async function ajusteStockPositivo(sucursalId, items, ordenNumero) {
  const inicio = Date.now()
  try {
    console.log(`[Centum Stub] Ajuste positivo — Sucursal: ${sucursalId}, Orden: ${ordenNumero}, Items: ${items.length}`)

    const ajusteId = `STUB-POS-${Date.now()}`

    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjusteStockPositivo (STUB)',
      metodo: 'POST',
      request_body: { sucursalId, items, ordenNumero },
      response_body: { ajusteId, stub: true },
      status: 200,
      duracion: Date.now() - inicio,
      exito: true,
    })

    return { ok: true, ajusteId, error: null }
  } catch (err) {
    console.error('[Centum] Error ajuste positivo:', err.message)
    await registrarLlamada({
      servicio: 'centum',
      endpoint: 'AjusteStockPositivo (STUB)',
      metodo: 'POST',
      request_body: { sucursalId, items, ordenNumero },
      response_body: { error: err.message },
      status: 500,
      duracion: Date.now() - inicio,
      exito: false,
    })
    return { ok: false, ajusteId: null, error: err.message }
  }
}

module.exports = { ajusteStockNegativo, ajusteStockPositivo }
