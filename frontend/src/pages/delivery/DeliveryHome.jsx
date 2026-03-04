// Página principal de la app Delivery
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
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
  const { esAdmin, usuario } = useAuth()
  const [pedidos, setPedidos] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [busquedaActiva, setBusquedaActiva] = useState('')
  const [cargando, setCargando] = useState(true)
  const [mostrarNuevoPedido, setMostrarNuevoPedido] = useState(false)
  const [pedidoEditando, setPedidoEditando] = useState(null)
  const [actualizandoId, setActualizandoId] = useState(null)
  const [filtroFecha, setFiltroFecha] = useState('')
  const [linkMpCopiado, setLinkMpCopiado] = useState(null)
  const [generandoLink, setGenerandoLink] = useState(null)

  useEffect(() => {
    cargarPedidos()
  }, [busquedaActiva])

  // Debounce de búsqueda
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setBusquedaActiva(busqueda)
    }, 400)
    return () => clearTimeout(timeoutId)
  }, [busqueda])

  const cargarPedidos = async () => {
    setCargando(true)
    try {
      const params = { page: 1, limit: 200 }
      if (busquedaActiva.trim()) params.busqueda = busquedaActiva.trim()

      const { data } = await api.get('/api/delivery', { params })
      setPedidos(data.pedidos)
    } catch (err) {
      console.error('Error cargando pedidos delivery:', err)
    } finally {
      setCargando(false)
    }
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

  const generarLinkMP = async (e, pedidoId) => {
    e.preventDefault()
    e.stopPropagation()
    setGenerandoLink(pedidoId)
    try {
      const { data } = await api.post(`/api/delivery/${pedidoId}/link-pago`)
      await navigator.clipboard.writeText(data.link)
      setLinkMpCopiado(pedidoId)
      setTimeout(() => setLinkMpCopiado(null), 2000)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al generar link de pago')
    } finally {
      setGenerandoLink(null)
    }
  }

  // Calcular total de un pedido
  const calcularTotal = (items) => {
    if (!items || items.length === 0) return null
    const tienePrecios = items.some(i => i.precio != null)
    if (!tienePrecios) return null
    return items.reduce((sum, i) => sum + (i.precio || 0) * (i.cantidad || 0), 0)
  }

  // Filtrar por fecha de entrega si se seleccionó
  const pedidosFiltrados = filtroFecha
    ? pedidos.filter(p => {
        if (!p.fecha_entrega) return false
        const fe = new Date(p.fecha_entrega).toISOString().slice(0, 10)
        return fe === filtroFecha
      })
    : pedidos

  // Agrupar pedidos por estado
  const pedidosPorEstado = {
    pendiente_pago: pedidosFiltrados.filter(p => p.estado === 'pendiente_pago'),
    pagado: pedidosFiltrados.filter(p => p.estado === 'pagado'),
    entregado: pedidosFiltrados.filter(p => p.estado === 'entregado'),
  }
  const totalFiltrado = pedidosFiltrados.length

  // Card de pedido reutilizable
  const renderCard = (pedido, compacto = false) => {
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
        className="block bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 hover:shadow-sm transition-all"
      >
        {/* Fila 1: Nro doc + badges */}
        <div className="flex items-center justify-between mb-1.5">
          <span className={`font-mono font-semibold text-gray-800 ${compacto ? 'text-xs' : 'text-sm'}`}>
            {pedido.numero_documento || `#${pedido.id}`}
          </span>
          <div className="flex items-center gap-1">
            {!compacto && <BadgeEstado estado={pedido.estado} />}
            {pedido.estado_centum && pedido.estado_centum !== 'Anulado' && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                {pedido.estado_centum}
              </span>
            )}
          </div>
        </div>

        {/* Fila 2: Cliente */}
        <div className="mb-1">
          <span className={`font-medium text-gray-800 ${compacto ? 'text-xs' : 'text-sm'}`}>
            {pedido.clientes?.razon_social || 'Sin cliente'}
          </span>
          {!compacto && (
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-gray-400 mt-0.5">
              {pedido.clientes?.cuit && <span>CUIT: {pedido.clientes.cuit}</span>}
              {pedido.clientes?.telefono && <span>Tel: {pedido.clientes.telefono}</span>}
              {pedido.clientes?.direccion && <span>{pedido.clientes.direccion}</span>}
            </div>
          )}
        </div>

        {/* Fila 3: Tipo + dirección/sucursal */}
        <div className={`text-gray-500 mb-1 ${compacto ? 'text-[11px]' : 'text-xs'}`}>
          {esDelivery ? (
            <span className="inline-flex items-center gap-1">
              <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
              </svg>
              <span className="truncate">{pedido.direccion_entrega}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <svg className="w-3 h-3 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0V7.875C3 6.839 3.839 6 4.875 6h14.25C20.16 6 21 6.839 21 7.875v1.474" />
              </svg>
              {pedido.sucursales?.nombre || 'Sucursal'}
            </span>
          )}
        </div>

        {/* Fechas (solo en modo normal) */}
        {!compacto && (
          <div className="flex flex-wrap items-center gap-x-3 text-xs text-gray-400 mb-1">
            {pedido.fecha_entrega && <span>Entrega: {formatFecha(pedido.fecha_entrega)}</span>}
            <span>Creado: {formatFechaHora(pedido.created_at)}</span>
            {pedido.perfiles?.nombre && <span>por {pedido.perfiles.nombre}</span>}
          </div>
        )}

        {/* Observaciones (solo en modo normal) */}
        {!compacto && pedido.observaciones && (
          <p className="text-xs text-gray-500 italic mb-1 line-clamp-2">
            {pedido.observaciones}
          </p>
        )}

        {/* Total + cantidad artículos */}
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-100">
          <span className={`text-gray-400 ${compacto ? 'text-[11px]' : 'text-xs'}`}>
            {cantItems} art.
          </span>
          {totalPedido != null && (
            <span className={`font-bold text-gray-800 ${compacto ? 'text-xs' : 'text-sm'}`}>
              {formatPrecio(totalPedido)}
            </span>
          )}
        </div>

        {/* Botón Link MP para pendiente_pago */}
        {!compacto && pedido.estado === 'pendiente_pago' && noCancelado && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <button
              onClick={(e) => generarLinkMP(e, pedido.id)}
              disabled={generandoLink === pedido.id}
              className={`w-full text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                linkMpCopiado === pedido.id
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
              } disabled:opacity-40`}
            >
              {generandoLink === pedido.id ? 'Generando...' : linkMpCopiado === pedido.id ? 'Copiado!' : 'Link MP'}
            </button>
          </div>
        )}

        {/* Botones de acción (solo en modo normal) */}
        {!compacto && noCancelado && (esAdmin || pedido.estado === 'pagado') && (
          <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100">
            {esAdmin && ORDEN_ESTADOS.filter(e => e !== pedido.estado && e !== 'cancelado').map(estado => (
              <button
                key={estado}
                onClick={(e) => cambiarEstado(e, pedido.id, estado)}
                disabled={actualizandoId === pedido.id}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors text-gray-600"
              >
                {ESTADOS[estado]?.label || estado}
              </button>
            ))}
            {!esAdmin && pedido.estado === 'pagado' && (
              <button
                onClick={(e) => cambiarEstado(e, pedido.id, 'entregado')}
                disabled={actualizandoId === pedido.id}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 disabled:opacity-40 transition-colors text-green-700"
              >
                Marcar como Entregado
              </button>
            )}
            <div className="flex-1" />
            {esAdmin && puedeEliminar && (
              <button
                onClick={(e) => abrirEditar(e, pedido)}
                disabled={actualizandoId === pedido.id}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors"
              >
                Editar
              </button>
            )}
            {esAdmin && puedeEliminar && (
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
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Delivery" sinTabs />

      <div className="px-4 py-4 space-y-3 max-w-6xl mx-auto">

        {/* Barra de búsqueda + filtro fecha + botones */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => cargarPedidos()}
            disabled={cargando}
            className="flex-shrink-0 bg-white border border-gray-200 hover:bg-gray-50 text-gray-500 p-2.5 rounded-xl transition-colors disabled:opacity-40"
            title="Recargar pedidos"
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
          <div className="relative flex-shrink-0">
            <input
              type="date"
              value={filtroFecha}
              onChange={(e) => setFiltroFecha(e.target.value)}
              className={`text-sm border rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 w-[140px] ${filtroFecha ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`}
              title="Filtrar por fecha de entrega"
            />
            {filtroFecha && (
              <button
                onClick={() => setFiltroFecha('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Limpiar filtro fecha"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <button
            onClick={() => setMostrarNuevoPedido(true)}
            className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl transition-colors"
            title="Nuevo pedido de venta"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>

        {/* Contador de resultados */}
        {!cargando && (
          <p className="text-xs text-gray-400">
            {totalFiltrado} pedido{totalFiltrado !== 1 ? 's' : ''}
            {busquedaActiva && ` para "${busquedaActiva}"`}
            {filtroFecha && ` · Entrega: ${formatFecha(filtroFecha + 'T12:00:00')}`}
          </p>
        )}

        {/* Contenido: siempre 3 columnas */}
        {cargando ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
          </div>
        ) : pedidosFiltrados.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-400 text-sm">No se encontraron pedidos</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TABS.map(tab => {
              const lista = pedidosPorEstado[tab.key] || []
              const colorBorde = tab.color === 'amber' ? 'border-amber-400' : tab.color === 'blue' ? 'border-blue-400' : 'border-green-400'
              const colorBg = tab.color === 'amber' ? 'bg-amber-50 text-amber-700' : tab.color === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
              return (
                <div key={tab.key} className={`border-t-4 ${colorBorde} rounded-xl bg-white`}>
                  <div className={`px-3 py-2 ${colorBg} rounded-t-lg flex items-center justify-between`}>
                    <span className="text-sm font-semibold">{tab.label}</span>
                    <span className="text-xs font-medium opacity-70">{lista.length}</span>
                  </div>
                  <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                    {lista.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">Sin pedidos</p>
                    ) : (
                      lista.map(p => renderCard(p, false))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal nuevo pedido de venta */}
      {mostrarNuevoPedido && (
        <ModalNuevoPedido
          onClose={() => setMostrarNuevoPedido(false)}
          onCreado={() => { setMostrarNuevoPedido(false); cargarPedidos() }}
          usuario={usuario}
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
