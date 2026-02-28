// Página principal de la app Delivery
import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
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
  const [pedidos, setPedidos] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaActiva, setBusquedaActiva] = useState('')
  const [cargando, setCargando] = useState(true)
  const debounceRef = useRef(null)
  const LIMIT = 15

  useEffect(() => {
    cargarPedidos()
  }, [page, filtroEstado, busquedaActiva])

  // Debounce de búsqueda
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setBusquedaActiva(busqueda)
      setPage(1)
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [busqueda])

  const cargarPedidos = async () => {
    setCargando(true)
    try {
      const params = { page, limit: LIMIT }
      if (filtroEstado) params.estado = filtroEstado
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

  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Delivery" sinTabs />

      <div className="px-4 py-4 space-y-3 max-w-4xl mx-auto">

        {/* Barra de búsqueda + filtro estado + botón nuevo */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, dirección, sucursal..."
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-400"
          />
          <select
            value={filtroEstado}
            onChange={(e) => { setFiltroEstado(e.target.value); setPage(1) }}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 bg-white"
          >
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <Link
            to="/delivery/nuevo"
            className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl transition-colors"
            title="Nuevo pedido"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
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
              {busquedaActiva ? 'No se encontraron pedidos' : 'No hay pedidos delivery'}
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
                  <span className="text-sm font-semibold text-gray-800 truncate mr-2">
                    {pedido.clientes?.razon_social || 'Sin cliente'}
                  </span>
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
    </div>
  )
}

export default DeliveryHome
