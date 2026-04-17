// Rutas de cierres de caja POS y verificaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { abrirCierrePosSchema, cerrarCierreSchema, editarConteoSchema } = require('../schemas/cierres')
const asyncHandler = require('../middleware/asyncHandler')

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

// Normaliza nombre de medio de pago: saca separadores, ordena palabras
function normalizarMedio(n) {
  return n.toUpperCase().replace(/[\/\-,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')
}

function mediosSonIguales(a, b) {
  const na = a.toUpperCase(), nb = b.toUpperCase()
  if (na.includes(nb) || nb.includes(na)) return true
  return normalizarMedio(a) === normalizarMedio(b)
}

function calcularDiferenciasMediosPago(cajeroMedios, otroMedios) {
  if (!cajeroMedios || !otroMedios) return []

  // Construir arrays con nombre original y monto
  const cajeroItems = (cajeroMedios || []).map(mp => ({ nombre: mp.nombre || mp.forma_cobro, monto: mp.total || mp.monto || 0 }))
  const otroItems = (otroMedios || []).map(mp => ({ nombre: mp.nombre || mp.forma_cobro, monto: mp.total || mp.monto || 0 }))

  // Matchear cajero → otro (por nombre normalizado)
  const usadosOtro = new Set()
  const pares = []

  for (const c of cajeroItems) {
    const match = otroItems.findIndex((o, i) => !usadosOtro.has(i) && mediosSonIguales(c.nombre, o.nombre))
    if (match >= 0) {
      usadosOtro.add(match)
      pares.push({ nombre: c.nombre, cajero: c.monto, otro: otroItems[match].monto })
    } else {
      pares.push({ nombre: c.nombre, cajero: c.monto, otro: 0 })
    }
  }

  // Agregar los del otro que no matchearon (excluyendo EFECTIVO que se compara aparte)
  otroItems.forEach((o, i) => {
    if (!usadosOtro.has(i) && o.nombre.toUpperCase() !== 'EFECTIVO') {
      pares.push({ nombre: o.nombre, cajero: 0, otro: o.monto })
    }
  })

  return pares
    .filter(p => Math.abs(p.cajero - p.otro) > 0.01)
    .map(p => ({ nombre: p.nombre, cajero: p.cajero, otro: p.otro, diferencia: parseFloat((p.cajero - p.otro).toFixed(2)) }))
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
      apertura_at: cierreAnterior.apertura_at,
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
      apertura_at: aperturaSiguiente.apertura_at,
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

// GET /api/cierres-pos — lista cierres_pos con filtros
router.get('/', verificarAuth, asyncHandler(async (req, res) => {
  try {
    let query = supabase
      .from('cierres_pos')
      .select(SELECT_CIERRE)
      .order('created_at', { ascending: false })

    const { rol, sucursal_id } = req.perfil

    // Operario y gestor: filtrar por sucursal de la caja (post-query)
    // Admin: sin filtro

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

    // Operario y gestor: filtrar solo cierres de cajas de su sucursal
    let filtered = data
    if (rol === 'operario' || rol === 'gestor') {
      filtered = data.filter(c => c.caja?.sucursal_id === sucursal_id)
    }

    res.json(filtered)
  } catch (err) {
    logger.error('Error al obtener cierres POS:', err)
    res.status(500).json({ error: 'Error al obtener cierres POS' })
  }
}))

// GET /api/cierres-pos/abierta?caja_id=X — verificar si la caja tiene un cierre abierto
router.get('/abierta', verificarAuth, asyncHandler(async (req, res) => {
  const { caja_id } = req.query
  if (!caja_id) {
    return res.status(400).json({ error: 'caja_id es requerido' })
  }

  try {
    const { data, error } = await supabase
      .from('cierres_pos')
      .select(SELECT_CIERRE)
      .eq('caja_id', caja_id)
      .eq('estado', 'abierta')
      .limit(1)

    if (error) throw error

    if (data && data.length > 0) {
      return res.json({ abierta: true, cierre: data[0] })
    }

    res.json({ abierta: false })
  } catch (err) {
    logger.error('Error al verificar caja abierta POS:', err)
    res.status(500).json({ error: 'Error al verificar caja abierta' })
  }
}))

// GET /api/cierres-pos/ultimo-cambio?caja_id=X — último cambio dejado en caja
router.get('/ultimo-cambio', verificarAuth, asyncHandler(async (req, res) => {
  const { caja_id } = req.query
  if (!caja_id) {
    return res.status(400).json({ error: 'caja_id es requerido' })
  }

  try {
    const { data, error } = await supabase
      .from('cierres_pos')
      .select('cambio_billetes, cambio_monedas')
      .eq('caja_id', caja_id)
      .or('tipo.is.null,tipo.neq.delivery')
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
    logger.error('Error al obtener último cambio POS:', err)
    res.json({ cambio_billetes: {}, cambio_monedas: {} })
  }
}))

// GET /api/cierres-pos/:id — detalle de un cierre POS (CIEGO para gestor)
router.get('/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error } = await supabase
      .from('cierres_pos')
      .select(SELECT_CIERRE)
      .eq('id', req.params.id)
      .single()

    if (error || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    const { rol, sucursal_id } = req.perfil

    // Operario y gestor solo pueden ver cierres de cajas de su sucursal
    if ((rol === 'operario' || rol === 'gestor') && cierre.caja?.sucursal_id !== sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a este cierre' })
    }

    // Buscar cierre anterior y siguiente de la misma caja
    let cierre_anterior = null
    let apertura_siguiente = null
    if (cierre.estado !== 'abierta' && cierre.caja_id) {
      // Delivery no tiene continuidad de cambio — solo comparar entre cierres POS
      const esDelivery = cierre.tipo === 'delivery'
      const [antRes, sigRes] = esDelivery ? [{ data: [] }, { data: [] }] : await Promise.all([
        supabase
          .from('cierres_pos')
          .select('id, apertura_at, cambio_billetes')
          .eq('caja_id', cierre.caja_id)
          .or('tipo.is.null,tipo.neq.delivery')
          .lt('created_at', cierre.created_at)
          .neq('estado', 'abierta')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('cierres_pos')
          .select('id, apertura_at, fondo_fijo_billetes')
          .eq('caja_id', cierre.caja_id)
          .or('tipo.is.null,tipo.neq.delivery')
          .gt('created_at', cierre.created_at)
          .order('created_at', { ascending: true })
          .limit(1),
      ])

      if (antRes.data && antRes.data.length > 0) {
        cierre_anterior = {
          id: antRes.data[0].id,
          apertura_at: antRes.data[0].apertura_at,
          cambio_billetes: antRes.data[0].cambio_billetes || {},
        }
      }

      if (sigRes.data && sigRes.data.length > 0) {
        apertura_siguiente = {
          id: sigRes.data[0].id,
          apertura_at: sigRes.data[0].apertura_at,
          fondo_fijo_billetes: sigRes.data[0].fondo_fijo_billetes || {},
        }
      }
    }

    res.json({ ...cierre, cierre_anterior, apertura_siguiente, _blind: false })
  } catch (err) {
    logger.error('Error al obtener cierre POS:', err)
    res.status(500).json({ error: 'Error al obtener cierre POS' })
  }
}))

// POST /api/cierres-pos/abrir — operario/admin abre una caja POS
router.post('/abrir', verificarAuth, validate(abrirCierrePosSchema), asyncHandler(async (req, res) => {
  const { rol } = req.perfil

  if (rol === 'gestor') {
    return res.status(403).json({ error: 'Los gestores no pueden abrir cajas' })
  }

  const { caja_id, codigo_empleado, fondo_fijo, fondo_fijo_billetes, fondo_fijo_monedas, diferencias_apertura, observaciones_apertura } = req.body

  try {
    // Resolver empleado por código
    const { data: emp, error: empError } = await supabase
      .from('empleados')
      .select('id')
      .eq('codigo', codigo_empleado)
      .eq('activo', true)
      .single()

    if (empError || !emp) {
      return res.status(404).json({ error: 'Empleado no encontrado o inactivo' })
    }
    const resolvedEmpleadoId = emp.id

    // Validar que la caja no esté ya abierta
    const { data: cajaAbierta } = await supabase
      .from('cierres_pos')
      .select('id')
      .eq('caja_id', caja_id)
      .eq('estado', 'abierta')
      .limit(1)

    if (cajaAbierta && cajaAbierta.length > 0) {
      return res.status(409).json({ error: 'Esta caja ya está abierta. Cerrala antes de abrir una nueva.' })
    }

    // Obtener siguiente numero de cierre
    const { data: ultimoCierre } = await supabase
      .from('cierres_pos')
      .select('numero')
      .not('numero', 'is', null)
      .order('numero', { ascending: false })
      .limit(1)
    const siguienteNumero = (ultimoCierre?.[0]?.numero || 0) + 1

    const { data, error } = await supabase
      .from('cierres_pos')
      .insert({
        numero: siguienteNumero,
        caja_id,
        empleado_id: resolvedEmpleadoId,
        cajero_id: req.perfil.id,
        apertura_at: new Date().toISOString(),
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

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    logger.error('Error al abrir caja POS:', err)
    res.status(500).json({ error: 'Error al abrir caja POS' })
  }
}))

// PUT /api/cierres-pos/:id/cerrar — operario/admin cierra la caja POS con el conteo completo
router.put('/:id/cerrar', verificarAuth, validate(cerrarCierreSchema), asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, caja_id, estado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    if (cierre.estado !== 'abierta') {
      return res.status(400).json({ error: 'Esta caja ya fue cerrada' })
    }

    // Operario puede cerrar cualquier caja de su sucursal
    if (req.perfil.rol === 'operario') {
      const { data: cajaData } = await supabase
        .from('cajas')
        .select('sucursal_id')
        .eq('id', cierre.caja_id)
        .single()
      if (!cajaData || cajaData.sucursal_id !== req.perfil.sucursal_id) {
        return res.status(403).json({ error: 'Solo podés cerrar cajas de tu sucursal' })
      }
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
      .from('cierres_pos')
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
        cierre_at: new Date().toISOString(),
        estado: 'pendiente_gestor',
      })
      .eq('id', req.params.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    logger.error('Error al cerrar caja POS:', err)
    res.status(500).json({ error: 'Error al cerrar caja POS' })
  }
}))

