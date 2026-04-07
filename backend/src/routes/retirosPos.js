// Rutas de retiros de efectivo durante turno (POS)
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')
const logger = require('../config/logger')
const { validate } = require('../middleware/validate')
const { crearRetiroSchema, verificarRetiroSchema } = require('../schemas/retiros')
const asyncHandler = require('../middleware/asyncHandler')

const SELECT_RETIRO = '*, empleado:empleados!empleado_id(id, nombre, codigo)'

// Lock en memoria para evitar retiros duplicados por doble-click
const retirosEnProceso = new Set()

// POST /api/cierres-pos/:cierreId/retiros — crear retiro
router.post('/cierres-pos/:cierreId/retiros', verificarAuth, validate(crearRetiroSchema), asyncHandler(async (req, res) => {
  try {
    const { rol } = req.perfil
    if (rol === 'gestor') {
      return res.status(403).json({ error: 'Los gestores no pueden crear retiros' })
    }

    // Anti-duplicado: lock por cierre + cajero
    const lockKey = `${req.params.cierreId}_${req.perfil.id}`
    if (retirosEnProceso.has(lockKey)) {
      return res.status(409).json({ error: 'Ya hay un retiro en proceso para esta caja' })
    }
    retirosEnProceso.add(lockKey)

    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, estado, caja_id')
      .eq('id', req.params.cierreId)
      .single()

    if (errorCierre || !cierre) {
      retirosEnProceso.delete(lockKey)
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado !== 'abierta') {
      retirosEnProceso.delete(lockKey)
      return res.status(400).json({ error: 'Solo se pueden crear retiros con la caja abierta' })
    }

    if (rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
      retirosEnProceso.delete(lockKey)
      return res.status(403).json({ error: 'Solo podés crear retiros en tu propia caja' })
    }

    const { billetes, monedas, total, observaciones, codigo_empleado } = req.body

    // Resolver empleado por código
    let empleadoId = null
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
      empleadoId = emp.id
    }

    if (!empleadoId) {
      return res.status(400).json({ error: 'Ingresá el código del empleado' })
    }

    // Calcular número secuencial
    const { data: maxData } = await supabase
      .from('retiros_pos')
      .select('numero')
      .eq('cierre_pos_id', cierre.id)
      .order('numero', { ascending: false })
      .limit(1)

    const numero = (maxData && maxData.length > 0 ? maxData[0].numero : 0) + 1

    const { data, error } = await supabase
      .from('retiros_pos')
      .insert({
        cierre_pos_id: cierre.id,
        empleado_id: empleadoId,
        numero,
        billetes: billetes || {},
        monedas: monedas || {},
        total: total || 0,
        observaciones: observaciones || '',
      })
      .select(SELECT_RETIRO)
      .single()

    if (error) {
      retirosEnProceso.delete(lockKey)
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un retiro con ese número' })
      }
      throw error
    }

    retirosEnProceso.delete(lockKey)
    res.status(201).json(data)
  } catch (err) {
    retirosEnProceso.delete(lockKey)
    logger.error('Error al crear retiro:', err)
    res.status(500).json({ error: 'Error al crear retiro' })
  }
}))

// GET /api/cierres-pos/:cierreId/retiros — listar retiros de un cierre
router.get('/cierres-pos/:cierreId/retiros', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, estado, caja_id')
      .eq('id', req.params.cierreId)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const { rol } = req.perfil

    // Operario y gestor: verificar misma sucursal
    if (rol === 'operario' || rol === 'gestor') {
      const { data: caja } = await supabase
        .from('cajas')
        .select('sucursal_id')
        .eq('id', cierre.caja_id)
        .single()
      if (caja && caja.sucursal_id !== req.perfil.sucursal_id) {
        return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
      }
    }

    // Fetch retiros con join empleado (excluir ocultos como cambio delivery)
    const { data: retiros, error } = await supabase
      .from('retiros_pos')
      .select(SELECT_RETIRO)
      .eq('cierre_pos_id', cierre.id)
      .neq('oculto', true)
      .order('numero', { ascending: true })

    if (error) throw error

    // Left join: verificación de cada retiro
    const retiroIds = retiros.map(r => r.id)
    let verificacionesMap = {}
    if (retiroIds.length > 0) {
      const { data: verifs } = await supabase
        .from('verificaciones_retiros_pos')
        .select('retiro_pos_id, id, gestor_id, total, created_at')
        .in('retiro_pos_id', retiroIds)

      if (verifs) {
        verifs.forEach(v => { verificacionesMap[v.retiro_pos_id] = v })
      }
    }

    // Blind para gestor: si cierre pendiente_gestor y gestor no verificó ese retiro, ocultar montos
    const resultado = retiros.map(r => {
      const verif = verificacionesMap[r.id]
      const tieneVerificacion = !!verif

      if (rol === 'gestor' && cierre.estado === 'pendiente_gestor' && !tieneVerificacion) {
        return {
          id: r.id,
          cierre_pos_id: r.cierre_pos_id,
          empleado_id: r.empleado_id,
          numero: r.numero,
          empleado: r.empleado,
          observaciones: r.observaciones,
          created_at: r.created_at,
          verificado: false,
          _blind: true,
        }
      }

      return {
        ...r,
        verificado: tieneVerificacion,
        verificacion_total: verif?.total || null,
        _blind: false,
      }
    })

    res.json(resultado)
  } catch (err) {
    logger.error('Error al listar retiros:', err)
    res.status(500).json({ error: 'Error al listar retiros' })
  }
}))

