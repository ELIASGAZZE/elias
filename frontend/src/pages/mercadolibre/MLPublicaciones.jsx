// Listado de publicaciones Mercado Libre
import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../../services/api'

const formatMoney = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)

const ESTADOS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Activas' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'inactive', label: 'Inactivas' },
  { value: 'closed', label: 'Finalizadas' },
]

const ORDEN = [
  { value: '', label: 'Más recientes' },
  { value: 'precio_asc', label: 'Precio: menor a mayor' },
  { value: 'precio_desc', label: 'Precio: mayor a menor' },
  { value: 'stock_asc', label: 'Menor stock' },
  { value: 'vendidos_desc', label: 'Más vendidos' },
]

const estadoConfig = {
  active: { label: 'Activa', bg: 'bg-green-100 text-green-700' },
  paused: { label: 'Pausada', bg: 'bg-yellow-100 text-yellow-700' },
  closed: { label: 'Finalizada', bg: 'bg-gray-100 text-gray-600' },
  under_review: { label: 'En revisión', bg: 'bg-orange-100 text-orange-700' },
  inactive: { label: 'Inactiva', bg: 'bg-red-100 text-red-700' },
}

const tipoPublicacion = {
  gold_special: 'Premium',
  gold_pro: 'Pro',
  gold: 'Oro',
  silver: 'Plata',
  bronze: 'Bronce',
  free: 'Gratuita',
}

