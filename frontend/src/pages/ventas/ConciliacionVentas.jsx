import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import VentasTabBar from '../../components/ventas/VentasTabBar'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

const formatFechaHora = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_ORDER = { pending_sync: 0, missing_centum: 1, mismatch: 2, missing_pos: 3, matched: 4 }

const sortRows = (rows, key, dir) => {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    let va = a[key], vb = b[key]
    // nulls always last
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    // status uses predefined order
    if (key === 'status') { va = STATUS_ORDER[va] ?? 5; vb = STATUS_ORDER[vb] ?? 5 }
    // dates: compare as Date
    if (key === 'fecha_pos' || key === 'fecha_centum') { va = new Date(va).getTime(); vb = new Date(vb).getTime() }
    // strings
    if (typeof va === 'string' && typeof vb === 'string') {
      const cmp = va.localeCompare(vb, 'es', { sensitivity: 'base' })
      return dir === 'asc' ? cmp : -cmp
    }
    // numbers
    return dir === 'asc' ? va - vb : vb - va
  })
}

const STATUS_CONFIG = {
  matched:        { label: 'Coincide',    bg: 'bg-emerald-100', text: 'text-emerald-700' },
  mismatch:       { label: 'Diferencia',  bg: 'bg-amber-100',   text: 'text-amber-700' },
  missing_centum: { label: 'Sin Centum',  bg: 'bg-red-100',     text: 'text-red-700' },
  missing_pos:    { label: 'Sin POS',     bg: 'bg-violet-100',  text: 'text-violet-700' },
  pending_sync:   { label: 'Pendiente',   bg: 'bg-gray-100',    text: 'text-gray-600' },
}

