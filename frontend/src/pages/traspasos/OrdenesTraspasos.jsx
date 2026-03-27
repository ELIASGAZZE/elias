// Lista de órdenes de traspaso
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADO_BADGE = {
  pendiente: 'bg-gray-100 text-gray-600',
  en_preparacion: 'bg-amber-100 text-amber-600',
  preparado: 'bg-blue-100 text-blue-600',
  despachado: 'bg-purple-100 text-purple-600',
  recibido: 'bg-green-100 text-green-600',
  con_diferencia: 'bg-red-100 text-red-600',
  cancelado: 'bg-red-50 text-red-400',
}

const ESTADO_LABEL = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  preparado: 'Preparado',
  despachado: 'Despachado',
  recibido: 'Recibido',
  con_diferencia: 'Con diferencia',
  cancelado: 'Cancelado',
}

const OrdenesTraspasos = () => {
  const [ordenes, setOrdenes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('')

  const cargar = () => {
    setCargando(true)
    const params = filtroEstado ? `?estado=${filtroEstado}` : ''
    api.get(`/api/traspasos/ordenes${params}`)
      .then(r => setOrdenes(r.data))
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [filtroEstado])

  const cancelarOrden = async (e, orden) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`¿Cancelar la orden ${orden.numero}?`)) return
    try {
      await api.delete(`/api/traspasos/ordenes/${orden.id}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cancelar')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Órdenes de Traspaso" sinTabs volverA="/traspasos" />

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-2 items-center">
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2">
            <option value="">Todos los estados</option>
            {Object.entries(ESTADO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className="flex-1" />
          <Link to="/traspasos/nueva"
            className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Nueva OT
          </Link>
        </div>

        {cargando ? (
          <div className="text-center py-10 text-gray-400">Cargando...</div>
        ) : ordenes.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No hay órdenes</div>
        ) : (
          <div className="space-y-2">
            {ordenes.map(o => (
              <Link key={o.id} to={`/traspasos/ordenes/${o.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-800">
                      {o.numero}
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${ESTADO_BADGE[o.estado]}`}>
                        {ESTADO_LABEL[o.estado]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {o.sucursal_origen_nombre} → {o.sucursal_destino_nombre}
                      <span className="mx-2">—</span>
                      {new Date(o.created_at).toLocaleDateString('es-AR')}
                      {o.items && <span className="ml-2">{Array.isArray(o.items) ? o.items.length : 0} artículos</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.estado !== 'cancelado' && o.estado !== 'recibido' && (
                      <button onClick={(e) => cancelarOrden(e, o)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Cancelar orden">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default OrdenesTraspasos
