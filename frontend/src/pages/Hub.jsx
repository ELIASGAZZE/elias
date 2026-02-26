// Hub principal — menú de aplicaciones estilo Odoo
import React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Definición de las aplicaciones disponibles
const APPS = [
  {
    id: 'pedidos',
    nombre: 'Pedidos Internos',
    descripcion: 'Gestión de pedidos por sucursal',
    path: '/pedidos/nuevo',
    color: 'bg-blue-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  // Futuras apps se agregan acá:
  // {
  //   id: 'stock',
  //   nombre: 'Control de Stock',
  //   descripcion: 'Inventario y movimientos',
  //   path: '/stock',
  //   color: 'bg-emerald-600',
  //   icono: ...,
  // },
]

const Hub = () => {
  const { usuario, logout } = useAuth()

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-gray-800 text-lg">Padano SRL</h1>
          <p className="text-xs text-gray-400">Gestiones Operativas</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 hidden sm:block">{usuario?.nombre}</span>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            Salir
          </button>
        </div>
      </nav>

      {/* Grid de aplicaciones */}
      <div className="max-w-4xl mx-auto px-4 py-10">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-6">Aplicaciones</h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {APPS.map(app => (
            <Link
              key={app.id}
              to={app.path}
              className="group flex flex-col items-center text-center p-6 bg-white rounded-2xl border border-gray-200 hover:border-gray-300 hover:shadow-lg transition-all duration-200"
            >
              <div className={`${app.color} text-white w-14 h-14 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-200`}>
                {app.icono}
              </div>
              <span className="text-sm font-semibold text-gray-800">{app.nombre}</span>
              <span className="text-xs text-gray-400 mt-1">{app.descripcion}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Hub
