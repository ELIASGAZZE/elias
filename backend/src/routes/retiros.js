// Rutas de retiros de efectivo durante turno
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')

const SELECT_RETIRO = '*, empleado:empleados!empleado_id(id, nombre, codigo)'

// POST /api/cierres/:cierreId/retiros — crear retiro
router.post('/cierres/:cierreId/retiros', verificarAuth, async (req, res) => {
  try {
    const { rol } = req.perfil
    if (rol === 'gestor') {
      return res.status(403).json({ error: 'Los gestores no pueden crear retiros' })
    }

    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, cajero_id, estado, caja_id')
      .eq('id', req.params.cierreId)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado !== 'abierta') {
      return res.status(400).json({ error: 'Solo se pueden crear retiros con la caja abierta' })
    }

    if (rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
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
      .from('retiros')
      .select('numero')
      .eq('cierre_id', cierre.id)
      .order('numero', { ascending: false })
      .limit(1)

    const numero = (maxData && maxData.length > 0 ? maxData[0].numero : 0) + 1

    const { data, error } = await supabase
      .from('retiros')
      .insert({
        cierre_id: cierre.id,
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
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un retiro con ese número' })
      }
      throw error
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear retiro:', err)
    res.status(500).json({ error: 'Error al crear retiro' })
  }
})

// GET /api/cierres/:cierreId/retiros — listar retiros de un cierre
router.get('/cierres/:cierreId/retiros', verificarAuth, async (req, res) => {
  try {
    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres')
      .select('id, cajero_id, estado, caja_id')
      .eq('id', req.params.cierreId)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    const { rol } = req.perfil

    // Operario solo puede ver sus propios cierres
    if (rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'No tenés acceso a este cierre' })
    }

    // Gestor: verificar misma sucursal
    if (rol === 'gestor') {
      const { data: caja } = await supabase
        .from('cajas')
        .select('sucursal_id')
        .eq('id', cierre.caja_id)
        .single()
      if (caja && caja.sucursal_id !== req.perfil.sucursal_id) {
        return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
      }
    }

    // Fetch retiros con join empleado
    const { data: retiros, error } = await supabase
      .from('retiros')
      .select(SELECT_RETIRO)
      .eq('cierre_id', cierre.id)
      .order('numero', { ascending: true })

    if (error) throw error

    // Left join: verificación de cada retiro
    const retiroIds = retiros.map(r => r.id)
    let verificacionesMap = {}
    if (retiroIds.length > 0) {
      const { data: verifs } = await supabase
        .from('verificaciones_retiros')
        .select('retiro_id, id, gestor_id, total, created_at')
        .in('retiro_id', retiroIds)

      if (verifs) {
        verifs.forEach(v => { verificacionesMap[v.retiro_id] = v })
      }
    }

    // Blind para gestor: si cierre pendiente_gestor y gestor no verificó ese retiro, ocultar montos
    const resultado = retiros.map(r => {
      const verif = verificacionesMap[r.id]
      const tieneVerificacion = !!verif

      if (rol === 'gestor' && cierre.estado === 'pendiente_gestor' && !tieneVerificacion) {
        return {
          id: r.id,
          cierre_id: r.cierre_id,
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
    console.error('Error al listar retiros:', err)
    res.status(500).json({ error: 'Error al listar retiros' })
  }
})

// GET /api/retiros/:id — detalle de un retiro
router.get('/retiros/:id', verificarAuth, async (req, res) => {
  try {
    const { data: retiro, error } = await supabase
      .from('retiros')
      .select(`${SELECT_RETIRO}, cierre:cierres!cierre_id(id, cajero_id, estado, caja_id, planilla_id, caja:cajas(id, nombre, sucursal_id, sucursales(id, nombre)))`)
      .eq('id', req.params.id)
      .single()

    if (error || !retiro) {
      return res.status(404).json({ error: 'Retiro no encontrado' })
    }

    const { rol } = req.perfil

    // Blind: si gestor y cierre pendiente_gestor, verificar si ya verificó
    if (rol === 'gestor' && retiro.cierre?.estado === 'pendiente_gestor') {
      const { data: verif } = await supabase
        .from('verificaciones_retiros')
        .select('id')
        .eq('retiro_id', retiro.id)
        .single()

      if (!verif) {
        return res.json({
          id: retiro.id,
          cierre_id: retiro.cierre_id,
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
    console.error('Error al obtener retiro:', err)
    res.status(500).json({ error: 'Error al obtener retiro' })
  }
})

// POST /api/retiros/:id/verificar — verificación ciega de retiro
router.post('/retiros/:id/verificar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: retiro, error: errorRetiro } = await supabase
      .from('retiros')
      .select('id, cierre_id, cierre:cierres!cierre_id(id, cajero_id, caja_id, caja:cajas(id, sucursal_id))')
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
      .from('verificaciones_retiros')
      .insert({
        retiro_id: retiro.id,
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
    console.error('Error al verificar retiro:', err)
    res.status(500).json({ error: 'Error al verificar retiro' })
  }
})

// GET /api/retiros/:id/verificacion — obtener verificación de un retiro
router.get('/retiros/:id/verificacion', verificarAuth, async (req, res) => {
  try {
    if (req.perfil.rol === 'operario') {
      return res.status(403).json({ error: 'No tenés acceso a la verificación' })
    }

    const { data, error } = await supabase
      .from('verificaciones_retiros')
      .select('*, gestor:perfiles!gestor_id(id, nombre, username)')
      .eq('retiro_id', req.params.id)
      .single()

    if (error || !data) {
      return res.status(404).json({ error: 'No hay verificación para este retiro' })
    }

    res.json(data)
  } catch (err) {
    console.error('Error al obtener verificación de retiro:', err)
    res.status(500).json({ error: 'Error al obtener verificación' })
  }
})

module.exports = router
