// Contexto de autenticación
// Maneja el estado del usuario logueado y lo comparte con toda la app
import React, { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

// Creamos el contexto
const AuthContext = createContext(null)

// Hook personalizado para usar el contexto fácilmente
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
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
          // Verificamos que el token siga siendo válido
          await api.get('/api/auth/me')
          const usr = JSON.parse(usuarioGuardado)
          setUsuario(usr)

          // Registrar push para admins al restaurar sesión
          if (usr.rol === 'admin') {
            import('../services/pushNotifications').then(m => m.registrarPushAdmin()).catch(() => {})
          }
        } catch {
          // Token inválido: limpiamos el storage
          localStorage.removeItem('token')
          localStorage.removeItem('usuario')
        }
      }
      setCargando(false)
    }

    verificarSesion()
  }, [])

  // Función de login
  const login = async (username, password) => {
    const { data } = await api.post('/api/auth/login', { username, password })

    // Guardamos el token y los datos del usuario en localStorage
    localStorage.setItem('token', data.token)
    localStorage.setItem('usuario', JSON.stringify(data.usuario))
    setUsuario(data.usuario)

    // Registrar push para admins después del login
    if (data.usuario.rol === 'admin') {
      import('../services/pushNotifications').then(m => m.registrarPushAdmin()).catch(() => {})
    }

    return data.usuario
  }

  // Función de logout
  const logout = async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // Aunque falle el request, limpiamos la sesión local
    }
    localStorage.removeItem('token')
    localStorage.removeItem('usuario')
    setUsuario(null)
  }

  const valor = {
    usuario,
    cargando,
    login,
    logout,
    estaLogueado: !!usuario,
    esAdmin: usuario?.rol === 'admin',
  }

  return (
    <AuthContext.Provider value={valor}>
      {children}
    </AuthContext.Provider>
  )
}
