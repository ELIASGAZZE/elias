// Barra de navegación superior - mobile first
import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { getTabsParaRol } from './navTabs'
import api from '../../services/api'

const Navbar = ({ titulo, sinTabs, volverA }) => {
  const { usuario, logout, esAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const tabs = getTabsParaRol(esAdmin)

  // Badge de errores API para admins
  const [erroresApi, setErroresApi] = useState(0)

  useEffect(() => {
    if (!esAdmin) return
    api.get('/api/api-logs/errores-recientes')
      .then(({ data }) => setErroresApi(data.cantidad || 0))
      .catch(() => {})
  }, [esAdmin])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div>
      <nav className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          {/* Botón volver (a ruta específica o al Hub) */}
          {volverA && (
            <Link
              to={volverA}
              className="bg-blue-700 hover:bg-blue-800 p-2 rounded-lg transition-colors"
              title="Volver"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </Link>
          )}
          {/* Botón volver al Hub */}
          <Link
            to={esAdmin && erroresApi > 0 ? '/admin/api' : '/apps'}
            className="relative bg-blue-700 hover:bg-blue-800 p-2 rounded-lg transition-colors"
            title={esAdmin && erroresApi > 0 ? `${erroresApi} error(es) de API` : 'Volver al menú'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            {esAdmin && erroresApi > 0 && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-blue-600" />
            )}
          </Link>

          {/* Título de la página actual */}
          <h1 className="font-semibold text-lg truncate">{titulo || 'Pedidos Internos'}</h1>
        </div>

        {/* Info del usuario y botón de salir */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-tight">{usuario?.nombre}</p>
            <p className="text-xs text-blue-200 leading-tight">
              {esAdmin ? 'Administrador' : usuario?.rol === 'gestor' ? 'Gestor' : 'Operario'}
            </p>
          </div>

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
      {!sinTabs && tabs.length > 0 && (
        <div className="bg-white border-b border-gray-200 flex overflow-x-auto">
          {tabs.map(tab => {
            const activo = location.pathname === tab.path
            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={`flex-shrink-0 text-center px-3 py-3 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
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
