// Rutas de cierres de caja y verificaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const { getPlanillaData } = require('../config/centum')

const SELECT_CIERRE = '*, caja:cajas(id, nombre, sucursal_id, sucursales(id, nombre)), empleado:empleados!empleado_id(id, nombre), cajero:perfiles!cajero_id(id, nombre, username, sucursal_id), cerrado_por:empleados!cerrado_por_empleado_id(id, nombre)'

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

    res.json({ ...cierre, _blind: false })
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

module.exports = router
