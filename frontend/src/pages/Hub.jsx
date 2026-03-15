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
  {
    id: 'cajas',
    nombre: 'Control de Cajas',
    descripcion: 'Cierres y conciliación de cajas',
    path: '/cajas',
    color: 'bg-emerald-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
  },
  {
    id: 'pos',
    nombre: 'Punto de Venta',
    descripcion: 'POS con promociones',
    path: '/pos',
    color: 'bg-violet-600',
    abrirEnNuevaPestana: true,
    ocultarPara: ['operario'],
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
  },
  {
    id: 'cajas-pos',
    nombre: 'Control Caja POS',
    descripcion: 'Cierres y verificación del POS',
    path: '/cajas-pos',
    color: 'bg-teal-600',
    ocultarPara: ['operario'],
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'ventas',
    nombre: 'Ventas',
    descripcion: 'Historial de ventas POS',
    path: '/ventas',
    color: 'bg-rose-600',
    ocultarPara: ['operario'],
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" />
      </svg>
    ),
  },
  {
    id: 'tareas',
    nombre: 'Tareas',
    descripcion: 'Tareas operativas por sucursal',
    path: '/tareas',
    color: 'bg-orange-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
]

// Apps visibles para admin y gestor
const APPS_ADMIN_GESTOR = [
  {
    id: 'rrhh',
    nombre: 'Gestión de RRHH',
    descripcion: 'Empleados, cuenta corriente, descuentos y topes',
    path: '/rrhh',
    color: 'bg-cyan-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
]

// Apps solo visibles para admin
const APPS_ADMIN = [
  {
    id: 'api',
    nombre: 'API',
    descripcion: 'Logs de conexiones externas',
    path: '/admin/api',
    color: 'bg-indigo-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
      </svg>
    ),
  },
  {
    id: 'auditoria',
    nombre: 'Auditoría POS',
    descripcion: 'Control y métricas de cajeros',
    path: '/auditoria',
    color: 'bg-red-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
  {
    id: 'configuracion',
    nombre: 'Configuración',
    descripcion: 'Usuarios, sucursales y rubros',
    path: '/admin/configuracion',
    color: 'bg-gray-600',
    icono: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

const Hub = () => {
  const { usuario, logout, esAdmin } = useAuth()

  const showDev = import.meta.env.VITE_SHOW_DEV_APPS === 'true'
  const appsBase = showDev ? APPS : APPS.filter(a => !a.dev)
  const esAdminOGestor = esAdmin || usuario?.rol === 'gestor'
  const todasLasApps = [
    ...appsBase,
    ...(esAdminOGestor ? APPS_ADMIN_GESTOR : []),
    ...(esAdmin ? APPS_ADMIN : []),
  ]
  const appsVisibles = todasLasApps.filter(app =>
    !app.ocultarPara || !app.ocultarPara.includes(usuario?.rol)
  )

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
          {appsVisibles.map(app => (
            <div key={app.id} className="relative group">
              <Link
                to={app.path}
                className="flex flex-col items-center text-center p-6 bg-white rounded-2xl border border-gray-200 hover:border-gray-300 hover:shadow-lg transition-all duration-200"
              >
                <div className={`${app.color} text-white w-14 h-14 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-200`}>
                  {app.icono}
                </div>
                <span className="text-sm font-semibold text-gray-800">{app.nombre}</span>
                <span className="text-xs text-gray-400 mt-1">{app.descripcion}</span>
              </Link>
              {/* Botón abrir en nueva pestaña (solo POS) */}
              {app.abrirEnNuevaPestana && (
                <a
                  href={app.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-all"
                  title="Abrir en nueva pestaña"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Hub
