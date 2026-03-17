import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const tabs = [
  { path: '/tareas', label: 'Pendientes', roles: null },
  { path: '/tareas/equipo', label: 'Equipo', roles: null },
  { path: '/tareas/panel', label: 'Panel general', roles: ['admin', 'gestor'] },
  { path: '/tareas/analytics', label: 'Analisis', roles: ['admin', 'gestor'] },
  { path: '/tareas/admin', label: 'Configurar', roles: ['admin'] },
]

const TareasNav = () => {
  const { pathname } = useLocation()
  const { esAdmin, esGestor, perfil } = useAuth()

  const rol = perfil?.rol
  const visible = tabs.filter(t => {
    if (!t.roles) return true
    if (t.roles.includes('admin') && esAdmin) return true
    if (t.roles.includes('gestor') && esGestor) return true
    return false
  })

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2">
      {visible.map(tab => {
        const activa = pathname === tab.path
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              activa
                ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}

export default TareasNav
