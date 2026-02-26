// Rutas de cierres de caja y verificaciones
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')

// GET /api/cierres — lista cierres con filtros
router.get('/', verificarAuth, async (req, res) => {
  try {
    let query = supabase
      .from('cierres')
      .select('*, cajero:perfiles!cajero_id(id, nombre, username, sucursal_id, sucursales(id, nombre))')
      .order('created_at', { ascending: false })

    const { rol, sucursal_id } = req.perfil

    if (rol === 'operario') {
      // Operario solo ve sus propios cierres
      query = query.eq('cajero_id', req.perfil.id)
    } else if (rol === 'gestor') {
      // Gestor ve cierres de cajeros de su misma sucursal
      if (!sucursal_id) return res.json([])
      // Filtramos en JS después porque no se puede filtrar por relación anidada fácilmente
    }
    // Admin ve todo

    // Filtros opcionales
    if (req.query.fecha) {
      query = query.eq('fecha', req.query.fecha)
    }
    if (req.query.estado) {
      query = query.eq('estado', req.query.estado)
    }

    const { data, error } = await query
    if (error) throw error

    // Para gestor: filtrar solo cierres de cajeros de su sucursal
    let filtered = data
    if (rol === 'gestor') {
      filtered = data.filter(c => c.cajero?.sucursal_id === sucursal_id)
    }

    res.json(filtered)
  } catch (err) {
    console.error('Error al obtener cierres:', err)
    res.status(500).json({ error: 'Error al obtener cierres' })
  }
})

// GET /api/cierres/:id — detalle de un cierre (CIEGO para gestor)
router.get('/:id', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error } = await supabase
      .from('cierres')
      .select('*, cajero:perfiles!cajero_id(id, nombre, username, sucursal_id, sucursales(id, nombre))')
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

    // Gestor solo puede ver cierres de su sucursal
    if (rol === 'gestor' && cierre.cajero?.sucursal_id !== sucursal_id) {
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
          fecha: cierre.fecha,
          estado: cierre.estado,
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

// POST /api/cierres/abrir — operario/admin abre una caja con planilla de Centum
router.post('/abrir', verificarAuth, async (req, res) => {
  const { rol } = req.perfil

  if (rol === 'gestor') {
    return res.status(403).json({ error: 'Los gestores no pueden abrir cajas' })
  }

  const { planilla_id, fondo_fijo } = req.body

  if (!planilla_id || !planilla_id.toString().trim()) {
    return res.status(400).json({ error: 'El ID de planilla de caja es requerido' })
  }

  try {
    const { data, error } = await supabase
      .from('cierres')
      .insert({
        planilla_id: planilla_id.toString().trim(),
        cajero_id: req.perfil.id,
        fondo_fijo: fondo_fijo || 0,
        estado: 'abierta',
        billetes: {},
        monedas: {},
        total_efectivo: 0,
        total_general: 0,
      })
      .select('*, cajero:perfiles!cajero_id(id, nombre, username)')
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

    // Solo el cajero que abrió o un admin puede cerrar
    if (req.perfil.rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'Solo podés cerrar tu propia caja' })
    }

    const {
      billetes, monedas, total_efectivo,
      cheques, cheques_cantidad,
      vouchers_tc, vouchers_tc_cantidad,
      vouchers_td, vouchers_td_cantidad,
      transferencias, transferencias_cantidad,
      pagos_digitales, pagos_digitales_cantidad,
      otros, otros_detalle,
      total_general, observaciones,
    } = req.body

    const { data, error } = await supabase
      .from('cierres')
      .update({
        billetes: billetes || {},
        monedas: monedas || {},
        total_efectivo: total_efectivo || 0,
        cheques: cheques || 0,
        cheques_cantidad: cheques_cantidad || 0,
        vouchers_tc: vouchers_tc || 0,
        vouchers_tc_cantidad: vouchers_tc_cantidad || 0,
        vouchers_td: vouchers_td || 0,
        vouchers_td_cantidad: vouchers_td_cantidad || 0,
        transferencias: transferencias || 0,
        transferencias_cantidad: transferencias_cantidad || 0,
        pagos_digitales: pagos_digitales || 0,
        pagos_digitales_cantidad: pagos_digitales_cantidad || 0,
        otros: otros || 0,
        otros_detalle: otros_detalle || '',
        total_general: total_general || 0,
        observaciones: observaciones || '',
        estado: 'pendiente_gestor',
      })
      .eq('id', req.params.id)
      .select('*, cajero:perfiles!cajero_id(id, nombre, username)')
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
      .select('*, cajero:perfiles!cajero_id(id, sucursal_id)')
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

    // Gestor: verificar misma sucursal
    if (req.perfil.rol === 'gestor' && cierre.cajero?.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
    }

    const {
      billetes, monedas, total_efectivo,
      cheques, cheques_cantidad,
      vouchers_tc, vouchers_tc_cantidad,
      vouchers_td, vouchers_td_cantidad,
      transferencias, transferencias_cantidad,
      pagos_digitales, pagos_digitales_cantidad,
      otros, otros_detalle,
      total_general, observaciones,
    } = req.body

    const { data: verificacion, error: errorVerif } = await supabase
      .from('verificaciones')
      .insert({
        cierre_id: cierre.id,
        gestor_id: req.perfil.id,
        billetes: billetes || {},
        monedas: monedas || {},
        total_efectivo: total_efectivo || 0,
        cheques: cheques || 0,
        cheques_cantidad: cheques_cantidad || 0,
        vouchers_tc: vouchers_tc || 0,
        vouchers_tc_cantidad: vouchers_tc_cantidad || 0,
        vouchers_td: vouchers_td || 0,
        vouchers_td_cantidad: vouchers_td_cantidad || 0,
        transferencias: transferencias || 0,
        transferencias_cantidad: transferencias_cantidad || 0,
        pagos_digitales: pagos_digitales || 0,
        pagos_digitales_cantidad: pagos_digitales_cantidad || 0,
        otros: otros || 0,
        otros_detalle: otros_detalle || '',
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

module.exports = router
