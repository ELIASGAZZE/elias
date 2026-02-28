// Rutas de cierres de caja y verificaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const { getPlanillaData, validarPlanilla, getVentasSinConfirmar, getComprobantesData } = require('../config/centum')
const { analizarCierre: analizarCierreIA, chatCajas } = require('../services/claude')

const SELECT_CIERRE = '*, caja:cajas(id, nombre, sucursal_id, sucursales(id, nombre)), empleado:empleados!empleado_id(id, nombre), cajero:perfiles!cajero_id(id, nombre, username, sucursal_id), cerrado_por:empleados!cerrado_por_empleado_id(id, nombre)'

// ── Helpers de auditoría ─────────────────────────────────────────────────────

function sumarJsonb(jsonb) {
  if (!jsonb || typeof jsonb !== 'object') return 0
  return Object.entries(jsonb).reduce((sum, [denom, cant]) => sum + (parseFloat(denom) * (parseInt(cant) || 0)), 0)
}

function calcularEfectivoNeto(datos, cierreBase) {
  const totalEfectivo = datos.total_efectivo || 0
  const cambioQueQueda = cierreBase.cambio_que_queda || 0
  const fondoFijo = cierreBase.fondo_fijo || 0
  return parseFloat((totalEfectivo + cambioQueQueda - fondoFijo).toFixed(2))
}

function calcularDiferenciasDenominacion(a, b) {
  if (!a || !b) return null
  const todas = new Set([...Object.keys(a), ...Object.keys(b)])
  const resultado = {}
  for (const denom of todas) {
    const valA = parseInt(a[denom]) || 0
    const valB = parseInt(b[denom]) || 0
    if (valA !== valB) {
      resultado[denom] = { a: valA, b: valB, diferencia: valA - valB }
    }
  }
  return Object.keys(resultado).length > 0 ? resultado : null
}

function calcularDiferenciasMediosPago(cajeroMedios, otroMedios) {
  if (!cajeroMedios || !otroMedios) return []
  const cajeroMap = {}
  ;(cajeroMedios || []).forEach(mp => { cajeroMap[mp.nombre || mp.forma_cobro] = mp.total || mp.monto || 0 })
  const otroMap = {}
  ;(otroMedios || []).forEach(mp => { otroMap[mp.nombre || mp.forma_cobro] = mp.total || mp.monto || 0 })
  const todas = new Set([...Object.keys(cajeroMap), ...Object.keys(otroMap)])
  const diffs = []
  for (const nombre of todas) {
    const a = cajeroMap[nombre] || 0
    const b = otroMap[nombre] || 0
    if (Math.abs(a - b) > 0.01) {
      diffs.push({ nombre, cajero: a, otro: b, diferencia: parseFloat((a - b).toFixed(2)) })
    }
  }
  return diffs
}

function construirContinuidadCambio(cierre, cierreAnterior, aperturaSiguiente) {
  const resultado = {
    cierre_anterior: { existe: false },
    apertura_actual: { fondo_fijo_billetes: cierre.fondo_fijo_billetes || {}, coincide: null, diferencias: null },
    cambio_dejado: { billetes: cierre.cambio_billetes || {}, total: cierre.cambio_que_queda || 0 },
    apertura_siguiente: { existe: false },
  }

  if (cierreAnterior) {
    resultado.cierre_anterior = {
      existe: true,
      planilla_id: cierreAnterior.planilla_id,
      cambio_billetes: cierreAnterior.cambio_billetes || {},
    }
    const diffs = calcularDiferenciasDenominacion(
      cierreAnterior.cambio_billetes || {},
      cierre.fondo_fijo_billetes || {}
    )
    resultado.apertura_actual.coincide = !diffs
    resultado.apertura_actual.diferencias = diffs
  }

  if (aperturaSiguiente) {
    resultado.apertura_siguiente = {
      existe: true,
      planilla_id: aperturaSiguiente.planilla_id,
      fondo_fijo_billetes: aperturaSiguiente.fondo_fijo_billetes || {},
    }
    const diffs = calcularDiferenciasDenominacion(
      cierre.cambio_billetes || {},
      aperturaSiguiente.fondo_fijo_billetes || {}
    )
    resultado.apertura_siguiente.coincide = !diffs
    resultado.apertura_siguiente.diferencias = diffs
  }

  return resultado
}

// ── Rutas ────────────────────────────────────────────────────────────────────

// GET /api/cierres — lista cierres con filtros
router.get('/', verificarAuth, async (req, res) => {
  try {
    let query = supabase
      .from('cierres')
      .select(SELECT_CIERRE)
      .order('created_at', { ascending: false })

    const { rol, sucursal_id } = req.perfil

    if (rol === 'operario') {
      query = query.eq('cajero_id', req.perfil.id)
    }
    // Gestor y admin: filtramos después por sucursal de la caja

    if (req.query.fecha) {
      query = query.eq('fecha', req.query.fecha)
    }
    if (req.query.estado) {
      query = query.eq('estado', req.query.estado)
    }
    if (req.query.caja_id) {
      query = query.eq('caja_id', req.query.caja_id)
    }

    const { data, error } = await query
    if (error) throw error

    // Gestor: filtrar solo cierres de cajas de su sucursal
    let filtered = data
    if (rol === 'gestor') {
      filtered = data.filter(c => c.caja?.sucursal_id === sucursal_id)
    }

    res.json(filtered)
  } catch (err) {
    console.error('Error al obtener cierres:', err)
    res.status(500).json({ error: 'Error al obtener cierres' })
  }
})

