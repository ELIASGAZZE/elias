// Rutas para push notifications
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth } = require('../middleware/auth')

// GET /api/push/vapid-public-key
// Devuelve la clave pública VAPID para que el frontend se suscriba
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY })
})

// POST /api/push/subscribe
// Guarda la suscripción push del browser del usuario
router.post('/subscribe', verificarAuth, async (req, res) => {
  try {
    const { endpoint, keys } = req.body

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Suscripción inválida' })
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        perfil_id: req.perfil.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      }, { onConflict: 'perfil_id,endpoint' })

    if (error) throw error

    res.json({ mensaje: 'Suscripción guardada' })
  } catch (err) {
    console.error('Error al guardar suscripción push:', err)
    res.status(500).json({ error: 'Error al guardar suscripción' })
  }
})

// DELETE /api/push/subscribe
// Elimina la suscripción push del usuario
router.delete('/subscribe', verificarAuth, async (req, res) => {
  try {
    const { endpoint } = req.body

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint requerido' })
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('perfil_id', req.perfil.id)
      .eq('endpoint', endpoint)

    if (error) throw error

    res.json({ mensaje: 'Suscripción eliminada' })
  } catch (err) {
    console.error('Error al eliminar suscripción push:', err)
    res.status(500).json({ error: 'Error al eliminar suscripción' })
  }
})

module.exports = router
