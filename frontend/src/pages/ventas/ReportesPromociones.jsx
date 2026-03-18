import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts'
import Navbar from '../../components/layout/Navbar'
import VentasTabBar from '../../components/ventas/VentasTabBar'
import api from '../../services/api'

const COLORES = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#EF4444', '#06B6D4']

const formatPrecio = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0)

const formatFechaCorta = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
}

const formatFechaHora = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const KpiCard = ({ titulo, valor, subtitulo, color }) => {
  const colores = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
  }
  return (
    <div className={`rounded-xl border p-4 ${colores[color] || colores.blue}`}>
      <p className="text-xs font-medium opacity-70 uppercase">{titulo}</p>
      <p className="text-xl font-bold mt-1">{valor}</p>
      {subtitulo && <p className="text-xs mt-1 opacity-60">{subtitulo}</p>}
    </div>
  )
}

const ReportesPromociones = () => {
  const [desde, setDesde] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [hasta, setHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [ventas, setVentas] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!desde || !hasta) return
    setCargando(true)
    api.get(`/api/pos/ventas/reportes/promociones?desde=${desde}&hasta=${hasta}`)
      .then(r => setVentas(r.data.ventas || []))
      .catch(err => console.error('Error cargando reporte promociones:', err))
      .finally(() => setCargando(false))
  }, [desde, hasta])

  // Separar ventas con y sin promo
  const { conPromo, sinPromo } = useMemo(() => {
    const con = []
    const sin = []
    ventas.forEach(v => {
      const promos = v.promociones_aplicadas || []
      if (promos.length > 0) con.push(v)
      else sin.push(v)
    })
    return { conPromo: con, sinPromo: sin }
  }, [ventas])

  // KPIs
  const kpis = useMemo(() => {
    const totalVentas = ventas.length
    const cantConPromo = conPromo.length
    const pctConPromo = totalVentas > 0 ? (cantConPromo / totalVentas * 100).toFixed(1) : 0

    const inversionTotal = conPromo.reduce((sum, v) => {
      return sum + (v.promociones_aplicadas || []).reduce((s, p) => s + (parseFloat(p.descuento) || 0), 0)
    }, 0)

    const descPromedio = cantConPromo > 0 ? inversionTotal / cantConPromo : 0

    // Promo más usada
    const promoCount = {}
    conPromo.forEach(v => {
      (v.promociones_aplicadas || []).forEach(p => {
        const nombre = p.promoNombre || 'Sin nombre'
        promoCount[nombre] = (promoCount[nombre] || 0) + 1
      })
    })
    const promoMasUsada = Object.entries(promoCount).sort((a, b) => b[1] - a[1])[0]

    const ticketConPromo = cantConPromo > 0
      ? conPromo.reduce((s, v) => s + (parseFloat(v.total) || 0), 0) / cantConPromo
      : 0
    const ticketSinPromo = sinPromo.length > 0
      ? sinPromo.reduce((s, v) => s + (parseFloat(v.total) || 0), 0) / sinPromo.length
      : 0

    return { cantConPromo, pctConPromo, inversionTotal, descPromedio, promoMasUsada, ticketConPromo, ticketSinPromo, totalVentas }
  }, [ventas, conPromo, sinPromo])

  // Chart 1: Inversión por promoción (top 10)
  const inversionPorPromo = useMemo(() => {
    const map = {}
    conPromo.forEach(v => {
      (v.promociones_aplicadas || []).forEach(p => {
        const nombre = p.promoNombre || 'Sin nombre'
        map[nombre] = (map[nombre] || 0) + (parseFloat(p.descuento) || 0)
      })
    })
    return Object.entries(map)
      .map(([nombre, monto]) => ({ nombre: nombre.length > 25 ? nombre.slice(0, 25) + '...' : nombre, monto }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 10)
  }, [conPromo])

  // Chart 2: Distribución por tipo
  const distribucionTipo = useMemo(() => {
    const map = {}
    conPromo.forEach(v => {
      (v.promociones_aplicadas || []).forEach(p => {
        const tipo = p.tipoPromo || 'otro'
        map[tipo] = (map[tipo] || 0) + 1
      })
    })
    return Object.entries(map).map(([nombre, cantidad]) => ({ nombre, cantidad }))
  }, [conPromo])

  // Chart 3: Top 10 artículos beneficiados
  const topArticulos = useMemo(() => {
    const map = {}
    conPromo.forEach(v => {
      (v.promociones_aplicadas || []).forEach(p => {
        const items = p.itemsAfectados || []
        items.forEach(item => {
          const nombre = typeof item === 'string' ? item : (item.nombre || item.codigo || 'Desconocido')
          map[nombre] = (map[nombre] || 0) + 1
        })
      })
    })
    return Object.entries(map)
      .map(([nombre, veces]) => ({ nombre: nombre.length > 25 ? nombre.slice(0, 25) + '...' : nombre, veces }))
      .sort((a, b) => b.veces - a.veces)
      .slice(0, 10)
  }, [conPromo])

  // Chart 4: Tendencia diaria
  const tendenciaDiaria = useMemo(() => {
    const map = {}
    conPromo.forEach(v => {
      const dia = new Date(v.created_at).toISOString().split('T')[0]
      map[dia] = (map[dia] || 0) + 1
    })
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, cantidad]) => ({ fecha: formatFechaCorta(fecha), cantidad }))
  }, [conPromo])

  // Chart 5: Descuento por cajero
  const descuentoPorCajero = useMemo(() => {
    const map = {}
    conPromo.forEach(v => {
      const cajero = v.cajero_nombre || 'Sin nombre'
      const desc = (v.promociones_aplicadas || []).reduce((s, p) => s + (parseFloat(p.descuento) || 0), 0)
      map[cajero] = (map[cajero] || 0) + desc
    })
    return Object.entries(map)
      .map(([nombre, monto]) => ({ nombre, monto }))
      .sort((a, b) => b.monto - a.monto)
  }, [conPromo])

  // Chart 6: Con vs sin promo (pie)
  const conVsSin = useMemo(() => [
    { nombre: 'Con promo', cantidad: conPromo.length },
    { nombre: 'Sin promo', cantidad: sinPromo.length },
  ], [conPromo, sinPromo])

  // Chart 7: Comparación ticket promedio
  const comparacionTicket = useMemo(() => [
    { nombre: 'Con promo', promedio: kpis.ticketConPromo },
    { nombre: 'Sin promo', promedio: kpis.ticketSinPromo },
  ], [kpis])

  // Tabla 1: Detalle por promoción
  const detallePromos = useMemo(() => {
    const map = {}
    conPromo.forEach(v => {
      (v.promociones_aplicadas || []).forEach(p => {
        const nombre = p.promoNombre || 'Sin nombre'
        if (!map[nombre]) map[nombre] = { nombre, tipo: p.tipoPromo || '-', veces: 0, monto: 0, articulos: {} }
        map[nombre].veces++
        map[nombre].monto += parseFloat(p.descuento) || 0
        const items = p.itemsAfectados || []
        items.forEach(item => {
          const n = typeof item === 'string' ? item : (item.nombre || item.codigo || '?')
          map[nombre].articulos[n] = (map[nombre].articulos[n] || 0) + 1
        })
      })
    })
    return Object.values(map)
      .map(p => ({
        ...p,
        topArticulos: Object.entries(p.articulos).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', ')
      }))
      .sort((a, b) => b.veces - a.veces)
  }, [conPromo])

  // Tabla 2: Últimas ventas con promo
  const ultimasVentas = useMemo(() => {
    return conPromo
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20)
      .map(v => {
        const promos = v.promociones_aplicadas || []
        const descTotal = promos.reduce((s, p) => s + (parseFloat(p.descuento) || 0), 0)
        return {
          id: v.id,
          fecha: formatFechaHora(v.created_at),
          cliente: v.nombre_cliente || 'Consumidor Final',
          promos: promos.map(p => p.promoNombre || '?').join(', '),
          descuento: descTotal,
          total: parseFloat(v.total) || 0,
        }
      })
  }, [conPromo])

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Ventas" volverA="/apps" />
      <VentasTabBar />

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-500">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          <label className="text-sm text-gray-500">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          {cargando && <span className="text-sm text-gray-400">Cargando...</span>}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard titulo="Ventas con promo" valor={kpis.cantConPromo} subtitulo={`${kpis.pctConPromo}% del total`} color="blue" />
          <KpiCard titulo="Inversión en promos" valor={formatPrecio(kpis.inversionTotal)} color="emerald" />
          <KpiCard titulo="Desc. promedio/venta" valor={formatPrecio(kpis.descPromedio)} color="violet" />
          <KpiCard titulo="Promo más usada" valor={kpis.promoMasUsada ? kpis.promoMasUsada[0] : '-'} subtitulo={kpis.promoMasUsada ? `${kpis.promoMasUsada[1]} veces` : ''} color="amber" />
          <KpiCard titulo="Ticket con promo" valor={formatPrecio(kpis.ticketConPromo)} color="teal" />
          <KpiCard titulo="Ticket sin promo" valor={formatPrecio(kpis.ticketSinPromo)} color="orange" />
        </div>

        {ventas.length === 0 && !cargando && (
          <div className="text-center text-gray-400 py-10">No hay ventas en el rango seleccionado</div>
        )}

        {ventas.length > 0 && (
          <>
            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 1. Inversión por promo */}
              {inversionPorPromo.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-3">Inversión por promoción (Top 10)</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={inversionPorPromo} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="nombre" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={v => formatPrecio(v)} />
                      <Bar dataKey="monto" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 2. Distribución por tipo */}
              {distribucionTipo.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-3">Distribución por tipo de promo</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={distribucionTipo} dataKey="cantidad" nameKey="nombre" cx="50%" cy="50%" outerRadius={100} label={({ nombre, percent }) => `${nombre} ${(percent*100).toFixed(0)}%`}>
                        {distribucionTipo.map((_, i) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 3. Top artículos beneficiados */}
              {topArticulos.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-3">Top 10 artículos beneficiados</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topArticulos} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="nombre" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="veces" fill="#10B981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 4. Tendencia diaria */}
              {tendenciaDiaria.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-3">Tendencia diaria de uso</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={tendenciaDiaria}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="cantidad" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 5. Descuento por cajero */}
              {descuentoPorCajero.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-600 mb-3">Descuento otorgado por cajero</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={descuentoPorCajero}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="nombre" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={v => formatPrecio(v)} />
                      <Bar dataKey="monto" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 6. Con vs sin promo */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-600 mb-3">Ventas con promo vs sin promo</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={conVsSin} dataKey="cantidad" nameKey="nombre" cx="50%" cy="50%" outerRadius={100} label={({ nombre, percent }) => `${nombre} ${(percent*100).toFixed(0)}%`}>
                      <Cell fill="#3B82F6" />
                      <Cell fill="#D1D5DB" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* 7. Comparación ticket promedio */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-600 mb-3">Ticket promedio: con vs sin promo</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={comparacionTicket}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="nombre" />
                    <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={v => formatPrecio(v)} />
                    <Bar dataKey="promedio" radius={[4, 4, 0, 0]}>
                      <Cell fill="#14B8A6" />
                      <Cell fill="#F97316" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tabla 1: Detalle por promoción */}
            {detallePromos.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-600">Detalle por promoción</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-4 py-2">Promoción</th>
                        <th className="text-left px-4 py-2">Tipo</th>
                        <th className="text-right px-4 py-2">Veces</th>
                        <th className="text-right px-4 py-2">Monto invertido</th>
                        <th className="text-left px-4 py-2">Top artículos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {detallePromos.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{p.nombre}</td>
                          <td className="px-4 py-2 text-gray-500">{p.tipo}</td>
                          <td className="px-4 py-2 text-right">{p.veces}</td>
                          <td className="px-4 py-2 text-right font-medium">{formatPrecio(p.monto)}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{p.topArticulos || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tabla 2: Últimas ventas con promo */}
            {ultimasVentas.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-600">Últimas ventas con promociones</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-4 py-2">Fecha</th>
                        <th className="text-left px-4 py-2">Cliente</th>
                        <th className="text-left px-4 py-2">Promoción(es)</th>
                        <th className="text-right px-4 py-2">Descuento</th>
                        <th className="text-right px-4 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ultimasVentas.map(v => (
                        <tr key={v.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <Link to={`/ventas/${v.id}`} className="text-blue-600 hover:underline">{v.fecha}</Link>
                          </td>
                          <td className="px-4 py-2 text-gray-700">{v.cliente}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs max-w-xs truncate">{v.promos}</td>
                          <td className="px-4 py-2 text-right text-emerald-600 font-medium">{formatPrecio(v.descuento)}</td>
                          <td className="px-4 py-2 text-right font-medium">{formatPrecio(v.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default ReportesPromociones
