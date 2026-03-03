// Servicio de detección de patrones y análisis batch de cierres
const supabase = require('../config/supabase')
const { analizarCierreIA } = require('./claude')

/**
 * Analiza todos los cierres de una fecha (batch)
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @param {string|null} sucursalId - UUID de sucursal (null = todas)
 * @param {string|null} perfilId - UUID del perfil que inicia el batch
 * @returns {object} Resultado del batch
 */
async function analizarBatch(fecha, sucursalId = null, perfilId = null) {
  // 1. Crear registro de batch
  const { data: batch, error: errorBatch } = await supabase
    .from('batch_analisis')
    .insert({
      fecha,
      sucursal_id: sucursalId || null,
      estado: 'procesando',
      iniciado_por: perfilId || null,
    })
    .select()
    .single()

  if (errorBatch) throw errorBatch

  try {
    // 2. Buscar cierres del día
    let query = supabase
      .from('cierres')
      .select('id, planilla_id, caja_id, empleado_id, cajero_id, fecha, estado, total_efectivo, total_general, caja:cajas(id, nombre, sucursal_id, sucursales(id, nombre)), empleado:empleados!empleado_id(id, nombre), cajero:perfiles!cajero_id(id, nombre)')
      .eq('fecha', fecha)
      .neq('estado', 'abierta')
      .order('created_at', { ascending: true })

    if (sucursalId) {
      // Filtrar por sucursal via caja
      const { data: cajas } = await supabase
        .from('cajas')
        .select('id')
        .eq('sucursal_id', sucursalId)
      if (cajas && cajas.length > 0) {
        query = query.in('caja_id', cajas.map(c => c.id))
      }
    }

    const { data: cierres, error: errorCierres } = await query
    if (errorCierres) throw errorCierres

    if (!cierres || cierres.length === 0) {
      await supabase.from('batch_analisis').update({
        estado: 'completado',
        total_cierres: 0,
        analizados: 0,
        completado_at: new Date().toISOString(),
        resumen: 'No se encontraron cierres para esta fecha.',
      }).eq('id', batch.id)

      return { batch_id: batch.id, total: 0, analizados: 0, resultados: [] }
    }

    // 3. Fetch verificaciones
    const cierreIds = cierres.map(c => c.id)
    const { data: verificaciones } = await supabase
      .from('verificaciones')
      .select('cierre_id, total_efectivo, total_general')
      .in('cierre_id', cierreIds)

    const verifMap = {}
    if (verificaciones) verificaciones.forEach(v => { verifMap[v.cierre_id] = v })

    // 4. Buscar análisis cacheados
    const { data: analisisPrevios } = await supabase
      .from('analisis_ia')
      .select('cierre_id, puntaje, nivel_riesgo, resumen')
      .in('cierre_id', cierreIds)

    const analisisMap = {}
    if (analisisPrevios) analisisPrevios.forEach(a => { analisisMap[a.cierre_id] = a })

    // 5. Armar resumen por cierre (sin re-analizar los ya cacheados)
    const resultados = []
    let puntajeTotal = 0
    let conDiferencia = 0
    let analizados = 0

    for (const cierre of cierres) {
      const verif = verifMap[cierre.id]
      const difEfectivo = verif ? parseFloat(((cierre.total_efectivo || 0) - (verif.total_efectivo || 0)).toFixed(2)) : null
      const difTotal = verif ? parseFloat(((cierre.total_general || 0) - (verif.total_general || 0)).toFixed(2)) : null

      if (difTotal !== null && Math.abs(difTotal) > 0.01) conDiferencia++

      const analisisCacheado = analisisMap[cierre.id]

      resultados.push({
        cierre_id: cierre.id,
        planilla_id: cierre.planilla_id,
        caja: cierre.caja?.nombre || null,
        sucursal: cierre.caja?.sucursales?.nombre || null,
        empleado: cierre.empleado?.nombre || null,
        cajero: cierre.cajero?.nombre || null,
        estado: cierre.estado,
        diferencia_efectivo: difEfectivo,
        diferencia_total: difTotal,
        puntaje: analisisCacheado?.puntaje || null,
        nivel_riesgo: analisisCacheado?.nivel_riesgo || null,
        resumen_ia: analisisCacheado?.resumen || null,
      })

      if (analisisCacheado) {
        puntajeTotal += analisisCacheado.puntaje
        analizados++
      }
    }

    const puntajePromedio = analizados > 0 ? parseFloat((puntajeTotal / analizados).toFixed(2)) : null

    // 6. Detectar patrones en resoluciones del período
    const patrones = await detectarPatrones(fecha, sucursalId)

    // 7. Generar resumen
    const resumen = `${cierres.length} cierres, ${conDiferencia} con diferencia, ${analizados} analizados por IA. Puntaje promedio: ${puntajePromedio || 'N/A'}.`

    // 8. Actualizar batch
    await supabase.from('batch_analisis').update({
      estado: 'completado',
      total_cierres: cierres.length,
      analizados,
      con_diferencia: conDiferencia,
      puntaje_promedio: puntajePromedio,
      resumen,
      patrones,
      completado_at: new Date().toISOString(),
    }).eq('id', batch.id)

    return {
      batch_id: batch.id,
      fecha,
      total: cierres.length,
      analizados,
      con_diferencia: conDiferencia,
      puntaje_promedio: puntajePromedio,
      patrones,
      resultados,
    }
  } catch (err) {
    console.error('Error en batch:', err)
    await supabase.from('batch_analisis').update({
      estado: 'error',
      error_mensaje: err.message,
      completado_at: new Date().toISOString(),
    }).eq('id', batch.id)
    throw err
  }
}

/**
 * Detecta patrones recurrentes en resoluciones de diferencias
 * @param {string} fecha - Fecha o período
 * @param {string|null} sucursalId
 * @returns {Array} Patrones detectados
 */
async function detectarPatrones(fecha, sucursalId = null) {
  try {
    // Buscar resoluciones del último mes
    const hace30dias = new Date()
    hace30dias.setDate(hace30dias.getDate() - 30)

    let query = supabase
      .from('resoluciones_diferencias')
      .select('tipo_diferencia, causa, monto_diferencia, cajero_id, sucursal_id, planilla_id')
      .gte('created_at', hace30dias.toISOString())

    if (sucursalId) query = query.eq('sucursal_id', sucursalId)

    const { data: resoluciones } = await query
    if (!resoluciones || resoluciones.length < 3) return []

    // Agrupar por causa + tipo para encontrar recurrencias
    const grupos = {}
    for (const r of resoluciones) {
      const key = `${r.tipo_diferencia}|${r.causa}`
      if (!grupos[key]) grupos[key] = { tipo: r.tipo_diferencia, causa: r.causa, veces: 0, montos: [], cajeros: new Set() }
      grupos[key].veces++
      grupos[key].montos.push(Math.abs(parseFloat(r.monto_diferencia) || 0))
      if (r.cajero_id) grupos[key].cajeros.add(r.cajero_id)
    }

    // Filtrar patrones significativos (3+ ocurrencias)
    const patrones = Object.values(grupos)
      .filter(g => g.veces >= 3)
      .map(g => ({
        tipo: g.tipo,
        causa: g.causa,
        ocurrencias: g.veces,
        monto_promedio: parseFloat((g.montos.reduce((s, v) => s + v, 0) / g.montos.length).toFixed(2)),
        cajeros_afectados: g.cajeros.size,
        confianza: Math.min(g.veces / 10, 1.0), // Más ocurrencias = más confianza
        sugerencia: g.veces >= 5
          ? `Se detectó un patrón recurrente: ${g.causa.replace(/_/g, ' ')} en ${g.tipo} (${g.veces} veces). Considerar revisar el proceso.`
          : null,
      }))
      .sort((a, b) => b.ocurrencias - a.ocurrencias)

    return patrones
  } catch (err) {
    console.error('Error detectando patrones:', err)
    return []
  }
}

module.exports = { analizarBatch, detectarPatrones }
