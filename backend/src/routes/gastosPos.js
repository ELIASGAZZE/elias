// Rutas de gastos durante turno de caja (POS)
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloGestorOAdmin } = require('../middleware/auth')

// POST /api/cierres-pos/:cierreId/gastos — crear gasto
router.post('/cierres-pos/:cierreId/gastos', verificarAuth, async (req, res) => {
  try {
    const { rol } = req.perfil
    if (rol === 'gestor') {
      return res.status(403).json({ error: 'Los gestores no pueden crear gastos' })
    }

    const { data: cierre, error: errorCierre } = await supabase
      .from('cierres_pos')
      .select('id, cajero_id, estado')
      .eq('id', req.params.cierreId)
      .single()

    if (errorCierre || !cierre) {
      return res.status(404).json({ error: 'Cierre no encontrado' })
    }

    if (cierre.estado !== 'abierta') {
      return res.status(400).json({ error: 'Solo se pueden crear gastos con la caja abierta' })
    }

    if (rol === 'operario' && cierre.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'Solo podés crear gastos en tu propia caja' })
    }

    const { descripcion, importe } = req.body

    if (!descripcion || !descripcion.trim()) {
      return res.status(400).json({ error: 'La descripción es obligatoria' })
    }

    if (!importe || importe <= 0) {
      return res.status(400).json({ error: 'El importe debe ser mayor a $0' })
    }

    const { data, error } = await supabase
      .from('gastos_pos')
      .insert({
        cierre_pos_id: cierre.id,
        descripcion: descripcion.trim(),
        importe,
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    console.error('Error al crear gasto:', err)
    res.status(500).json({ error: 'Error al crear gasto' })
  }
})

// GET /api/cierres-pos/:cierreId/gastos — listar gastos de un cierre
router.get('/cierres-pos/:cierreId/gastos', verificarAuth, async (req, res) => {
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

    const { data: gastos, error } = await supabase
      .from('gastos_pos')
      .select('*, controlado_por_perfil:perfiles!controlado_por(id, nombre)')
      .eq('cierre_pos_id', cierre.id)
      .order('created_at', { ascending: true })

    if (error) throw error

    res.json(gastos || [])
  } catch (err) {
    console.error('Error al listar gastos:', err)
    res.status(500).json({ error: 'Error al listar gastos' })
  }
})

// PUT /api/gastos-pos/:id/controlar — marcar gasto como controlado (gestor/admin)
router.put('/gastos-pos/:id/controlar', verificarAuth, soloGestorOAdmin, async (req, res) => {
  try {
    const { data: gasto, error: errorGasto } = await supabase
      .from('gastos_pos')
      .select('id, cierre_pos_id, controlado, cierre:cierres_pos!cierre_pos_id(id, cajero_id, caja_id, caja:cajas(id, sucursal_id))')
      .eq('id', req.params.id)
      .single()

    if (errorGasto || !gasto) {
      return res.status(404).json({ error: 'Gasto no encontrado' })
    }

    // Gestor ≠ cajero del cierre
    if (gasto.cierre?.cajero_id === req.perfil.id) {
      return res.status(403).json({ error: 'No podés controlar gastos de tu propia caja' })
    }

    // Gestor: misma sucursal
    if (req.perfil.rol === 'gestor' && gasto.cierre?.caja?.sucursal_id !== req.perfil.sucursal_id) {
      return res.status(403).json({ error: 'No tenés acceso a esta sucursal' })
    }

    const { controlado } = req.body

    const { data, error } = await supabase
      .from('gastos_pos')
      .update({
        controlado: controlado !== false,
        controlado_por: controlado !== false ? req.perfil.id : null,
        controlado_at: controlado !== false ? new Date().toISOString() : null,
      })
      .eq('id', req.params.id)
      .select('*, controlado_por_perfil:perfiles!controlado_por(id, nombre)')
      .single()

    if (error) throw error

    res.json(data)
  } catch (err) {
    console.error('Error al controlar gasto:', err)
    res.status(500).json({ error: 'Error al controlar gasto' })
  }
})

// DELETE /api/gastos-pos/:id — eliminar gasto (solo si caja abierta)
router.delete('/gastos-pos/:id', verificarAuth, async (req, res) => {
  try {
    const { data: gasto, error: errorGasto } = await supabase
      .from('gastos_pos')
      .select('id, cierre_pos_id, cierre:cierres_pos!cierre_pos_id(id, cajero_id, estado)')
      .eq('id', req.params.id)
      .single()

    if (errorGasto || !gasto) {
      return res.status(404).json({ error: 'Gasto no encontrado' })
    }

    if (gasto.cierre?.estado !== 'abierta') {
      return res.status(400).json({ error: 'Solo se pueden eliminar gastos con la caja abierta' })
    }

    const { rol } = req.perfil
    if (rol === 'operario' && gasto.cierre?.cajero_id !== req.perfil.id) {
      return res.status(403).json({ error: 'Solo podés eliminar gastos de tu propia caja' })
    }

    const { error } = await supabase
      .from('gastos_pos')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error

    res.json({ ok: true })
  } catch (err) {
    console.error('Error al eliminar gasto:', err)
    res.status(500).json({ error: 'Error al eliminar gasto' })
  }
})

module.exports = router