// GET /api/cierres/ultimo-cambio?caja_id=X — último cambio dejado en caja
router.get('/ultimo-cambio', verificarAuth, async (req, res) => {
  const { caja_id } = req.query
  if (!caja_id) {
    return res.status(400).json({ error: 'caja_id es requerido' })
  }

  try {
    const { data, error } = await supabase
      .from('cierres')
      .select('cambio_billetes, cambio_monedas')
      .eq('caja_id', caja_id)
      .neq('estado', 'abierta')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      return res.json({ cambio_billetes: {}, cambio_monedas: {} })
    }

    res.json({
      cambio_billetes: data.cambio_billetes || {},
      cambio_monedas: data.cambio_monedas || {},
    })
  } catch (err) {
    console.error('Error al obtener último cambio:', err)
    res.json({ cambio_billetes: {}, cambio_monedas: {} })
  }
})

// GET /api/cierres/validar-planilla/:planillaId?caja_id=X — valida planilla en Centum y cruce con caja/sucursal
router.get('/validar-planilla/:planillaId', verificarAuth, async (req, res) => {
  const planillaNum = parseInt(req.params.planillaId)
  if (isNaN(planillaNum)) {
    return res.status(400).json({ error: 'El ID de planilla debe ser un número' })
  }

  try {
    const planilla = await validarPlanilla(planillaNum)
    if (!planilla.existe) {
      return res.status(404).json({ error: 'La planilla no existe en Centum' })
    }
    if (planilla.cerrada) {
      return res.status(400).json({ error: 'La planilla ya está cerrada en Centum.', nombre: planilla.nombre })
    }

    // Validar cruce con caja/sucursal si se envió caja_id
    const { caja_id } = req.query
    if (caja_id) {
      const { data: caja } = await supabase
        .from('cajas')
        .select('id, nombre, centum_usuario_id, sucursal_id, sucursales(id, nombre, centum_sucursal_id)')
        .eq('id', caja_id)
        .single()

      if (caja) {
        // Validar sucursal
        const centumSucId = caja.sucursales?.centum_sucursal_id
        if (centumSucId && centumSucId !== planilla.centum_sucursal_id) {
          return res.status(400).json({
            error: `La planilla pertenece a ${planilla.nombre_sucursal}, no a ${caja.sucursales.nombre}`,
          })
        }

        // Validar caja (si la caja tiene mapeo configurado)
        if (caja.centum_usuario_id && caja.centum_usuario_id !== planilla.centum_usuario_id) {
          return res.status(400).json({
            error: `La planilla está asignada a "${planilla.nombre_usuario}", no a ${caja.nombre} ${caja.sucursales?.nombre}`,
          })
        }
      }
    }

    res.json({
      valida: true,
      nombre: planilla.nombre,
      nombre_usuario: planilla.nombre_usuario,
      nombre_sucursal: planilla.nombre_sucursal,
    })
  } catch (err) {
    console.error('Error al validar planilla en Centum:', err)
    res.status(503).json({ error: 'No se pudo conectar con el ERP' })
  }
})

// GET /api/cierres/:id/comprobantes — comprobantes del ERP (facturas, NC, ND, anticipos)
router.get('/:id/comprobantes', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, planilla_id, cajero_id, caja_id, estado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (!cierre.planilla_id) {
      return res.status(400).json({ error: 'Este cierre no tiene planilla de caja asociada' })
    }

    const planillaId = parseInt(cierre.planilla_id)
    if (isNaN(planillaId)) {
      return res.status(400).json({ error: 'El ID de planilla no es válido' })
    }

    const data = await getComprobantesData(planillaId)
    res.json(data)
  } catch (err) {
    console.error('Error al obtener comprobantes:', err)
    res.status(500).json({ error: 'Error al conectar con el ERP' })
  }
})

