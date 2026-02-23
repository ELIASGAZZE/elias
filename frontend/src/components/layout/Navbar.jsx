// Barra de navegación superior - mobile first
import React from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const Navbar = ({ titulo }) => {
  const { usuario, logout, esAdmin } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <nav className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
      {/* Título de la página actual */}
      <h1 className="font-semibold text-lg truncate">{titulo || 'Pedidos'}</h1>

      {/* Info del usuario y botón de salir */}
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium leading-tight">{usuario?.nombre}</p>
          <p className="text-xs text-blue-200 leading-tight">
            {esAdmin ? 'Administrador' : usuario?.sucursal?.nombre}
          </p>
        </div>

        {/* Botón de cerrar sesión */}
        <button
          onClick={handleLogout}
          className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          title="Cerrar sesión"
        >
          Salir
        </button>
      </div>
    </nav>
  )
}

export default Navbar
