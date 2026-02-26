// Rutas para consultar logs de APIs externas
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// GET /api/api-logs
// Admin: devuelve los últimos 100 logs ordenados por fecha descendente
router.get('/', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('api_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener api_logs:', err)
    res.status(500).json({ error: 'Error al obtener logs' })
  }
})

// GET /api/api-logs/errores-recientes
// Admin: devuelve cantidad de errores en las últimas 24hs (para badge de notificación)
router.get('/errores-recientes', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const hace24hs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { count, error } = await supabase
      .from('api_logs')
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'error')
      .gte('created_at', hace24hs)

    if (error) throw error
    res.json({ cantidad: count || 0 })
  } catch (err) {
    console.error('Error al obtener errores recientes:', err)
    res.status(500).json({ error: 'Error al obtener errores' })
  }
})

module.exports = router
