// Rutas de auditoría por cajero (historial, patrones, comparación)
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const { chatCajas } = require('../services/claude')

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcStd(values, mean) {
  if (values.length < 2) return 0
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1)
  return parseFloat(Math.sqrt(variance).toFixed(2))
}

function calcPercentil(miValor, todosValores) {
  if (todosValores.length === 0) return null
  const menores = todosValores.filter(v => v < miValor).length
  return parseFloat(((menores / todosValores.length) * 100).toFixed(1))
}

// GET /api/cajeros/:empleadoId/historial-auditoria
router.get('/:empleadoId/historial-auditoria', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { empleadoId } = req.params
    const { desde, hasta, limit: limitStr } = req.query
    const limit = Math.min(parseInt(limitStr) || 50, 200)

    // 1. Validar que el empleado existe
    const { data: empleado, error: errorEmp } = await supabase
      .from('empleados')
      .select('id, nombre, sucursal_id, sucursales(id, nombre)')
      .eq('id', empleadoId)
      .single()

    if (errorEmp || !empleado) {
      return res.status(404).json({ error: 'Empleado no encontrado' })
    }

    // 2. Fetch cierres del empleado (no abiertos)
    let query = supabase
      .from('cierres')
      .select('id, planilla_id, caja_id, empleado_id, cajero_id, fecha, estado, created_at, billetes, monedas, total_efectivo, medios_pago, total_general, fondo_fijo, cambio_que_queda, cambio_billetes, fondo_fijo_billetes, efectivo_retirado, caja:cajas(id, nombre)')
      .eq('empleado_id', empleadoId)
      .neq('estado', 'abierta')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (desde) query = query.gte('fecha', desde)
    if (hasta) query = query.lte('fecha', hasta)

    const { data: cierres, error: errorCierres } = await query
    if (errorCierres) throw errorCierres

    if (!cierres || cierres.length === 0) {
      return res.json({
        empleado: { id: empleado.id, nombre: empleado.nombre, sucursal: empleado.sucursales?.nombre || null },
        periodo: { desde: desde || null, hasta: hasta || null, total_cierres: 0 },
        resumen: { total_cierres: 0, cierres_con_diferencia: 0, cierres_sin_diferencia: 0, promedio_diferencia_efectivo: 0, promedio_diferencia_total: 0, max_diferencia: 0, min_diferencia: 0, desviacion_estandar: 0 },
        tendencia: [],
        patrones_denominacion: { billetes_faltantes: {}, billetes_sobrantes: {} },
        estadisticas_medios_pago: [],
        retiros: { total_retiros: 0, promedio_por_cierre: 0, promedio_monto: 0, retiros_con_diferencia: 0, promedio_diferencia: 0 },
        comparacion_sucursal: { cantidad_cajeros: 0, mi_promedio_diferencia: 0, promedio_sucursal: 0, percentil: null, ranking: null, total_cajeros: 0 },
        continuidad_cambio: { veces_con_diferencia_apertura: 0, veces_con_diferencia_cierre: 0, total_cierres_evaluados: 0 },
      })
    }

    // 3. Fetch verificaciones para esos cierres
    const cierreIds = cierres.map(c => c.id)
    const { data: verificaciones } = await supabase
      .from('verificaciones')
      .select('cierre_id, billetes, monedas, total_efectivo, medios_pago, total_general')
      .in('cierre_id', cierreIds)

    const verifMap = {}
    if (verificaciones) verificaciones.forEach(v => { verifMap[v.cierre_id] = v })

    // 4. Fetch retiros + verificaciones_retiros
    const { data: retiros } = await supabase
      .from('retiros')
      .select('id, cierre_id, total')
      .in('cierre_id', cierreIds)

    let retiroVerifMap = {}
    if (retiros && retiros.length > 0) {
      const retiroIds = retiros.map(r => r.id)
      const { data: vRetiros } = await supabase
        .from('verificaciones_retiros')
        .select('retiro_id, total')
        .in('retiro_id', retiroIds)
      if (vRetiros) vRetiros.forEach(v => { retiroVerifMap[v.retiro_id] = v })
    }

    // 5. Calcular agregados
    const diferenciasEfectivo = []
    const diferenciasTotal = []
    const tendencia = []
    const patronesFaltantes = {}
    const patronesSobrantes = {}
    const mediosPagoAcum = {}
    let cierresConDiferencia = 0
    let vecesConDifApertura = 0
    let vecesConDifCierre = 0
    let totalCierresEvaluados = 0

    for (const cierre of cierres) {
      const verif = verifMap[cierre.id]
      let difEfectivo = null
      let difTotal = null
      const tieneVerif = !!verif

      if (verif) {
        difEfectivo = parseFloat(((cierre.total_efectivo || 0) - (verif.total_efectivo || 0)).toFixed(2))
        difTotal = parseFloat(((cierre.total_general || 0) - (verif.total_general || 0)).toFixed(2))
        diferenciasEfectivo.push(difEfectivo)
        diferenciasTotal.push(difTotal)
        if (Math.abs(difTotal) > 0.01) cierresConDiferencia++

        // Patrones por denominación
        const billetesC = cierre.billetes || {}
        const billetesV = verif.billetes || {}
        const todasDenoms = new Set([...Object.keys(billetesC), ...Object.keys(billetesV)])
        for (const denom of todasDenoms) {
          const diff = (parseInt(billetesC[denom]) || 0) - (parseInt(billetesV[denom]) || 0)
          if (diff > 0) {
            if (!patronesSobrantes[denom]) patronesSobrantes[denom] = { veces: 0, total: 0, valores: [] }
            patronesSobrantes[denom].veces++
            patronesSobrantes[denom].total += diff
            patronesSobrantes[denom].valores.push(diff)
          } else if (diff < 0) {
            if (!patronesFaltantes[denom]) patronesFaltantes[denom] = { veces: 0, total: 0, valores: [] }
            patronesFaltantes[denom].veces++
            patronesFaltantes[denom].total += Math.abs(diff)
            patronesFaltantes[denom].valores.push(Math.abs(diff))
          }
        }

        // Estadísticas medios de pago
        const cajeroMedios = cierre.medios_pago || []
        const gestorMedios = verif.medios_pago || []
        const cajeroMap = {}
        cajeroMedios.forEach(mp => { cajeroMap[mp.nombre || mp.forma_cobro] = mp.total || mp.monto || 0 })
        const gestorMap = {}
        gestorMedios.forEach(mp => { gestorMap[mp.nombre || mp.forma_cobro] = mp.total || mp.monto || 0 })
        const todosMP = new Set([...Object.keys(cajeroMap), ...Object.keys(gestorMap)])
        for (const nombre of todosMP) {
          const diff = (cajeroMap[nombre] || 0) - (gestorMap[nombre] || 0)
          if (!mediosPagoAcum[nombre]) mediosPagoAcum[nombre] = { total_reportes: 0, diffs: [] }
          mediosPagoAcum[nombre].total_reportes++
          mediosPagoAcum[nombre].diffs.push(diff)
        }
      }

      tendencia.push({
        fecha: cierre.fecha,
        planilla_id: cierre.planilla_id,
        caja: cierre.caja?.nombre || null,
        estado: cierre.estado,
        diferencia_efectivo: difEfectivo,
        diferencia_total: difTotal,
        tiene_verificacion: tieneVerif,
      })

      // Continuidad de cambio: comparar fondo_fijo_billetes con cambio_billetes del cierre anterior
      // Simplificado: contar diferencias_apertura si existen en el cierre
      if (cierre.fondo_fijo_billetes && Object.keys(cierre.fondo_fijo_billetes).length > 0) {
        totalCierresEvaluados++
      }
    }

    // Evaluar continuidad: buscar cierres anteriores para cada cierre y comparar
    // Buscar diferencias de apertura (fondo vs cambio anterior) y cierre (cambio vs fondo siguiente)
    for (let i = 0; i < cierres.length; i++) {
      const cierre = cierres[i]
      // Cierre más reciente primero, así cierres[i+1] es el anterior
      const anterior = cierres[i + 1]
      if (anterior && anterior.caja_id === cierre.caja_id) {
        const diffs = {}
        const cambioAnt = anterior.cambio_billetes || {}
        const fondoAct = cierre.fondo_fijo_billetes || {}
        const todasD = new Set([...Object.keys(cambioAnt), ...Object.keys(fondoAct)])
        for (const d of todasD) {
          if ((parseInt(cambioAnt[d]) || 0) !== (parseInt(fondoAct[d]) || 0)) {
            diffs[d] = true
          }
        }
        if (Object.keys(diffs).length > 0) vecesConDifApertura++
      }
    }

    // Promedios y estadísticas
    const promDifEf = diferenciasEfectivo.length > 0
      ? parseFloat((diferenciasEfectivo.reduce((s, v) => s + v, 0) / diferenciasEfectivo.length).toFixed(2))
      : 0
    const promDifTot = diferenciasTotal.length > 0
      ? parseFloat((diferenciasTotal.reduce((s, v) => s + v, 0) / diferenciasTotal.length).toFixed(2))
      : 0
    const maxDif = diferenciasTotal.length > 0 ? Math.max(...diferenciasTotal.map(Math.abs)) : 0
    const minDif = diferenciasTotal.length > 0 ? Math.min(...diferenciasTotal.map(Math.abs)) : 0
    const stdDif = calcStd(diferenciasTotal, promDifTot)

    // Formatear patrones
    const formatPatron = (p) => {
      const out = {}
      for (const [denom, data] of Object.entries(p)) {
        out[denom] = {
          veces: data.veces,
          promedio: parseFloat((data.total / data.veces).toFixed(2)),
          total: data.total,
        }
      }
      return out
    }

    // Estadísticas medios de pago
    const estadMedios = Object.entries(mediosPagoAcum).map(([nombre, data]) => {
      const totalDif = data.diffs.reduce((s, v) => s + v, 0)
      const promDif = data.diffs.length > 0 ? totalDif / data.diffs.length : 0
      const maxD = data.diffs.length > 0 ? Math.max(...data.diffs.map(Math.abs)) : 0
      return {
        nombre,
        total_reportes: data.total_reportes,
        promedio_diferencia: parseFloat(promDif.toFixed(2)),
        total_diferencia: parseFloat(totalDif.toFixed(2)),
        max_diferencia: parseFloat(maxD.toFixed(2)),
      }
    })

    // Retiros resumen
    const totalRetiros = retiros ? retiros.length : 0
    const retirosConDif = retiros ? retiros.filter(r => {
      const vr = retiroVerifMap[r.id]
      return vr && Math.abs((r.total || 0) - (vr.total || 0)) > 0.01
    }).length : 0
    const promMontoRetiro = totalRetiros > 0
      ? parseFloat((retiros.reduce((s, r) => s + (r.total || 0), 0) / totalRetiros).toFixed(2))
      : 0
    const difRetiros = retiros ? retiros.filter(r => retiroVerifMap[r.id]).map(r => {
      return Math.abs((r.total || 0) - (retiroVerifMap[r.id].total || 0))
    }) : []
    const promDifRetiro = difRetiros.length > 0
      ? parseFloat((difRetiros.reduce((s, v) => s + v, 0) / difRetiros.length).toFixed(2))
      : 0

    // 6. Comparación con peers de la misma sucursal
    let comparacionSucursal = {
      cantidad_cajeros: 0,
      mi_promedio_diferencia: Math.abs(promDifTot),
      promedio_sucursal: 0,
      percentil: null,
      ranking: null,
      total_cajeros: 0,
    }

    if (empleado.sucursal_id) {
      // Buscar cajas de la misma sucursal
      const { data: cajasSuc } = await supabase
        .from('cajas')
        .select('id')
        .eq('sucursal_id', empleado.sucursal_id)

      if (cajasSuc && cajasSuc.length > 0) {
        const cajaIds = cajasSuc.map(c => c.id)

        // Cierres de peers en misma sucursal, mismo periodo
        let peerQuery = supabase
          .from('cierres')
          .select('id, empleado_id, total_efectivo, total_general')
          .in('caja_id', cajaIds)
          .neq('estado', 'abierta')
          .neq('empleado_id', empleadoId)

        if (desde) peerQuery = peerQuery.gte('fecha', desde)
        if (hasta) peerQuery = peerQuery.lte('fecha', hasta)

        const { data: peerCierres } = await peerQuery

        if (peerCierres && peerCierres.length > 0) {
          // Fetch verificaciones de peers
          const peerCierreIds = peerCierres.map(c => c.id)

          // Batch en chunks de 100 para evitar límites
          const chunks = []
          for (let i = 0; i < peerCierreIds.length; i += 100) {
            chunks.push(peerCierreIds.slice(i, i + 100))
          }
          let peerVerifs = []
          for (const chunk of chunks) {
            const { data } = await supabase
              .from('verificaciones')
              .select('cierre_id, total_general')
              .in('cierre_id', chunk)
            if (data) peerVerifs = peerVerifs.concat(data)
          }
          const peerVerifMap = {}
          peerVerifs.forEach(v => { peerVerifMap[v.cierre_id] = v })

          // Calcular promedios por empleado
          const porEmpleado = {}
          for (const pc of peerCierres) {
            const pv = peerVerifMap[pc.id]
            if (!pv) continue
            if (!porEmpleado[pc.empleado_id]) porEmpleado[pc.empleado_id] = []
            porEmpleado[pc.empleado_id].push(Math.abs((pc.total_general || 0) - (pv.total_general || 0)))
          }

          const promediosPeers = Object.values(porEmpleado).map(diffs => {
            return diffs.reduce((s, v) => s + v, 0) / diffs.length
          })

          const todosPromedios = [...promediosPeers, Math.abs(promDifTot)]
          todosPromedios.sort((a, b) => a - b)

          const miPos = todosPromedios.indexOf(Math.abs(promDifTot)) + 1
          const promSuc = todosPromedios.length > 0
            ? parseFloat((todosPromedios.reduce((s, v) => s + v, 0) / todosPromedios.length).toFixed(2))
            : 0

          comparacionSucursal = {
            cantidad_cajeros: Object.keys(porEmpleado).length + 1,
            mi_promedio_diferencia: Math.abs(promDifTot),
            promedio_sucursal: promSuc,
            percentil: calcPercentil(Math.abs(promDifTot), promediosPeers),
            ranking: miPos,
            total_cajeros: Object.keys(porEmpleado).length + 1,
          }
        }
      }
    }

    // 7. Respuesta
    res.json({
      empleado: { id: empleado.id, nombre: empleado.nombre, sucursal: empleado.sucursales?.nombre || null },
      periodo: { desde: desde || null, hasta: hasta || null, total_cierres: cierres.length },

      resumen: {
        total_cierres: cierres.length,
        cierres_con_diferencia: cierresConDiferencia,
        cierres_sin_diferencia: diferenciasTotal.length - cierresConDiferencia,
        promedio_diferencia_efectivo: promDifEf,
        promedio_diferencia_total: promDifTot,
        max_diferencia: parseFloat(maxDif.toFixed(2)),
        min_diferencia: parseFloat(minDif.toFixed(2)),
        desviacion_estandar: stdDif,
      },

      tendencia,

      patrones_denominacion: {
        billetes_faltantes: formatPatron(patronesFaltantes),
        billetes_sobrantes: formatPatron(patronesSobrantes),
      },

      estadisticas_medios_pago: estadMedios,

      retiros: {
        total_retiros: totalRetiros,
        promedio_por_cierre: cierres.length > 0 ? parseFloat((totalRetiros / cierres.length).toFixed(2)) : 0,
        promedio_monto: promMontoRetiro,
        retiros_con_diferencia: retirosConDif,
        promedio_diferencia: promDifRetiro,
      },

      comparacion_sucursal: comparacionSucursal,

      continuidad_cambio: {
        veces_con_diferencia_apertura: vecesConDifApertura,
        veces_con_diferencia_cierre: vecesConDifCierre,
        total_cierres_evaluados: totalCierresEvaluados,
      },
    })
  } catch (err) {
    console.error('Error en historial de auditoría:', err)
    res.status(500).json({ error: 'Error al generar historial de auditoría' })
  }
})

// POST /api/cajeros/:empleadoId/chat-ia — chat sobre historial de un cajero
router.post('/:empleadoId/chat-ia', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { mensaje, historial } = req.body
    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({ error: 'El mensaje es requerido' })
    }

    // Obtener historial de auditoría como contexto
    const auditoriaUrl = `${req.protocol}://${req.get('host')}/api/cajeros/${req.params.empleadoId}/historial-auditoria`
    const auditoriaRes = await fetch(auditoriaUrl, {
      headers: { authorization: req.headers.authorization },
    })

    let contexto = null
    if (auditoriaRes.ok) {
      contexto = await auditoriaRes.json()
    }

    const respuesta = await chatCajas(mensaje.trim(), historial || [], contexto)
    res.json({ respuesta })
  } catch (err) {
    console.error('Error en chat IA cajero:', err)
    res.status(500).json({ error: err.message || 'Error al procesar mensaje' })
  }
})

module.exports = router
