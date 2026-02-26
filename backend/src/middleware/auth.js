// Middleware de autenticación
// Verifica que el usuario esté logueado y obtiene su información
const supabase = require('../config/supabase')

const verificarAuth = async (req, res, next) => {
  // Obtenemos el token del header Authorization: Bearer <token>
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' })
  }

  const token = authHeader.split(' ')[1]

  try {
    // Verificamos el token con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }

    // Obtenemos el perfil del usuario desde nuestra tabla de perfiles
    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('*, sucursales(id, nombre)')
      .eq('user_id', user.id)
      .single()

    if (errorPerfil || !perfil) {
      return res.status(401).json({ error: 'Perfil de usuario no encontrado' })
    }

    // Adjuntamos el usuario y su perfil al request para usarlo en las rutas
    req.usuario = user
    req.perfil = perfil
    next()
  } catch (err) {
    console.error('Error en middleware de auth:', err)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// Middleware para verificar que el usuario sea administrador
const soloAdmin = (req, res, next) => {
  if (req.perfil.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' })
  }
  next()
}

// Middleware para verificar que el usuario sea gestor o administrador
const soloGestorOAdmin = (req, res, next) => {
  if (!['admin', 'gestor'].includes(req.perfil.rol)) {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de gestor o administrador' })
  }
  next()
}

module.exports = { verificarAuth, soloAdmin, soloGestorOAdmin }
