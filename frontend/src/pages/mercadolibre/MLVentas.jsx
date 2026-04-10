// Listado de ventas/órdenes de Mercado Libre
import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../../services/api'

const formatMoney = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)
const formatFecha = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const ESTADOS = [
  { value: '', label: 'Todos' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'pending', label: 'Pendientes' },
]

const estadoColor = (estado) => {
  switch (estado) {
    case 'paid': return 'bg-green-100 text-green-700'
    case 'cancelled': return 'bg-red-100 text-red-700'
    case 'pending': return 'bg-yellow-100 text-yellow-700'
    default: return 'bg-gray-100 text-gray-600'
  }
}

const MLVentas = () => {
  const [ordenes, setOrdenes] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [filtros, setFiltros] = useState({ estado: '', busqueda: '' })
  const [busquedaInput, setBusquedaInput] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams()
      params.set('page', pagina)
      params.set('limit', 20)
      if (filtros.estado) params.set('estado', filtros.estado)
      if (filtros.busqueda) params.set('busqueda', filtros.busqueda)

      const { data } = await api.get(`/api/mercadolibre/ordenes?${params}`)
      setOrdenes(data.ordenes || [])
      setTotal(data.total || 0)
      setPaginas(data.paginas || 1)
    } catch {
      setOrdenes([])
    } finally {
      setCargando(false)
    }
  }, [pagina, filtros])

  useEffect(() => { cargar() }, [cargar])

  const buscar = (e) => {
    e.preventDefault()
    setPagina(1)
    setFiltros(f => ({ ...f, busqueda: busquedaInput }))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Link to="/mercadolibre" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="font-bold text-gray-800 text-lg">Ventas ML</h1>
          <p className="text-xs text-gray-400">{total} órdenes encontradas</p>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Filtros */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Estado</label>
            <select
              value={filtros.estado}
              onChange={e => { setPagina(1); setFiltros(f => ({ ...f, estado: e.target.value })) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <form onSubmit={buscar} className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 block mb-1">Buscar</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={busquedaInput}
                onChange={e => setBusquedaInput(e.target.value)}
                placeholder="Nickname, nombre o ID de orden..."
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
              />
              <button type="submit" className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-sm font-semibold rounded-lg">
                Buscar
              </button>
            </div>
          </form>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {cargando ? (
            <div className="p-10 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500 mx-auto" />
            </div>
          ) : ordenes.length === 0 ? (
            <div className="p-10 text-center text-gray-400">No hay órdenes</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Orden</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Comprador</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Envío</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ordenes.map(orden => (
                    <tr key={orden.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        #{orden.ml_order_id}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {formatFecha(orden.fecha_creacion)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{orden.comprador_nickname}</div>
                        <div className="text-xs text-gray-400">{orden.comprador_nombre}</div>
                      </td>
                      <td className="px-4 py-3">
                        {(orden.items || []).map((item, i) => (
                          <div key={i} className="text-xs text-gray-600 truncate max-w-[200px]">
                            {item.cantidad}x {item.titulo}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">
                        {formatMoney(orden.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium capitalize ${estadoColor(orden.estado)}`}>
                          {orden.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {orden.envio_estado ? (
                          <span className="text-xs text-gray-500 capitalize">{orden.envio_estado}</span>
                        ) : (
                          <span className="text-xs text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación */}
          {paginas > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Página {pagina} de {paginas} ({total} resultados)
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                  disabled={pagina <= 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-30 hover:bg-gray-50"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPagina(p => Math.min(paginas, p + 1))}
                  disabled={pagina >= paginas}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-30 hover:bg-gray-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default MLVentas