// GET /api/cierres/:id/auditoria — datos consolidados de auditoría para IA
router.get('/:id/auditoria', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // 1. Fetch cierre completo
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select(SELECT_CIERRE)
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado === 'abierta') {
      return res.status(400).json({ error: 'No se puede auditar un cierre abierto' })
    }

    const planillaId = cierre.planilla_id ? parseInt(cierre.planilla_id) : null

    // 2. Fetch en paralelo con Promise.allSettled
    const [
      verificacionResult,
      retirosResult,
      continuidadResult,
      erpResult,
      comprobantesResult,
      ventasSinConfirmarResult,
    ] = await Promise.allSettled([
      // Verificación
      supabase
        .from('verificaciones')
        .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
        .eq('cierre_id', cierre.id)
        .single(),

      // Retiros + sus verificaciones
      (async () => {
        const { data: retiros, error } = await supabase
          .from('retiros')
          .select('*, empleado:empleados!empleado_id(id, nombre, codigo)')
          .eq('cierre_id', cierre.id)
          .order('numero', { ascending: true })
        if (error) throw error
        if (!retiros || retiros.length === 0) return []

        const retiroIds = retiros.map(r => r.id)
        const { data: verifs } = await supabase
          .from('verificaciones_retiros')
          .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
          .in('retiro_id', retiroIds)

        const verifMap = {}
        if (verifs) verifs.forEach(v => { verifMap[v.retiro_id] = v })

        return retiros.map(r => {
          const v = verifMap[r.id]
          return {
            numero: r.numero,
            empleado: r.empleado?.nombre || null,
            cajero: {
              billetes: r.billetes || {},
              monedas: r.monedas || {},
              total: r.total || 0,
            },
            verificacion: v ? {
              existe: true,
              gestor: v.gestor?.nombre || null,
              billetes: v.billetes || {},
              monedas: v.monedas || {},
              total: v.total || 0,
            } : { existe: false },
            diferencia: v ? parseFloat(((r.total || 0) - (v.total || 0)).toFixed(2)) : null,
            diferencia_por_denominacion: v ? calcularDiferenciasDenominacion(r.billetes, v.billetes) : null,
            observaciones: r.observaciones || null,
          }
        })
      })(),

      // Cierre anterior + apertura siguiente
      (async () => {
        if (!cierre.caja_id) return { anterior: null, siguiente: null }
        const [antRes, sigRes] = await Promise.all([
          supabase
            .from('cierres')
            .select('id, planilla_id, cambio_billetes, cambio_monedas, cambio_que_queda')
            .eq('caja_id', cierre.caja_id)
            .lt('created_at', cierre.created_at)
            .neq('estado', 'abierta')
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('cierres')
            .select('id, planilla_id, fondo_fijo_billetes, fondo_fijo_monedas, fondo_fijo')
            .eq('caja_id', cierre.caja_id)
            .gt('created_at', cierre.created_at)
            .order('created_at', { ascending: true })
            .limit(1),
        ])
        return {
          anterior: antRes.data?.[0] || null,
          siguiente: sigRes.data?.[0] || null,
        }
      })(),

      // ERP planilla data
      planillaId ? getPlanillaData(planillaId) : Promise.resolve(null),

      // Comprobantes
      planillaId ? getComprobantesData(planillaId) : Promise.resolve(null),

      // Ventas sin confirmar
      planillaId ? getVentasSinConfirmar(planillaId) : Promise.resolve({ cantidad: 0, ventas: [] }),
    ])

    // 3. Extraer resultados (tolerando fallos)
    const verificacionData = verificacionResult.status === 'fulfilled' ? verificacionResult.value?.data : null
    const retirosData = retirosResult.status === 'fulfilled' ? retirosResult.value : []
    const continuidadData = continuidadResult.status === 'fulfilled' ? continuidadResult.value : { anterior: null, siguiente: null }
    const erpData = erpResult.status === 'fulfilled' ? erpResult.value : null
    const comprobantesData = comprobantesResult.status === 'fulfilled' ? comprobantesResult.value : null
    const ventasSCData = ventasSinConfirmarResult.status === 'fulfilled' ? ventasSinConfirmarResult.value : { cantidad: 0, ventas: [] }

    // 4. Construir secciones de respuesta
    const cajeroSection = {
      billetes: cierre.billetes || {},
      monedas: cierre.monedas || {},
      total_efectivo: cierre.total_efectivo || 0,
      medios_pago: cierre.medios_pago || [],
      total_general: cierre.total_general || 0,
      fondo_fijo: cierre.fondo_fijo || 0,
      cambio_que_queda: cierre.cambio_que_queda || 0,
      efectivo_retirado: cierre.efectivo_retirado || 0,
      efectivo_neto: calcularEfectivoNeto(cierre, cierre),
      observaciones: cierre.observaciones || null,
    }

    const verificacionSection = verificacionData ? {
      existe: true,
      gestor: verificacionData.gestor?.nombre || null,
      billetes: verificacionData.billetes || {},
      monedas: verificacionData.monedas || {},
      total_efectivo: verificacionData.total_efectivo || 0,
      medios_pago: verificacionData.medios_pago || [],
      total_general: verificacionData.total_general || 0,
      efectivo_neto: calcularEfectivoNeto(verificacionData, cierre),
      observaciones: verificacionData.observaciones || null,
      created_at: verificacionData.created_at,
    } : { existe: false }

    const erpSection = erpData ? {
      disponible: true,
      planilla_cerrada: erpData.cerrada,
      nombre_cajero_erp: erpData.nombre_cajero,
      medios_pago: erpData.medios_pago,
      total_efectivo: erpData.total_efectivo,
      total_general: erpData.total_general,
    } : { disponible: false }

    const comprobantesSection = comprobantesData ? {
      disponible: true,
      total_comprobantes: comprobantesData.total_comprobantes,
      resumen: comprobantesData.resumen,
      notas_credito: comprobantesData.notas_credito,
    } : { disponible: false }

    // 5. Calcular diferencias
    const diferencias = {
      cajero_vs_gestor: null,
      cajero_vs_erp: null,
      gestor_vs_erp: null,
      retiros: null,
    }

    if (verificacionData) {
      diferencias.cajero_vs_gestor = {
        efectivo: parseFloat(((cierre.total_efectivo || 0) - (verificacionData.total_efectivo || 0)).toFixed(2)),
        medios_pago: calcularDiferenciasMediosPago(cierre.medios_pago, verificacionData.medios_pago),
        total_general: parseFloat(((cierre.total_general || 0) - (verificacionData.total_general || 0)).toFixed(2)),
        por_denominacion: {
          billetes: calcularDiferenciasDenominacion(cierre.billetes, verificacionData.billetes),
          monedas: calcularDiferenciasDenominacion(cierre.monedas, verificacionData.monedas),
        },
      }
    }

    if (erpData) {
      const cajeroEfectivoNeto = cajeroSection.efectivo_neto
      diferencias.cajero_vs_erp = {
        efectivo: parseFloat((cajeroEfectivoNeto - (erpData.total_efectivo || 0)).toFixed(2)),
        medios_pago: calcularDiferenciasMediosPago(cierre.medios_pago, erpData.medios_pago),
        total_general: parseFloat(((cierre.total_general || 0) - (erpData.total_general || 0)).toFixed(2)),
      }

      if (verificacionData) {
        const gestorEfectivoNeto = verificacionSection.efectivo_neto
        diferencias.gestor_vs_erp = {
          efectivo: parseFloat((gestorEfectivoNeto - (erpData.total_efectivo || 0)).toFixed(2)),
          medios_pago: calcularDiferenciasMediosPago(verificacionData.medios_pago, erpData.medios_pago),
          total_general: parseFloat(((verificacionData.total_general || 0) - (erpData.total_general || 0)).toFixed(2)),
        }
      }
    }

    // Resumen de retiros
    if (retirosData.length > 0) {
      const conDiferencia = retirosData.filter(r => r.diferencia !== null && Math.abs(r.diferencia) > 0.01)
      diferencias.retiros = {
        cantidad: retirosData.length,
        diferencia_total: parseFloat(retirosData.reduce((sum, r) => sum + (r.diferencia || 0), 0).toFixed(2)),
        con_diferencia: conDiferencia.length,
      }
    }

    // 6. Continuidad de cambio
    const continuidad = construirContinuidadCambio(cierre, continuidadData.anterior, continuidadData.siguiente)

    // 7. Respuesta consolidada
    res.json({
      cierre_id: cierre.id,
      planilla_id: cierre.planilla_id,
      fecha: cierre.fecha,
      estado: cierre.estado,

      contexto: {
        caja: cierre.caja ? { id: cierre.caja.id, nombre: cierre.caja.nombre } : null,
        sucursal: cierre.caja?.sucursales || null,
        empleado: cierre.empleado?.nombre || null,
        cajero_perfil: cierre.cajero ? { id: cierre.cajero.id, nombre: cierre.cajero.nombre, username: cierre.cajero.username } : null,
        cerrado_por: cierre.cerrado_por?.nombre || null,
      },

      timing: {
        hora_apertura: cierre.created_at,
        duracion_estimada_minutos: null,
      },

      cajero: cajeroSection,
      verificacion: verificacionSection,
      erp: erpSection,
      comprobantes: comprobantesSection,
      ventas_sin_confirmar: ventasSCData,
      retiros: retirosData,
      diferencias,
      continuidad_cambio: continuidad,
    })
  } catch (err) {
    console.error('Error en auditoría de cierre:', err)
    res.status(500).json({ error: 'Error al generar auditoría' })
  }
})

