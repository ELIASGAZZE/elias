// Dashboard principal de Compras
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import SectionErrorBoundary from '../../components/SectionErrorBoundary'

const RIESGO_COLORS = {
  rojo: 'bg-red-100 text-red-700 border-red-200',
  amarillo: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  verde: 'bg-green-100 text-green-700 border-green-200',
  gris: 'bg-gray-100 text-gray-500 border-gray-200',
}

const ComprasHome = () => {
  const [dashboard, setDashboard] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    api.get('/api/compras/dashboard')
      .then(r => setDashboard(r.data))
      .catch(err => console.error('Error cargando dashboard:', err))
      .finally(() => setCargando(false))
  }, [])

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Compras" sinTabs volverA="/apps" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Compras Inteligentes" sinTabs volverA="/apps" />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* KPIs */}
        <SectionErrorBoundary name="Dashboard de compras">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{dashboard?.total_criticos || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Art. stock crítico</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{dashboard?.ordenes_pendientes || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Órdenes pendientes</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600">${(dashboard?.gasto_mes || 0).toLocaleString('es-AR')}</div>
            <div className="text-xs text-gray-500 mt-1">Gasto del mes</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{dashboard?.total_proveedores || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Proveedores activos</div>
          </div>
        </div>

        {/* Alertas de stock crítico */}
        {dashboard?.articulos_criticos?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Artículos con stock crítico</h3>
            <div className="space-y-2">
              {dashboard.articulos_criticos.map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2">
                  <div>
                    <span className="font-medium text-gray-800">{a.nombre}</span>
                    <span className="text-gray-400 ml-2 text-xs">{a.codigo}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-red-600 font-medium">{a.stock_actual} uds</span>
                    <span className="text-gray-400 text-xs">mín: {a.stock_minimo}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Órdenes recientes */}
        {dashboard?.ordenes_recientes?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Órdenes recientes</h3>
              <Link to="/compras/ordenes" className="text-xs text-amber-600 hover:text-amber-700">Ver todas</Link>
            </div>
            <div className="space-y-2">
              {dashboard.ordenes_recientes.slice(0, 5).map(o => (
                <Link key={o.id} to={`/compras/ordenes/${o.id}`}
                  className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 hover:bg-gray-50 -mx-2 px-2 rounded"
                >
                  <div>
                    <span className="font-medium text-gray-800">{o.numero}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                      o.estado === 'borrador' ? 'bg-gray-100 text-gray-600' :
                      o.estado === 'enviada' ? 'bg-blue-100 text-blue-600' :
                      'bg-green-100 text-green-600'
                    }`}>{o.estado}</span>
                  </div>
                  <span className="text-gray-600 font-medium">${Number(o.total || 0).toLocaleString('es-AR')}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        </SectionErrorBoundary>

        {/* Navegación rápida */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { to: '/compras/proveedores', label: 'Proveedores', desc: 'Gestionar proveedores y artículos', color: 'bg-blue-600' },
            { to: '/compras/ordenes', label: 'Órdenes de Compra', desc: 'Ver y crear órdenes', color: 'bg-amber-600' },
            { to: '/compras/nueva-orden', label: 'Nueva Orden IA', desc: 'Generar orden con sugerencias', color: 'bg-violet-600' },
            { to: '/compras/chat', label: 'Chat IA', desc: 'Consultar a la IA de compras', color: 'bg-emerald-600' },
            { to: '/compras/consumo-interno', label: 'Consumo Interno', desc: 'Registrar merma y producción', color: 'bg-rose-600' },
            { to: '/compras/pedidos-extra', label: 'Pedidos Especiales', desc: 'Pedidos extraordinarios', color: 'bg-cyan-600' },
          ].map(nav => (
            <Link key={nav.to} to={nav.to}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className={`${nav.color} text-white w-10 h-10 rounded-lg flex items-center justify-center mb-2`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
              <div className="text-sm font-semibold text-gray-800">{nav.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{nav.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ComprasHome
