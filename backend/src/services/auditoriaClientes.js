const supabase = require('../config/supabase')
const logger = require('../config/logger')

// Campos que se auditan
const CAMPOS_AUDITABLES = [
  'razon_social', 'cuit', 'condicion_iva', 'direccion', 'localidad',
  'codigo_postal', 'provincia', 'telefono', 'email', 'celular',
  'grupo_descuento_id', 'activo', 'id_centum', 'codigo_centum'
]

/**
 * Calcula los cambios entre dos objetos (solo campos auditables)
 */
function calcularCambios(antes, despues) {
  const cambios = {}
  for (const campo of CAMPOS_AUDITABLES) {
    if (despues[campo] === undefined) continue
    const valorAntes = antes?.[campo] ?? null
    const valorDespues = despues[campo] ?? null
    if (String(valorAntes) !== String(valorDespues)) {
      cambios[campo] = { antes: valorAntes, despues: valorDespues }
    }
  }
  return cambios
}

/**
 * Registra un evento de auditoría para un cliente
 * @param {Object} params
 * @param {string} params.cliente_id - UUID del cliente
 * @param {string} params.accion - tipo de acción
 * @param {string} params.origen - 'admin', 'pos', 'api_sync', 'cron', 'centum_bi'
 * @param {string} [params.usuario] - username del usuario
 * @param {Object} [params.cambios] - cambios calculados { campo: { antes, despues } }
 * @param {string} [params.detalle] - texto libre
 */
async function registrarAuditoria({ cliente_id, accion, origen, usuario, cambios, detalle }) {
  try {
    if (!cliente_id || !accion || !origen) return

    // No registrar si no hay cambios reales (excepto crear/desactivar/etc)
    const accionesSinCambios = ['crear', 'desactivar', 'reactivar', 'resolver_duplicado', 'importar', 'exportar_centum']
    if (!accionesSinCambios.includes(accion) && cambios && Object.keys(cambios).length === 0) return

    await supabase.from('clientes_auditoria').insert({
      cliente_id,
      accion,
      origen,
      usuario: usuario || null,
      cambios: cambios || {},
      detalle: detalle || null,
    })
  } catch (err) {
    logger.warn(`[AuditoriaClientes] Error registrando auditoría: ${err.message}`)
  }
}

/**
 * Obtiene el snapshot actual del cliente para comparar antes de un update
 */
async function obtenerSnapshot(clienteId) {
  const { data } = await supabase
    .from('clientes')
    .select(CAMPOS_AUDITABLES.join(', '))
    .eq('id', clienteId)
    .single()
  return data
}

/**
 * Obtiene snapshot por id_centum
 */
async function obtenerSnapshotPorCentum(idCentum) {
  const { data } = await supabase
    .from('clientes')
    .select('id, ' + CAMPOS_AUDITABLES.join(', '))
    .eq('id_centum', idCentum)
    .single()
  return data
}

module.exports = {
  registrarAuditoria,
  calcularCambios,
  obtenerSnapshot,
  obtenerSnapshotPorCentum,
  CAMPOS_AUDITABLES,
}
