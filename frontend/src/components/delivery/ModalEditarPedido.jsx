import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const ModalEditarPedido = ({ pedido, onClose, onEditado }) => {
  const [tipo, setTipo] = useState(pedido.direccion_entrega ? 'delivery' : 'retiro')
  const [sucursalId, setSucursalId] = useState(pedido.sucursal_id || '')
  const [direccionId, setDireccionId] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState(
    pedido.fecha_entrega ? pedido.fecha_entrega.split('T')[0] : ''
  )
  const [sucursales, setSucursales] = useState([])
  const [direcciones, setDirecciones] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get('/api/sucursales')
        setSucursales(data || [])
      } catch (_) {}

      if (pedido.clientes?.id) {
        try {
          const { data } = await api.get(`/api/clientes/${pedido.clientes.id}/direcciones`)
          setDirecciones(data || [])
        } catch (_) {
          setDirecciones([])
        }
      }
    }
    cargar()
  }, [pedido.clientes?.id])

  const confirmar = async () => {
    setGuardando(true)
    setError(null)
    try {
      const body = { tipo }
      if (tipo === 'retiro' && sucursalId) body.sucursal_id = sucursalId
      if (tipo === 'delivery' && direccionId) body.direccion_entrega_id = direccionId
      if (fechaEntrega) body.fecha_entrega = fechaEntrega

      await api.post(`/api/delivery/${pedido.id}/editar`, body)
      onEditado?.()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al editar pedido')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">
            Editar pedido {pedido.numero_documento || ''}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Tipo */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Tipo</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="editTipo" value="delivery" checked={tipo === 'delivery'} onChange={() => setTipo('delivery')} />
                Delivery
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="editTipo" value="retiro" checked={tipo === 'retiro'} onChange={() => setTipo('retiro')} />
                Retiro por sucursal
              </label>
            </div>
          </div>

          {/* Sucursal (retiro) */}
          {tipo === 'retiro' && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Sucursal de retiro</label>
              <select
                value={sucursalId}
                onChange={e => setSucursalId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              >
                <option value="">Seleccionar...</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          )}

          {/* Dirección (delivery) */}
          {tipo === 'delivery' && direcciones.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Dirección de entrega</label>
              <select
                value={direccionId}
                onChange={e => setDireccionId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              >
                <option value="">Sin cambio</option>
                {direcciones.map(d => (
                  <option key={d.id} value={d.id}>
                    {[d.direccion, d.localidad].filter(Boolean).join(', ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Fecha entrega */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Fecha de entrega</label>
            <input
              type="date"
              value={fechaEntrega}
              onChange={e => setFechaEntrega(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Advertencia */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            Se anulará el pedido actual en Centum y se creará uno nuevo con los mismos artículos.
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            disabled={guardando}
            className="flex-1 text-sm py-2.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={guardando || (tipo === 'retiro' && !sucursalId)}
            className="flex-1 text-sm py-2.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {guardando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
            {guardando ? 'Procesando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalEditarPedido
