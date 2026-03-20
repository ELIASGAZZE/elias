// Rutas de autenticación
const express = require('express')
const router = express.Router()
const supabase = require('../config/supabase')
const { crearClienteAuth } = require('../config/supabase')
const { verificarAuth, soloAdmin } = require('../middleware/auth')

// Convención: username → email oculto para Supabase Auth
const usernameToEmail = (username) => username.toLowerCase() + '@padano.app'

// POST /api/auth/login
// Recibe username y contraseña, devuelve token de sesión
router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' })
  }

  try {
    const email = usernameToEmail(username)

    // Usamos un cliente descartable para signIn (no contamina el cliente principal)
    const clienteAuth = crearClienteAuth()
    const { data, error } = await clienteAuth.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error('Error de Supabase en login:', error.message)
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' })
    }

    // Obtenemos el perfil con el cliente principal (service key, bypasea RLS)
    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('*')
      .eq('user_id', data.user.id)
      .single()

    if (errorPerfil || !perfil) {
      console.error('Error obteniendo perfil:', errorPerfil?.message)
      return res.status(401).json({ error: 'Perfil de usuario no encontrado' })
    }

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      usuario: {
        id: data.user.id,
        username: perfil.username,
        rol: perfil.rol,
        nombre: perfil.nombre,
        sucursal_id: perfil.sucursal_id || null,
      },
    })
  } catch (err) {
    console.error('Error en login:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /api/auth/refresh
// Renueva el access token usando el refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token requerido' })
    }

    const clienteAuth = crearClienteAuth()
    const { data, error } = await clienteAuth.auth.refreshSession({ refresh_token })

    if (error || !data.session) {
      return res.status(401).json({ error: 'No se pudo renovar la sesión' })
    }

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  } catch (err) {
    console.error('Error en refresh:', err)
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
    username: req.perfil.username,
    rol: req.perfil.rol,
    nombre: req.perfil.nombre,
    sucursal_id: req.perfil.sucursal_id || null,
  })
})

// GET /api/auth/usuarios
// Admin: lista todos los usuarios
router.get('/usuarios', verificarAuth, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('perfiles')
      .select('id, user_id, username, nombre, rol, sucursal_id, created_at')
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Error al obtener usuarios:', err)
    res.status(500).json({ error: 'Error al obtener usuarios' })
  }
})

// POST /api/auth/usuarios
// Admin: crea un nuevo usuario
router.post('/usuarios', verificarAuth, soloAdmin, async (req, res) => {
  const { username, password, nombre, rol, sucursal_id } = req.body

  if (!username || !password || !nombre) {
    return res.status(400).json({ error: 'Username, contraseña y nombre son requeridos' })
  }

  if (!['admin', 'operario', 'gestor'].includes(rol)) {
    return res.status(400).json({ error: 'El rol debe ser "admin", "operario" o "gestor"' })
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
  }

  const usernameLimpio = username.toLowerCase().trim()

  // Validar formato: solo letras, números y puntos
  if (!/^[a-z0-9.]+$/.test(usernameLimpio)) {
    return res.status(400).json({ error: 'El usuario solo puede contener letras, números y puntos' })
  }

  try {
    // Verificar si el username ya existe
    const { data: existente } = await supabase
      .from('perfiles')
      .select('id')
      .eq('username', usernameLimpio)
      .single()

    if (existente) {
      return res.status(409).json({ error: `Ya existe un usuario con el nombre "${usernameLimpio}"` })
    }

    const email = usernameToEmail(usernameLimpio)

    // Crear en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError) {
      console.error('Error creando usuario en Auth:', authError.message, authError.status)
      const msg = authError.message?.includes('already been registered')
        ? `El email ya existe en el sistema. Puede que "${usernameLimpio}" haya sido creado antes.`
        : authError.message || 'Error al crear usuario'
      return res.status(500).json({ error: msg })
    }

    // Crear perfil
    const perfilData = {
      user_id: authData.user.id,
      username: usernameLimpio,
      nombre,
      rol,
    }
    if ((rol === 'operario' || rol === 'gestor') && sucursal_id) {
      perfilData.sucursal_id = sucursal_id
    }

    const { data: perfil, error: perfilError } = await supabase
      .from('perfiles')
      .insert(perfilData)
      .select()
      .single()

    if (perfilError) {
      // Si falla el perfil, eliminar el usuario de Auth para no dejar basura
      await supabase.auth.admin.deleteUser(authData.user.id)
      throw perfilError
    }

    console.log(`[AUDIT] Usuario creado: "${usernameLimpio}" (rol: ${rol}) por admin "${req.perfil.username}"`)
    res.status(201).json(perfil)
  } catch (err) {
    console.error('Error al crear usuario:', err)
    res.status(500).json({ error: 'Error al crear usuario' })
  }
})