// PUT /api/cierres-pos/:id/editar-conteo — cajero edita su conteo antes de verificación
router.put('/:id/editar-conteo', verificarAuth, validate(editarConteoSchema), asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, caja_id, estado, cerrado_por_empleado_id, created_at')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    if (cierre.estado !== 'pendiente_gestor') {
      return res.status(400).json({ error: 'Este cierre ya fue verificado y no se puede editar' })
    }

    // Validar código de empleado: debe coincidir con quien cerró (admins exentos)
    const { codigo_empleado } = req.body
    if (req.perfil.rol !== 'admin') {
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
    }

    const {
      billetes, monedas, total_efectivo,
      medios_pago, total_general, observaciones,
      cambio_billetes, cambio_monedas, cambio_que_queda, efectivo_retirado,
      fondo_fijo, fondo_fijo_billetes,
    } = req.body

    const updateData = {
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
    }

    // Admin puede editar fondo_fijo (cambio inicial) con desglose
    if (req.perfil.rol === 'admin' && fondo_fijo != null) {
      updateData.fondo_fijo = fondo_fijo
      if (fondo_fijo_billetes) {
        updateData.fondo_fijo_billetes = fondo_fijo_billetes
      }
    }

    const { data, error } = await supabase
      .from('cierres_pos')
      .update(updateData)
      .eq('id', req.params.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) throw error

    // Recalcular diferencias_apertura del cierre siguiente (si existe)
    const nuevoCambioBilletes = cambio_billetes || {}
    const nuevoCambioMonedas = cambio_monedas || {}

    logger.info('[editar-conteo-pos] Buscando cierre siguiente para caja_id:', cierre.caja_id, 'después de:', cierre.created_at)

    const { data: siguientes, error: errorSig } = await supabase
      .from('cierres_pos')
      .select('id, apertura_at, fondo_fijo_billetes, fondo_fijo_monedas')
      .eq('caja_id', cierre.caja_id)
      .gt('created_at', cierre.created_at)
      .order('created_at', { ascending: true })
      .limit(1)

    logger.info('[editar-conteo-pos] Resultado búsqueda siguiente:', { encontrados: siguientes?.length, error: errorSig?.message })

    if (siguientes && siguientes.length > 0) {
      const siguienteCierre = siguientes[0]
      const fondoBilletes = siguienteCierre.fondo_fijo_billetes || {}
      const fondoMonedas = siguienteCierre.fondo_fijo_monedas || {}
      const diferencias = {}

      logger.info('[editar-conteo-pos] Cierre siguiente:', siguienteCierre.apertura_at, '| cambio editado:', nuevoCambioBilletes, '| fondo siguiente:', fondoBilletes)

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

      logger.info('[editar-conteo-pos] Diferencias recalculadas:', Object.keys(diferencias).length > 0 ? diferencias : 'NINGUNA')

      await supabase
        .from('cierres_pos')
        .update({ diferencias_apertura: Object.keys(diferencias).length > 0 ? diferencias : null })
        .eq('id', siguienteCierre.id)
    }

    res.json(data)
  } catch (err) {
    logger.error('Error al editar conteo POS:', err)
    res.status(500).json({ error: 'Error al editar conteo POS' })
  }
}))