// GET /api/cierres/:id/analisis-ia — análisis automático de un cierre con IA
router.get('/:id/analisis-ia', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    // Reusar lógica de auditoría haciendo fetch interno
    const auditoriaUrl = `${req.protocol}://${req.get('host')}/api/cierres/${req.params.id}/auditoria`
    const auditoriaRes = await fetch(auditoriaUrl, {
      headers: { authorization: req.headers.authorization },
    })

    if (!auditoriaRes.ok) {
      const err = await auditoriaRes.json().catch(() => ({}))
      return res.status(auditoriaRes.status).json({ error: err.error || 'Error al obtener datos de auditoría' })
    }

    const auditoriaData = await auditoriaRes.json()
    const analisis = await analizarCierreIA(auditoriaData)
    res.json(analisis)
  } catch (err) {
    console.error('Error en análisis IA:', err)
    res.status(500).json({ error: err.message || 'Error al generar análisis de IA' })
  }
})

// POST /api/cierres/:id/chat-ia — chat sobre un cierre específico
router.post('/:id/chat-ia', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { mensaje, historial } = req.body
    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({ error: 'El mensaje es requerido' })
    }

    // Obtener datos de auditoría como contexto
    const auditoriaUrl = `${req.protocol}://${req.get('host')}/api/cierres/${req.params.id}/auditoria`
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
    console.error('Error en chat IA:', err)
    res.status(500).json({ error: err.message || 'Error al procesar mensaje' })
  }
})