// PUT /api/auth/usuarios/:id
// Admin: edita perfil de un usuario (nombre, rol, sucursal_id, username, password)
router.put('/usuarios/:id', verificarAuth, soloAdmin, async (req, res) => {
  const { id } = req.params
  const { nombre, rol, sucursal_id, username, password } = req.body

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es requerido' })
  }

  if (!['admin', 'operario', 'gestor'].includes(rol)) {
    return res.status(400).json({ error: 'El rol debe ser "admin", "operario" o "gestor"' })
  }

  if (password && password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
  }

  try {
    // Obtener perfil actual para el user_id
    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('user_id, username')
      .eq('id', id)
      .single()

    if (errorPerfil || !perfil) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    // Si cambia el username, verificar que no exista otro
    const usernameLimpio = username ? username.toLowerCase().trim() : perfil.username
    if (username && usernameLimpio !== perfil.username) {
      if (!/^[a-z0-9.]+$/.test(usernameLimpio)) {
        return res.status(400).json({ error: 'El usuario solo puede contener letras, números y puntos' })
      }

      const { data: existente } = await supabase
        .from('perfiles')
        .select('id')
        .eq('username', usernameLimpio)
        .neq('id', id)
        .single()

      if (existente) {
        return res.status(409).json({ error: `Ya existe un usuario con el nombre "${usernameLimpio}"` })
      }
    }

    // Actualizar en Supabase Auth si cambia username o password
    const authUpdate = {}
    if (username && usernameLimpio !== perfil.username) {
      authUpdate.email = usernameToEmail(usernameLimpio)
      authUpdate.email_confirm = true
    }
    if (password) {
      authUpdate.password = password
    }
    if (Object.keys(authUpdate).length > 0) {
      const { error: authError } = await supabase.auth.admin.updateUserById(perfil.user_id, authUpdate)
      if (authError) {
        console.error('Error actualizando Auth:', authError.message)
        return res.status(500).json({ error: 'Error al actualizar credenciales' })
      }
    }

    // Actualizar perfil
    const updateData = {
      nombre: nombre.trim(),
      rol,
      sucursal_id: rol === 'operario' ? (sucursal_id || null) : null,
      username: usernameLimpio,
    }

    const { data, error } = await supabase
      .from('perfiles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    console.log(`[AUDIT] Usuario editado: "${usernameLimpio}" (rol: ${rol}) por admin "${req.perfil.username}"`)
    res.json(data)
  } catch (err) {
    console.error('Error al editar usuario:', err)
    res.status(500).json({ error: 'Error al editar usuario' })
  }
})

