// Servicio de logging para llamadas a APIs externas
const supabase = require('../config/supabase')

/**
 * Registra una llamada a API externa en la tabla api_logs.
 * Fire-and-forget: no lanza errores para no interrumpir el flujo principal.
 *
 * @param {Object} datos
 * @param {string} datos.servicio - ej: 'centum_articulos', 'centum_stock'
 * @param {string} datos.endpoint - URL llamada
 * @param {string} datos.metodo - 'GET', 'POST'
 * @param {string} datos.estado - 'ok', 'error'
 * @param {number} [datos.status_code]
 * @param {number} [datos.duracion_ms]
 * @param {number} [datos.items_procesados]
 * @param {string} [datos.error_mensaje]
 * @param {string} [datos.origen] - 'cron', 'manual'
 */
async function registrarLlamada(datos) {
  try {
    await supabase.from('api_logs').insert({
      servicio: datos.servicio,
      endpoint: datos.endpoint,
      metodo: datos.metodo,
      estado: datos.estado,
      status_code: datos.status_code || null,
      duracion_ms: datos.duracion_ms || null,
      items_procesados: datos.items_procesados || null,
      error_mensaje: datos.error_mensaje || null,
      origen: datos.origen || 'cron',
    })
  } catch (err) {
    console.error('[apiLogger] Error al registrar llamada:', err.message)
  }
}

module.exports = { registrarLlamada }
