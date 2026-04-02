// Historial de ventas POS
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import VentasTabBar from '../../components/ventas/VentasTabBar'
import api from '../../services/api'
import { imprimirTicketPOS, imprimirComprobanteA4 } from '../../utils/imprimirComprobante'
import SectionErrorBoundary from '../../components/SectionErrorBoundary'

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

const MEDIOS_LABELS = {
  efectivo: 'Efectivo',
  debito: 'Tarjeta Dbto',
  credito: 'Tarjeta Crto',
  qr: 'QR / Transferencia',
  cuenta_corriente: 'Cta. Corriente',
}

const VentasHome = () => {
  const { esAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Leer filtros iniciales desde URL
  const [ventas, setVentas] = useState([])
  const hoy = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
  const [fecha, setFecha] = useState(searchParams.get('fecha') || hoy)
  const [fechaHasta, setFechaHasta] = useState(searchParams.get('fecha_hasta') || hoy)
  const [busqueda, setBusqueda] = useState(searchParams.get('busqueda') || '')
  const [busquedaFactura, setBusquedaFactura] = useState(searchParams.get('factura') || '')
  const [filtroClasificacion, setFiltroClasificacion] = useState(searchParams.get('clasificacion') || '')
  const [filtroTipo, setFiltroTipo] = useState(searchParams.get('tipo') || '')
  const [filtroCentum, setFiltroCentum] = useState(searchParams.get('centum') || '')
  const [filtroSucursales, setFiltroSucursales] = useState(() => {
    const s = searchParams.get('sucursales')
    return s ? s.split(',') : []
  })
  const [filtroEmpleado, setFiltroEmpleado] = useState(searchParams.get('empleado') || '')
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [reenviando, setReenviando] = useState(null)
  const [reenvioMasivo, setReenvioMasivo] = useState(false)
  const [page, setPage] = useState(parseInt(searchParams.get('page')) || 1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [resumen, setResumen] = useState(null)
  const [resumenCentum, setResumenCentum] = useState(null)
  const [cargandoCentum, setCargandoCentum] = useState(false)

  // Sincronizar filtros a la URL
  useEffect(() => {
    const params = {}
    if (fecha && fecha !== hoy) params.fecha = fecha
    if (fechaHasta && fechaHasta !== hoy) params.fecha_hasta = fechaHasta
    if (busqueda) params.busqueda = busqueda
    if (busquedaFactura) params.factura = busquedaFactura
    if (filtroClasificacion) params.clasificacion = filtroClasificacion
    if (filtroTipo) params.tipo = filtroTipo
    if (filtroCentum) params.centum = filtroCentum
    if (filtroSucursales.length > 0) params.sucursales = filtroSucursales.join(',')
    if (filtroEmpleado) params.empleado = filtroEmpleado
    if (page > 1) params.page = page
    setSearchParams(params, { replace: true })
  }, [fecha, fechaHasta, busqueda, filtroClasificacion, filtroTipo, filtroCentum, filtroSucursales, filtroEmpleado, page])

  useEffect(() => {
    setPage(1)
  }, [fecha, fechaHasta, filtroEmpleado])

  // Debounce para búsqueda por factura
  const [facturaDebounced, setFacturaDebounced] = useState(busquedaFactura)
  useEffect(() => {
    const t = setTimeout(() => setFacturaDebounced(busquedaFactura), 500)
    return () => clearTimeout(t)
  }, [busquedaFactura])

  // Debounce para búsqueda por cliente
  const [busquedaDebounced, setBusquedaDebounced] = useState(busqueda)
  useEffect(() => {
    const t = setTimeout(() => { setBusquedaDebounced(busqueda); setPage(1) }, 500)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    cargarVentas()
  }, [fecha, fechaHasta, page, filtroCentum, filtroEmpleado, filtroSucursales, filtroClasificacion, facturaDebounced, busquedaDebounced])

  // Auto-refresh cada 15s si hay ventas pendientes de sync
  useEffect(() => {
    const hayPendientes = ventas.some(v => !v.centum_sync && !v.centum_comprobante)
    if (!hayPendientes) return
    const interval = setInterval(() => {
      cargarVentasSilencioso()
      cargarResumenCentum()
    }, 15000)
    return () => clearInterval(interval)
  }, [ventas])

  useEffect(() => {
    // Solo mostrar sucursales que tienen cajas POS configuradas
    Promise.all([
      api.get('/api/sucursales'),
      api.get('/api/cajas'),
    ]).then(([sucRes, cajRes]) => {
      const sucConCaja = new Set((cajRes.data || []).map(c => c.sucursal_id))
      setSucursales((sucRes.data || []).filter(s => sucConCaja.has(s.id)))
    }).catch(err => console.error('Error loading sucursales/cajas:', err.message))
  }, [])

  // Cargar resumen de Centum BI para comparar
  const cargarResumenCentum = () => {
    if (!esAdmin) return
    setCargandoCentum(true)
    const params = new URLSearchParams({ fecha, fecha_hasta: fechaHasta })
    if (filtroSucursales.length > 0) params.append('sucursales', filtroSucursales.join(','))
    if (filtroClasificacion) params.append('clasificacion', filtroClasificacion)
    api.get(`/api/pos/ventas/resumen-centum?${params}`)
      .then(r => setResumenCentum(r.data))
      .catch(() => setResumenCentum(null))
      .finally(() => setCargandoCentum(false))
  }
  useEffect(() => { cargarResumenCentum() }, [fecha, fechaHasta, filtroSucursales, filtroClasificacion, esAdmin])

  const cargarVentas = async ({ syncCAE = false } = {}) => {
    setCargando(true)
    try {
      // Si se pide sync de CAEs, esperar a que termine antes de cargar
      if (syncCAE) {
        await api.post('/api/pos/ventas/sync-caes')
      }
      const params = new URLSearchParams({ page })
      if (facturaDebounced.trim()) {
        params.append('numero_factura', facturaDebounced.trim())
      } else if (busquedaDebounced.trim()) {
        params.append('buscar', busquedaDebounced.trim())
      } else {
        params.append('fecha', fecha)
        if (fechaHasta) params.append('fecha_hasta', fechaHasta)
      }
      if (filtroCentum === 'sin_centum') params.append('sin_centum', '1')
      if (filtroCentum === 'sin_cae') params.append('sin_cae', '1')
      if (filtroEmpleado) params.append('filtro_empleado', filtroEmpleado)
      if (filtroSucursales.length > 0) params.append('sucursales', filtroSucursales.join(','))
      if (filtroClasificacion) params.append('clasificacion', filtroClasificacion)
      const { data } = await api.get(`/api/pos/ventas?${params}`)
      setVentas(data.ventas || [])
      setTotalPages(data.totalPages || 1)
      setTotalCount(data.totalCount || 0)
      if (data.resumen) setResumen(data.resumen)
      // En carga inicial, sync CAEs en background y recargar si encontró alguno
      if (!syncCAE) {
        api.post('/api/pos/ventas/sync-caes').then(r => {
          if (r.data?.conCAE > 0) cargarVentasSilencioso()
        }).catch(err => console.error('Error syncing CAEs:', err.message))
      }
    } catch (err) {
      console.error('Error al cargar ventas:', err)
    } finally {
      setCargando(false)
    }
  }

  const cargarVentasSilencioso = async () => {
    try {
      const params = new URLSearchParams({ fecha, page })
      if (fechaHasta) params.append('fecha_hasta', fechaHasta)
      if (filtroEmpleado) params.append('filtro_empleado', filtroEmpleado)
      if (filtroSucursales.length > 0) params.append('sucursales', filtroSucursales.join(','))
      if (filtroClasificacion) params.append('clasificacion', filtroClasificacion)
      if (filtroCentum === 'sin_centum') params.append('sin_centum', '1')
      if (filtroCentum === 'sin_cae') params.append('sin_cae', '1')
      const { data } = await api.get(`/api/pos/ventas?${params}`)
      setVentas(data.ventas || [])
      setTotalPages(data.totalPages || 1)
      setTotalCount(data.totalCount || 0)
      if (data.resumen) setResumen(data.resumen)
    } catch {}
  }

  // Filtrar por clasificación, tipo y sucursal (búsqueda por cliente ahora va al backend)
  const ventasFiltradas = useMemo(() =>
    ventas.filter(v => {
      if (filtroClasificacion && v.clasificacion !== filtroClasificacion) return false
      if (filtroTipo === 'nota_credito' && v.tipo !== 'nota_credito') return false
      if (filtroTipo === 'venta' && v.tipo === 'nota_credito') return false
      if (filtroSucursales.length > 0 && !filtroSucursales.includes(v.sucursal_id)) return false
      // filtroEmpleado se aplica en el backend
      // sin_centum y sin_cae se filtran en el backend
      return true
    }),
    [ventas, filtroClasificacion, filtroTipo, filtroSucursales]
  )

  // Resumen del período (viene del backend, incluye TODAS las ventas, no solo la página actual)
  const { totalVentas, totalNC, totalDia, totalEmpresa, totalPrueba, cantVentas, cantNC, desgloseMedios } = useMemo(() => {
    const tv = resumen?.totalVentas ?? 0
    const tnc = resumen?.totalNC ?? 0
    return {
      totalVentas: tv,
      totalNC: tnc,
      totalDia: tv + tnc,
      totalEmpresa: resumen?.totalEmpresa ?? 0,
      totalPrueba: resumen?.totalPrueba ?? 0,
      cantVentas: resumen?.cantVentas ?? 0,
      cantNC: resumen?.cantNC ?? 0,
      desgloseMedios: resumen?.desgloseMedios ?? {},
    }
  }, [resumen])

  const reenviarCentum = async (e, ventaId) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('¿Reintentar envío a Centum? Esto genera una factura fiscal.')) return
    setReenviando(ventaId)
    try {
      await api.post(`/api/pos/ventas/${ventaId}/reenviar-centum`)
      await cargarVentas()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setReenviando(null)
    }
  }

  const reenviarTodasCentum = async () => {
    const pendientes = ventas.filter(v => !v.centum_sync && !v.centum_comprobante && v.centum_error)
    if (pendientes.length === 0) return
    if (!confirm(`¿Reintentar ${pendientes.length} venta(s) con error en Centum? Esto genera facturas fiscales.`)) return
    setReenvioMasivo(true)
    let ok = 0, fail = 0
    for (const v of pendientes) {
      try {
        await api.post(`/api/pos/ventas/${v.id}/reenviar-centum`)
        ok++
      } catch {
        fail++
      }
    }
    await cargarVentas()
    setReenvioMasivo(false)
    alert(`Listo: ${ok} enviada(s), ${fail} fallida(s)`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />
      <VentasTabBar />

      <div className="w-full px-6 py-4 space-y-4">
        {/* Filtros */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">Desde</span>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">Hasta</span>
            <input
              type="date"
              value={fechaHasta}
              onChange={e => setFechaHasta(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
            />
          </div>
          <input
            type="text"
            placeholder="Buscar por cliente..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
          />
          <input
            type="text"
            placeholder="Nº factura Centum (ej. B00007-2942)"
            value={busquedaFactura}
            onChange={e => { setBusquedaFactura(e.target.value); setPage(1) }}
            className="w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 focus:border-transparent"
          />
          <button
            onClick={() => { cargarVentas({ syncCAE: true }); cargarResumenCentum() }}
            disabled={cargando}
            className="flex items-center justify-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            title="Sincronizar ventas"
          >
            <svg className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sincronizar
          </button>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2">
          {/* Tipo: Venta / NC */}
          {['', 'venta', 'nota_credito'].map(tipo => (
            <button
              key={`tipo-${tipo}`}
              onClick={() => setFiltroTipo(tipo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroTipo === tipo
                  ? tipo === 'nota_credito' ? 'bg-red-600 text-white'
                    : tipo === 'venta' ? 'bg-emerald-600 text-white'
                    : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tipo === 'nota_credito' ? 'Notas de crédito' : tipo === 'venta' ? 'Ventas' : 'Todas'}
            </button>
          ))}
          <div className="w-px bg-gray-300 mx-1" />
          {/* Clasificación: Empresa / Prueba */}
          {['', 'EMPRESA', 'PRUEBA'].map(tipo => (
            <button
              key={`clas-${tipo}`}
              onClick={() => setFiltroClasificacion(tipo)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                filtroClasificacion === tipo
                  ? tipo === 'EMPRESA' ? 'bg-blue-600 text-white'
                    : tipo === 'PRUEBA' ? 'bg-amber-500 text-white'
                    : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tipo || 'Todas'}
            </button>
          ))}
          <div className="w-px bg-gray-300 mx-1" />
          {/* Sucursales (multi-select) */}
          <button
            onClick={() => setFiltroSucursales([])}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filtroSucursales.length === 0 ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >Todas</button>
          {sucursales.map(s => {
            const activa = filtroSucursales.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() => setFiltroSucursales(prev =>
                  activa ? prev.filter(id => id !== s.id) : [...prev, s.id]
                )}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  activa ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >{s.nombre}</button>
            )
          })}
          {/* Empleados */}
          {esAdmin && <>
            <div className="w-px bg-gray-300 mx-1" />
            {['', 'empleados', 'no_empleados'].map(tipo => (
              <button
                key={`emp-${tipo}`}
                onClick={() => setFiltroEmpleado(tipo)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  filtroEmpleado === tipo
                    ? tipo === 'empleados' ? 'bg-teal-600 text-white'
                      : tipo === 'no_empleados' ? 'bg-orange-500 text-white'
                      : 'bg-gray-800 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tipo === 'empleados' ? 'Empleados' : tipo === 'no_empleados' ? 'No empleados' : 'Todas'}
              </button>
            ))}
          </>}
          <div className="w-px bg-gray-300 mx-1" />
          <button
            onClick={() => setFiltroCentum(filtroCentum === 'sin_centum' ? '' : 'sin_centum')}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filtroCentum === 'sin_centum'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Sin Centum
          </button>
          <button
            onClick={() => setFiltroCentum(filtroCentum === 'sin_cae' ? '' : 'sin_cae')}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filtroCentum === 'sin_cae'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Sin CAE
          </button>
        </div>

        {/* Resumen del período: POS vs Centum BI */}
        <SectionErrorBoundary name="Resumen POS vs Centum">
        {esAdmin && resumen && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Resumen POS */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase">
                  {fecha === fechaHasta ? 'Resumen POS' : 'Resumen POS (período)'}
                </h2>
                <span className="text-xs text-gray-400">{cantVentas} venta{cantVentas !== 1 ? 's' : ''}{cantNC > 0 ? ` · ${cantNC} NC` : ''}</span>
              </div>
              <p className="text-2xl font-bold text-gray-800 mb-2">{formatPrecio(totalDia)}</p>
              <div className="flex flex-wrap gap-2 mb-3">
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
              {Object.keys(desgloseMedios).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(desgloseMedios).map(([medio, monto]) => (
                    <span key={medio} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      {MEDIOS_LABELS[medio] || medio}: {formatPrecio(monto)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Resumen Centum BI */}
            <div className={`bg-white rounded-xl border p-4 ${
              resumenCentum && Math.abs((resumenCentum.totalVentas + resumenCentum.totalNC) - totalDia) > 100
                ? 'border-red-300 bg-red-50'
                : 'border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-500 uppercase">
                  {fecha === fechaHasta ? 'Centum BI' : 'Centum BI (período)'}
                </h2>
                {resumenCentum && (
                  <span className="text-xs text-gray-400">{resumenCentum.cantVentas} venta{resumenCentum.cantVentas !== 1 ? 's' : ''}{resumenCentum.cantNC > 0 ? ` · ${resumenCentum.cantNC} NC` : ''}</span>
                )}
              </div>
              {cargandoCentum ? (
                <p className="text-sm text-gray-400">Consultando Centum BI...</p>
              ) : resumenCentum ? (
                <>
                  {(() => {
                    const totalCentum = resumenCentum.totalVentas + resumenCentum.totalNC
                    const diff = totalCentum - totalDia
                    const hayDiff = Math.abs(diff) > 100
                    return (
                      <>
                        <p className="text-2xl font-bold text-gray-800 mb-1">{formatPrecio(totalCentum)}</p>
                        {hayDiff && (
                          <p className={`text-sm font-semibold mb-2 ${diff > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            {diff > 0 ? '+' : ''}{formatPrecio(diff)} vs POS
                            {resumenCentum.cantVentas !== cantVentas && (
                              <span className="text-xs font-normal ml-1">({resumenCentum.cantVentas - cantVentas > 0 ? '+' : ''}{resumenCentum.cantVentas - cantVentas} ventas)</span>
                            )}
                          </p>
                        )}
                        {!hayDiff && (
                          <p className="text-sm text-emerald-600 font-medium mb-2">Coincide con POS</p>
                        )}
                      </>
                    )
                  })()}
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-medium">
                      Ventas: {formatPrecio(resumenCentum.totalVentas)}
                    </span>
                    {resumenCentum.cantNC > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                        NC: {formatPrecio(resumenCentum.totalNC)}
                      </span>
                    )}
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                      Empresa: {formatPrecio(resumenCentum.totalEmpresa)}
                    </span>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
                      Prueba: {formatPrecio(resumenCentum.totalPrueba)}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-400">No se pudo conectar a Centum BI</p>
              )}
            </div>
          </div>
        )}

        </SectionErrorBoundary>

        {/* Botón reintentar todas en Centum */}
        {esAdmin && ventas.some(v => !v.centum_sync && !v.centum_comprobante && v.centum_error) && (
          <button
            onClick={reenviarTodasCentum}
            disabled={reenvioMasivo}
            className="w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-medium text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            {reenvioMasivo
              ? 'Enviando a Centum...'
              : `Reintentar Centum (${ventas.filter(v => !v.centum_sync && !v.centum_comprobante && v.centum_error).length} pendientes)`
            }
          </button>
        )}

        {/* Lista de ventas */}
        <SectionErrorBoundary name="Listado de ventas">
        {cargando ? (
          <div className="text-center text-gray-400 py-10">Cargando ventas...</div>
        ) : ventasFiltradas.length === 0 ? (
          <div className="text-center text-gray-400 py-10">
            {busqueda ? 'Sin resultados para la búsqueda' : 'No hay ventas para esta fecha'}
          </div>
        ) : (
          <div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2.5 mb-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="text-sm font-medium text-gray-600 hover:text-rose-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  &larr; Anterior
                </button>
                <span className="text-sm text-gray-500">
                  Página {page} de {totalPages} ({totalCount} ventas)
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-600 hover:text-rose-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente &rarr;
                </button>
              </div>
            )}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5">Tipo</th>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">Cliente</th>
                    <th className="px-3 py-2.5">Clasif.</th>
                    <th className="px-3 py-2.5">Sucursal</th>
                    <th className="px-3 py-2.5">Caja</th>
                    {esAdmin && <th className="px-3 py-2.5">Empleado</th>}
                    <th className="px-3 py-2.5">Comprobante</th>
                    <th className="px-3 py-2.5">Medios</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-center">Acc.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ventasFiltradas.map(v => {
                    const pagos = v.pagos || []
                    const mediosUsados = [...new Set(pagos.map(p => MEDIOS_LABELS[p.medio] || p.medio))]

                    return (
                      <tr
                        key={v.id}
                        onClick={() => window.location.href = `/ventas/${v.id}`}
                        className="hover:bg-rose-50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 font-bold text-blue-600 whitespace-nowrap">
                          {v.numero_venta ? `#${v.numero_venta}` : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {v.tipo === 'nota_credito' ? (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-700">NC</span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">Venta</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatFechaHora(v.created_at)}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate" title={v.nombre_cliente || 'Consumidor Final'}>
                          {v.nombre_cliente || 'Consumidor Final'}
                          {v.pedido && (
                            <span className="ml-1 text-xs text-violet-600">P#{v.pedido.numero || '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            v.clasificacion === 'EMPRESA'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {v.clasificacion}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{v.sucursales?.nombre || '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{v.cajas?.nombre || '—'}</td>
                        {esAdmin && (
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">
                            {v.empleado_nombre || v.perfiles?.nombre || '—'}
                          </td>
                        )}
                        <td className="px-3 py-2 whitespace-nowrap">
                          {v.centum_comprobante ? (
                            <span className="text-xs text-green-700">{v.centum_comprobante}</span>
                          ) : v.clasificacion === 'EMPRESA' && v.centum_sync && !v.numero_cae ? (
                            <span className="text-xs text-orange-600" title="Sin CAE">Sin ARCA</span>
                          ) : !v.centum_sync && !v.centum_comprobante ? (
                            esAdmin ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); reenviarCentum(e, v.id) }}
                                disabled={reenviando === v.id}
                                className={`text-xs px-1.5 py-0.5 rounded disabled:opacity-50 transition-colors ${
                                  v.centum_error
                                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                    : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                                }`}
                                title={v.centum_error || 'Aguardando sync'}
                              >
                                {reenviando === v.id ? '...' : v.centum_error ? 'Reintentar' : 'Pendiente'}
                              </button>
                            ) : (
                              <span className="text-xs text-yellow-600">Pendiente</span>
                            )
                          ) : v.numero_cae ? (
                            <span className="text-xs text-teal-700 font-mono" title={`CAE: ${v.numero_cae}`}>CAE</span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {mediosUsados.length > 0 ? (
                            <div className="flex flex-wrap gap-0.5">
                              {mediosUsados.map(m => (
                                <span key={m} className="text-[10px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">{m}</span>
                              ))}
                            </div>
                          ) : '—'}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${v.tipo === 'nota_credito' ? 'text-red-600' : 'text-gray-800'}`}>
                          {formatPrecio(v.total)}
                        </td>
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
                                const pgos = v.pagos || []
                                imprimirTicketPOS({
                                  items: items.map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio_unitario: i.precio_unitario || i.precio })),
                                  cliente: v.nombre_cliente ? { razon_social: v.nombre_cliente, condicion_iva: v.condicion_iva || 'CF' } : null,
                                  pagos: pgos.map(p => ({ tipo: MEDIOS_LABELS[p.medio] || p.medio || p.tipo, monto: parseFloat(p.monto) })),
                                  subtotal: parseFloat(v.subtotal || v.total),
                                  total: parseFloat(v.total),
                                  totalPagado: parseFloat(v.total),
                                  vuelto: parseFloat(v.vuelto || 0),
                                  numeroVenta: v.numero_venta,
                                  puntoVenta: v.punto_venta_centum || null,
                                })
                              }}
                              className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                              title="Imprimir ticket"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                            </button>
                            <button
                              onClick={async (e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                try {
                                  let caeData = null
                                  if (v.id_venta_centum || v.centum_comprobante) {
                                    const { data } = await api.get(`/api/pos/ventas/${v.id}/cae`)
                                    caeData = data
                                  }
                                  await imprimirComprobanteA4(v, caeData)
                                } catch {
                                  await imprimirComprobanteA4(v, null)
                                }
                              }}
                              className="p-1 rounded hover:bg-cyan-50 text-cyan-600 transition-colors"
                              title="Imprimir A4"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                              </svg>
                            </button>
                            {v.centum_comprobante && /^A\s/.test(v.centum_comprobante) && (
                              <span
                                className={`p-1 rounded ${v.email_enviado ? 'text-green-600' : 'text-amber-500'}`}
                                title={v.email_enviado ? `Email enviado a ${v.email_enviado_a || ''}` : 'Email no enviado'}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  {v.email_enviado ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  )}
                                </svg>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-2.5 mt-2">
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 0) }}
                  disabled={page <= 1}
                  className="text-sm font-medium text-gray-600 hover:text-rose-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  &larr; Anterior
                </button>
                <span className="text-sm text-gray-500">
                  Página {page} de {totalPages}
                </span>
                <button
                  onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo(0, 0) }}
                  disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-600 hover:text-rose-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente &rarr;
                </button>
              </div>
            )}
          </div>
        )}
        </SectionErrorBoundary>
      </div>
    </div>
  )
}

export default VentasHome