const MLPublicaciones = () => {
  const [publicaciones, setPublicaciones] = useState([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [contadores, setContadores] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [filtros, setFiltros] = useState({ estado: '', busqueda: '', sinStock: false, orderBy: '' })
  const [busquedaInput, setBusquedaInput] = useState('')
  const [syncCostosLoading, setSyncCostosLoading] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ page: pagina, limit: 20 })
      if (filtros.estado) params.set('estado', filtros.estado)
      if (filtros.busqueda) params.set('busqueda', filtros.busqueda)
      if (filtros.sinStock) params.set('sinStock', 'true')
      if (filtros.orderBy) params.set('orderBy', filtros.orderBy)

      const { data } = await api.get(`/api/mercadolibre/publicaciones?${params}`)
      setPublicaciones(data.publicaciones || [])
      setTotal(data.total || 0)
      setPaginas(data.paginas || 1)
    } catch {
      setPublicaciones([])
    } finally {
      setCargando(false)
    }
  }, [pagina, filtros])

  const cargarContadores = async () => {
    try {
      const { data } = await api.get('/api/mercadolibre/publicaciones/contadores')
      setContadores(data)
    } catch {}
  }

  const syncCostosAll = async () => {
    setSyncCostosLoading(true)
    setMensaje(null)
    try {
      const { data } = await api.post('/api/mercadolibre/publicaciones/costos/sync')
      setMensaje({ tipo: 'ok', texto: `${data.actualizados} publicaciones actualizadas con costos` })
      cargar()
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al sincronizar costos' })
    } finally {
      setSyncCostosLoading(false)
    }
  }

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { cargarContadores() }, [])

  const syncPublicaciones = async () => {
    setSincronizando(true)
    setMensaje(null)
    try {
      const { data } = await api.post('/api/mercadolibre/publicaciones/sync')
      setMensaje({ tipo: 'ok', texto: `${data.sincronizadas} publicaciones sincronizadas` })
      cargar()
      cargarContadores()
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.response?.data?.error || 'Error al sincronizar' })
    } finally {
      setSincronizando(false)
    }
  }

  const buscar = (e) => {
    e.preventDefault()
    setPagina(1)
    setFiltros(f => ({ ...f, busqueda: busquedaInput }))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/mercadolibre" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h1 className="font-bold text-gray-800 text-lg">Publicaciones ML</h1>
            <p className="text-xs text-gray-400">{total} publicaciones</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncCostosAll}
            disabled={syncCostosLoading}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            title="Recalcular comisiones y costos de envío desde ML"
          >
            <svg className={`w-4 h-4 ${syncCostosLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {syncCostosLoading ? 'Calculando costos...' : 'Actualizar costos'}
          </button>
          <button
            onClick={syncPublicaciones}
            disabled={sincronizando}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
          >
            <svg className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
          </button>
        </div>
      </nav>

      {/* Mensaje */}
      {mensaje && (
        <div className={`mx-4 mt-4 p-3 rounded-lg text-sm ${
          mensaje.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {mensaje.texto}
          <button onClick={() => setMensaje(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <div className="px-4 py-6">
        {/* KPIs */}
        {contadores && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Activas</p>
              <p className="text-2xl font-bold text-green-600">{contadores.activas}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Pausadas</p>
              <p className="text-2xl font-bold text-yellow-600">{contadores.pausadas}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Inactivas</p>
              <p className="text-2xl font-bold text-orange-600">{contadores.inactivas}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Sin stock</p>
              <p className="text-2xl font-bold text-red-600">{contadores.sin_stock}</p>
            </div>
          </div>
        )}

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
          <div>
            <label className="text-xs text-gray-500 block mb-1">Ordenar</label>
            <select
              value={filtros.orderBy}
              onChange={e => { setPagina(1); setFiltros(f => ({ ...f, orderBy: e.target.value })) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ORDEN.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">&nbsp;</label>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={filtros.sinStock}
                onChange={e => { setPagina(1); setFiltros(f => ({ ...f, sinStock: e.target.checked })) }}
                className="rounded"
              />
              Sin stock
            </label>
          </div>
          <form onSubmit={buscar} className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 block mb-1">Buscar</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={busquedaInput}
                onChange={e => setBusquedaInput(e.target.value)}
                placeholder="Título, MLA ID o SKU..."
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
              />
              <button type="submit" className="px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 text-sm font-semibold rounded-lg">
                Buscar
              </button>
            </div>
          </form>
        </div>

        {/* Tabla de publicaciones */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {cargando ? (
            <div className="p-10 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500 mx-auto" />
            </div>
          ) : publicaciones.length === 0 ? (
            <div className="p-10 text-center text-gray-400">
              {total === 0 && !filtros.busqueda && !filtros.estado
                ? 'No hay publicaciones sincronizadas. Hacé click en "Sincronizar" para traerlas de ML.'
                : 'No se encontraron publicaciones con esos filtros'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">MLA ID</th>
                    <th className="px-4 py-3">Título</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3 text-right">Precio</th>
                    <th className="px-4 py-3 text-center">Stock</th>
                    <th className="px-4 py-3 text-center">Vendidos</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Tipo</th>
                    <th className="px-4 py-3 text-center">Logística</th>
                    <th className="px-4 py-3 text-right">Comisión</th>
                    <th className="px-4 py-3 text-right">Costo envío</th>
                    <th className="px-4 py-3 text-right">Costo total</th>
                    <th className="px-4 py-3 text-right">Recibís</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {publicaciones.map(pub => {
                    const est = estadoConfig[pub.estado] || { label: pub.estado, bg: 'bg-gray-100 text-gray-600' }
                    const tipo = tipoPublicacion[pub.tipo_publicacion] || pub.tipo_publicacion || '-'
                    return (
                      <tr key={pub.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                          {pub.ml_item_id}
                        </td>
                        <td className="px-4 py-3 max-w-[300px]">
                          <div className="flex items-center gap-1.5">
                            <p className="text-gray-800 font-medium truncate" title={pub.titulo}>{pub.titulo}</p>
                            {pub.catalogo && (
                              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">Catálogo</span>
                            )}
                          </div>
                          {pub.tiene_variaciones && (
                            <p className="text-[10px] text-blue-500">{pub.variaciones?.length || 0} variaciones</p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                          {pub.sku || '-'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className="font-semibold text-gray-800">{formatMoney(pub.precio)}</span>
                          {pub.precio_original && pub.precio_original > pub.precio && (
                            <span className="block text-[10px] text-gray-400 line-through">{formatMoney(pub.precio_original)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold ${pub.stock_disponible === 0 ? 'text-red-500' : 'text-gray-800'}`}>
                            {pub.stock_disponible}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600">
                          {pub.vendidos}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${est.bg}`}>
                            {est.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs text-gray-500">{tipo}</span>
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          {pub.fulfillment ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Full</span>
                          ) : pub.envio_gratis ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Gratis</span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {pub.costo_venta ? (
                            <span className="text-red-500 text-xs" title={`${pub.porcentaje_comision?.toFixed(1)}%`}>
                              -{formatMoney(pub.costo_venta)}
                            </span>
                          ) : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {pub.costo_envio ? (
                            <span className="text-orange-500 text-xs">
                              -{formatMoney(pub.costo_envio)}
                            </span>
                          ) : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {pub.costo_total ? (
                            <span className="text-red-600 text-xs font-medium">
                              -{formatMoney(pub.costo_total)}
                            </span>
                          ) : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {pub.recibis ? (
                            <span className={`font-semibold ${pub.recibis >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {formatMoney(pub.recibis)}
                            </span>
                          ) : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3">
                          {pub.permalink && (
                            <a href={pub.permalink} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-yellow-600 hover:text-yellow-800 font-medium whitespace-nowrap">
                              Ver en ML
                            </a>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación */}
          {paginas > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Página {pagina} de {paginas} ({total} publicaciones)
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

export default MLPublicaciones
