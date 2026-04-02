// Middleware de autenticación
// Verifica que el usuario esté logueado y obtiene su información
// Con fallback offline: si Supabase no responde, usa cache en memoria
const supabase = require('../config/supabase')
const logger = require('../config/logger')

// Cache en memoria: token → { user, perfil, timestamp }
const authCache = new Map()
const CACHE_TTL = 1000 * 60 * 60 // 1 hora
const CACHE_CLEANUP_INTERVAL = 1000 * 60 * 15 // Limpiar cada 15 min

// Limpieza periódica para evitar memory leak
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of authCache) {
    if (now - val.timestamp > CACHE_TTL) authCache.delete(key)
  }
}, CACHE_CLEANUP_INTERVAL).unref()

function isNetworkError(err) {
  if (!err) return false
  const msg = (err.message || err.code || '').toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('enotfound')
    || msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('dns')
    || msg.includes('socket') || msg.includes('enetunreach')
}

const verificarAuth = async (req, res, next) => {
  // Obtenemos el token del header Authorization: Bearer <token>
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' })
  }

  const token = authHeader.split(' ')[1]

  // Token de emergencia: no validar contra Supabase
  if (token.startsWith('emergency-offline-')) {
    req.usuario = { id: 'emergency' }
    req.perfil = { nombre: 'Modo Emergencia', rol: 'operario', username: 'emergencia' }
    return next()
  }

  try {
    // Verificamos el token con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      // Si es error de red, intentar fallback offline
      if (error && isNetworkError(error)) {
        return fallbackOffline(token, req, res, next)
      }
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }

    // Obtenemos el perfil del usuario desde nuestra tabla de perfiles
    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfiles')
      .select('id, user_id, username, nombre, rol, sucursal_id, sucursales(id, nombre)')
      .eq('user_id', user.id)
      .single()

    if (errorPerfil || !perfil) {
      if (errorPerfil && isNetworkError(errorPerfil)) {
        return fallbackOffline(token, req, res, next)
      }
      return res.status(401).json({ error: 'Perfil de usuario no encontrado' })
    }

    // Guardar en cache para modo offline
    authCache.set(token, { user, perfil, timestamp: Date.now() })

    // Adjuntamos el usuario y su perfil al request para usarlo en las rutas
    req.usuario = user
    req.perfil = perfil
    next()
  } catch (err) {
    // Si es error de red (sin internet), usar cache
    if (isNetworkError(err)) {
      return fallbackOffline(token, req, res, next)
    }
    logger.error({ err }, 'Error en middleware de auth')
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

function fallbackOffline(token, req, res, next) {
  const cached = authCache.get(token)
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    logger.info({ usuario: cached.perfil.nombre }, '[Auth] Modo offline — usando cache')
    req.usuario = cached.user
    req.perfil = cached.perfil
    return next()
  }
  return res.status(503).json({ error: 'Sin conexión y sin sesión cacheada. Conectate a internet para iniciar sesión.' })
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