// GET /api/cierres-pos/:id/verificacion — obtener la verificación de un cierre POS
router.get('/:id/verificacion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    if (req.perfil.rol === 'operario') {
      return res.status(403).json({ error: 'No tenés acceso a la verificación' })
    }

    const { data, error } = await supabase
      .from('verificaciones_pos')
      .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
      .eq('cierre_pos_id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'No hay verificación para este cierre POS' })
    }

    res.json(data)
  } catch (err) {
    logger.error('Error al obtener verificación POS:', err)
    res.status(500).json({ error: 'Error al obtener verificación POS' })
  }
}))

// POST /api/cierres-pos/:id/verificar — gestor/admin marca cierre como verificado
router.post('/:id/verificar', verificarAuth, soloGestorOAdmin, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('*, caja:cajas(id, sucursal_id)')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    if (cierre.estado !== 'pendiente_gestor') {
      return res.status(400).json({ error: 'Este cierre no está pendiente de verificación' })
    }

    // Gestor: verificar misma sucursal (via caja)
    if (req.perfil.rol === 'gestor' && cierre.caja?.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
    }

    const { data, error } = await supabase
      .from('cierres_pos')
      .update({ estado: 'pendiente_agente' })
      .eq('id', cierre.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) throw error

    res.json(data)
  } catch (err) {
    logger.error('Error al verificar cierre POS:', err)
    res.status(500).json({ error: 'Error al verificar cierre POS' })
  }
}))

// GET /api/cierres-pos/:id/guia-delivery — guía de delivery vinculada al cierre
router.get('/:id/guia-delivery', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: guia, error } = await supabase
      .from('guias_delivery')
      .select('*, guia_delivery_pedidos(*, pedido:pedidos_pos(id, numero, nombre_cliente, total, observaciones, items))')
      .eq('cierre_pos_id', req.params.id)
      .single()

    if (error || !guia) {
      return res.status(404).json({ error: 'No se encontró guía de delivery para este cierre' })
    }

    res.json(guia)
  } catch (err) {
    logger.error('Error al obtener guía delivery:', err)
    res.status(500).json({ error: 'Error al obtener guía delivery' })
  }
}))

