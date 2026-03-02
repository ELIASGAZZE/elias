// Página principal de la app Delivery
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import NuevoClienteModal from '../../components/NuevoClienteModal'
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

const DeliveryHome = () => {
  const { esAdmin } = useAuth()
  const [tabActivo, setTabActivo] = useState('pendiente_pago')
  const [pedidos, setPedidos] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaActiva, setBusquedaActiva] = useState('')
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [mensajeSync, setMensajeSync] = useState(null)
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false)
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

  const sincronizar = async () => {
    setSincronizando(true)
    setMensajeSync(null)
    try {
      const { data } = await api.post('/api/delivery/sincronizar')
      setMensajeSync({ tipo: 'ok', texto: data.mensaje })
      // Recargar lista después de sincronizar
      cargarPedidos()
    } catch (err) {
      setMensajeSync({ tipo: 'error', texto: err.response?.data?.error || 'Error al sincronizar' })
    } finally {
      setSincronizando(false)
      // Ocultar mensaje después de 5s
      setTimeout(() => setMensajeSync(null), 5000)
    }
  }

  const cambiarTab = (key) => {
    setTabActivo(key)
    setPage(1)
  }

  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT))

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

        {/* Barra de búsqueda + botón sincronizar */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, dirección, sucursal..."
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-400"
          />
          {esAdmin && (
            <>
              <button
                onClick={() => setMostrarNuevoCliente(true)}
                className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl transition-colors"
                title="Nuevo cliente"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </button>
              <button
                onClick={sincronizar}
                disabled={sincronizando}
                className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white p-2.5 rounded-xl transition-colors"
                title="Sincronizar pedidos desde Centum"
              >
                <svg className={`w-5 h-5 ${sincronizando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Mensaje de sincronización */}
        {mensajeSync && (
          <div className={`text-sm px-4 py-2.5 rounded-xl border ${
            mensajeSync.tipo === 'ok'
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            {mensajeSync.texto}
          </div>
        )}

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
          <div className="space-y-2">
            {pedidos.map(pedido => (
              <Link
                key={pedido.id}
                to={`/delivery/${pedido.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 truncate mr-2">
                    <span className="text-sm font-semibold text-gray-800 truncate">
                      {pedido.clientes?.razon_social || 'Sin cliente'}
                    </span>
                    {pedido.numero_documento && (
                      <span className="text-xs font-mono text-gray-400">{pedido.numero_documento}</span>
                    )}
                  </div>
                  <BadgeEstado estado={pedido.estado} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-400 truncate">
                    {pedido.direccion_entrega && (
                      <span>{pedido.direccion_entrega}</span>
                    )}
                    {pedido.items_delivery && (
                      <span> · {pedido.items_delivery.length} art.</span>
                    )}
                    {pedido.sucursales?.nombre && (
                      <span> · {pedido.sucursales.nombre}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                    {formatFechaHora(pedido.created_at)}
                  </span>
                </div>
              </Link>
            ))}
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

      {/* Modal nuevo cliente */}
      {mostrarNuevoCliente && (
        <NuevoClienteModal
          onClose={() => setMostrarNuevoCliente(false)}
          onCreado={() => setMostrarNuevoCliente(false)}
        />
      )}
    </div>
  )
}

export default DeliveryHome