// DELETE /api/auth/usuarios/:id
// Admin: elimina un usuario (por perfiles.id)
router.delete('/usuarios/:id', verificarAuth, soloAdmin, async (req, res) => {
  const { id } = req.params

  // No permitir eliminarse a sí mismo
  if (id === req.perfil.id) {
    return res.status(400).json({ error: 'No podés eliminar tu propio usuario' })
  }

  try {
    // Buscar el perfil para obtener el user_id
    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('user_id, nombre')
      .eq('id', id)
      .single()

    if (errorPerfil || !perfil) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    // Verificar si tiene pedidos
    const { count } = await supabase
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', id)

    if (count > 0) {
      return res.status(400).json({ error: `No se puede eliminar: el usuario tiene ${count} pedido(s)` })
    }

    // Eliminar de Supabase Auth (cascadea a perfiles si hay ON DELETE CASCADE)
    const { error: authError } = await supabase.auth.admin.deleteUser(perfil.user_id)
    if (authError) throw authError

    // Si no hay cascade, eliminar perfil manualmente
    await supabase.from('perfiles').delete().eq('id', id)

    console.log(`[AUDIT] Usuario eliminado: "${perfil.nombre}" por admin "${req.perfil.username}"`)
    res.json({ mensaje: 'Usuario eliminado correctamente' })
  } catch (err) {
    console.error('Error al eliminar usuario:', err)
    res.status(500).json({ error: 'Error al eliminar usuario' })
  }
})

// POST /api/auth/setup-admin
// Ruta para migrar/crear el usuario admin con el nuevo sistema de usernames
router.post('/setup-admin', async (req, res) => {
  const { username, password, nombre } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: 'Username y contraseña son requeridos' })
  }

  const email = usernameToEmail(username)

  try {
    // Buscar si existe un usuario con este email o el email viejo
    const { data: usuarios } = await supabase.auth.admin.listUsers()
    const existente = usuarios.users.find(
      (u) => u.email === email || u.email === `${username}@padano.com.ar`
    )

    let userId

    if (existente) {
      // Actualizar email al nuevo formato y contraseña
      const { error } = await supabase.auth.admin.updateUserById(existente.id, {
        email,
        password,
        email_confirm: true,
      })
      if (error) {
        return res.status(500).json({ error: 'Error actualizando usuario', detalle: error.message })
      }
      userId = existente.id
    } else {
      // Crear usuario nuevo
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) {
        return res.status(500).json({ error: 'Error creando usuario', detalle: error.message })
      }
      userId = data.user.id
    }

    // Verificar/crear el perfil
    const { data: perfilExistente } = await supabase
      .from('perfiles')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (perfilExistente) {
      await supabase
        .from('perfiles')
        .update({ rol: 'admin', nombre: nombre || 'Administrador', username })
        .eq('user_id', userId)
    } else {
      const { error: errorPerfil } = await supabase
        .from('perfiles')
        .insert({ user_id: userId, nombre: nombre || 'Administrador', rol: 'admin', username })
      if (errorPerfil) {
        return res.status(500).json({ error: 'Error creando perfil', detalle: errorPerfil.message })
      }
    }

    res.json({
      mensaje: 'Admin configurado correctamente',
      userId,
      username,
      email,
    })
  } catch (err) {
    console.error('Error en setup-admin:', err)
    res.status(500).json({ error: 'Error interno', detalle: err.message })
  }
})

// POST /api/auth/emergency-login
// Login de emergencia sin Supabase (solo cuando no hay internet)
// Usa un PIN configurado en variable de entorno
router.post('/emergency-login', async (req, res) => {
  const { pin } = req.body
  const emergencyPin = process.env.EMERGENCY_PIN

  if (!emergencyPin) {
    return res.status(503).json({ error: 'Modo emergencia no configurado' })
  }

  if (!pin || pin !== emergencyPin) {
    return res.status(401).json({ error: 'PIN incorrecto' })
  }

  // Devolver un token ficticio y datos mínimos para operar offline
  res.json({
    token: 'emergency-offline-' + Date.now(),
    usuario: {
      id: 'emergency',
      username: 'emergencia',
      rol: 'operario',
      nombre: 'Modo Emergencia',
      sucursal_id: null,
    },
    emergency: true,
  })
})

module.exports = router