// GET /api/cierres-pos/:id/pos-ventas — ventas POS vinculadas al cierre
router.get('/:id/pos-ventas', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, caja_id, apertura_at, cierre_at, estado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const SELECT_VENTAS = 'id, numero_venta, total, monto_pagado, vuelto, pagos, descuento_forma_pago, nombre_cliente, items, gift_cards_vendidas, created_at, tipo, anulada, centum_comprobante, id_cliente_centum'

    // Primero: buscar ventas vinculadas directamente por cierre_pos_id
    let { data: ventas, error: errorVentas } = await supabase
      .from('ventas_pos')
      .select(SELECT_VENTAS)
      .eq('cierre_pos_id', cierre.id)
      .order('created_at', { ascending: true })

    if (errorVentas) throw errorVentas

    // Fallback: si no hay ventas por cierre_pos_id, buscar por caja_id + rango de tiempo (ventas históricas sin cierre_pos_id)
    if (!ventas || ventas.length === 0) {
      const desde = cierre.apertura_at
      const hasta = cierre.cierre_at || new Date().toISOString()
      const { data: ventasFallback, error: errorFallback } = await supabase
        .from('ventas_pos')
        .select(SELECT_VENTAS)
        .eq('caja_id', cierre.caja_id)
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at', { ascending: true })
      if (errorFallback) throw errorFallback
      ventas = ventasFallback || []
    }

    if (!ventas) ventas = []

    // Gift cards activadas ya están incluidas como ventas_pos normales (con caja_id y pagos correctos)
    // No se consultan por separado

    // ── Pagos anticipados de pedidos (cobrados en este cierre pero sin venta aún) ──
    const desde = cierre.apertura_at
    const hasta = cierre.cierre_at || new Date().toISOString()
    let pedidosAnticipados = []
    try {
      const { data: pedAnt } = await supabase
        .from('pedidos_pos')
        .select('id, numero, nombre_cliente, total, total_pagado, pagos, cobrado_at, cobrado_por, descuento_forma_pago')
        .eq('caja_cobro_id', cierre.caja_id)
        .gte('cobrado_at', desde)
        .lte('cobrado_at', hasta)
        .not('pagos', 'is', null)
      pedidosAnticipados = (pedAnt || []).filter(p => Array.isArray(p.pagos) && p.pagos.length > 0)
    } catch (errPed) {
      logger.error('Error al consultar pedidos anticipados para cierre:', errPed.message)
    }

    // Separar ventas de empleados (cuenta_corriente), Talo Pay y Pago anticipado del resto
    const ventasEmpleados = []
    const ventasTaloPay = []
    const ventasPagoAnticipado = []
    const ventasNormales = []
    ;(ventas || []).forEach(v => {
      const pagos = v.pagos || []
      const esCuentaCorriente = pagos.some(p => (p.tipo || '').toLowerCase() === 'cuenta_corriente')
      const esTaloPay = pagos.some(p => (p.tipo || '').toLowerCase() === 'talo pay')
      const esPagoAnticipado = pagos.some(p => (p.tipo || '').toLowerCase() === 'pago anticipado')
      if (esCuentaCorriente) {
        ventasEmpleados.push(v)
      } else if (esTaloPay) {
        ventasTaloPay.push(v)
      } else if (esPagoAnticipado) {
        ventasPagoAnticipado.push(v)
      } else {
        ventasNormales.push(v)
      }
    })

    // Aggregate payments by type (solo ventas normales)
    const mediosPago = {}
    let totalEfectivo = 0
    let totalGeneral = 0

    ventasNormales.forEach(v => {
      totalGeneral += parseFloat(v.total) || 0
      const pagos = v.pagos || []
      const vuelto = parseFloat(v.vuelto) || 0
      const tieneEfectivo = pagos.some(p => (p.tipo || 'Efectivo') === 'Efectivo')
      pagos.forEach(p => {
        const tipo = p.tipo || 'Efectivo'
        if (!mediosPago[tipo]) mediosPago[tipo] = { nombre: tipo, total: 0, cantidad: 0 }
        mediosPago[tipo].total += parseFloat(p.monto) || 0
        mediosPago[tipo].cantidad += 1
      })
      // Descontar vuelto del efectivo (el vuelto sale de la caja)
      if (tieneEfectivo && vuelto > 0 && mediosPago['Efectivo']) {
        mediosPago['Efectivo'].total -= vuelto
      }
    })

    // ── Sumar pagos anticipados de pedidos al cierre ──
    // Estos pedidos se cobraron en esta caja/cierre pero la venta se crea al entregar.
    // Se suman al efectivo y medios para que el cierre refleje el dinero físico recibido.
    const pagosAnticipadosMedios = {}
    let totalPagosAnticipados = 0
    pedidosAnticipados.forEach(ped => {
      const pagos = ped.pagos || []
      pagos.forEach(p => {
        const tipo = p.tipo || 'Efectivo'
        const tipoLower = tipo.toLowerCase()
        // Talo Pay se concilia aparte, no impacta en caja
        if (tipoLower === 'talo pay') return
        const monto = parseFloat(p.monto) || 0
        totalPagosAnticipados += monto
        // Sumar al mediosPago general del cierre
        if (!mediosPago[tipo]) mediosPago[tipo] = { nombre: tipo, total: 0, cantidad: 0 }
        mediosPago[tipo].total += monto
        mediosPago[tipo].cantidad += 1
        // Track para la sección separada
        if (!pagosAnticipadosMedios[tipo]) pagosAnticipadosMedios[tipo] = 0
        pagosAnticipadosMedios[tipo] += monto
      })
    })
    totalGeneral += totalPagosAnticipados

    // Calculate efectivo from medios
    if (mediosPago['Efectivo']) {
      totalEfectivo = mediosPago['Efectivo'].total
    }

    // Separar cupones Mercado Pago del cuadro comparativo
    const TIPOS_MP = ['posnet mp', 'qr mp']
    const cuponesMPDetalle = []
    ventasNormales.forEach(v => {
      const pagos = v.pagos || []
      const esNC = v.tipo === 'nota_credito'
      pagos.forEach(p => {
        if (TIPOS_MP.includes((p.tipo || '').toLowerCase())) {
          cuponesMPDetalle.push({
            venta_id: v.id,
            numero_venta: v.numero_venta,
            tipo: p.tipo,
            monto: parseFloat(p.monto) || 0,
            mp_payment_id: p.detalle?.mp_payment_id || null,
            mp_order_id: p.detalle?.mp_order_id || null,
            payment_type: p.detalle?.payment_type || null,
            card_last_four: p.detalle?.card_last_four || null,
            card_brand: p.detalle?.card_brand || null,
            operation_number: p.detalle?.operation_number || null,
            mp_problema: p.detalle?.mp_problema || null,
            mp_problema_desc: p.detalle?.mp_problema_desc || null,
            created_at: v.created_at,
            es_anulacion: esNC,
            venta_origen_id: esNC ? v.venta_origen_id : null,
          })
        }
      })
    })

    const cuponesNormales = cuponesMPDetalle.filter(c => !c.es_anulacion)
    const cuponesAnulaciones = cuponesMPDetalle.filter(c => c.es_anulacion)
    const cuponesMP = {
      total: parseFloat(cuponesMPDetalle.reduce((s, c) => s + c.monto, 0).toFixed(2)),
      cantidad: cuponesMPDetalle.length,
      posnet: cuponesNormales.filter(c => c.tipo.toLowerCase() === 'posnet mp').length,
      qr: cuponesNormales.filter(c => c.tipo.toLowerCase() === 'qr mp').length,
      anulaciones: cuponesAnulaciones.length,
      problemas: cuponesMPDetalle.filter(c => c.mp_problema).length,
      detalle: cuponesMPDetalle,
    }

    // Excluir MP del cuadro comparativo
    const mediosPagoArray = Object.values(mediosPago).filter(mp => !TIPOS_MP.includes(mp.nombre.toLowerCase()))

    // Retiros de empleados — buscar items completos de ventas_empleados (tienen precio_original y descuento_pct)
    let ventasEmpleadosDB = []
    if (ventasEmpleados.length > 0) {
      const desdeEmp = cierre.apertura_at
      const hastaEmp = cierre.cierre_at || new Date().toISOString()
      const { data: veDB } = await supabase
        .from('ventas_empleados')
        .select('id, empleado:empleados(id, nombre), items, total, created_at')
        .eq('caja_id', cierre.caja_id)
        .gte('created_at', desdeEmp)
        .lte('created_at', hastaEmp)
        .order('created_at', { ascending: true })
      ventasEmpleadosDB = veDB || []
    }

    const totalRetiroEmpleados = ventasEmpleados.reduce((s, v) => s + (parseFloat(v.total) || 0), 0)
    const retiroEmpleadosDetalle = ventasEmpleados.map(v => {
      const nombre = (v.nombre_cliente || '').replace(/^Empleado:\s*/i, '')
      // Buscar items de ventas_empleados por coincidencia de created_at y total
      const veMatch = ventasEmpleadosDB.find(ve =>
        ve.created_at === v.created_at || (Math.abs(parseFloat(ve.total) - parseFloat(v.total)) < 0.01 && ve.empleado?.nombre === nombre)
      )
      let items = []
      if (veMatch) {
        try { items = typeof veMatch.items === 'string' ? JSON.parse(veMatch.items) : (veMatch.items || []) } catch {}
      } else {
        try { items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || []) } catch {}
      }
      return {
        id: v.id,
        numero_venta: v.numero_venta,
        empleado_nombre: veMatch?.empleado?.nombre || nombre,
        total: parseFloat(v.total) || 0,
        items,
        created_at: v.created_at,
      }
    })

    // Total general del cuadro comparativo = solo medios que aparecen en el cuadro (excluye MP y cuenta_corriente)
    const totalComparativo = mediosPagoArray.reduce((s, mp) => s + mp.total, 0)

    // Talo Pay — conciliación automática, no impacta en caja
    const totalTaloPay = ventasTaloPay.reduce((s, v) => s + (parseFloat(v.total) || 0), 0)

    res.json({
      total_efectivo: parseFloat(totalEfectivo.toFixed(2)),
      medios_pago: mediosPagoArray,
      total_general: parseFloat(totalComparativo.toFixed(2)),
      total_general_todas: parseFloat(totalGeneral.toFixed(2)),
      cantidad_ventas: ventasNormales.length,
      detalle_ventas: ventasNormales.map(v => ({
        id: v.id,
        numero_venta: v.numero_venta,
        total: v.total,
        vuelto: v.vuelto,
        pagos: v.pagos,
        created_at: v.created_at,
        tipo: v.tipo || 'venta',
        nombre_cliente: v.nombre_cliente,
        venta_origen_id: v.venta_origen_id || null,
      })),
      retiro_empleados: {
        cantidad: ventasEmpleados.length,
        total: parseFloat(totalRetiroEmpleados.toFixed(2)),
        detalle: retiroEmpleadosDetalle,
      },
      cupones_mp: cuponesMP,
      notas_credito: (() => {
        const ncs = ventasNormales.filter(v => v.tipo === 'nota_credito')
        return {
          cantidad: ncs.length,
          total: parseFloat(ncs.reduce((s, v) => s + (parseFloat(v.total) || 0), 0).toFixed(2)),
          detalle: ncs.map(v => {
            const pagos = v.pagos || []
            // Buscar venta original para mostrar contexto
            const ventaOrigen = v.venta_origen_id
              ? (ventas || []).find(vo => vo.id === v.venta_origen_id)
              : null
            return {
              id: v.id,
              numero_venta: v.numero_venta,
              total: v.total,
              nombre_cliente: v.nombre_cliente,
              created_at: v.created_at,
              pagos,
              venta_origen_id: v.venta_origen_id,
              venta_origen_numero: ventaOrigen?.numero_venta || null,
              venta_origen_total: ventaOrigen ? parseFloat(ventaOrigen.total) : null,
              centum_comprobante: v.centum_comprobante,
              motivo: ventaOrigen?.anulada_motivo || null,
            }
          }),
        }
      })(),
      talo_pay: {
        cantidad: ventasTaloPay.length,
        total: parseFloat(totalTaloPay.toFixed(2)),
        detalle: ventasTaloPay.map(v => ({
          id: v.id,
          numero_venta: v.numero_venta,
          total: v.total,
          nombre_cliente: v.nombre_cliente,
          created_at: v.created_at,
        })),
      },
      pagos_anticipados: {
        cantidad: pedidosAnticipados.length,
        total: parseFloat(totalPagosAnticipados.toFixed(2)),
        medios: pagosAnticipadosMedios,
        detalle: pedidosAnticipados.map(ped => ({
          id: ped.id,
          numero: ped.numero,
          nombre_cliente: ped.nombre_cliente,
          total_pagado: parseFloat(ped.total_pagado) || parseFloat(ped.total) || 0,
          pagos: ped.pagos,
          cobrado_at: ped.cobrado_at,
          cobrado_por: ped.cobrado_por,
        })),
      },
    })
  } catch (err) {
    logger.error('Error al obtener ventas POS:', err.message)
    res.status(500).json({ error: 'Error al obtener ventas del POS' })
  }
}))

