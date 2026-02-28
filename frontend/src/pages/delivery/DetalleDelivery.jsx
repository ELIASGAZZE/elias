// Detalle de un pedido delivery
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADOS = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700' },
  en_preparacion: { label: 'En preparación', color: 'bg-blue-100 text-blue-700' },
  en_camino: { label: 'En camino', color: 'bg-purple-100 text-purple-700' },
  entregado: { label: 'Entregado', color: 'bg-green-100 text-green-700' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
}

const ORDEN_ESTADOS = ['pendiente', 'en_preparacion', 'en_camino', 'entregado', 'cancelado']

const BadgeEstado = ({ estado }) => {
  const cfg = ESTADOS[estado] || { label: estado, color: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

const formatFechaHora = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const DetalleDelivery = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { esAdmin } = useAuth()

  const [pedido, setPedido] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState('')
  const [confirmarEliminar, setConfirmarEliminar] = useState(false)

  useEffect(() => {
    cargarPedido()
  }, [id])

  const cargarPedido = async () => {
    setCargando(true)
    try {
      const { data } = await api.get(`/api/delivery/${id}`)
      setPedido(data)
    } catch (err) {
      setError('Error al cargar el pedido')
    } finally {
      setCargando(false)
    }
  }

  const cambiarEstado = async (nuevoEstado) => {
    setActualizando(true)
    setError('')
    try {
      await api.put(`/api/delivery/${id}/estado`, { estado: nuevoEstado })
      setPedido(prev => ({ ...prev, estado: nuevoEstado }))
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cambiar estado')
    } finally {
      setActualizando(false)
    }
  }

  const handleEliminar = async () => {
    setEliminando(true)
    setError('')
    try {
      await api.delete(`/api/delivery/${id}`)
      navigate('/delivery')
    } catch (err) {
      setError(err.response?.data?.error || 'Error al eliminar pedido')
      setEliminando(false)
    }
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Delivery" sinTabs volverA="/delivery" />
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-600" />
        </div>
      </div>
    )
  }

  if (!pedido) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Delivery" sinTabs volverA="/delivery" />
        <div className="text-center py-10">
          <p className="text-gray-400">Pedido no encontrado</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Delivery" sinTabs volverA="/delivery" />

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">

        {/* Estado + fecha */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <BadgeEstado estado={pedido.estado} />
            <span className="text-xs text-gray-400">{formatFechaHora(pedido.created_at)}</span>
          </div>
          {pedido.sucursales?.nombre && (
            <p className="text-xs text-gray-400">Sucursal: {pedido.sucursales.nombre}</p>
          )}
          {pedido.perfiles?.nombre && (
            <p className="text-xs text-gray-400">Creado por: {pedido.perfiles.nombre}</p>
          )}
        </div>

        {/* Info del cliente */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Cliente</h3>
          <p className="text-sm font-medium text-gray-800">{pedido.clientes?.razon_social}</p>
          {pedido.clientes?.cuit && (
            <p className="text-xs text-gray-400">CUIT: {pedido.clientes.cuit}</p>
          )}
          {pedido.clientes?.direccion && (
            <p className="text-xs text-gray-400">Dirección: {pedido.clientes.direccion}</p>
          )}
          {pedido.clientes?.telefono && (
            <p className="text-xs text-gray-400">Teléfono: {pedido.clientes.telefono}</p>
          )}
        </div>

        {/* Dirección de entrega */}
        {pedido.direccion_entrega && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-amber-700 mb-1">Dirección de entrega</h3>
            <p className="text-sm text-amber-800">{pedido.direccion_entrega}</p>
          </div>
        )}

        {/* Observaciones */}
        {pedido.observaciones && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Observaciones</h3>
            <p className="text-sm text-gray-600">{pedido.observaciones}</p>
          </div>
        )}

        {/* Items */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Artículos ({pedido.items_delivery?.length || 0})
          </h3>
          <div className="space-y-2">
            {pedido.items_delivery?.map(item => (
              <div key={item.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex-1 mr-3">
                  <p className="text-sm text-gray-800">{item.articulos?.nombre || 'Artículo eliminado'}</p>
                  <p className="text-xs text-gray-400">{item.articulos?.codigo}</p>
                  {item.observaciones && (
                    <p className="text-xs text-gray-500 italic mt-0.5">{item.observaciones}</p>
                  )}
                </div>
                <span className="text-sm font-semibold text-gray-700 bg-gray-100 px-3 py-1 rounded-lg">
                  x{item.cantidad}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Acciones admin */}
        {esAdmin && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Acciones</h3>

            {/* Cambiar estado */}
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Cambiar estado</label>
              <div className="flex flex-wrap gap-2">
                {ORDEN_ESTADOS.filter(e => e !== pedido.estado).map(estado => (
                  <button
                    key={estado}
                    onClick={() => cambiarEstado(estado)}
                    disabled={actualizando}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                  >
                    {ESTADOS[estado]?.label || estado}
                  </button>
                ))}
              </div>
            </div>

            {/* Eliminar */}
            {!confirmarEliminar ? (
              <button
                onClick={() => setConfirmarEliminar(true)}
                className="w-full text-sm text-red-600 border border-red-200 py-2 rounded-xl hover:bg-red-50 transition-colors"
              >
                Eliminar pedido
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-sm text-red-700 mb-2">¿Estás seguro? Esta acción no se puede deshacer.</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleEliminar}
                    disabled={eliminando}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
                  </button>
                  <button
                    onClick={() => setConfirmarEliminar(false)}
                    className="flex-1 bg-white border border-gray-300 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg border border-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default DetalleDelivery