// POST /api/cierres/chat-ia-general — chat general de auditoría sin cierre específico
router.post('/chat-ia-general', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { mensaje, historial } = req.body
    if (!mensaje || !mensaje.trim()) {
      return res.status(400).json({ error: 'El mensaje es requerido' })
    }

    // Obtener últimos 10 cierres como contexto mínimo
    const { data: ultimos } = await supabase
      .from('cierres')
      .select('id, planilla_id, fecha, estado, total_efectivo, total_general, caja:cajas(nombre, sucursales(nombre)), empleado:empleados!empleado_id(nombre), cajero:perfiles!cajero_id(nombre)')
      .neq('estado', 'abierta')
      .order('created_at', { ascending: false })
      .limit(10)

    const contexto = {
      resumen: 'Últimos 10 cierres de caja del sistema',
      cierres: ultimos || [],
    }

    const respuesta = await chatCajas(mensaje.trim(), historial || [], contexto)
    res.json({ respuesta })
  } catch (err) {
    console.error('Error en chat IA general:', err)
    res.status(500).json({ error: err.message || 'Error al procesar mensaje' })
  }
})

// GET /api/cierres/:id — detalle de un cierre (CIEGO para gestor)
router.get('/:id', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error } = await supabase
      .from('cierres')
      .select(SELECT_CIERRE)
      .eq('id', req.params.id)
      .single()

    if (error || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const { rol, sucursal_id } = req.perfil

    // Operario solo puede ver sus propios cierres
    if (rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'No tenés acceso a este cierre' })
    }

    // Gestor solo puede ver cierres de cajas de su sucursal
    if (rol === 'gestor' && cierre.caja?.sucursal_id !== sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a este cierre' })
    }

    // CIEGO: si es gestor y no verificó aún, ocultar montos del cajero
    if (rol === 'gestor' && cierre.estado === 'pendiente_gestor') {
      const { data: verificacion } = await supabase
        .from('verificaciones')
        .select('id')
        .eq('cierre_id', cierre.id)
        .eq('gestor_id', req.perfil.id)
        .single()

      if (!verificacion) {
        return res.json({
          id: cierre.id,
          planilla_id: cierre.planilla_id,
          cajero_id: cierre.cajero_id,
          caja_id: cierre.caja_id,
          empleado_id: cierre.empleado_id,
          fecha: cierre.fecha,
          estado: cierre.estado,
          caja: cierre.caja,
          empleado: cierre.empleado,
          cerrado_por: cierre.cerrado_por,
          cajero: cierre.cajero,
          fondo_fijo: cierre.fondo_fijo,
          created_at: cierre.created_at,
          _blind: true,
        })
      }
    }

    // Buscar cierre anterior y siguiente de la misma caja
    let cierre_anterior = null
    let apertura_siguiente = null
    if (cierre.estado !== 'abierta' && cierre.caja_id) {
      const [antRes, sigRes] = await Promise.all([
        supabase
          .from('cierres')
          .select('id, planilla_id, cambio_billetes')
          .eq('caja_id', cierre.caja_id)
          .lt('created_at', cierre.created_at)
          .neq('estado', 'abierta')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('cierres')
          .select('id, planilla_id, fondo_fijo_billetes')
          .eq('caja_id', cierre.caja_id)
          .gt('created_at', cierre.created_at)
          .order('created_at', { ascending: true })
          .limit(1),
      ])

      if (antRes.data && antRes.data.length > 0) {
        cierre_anterior = {
          planilla_id: antRes.data[0].planilla_id,
          cambio_billetes: antRes.data[0].cambio_billetes || {},
        }
      }

      if (sigRes.data && sigRes.data.length > 0) {
        apertura_siguiente = {
          planilla_id: sigRes.data[0].planilla_id,
          fondo_fijo_billetes: sigRes.data[0].fondo_fijo_billetes || {},
        }
      }
    }

    res.json({ ...cierre, cierre_anterior, apertura_siguiente, _blind: false })
  } catch (err) {
    console.error('Error al obtener cierre:', err)
    res.status(500).json({ error: 'Error al obtener cierre' })
  }
})