// GET /api/retiros-pos/:id — detalle de un retiro
router.get('/retiros-pos/:id', verificarAuth, asyncHandler(async (req, res) => {
  try {
    const { data: retiro, error } = await supabase
      .from('retiros_pos')
      .select(`${SELECT_RETIRO}, cierre:cierres_pos!cierre_pos_id(id, cajero_id, estado, caja_id, planilla_id, caja:cajas(id, nombre, sucursal_id, sucursales(id, nombre)))`)
      .eq('id', req.params.id)
      .single()

    if (error || !retiro) {
      return res.status(404).json({ error: 'Retiro no encontrado' })
    }

    const { rol } = req.perfil

    // Blind: si gestor y cierre pendiente_gestor, verificar si ya verificó
    if (rol === 'gestor' && retiro.cierre?.estado === 'pendiente_gestor') {
      const { data: verif } = await supabase
        .from('verificaciones_retiros_pos')
        .select('id')
        .eq('retiro_pos_id', retiro.id)
        .single()

      if (!verif) {
        return res.json({
          id: retiro.id,
          cierre_pos_id: retiro.cierre_pos_id,
          empleado_id: retiro.empleado_id,
          numero: retiro.numero,
          empleado: retiro.empleado,
          cierre: retiro.cierre,
          observaciones: retiro.observaciones,
          created_at: retiro.created_at,
          _blind: true,
        })
      }
    }

    res.json({ ...retiro, _blind: false })
  } catch (err) {
    logger.error('Error al obtener retiro:', err)
    res.status(500).json({ error: 'Error al obtener retiro' })
  }
}))

// POST /api/retiros-pos/:id/verificar — verificación ciega de retiro
router.post('/retiros-pos/:id/verificar', verificarAuth, soloGestorOAdmin, validate(verificarRetiroSchema), asyncHandler(async (req, res) => {
  try {
    const { data: retiro, error: errorRetiro } = await supabase
      .from('retiros_pos')
      .select('id, cierre_pos_id, cierre:cierres_pos!cierre_pos_id(id, cajero_id, caja_id, caja:cajas(id, sucursal_id))')
      .eq('id', req.params.id)
      .single()

    if (errorRetiro || !retiro) {
      return res.status(404).json({ error: 'Retiro no encontrado' })
    }

    // Gestor ≠ cajero del cierre
    if (retiro.cierre?.cajero_id === req.perfil.id) {
      return res.status(403).json({ error: 'No podés verificar retiros de tu propia caja' })
    }

    // Gestor: misma sucursal
    if (req.perfil.rol === 'gestor' && retiro.cierre?.caja?.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
    }

    const { billetes, monedas, total, observaciones } = req.body

    const { data: verificacion, error: errorVerif } = await supabase
      .from('verificaciones_retiros_pos')
      .insert({
        retiro_pos_id: retiro.id,
        gestor_id: req.perfil.id,
        billetes: billetes || {},
        monedas: monedas || {},
        total: total || 0,
        observaciones: observaciones || '',
      })
      .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
      .single()

    if (errorVerif) {
      if (errorVerif.code === '23505') {
        return res.status(409).json({ error: 'Este retiro ya tiene una verificación' })
      }
      throw errorVerif
    }

    res.status(201).json(verificacion)
  } catch (err) {
    logger.error('Error al verificar retiro:', err)
    res.status(500).json({ error: 'Error al verificar retiro' })
  }
}))

// GET /api/retiros-pos/:id/verificacion — obtener verificación de un retiro
router.get('/retiros-pos/:id/verificacion', verificarAuth, asyncHandler(async (req, res) => {
  try {
    if (req.perfil.rol === 'operario') {
      return res.status(403).json({ error: 'No tenés acceso a la verificación' })
    }

    const { data, error } = await supabase
      .from('verificaciones_retiros_pos')
      .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
      .eq('retiro_pos_id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'No hay verificación para este retiro' })
    }

    res.json(data)
  } catch (err) {
    logger.error('Error al obtener verificación de retiro:', err)
    res.status(500).json({ error: 'Error al obtener verificación' })
  }
}))

module.exports = router
