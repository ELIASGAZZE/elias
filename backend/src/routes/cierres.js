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
      .select('*, cajas(id, nombre, sucursal_id, sucursales(id, nombre)), cajero:perfiles!cajero_id(id, nombre, username)')
      .order('fecha', { ascending: false })

    const { rol, sucursal_id } = req.perfil

    if (rol === 'operario') {
      // Operario solo ve sus propios cierres
      query = query.eq('cajero_id', req.perfil.id)
    } else if (rol === 'gestor') {
      // Gestor ve cierres de su sucursal
      if (!sucursal_id) return res.json([])
      query = query.eq('cajas.sucursal_id', sucursal_id)
    }
    // Admin ve todo

    // Filtros opcionales
    if (req.query.fecha) {
      query = query.eq('fecha', req.query.fecha)
    }
    if (req.query.estado) {
      query = query.eq('estado', req.query.estado)
    }
    if (req.query.caja_id) {
      query = query.eq('caja_id', req.query.caja_id)
    }
    if (req.query.sucursal_id) {
      query = query.eq('cajas.sucursal_id', req.query.sucursal_id)
    }

    const { data, error } = await query
    if (error) throw error

    // Para gestor: filtrar los que tienen cajas (el inner filter de sucursal_id puede dejar nulls)
    const filtered = rol === 'gestor' ? data.filter(c => c.cajas) : data

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
      .select('*, cajas(id, nombre, sucursal_id, sucursales(id, nombre)), cajero:perfiles!cajero_id(id, nombre, username)')
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
    if (rol === 'gestor' && cierre.cajas.sucursal_id !== sucursal_id) {
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
        // Retornar cierre sin montos
        return res.json({
          id: cierre.id,
          caja_id: cierre.caja_id,
          cajero_id: cierre.cajero_id,
          fecha: cierre.fecha,
          estado: cierre.estado,
          cajas: cierre.cajas,
          cajero: cierre.cajero,
          fondo_fijo: cierre.fondo_fijo,
          created_at: cierre.created_at,
          _blind: true,
        })
      }
    }

    // Operario NO ve la verificación del gestor (solo sus propios montos)
    if (rol === 'operario') {
      return res.json({ ...cierre, _blind: false })
    }

    res.json({ ...cierre, _blind: false })
  } catch (err) {
    console.error('Error al obtener cierre:', err)
    res.status(500).json({ error: 'Error al obtener cierre' })
  }
})

// POST /api/cierres — operario crea cierre
router.post('/', verificarAuth, async (req, res) => {
  const { rol } = req.perfil

  if (rol === 'gestor') {
    return res.status(403).json({ error: 'Los gestores no pueden crear cierres de caja' })
  }

  const {
    caja_id, billetes, monedas, total_efectivo,
    cheques, cheques_cantidad,
    vouchers_tc, vouchers_tc_cantidad,
    vouchers_td, vouchers_td_cantidad,
    transferencias, transferencias_cantidad,
    pagos_digitales, pagos_digitales_cantidad,
    otros, otros_detalle,
    total_general, fondo_fijo, observaciones,
  } = req.body

  if (!caja_id) {
    return res.status(400).json({ error: 'La caja es requerida' })
  }

  try {
    // Verificar que la caja existe y pertenece a la sucursal del operario
    const { data: caja, error: errorCaja } = await supabase
      .from('cajas')
      .select('id, sucursal_id, activo')
      .eq('id', caja_id)
      .single()

    if (errorCaja || !caja) {
      return res.status(404).json({ error: 'Caja no encontrada' })
    }

    if (!caja.activo) {
      return res.status(400).json({ error: 'Esta caja está desactivada' })
    }

    // Operario: verificar que la caja sea de su sucursal
    if (rol === 'operario' && caja.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a esta caja' })
    }

    const { data, error } = await supabase
      .from('cierres')
      .insert({
        caja_id,
        cajero_id: req.perfil.id,
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
        fondo_fijo: fondo_fijo || 0,
        observaciones: observaciones || '',
      })
      .select('*, cajas(id, nombre, sucursales(id, nombre))')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un cierre para esta caja en el día de hoy' })
      }
      throw error
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear cierre:', err)
    res.status(500).json({ error: 'Error al crear cierre' })
  }
})

// GET /api/cierres/:id/verificacion — obtener la verificación de un cierre
router.get('/:id/verificacion', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, cajero_id, cajas(sucursal_id)')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    // Operario no puede ver verificaciones
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
    // Obtener el cierre
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('*, cajas(id, sucursal_id)')
      .eq('id', req.params.id)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    // Validar estado
    if (cierre.estado !== 'pendiente_gestor') {
      return res.status(400).json({ error: 'Este cierre ya fue verificado' })
    }

    // Gestor ≠ cajero
    if (cierre.cajero_id === req.perfil.id) {
      return res.status(403).json({ error: 'No podés verificar tu propio cierre' })
    }

    // Gestor: verificar misma sucursal
    if (req.perfil.rol === 'gestor' && cierre.cajas.sucursal_id !== req.perfil.sucursal_id) {
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

    // Crear verificación
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

    // Cambiar estado del cierre a pendiente_agente
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
