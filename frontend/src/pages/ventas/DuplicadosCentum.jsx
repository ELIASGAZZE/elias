import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const sortRows = (rows, key, dir) => {
  if (!key) return rows
  return [...rows].sort((a, b) => {
    let va, vb
    if (key === 'estado') { va = a.estado === 'pendiente_nc' ? 0 : 1; vb = b.estado === 'pendiente_nc' ? 0 : 1 }
    else if (key === 'total') { va = a.duplicado?.total ?? 0; vb = b.duplicado?.total ?? 0 }
    else if (key === 'numero_venta') { va = a.numero_venta_pos ?? 0; vb = b.numero_venta_pos ?? 0 }
    else if (key === 'cliente') { va = a.cliente || ''; vb = b.cliente || '' }
    else if (key === 'comprobante_real') { va = a.venta_real?.comprobante || ''; vb = b.venta_real?.comprobante || '' }
    else if (key === 'comprobante_dup') { va = a.duplicado?.comprobante || ''; vb = b.duplicado?.comprobante || '' }
    else if (key === 'sucursal') { va = a.duplicado?.sucursal || ''; vb = b.duplicado?.sucursal || '' }
    else if (key === 'division') { va = a.duplicado?.division || ''; vb = b.duplicado?.division || '' }
    else { va = a[key]; vb = b[key] }

    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'string' && typeof vb === 'string') {
      const cmp = va.localeCompare(vb, 'es', { sensitivity: 'base' })
      return dir === 'asc' ? cmp : -cmp
    }
    return dir === 'asc' ? va - vb : vb - va
  })
}

const DuplicadosCentum = () => {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    setCargando(true)
    setError(null)
    api.get('/api/pos/ventas/duplicados-centum')
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || err.message))
      .finally(() => setCargando(false))
  }, [])

  const resumen = data?.resumen
  const rawRows = data?.duplicados || []

  const filteredRows = useMemo(() => {
    if (!filtroEstado) return rawRows
    return rawRows.filter(d => d.estado === filtroEstado)
  }, [rawRows, filtroEstado])

  const rows = useMemo(() => sortRows(filteredRows, sortKey, sortDir), [filteredRows, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortKey(null); setSortDir('asc') }
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
          <span className="text-blue-500">{sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}</span>
        ) : (
          <span className="text-gray-300"> \u21C5</span>
        )}
      </span>
    </th>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />
      <VentasTabBar />

      <div className="w-full px-6 py-4 space-y-4">
        {/* KPI Cards */}
        {resumen && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border p-4 bg-amber-50 text-amber-700 border-amber-200">
              <p className="text-xs font-medium opacity-70 uppercase">Total duplicados</p>
              <p className="text-xl font-bold mt-1">{resumen.total_duplicados}</p>
              <p className="text-xs mt-1 opacity-60">facturas huérfanas detectadas</p>
            </div>
            <div className="rounded-xl border p-4 bg-red-50 text-red-700 border-red-200">
              <p className="text-xs font-medium opacity-70 uppercase">Pendientes NC</p>
              <p className="text-xl font-bold mt-1">{resumen.sin_nc}</p>
              <p className="text-xs mt-1 opacity-60">{formatPrecio(resumen.monto_sin_nc)}</p>
            </div>
            <div className="rounded-xl border p-4 bg-emerald-50 text-emerald-700 border-emerald-200">
              <p className="text-xs font-medium opacity-70 uppercase">Resueltas</p>
              <p className="text-xl font-bold mt-1">{resumen.con_nc}</p>
              <p className="text-xs mt-1 opacity-60">con NC asociada</p>
            </div>
          </div>
        )}

        {/* Filtro por estado */}
        <div className="flex flex-wrap gap-2">
          {[
            { key: '', label: 'Todos' },
            { key: 'pendiente_nc', label: 'Pendientes NC' },
            { key: 'resuelta', label: 'Resueltas' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setFiltroEstado(key)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroEstado === key
                  ? key === '' ? 'bg-gray-800 text-white'
                    : key === 'pendiente_nc' ? 'bg-red-600 text-white'
                    : 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
              {resumen && key === 'pendiente_nc' && <span className="ml-1 opacity-70">({resumen.sin_nc})</span>}
              {resumen && key === 'resuelta' && <span className="ml-1 opacity-70">({resumen.con_nc})</span>}
            </button>
          ))}
        </div>

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
          <div className="text-center text-gray-400 py-10">
            {rawRows.length === 0 ? 'No se detectaron facturas duplicadas' : 'No hay resultados para el filtro seleccionado'}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left font-semibold text-gray-500 uppercase tracking-wider">
                  <SortHeader field="estado">Estado</SortHeader>
                  <SortHeader field="numero_venta">Venta POS</SortHeader>
                  <SortHeader field="comprobante_real">Factura Original</SortHeader>
                  <SortHeader field="comprobante_dup">Factura Duplicada</SortHeader>
                  <SortHeader field="cliente">Cliente</SortHeader>
                  <SortHeader field="sucursal">Sucursal</SortHeader>
                  <SortHeader field="division">División</SortHeader>
                  <SortHeader field="total" className="text-right">Total</SortHeader>
                  <th className="px-2 py-2 text-gray-500">NC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((d, i) => {
                  const clickable = !!d.pos_id
                  return (
                    <tr key={`${d.duplicado?.venta_id}-${i}`}
                      onClick={() => clickable && navigate(`/ventas/${d.pos_id}`)}
                      className={`transition-colors ${clickable ? 'hover:bg-blue-50 cursor-pointer' : ''}`}>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full font-medium ${
                          d.estado === 'pendiente_nc' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {d.estado === 'pendiente_nc' ? 'Pendiente NC' : 'Resuelta'}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-bold text-blue-600 whitespace-nowrap">
                        {d.numero_venta_pos ? `#${d.numero_venta_pos}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap font-mono">
                        {d.venta_real?.comprobante || '—'}
                      </td>
                      <td className="px-2 py-2 text-gray-700 whitespace-nowrap font-mono">
                        {d.duplicado?.comprobante || '—'}
                      </td>
                      <td className="px-2 py-2 text-gray-700 max-w-[160px] truncate" title={d.cliente}>
                        {d.cliente}
                      </td>
                      <td className="px-2 py-2 text-gray-600 whitespace-nowrap">
                        {d.duplicado?.sucursal || '—'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {d.duplicado?.division && (
                          <span className={`px-1.5 py-0.5 rounded font-medium text-xs ${
                            d.duplicado.division === 'EMPRESA' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                          }`}>{d.duplicado.division}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap font-medium">
                        {formatPrecio(d.duplicado?.total)}
                      </td>
                      <td className="px-2 py-2 text-gray-600 whitespace-nowrap font-mono text-xs">
                        {d.nc_existente?.comprobante || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default DuplicadosCentum
