import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const VentasTabBar = () => {
  const { pathname } = useLocation()
  const { esAdmin } = useAuth()

  const tabs = [
    { label: 'Historial', path: '/ventas' },
    ...(esAdmin ? [{ label: 'Reportes', path: '/ventas/reportes/promociones' }] : []),
    ...(esAdmin ? [{ label: 'Conciliación', path: '/ventas/conciliacion' }] : []),
    ...(esAdmin ? [{ label: 'Duplicados', path: '/ventas/duplicados-centum' }] : []),
  ]

  return (
    <div className="bg-white border-b border-gray-200 flex">
      {tabs.map(tab => {
        const activo = tab.path === '/ventas'
          ? pathname === '/ventas'
          : pathname.startsWith(tab.path)
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`px-5 py-3 text-sm font-medium transition-colors ${
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
  )
}

export default VentasTabBar
