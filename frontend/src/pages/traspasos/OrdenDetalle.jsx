// Detalle de orden de traspaso
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
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

const CANASTO_BADGE = {
  en_preparacion: 'bg-amber-100 text-amber-600',
  cerrado: 'bg-blue-100 text-blue-600',
  despachado: 'bg-purple-100 text-purple-600',
  aprobado: 'bg-green-100 text-green-600',
  verificacion_manual: 'bg-yellow-100 text-yellow-700',
  con_diferencia: 'bg-red-100 text-red-600',
}

const OrdenDetalle = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [orden, setOrden] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [accionando, setAccionando] = useState(false)

  const cargar = () => {
    api.get(`/api/traspasos/ordenes/${id}`)
      .then(r => setOrden(r.data))
      .catch(err => console.error(err))
      .finally(() => setCargando(false))
  }

  useEffect(() => { cargar() }, [id])

  const ejecutarAccion = async (endpoint, confirmar) => {
    if (confirmar && !window.confirm(confirmar)) return
    setAccionando(true)
    try {
      await api.put(`/api/traspasos/ordenes/${id}/${endpoint}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al ejecutar acción')
    }
    setAccionando(false)
  }

  const cancelar = async () => {
    if (!window.confirm('¿Cancelar esta orden?')) return
    setAccionando(true)
    try {
      await api.delete(`/api/traspasos/ordenes/${id}`)
      navigate('/traspasos/ordenes')
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cancelar')
    }
    setAccionando(false)
  }

  if (cargando) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Detalle Orden" sinTabs volverA="/traspasos/ordenes" />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  if (!orden) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Detalle Orden" sinTabs volverA="/traspasos/ordenes" />
      <div className="text-center py-20 text-gray-400">Orden no encontrada</div>
    </div>
  )

  const items = Array.isArray(orden.items) ? orden.items : []
  const canastos = orden.canastos || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo={orden.numero} sinTabs volverA="/traspasos/ordenes" />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-lg font-bold text-gray-800">{orden.numero}</span>
              <span className={`ml-3 text-xs px-2.5 py-1 rounded-full ${ESTADO_BADGE[orden.estado]}`}>
                {ESTADO_LABEL[orden.estado]}
              </span>
            </div>
            <div className="text-xs text-gray-400">
              {new Date(orden.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Origen:</span>{' '}
              <span className="font-medium text-gray-700">{orden.sucursal_origen_nombre}</span>
            </div>
            <div>
              <span className="text-gray-400">Destino:</span>{' '}
              <span className="font-medium text-gray-700">{orden.sucursal_destino_nombre}</span>
            </div>
          </div>
          {orden.notas && (
            <div className="mt-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-2">{orden.notas}</div>
          )}
          {orden.centum_error && (
            <div className="mt-2 text-sm text-red-600 bg-red-50 rounded-lg p-2">Centum: {orden.centum_error}</div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex gap-2 flex-wrap">
          {orden.estado === 'borrador' && (
            <>
              <button onClick={() => ejecutarAccion('iniciar-preparacion', '¿Iniciar preparación?')}
                disabled={accionando}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Iniciar Preparación
              </button>
              <button onClick={cancelar} disabled={accionando}
                className="bg-red-100 hover:bg-red-200 text-red-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Cancelar Orden
              </button>
            </>
          )}
          {orden.estado === 'en_preparacion' && (
            <>
              <Link to={`/traspasos/ordenes/${id}/preparar`}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Ir a Preparación
              </Link>
              <button onClick={() => ejecutarAccion('preparado', '¿Marcar como preparado? Todos los canastos deben estar cerrados.')}
                disabled={accionando}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Marcar Preparado
              </button>
              <button onClick={cancelar} disabled={accionando}
                className="bg-red-100 hover:bg-red-200 text-red-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Cancelar
              </button>
            </>
          )}
          {orden.estado === 'preparado' && (
            <button onClick={() => ejecutarAccion('despachar', '¿Despachar esta orden? Se realizará el ajuste de stock en origen.')}
              disabled={accionando}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              Despachar
            </button>
          )}
          {orden.estado === 'despachado' && (
            <Link to={`/traspasos/recibir/${id}`}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              Ir a Recepción
            </Link>
          )}
        </div>

        {/* Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Artículos ({items.length})</h3>
          {items.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-4">Sin artículos</div>
          ) : (
            <div className="space-y-1">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm border-b border-gray-100 pb-1.5 last:border-0">
                  <div>
                    <span className="font-medium text-gray-800">{item.nombre}</span>
                    <span className="text-gray-400 ml-2 text-xs">{item.codigo}</span>
                    {item.es_pesable && <span className="text-amber-500 ml-1 text-xs">(pesable)</span>}
                  </div>
                  <div className="text-right text-xs">
                    <span className="text-gray-600 font-medium">
                      {item.cantidad_solicitada} {item.es_pesable ? 'kg' : 'uds'}
                    </span>
                    {item.cantidad_preparada > 0 && item.cantidad_preparada !== item.cantidad_solicitada && (
                      <span className="text-amber-600 ml-2">prep: {item.cantidad_preparada}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Canastos */}
        {canastos.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Canastos ({canastos.length})</h3>
            <div className="space-y-2">
              {canastos.map(c => (
                <div key={c.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800 text-sm">Precinto: {c.precinto}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CANASTO_BADGE[c.estado]}`}>
                        {c.estado.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {c.peso_origen && <span>Origen: {c.peso_origen} kg</span>}
                      {c.peso_destino && <span className="ml-3">Destino: {c.peso_destino} kg</span>}
                    </div>
                  </div>
                  {c.items && c.items.length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      {c.items.map(i => `${i.nombre} (${i.cantidad})`).join(', ')}
                    </div>
                  )}
                  {c.diferencias && c.diferencias.length > 0 && (
                    <div className="mt-2 bg-red-50 rounded p-2 text-xs text-red-600">
                      Diferencias: {c.diferencias.map(d => `${d.articulo_id}: esperado ${d.cantidad_esperada}, real ${d.cantidad_real}`).join('; ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-xs text-gray-400 space-y-1">
          {orden.preparado_at && <div>Preparado: {new Date(orden.preparado_at).toLocaleString('es-AR')}</div>}
          {orden.despachado_at && <div>Despachado: {new Date(orden.despachado_at).toLocaleString('es-AR')}</div>}
          {orden.recibido_at && <div>Recibido: {new Date(orden.recibido_at).toLocaleString('es-AR')}</div>}
        </div>
      </div>
    </div>
  )
}

export default OrdenDetalle
