import React from 'react'
import { Link, useLocation } from 'react-router-dom'

const tabs = [
  { label: 'Historial', path: '/ventas' },
  { label: 'Reportes', path: '/ventas/reportes/promociones' },
]

const VentasTabBar = () => {
  const { pathname } = useLocation()

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
