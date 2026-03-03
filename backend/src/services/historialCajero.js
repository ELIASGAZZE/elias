// Servicio de historial de cajero — extraído de cajeros.js para reutilizar en IA
const supabase = require('../config/supabase')

/**
 * Obtiene estadísticas resumidas de un cajero para alimentar el contexto de la IA
 * @param {string} empleadoId - UUID del empleado
 * @param {number} limitCierres - Cantidad máxima de cierres a analizar
 * @returns {object} Estadísticas resumidas
 */
async function getEstadisticasCajero(empleadoId, limitCierres = 30) {
  // Fetch cierres recientes del cajero
  const { data: cierres } = await supabase
    .from('cierres')
    .select('id, planilla_id, fecha, total_efectivo, total_general, medios_pago')
    .eq('empleado_id', empleadoId)
    .neq('estado', 'abierta')
    .order('created_at', { ascending: false })
    .limit(limitCierres)

  if (!cierres || cierres.length === 0) {
    return { total_cierres: 0, promedio_diferencia_efectivo: 0, promedio_diferencia_total: 0, patrones: [] }
  }

  // Fetch verificaciones
  const cierreIds = cierres.map(c => c.id)
  const { data: verificaciones } = await supabase
    .from('verificaciones')
    .select('cierre_id, total_efectivo, total_general, medios_pago')
    .in('cierre_id', cierreIds)

  const verifMap = {}
  if (verificaciones) verificaciones.forEach(v => { verifMap[v.cierre_id] = v })

  const diferenciasEfectivo = []
  const diferenciasTotal = []
  const mediosPagoPatrones = {}

  for (const cierre of cierres) {
    const verif = verifMap[cierre.id]
    if (!verif) continue

    diferenciasEfectivo.push(parseFloat(((cierre.total_efectivo || 0) - (verif.total_efectivo || 0)).toFixed(2)))
    diferenciasTotal.push(parseFloat(((cierre.total_general || 0) - (verif.total_general || 0)).toFixed(2)))

    // Patrones por medio de pago
    const cajeroMedios = cierre.medios_pago || []
    const gestorMedios = verif.medios_pago || []
    const cajeroMap = {}
    cajeroMedios.forEach(mp => { cajeroMap[mp.nombre || mp.forma_cobro] = mp.total || mp.monto || 0 })
    const gestorMap = {}
    gestorMedios.forEach(mp => { gestorMap[mp.nombre || mp.forma_cobro] = mp.total || mp.monto || 0 })
    const todosMP = new Set([...Object.keys(cajeroMap), ...Object.keys(gestorMap)])
    for (const nombre of todosMP) {
      const diff = (cajeroMap[nombre] || 0) - (gestorMap[nombre] || 0)
      if (Math.abs(diff) > 0.01) {
        if (!mediosPagoPatrones[nombre]) mediosPagoPatrones[nombre] = { diffs: [], veces: 0 }
        mediosPagoPatrones[nombre].diffs.push(diff)
        mediosPagoPatrones[nombre].veces++
      }
    }
  }

  const promDifEf = diferenciasEfectivo.length > 0
    ? parseFloat((diferenciasEfectivo.reduce((s, v) => s + v, 0) / diferenciasEfectivo.length).toFixed(2))
    : 0
  const promDifTot = diferenciasTotal.length > 0
    ? parseFloat((diferenciasTotal.reduce((s, v) => s + v, 0) / diferenciasTotal.length).toFixed(2))
    : 0

  const patrones = Object.entries(mediosPagoPatrones).map(([nombre, data]) => ({
    medio: nombre,
    veces_con_diferencia: data.veces,
    promedio_diferencia: parseFloat((data.diffs.reduce((s, v) => s + v, 0) / data.diffs.length).toFixed(2)),
  })).filter(p => p.veces_con_diferencia >= 2)

  return {
    total_cierres: cierres.length,
    cierres_verificados: Object.keys(verifMap).length,
    promedio_diferencia_efectivo: promDifEf,
    promedio_diferencia_total: promDifTot,
    patrones,
  }
}

/**
 * Obtiene resoluciones previas similares para contexto de la IA
 * @param {object} params - { cajero_id, sucursal_id, tipo_diferencia, monto }
 * @returns {Array} Resoluciones similares ordenadas por relevancia
 */
async function getResolucionesSimilares({ cajero_id, sucursal_id, tipo_diferencia, monto }) {
  let query = supabase
    .from('resoluciones_diferencias')
    .select('tipo_diferencia, causa, monto_diferencia, descripcion, planilla_id, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (tipo_diferencia) query = query.eq('tipo_diferencia', tipo_diferencia)

  const { data } = await query
  if (!data || data.length === 0) return []

  // Puntuar por relevancia
  const scored = data.map(r => {
    let score = 0
    if (cajero_id && r.cajero_id === cajero_id) score += 3
    if (sucursal_id && r.sucursal_id === sucursal_id) score += 2
    if (monto && Math.abs(Math.abs(parseFloat(r.monto_diferencia)) - Math.abs(monto)) < 5000) score += 1
    return { ...r, score }
  })

  return scored
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score, ...r }) => r)
}

/**
 * Obtiene resoluciones ya creadas para un cierre específico
 * @param {string} cierreId - UUID del cierre
 * @returns {Array} Resoluciones del cierre
 */
async function getResolucionesCierre(cierreId) {
  const { data } = await supabase
    .from('resoluciones_diferencias')
    .select('tipo_diferencia, causa, monto_diferencia, descripcion')
    .eq('cierre_id', cierreId)

  return data || []
}

module.exports = { getEstadisticasCajero, getResolucionesSimilares, getResolucionesCierre }
