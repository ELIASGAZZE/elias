// Auditoría Centum — ventas de BI por Usuario Api (1301)
import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import VentasTabBar from '../../components/ventas/VentasTabBar'
import api from '../../services/api'

const formatFechaHora = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const formatPrecio = (precio) => {
  if (precio == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const TIPO_COMPROBANTE = {
  1: 'Fact A', 3: 'NC A', 4: 'Fact B', 6: 'NC B', 7: 'NC C', 8: 'NC E',
}
const TIPOS_NC = [3, 6, 7, 8]

const VentasAuditoriaCentum = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const hoy = new Date().toLocaleDateString('en-CA')
  const [fecha, setFecha] = useState(searchParams.get('fecha') || hoy)
  const [fechaHasta, setFechaHasta] = useState(searchParams.get('fecha_hasta') || hoy)
  const [busqueda, setBusqueda] = useState(searchParams.get('busqueda') || '')
  const [busquedaFactura, setBusquedaFactura] = useState(searchParams.get('factura') || '')
  const [filtroClasificacion, setFiltroClasificacion] = useState(searchParams.get('clasificacion') || '')
  const [filtroTipo, setFiltroTipo] = useState(searchParams.get('tipo') || '')
  const [filtroSucursales, setFiltroSucursales] = useState(() => {
    const s = searchParams.get('sucursales')
    return s ? s.split(',') : []
  })
  const [sucursales, setSucursales] = useState([])
  const [ventas, setVentas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [page, setPage] = useState(parseInt(searchParams.get('page')) || 1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [resumen, setResumen] = useState(null)

  // Sync filtros a URL
  useEffect(() => {
    const params = {}
    if (fecha && fecha !== hoy) params.fecha = fecha
    if (fechaHasta && fechaHasta !== hoy) params.fecha_hasta = fechaHasta
    if (busqueda) params.busqueda = busqueda
    if (busquedaFactura) params.factura = busquedaFactura
    if (filtroClasificacion) params.clasificacion = filtroClasificacion
    if (filtroTipo) params.tipo = filtroTipo
    if (filtroSucursales.length > 0) params.sucursales = filtroSucursales.join(',')
    if (page > 1) params.page = page
    setSearchParams(params, { replace: true })
  }, [fecha, fechaHasta, busqueda, busquedaFactura, filtroClasificacion, filtroTipo, filtroSucursales, page])

  useEffect(() => { setPage(1) }, [fecha, fechaHasta, filtroTipo, filtroClasificacion])

  // Debounce búsquedas
  const [busquedaDebounced, setBusquedaDebounced] = useState(busqueda)
  const [facturaDebounced, setFacturaDebounced] = useState(busquedaFactura)
  useEffect(() => {
    const t = setTimeout(() => { setBusquedaDebounced(busqueda); setPage(1) }, 500)
    return () => clearTimeout(t)
  }, [busqueda])
  useEffect(() => {
    const t = setTimeout(() => { setFacturaDebounced(busquedaFactura); setPage(1) }, 500)
    return () => clearTimeout(t)
  }, [busquedaFactura])

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

  // Cargar ventas
  useEffect(() => {
    cargarVentas()
  }, [fecha, fechaHasta, page, filtroSucursales, filtroClasificacion, filtroTipo, facturaDebounced, busquedaDebounced])

  const cargarVentas = async () => {
    setCargando(true)
    try {
      const params = new URLSearchParams({ page, fecha, fecha_hasta: fechaHasta })
      if (busquedaDebounced.trim()) params.append('buscar', busquedaDebounced.trim())
      if (facturaDebounced.trim()) params.append('numero_factura', facturaDebounced.trim())
      if (filtroSucursales.length > 0) params.append('sucursales', filtroSucursales.join(','))
      if (filtroClasificacion) params.append('clasificacion', filtroClasificacion)
      if (filtroTipo) params.append('tipo', filtroTipo)
      const { data } = await api.get(`/api/pos/ventas/auditoria-centum?${params}`)
      setVentas(data.ventas || [])
      setTotalPages(data.totalPages || 1)
      setTotalCount(data.totalCount || 0)
      if (data.resumen) setResumen(data.resumen)
    } catch (err) {
      console.error('Error al cargar ventas Centum:', err)
    } finally {
      setCargando(false)
    }
  }

  const { totalVentas, totalNC, totalDia, totalEmpresa, totalPrueba, cantVentas, cantNC } = useMemo(() => {
    const tv = resumen?.totalVentas ?? 0
    const tnc = resumen?.totalNC ?? 0
    return {
      totalVentas: tv, totalNC: tnc, totalDia: tv + tnc,
      totalEmpresa: resumen?.totalEmpresa ?? 0,
      totalPrueba: resumen?.totalPrueba ?? 0,
      cantVentas: resumen?.cantVentas ?? 0,
      cantNC: resumen?.cantNC ?? 0,
    }
  }, [resumen])

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />
      <VentasTabBar />

      <div className="w-full px-6 py-4 space-y-4">
        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">Desde</span>
            <input type="date" value={fecha}
              onChange={e => { const v = e.target.value; setFecha(v); if (v > fechaHasta) setFechaHasta(v) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">Hasta</span>
            <input type="date" value={fechaHasta}
              onChange={e => { const v = e.target.value; setFechaHasta(v); if (v < fecha) setFecha(v) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <input type="text" placeholder="Buscar por cliente..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <input type="text" placeholder="Nro documento (ej. B00007-2942)"
            value={busquedaFactura} onChange={e => { setBusquedaFactura(e.target.value); setPage(1) }}
            className="w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Filtros pills */}
        <div className="flex flex-wrap gap-2">
          {['', 'factura', 'nota_credito'].map(tipo => (
            <button key={`tipo-${tipo}`} onClick={() => setFiltroTipo(tipo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroTipo === tipo
                  ? tipo === 'nota_credito' ? 'bg-red-600 text-white' : tipo === 'factura' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tipo === 'nota_credito' ? 'Notas de crédito' : tipo === 'factura' ? 'Facturas' : 'Todas'}
            </button>
          ))}
          <div className="w-px bg-gray-300 mx-1" />
          {['', 'EMPRESA', 'PRUEBA'].map(tipo => (
            <button key={`clas-${tipo}`} onClick={() => setFiltroClasificacion(tipo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroClasificacion === tipo
                  ? tipo === 'EMPRESA' ? 'bg-blue-600 text-white' : tipo === 'PRUEBA' ? 'bg-amber-500 text-white' : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tipo || 'Todas'}
            </button>
          ))}
          <div className="w-px bg-gray-300 mx-1" />
          <button onClick={() => setFiltroSucursales([])}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filtroSucursales.length === 0 ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >Todas</button>
          {sucursales.map(s => {
            const activa = filtroSucursales.includes(s.id)
            return (
              <button key={s.id}
                onClick={() => setFiltroSucursales(prev => activa ? prev.filter(id => id !== s.id) : [...prev, s.id])}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  activa ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >{s.nombre}</button>
            )
          })}
        </div>

        {/* Resumen Centum BI */}
        {resumen && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase">Resumen Centum BI</h2>
              <span className="text-xs text-gray-400">{cantVentas} factura{cantVentas !== 1 ? 's' : ''}{cantNC > 0 ? ` · ${cantNC} NC` : ''}</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 mb-2">{formatPrecio(totalDia)}</p>
            <div className="flex flex-wrap gap-2">
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">
                Ventas: {formatPrecio(totalVentas)}
              </span>
              {cantNC > 0 && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                  NC: {formatPrecio(totalNC)}
                </span>
              )}
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                Empresa: {formatPrecio(totalEmpresa)}
              </span>
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                Prueba: {formatPrecio(totalPrueba)}
              </span>
            </div>
          </div>
        )}

        {/* Lista */}
        {cargando ? (
          <div className="text-center text-gray-400 py-10">Cargando ventas de Centum BI...</div>
        ) : ventas.length === 0 ? (
          <div className="text-center text-gray-400 py-10">No hay ventas en Centum BI para este período</div>
        ) : (
          <div>
            {/* Paginación */}
            <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2.5 mb-2">
              {totalPages > 1 ? (
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="text-sm font-medium text-gray-600 hover:text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >&larr; Anterior</button>
              ) : <div />}
              <span className="text-sm text-gray-500">
                {totalPages > 1 ? `Página ${page} de ${totalPages} (${totalCount} comprobantes)` : `${totalCount} comprobantes`}
              </span>
              {totalPages > 1 ? (
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-600 hover:text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >Siguiente &rarr;</button>
              ) : <div />}
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2.5">ID</th>
                    <th className="px-3 py-2.5">Tipo</th>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">Cliente</th>
                    <th className="px-3 py-2.5">Clasif.</th>
                    <th className="px-3 py-2.5">Sucursal</th>
                    <th className="px-3 py-2.5">Nro Documento</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ventas.map(v => {
                    const esNC = TIPOS_NC.includes(v.TipoComprobanteID)
                    return (
                      <tr key={v.VentaID}
                        onClick={() => navigate(`/ventas/auditoria/${v.VentaID}`)}
                        className="hover:bg-indigo-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 font-bold text-indigo-600 whitespace-nowrap">{v.VentaID}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            esNC ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {TIPO_COMPROBANTE[v.TipoComprobanteID] || v.TipoComprobanteID}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatFechaHora(v.FechaDocumento)}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={v.RazonSocialCliente || '—'}>
                          {v.RazonSocialCliente || 'Consumidor Final'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            v.DivisionEmpresaGrupoEconomicoID === 3 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {v.DivisionEmpresaGrupoEconomicoID === 3 ? 'EMPRESA' : 'PRUEBA'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{v.NombreSucursalFisica || '—'}</td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap font-mono text-xs">{v.NumeroDocumento || '—'}</td>
                        <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${esNC ? 'text-red-600' : 'text-gray-800'}`}>
                          {esNC ? `-${formatPrecio(Math.abs(v.Total))}` : formatPrecio(v.Total)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default VentasAuditoriaCentum
