// Contexto de autenticación
// Maneja el estado del usuario logueado y lo comparte con toda la app
import React, { createContext, useContext, useState, useEffect } from 'react'
import api, { isNetworkError } from '../services/api'
import { guardarEmpleadosPIN, getEmpleadosPIN } from '../services/offlineDB'
import bcrypt from 'bcryptjs'

// Creamos el contexto
const AuthContext = createContext(null)

// Hook personalizado para usar el contexto fácilmente
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}

// Sincronizar PINs de empleados para login offline
async function syncOfflinePins() {
  try {
    const { data } = await api.get('/api/auth/offline-pins')
    if (data && data.length > 0) {
      await guardarEmpleadosPIN(data)
      console.log(`[Auth] ${data.length} PINs cacheados para modo offline`)
    }
  } catch {
    // Silencioso — no es crítico
  }
}

// Proveedor del contexto: envuelve toda la app
export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)

  // Al iniciar la app, verificamos si hay una sesión guardada
  useEffect(() => {
    const verificarSesion = async () => {
      const tokenGuardado = localStorage.getItem('token')
      const usuarioGuardado = localStorage.getItem('usuario')

      if (tokenGuardado && usuarioGuardado) {
        try {
          // Verificamos que el token siga siendo válido (skip redirect en interceptor)
          await api.get('/api/auth/me', { _skipAuthRedirect: true })
          const usr = JSON.parse(usuarioGuardado)
          setUsuario(usr)

          // Registrar push para admins al restaurar sesión
          if (usr.rol === 'admin') {
            import('../services/pushNotifications').then(m => m.registrarPushAdmin()).catch(err => console.error('Error registering push notifications:', err.message))
          }

          // Sync PINs en background
          syncOfflinePins()
        } catch (err) {
          // Si es error de red (sin internet), usar sesión cacheada en localStorage
          if (isNetworkError(err) || err.response?.status === 503) {
            const usr = JSON.parse(usuarioGuardado)
            setUsuario(usr)
            console.log('[Auth] Modo offline — sesión restaurada desde cache local')
          } else {
            // Token realmente inválido: limpiamos el storage
            localStorage.removeItem('token')
            localStorage.removeItem('usuario')
          }
        }
      }
      setCargando(false)
    }

    verificarSesion()
  }, [])

  // Función de login
  const login = async (username, password) => {
    const { data } = await api.post('/api/auth/login', { username, password })

    // Guardamos el token, refresh token y los datos del usuario en localStorage
    localStorage.setItem('token', data.token)
    localStorage.setItem('refresh_token', data.refresh_token)
    localStorage.setItem('usuario', JSON.stringify(data.usuario))
    setUsuario(data.usuario)

    // Registrar push para admins después del login
    if (data.usuario.rol === 'admin') {
      import('../services/pushNotifications').then(m => m.registrarPushAdmin()).catch(err => console.error('Error registering push notifications:', err.message))
    }

    // Sync PINs en background para modo offline
    syncOfflinePins()

    return data.usuario
  }

  // Login de emergencia (sin internet, con PIN)
  // Primero intenta contra el backend, si falla valida localmente
  const loginEmergencia = async (pin) => {
    // Intentar contra el backend primero
    try {
      const { data } = await api.post('/api/auth/emergency-login', { pin })
      localStorage.setItem('token', data.token)
      localStorage.setItem('usuario', JSON.stringify(data.usuario))
      setUsuario(data.usuario)
      return data.usuario
    } catch (err) {
      // Si el backend responde (no es error de red), propagar el error
      if (!isNetworkError(err) && err.response?.status !== 502 && err.response?.status !== 503) {
        throw err
      }
    }

    // Backend no disponible — validar PIN localmente contra cache
    const empleados = await getEmpleadosPIN()
    if (!empleados || empleados.length === 0) {
      throw { response: { data: { error: 'No hay datos de emergencia cacheados. Necesitás haber iniciado sesión al menos una vez con conexión.' } } }
    }

    for (const emp of empleados) {
      const match = await bcrypt.compare(pin, emp.pin_hash)
      if (match) {
        const usr = {
          id: emp.id,
          username: emp.codigo || 'emergencia',
          rol: 'operario',
          nombre: emp.nombre,
          sucursal_id: emp.sucursal_id || null,
        }
        const token = 'emergency-offline-' + Date.now()
        localStorage.setItem('token', token)
        localStorage.setItem('usuario', JSON.stringify(usr))
        setUsuario(usr)
        console.log(`[Auth] Login offline exitoso: ${emp.nombre}`)
        return usr
      }
    }

    throw { response: { data: { error: 'PIN incorrecto' } } }
  }

  // Función de logout
  const logout = async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // Aunque falle el request, limpiamos la sesión local
    }
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('usuario')
    setUsuario(null)
  }

  const valor = {
    usuario,
    cargando,
    login,
    loginEmergencia,
    logout,
    estaLogueado: !!usuario,
    esAdmin: usuario?.rol === 'admin',
    esGestor: usuario?.rol === 'gestor',
  }

  return (
    <AuthContext.Provider value={valor}>
      {children}
    </AuthContext.Provider>
  )
}
