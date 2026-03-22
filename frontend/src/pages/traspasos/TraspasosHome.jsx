// Dashboard principal de Traspasos
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADO_BADGE = {
  borrador: 'bg-gray-100 text-gray-600',
  en_preparacion: 'bg-amber-100 text-amber-600',
  preparado: 'bg-blue-100 text-blue-600',
  despachado: 'bg-purple-100 text-purple-600',
  recibido: 'bg-green-100 text-green-600',
  con_diferencia: 'bg-red-100 text-red-600',
  cancelado: 'bg-red-50 text-red-400',
}

const ESTADO_LABEL = {
  borrador: 'Borrador',
  en_preparacion: 'En preparación',
  preparado: 'Preparado',
  despachado: 'Despachado',
  recibido: 'Recibido',
  con_diferencia: 'Con diferencia',
  cancelado: 'Cancelado',
}

const TraspasosHome = () => {
  const [dashboard, setDashboard] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [ordenes, setOrdenes] = useState([])
  const [filtroEstado, setFiltroEstado] = useState('')

  useEffect(() => {
    api.get('/api/traspasos/dashboard')
      .then(r => setDashboard(r.data))
      .catch(err => console.error('Error cargando dashboard:', err))
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    const params = filtroEstado ? `?estado=${filtroEstado}` : ''
    api.get(`/api/traspasos/ordenes${params}`)
      .then(r => setOrdenes(r.data))
      .catch(err => console.error('Error cargando ordenes:', err))
  }, [filtroEstado])

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Traspasos" sinTabs volverA="/apps" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Traspasos entre Sucursales" sinTabs volverA="/apps" />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-600">{dashboard?.pendientes || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Pendientes</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{dashboard?.en_preparacion || 0}</div>
            <div className="text-xs text-gray-500 mt-1">En preparación</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{dashboard?.preparados || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Preparados</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">{dashboard?.despachados || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Despachados</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-emerald-600">{dashboard?.recibidos_hoy || 0}</div>
            <div className="text-xs text-gray-500 mt-1">Recibidos hoy</div>
          </div>
        </div>

        {/* Accesos rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link to="/traspasos/nueva"
            className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow flex items-center gap-4">
            <div className="bg-sky-100 text-sky-600 w-12 h-12 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-gray-800">Nueva Orden de Traspaso</div>
              <div className="text-xs text-gray-400">Crear pedido de envío a sucursal</div>
            </div>
          </Link>

          <Link to="/traspasos/ordenes"
            className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow flex items-center gap-4">
            <div className="bg-sky-100 text-sky-600 w-12 h-12 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
              </svg>
            </div>
            <div>
              <div className="font-semibold text-gray-800">Ver Órdenes</div>
              <div className="text-xs text-gray-400">Listado de órdenes de traspaso</div>
            </div>
          </Link>
        </div>

        {/* Lista de órdenes */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-700 text-sm">Órdenes de Traspaso</h2>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
              <option value="">Todos</option>
              {Object.entries(ESTADO_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {ordenes.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No hay órdenes</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {ordenes.map(o => (
                <Link key={o.id} to={`/traspasos/ordenes/${o.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800">{o.numero}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${ESTADO_BADGE[o.estado]}`}>
                        {ESTADO_LABEL[o.estado]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {o.sucursal_origen_nombre} → {o.sucursal_destino_nombre}
                      <span className="mx-1.5">·</span>
                      {new Date(o.created_at).toLocaleDateString('es-AR')}
                      {o.items && <span className="ml-1.5">· {Array.isArray(o.items) ? o.items.length : 0} art.</span>}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TraspasosHome
