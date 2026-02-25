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
      console.error('Error de Supabase en login:', error.message)
      return res.status(401).json({ error: 'Credenciales incorrectas', detalle: error.message })
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

// POST /api/auth/setup-admin
// Ruta temporal para crear/recrear el usuario admin
// ELIMINAR después de configurar el sistema
router.post('/setup-admin', async (req, res) => {
  const { email, password, nombre } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' })
  }

  try {
    // Paso 1: Verificar si el usuario ya existe en Auth
    const { data: usuarios } = await supabase.auth.admin.listUsers()
    const existente = usuarios.users.find((u) => u.email === email)

    let userId

    if (existente) {
      // El usuario existe: actualizamos la contraseña y confirmamos el email
      const { data, error } = await supabase.auth.admin.updateUser(existente.id, {
        password,
        email_confirm: true,
      })
      if (error) {
        return res.status(500).json({ error: 'Error actualizando usuario', detalle: error.message })
      }
      userId = existente.id
      console.log('Usuario existente actualizado:', email)
    } else {
      // Crear usuario nuevo con email confirmado
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) {
        return res.status(500).json({ error: 'Error creando usuario', detalle: error.message })
      }
      userId = data.user.id
      console.log('Usuario nuevo creado:', email)
    }

    // Paso 2: Verificar/crear el perfil en la tabla perfiles
    const { data: perfilExistente } = await supabase
      .from('perfiles')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (perfilExistente) {
      // Actualizar rol a admin si no lo es
      await supabase
        .from('perfiles')
        .update({ rol: 'admin', nombre: nombre || 'Administrador' })
        .eq('user_id', userId)
      console.log('Perfil existente actualizado a admin')
    } else {
      // Crear perfil admin
      const { error: errorPerfil } = await supabase
        .from('perfiles')
        .insert({ user_id: userId, nombre: nombre || 'Administrador', rol: 'admin' })
      if (errorPerfil) {
        return res.status(500).json({ error: 'Error creando perfil', detalle: errorPerfil.message })
      }
      console.log('Perfil admin creado')
    }

    // Paso 3: Verificar que el login funciona
    const { data: loginTest, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (loginError) {
      return res.status(500).json({
        error: 'Usuario creado pero el login falla',
        detalle: loginError.message,
        userId,
      })
    }

    res.json({
      mensaje: 'Admin configurado correctamente',
      userId,
      email,
      loginFunciona: true,
    })
  } catch (err) {
    console.error('Error en setup-admin:', err)
    res.status(500).json({ error: 'Error interno', detalle: err.message })
  }
})

module.exports = router
