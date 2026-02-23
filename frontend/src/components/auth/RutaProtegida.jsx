// Componente que protege rutas según autenticación y rol
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

/**
 * Uso:
 * <RutaProtegida>              → requiere estar logueado
 * <RutaProtegida soloAdmin>   → requiere ser administrador
 */
const RutaProtegida = ({ children, soloAdmin = false }) => {
  const { estaLogueado, esAdmin, cargando } = useAuth()

  // Mientras verificamos la sesión, mostramos un spinner
  if (cargando) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    )
  }

  // Si no está logueado, redirigimos al login
  if (!estaLogueado) {
    return <Navigate to="/login" replace />
  }

  // Si la ruta es solo para admins y no lo es, redirigimos
  if (soloAdmin && !esAdmin) {
    return <Navigate to="/operario" replace />
  }

  return children
}

export default RutaProtegida
