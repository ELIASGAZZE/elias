// Historial de ventas POS
import React, { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import VentasTabBar from '../../components/ventas/VentasTabBar'
import api from '../../services/api'
import { imprimirTicketPOS, imprimirComprobanteA4 } from '../../utils/imprimirComprobante'

const formatFechaHora = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const formatFechaCorta = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const formatFechaDia = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

const formatPrecio = (precio) => {
  if (precio == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const MEDIOS_LABELS = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  qr: 'QR / Transfer.',
  cuenta_corriente: 'Cta. Cte.',
}

const MEDIOS_ICONOS = {
  efectivo: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  debito: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  credito: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  qr: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
    </svg>
  ),
  cuenta_corriente: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
}

// KPI Card
const KpiCard = ({ label, valor, sublabel, color = 'gray' }) => {
  const colores = {
    gray: 'bg-white border-gray-200',
    green: 'bg-emerald-50 border-emerald-200',
    red: 'bg-red-50 border-red-200',
    blue: 'bg-blue-50 border-blue-200',
    amber: 'bg-amber-50 border-amber-200',
  }
  const textColores = {
    gray: 'text-gray-900',
    green: 'text-emerald-700',
    red: 'text-red-700',
    blue: 'text-blue-700',
    amber: 'text-amber-700',
  }
  return (
    <div className={`rounded-xl border px-4 py-3 ${colores[color]}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${textColores[color]}`}>{valor}</p>
      {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
    </div>
  )
}

const VentasHome = () => {
  const { esAdmin } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Leer filtros iniciales desde URL
  const [ventas, setVentas] = useState([])
  const [fecha, setFecha] = useState(searchParams.get('fecha') || new Date().toISOString().split('T')[0])
  const [fechaHasta, setFechaHasta] = useState(searchParams.get('fecha_hasta') || new Date().toISOString().split('T')[0])
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
  const [filtrosExpandidos, setFiltrosExpandidos] = useState(false)

  // Sincronizar filtros a la URL
  useEffect(() => {
    const params = {}
    if (fecha && fecha !== new Date().toISOString().split('T')[0]) params.fecha = fecha
    if (fechaHasta && fechaHasta !== new Date().toISOString().split('T')[0]) params.fecha_hasta = fechaHasta
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
    }).catch(() => {})
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
        }).catch(() => {})
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
      const { data } = await api.get(`/api/pos/ventas?${params}`)
      setVentas(data.ventas || [])
      setTotalPages(data.totalPages || 1)
      setTotalCount(data.totalCount || 0)
      if (data.resumen) setResumen(data.resumen)
    } catch {}
  }

  // Filtrar por clasificación, tipo y sucursal (búsqueda por cliente ahora va al backend)
  const ventasFiltradas = ventas.filter(v => {
    if (filtroClasificacion && v.clasificacion !== filtroClasificacion) return false
    if (filtroTipo === 'nota_credito' && v.tipo !== 'nota_credito') return false
    if (filtroTipo === 'venta' && v.tipo === 'nota_credito') return false
    if (filtroSucursales.length > 0 && !filtroSucursales.includes(v.sucursal_id)) return false
    // filtroEmpleado se aplica en el backend
    if (filtroCentum === 'sin_centum' && (v.centum_sync || v.centum_comprobante)) return false
    if (filtroCentum === 'sin_cae' && v.numero_cae) return false
    return true
  })

  // Resumen del período (viene del backend, incluye TODAS las ventas, no solo la página actual)
  const totalVentas = resumen?.totalVentas ?? 0
  const totalNC = resumen?.totalNC ?? 0
  const totalDia = totalVentas + totalNC
  const totalEmpresa = resumen?.totalEmpresa ?? 0
  const totalPrueba = resumen?.totalPrueba ?? 0
  const cantVentas = resumen?.cantVentas ?? 0
  const cantNC = resumen?.cantNC ?? 0
  const desgloseMedios = resumen?.desgloseMedios ?? {}

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

  // Agrupar ventas por día para separadores visuales
  const ventasAgrupadas = ventasFiltradas.reduce((acc, v) => {
    const dia = new Date(v.created_at).toLocaleDateString('es-AR')
    if (!acc.length || acc[acc.length - 1].dia !== dia) {
      acc.push({ dia, diaLabel: formatFechaDia(v.created_at), ventas: [v] })
    } else {
      acc[acc.length - 1].ventas.push(v)
    }
    return acc
  }, [])
  const mostrarSeparadorDia = fecha !== fechaHasta

  // Contar filtros activos
  const filtrosActivos = [filtroTipo, filtroClasificacion, filtroCentum, filtroEmpleado].filter(Boolean).length + (filtroSucursales.length > 0 ? 1 : 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />
      <VentasTabBar />

      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        {/* Barra de búsqueda y fechas */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="date"
                  value={fecha}
                  onChange={e => setFecha(e.target.value)}
                  className="bg-transparent text-sm focus:outline-none"
                />
                <span className="text-gray-300">—</span>
                <input
                  type="date"
                  value={fechaHasta}
                  onChange={e => setFechaHasta(e.target.value)}
                  className="bg-transparent text-sm focus:outline-none"
                />
              </div>
            </div>
            <div className="relative flex-1">
              <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Buscar por cliente..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
              />
            </div>
            <input
              type="text"
              placeholder="Nº factura (ej. B00007-2942)"
              value={busquedaFactura}
              onChange={e => { setBusquedaFactura(e.target.value); setPage(1) }}
              className="sm:w-56 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
            />
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setFiltrosExpandidos(!filtrosExpandidos)}
                className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  filtrosActivos > 0
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filtros
                {filtrosActivos > 0 && (
                  <span className="bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{filtrosActivos}</span>
                )}
              </button>
              <button
                onClick={() => { cargarVentas({ syncCAE: true }); cargarResumenCentum() }}
                disabled={cargando}
                className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                title="Sincronizar ventas"
              >
                <svg className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline">Sync</span>
              </button>
            </div>
          </div>

          {/* Filtros expandibles */}
          {filtrosExpandidos && (
            <div className="border-t border-gray-100 pt-3 space-y-2.5">
              {/* Fila 1: Tipo + Clasificación */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-16">Tipo</span>
                {['', 'venta', 'nota_credito'].map(tipo => (
                  <button
                    key={`tipo-${tipo}`}
                    onClick={() => setFiltroTipo(tipo)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                      filtroTipo === tipo
                        ? tipo === 'nota_credito' ? 'bg-red-600 text-white shadow-sm'
                          : tipo === 'venta' ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-gray-800 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tipo === 'nota_credito' ? 'Notas de crédito' : tipo === 'venta' ? 'Ventas' : 'Todas'}
                  </button>
                ))}
                <div className="w-px h-5 bg-gray-200 mx-1" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Clasif.</span>
                {['', 'EMPRESA', 'PRUEBA'].map(tipo => (
                  <button
                    key={`clas-${tipo}`}
                    onClick={() => setFiltroClasificacion(tipo)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                      filtroClasificacion === tipo
                        ? tipo === 'EMPRESA' ? 'bg-blue-600 text-white shadow-sm'
                          : tipo === 'PRUEBA' ? 'bg-amber-500 text-white shadow-sm'
                          : 'bg-gray-800 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tipo || 'Todas'}
                  </button>
                ))}
              </div>
              {/* Fila 2: Sucursales */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-16">Sucursal</span>
                <button
                  onClick={() => setFiltroSucursales([])}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                    filtroSucursales.length === 0 ? 'bg-gray-800 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                        activa ? 'bg-purple-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >{s.nombre}</button>
                  )
                })}
              </div>
              {/* Fila 3: Estado Centum + Empleados */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-16">Estado</span>
                <button
                  onClick={() => setFiltroCentum(filtroCentum === 'sin_centum' ? '' : 'sin_centum')}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                    filtroCentum === 'sin_centum'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >Sin Centum</button>
                <button
                  onClick={() => setFiltroCentum(filtroCentum === 'sin_cae' ? '' : 'sin_cae')}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                    filtroCentum === 'sin_cae'
                      ? 'bg-orange-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >Sin CAE</button>
                {esAdmin && <>
                  <div className="w-px h-5 bg-gray-200 mx-1" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Persona</span>
                  {['', 'empleados', 'no_empleados'].map(tipo => (
                    <button
                      key={`emp-${tipo}`}
                      onClick={() => setFiltroEmpleado(tipo)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                        filtroEmpleado === tipo
                          ? tipo === 'empleados' ? 'bg-teal-600 text-white shadow-sm'
                            : tipo === 'no_empleados' ? 'bg-orange-500 text-white shadow-sm'
                            : 'bg-gray-800 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {tipo === 'empleados' ? 'Empleados' : tipo === 'no_empleados' ? 'No empleados' : 'Todas'}
                    </button>
                  ))}
                </>}
              </div>
            </div>
          )}
        </div>

        {/* KPIs del período */}
        {esAdmin && resumen && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <KpiCard
                label="Total neto"
                valor={formatPrecio(totalDia)}
                sublabel={`${cantVentas} venta${cantVentas !== 1 ? 's' : ''}${cantNC > 0 ? ` · ${cantNC} NC` : ''}`}
              />
              <KpiCard label="Ventas" valor={formatPrecio(totalVentas)} color="green" />
              {cantNC > 0 && <KpiCard label="Notas crédito" valor={formatPrecio(totalNC)} color="red" />}
              <KpiCard label="Empresa" valor={formatPrecio(totalEmpresa)} color="blue" />
              <KpiCard label="Prueba" valor={formatPrecio(totalPrueba)} color="amber" />
              {/* Centum BI comparación */}
              {resumenCentum && !cargandoCentum && (() => {
                const totalCentum = resumenCentum.totalVentas + resumenCentum.totalNC
                const diff = totalCentum - totalDia
                const hayDiff = Math.abs(diff) > 100
                return (
                  <div className={`rounded-xl border px-4 py-3 ${hayDiff ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Centum BI</p>
                    <p className={`text-xl font-bold mt-0.5 ${hayDiff ? 'text-red-700' : 'text-emerald-700'}`}>{formatPrecio(totalCentum)}</p>
                    <p className={`text-xs mt-0.5 ${hayDiff ? 'text-red-500 font-semibold' : 'text-emerald-500'}`}>
                      {hayDiff ? `${diff > 0 ? '+' : ''}${formatPrecio(diff)} vs POS` : 'Coincide'}
                    </p>
                  </div>
                )
              })()}
              {cargandoCentum && (
                <div className="rounded-xl border border-gray-200 px-4 py-3 bg-white animate-pulse">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Centum BI</p>
                  <div className="h-7 bg-gray-100 rounded mt-1" />
                </div>
              )}
            </div>
            {/* Desglose por medio de pago */}
            {Object.keys(desgloseMedios).length > 0 && (
              <div className="flex flex-wrap gap-3 px-1">
                {Object.entries(desgloseMedios).map(([medio, monto]) => (
                  <div key={medio} className="flex items-center gap-1.5 text-sm text-gray-500">
                    {MEDIOS_ICONOS[medio] || null}
                    <span className="font-medium text-gray-700">{formatPrecio(monto)}</span>
                    <span className="text-gray-400">{MEDIOS_LABELS[medio] || medio}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Botón reintentar todas en Centum */}
        {esAdmin && ventas.some(v => !v.centum_sync && !v.centum_comprobante && v.centum_error) && (
          <button
            onClick={reenviarTodasCentum}
            disabled={reenvioMasivo}
            className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-medium text-sm py-2.5 rounded-xl transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {reenvioMasivo
              ? 'Enviando a Centum...'
              : `Reintentar Centum (${ventas.filter(v => !v.centum_sync && !v.centum_comprobante && v.centum_error).length} pendientes)`
            }
          </button>
        )}

        {/* Lista de ventas */}
        {cargando ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-16 h-8 bg-gray-100 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-100 rounded w-1/3" />
                    <div className="h-3 bg-gray-50 rounded w-1/4" />
                  </div>
                  <div className="w-20 h-6 bg-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : ventasFiltradas.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-gray-400 font-medium">
              {busqueda ? 'Sin resultados para la búsqueda' : 'No hay ventas para esta fecha'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Paginación superior */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-2 py-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="text-sm font-medium text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  &larr; Anterior
                </button>
                <span className="text-xs text-gray-400">
                  Pág. {page}/{totalPages} &middot; {totalCount} ventas
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  Siguiente &rarr;
                </button>
              </div>
            )}

            {/* Ventas agrupadas por día */}
            {(mostrarSeparadorDia ? ventasAgrupadas : [{ dia: null, ventas: ventasFiltradas }]).map((grupo, gi) => (
              <div key={gi}>
                {mostrarSeparadorDia && grupo.diaLabel && (
                  <div className="flex items-center gap-3 py-2 mt-2 first:mt-0">
                    <div className="h-px flex-1 bg-gray-200" />
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{grupo.diaLabel}</span>
                    <div className="h-px flex-1 bg-gray-200" />
                  </div>
                )}
                <div className="space-y-1.5">
                  {grupo.ventas.map(v => {
                    const pagos = v.pagos || []
                    const mediosUsados = [...new Set(pagos.map(p => p.medio))]
                    const esNC = v.tipo === 'nota_credito'
                    const sinCentum = !v.centum_sync && !v.centum_comprobante
                    const tieneError = sinCentum && v.centum_error
                    const sinCAE = v.clasificacion === 'EMPRESA' && v.centum_sync && !v.numero_cae

                    return (
                      <Link
                        key={v.id}
                        to={`/ventas/${v.id}`}
                        className={`group block bg-white rounded-xl border p-4 transition-all hover:shadow-md ${
                          esNC ? 'border-red-100 hover:border-red-300'
                            : tieneError ? 'border-red-200 bg-red-50/30 hover:border-red-300'
                            : sinCentum ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          {/* Columna izquierda: tipo + número + hora */}
                          <div className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
                            <span className={`text-xs px-2 py-1 rounded-lg font-semibold w-full text-center ${
                              esNC ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {esNC ? 'NC' : 'Venta'}
                            </span>
                            <span className={`text-sm font-bold ${esNC ? 'text-red-600' : 'text-blue-600'}`}>
                              #{v.numero_venta || '—'}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              {mostrarSeparadorDia ? formatFechaCorta(v.created_at) : formatFechaHora(v.created_at)}
                            </span>
                          </div>

                          {/* Columna central: cliente + metadata */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-semibold text-gray-800 truncate">
                                {v.nombre_cliente || 'Consumidor Final'}
                              </p>
                              {esAdmin && (v.empleado_nombre || v.perfiles?.nombre) && (
                                <span className="text-[11px] text-gray-400 flex-shrink-0">
                                  por {v.empleado_nombre || v.perfiles.nombre}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                                v.clasificacion === 'EMPRESA'
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}>
                                {v.clasificacion}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {v.sucursales?.nombre || 'Sin suc.'} &middot; {v.cajas?.nombre || 'Sin caja'}
                              </span>
                              {v.centum_comprobante && (
                                <span className="text-[11px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-mono">
                                  {v.centum_comprobante}
                                </span>
                              )}
                              {v.clasificacion === 'EMPRESA' && v.numero_cae && (
                                <span className="text-[11px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded font-mono" title={`CAE: ${v.numero_cae}`}>
                                  CAE
                                </span>
                              )}
                              {sinCAE && (
                                <span className="text-[11px] bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded" title="Sin autorizar ARCA">
                                  Sin ARCA
                                </span>
                              )}
                              {v.gift_cards_vendidas?.length > 0 && (
                                <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                                  Gift Card
                                </span>
                              )}
                              {v.pedido && (
                                <span className="text-[11px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">
                                  Pedido #{v.pedido.numero || '—'}
                                </span>
                              )}
                            </div>
                            {/* Medios de pago */}
                            {mediosUsados.length > 0 && (
                              <div className="flex items-center gap-2 mt-1.5">
                                {mediosUsados.map(m => (
                                  <span key={m} className="flex items-center gap-1 text-[11px] text-gray-400">
                                    {MEDIOS_ICONOS[m] || null}
                                    {MEDIOS_LABELS[m] || m}
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* Estado sync */}
                            {sinCentum && (
                              <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${tieneError ? 'text-red-500' : 'text-amber-500'}`}>
                                {tieneError ? (
                                  <>
                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                    </svg>
                                    <span className="truncate" title={v.centum_error}>{v.centum_error}</span>
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3.5 h-3.5 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span>Sincronizando...</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Columna derecha: total + acciones */}
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className={`text-lg font-bold tabular-nums ${esNC ? 'text-red-600' : 'text-gray-900'}`}>
                              {formatPrecio(v.total)}
                            </span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Imprimir ticket */}
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
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                title="Imprimir ticket"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                              </button>
                              {/* Imprimir A4 */}
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
                                className="p-2 rounded-lg hover:bg-cyan-50 text-gray-400 hover:text-cyan-600 transition-colors"
                                title="Imprimir A4"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                </svg>
                              </button>
                              {/* Estado email — solo Factura A */}
                              {v.centum_comprobante && /^A\s/.test(v.centum_comprobante) && (
                                <span
                                  className={`p-2 rounded-lg ${v.email_enviado ? 'text-green-500' : 'text-amber-400'}`}
                                  title={v.email_enviado ? `Email enviado a ${v.email_enviado_a || ''}` : 'Email no enviado'}
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    {v.email_enviado ? (
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    ) : (
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    )}
                                  </svg>
                                </span>
                              )}
                              {/* Reintentar Centum */}
                              {esAdmin && sinCentum && (
                                <button
                                  onClick={(e) => reenviarCentum(e, v.id)}
                                  disabled={reenviando === v.id}
                                  className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                                    tieneError
                                      ? 'hover:bg-red-50 text-red-400 hover:text-red-600'
                                      : 'hover:bg-amber-50 text-amber-400 hover:text-amber-600'
                                  }`}
                                  title={v.centum_error || 'Enviar a Centum'}
                                >
                                  <svg className={`w-4 h-4 ${reenviando === v.id ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Paginación inferior */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-2 py-2 mt-2">
                <button
                  onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 0) }}
                  disabled={page <= 1}
                  className="text-sm font-medium text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  &larr; Anterior
                </button>
                <span className="text-xs text-gray-400">
                  Pág. {page}/{totalPages}
                </span>
                <button
                  onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo(0, 0) }}
                  disabled={page >= totalPages}
                  className="text-sm font-medium text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                >
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

export default VentasHome