// GET /api/cierres-pos/:id/pedidos-pendientes-pm — chequear pedidos pendientes al cerrar turno PM
// Solo considera "PM" si ya hubo otro cierre cerrado en la misma caja el mismo día.
router.get('/:id/pedidos-pendientes-pm', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error } = await supabase
      .from('cierres_pos')
      .select('id, caja_id, fecha, caja:cajas(sucursal_id)')
      .eq('id', req.params.id)
      .single()

    if (error || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    // ¿Ya hubo un cierre cerrado previo para esta caja en la misma fecha?
    const { count: cierresPreviosCerrados, error: errCount } = await supabase
      .from('cierres_pos')
      .select('id', { count: 'exact', head: true })
      .eq('caja_id', cierre.caja_id)
      .eq('fecha', cierre.fecha)
      .neq('id', cierre.id)
      .neq('estado', 'abierta')

    if (errCount) throw errCount

    const esPM = (cierresPreviosCerrados || 0) > 0
    if (!esPM) {
      return res.json({ es_pm: false, pedidos: [] })
    }

    // Pedidos pendientes con fecha_entrega <= fecha del cierre, de la sucursal de la caja
    const sucursalId = cierre.caja?.sucursal_id
    let query = supabase
      .from('pedidos_pos')
      .select('id, numero, nombre_cliente, tipo, fecha_entrega, turno_entrega, total_pagado, estado, sucursal_id')
      .eq('estado', 'pendiente')
      .lte('fecha_entrega', cierre.fecha)
      .order('fecha_entrega', { ascending: true })
      .order('created_at', { ascending: true })

    if (sucursalId) query = query.eq('sucursal_id', sucursalId)

    const { data: pedidos, error: errPedidos } = await query
    if (errPedidos) throw errPedidos

    res.json({ es_pm: true, pedidos: pedidos || [] })
  } catch (err) {
    logger.error('Error al verificar pedidos pendientes PM:', err)
    res.status(500).json({ error: 'Error al verificar pedidos pendientes' })
  }
}))

// GET /api/cierres-pos/:id/eliminaciones — artículos eliminados del ticket durante el turno
router.get('/:id/eliminaciones', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const [elimRes, cierreRes] = await Promise.all([
      supabase
        .from('pos_eliminaciones_log')
        .select('*')
        .eq('cierre_id', req.params.id)
        .order('fecha', { ascending: true }),
      supabase
        .from('cierres_pos')
        .select('empleado:empleados!empleado_id(nombre)')
        .eq('id', req.params.id)
        .single()
    ])

    if (elimRes.error) throw elimRes.error
    const eliminaciones = elimRes.data || []

    const empleadoNombre = cierreRes.data?.empleado?.nombre
    if (empleadoNombre) {
      eliminaciones.forEach(e => { e.usuario_nombre = empleadoNombre })
    }

    res.json(eliminaciones)
  } catch (err) {
    logger.error('Error al obtener eliminaciones:', err)
    res.status(500).json({ error: err.message })
  }
}))

// GET /api/cierres-pos/:id/cancelaciones — tickets cancelados durante el turno
router.get('/:id/cancelaciones', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const [cancRes, cierreRes] = await Promise.all([
      supabase
        .from('ventas_pos_canceladas')
        .select('*')
        .eq('cierre_id', req.params.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('cierres_pos')
        .select('empleado:empleados!empleado_id(nombre)')
        .eq('id', req.params.id)
        .single()
    ])

    if (cancRes.error) throw cancRes.error
    const cancelaciones = cancRes.data || []

    // Sobreescribir cajero_nombre con el empleado del cierre
    const empleadoNombre = cierreRes.data?.empleado?.nombre
    if (empleadoNombre) {
      cancelaciones.forEach(c => { c.cajero_nombre = empleadoNombre })
    }

    res.json(cancelaciones)
  } catch (err) {
    logger.error('Error al obtener cancelaciones:', err)
    res.status(500).json({ error: err.message })
  }
}))

// DELETE /api/cierres-pos/:id — admin elimina un cierre POS y sus datos relacionados
router.delete('/:id', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre POS no encontrado' })
    }

    // Eliminar en orden: verificaciones_retiros_pos → retiros_pos → gastos_pos → verificaciones_pos → cierres_pos
    const { data: retiros } = await supabase
      .from('retiros_pos')
      .select('id')
      .eq('cierre_pos_id', cierre.id)

    if (retiros && retiros.length > 0) {
      const retiroIds = retiros.map(r => r.id)
      await supabase
        .from('verificaciones_retiros_pos')
        .delete()
        .in('retiro_pos_id', retiroIds)

      await supabase
        .from('retiros_pos')
        .delete()
        .eq('cierre_pos_id', cierre.id)
    }

    await supabase
      .from('gastos_pos')
      .delete()
      .eq('cierre_pos_id', cierre.id)

    await supabase
      .from('verificaciones_pos')
      .delete()
      .eq('cierre_pos_id', cierre.id)

    const { error } = await supabase
      .from('cierres_pos')
      .delete()
      .eq('id', cierre.id)

    if (error) throw error

    res.json({ ok: true })
  } catch (err) {
    logger.error('Error al eliminar cierre POS:', err)
    res.status(500).json({ error: 'Error al eliminar cierre POS' })
  }
}))

// GET /api/cierres-pos/:id/cambios-precio
// Cambios de precio durante un cierre (solo admin)
router.get('/:id/cambios-precio', verificarAuth, asyncHandler(async (req, res) => {
  try {
    if (req.perfil.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' })

    const [cpRes, cierreRes] = await Promise.all([
      supabase
        .from('pos_cambios_precio_log')
        .select('*')
        .eq('cierre_id', req.params.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('cierres_pos')
        .select('empleado:empleados!empleado_id(nombre)')
        .eq('id', req.params.id)
        .single()
    ])

    if (cpRes.error) {
      if (cpRes.error.code === 'PGRST205' || cpRes.error.message?.includes('schema cache')) {
        return res.json([])
      }
      throw cpRes.error
    }
    const cambios = cpRes.data || []

    const empleadoNombre = cierreRes.data?.empleado?.nombre
    if (empleadoNombre) {
      cambios.forEach(cp => { cp.cajero_nombre = empleadoNombre })
    }

    res.json(cambios)
  } catch (err) {
    logger.error('Error al obtener cambios de precio:', err)
    res.status(500).json({ error: 'Error al obtener cambios de precio' })
  }
}))

// GET /api/cierres-pos/:id/movimientos — todos los movimientos cronológicos con saldo acumulado (solo admin)
router.get('/:id/movimientos', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  try {
    // Obtener cierre base
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, caja_id, apertura_at, cierre_at, estado, fondo_fijo, tipo, total_efectivo, cambio_que_queda, efectivo_retirado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const desde = cierre.apertura_at
    const hasta = cierre.cierre_at || new Date().toISOString()

    // Fetch ventas, retiros, gastos en paralelo (solo efectivo)
    const [ventasRes, retirosRes, gastosRes] = await Promise.all([
      supabase
        .from('ventas_pos')
        .select('id, numero_venta, total, monto_pagado, vuelto, pagos, descuento_forma_pago, nombre_cliente, created_at')
        .eq('caja_id', cierre.caja_id)
        .gte('created_at', desde)
        .lte('created_at', hasta)
        .order('created_at', { ascending: true }),
      supabase
        .from('retiros_pos')
        .select('id, numero, total, observaciones, oculto, empleado:empleados!empleado_id(nombre), created_at')
        .eq('cierre_pos_id', req.params.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('gastos_pos')
        .select('id, descripcion, importe, controlado, created_at')
        .eq('cierre_pos_id', req.params.id)
        .order('created_at', { ascending: true }),
    ])

    if (ventasRes.error) throw ventasRes.error

    const movimientos = []

    // Ventas — solo la parte en efectivo
    ;(ventasRes.data || []).forEach(v => {
      const pagos = v.pagos || []
      const vuelto = parseFloat(v.vuelto) || 0

      // Sumar solo pagos en efectivo
      const efectivoBruto = pagos
        .filter(p => (p.tipo || 'Efectivo') === 'Efectivo')
        .reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
      const efectivoNeto = parseFloat((efectivoBruto - vuelto).toFixed(2))

      // Si no hay efectivo en esta venta, no genera movimiento de caja
      if (efectivoNeto === 0 && efectivoBruto === 0) return

      // Resumen de formas de pago
      const formasPago = pagos.map(p => {
        const tipo = p.tipo || 'Efectivo'
        const monto = parseFloat(p.monto) || 0
        return `${tipo} ${formatMontoBack(monto)}`
      })

      movimientos.push({
        tipo: 'venta',
        descripcion: `Venta #${v.numero_venta}${v.nombre_cliente ? ` — ${v.nombre_cliente}` : ''}`,
        detalle: formasPago.join(' + '),
        monto: Math.abs(efectivoNeto),
        signo: efectivoNeto >= 0 ? '+' : '-',
        fecha: v.created_at,
        ref_id: v.id,
        total_venta: parseFloat(v.total) || 0,
      })
    })

    // Gift cards activadas ya están incluidas como ventas_pos normales

    // Retiros (negativo)
    ;(retirosRes.data || []).forEach(r => {
      movimientos.push({
        tipo: 'retiro',
        descripcion: `Retiro #${r.numero}${r.empleado?.nombre ? ` — ${r.empleado.nombre}` : ''}`,
        detalle: r.observaciones || null,
        monto: parseFloat(r.total) || 0,
        signo: '-',
        fecha: r.created_at,
        ref_id: r.id,
      })
    })

    // Gastos (negativo)
    ;(gastosRes.data || []).forEach(g => {
      movimientos.push({
        tipo: 'gasto',
        descripcion: `Gasto: ${g.descripcion}`,
        detalle: g.controlado ? 'Controlado' : 'Sin controlar',
        monto: parseFloat(g.importe) || 0,
        signo: '-',
        fecha: g.created_at,
        ref_id: g.id,
      })
    })

    // Ordenar cronológicamente
    movimientos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

    // Calcular saldo acumulado
    let saldo = 0
    for (const mov of movimientos) {
      if (mov.signo === '+') {
        saldo += mov.monto
      } else if (mov.signo === '-') {
        saldo -= mov.monto
      }
      mov.saldo = parseFloat(saldo.toFixed(2))
    }

    // Calcular totales
    const fondoFijo = parseFloat(cierre.fondo_fijo) || 0
    const ventasEfectivo = movimientos.filter(m => m.tipo === 'venta' && m.signo === '+').reduce((s, m) => s + m.monto, 0)
    const totalRetiros = movimientos.filter(m => m.tipo === 'retiro').reduce((s, m) => s + m.monto, 0)
    const totalGastos = movimientos.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0)

    // Efectivo neto teórico = ventas - retiros - gastos (sin fondo fijo, igual que cuadro comparativo)
    const efectivoNetoTeorico = parseFloat((ventasEfectivo - totalRetiros - totalGastos).toFixed(2))

    // Movimiento de cierre (al final)
    if (cierre.cierre_at && cierre.estado !== 'abierta') {
      const totalEfectivo = parseFloat(cierre.total_efectivo) || 0
      const cambioQueQueda = parseFloat(cierre.cambio_que_queda) || 0
      // Neto cajero = contado + cambio dejado - fondo inicial (misma fórmula que cuadro comparativo)
      const cajeroConto = parseFloat((totalEfectivo + cambioQueQueda - fondoFijo).toFixed(2))
      const efectivoRetirado = totalEfectivo - cambioQueQueda

      movimientos.push({
        tipo: 'cierre',
        descripcion: 'Cierre de caja',
        detalle: `Contó ${formatMontoBack(totalEfectivo)} · Retiró ${formatMontoBack(efectivoRetirado)} · Dejó cambio ${formatMontoBack(cambioQueQueda)}`,
        monto: cajeroConto,
        signo: '=',
        fecha: cierre.cierre_at,
        saldo: efectivoNetoTeorico,
        diferencia: parseFloat((cajeroConto - efectivoNetoTeorico).toFixed(2)),
      })
    }

    res.json({
      movimientos,
      resumen: {
        total_ventas_efectivo: parseFloat(ventasEfectivo.toFixed(2)),
        total_retiros: totalRetiros,
        total_gastos: totalGastos,
        efectivo_neto_teorico: efectivoNetoTeorico,
        saldo_final: parseFloat(saldo.toFixed(2)),
        fondo_fijo: fondoFijo,
      },
    })
  } catch (err) {
    logger.error('Error al obtener movimientos:', err)
    res.status(500).json({ error: 'Error al obtener movimientos' })
  }
}))

function formatMontoBack(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n)
}

module.exports = router
