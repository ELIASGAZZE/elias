// Barra de navegación superior - mobile first
import React from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavigate, useLocation, Link } from 'react-router-dom'

const Navbar = ({ titulo, tabs }) => {
  const { usuario, logout, esAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div>
      <nav className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
        {/* Título de la página actual */}
        <h1 className="font-semibold text-lg truncate">{titulo || 'Pedidos'}</h1>

        {/* Info del usuario y botón de salir */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-tight">{usuario?.nombre}</p>
            <p className="text-xs text-blue-200 leading-tight">
              {esAdmin ? 'Administrador' : 'Operario'}
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

      {/* Fila de tabs de navegación */}
      {tabs && tabs.length > 0 && (
        <div className="bg-white border-b border-gray-200 flex">
          {tabs.map(tab => {
            const activo = location.pathname === tab.path
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`flex-1 text-center px-2 py-3 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                  activo
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Navbar
