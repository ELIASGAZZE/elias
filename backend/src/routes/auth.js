// Rutas de autenticación
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { verificarAuth } = require('../middleware/auth')

// POST /api/auth/login
// Recibe email y contraseña, devuelve token de sesión
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' })
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return res.status(401).json({ error: 'Credenciales incorrectas' })
    }

    // Obtenemos el perfil con la sucursal del usuario
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('*, sucursales(id, nombre)')
      .eq('user_id', data.user.id)
      .single()

    res.json({
      token: data.session.access_token,
      usuario: {
        id: data.user.id,
        email: data.user.email,
        rol: perfil.rol,
        sucursal: perfil.sucursales,
        nombre: perfil.nombre,
      },
    })
  } catch (err) {
    console.error('Error en login:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/auth/logout
// Cierra la sesión del usuario
router.post('/logout', verificarAuth, async (req, res) => {
  try {
    await supabase.auth.signOut()
    res.json({ mensaje: 'Sesión cerrada correctamente' })
  } catch (err) {
    console.error('Error en logout:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /api/auth/me
// Devuelve los datos del usuario autenticado
router.get('/me', verificarAuth, (req, res) => {
  res.json({
    id: req.usuario.id,
    email: req.usuario.email,
    rol: req.perfil.rol,
    sucursal: req.perfil.sucursales,
    nombre: req.perfil.nombre,
  })
})

module.exports = router
