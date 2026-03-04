// Página principal de la app Delivery
import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ModalNuevoPedido from '../../components/delivery/ModalNuevoPedido'
import ModalEditarPedido from '../../components/delivery/ModalEditarPedido'
import api from '../../services/api'

const TABS = [
  { key: 'pendiente_pago', label: 'Pendiente de pago', color: 'amber' },
  { key: 'pagado', label: 'Pagados', color: 'blue' },
  { key: 'entregado', label: 'Entregados', color: 'green' },
]

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

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const formatPrecio = (precio) => {
  if (precio == null) return null
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const DeliveryHome = () => {
  const { esAdmin } = useAuth()
  const navigate = useNavigate()
  const [tabActivo, setTabActivo] = useState('pendiente_pago')
  const [pedidos, setPedidos] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaActiva, setBusquedaActiva] = useState('')
  const [cargando, setCargando] = useState(true)
  const [mostrarNuevoPedido, setMostrarNuevoPedido] = useState(false)
  const [pedidoEditando, setPedidoEditando] = useState(null)
  const [actualizandoId, setActualizandoId] = useState(null)
  const LIMIT = 15

  useEffect(() => {
    cargarPedidos()
  }, [page, tabActivo, busquedaActiva])

  // Debounce de búsqueda
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setBusquedaActiva(busqueda)
      setPage(1)
    }, 400)
    return () => clearTimeout(timeoutId)
  }, [busqueda])

  const cargarPedidos = async () => {
    setCargando(true)
    try {
      const params = { page, limit: LIMIT, estado: tabActivo }
      if (busquedaActiva.trim()) params.busqueda = busquedaActiva.trim()

      const { data } = await api.get('/api/delivery', { params })
      setPedidos(data.pedidos)
      setTotal(data.total)
    } catch (err) {
      console.error('Error cargando pedidos delivery:', err)
    } finally {
      setCargando(false)
    }
  }

  const cambiarTab = (key) => {
    setTabActivo(key)
    setPage(1)
  }

  const cambiarEstado = async (e, pedidoId, nuevoEstado) => {
    e.preventDefault()
    e.stopPropagation()
    setActualizandoId(pedidoId)
    try {
      await api.put(`/api/delivery/${pedidoId}/estado`, { estado: nuevoEstado })
      cargarPedidos()
    } catch (err) {
      console.error('Error al cambiar estado:', err)
    } finally {
      setActualizandoId(null)
    }
  }

  const eliminarPedido = async (e, pedido) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`¿Anular pedido ${pedido.numero_documento || pedido.id}? Esta acción no se puede deshacer.`)) return
    setActualizandoId(pedido.id)
    try {
      await api.post(`/api/delivery/${pedido.id}/eliminar`)
      cargarPedidos()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al anular pedido')
    } finally {
      setActualizandoId(null)
    }
  }

  const abrirEditar = (e, pedido) => {
    e.preventDefault()
    e.stopPropagation()
    setPedidoEditando(pedido)
  }

  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT))

  // Calcular total de un pedido
  const calcularTotal = (items) => {
    if (!items || items.length === 0) return null
    const tienePrecios = items.some(i => i.precio != null)
    if (!tienePrecios) return null
    return items.reduce((sum, i) => sum + (i.precio || 0) * (i.cantidad || 0), 0)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Delivery" sinTabs />

      <div className="px-4 py-4 space-y-3 max-w-4xl mx-auto">

        {/* Tabs */}
        <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => cambiarTab(tab.key)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tabActivo === tab.key
                  ? tab.color === 'amber' ? 'bg-amber-600 text-white'
                    : tab.color === 'blue' ? 'bg-blue-600 text-white'
                    : 'bg-green-600 text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Barra de búsqueda + botones */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => cargarPedidos()}
            disabled={cargando}
            className="flex-shrink-0 bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 p-2.5 rounded-xl transition-colors disabled:opacity-40"
            title="Sincronizar pedidos"
          >
            <svg className={`w-5 h-5 ${cargando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
          </button>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, dirección, sucursal..."
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-400"
          />
          {esAdmin && (
            <button
              onClick={() => setMostrarNuevoPedido(true)}
              className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl transition-colors"
              title="Nuevo pedido de venta"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}
        </div>

        {/* Contador de resultados */}
        {!cargando && (
          <p className="text-xs text-gray-400">
            {total} pedido{total !== 1 ? 's' : ''}
            {busquedaActiva && ` para "${busquedaActiva}"`}
          </p>
        )}

        {/* Lista de pedidos */}
        {cargando ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
          </div>
        ) : pedidos.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-400 text-sm">
              {busquedaActiva ? 'No se encontraron pedidos' : 'No hay pedidos en esta categoría'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pedidos.map(pedido => {
              const totalPedido = calcularTotal(pedido.items_delivery)
              const cantItems = pedido.items_delivery?.length || 0
              const esDelivery = !!pedido.direccion_entrega
              const noCancelado = pedido.estado !== 'cancelado' && pedido.estado_centum !== 'Anulado'
              const suscriptoTotal = pedido.estado_centum?.toLowerCase().includes('suscripto total')
              const puedeEliminar = noCancelado && !suscriptoTotal

              return (
                <Link
                  key={pedido.id}
                  to={`/delivery/${pedido.id}`}
                  className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  {/* Fila 1: Nro doc + badges */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-mono font-semibold text-gray-800">
                      {pedido.numero_documento || `#${pedido.id}`}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <BadgeEstado estado={pedido.estado} />
                      {pedido.estado_centum && pedido.estado_centum !== 'Anulado' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                          {pedido.estado_centum}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Fila 2: Cliente */}
                  <div className="mb-1.5">
                    <span className="text-sm font-medium text-gray-800">
                      {pedido.clientes?.razon_social || 'Sin cliente'}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-gray-400 mt-0.5">
                      {pedido.clientes?.cuit && <span>CUIT: {pedido.clientes.cuit}</span>}
                      {pedido.clientes?.telefono && <span>Tel: {pedido.clientes.telefono}</span>}
                      {pedido.clientes?.direccion && <span>{pedido.clientes.direccion}</span>}
                    </div>
                  </div>

                  {/* Fila 3: Tipo + dirección/sucursal */}
                  <div className="text-xs text-gray-500 mb-1.5">
                    {esDelivery ? (
                      <span className="inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                        </svg>
                        Entregar en: <span className="font-medium text-gray-700">{pedido.direccion_entrega}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0V7.875C3 6.839 3.839 6 4.875 6h14.25C20.16 6 21 6.839 21 7.875v1.474" />
                        </svg>
                        Retiro por: <span className="font-medium text-gray-700">{pedido.sucursales?.nombre || 'Sucursal'}</span>
                      </span>
                    )}
                    {!esDelivery && pedido.sucursales?.nombre && null}
                  </div>

                  {/* Fila 4: Fechas + creado por */}
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-gray-400 mb-1">
                    {pedido.fecha_entrega && (
                      <span>Entrega: {formatFecha(pedido.fecha_entrega)}</span>
                    )}
                    <span>Creado: {formatFechaHora(pedido.created_at)}</span>
                    {pedido.perfiles?.nombre && (
                      <span>por {pedido.perfiles.nombre}</span>
                    )}
                  </div>

                  {/* Fila 5: Observaciones */}
                  {pedido.observaciones && (
                    <p className="text-xs text-gray-500 italic mb-1 line-clamp-2">
                      {pedido.observaciones}
                    </p>
                  )}

                  {/* Fila 6: Total + cantidad artículos */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-400">
                      {cantItems} artículo{cantItems !== 1 ? 's' : ''}
                    </span>
                    {totalPedido != null && (
                      <span className="text-sm font-bold text-gray-800">
                        {formatPrecio(totalPedido)}
                      </span>
                    )}
                  </div>

                  {/* Fila 7: Botones admin */}
                  {esAdmin && noCancelado && (
                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-gray-100">
                      {/* Cambiar estado */}
                      {ORDEN_ESTADOS.filter(e => e !== pedido.estado && e !== 'cancelado').map(estado => (
                        <button
                          key={estado}
                          onClick={(e) => cambiarEstado(e, pedido.id, estado)}
                          disabled={actualizandoId === pedido.id}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors text-gray-600"
                        >
                          {ESTADOS[estado]?.label || estado}
                        </button>
                      ))}
                      <div className="flex-1" />
                      {/* Editar */}
                      <button
                        onClick={(e) => abrirEditar(e, pedido)}
                        disabled={actualizandoId === pedido.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors"
                      >
                        Editar
                      </button>
                      {/* Eliminar (no si suscripto total) */}
                      {puedeEliminar && (
                        <button
                          onClick={(e) => eliminarPedido(e, pedido)}
                          disabled={actualizandoId === pedido.id}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors"
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}

        {/* Paginación */}
        {total > LIMIT && (
          <div className="flex items-center justify-between mt-4 gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Anterior
            </button>
            <span className="text-sm text-gray-500">
              Página {page} de {totalPaginas}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPaginas, p + 1))}
              disabled={page >= totalPaginas}
              className="text-sm px-4 py-2 rounded-lg bg-white border border-gray-300 disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>

      {/* Modal nuevo pedido de venta */}
      {mostrarNuevoPedido && (
        <ModalNuevoPedido
          onClose={() => setMostrarNuevoPedido(false)}
          onCreado={() => { setMostrarNuevoPedido(false); cargarPedidos() }}
        />
      )}

      {/* Modal editar pedido */}
      {pedidoEditando && (
        <ModalEditarPedido
          pedido={pedidoEditando}
          onClose={() => setPedidoEditando(null)}
          onEditado={() => { setPedidoEditando(null); cargarPedidos() }}
        />
      )}
    </div>
  )
}

export default DeliveryHome