// POST /api/cierres/abrir — operario/admin abre una caja
router.post('/abrir', verificarAuth, async (req, res) => {
  const { rol } = req.perfil

  if (rol === 'gestor') {
    return res.status(403).json({ error: 'Los gestores no pueden abrir cajas' })
  }

  const { caja_id, codigo_empleado, empleado_id, planilla_id, fondo_fijo, fondo_fijo_billetes, fondo_fijo_monedas, diferencias_apertura, observaciones_apertura } = req.body

  if (!caja_id) {
    return res.status(400).json({ error: 'Seleccioná una caja' })
  }
  if (!codigo_empleado && !empleado_id) {
    return res.status(400).json({ error: 'Ingresá el código del empleado' })
  }
  if (!planilla_id || !planilla_id.toString().trim()) {
    return res.status(400).json({ error: 'El ID de planilla de caja es requerido' })
  }

  try {
    // Resolver empleado por código si se envió codigo_empleado
    let resolvedEmpleadoId = empleado_id
    if (codigo_empleado) {
      const { data: emp, error: empError } = await supabase
        .from('empleados')
        .select('id')
        .eq('codigo', codigo_empleado)
        .eq('activo', true)
        .single()

      if (empError || !emp) {
        return res.status(404).json({ error: 'Empleado no encontrado o inactivo' })
      }
      resolvedEmpleadoId = emp.id
    }
    // Validar planilla en Centum: debe existir y estar cerrada
    const planillaNum = parseInt(planilla_id)
    if (isNaN(planillaNum)) {
      return res.status(400).json({ error: 'El ID de planilla debe ser un número' })
    }

    try {
      const planilla = await validarPlanilla(planillaNum)
      if (!planilla.existe) {
        return res.status(404).json({ error: 'La planilla no existe en Centum' })
      }
      if (planilla.cerrada) {
        return res.status(400).json({ error: `La planilla ${planillaNum} (${planilla.nombre}) ya está cerrada en Centum.` })
      }

      // Validar cruce sucursal/caja
      const { data: caja } = await supabase
        .from('cajas')
        .select('id, nombre, centum_usuario_id, sucursal_id, sucursales(id, nombre, centum_sucursal_id)')
        .eq('id', caja_id)
        .single()

      if (caja) {
        const centumSucId = caja.sucursales?.centum_sucursal_id
        if (centumSucId && centumSucId !== planilla.centum_sucursal_id) {
          return res.status(400).json({ error: `La planilla pertenece a ${planilla.nombre_sucursal}, no a ${caja.sucursales.nombre}` })
        }
        if (caja.centum_usuario_id && caja.centum_usuario_id !== planilla.centum_usuario_id) {
          return res.status(400).json({ error: `La planilla está asignada a "${planilla.nombre_usuario}", no a ${caja.nombre} ${caja.sucursales?.nombre}` })
        }
      }
    } catch (centumErr) {
      console.error('Error al validar planilla en Centum:', centumErr)
      return res.status(503).json({ error: 'No se pudo conectar con el ERP para validar la planilla' })
    }

    // Validar que la caja no esté ya abierta
    const { data: cajaAbierta } = await supabase
      .from('cierres')
      .select('id')
      .eq('caja_id', caja_id)
      .eq('estado', 'abierta')
      .limit(1)

    if (cajaAbierta && cajaAbierta.length > 0) {
      return res.status(409).json({ error: 'Esta caja ya está abierta. Cerrala antes de abrir una nueva.' })
    }

    const { data, error } = await supabase
      .from('cierres')
      .insert({
        caja_id,
        empleado_id: resolvedEmpleadoId,
        planilla_id: planilla_id.toString().trim(),
        cajero_id: req.perfil.id,
        fondo_fijo: fondo_fijo || 0,
        fondo_fijo_billetes: fondo_fijo_billetes || {},
        fondo_fijo_monedas: fondo_fijo_monedas || {},
        diferencias_apertura: diferencias_apertura || null,
        observaciones_apertura: observaciones_apertura || null,
        estado: 'abierta',
        billetes: {},
        monedas: {},
        total_efectivo: 0,
        total_general: 0,
        medios_pago: [],
      })
      .select(SELECT_CIERRE)
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un cierre con esa planilla de caja' })
      }
      throw error
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('Error al abrir caja:', err)
    res.status(500).json({ error: 'Error al abrir caja' })
  }
})

// PUT /api/cierres/:id/cerrar — operario/admin cierra la caja con el conteo completo
router.put('/:id/cerrar', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, cajero_id, estado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado !== 'abierta') {
      return res.status(400).json({ error: 'Esta caja ya fue cerrada' })
    }

    if (req.perfil.rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'Solo podés cerrar tu propia caja' })
    }

    const {
      billetes, monedas, total_efectivo,
      medios_pago, total_general, observaciones,
      cambio_billetes, cambio_monedas, cambio_que_queda, efectivo_retirado,
      codigo_empleado,
    } = req.body

    // Resolver empleado que cierra por código
    let cerradoPorEmpleadoId = null
    if (codigo_empleado) {
      const { data: emp, error: empError } = await supabase
        .from('empleados')
        .select('id')
        .eq('codigo', codigo_empleado)
        .eq('activo', true)
        .single()

      if (empError || !emp) {
        return res.status(404).json({ error: 'Empleado no encontrado o inactivo' })
      }
      cerradoPorEmpleadoId = emp.id
    }

    const { data, error } = await supabase
      .from('cierres')
      .update({
        billetes: billetes || {},
        monedas: monedas || {},
        total_efectivo: total_efectivo || 0,
        medios_pago: medios_pago || [],
        total_general: total_general || 0,
        observaciones: observaciones || '',
        cambio_billetes: cambio_billetes || {},
        cambio_monedas: cambio_monedas || {},
        cambio_que_queda: cambio_que_queda || 0,
        efectivo_retirado: efectivo_retirado || 0,
        cerrado_por_empleado_id: cerradoPorEmpleadoId,
        estado: 'pendiente_gestor',
      })
      .eq('id', req.params.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al cerrar caja:', err)
    res.status(500).json({ error: 'Error al cerrar caja' })
  }
})

// PUT /api/cierres/:id/editar-conteo — cajero edita su conteo antes de verificación
router.put('/:id/editar-conteo', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, cajero_id, caja_id, estado, cerrado_por_empleado_id, created_at')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado !== 'pendiente_gestor') {
      return res.status(400).json({ error: 'Este cierre ya fue verificado y no se puede editar' })
    }

    // Validar código de empleado: debe coincidir con quien cerró
    const { codigo_empleado } = req.body
    if (!codigo_empleado) {
      return res.status(400).json({ error: 'Ingresá el código del empleado que cerró la caja' })
    }

    const { data: emp, error: empError } = await supabase
      .from('empleados')
      .select('id')
      .eq('codigo', codigo_empleado)
      .eq('activo', true)
      .single()

    if (empError || !emp) {
      return res.status(404).json({ error: 'Empleado no encontrado o inactivo' })
    }

    if (emp.id !== cierre.cerrado_por_empleado_id) {
      return res.status(403).json({ error: 'El código no corresponde al empleado que cerró esta caja' })
    }

    const {
      billetes, monedas, total_efectivo,
      medios_pago, total_general, observaciones,
      cambio_billetes, cambio_monedas, cambio_que_queda, efectivo_retirado,
    } = req.body

    const { data, error } = await supabase
      .from('cierres')
      .update({
        billetes: billetes || {},
        monedas: monedas || {},
        total_efectivo: total_efectivo || 0,
        medios_pago: medios_pago || [],
        total_general: total_general || 0,
        observaciones: observaciones || '',
        cambio_billetes: cambio_billetes || {},
        cambio_monedas: cambio_monedas || {},
        cambio_que_queda: cambio_que_queda || 0,
        efectivo_retirado: efectivo_retirado || 0,
      })
      .eq('id', req.params.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) throw error

    // Recalcular diferencias_apertura del cierre siguiente (si existe)
    const nuevoCambioBilletes = cambio_billetes || {}
    const nuevoCambioMonedas = cambio_monedas || {}

    console.log('[editar-conteo] Buscando cierre siguiente para caja_id:', cierre.caja_id, 'después de:', cierre.created_at)

    const { data: siguientes, error: errorSig } = await supabase
      .from('cierres')
      .select('id, planilla_id, fondo_fijo_billetes, fondo_fijo_monedas')
      .eq('caja_id', cierre.caja_id)
      .gt('created_at', cierre.created_at)
      .order('created_at', { ascending: true })
      .limit(1)

    console.log('[editar-conteo] Resultado búsqueda siguiente:', { encontrados: siguientes?.length, error: errorSig?.message })

    if (siguientes && siguientes.length > 0) {
      const siguienteCierre = siguientes[0]
      const fondoBilletes = siguienteCierre.fondo_fijo_billetes || {}
      const fondoMonedas = siguienteCierre.fondo_fijo_monedas || {}
      const diferencias = {}

      console.log('[editar-conteo] Cierre siguiente:', siguienteCierre.planilla_id, '| cambio editado:', nuevoCambioBilletes, '| fondo siguiente:', fondoBilletes)

      // Comparar billetes
      const allBilletes = new Set([...Object.keys(nuevoCambioBilletes), ...Object.keys(fondoBilletes)])
      for (const denom of allBilletes) {
        const anterior = nuevoCambioBilletes[denom] || 0
        const actual = fondoBilletes[denom] || 0
        if (anterior !== actual) {
          diferencias[denom] = { tipo: 'billete', anterior, actual }
        }
      }

      // Comparar monedas
      const allMonedas = new Set([...Object.keys(nuevoCambioMonedas), ...Object.keys(fondoMonedas)])
      for (const denom of allMonedas) {
        const anterior = nuevoCambioMonedas[denom] || 0
        const actual = fondoMonedas[denom] || 0
        if (anterior !== actual) {
          diferencias[denom] = { tipo: 'moneda', anterior, actual }
        }
      }

      console.log('[editar-conteo] Diferencias recalculadas:', Object.keys(diferencias).length > 0 ? diferencias : 'NINGUNA')

      await supabase
        .from('cierres')
        .update({ diferencias_apertura: Object.keys(diferencias).length > 0 ? diferencias : null })
        .eq('id', siguienteCierre.id)
    }

    res.json(data)
  } catch (err) {
    console.error('Error al editar conteo:', err)
    res.status(500).json({ error: 'Error al editar conteo' })
  }
})

// GET /api/cierres/:id/verificacion — obtener la verificación de un cierre
router.get('/:id/verificacion', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, cajero_id')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (req.perfil.rol === 'operario') {
      return res.status(403).json({ error: 'No tenés acceso a la verificación' })
    }

    const { data, error } = await supabase
      .from('verificaciones')
      .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
      .eq('cierre_id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'No hay verificación para este cierre' })
    }

    res.json(data)
  } catch (err) {
    console.error('Error al obtener verificación:', err)
    res.status(500).json({ error: 'Error al obtener verificación' })
  }
})

// POST /api/cierres/:id/verificar — gestor/admin envía verificación ciega
router.post('/:id/verificar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('*, caja:cajas(id, sucursal_id)')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado !== 'pendiente_gestor') {
      return res.status(400).json({ error: 'Este cierre no está pendiente de verificación' })
    }

    if (cierre.cajero_id === req.perfil.id) {
      return res.status(403).json({ error: 'No podés verificar tu propio cierre' })
    }

    // Gestor: verificar misma sucursal (via caja)
    if (req.perfil.rol === 'gestor' && cierre.caja?.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
    }

    const {
      billetes, monedas, total_efectivo,
      medios_pago, total_general, observaciones,
    } = req.body

    const { data: verificacion, error: errorVerif } = await supabase
      .from('verificaciones')
      .insert({
        cierre_id: cierre.id,
        gestor_id: req.perfil.id,
        billetes: billetes || {},
        monedas: monedas || {},
        total_efectivo: total_efectivo || 0,
        medios_pago: medios_pago || [],
        total_general: total_general || 0,
        observaciones: observaciones || '',
      })
      .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
      .single()

    if (errorVerif) {
      if (errorVerif.code === '23505') {
        return res.status(409).json({ error: 'Este cierre ya tiene una verificación' })
      }
      throw errorVerif
    }

    await supabase
      .from('cierres')
      .update({ estado: 'pendiente_agente' })
      .eq('id', cierre.id)

    res.status(201).json(verificacion)
  } catch (err) {
    console.error('Error al verificar cierre:', err)
    res.status(500).json({ error: 'Error al verificar cierre' })
  }
})

// GET /api/cierres/:id/erp — datos del ERP (Centum) para la planilla de este cierre
router.get('/:id/erp', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, planilla_id, cajero_id, caja_id, estado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (!cierre.planilla_id) {
      return res.status(400).json({ error: 'Este cierre no tiene planilla de caja asociada' })
    }

    const planillaId = parseInt(cierre.planilla_id)
    if (isNaN(planillaId)) {
      return res.status(400).json({ error: 'El ID de planilla no es válido' })
    }

    const erpData = await getPlanillaData(planillaId)

    if (!erpData) {
      return res.status(404).json({ error: 'Planilla no encontrada en el ERP' })
    }

    res.json(erpData)
  } catch (err) {
    console.error('Error al obtener datos ERP:', err)
    res.status(500).json({ error: 'Error al conectar con el ERP' })
  }
})

// GET /api/cierres/:id/ventas-sin-confirmar — ventas cerradas sin confirmar en la sesión
router.get('/:id/ventas-sin-confirmar', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, planilla_id')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (!cierre.planilla_id) {
      return res.status(400).json({ error: 'Este cierre no tiene planilla de caja asociada' })
    }

    const planillaId = parseInt(cierre.planilla_id)
    if (isNaN(planillaId)) {
      return res.status(400).json({ error: 'El ID de planilla no es válido' })
    }

    const data = await getVentasSinConfirmar(planillaId)
    res.json(data)
  } catch (err) {
    console.error('Error al obtener ventas sin confirmar:', err)
    res.status(500).json({ error: 'Error al conectar con el ERP' })
  }
})

// PUT /api/cierres/:id — admin edita planilla_id de un cierre
router.put('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { planilla_id } = req.body
    if (!planilla_id || !planilla_id.toString().trim()) {
      return res.status(400).json({ error: 'El ID de planilla es requerido' })
    }

    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const { data, error } = await supabase
      .from('cierres')
      .update({ planilla_id: planilla_id.toString().trim() })
      .eq('id', req.params.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un cierre con esa planilla' })
      }
      throw error
    }

    res.json(data)
  } catch (err) {
    console.error('Error al editar cierre:', err)
    res.status(500).json({ error: 'Error al editar cierre' })
  }
})

// DELETE /api/cierres/:id — admin elimina un cierre y sus datos relacionados
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, planilla_id')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    // Eliminar en orden: verificaciones_retiros → retiros → verificaciones → cierre
    const { data: retiros } = await supabase
      .from('retiros')
      .select('id')
      .eq('cierre_id', cierre.id)

    if (retiros && retiros.length > 0) {
      const retiroIds = retiros.map(r => r.id)
      await supabase
        .from('verificaciones_retiros')
        .delete()
        .in('retiro_id', retiroIds)

      await supabase
        .from('retiros')
        .delete()
        .eq('cierre_id', cierre.id)
    }

    await supabase
      .from('verificaciones')
      .delete()
      .eq('cierre_id', cierre.id)

    const { error } = await supabase
      .from('cierres')
      .delete()
      .eq('id', cierre.id)

    if (error) throw error

    res.json({ ok: true, planilla_id: cierre.planilla_id })
  } catch (err) {
    console.error('Error al eliminar cierre:', err)
    res.status(500).json({ error: 'Error al eliminar cierre' })
  }
})

module.exports = router
