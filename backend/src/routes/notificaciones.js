const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')
const asyncHandler = require('../middleware/asyncHandler')

// GET /api/notificaciones — obtener notificaciones del admin (últimas 50)
router.get('/', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('notificaciones_admin')
    .select('*')
    .or(`perfil_id.eq.${req.perfil.id},perfil_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  res.json(data)
}))

// GET /api/notificaciones/no-leidas — count de no leídas (para badge)
router.get('/no-leidas', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { count, error } = await supabase
    .from('notificaciones_admin')
    .select('id', { count: 'exact', head: true })
    .or(`perfil_id.eq.${req.perfil.id},perfil_id.is.null`)
    .eq('leida', false)

  if (error) throw error
  res.json({ count: count || 0 })
}))

// PUT /api/notificaciones/:id/leer — marcar como leída
router.put('/:id/leer', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('notificaciones_admin')
    .update({ leida: true })
    .eq('id', req.params.id)

  if (error) throw error
  res.json({ ok: true })
}))

// PUT /api/notificaciones/leer-todas — marcar todas como leídas
router.put('/leer-todas', verificarAuth, soloAdmin, asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('notificaciones_admin')
    .update({ leida: true })
    .or(`perfil_id.eq.${req.perfil.id},perfil_id.is.null`)
    .eq('leida', false)

  if (error) throw error
  res.json({ ok: true })
}))

module.exports = router
