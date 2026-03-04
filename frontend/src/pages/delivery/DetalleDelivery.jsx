// Detalle de un pedido delivery
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADOS = {
  pendiente_pago: { label: 'Pendiente de pago', color: 'bg-yellow-100 text-yellow-700' },
  pagado: { label: 'Pagado', color: 'bg-blue-100 text-blue-700' },
  entregado: { label: 'Entregado', color: 'bg-green-100 text-green-700' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-700' },
  // Legacy
  pendiente: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700' },
  en_preparacion: { label: 'En preparación', color: 'bg-blue-100 text-blue-700' },
  en_camino: { label: 'En camino', color: 'bg-purple-100 text-purple-700' },
}

const ORDEN_ESTADOS = ['pendiente_pago', 'pagado', 'entregado', 'cancelado']

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

const formatPrecio = (precio) => {
  if (precio == null) return null
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const DetalleDelivery = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { esAdmin } = useAuth()

  const [pedido, setPedido] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [error, setError] = useState('')

  // Estado para edición
  const [editando, setEditando] = useState(false)
  const [editTipo, setEditTipo] = useState('delivery')
  const [editSucursalId, setEditSucursalId] = useState('')
  const [editDireccionId, setEditDireccionId] = useState('')
  const [editFechaEntrega, setEditFechaEntrega] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [direcciones, setDirecciones] = useState([])
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)

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

  const abrirEdicion = async () => {
    setEditando(true)
    setError('')
    // Determinar tipo actual
    const tipoActual = pedido.direccion_entrega ? 'delivery' : 'retiro'
    setEditTipo(tipoActual)
    setEditSucursalId(pedido.sucursal_id || '')
    setEditFechaEntrega(pedido.fecha_entrega ? pedido.fecha_entrega.split('T')[0] : '')

    // Cargar sucursales
    try {
      const { data } = await api.get('/api/sucursales')
      setSucursales(data || [])
    } catch (_) {}

    // Cargar direcciones del cliente si hay
    if (pedido.clientes?.id_centum || pedido.clientes?.id) {
      try {
        const clienteId = pedido.clientes.id
        const { data } = await api.get(`/api/clientes/${clienteId}/direcciones`)
        setDirecciones(data || [])
      } catch (_) {
        setDirecciones([])
      }
    }
  }

  const confirmarEdicion = async () => {
    setGuardandoEdicion(true)
    setError('')
    try {
      const body = { tipo: editTipo }
      if (editTipo === 'retiro' && editSucursalId) body.sucursal_id = editSucursalId
      if (editTipo === 'delivery' && editDireccionId) body.direccion_entrega_id = editDireccionId
      if (editFechaEntrega) body.fecha_entrega = editFechaEntrega

      const { data } = await api.post(`/api/delivery/${id}/editar`, body)
      // Redirigir al nuevo pedido
      const nuevoId = data.pedido_nuevo?.id
      if (nuevoId) {
        navigate(`/delivery/${nuevoId}`, { replace: true })
      } else {
        setEditando(false)
        cargarPedido()
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Error al editar pedido')
    } finally {
      setGuardandoEdicion(false)
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

  // Calcular total del pedido si hay precios
  const tienePrecios = pedido.items_delivery?.some(i => i.precio != null)
  const totalPedido = tienePrecios
    ? pedido.items_delivery.reduce((sum, i) => sum + (i.precio || 0) * (i.cantidad || 0), 0)
    : null

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Delivery" sinTabs volverA="/delivery" />

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">

        {/* Estado + fecha + documento */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <BadgeEstado estado={pedido.estado} />
              {pedido.estado_centum && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  Centum: {pedido.estado_centum}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400">{formatFechaHora(pedido.created_at)}</span>
          </div>
          {pedido.numero_documento && (
            <p className="text-sm font-mono font-semibold text-gray-700 mb-1">{pedido.numero_documento}</p>
          )}
          {pedido.sucursales?.nombre && (
            <p className="text-xs text-gray-400">Sucursal: {pedido.sucursales.nombre}</p>
          )}
          {pedido.perfiles?.nombre && (
            <p className="text-xs text-gray-400">Creado por: {pedido.perfiles.nombre}</p>
          )}
          {pedido.fecha_entrega && (
            <p className="text-xs text-gray-400">Entrega: {formatFechaHora(pedido.fecha_entrega)}</p>
          )}
          {pedido.id_pedido_centum && !pedido.numero_documento && (
            <p className="text-xs text-gray-400 mt-1">
              Centum: <span className="font-mono font-medium text-gray-600">Pedido #{pedido.id_pedido_centum}</span>
            </p>
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
                <div className="flex items-center gap-3">
                  {item.precio != null && (
                    <span className="text-xs text-gray-500">{formatPrecio(item.precio)}</span>
                  )}
                  <span className="text-sm font-semibold text-gray-700 bg-gray-100 px-3 py-1 rounded-lg">
                    x{item.cantidad}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {totalPedido != null && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-sm font-bold text-gray-800">{formatPrecio(totalPedido)}</span>
            </div>
          )}
        </div>

        {/* Acciones admin */}
        {esAdmin && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Acciones</h3>

            {/* Botón Editar pedido — solo si no está cancelado/anulado */}
            {pedido.estado !== 'cancelado' && pedido.estado_centum !== 'Anulado' && (
              <div>
                {!editando ? (
                  <button
                    onClick={abrirEdicion}
                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  >
                    Editar pedido
                  </button>
                ) : (
                  <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-3">
                    <p className="text-xs text-amber-700 font-medium">
                      Se anulará el pedido actual y se creará uno nuevo con los mismos artículos.
                    </p>

                    {/* Tipo */}
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Tipo</label>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="radio" name="editTipo" value="delivery" checked={editTipo === 'delivery'} onChange={() => setEditTipo('delivery')} />
                          Delivery
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input type="radio" name="editTipo" value="retiro" checked={editTipo === 'retiro'} onChange={() => setEditTipo('retiro')} />
                          Retiro por sucursal
                        </label>
                      </div>
                    </div>

                    {/* Sucursal (solo retiro) */}
                    {editTipo === 'retiro' && (
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Sucursal de retiro</label>
                        <select
                          value={editSucursalId}
                          onChange={e => setEditSucursalId(e.target.value)}
                          className="w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5"
                        >
                          <option value="">Seleccionar...</option>
                          {sucursales.map(s => (
                            <option key={s.id} value={s.id}>{s.nombre}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Dirección (solo delivery) */}
                    {editTipo === 'delivery' && direcciones.length > 0 && (
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Dirección de entrega</label>
                        <select
                          value={editDireccionId}
                          onChange={e => setEditDireccionId(e.target.value)}
                          className="w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5"
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

                    {/* Fecha de entrega */}
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Fecha de entrega</label>
                      <input
                        type="date"
                        value={editFechaEntrega}
                        onChange={e => setEditFechaEntrega(e.target.value)}
                        className="w-full text-xs border border-gray-300 rounded-lg px-2 py-1.5"
                      />
                    </div>

                    {/* Botones */}
                    <div className="flex gap-2">
                      <button
                        onClick={confirmarEdicion}
                        disabled={guardandoEdicion || (editTipo === 'retiro' && !editSucursalId)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors"
                      >
                        {guardandoEdicion ? 'Procesando...' : 'Confirmar edición'}
                      </button>
                      <button
                        onClick={() => setEditando(false)}
                        disabled={guardandoEdicion}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

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
