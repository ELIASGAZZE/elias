import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts'
import api from '../../services/api'

const COLORES = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#EF4444', '#06B6D4']

const formatPrecio = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0)

const AuditoriaHome = () => {
  const [desde, setDesde] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [hasta, setHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [cajeroFiltro, setCajeroFiltro] = useState('todos')

  useEffect(() => {
    if (!desde || !hasta) return
    setCargando(true)
    const desdeISO = new Date(desde + 'T00:00:00').toISOString()
    const hastaISO = new Date(hasta + 'T23:59:59').toISOString()
    api.get(`/api/auditoria/dashboard?desde=${desdeISO}&hasta=${hastaISO}`)
      .then(r => {
        const d = r.data
        // Parsear items si viene como string JSON
        if (d.ventas) d.ventas = d.ventas.map(v => ({
          ...v,
          items: typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || []),
          pagos: typeof v.pagos === 'string' ? JSON.parse(v.pagos) : (v.pagos || []),
        }))
        if (d.eliminaciones) d.eliminaciones = d.eliminaciones.map(e => ({
          ...e,
          items: typeof e.items === 'string' ? JSON.parse(e.items) : (e.items || []),
        }))
        if (d.cancelaciones) d.cancelaciones = d.cancelaciones.map(c => ({
          ...c,
          items: typeof c.items === 'string' ? JSON.parse(c.items) : (c.items || []),
        }))
        return d
      })
      .then(d => setData(d))
      .catch(err => console.error('Error cargando auditoría:', err))
      .finally(() => setCargando(false))
  }, [desde, hasta])

  // Lista de empleados únicos
  const cajeros = useMemo(() => {
    if (!data) return []
    const map = {}
    data.ventas.forEach(v => {
      const id = v.empleado_id || v.cajero_id
      const nombre = v.empleado_nombre || v.empleado_nombre || v.cajero?.nombre || 'Sin nombre'
      if (!map[id]) map[id] = nombre
    })
    data.cancelaciones.forEach(c => {
      if (!map[c.cajero_id]) map[c.cajero_id] = c.cajero_nombre || 'Sin nombre'
    })
    data.eliminaciones.forEach(e => {
      if (!map[e.usuario_id]) map[e.usuario_id] = e.usuario_nombre || 'Sin nombre'
    })
    return Object.entries(map).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [data])

  // Filtrar datos por cajero
  const filtrado = useMemo(() => {
    if (!data) return null
    if (cajeroFiltro === 'todos') return data
    return {
      ventas: data.ventas.filter(v => (v.empleado_id || v.cajero_id) === cajeroFiltro),
      cancelaciones: data.cancelaciones.filter(c => c.cajero_id === cajeroFiltro),
      eliminaciones: data.eliminaciones.filter(e => e.usuario_id === cajeroFiltro),
      cierres: data.cierres.filter(c => c.empleado?.id === cajeroFiltro || c.cajero_id === cajeroFiltro),
    }
  }, [data, cajeroFiltro])

  // ═══ Métricas calculadas ═══
  const metricas = useMemo(() => {
    if (!filtrado) return null
    const { ventas, cancelaciones, eliminaciones } = filtrado

    // Total items eliminados
    const totalItemsEliminados = eliminaciones.reduce((sum, e) => {
      const items = e.items || []
      return sum + items.length
    }, 0)

    // Total items vendidos
    const totalItemsVendidos = ventas.reduce((sum, v) => {
      const items = v.items || []
      return sum + items.length
    }, 0)

    const totalVentas = ventas.length
    const totalCancelaciones = cancelaciones.length
    const montoTotal = ventas.reduce((s, v) => s + (v.total || 0), 0)
    const ticketPromedio = totalVentas > 0 ? montoTotal / totalVentas : 0
    const tasaCancelacion = (totalVentas + totalCancelaciones) > 0
      ? (totalCancelaciones / (totalVentas + totalCancelaciones) * 100)
      : 0
    const ratioEliminacion = totalItemsVendidos > 0
      ? (totalItemsEliminados / totalItemsVendidos * 100)
      : 0

    return {
      totalVentas, totalCancelaciones, montoTotal, ticketPromedio,
      tasaCancelacion, totalItemsEliminados, totalItemsVendidos, ratioEliminacion,
    }
  }, [filtrado])

  // ═══ Datos para gráficos ═══

  // 1. Ventas por cajero
  const ventasPorCajero = useMemo(() => {
    if (!data || cajeroFiltro !== 'todos') return []
    const map = {}
    data.ventas.forEach(v => {
      const nombre = v.empleado_nombre || v.cajero?.nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, ventas: 0, monto: 0, items: 0, cancelaciones: 0, eliminaciones: 0 }
      map[nombre].ventas++
      map[nombre].monto += v.total || 0
      map[nombre].items += (v.items || []).length
    })
    data.cancelaciones.forEach(c => {
      const nombre = c.cajero_nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, ventas: 0, monto: 0, items: 0, cancelaciones: 0, eliminaciones: 0 }
      map[nombre].cancelaciones++
    })
    data.eliminaciones.forEach(e => {
      const nombre = e.usuario_nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, ventas: 0, monto: 0, items: 0, cancelaciones: 0, eliminaciones: 0 }
      map[nombre].eliminaciones++
    })
    return Object.values(map).sort((a, b) => b.ventas - a.ventas)
  }, [data, cajeroFiltro])

  // 2. Ventas por hora del día
  const ventasPorHora = useMemo(() => {
    if (!filtrado) return []
    const horas = Array.from({ length: 24 }, (_, i) => ({ hora: `${i.toString().padStart(2, '0')}:00`, ventas: 0, monto: 0 }))
    filtrado.ventas.forEach(v => {
      const h = new Date(v.created_at).getHours()
      horas[h].ventas++
      horas[h].monto += v.total || 0
    })
    return horas.filter(h => h.ventas > 0)
  }, [filtrado])

  // 4. Descuentos por cajero
  const descuentosPorCajero = useMemo(() => {
    if (!data || cajeroFiltro !== 'todos') return []
    const map = {}
    data.ventas.forEach(v => {
      const nombre = v.empleado_nombre || v.cajero?.nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, descuentoTotal: 0, ventas: 0 }
      map[nombre].descuentoTotal += v.descuento_total || 0
      map[nombre].ventas++
    })
    return Object.values(map)
      .map(c => ({ ...c, descuentoPromedio: c.ventas > 0 ? c.descuentoTotal / c.ventas : 0 }))
      .filter(c => c.descuentoTotal > 0)
      .sort((a, b) => b.descuentoTotal - a.descuentoTotal)
  }, [data, cajeroFiltro])

  // 6. Diferencias en cierres
  const diferenciasCierres = useMemo(() => {
    if (!filtrado) return []
    return filtrado.cierres
      .filter(c => c.estado !== 'abierta')
      .map(c => {
        const cajero = c.cajero?.nombre || 'Sin nombre'
        const caja = c.caja?.nombre || 'Sin caja'
        const fecha = new Date(c.created_at).toLocaleDateString('es-AR')
        const totalEfectivo = c.total_efectivo || 0
        return { cajero, caja, fecha, totalEfectivo, estado: c.estado }
      })
  }, [filtrado])

  // 7. Ventas por día (tendencia)
  const ventasPorDia = useMemo(() => {
    if (!filtrado) return []
    const map = {}
    filtrado.ventas.forEach(v => {
      const dia = new Date(v.created_at).toLocaleDateString('es-AR')
      if (!map[dia]) map[dia] = { dia, ventas: 0, monto: 0 }
      map[dia].ventas++
      map[dia].monto += v.total || 0
    })
    return Object.values(map)
  }, [filtrado])

  // 8. Eliminaciones por cajero
  const eliminacionesPorCajero = useMemo(() => {
    if (!data || cajeroFiltro !== 'todos') return []
    const map = {}
    data.eliminaciones.forEach(e => {
      const nombre = e.usuario_nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, eliminaciones: 0 }
      map[nombre].eliminaciones++
    })
    return Object.values(map).sort((a, b) => b.eliminaciones - a.eliminaciones)
  }, [data, cajeroFiltro])

  // Tasas por cajero (cancelación y eliminación como %)
  const tasasPorCajero = useMemo(() => {
    if (!data || cajeroFiltro !== 'todos') return []
    const map = {}
    data.ventas.forEach(v => {
      const nombre = v.empleado_nombre || v.cajero?.nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, ventas: 0, cancelaciones: 0, eliminaciones: 0 }
      map[nombre].ventas++
    })
    data.cancelaciones.forEach(c => {
      const nombre = c.cajero_nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, ventas: 0, cancelaciones: 0, eliminaciones: 0 }
      map[nombre].cancelaciones++
    })
    data.eliminaciones.forEach(e => {
      const nombre = e.usuario_nombre || 'Sin nombre'
      if (!map[nombre]) map[nombre] = { nombre, ventas: 0, cancelaciones: 0, eliminaciones: 0 }
      map[nombre].eliminaciones++
    })
    return Object.values(map)
      .filter(c => c.ventas + c.cancelaciones > 0)
      .map(c => ({
        nombre: c.nombre,
        tasaCancelacion: parseFloat(((c.cancelaciones / (c.ventas + c.cancelaciones)) * 100).toFixed(1)),
        tasaEliminacion: parseFloat(((c.eliminaciones / c.ventas) * 100).toFixed(1)),
        ventas: c.ventas,
        cancelaciones: c.cancelaciones,
        eliminaciones: c.eliminaciones,
      }))
      .sort((a, b) => b.tasaCancelacion - a.tasaCancelacion)
  }, [data, cajeroFiltro])

  // Ranking artículos eliminados
  const rankingArticulosEliminados = useMemo(() => {
    if (!filtrado) return []
    const map = {}
    filtrado.eliminaciones.forEach(e => {
      (e.items || []).forEach(i => {
        const nombre = i.nombre || i.descripcion || 'Sin nombre'
        if (!map[nombre]) map[nombre] = { nombre, cantidad: 0 }
        map[nombre].cantidad++
      })
    })
    return Object.values(map).sort((a, b) => b.cantidad - a.cantidad).slice(0, 15)
  }, [filtrado])

  // Ranking artículos de tickets anulados
  const rankingArticulosAnulados = useMemo(() => {
    if (!filtrado) return []
    const map = {}
    filtrado.cancelaciones.forEach(c => {
      (c.items || []).forEach(i => {
        const nombre = i.nombre || i.descripcion || 'Sin nombre'
        if (!map[nombre]) map[nombre] = { nombre, cantidad: 0 }
        map[nombre].cantidad++
      })
    })
    return Object.values(map).sort((a, b) => b.cantidad - a.cantidad).slice(0, 15)
  }, [filtrado])

  // Actividad por hora — anulaciones
  const anulacionesPorHora = useMemo(() => {
    if (!filtrado) return []
    const horas = Array.from({ length: 24 }, (_, i) => ({ hora: `${i.toString().padStart(2, '0')}:00`, cantidad: 0 }))
    filtrado.cancelaciones.forEach(c => {
      const h = new Date(c.created_at).getHours()
      horas[h].cantidad++
    })
    return horas.filter(h => h.cantidad > 0)
  }, [filtrado])

  // Actividad por hora — eliminaciones
  const eliminacionesPorHora = useMemo(() => {
    if (!filtrado) return []
    const horas = Array.from({ length: 24 }, (_, i) => ({ hora: `${i.toString().padStart(2, '0')}:00`, cantidad: 0 }))
    filtrado.eliminaciones.forEach(e => {
      const h = new Date(e.fecha).getHours()
      horas[h].cantidad++
    })
    return horas.filter(h => h.cantidad > 0)
  }, [filtrado])

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Link to="/apps" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h1 className="font-bold text-gray-800 text-lg">Auditoría POS</h1>
            <p className="text-xs text-gray-400">Control y métricas de cajeros</p>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Filtros */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Hasta</label>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Empleado</label>
            <select value={cajeroFiltro} onChange={e => setCajeroFiltro(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[180px]">
              <option value="todos">Todos los empleados</option>
              {cajeros.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
        </div>

        {cargando ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Cargando datos...
          </div>
        ) : metricas && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KPI titulo="Ventas" valor={metricas.totalVentas} color="blue" />
              <KPI titulo="Facturación" valor={formatPrecio(metricas.montoTotal)} color="emerald" />
              <KPI titulo="Ticket Promedio" valor={formatPrecio(metricas.ticketPromedio)} color="violet" />
              <KPI titulo="Tasa Cancelación" valor={`${metricas.tasaCancelacion.toFixed(1)}%`} color={metricas.tasaCancelacion > 10 ? 'red' : 'amber'} />
              <KPI titulo="Cancelaciones" valor={metricas.totalCancelaciones} color="red" />
              <KPI titulo="Items Vendidos" valor={metricas.totalItemsVendidos} color="teal" />
              <KPI titulo="Items Eliminados" valor={metricas.totalItemsEliminados} color="orange" />
              <KPI titulo="Ratio Eliminación" valor={`${metricas.ratioEliminacion.toFixed(1)}%`} color={metricas.ratioEliminacion > 5 ? 'red' : 'emerald'} />
            </div>

            {/* Gráficos fila 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Ventas por cajero */}
              {cajeroFiltro === 'todos' && ventasPorCajero.length > 0 && (
                <Card titulo="Ventas y Cancelaciones por Cajero">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={ventasPorCajero}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="ventas" fill="#3B82F6" name="Ventas" />
                      <Bar dataKey="cancelaciones" fill="#EF4444" name="Cancelaciones" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}


              {/* Eliminaciones por cajero */}
              {cajeroFiltro === 'todos' && eliminacionesPorCajero.length > 0 && (
                <Card titulo="Items Eliminados por Cajero">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={eliminacionesPorCajero}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="eliminaciones" fill="#F97316" name="Items eliminados" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}


              {/* Ventas por hora */}
              {ventasPorHora.length > 0 && (
                <Card titulo="Actividad por Hora del Día">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={ventasPorHora}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="ventas" fill="#8B5CF6" name="Cantidad de ventas" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Anulaciones por hora */}
              {anulacionesPorHora.length > 0 && (
                <Card titulo="Anulaciones por Hora del Día">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={anulacionesPorHora}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="cantidad" fill="#EF4444" name="Anulaciones" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Eliminaciones por hora */}
              {eliminacionesPorHora.length > 0 && (
                <Card titulo="Eliminaciones por Hora del Día">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={eliminacionesPorHora}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="cantidad" fill="#F97316" name="Eliminaciones" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Descuentos por cajero */}
              {cajeroFiltro === 'todos' && descuentosPorCajero.length > 0 && (
                <Card titulo="Descuentos Aplicados por Cajero">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={descuentosPorCajero}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip formatter={(v) => formatPrecio(v)} />
                      <Legend />
                      <Bar dataKey="descuentoTotal" fill="#EC4899" name="Descuento total" />
                      <Bar dataKey="descuentoPromedio" fill="#14B8A6" name="Descuento promedio" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Tendencia diaria */}
              {ventasPorDia.length > 1 && (
                <Card titulo="Tendencia de Ventas por Día">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={ventasPorDia}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="ventas" stroke="#3B82F6" name="Cant. ventas" />
                      <Line yAxisId="right" type="monotone" dataKey="monto" stroke="#10B981" name="Monto" />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Tasas por cajero (%) */}
              {cajeroFiltro === 'todos' && tasasPorCajero.length > 0 && (
                <Card titulo="Tasa de Cancelación y Eliminación por Cajero (%)">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={tasasPorCajero}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                      <YAxis unit="%" />
                      <Tooltip formatter={(v, name, props) => {
                        const d = props.payload
                        if (name === 'Cancelación %') return [`${v}% (${d.cancelaciones} de ${d.ventas + d.cancelaciones})`]
                        return [`${v}% (${d.eliminaciones} de ${d.ventas} tickets)`]
                      }} />
                      <Legend />
                      <Bar dataKey="tasaCancelacion" fill="#EF4444" name="Cancelación %" />
                      <Bar dataKey="tasaEliminacion" fill="#F97316" name="Eliminación %" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}

              {/* Ranking artículos eliminados */}
              {rankingArticulosEliminados.length > 0 && (
                <Card titulo="Top Artículos Eliminados">
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Artículo</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium">Veces eliminado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rankingArticulosEliminados.map((a, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2 text-gray-700">{a.nombre}</td>
                            <td className="px-3 py-2 text-right font-medium text-orange-600">{a.cantidad}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* Ranking artículos de tickets anulados */}
              {rankingArticulosAnulados.length > 0 && (
                <Card titulo="Top Artículos en Tickets Anulados">
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Artículo</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium">Veces anulado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rankingArticulosAnulados.map((a, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2 text-gray-700">{a.nombre}</td>
                            <td className="px-3 py-2 text-right font-medium text-red-600">{a.cantidad}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* Tabla de cierres */}
              {diferenciasCierres.length > 0 && (
                <Card titulo="Cierres de Caja">
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Fecha</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Cajero</th>
                          <th className="text-left px-3 py-2 text-gray-500 font-medium">Caja</th>
                          <th className="text-right px-3 py-2 text-gray-500 font-medium">Efectivo</th>
                          <th className="text-center px-3 py-2 text-gray-500 font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {diferenciasCierres.map((c, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-700">{c.fecha}</td>
                            <td className="px-3 py-2 text-gray-700">{c.cajero}</td>
                            <td className="px-3 py-2 text-gray-700">{c.caja}</td>
                            <td className="px-3 py-2 text-right text-gray-700">{formatPrecio(c.totalEfectivo)}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                c.estado === 'pendiente_gestor' ? 'bg-amber-100 text-amber-700' :
                                c.estado === 'pendiente_agente' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>{c.estado}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>

            {/* Tabla detalle cancelaciones */}
            {filtrado.cancelaciones.length > 0 && (
              <Card titulo={`Detalle de Cancelaciones (${filtrado.cancelaciones.length})`}>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Fecha</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Cajero</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Motivo</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-medium">Items</th>
                        <th className="text-right px-3 py-2 text-gray-500 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filtrado.cancelaciones.map(c => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700">{new Date(c.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="px-3 py-2 text-gray-700">{c.cajero_nombre}</td>
                          <td className="px-3 py-2 text-gray-700 max-w-[300px] truncate">{c.motivo}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{(c.items || []).length}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatPrecio(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Tabla detalle eliminaciones */}
            {filtrado.eliminaciones.length > 0 && (
              <Card titulo={`Detalle de Eliminaciones (${filtrado.eliminaciones.length})`}>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Fecha</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Cajero</th>
                        <th className="text-left px-3 py-2 text-gray-500 font-medium">Artículos eliminados</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filtrado.eliminaciones.map((e, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700">{new Date(e.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="px-3 py-2 text-gray-700">{e.usuario_nombre}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {(e.items || []).map((item, j) => (
                              <span key={j} className="inline-block bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded mr-1 mb-1">
                                {item.nombre} x{item.cantidad || 1}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Componentes auxiliares
const KPI = ({ titulo, valor, color }) => {
  const colores = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    teal: 'bg-teal-50 border-teal-200 text-teal-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colores[color] || colores.blue}`}>
      <p className="text-xs font-medium opacity-70">{titulo}</p>
      <p className="text-2xl font-bold mt-1">{valor}</p>
    </div>
  )
}

const Card = ({ titulo, children }) => (
  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-100">
      <h3 className="font-semibold text-gray-700 text-sm">{titulo}</h3>
    </div>
    <div className="p-4">
      {children}
    </div>
  </div>
)

export default AuditoriaHome