const ConciliacionVentas = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const hoy = new Date().toISOString().split('T')[0]
  const [fecha, setFecha] = useState(searchParams.get('fecha') || hoy)
  const [fechaHasta, setFechaHasta] = useState(searchParams.get('fecha_hasta') || hoy)
  const [sucursalId, setSucursalId] = useState(searchParams.get('sucursal') || '')
  const [filtroEstado, setFiltroEstado] = useState(searchParams.get('estado') || '')
  const [page, setPage] = useState(parseInt(searchParams.get('page')) || 1)

  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [sucursales, setSucursales] = useState([])
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  // Cargar sucursales
  useEffect(() => {
    Promise.all([
      api.get('/api/sucursales'),
      api.get('/api/cajas'),
    ]).then(([sucRes, cajRes]) => {
      const sucConCaja = new Set((cajRes.data || []).map(c => c.sucursal_id))
      setSucursales((sucRes.data || []).filter(s => sucConCaja.has(s.id)))
    }).catch(() => {})
  }, [])

  // Sync URL params
  useEffect(() => {
    const params = {}
    if (fecha !== hoy) params.fecha = fecha
    if (fechaHasta !== hoy) params.fecha_hasta = fechaHasta
    if (sucursalId) params.sucursal = sucursalId
    if (filtroEstado) params.estado = filtroEstado
    if (page > 1) params.page = page
    setSearchParams(params, { replace: true })
  }, [fecha, fechaHasta, sucursalId, filtroEstado, page])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [fecha, fechaHasta, sucursalId, filtroEstado])

  // Fetch data
  useEffect(() => {
    setCargando(true)
    setError(null)
    const params = new URLSearchParams({ fecha, fecha_hasta: fechaHasta, page, page_size: 50 })
    if (sucursalId) params.append('sucursal_id', sucursalId)
    if (filtroEstado) params.append('estado', filtroEstado)
    api.get(`/api/pos/ventas/conciliacion?${params}`)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setCargando(false))
  }, [fecha, fechaHasta, sucursalId, filtroEstado, page])

  const kpis = data?.kpis
  const rawRows = data?.rows || []
  const totalPages = data?.totalPages || 1
  const totalFiltered = data?.totalFiltered || 0

  const rows = useMemo(() => sortRows(rawRows, sortKey, sortDir), [rawRows, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortKey(null); setSortDir('asc') } // third click resets
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const SortHeader = ({ field, children, className = '' }) => (
    <th className={`px-2 py-2 cursor-pointer select-none hover:bg-gray-100/50 transition-colors ${className}`}
      onClick={() => toggleSort(field)}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {sortKey === field ? (
          <span className="text-blue-500">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>
        ) : (
          <span className="text-gray-300"> ⇅</span>
        )}
      </span>
    </th>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />
      <VentasTabBar />

      <div className="w-full px-6 py-4 space-y-4">
        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">Desde</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">Hasta</span>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          <select value={sucursalId} onChange={e => setSucursalId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            <option value="">Todas las sucursales</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>

        {/* Pills de estado */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: '', label: 'Todos' },
            { key: 'matched', label: 'Coinciden' },
            { key: 'mismatch', label: 'Diferencias' },
            { key: 'missing_centum', label: 'Sin Centum' },
            { key: 'missing_pos', label: 'Sin POS' },
            { key: 'pending_sync', label: 'Pendientes' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setFiltroEstado(key)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroEstado === key
                  ? key === '' ? 'bg-gray-800 text-white'
                    : key === 'matched' ? 'bg-emerald-600 text-white'
                    : key === 'mismatch' ? 'bg-amber-500 text-white'
                    : key === 'missing_centum' ? 'bg-red-600 text-white'
                    : key === 'missing_pos' ? 'bg-violet-600 text-white'
                    : 'bg-gray-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
              {kpis && key && kpis[key] && <span className="ml-1 opacity-70">({kpis[key].count})</span>}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl border p-4 bg-blue-50 text-blue-700 border-blue-200">
              <p className="text-xs font-medium opacity-70 uppercase">POS</p>
              <p className="text-xl font-bold mt-1">{kpis.pos.count}</p>
              <p className="text-xs mt-1 opacity-60">{formatPrecio(kpis.pos.total)}</p>
            </div>
            <div className="rounded-xl border p-4 bg-emerald-50 text-emerald-700 border-emerald-200">
              <p className="text-xs font-medium opacity-70 uppercase">Centum BI</p>
              <p className="text-xl font-bold mt-1">{kpis.centum.count}</p>
              <p className="text-xs mt-1 opacity-60">{formatPrecio(kpis.centum.total)}</p>
            </div>
            <div className="rounded-xl border p-4 bg-teal-50 text-teal-700 border-teal-200">
              <p className="text-xs font-medium opacity-70 uppercase">Coinciden</p>
              <p className="text-xl font-bold mt-1">{kpis.matched.count}</p>
              <p className="text-xs mt-1 opacity-60">{formatPrecio(kpis.matched.total)}</p>
            </div>
            <div className="rounded-xl border p-4 bg-amber-50 text-amber-700 border-amber-200">
              <p className="text-xs font-medium opacity-70 uppercase">Discrepancias</p>
              <p className="text-xl font-bold mt-1">{kpis.mismatch.count}</p>
              <p className="text-xs mt-1 opacity-60">{kpis.mismatch.total_diff > 0 ? `Dif: ${formatPrecio(kpis.mismatch.total_diff)}` : '—'}</p>
            </div>
            <div className="rounded-xl border p-4 bg-red-50 text-red-700 border-red-200">
              <p className="text-xs font-medium opacity-70 uppercase">Faltantes / Pend.</p>
              <p className="text-xl font-bold mt-1">{kpis.missing_centum.count + kpis.missing_pos.count + kpis.pending_sync.count}</p>
              <p className="text-xs mt-1 opacity-60">
                {kpis.missing_centum.count > 0 && `${kpis.missing_centum.count} sin Centum`}
                {kpis.missing_centum.count > 0 && kpis.missing_pos.count > 0 && ' · '}
                {kpis.missing_pos.count > 0 && `${kpis.missing_pos.count} sin POS`}
                {(kpis.missing_centum.count > 0 || kpis.missing_pos.count > 0) && kpis.pending_sync.count > 0 && ' · '}
                {kpis.pending_sync.count > 0 && `${kpis.pending_sync.count} pend.`}
                {kpis.missing_centum.count === 0 && kpis.missing_pos.count === 0 && kpis.pending_sync.count === 0 && '—'}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            Error: {error}
          </div>
        )}

        {/* Tabla */}
        {cargando ? (
          <div className="text-center text-gray-400 py-10">Consultando Centum BI...</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-400 py-10">No hay resultados para los filtros seleccionados</div>
        ) : (
          <div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2.5 mb-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="text-sm font-medium text-gray-600 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
                  &larr; Anterior
                </button>
                <span className="text-sm text-gray-500">Pag. {page} de {totalPages} ({totalFiltered} resultados)</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-600 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
                  Siguiente &rarr;
                </button>
              </div>
            )}
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="px-2 py-2.5 cursor-pointer select-none hover:bg-gray-100/50" rowSpan={2}
                      onClick={() => toggleSort('status')}>
                      <span className="inline-flex items-center gap-0.5">Estado
                        {sortKey === 'status' ? <span className="text-blue-500">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span> : <span className="text-gray-300"> ⇅</span>}
                      </span>
                    </th>
                    <th className="px-2 py-1.5 text-center border-b border-blue-200 bg-blue-50/50 text-blue-600" colSpan={4}>POS</th>
                    <th className="px-2 py-1.5 text-center border-b border-emerald-200 bg-emerald-50/50 text-emerald-600" colSpan={5}>Centum</th>
                    <th className="px-2 py-1.5 text-center" colSpan={1}></th>
                  </tr>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left font-semibold text-gray-500 uppercase tracking-wider">
                    <SortHeader field="fecha_pos" className="bg-blue-50/30">Fecha</SortHeader>
                    <SortHeader field="numero_venta" className="bg-blue-50/30">Venta</SortHeader>
                    <SortHeader field="cliente_pos" className="bg-blue-50/30">Cliente</SortHeader>
                    <SortHeader field="total_pos" className="bg-blue-50/30 text-right">Total</SortHeader>
                    <SortHeader field="fecha_centum" className="bg-emerald-50/30">Fecha</SortHeader>
                    <SortHeader field="comprobante" className="bg-emerald-50/30">Comprobante</SortHeader>
                    <SortHeader field="cliente_centum" className="bg-emerald-50/30">Cliente</SortHeader>
                    <SortHeader field="sucursal_centum" className="bg-emerald-50/30">Sucursal</SortHeader>
                    <SortHeader field="total_centum" className="bg-emerald-50/30 text-right">Total</SortHeader>
                    <SortHeader field="diferencia" className="text-right">Dif.</SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, i) => {
                    const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending_sync
                    const clickable = !!r.pos_id
                    return (
                      <tr key={`${r.pos_id || r.centum_venta_id}-${i}`}
                        onClick={() => clickable && navigate(`/ventas/${r.pos_id}`)}
                        className={`transition-colors ${clickable ? 'hover:bg-blue-50 cursor-pointer' : ''}`}>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text}`}>
                            {cfg.label}
                          </span>
                          {r.tipo === 'nota_credito' && (
                            <span className="ml-1 px-1 py-0.5 rounded bg-red-100 text-red-600 font-medium">NC</span>
                          )}
                        </td>
                        {/* POS columns */}
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap bg-blue-50/10">{r.fecha_pos ? formatFechaHora(r.fecha_pos) : '—'}</td>
                        <td className="px-2 py-2 font-bold text-blue-600 whitespace-nowrap bg-blue-50/10">
                          {r.numero_venta ? `#${r.numero_venta}` : '—'}
                        </td>
                        <td className="px-2 py-2 text-gray-700 max-w-[140px] truncate bg-blue-50/10" title={r.cliente_pos || ''}>{r.cliente_pos || '—'}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap font-medium bg-blue-50/10">{formatPrecio(r.total_pos)}</td>
                        {/* Centum columns */}
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap bg-emerald-50/10">{r.fecha_centum ? formatFechaHora(r.fecha_centum) : '—'}</td>
                        <td className="px-2 py-2 text-gray-700 whitespace-nowrap font-mono bg-emerald-50/10">{r.comprobante || '—'}</td>
                        <td className="px-2 py-2 text-gray-700 max-w-[140px] truncate bg-emerald-50/10" title={r.cliente_centum || ''}>{r.cliente_centum || '—'}</td>
                        <td className="px-2 py-2 text-gray-600 whitespace-nowrap bg-emerald-50/10">
                          {r.sucursal_centum || '—'}
                          {r.division_centum && (
                            <span className={`ml-1 px-1 py-0.5 rounded font-medium ${
                              r.division_centum === 'EMPRESA' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                            }`}>{r.division_centum}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap font-medium bg-emerald-50/10">{formatPrecio(r.total_centum)}</td>
                        {/* Diferencia */}
                        <td className={`px-2 py-2 text-right whitespace-nowrap font-semibold ${
                          r.diferencia > 0 ? 'text-red-600' : r.diferencia < 0 ? 'text-amber-600' : 'text-gray-400'
                        }`}>
                          {r.diferencia != null ? (r.diferencia > 0 ? '+' : '') + formatPrecio(r.diferencia) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2.5 mt-2">
                <button onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 0) }} disabled={page <= 1}
                  className="text-sm font-medium text-gray-600 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
                  &larr; Anterior
                </button>
                <span className="text-sm text-gray-500">Pag. {page} de {totalPages}</span>
                <button onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo(0, 0) }} disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-600 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors">
                  Siguiente &rarr;
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ConciliacionVentas
