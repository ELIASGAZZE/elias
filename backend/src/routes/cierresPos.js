// Rutas de cierres de caja POS y verificaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin, soloGestorOAdmin } = require('../middleware/auth')

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
router.get('/', verificarAuth, async (req, res) => {
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
    console.error('Error al obtener cierres POS:', err)
    res.status(500).json({ error: 'Error al obtener cierres POS' })
  }
})

// GET /api/cierres-pos/abierta?caja_id=X — verificar si la caja tiene un cierre abierto
router.get('/abierta', verificarAuth, async (req, res) => {
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
    console.error('Error al verificar caja abierta POS:', err)
    res.status(500).json({ error: 'Error al verificar caja abierta' })
  }
})

// GET /api/cierres-pos/ultimo-cambio?caja_id=X — último cambio dejado en caja
router.get('/ultimo-cambio', verificarAuth, async (req, res) => {
  const { caja_id } = req.query
  if (!caja_id) {
    return res.status(400).json({ error: 'caja_id es requerido' })
  }

  try {
    const { data, error } = await supabase
      .from('cierres_pos')
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
    console.error('Error al obtener último cambio POS:', err)
    res.json({ cambio_billetes: {}, cambio_monedas: {} })
  }
})

// GET /api/cierres-pos/:id — detalle de un cierre POS (CIEGO para gestor)
router.get('/:id', verificarAuth, async (req, res) => {
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

    // CIEGO: si es gestor y no verificó aún, ocultar montos del cajero
    if (rol === 'gestor' && cierre.estado === 'pendiente_gestor') {
      const { data: verificacion } = await supabase
        .from('verificaciones_pos')
        .select('id')
        .eq('cierre_pos_id', cierre.id)
        .eq('gestor_id', req.perfil.id)
        .single()

      if (!verificacion) {
        return res.json({
          id: cierre.id,
          apertura_at: cierre.apertura_at,
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
          .from('cierres_pos')
          .select('id, apertura_at, cambio_billetes')
          .eq('caja_id', cierre.caja_id)
          .lt('created_at', cierre.created_at)
          .neq('estado', 'abierta')
          .order('created_at', { ascending: false })
          .limit(1),
        supabase
          .from('cierres_pos')
          .select('id, apertura_at, fondo_fijo_billetes')
          .eq('caja_id', cierre.caja_id)
          .gt('created_at', cierre.created_at)
          .order('created_at', { ascending: true })
          .limit(1),
      ])

      if (antRes.data && antRes.data.length > 0) {
        cierre_anterior = {
          apertura_at: antRes.data[0].apertura_at,
          cambio_billetes: antRes.data[0].cambio_billetes || {},
        }
      }

      if (sigRes.data && sigRes.data.length > 0) {
        apertura_siguiente = {
          apertura_at: sigRes.data[0].apertura_at,
          fondo_fijo_billetes: sigRes.data[0].fondo_fijo_billetes || {},
        }
      }
    }

    res.json({ ...cierre, cierre_anterior, apertura_siguiente, _blind: false })
  } catch (err) {
    console.error('Error al obtener cierre POS:', err)
    res.status(500).json({ error: 'Error al obtener cierre POS' })
  }
})

// POST /api/cierres-pos/abrir — operario/admin abre una caja POS
router.post('/abrir', verificarAuth, async (req, res) => {
  const { rol } = req.perfil

  if (rol === 'gestor') {
    return res.status(403).json({ error: 'Los gestores no pueden abrir cajas' })
  }

  const { caja_id, codigo_empleado, fondo_fijo, fondo_fijo_billetes, fondo_fijo_monedas, diferencias_apertura, observaciones_apertura } = req.body

  if (!caja_id) {
    return res.status(400).json({ error: 'Seleccioná una caja' })
  }
  if (!codigo_empleado) {
    return res.status(400).json({ error: 'Ingresá el código del empleado' })
  }

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

    const { data, error } = await supabase
      .from('cierres_pos')
      .insert({
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
    console.error('Error al abrir caja POS:', err)
    res.status(500).json({ error: 'Error al abrir caja POS' })
  }
})

// PUT /api/cierres-pos/:id/cerrar — operario/admin cierra la caja POS con el conteo completo
router.put('/:id/cerrar', verificarAuth, async (req, res) => {
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
        .from('cajas_pos')
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
    console.error('Error al cerrar caja POS:', err)
    res.status(500).json({ error: 'Error al cerrar caja POS' })
  }
})

// PUT /api/cierres-pos/:id/editar-conteo — cajero edita su conteo antes de verificación
router.put('/:id/editar-conteo', verificarAuth, async (req, res) => {
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
      })
      .eq('id', req.params.id)
      .select(SELECT_CIERRE)
      .single()

    if (error) throw error

    // Recalcular diferencias_apertura del cierre siguiente (si existe)
    const nuevoCambioBilletes = cambio_billetes || {}
    const nuevoCambioMonedas = cambio_monedas || {}

    console.log('[editar-conteo-pos] Buscando cierre siguiente para caja_id:', cierre.caja_id, 'después de:', cierre.created_at)

    const { data: siguientes, error: errorSig } = await supabase
      .from('cierres_pos')
      .select('id, apertura_at, fondo_fijo_billetes, fondo_fijo_monedas')
      .eq('caja_id', cierre.caja_id)
      .gt('created_at', cierre.created_at)
      .order('created_at', { ascending: true })
      .limit(1)

    console.log('[editar-conteo-pos] Resultado búsqueda siguiente:', { encontrados: siguientes?.length, error: errorSig?.message })

    if (siguientes && siguientes.length > 0) {
      const siguienteCierre = siguientes[0]
      const fondoBilletes = siguienteCierre.fondo_fijo_billetes || {}
      const fondoMonedas = siguienteCierre.fondo_fijo_monedas || {}
      const diferencias = {}

      console.log('[editar-conteo-pos] Cierre siguiente:', siguienteCierre.apertura_at, '| cambio editado:', nuevoCambioBilletes, '| fondo siguiente:', fondoBilletes)

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

      console.log('[editar-conteo-pos] Diferencias recalculadas:', Object.keys(diferencias).length > 0 ? diferencias : 'NINGUNA')

      await supabase
        .from('cierres_pos')
        .update({ diferencias_apertura: Object.keys(diferencias).length > 0 ? diferencias : null })
        .eq('id', siguienteCierre.id)
    }

    res.json(data)
  } catch (err) {
    console.error('Error al editar conteo POS:', err)
    res.status(500).json({ error: 'Error al editar conteo POS' })
  }
})

// GET /api/cierres-pos/:id/verificacion — obtener la verificación de un cierre POS
router.get('/:id/verificacion', verificarAuth, async (req, res) => {
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
    console.error('Error al obtener verificación POS:', err)
    res.status(500).json({ error: 'Error al obtener verificación POS' })
  }
})

// POST /api/cierres-pos/:id/verificar — gestor/admin envía verificación ciega
router.post('/:id/verificar', verificarAuth, soloGestorOAdmin, async (req, res) => {
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
      .from('verificaciones_pos')
      .insert({
        cierre_pos_id: cierre.id,
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
      .from('cierres_pos')
      .update({ estado: 'pendiente_agente' })
      .eq('id', cierre.id)

    res.status(201).json(verificacion)
  } catch (err) {
    console.error('Error al verificar cierre POS:', err)
    res.status(500).json({ error: 'Error al verificar cierre POS' })
  }
})

// GET /api/cierres-pos/:id/pos-ventas — ventas POS en el rango de tiempo del cierre
router.get('/:id/pos-ventas', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, apertura_at, cierre_at, estado')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const desde = cierre.apertura_at
    const hasta = cierre.cierre_at || new Date().toISOString()

    // Query ventas_pos in the time range for this cajero
    const { data: ventas, error: errorVentas } = await supabase
      .from('ventas_pos')
      .select('id, total, monto_pagado, vuelto, pagos, descuento_forma_pago, created_at')
      .eq('cajero_id', cierre.cajero_id)
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('created_at', { ascending: true })

    if (errorVentas) throw errorVentas

    // Gift cards activadas en el mismo rango (generan movimiento de caja pero no venta)
    const { data: giftCardsActivadas } = await supabase
      .from('gift_cards')
      .select('id, codigo, monto_inicial, pagos, created_at')
      .eq('created_by', cierre.cajero_id)
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .not('pagos', 'is', null)

    // Aggregate payments by type
    const mediosPago = {}
    let totalEfectivo = 0
    let totalGeneral = 0

    ;(ventas || []).forEach(v => {
      totalGeneral += parseFloat(v.total) || 0
      const pagos = v.pagos || []
      pagos.forEach(p => {
        const tipo = p.tipo || 'Efectivo'
        if (!mediosPago[tipo]) mediosPago[tipo] = { nombre: tipo, total: 0, cantidad: 0 }
        mediosPago[tipo].total += parseFloat(p.monto) || 0
        mediosPago[tipo].cantidad += 1
      })
    })

    // Sumar pagos de gift cards activadas al movimiento de caja
    let totalGiftCardsActivadas = 0
    ;(giftCardsActivadas || []).forEach(gc => {
      totalGiftCardsActivadas += parseFloat(gc.monto_inicial) || 0
      const pagos = gc.pagos || []
      pagos.forEach(p => {
        const tipo = p.tipo || 'Efectivo'
        if (!mediosPago[tipo]) mediosPago[tipo] = { nombre: tipo, total: 0, cantidad: 0 }
        mediosPago[tipo].total += parseFloat(p.monto) || 0
        mediosPago[tipo].cantidad += 1
      })
    })

    // Calculate efectivo from medios
    if (mediosPago['Efectivo']) {
      totalEfectivo = mediosPago['Efectivo'].total
    }

    const mediosPagoArray = Object.values(mediosPago)

    res.json({
      total_efectivo: parseFloat(totalEfectivo.toFixed(2)),
      medios_pago: mediosPagoArray,
      total_general: parseFloat((totalGeneral + totalGiftCardsActivadas).toFixed(2)),
      cantidad_ventas: (ventas || []).length,
      gift_cards_activadas: (giftCardsActivadas || []).length,
      total_gift_cards_activadas: parseFloat(totalGiftCardsActivadas.toFixed(2)),
      detalle_ventas: (ventas || []).map(v => ({
        id: v.id,
        total: v.total,
        pagos: v.pagos,
        created_at: v.created_at,
      })),
    })
  } catch (err) {
    console.error('Error al obtener ventas POS:', err)
    res.status(500).json({ error: 'Error al obtener ventas del POS' })
  }
})

// GET /api/cierres-pos/:id/eliminaciones — artículos eliminados del ticket durante el turno
router.get('/:id/eliminaciones', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pos_eliminaciones_log')
      .select('*')
      .eq('cierre_id', req.params.id)
      .order('fecha', { ascending: true })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('Error al obtener eliminaciones:', err)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/cierres-pos/:id/cancelaciones — tickets cancelados durante el turno
router.get('/:id/cancelaciones', verificarAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ventas_pos_canceladas')
      .select('*')
      .eq('cierre_id', req.params.id)
      .order('created_at', { ascending: true })

    if (error) throw error
    res.json(data || [])
  } catch (err) {
    console.error('Error al obtener cancelaciones:', err)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/cierres-pos/:id — admin elimina un cierre POS y sus datos relacionados
router.delete('/:id', verificarAuth, soloAdmin, async (req, res) => {
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
    console.error('Error al eliminar cierre POS:', err)
    res.status(500).json({ error: 'Error al eliminar cierre POS' })
  }
})

module.exports = router
