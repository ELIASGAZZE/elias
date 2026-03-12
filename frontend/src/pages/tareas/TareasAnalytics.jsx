// Dashboard análisis: cumplimiento, rankings, historial + gráficos Recharts
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

const VERDE = '#16a34a'
const ROJO = '#dc2626'
const NARANJA = '#ea580c'

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const formatFechaCorta = (fecha) => {
  if (!fecha) return ''
  const [, m, d] = fecha.split('-')
  return `${d}/${m}`
}

const BadgePuntualidad = ({ fechaProgramada, fechaEjecucion }) => {
  if (!fechaProgramada || !fechaEjecucion) return null
  const programada = new Date(fechaProgramada)
  const ejecucion = new Date(fechaEjecucion)
  const diffMs = ejecucion - programada
  const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDias <= 0) {
    return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">A tiempo</span>
  }
  return <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Atrasada {diffDias}d</span>
}

const TareasAnalytics = () => {
  const [tab, setTab] = useState('resumen')
  const [resumen, setResumen] = useState(null)
  const [ranking, setRanking] = useState([])
  const [incumplimiento, setIncumplimiento] = useState([])
  const [historial, setHistorial] = useState([])
  const [timeline, setTimeline] = useState([])
  const [cargando, setCargando] = useState(false)

  // Filtros
  const [desde, setDesde] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [hasta, setHasta] = useState(new Date().toISOString().split('T')[0])
  const [sucursales, setSucursales] = useState([])
  const [sucursalId, setSucursalId] = useState('')

  useEffect(() => {
    api.get('/api/sucursales').then(r => setSucursales(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    cargarTab()
  }, [tab, desde, hasta, sucursalId])

  const cargarTab = async () => {
    setCargando(true)
    const params = new URLSearchParams()
    if (desde) params.set('desde', desde)
    if (hasta) params.set('hasta', hasta)
    if (sucursalId) params.set('sucursal_id', sucursalId)

    try {
      switch (tab) {
        case 'resumen': {
          const { data } = await api.get(`/api/tareas/analytics/resumen?${params}`)
          setResumen(data)
          break
        }
        case 'empleados': {
          const { data } = await api.get(`/api/tareas/analytics/por-empleado?${params}`)
          setRanking(data)
          break
        }
        case 'incumplimiento': {
          const { data } = await api.get(`/api/tareas/analytics/incumplimiento?${params}`)
          setIncumplimiento(data)
          break
        }
        case 'historial': {
          const [histRes, tlRes] = await Promise.all([
            api.get(`/api/tareas/analytics/historial?${params}`),
            api.get(`/api/tareas/analytics/timeline?${params}`)
          ])
          setHistorial(histRes.data)
          setTimeline(tlRes.data)
          break
        }
      }
    } catch (err) {
      console.error('Error cargando analytics:', err)
    } finally {
      setCargando(false)
    }
  }

  const TABS = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'empleados', label: 'Empleados' },
    { id: 'incumplimiento', label: 'Incumplimiento' },
    { id: 'historial', label: 'Historial' },
  ]

  // Datos para gráfico torta
  const dataPie = resumen ? [
    { name: 'A tiempo', value: resumen.a_tiempo || 0 },
    { name: 'Atrasadas', value: resumen.atrasadas || 0 },
  ].filter(d => d.value > 0) : []

  // Datos para barras por sucursal
  const dataSucursales = resumen?.por_sucursal?.map(s => ({
    sucursal: s.sucursal,
    ejecutadas: s.ejecutadas,
  })) || []

  // Datos para barras empleados (horizontal)
  const dataEmpleados = ranking.map(emp => ({
    nombre: emp.nombre,
    cantidad: emp.cantidad,
  }))

  // Datos para barras incumplimiento
  const dataIncumplimiento = incumplimiento.map(item => ({
    tarea: `${item.tarea} (${item.sucursal})`,
    ejecuciones: item.total_ejecuciones,
  }))

  const COLORES_PIE = [VERDE, ROJO]

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Tareas - Analisis" sinTabs volverA="/tareas" />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 mb-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
                tab === t.id ? 'bg-orange-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Sucursal</label>
            <select value={sucursalId} onChange={e => setSucursalId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">Todas</option>
              {sucursales.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        </div>

        {cargando ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : (
          <>
            {/* Resumen */}
            {tab === 'resumen' && resumen && (
              <div className="space-y-4">
                {/* KPIs */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-orange-600">{resumen.total_ejecutadas}</p>
                    <p className="text-sm text-gray-500 mt-1">Tareas ejecutadas</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-gray-800">{resumen.total_configs_activas}</p>
                    <p className="text-sm text-gray-500 mt-1">Configs activas</p>
                  </div>
                </div>

                {/* Gráfico torta: A tiempo vs Atrasadas */}
                {dataPie.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Puntualidad</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={dataPie}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={90}
                          paddingAngle={3}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {dataPie.map((_, i) => (
                            <Cell key={i} fill={COLORES_PIE[i]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Gráfico barras por sucursal */}
                {dataSucursales.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Ejecutadas por sucursal</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={dataSucursales}>
                        <XAxis dataKey="sucursal" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Bar dataKey="ejecutadas" fill={NARANJA} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Datos textuales */}
                {resumen.por_sucursal && resumen.por_sucursal.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Detalle por sucursal</h3>
                    <div className="space-y-2">
                      {resumen.por_sucursal.map(s => (
                        <div key={s.sucursal} className="flex items-center justify-between">
                          <span className="text-sm text-gray-700">{s.sucursal}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-gray-800">{s.ejecutadas} ejecutadas</span>
                            <span className="text-xs text-gray-400">{s.configs_activas} configs</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Ranking empleados */}
            {tab === 'empleados' && (
              <div className="space-y-4">
                {/* Gráfico barras horizontal ranking */}
                {dataEmpleados.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Ranking de empleados</h3>
                    <ResponsiveContainer width="100%" height={Math.max(200, dataEmpleados.length * 40)}>
                      <BarChart data={dataEmpleados} layout="vertical" margin={{ left: 20 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="nombre" tick={{ fontSize: 12 }} width={100} />
                        <Tooltip />
                        <Bar dataKey="cantidad" fill={NARANJA} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Lista textual */}
                <div className="bg-white rounded-xl border border-gray-200">
                  {ranking.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Sin datos en el periodo</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {ranking.map((emp, i) => (
                        <div key={i} className="flex items-center justify-between px-5 py-3">
                          <div className="flex items-center gap-3">
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                              i === 0 ? 'bg-yellow-100 text-yellow-700' :
                              i === 1 ? 'bg-gray-100 text-gray-600' :
                              i === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-50 text-gray-500'
                            }`}>
                              {i + 1}
                            </span>
                            <span className="text-sm font-medium text-gray-800">{emp.nombre}</span>
                          </div>
                          <span className="text-sm font-semibold text-orange-600">{emp.cantidad} tareas</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Incumplimiento */}
            {tab === 'incumplimiento' && (
              <div className="space-y-4">
                {/* Gráfico barras por tarea */}
                {dataIncumplimiento.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Ejecuciones por tarea</h3>
                    <ResponsiveContainer width="100%" height={Math.max(200, dataIncumplimiento.length * 40)}>
                      <BarChart data={dataIncumplimiento} layout="vertical" margin={{ left: 20 }}>
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="tarea" tick={{ fontSize: 11 }} width={150} />
                        <Tooltip />
                        <Bar dataKey="ejecuciones" fill={ROJO} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Lista textual */}
                <div className="bg-white rounded-xl border border-gray-200">
                  {incumplimiento.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {incumplimiento.map((item, i) => (
                        <div key={i} className="flex items-center justify-between px-5 py-3">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{item.tarea}</p>
                            <p className="text-xs text-gray-400">{item.sucursal} · cada {item.frecuencia_dias}d</p>
                          </div>
                          <span className={`text-sm font-semibold ${item.total_ejecuciones === 0 ? 'text-red-600' : 'text-gray-600'}`}>
                            {item.total_ejecuciones} ejecuciones
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Historial */}
            {tab === 'historial' && (
              <div className="space-y-4">
                {/* Gráfico línea de tiempo */}
                {timeline.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Linea de tiempo</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={timeline}>
                        <XAxis dataKey="fecha" tickFormatter={formatFechaCorta} tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip labelFormatter={formatFecha} />
                        <Legend />
                        <Line type="monotone" dataKey="a_tiempo" name="A tiempo" stroke={VERDE} strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="atrasadas" name="Atrasadas" stroke={ROJO} strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Cards historial con badge puntualidad */}
                <div className="space-y-2">
                  {historial.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Sin ejecuciones en el periodo</p>
                  ) : historial.map(ej => (
                    <div key={ej.id} className="bg-white rounded-lg border border-gray-200 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-800">
                            {ej.tarea_config?.tarea?.nombre || 'Tarea'}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {ej.tarea_config?.sucursal?.nombre} · {formatFecha(ej.fecha_ejecucion)}
                            {ej.completada_por && ` · por ${ej.completada_por.nombre}`}
                          </p>
                        </div>
                        <BadgePuntualidad fechaProgramada={ej.fecha_programada} fechaEjecucion={ej.fecha_ejecucion} />
                      </div>
                      {ej.ejecuciones_empleados && ej.ejecuciones_empleados.length > 0 && (
                        <p className="text-xs text-gray-500 mt-2">
                          Empleados: {ej.ejecuciones_empleados.map(e => e.empleado?.nombre).filter(Boolean).join(', ')}
                        </p>
                      )}
                      {ej.ejecuciones_subtareas && ej.ejecuciones_subtareas.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ej.ejecuciones_subtareas.map((s, i) => (
                            <span key={i} className={`text-xs px-2 py-0.5 rounded-full ${
                              s.completada ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {s.subtarea?.nombre || 'Subtarea'}
                            </span>
                          ))}
                        </div>
                      )}
                      {ej.observaciones && (
                        <p className="text-xs text-gray-500 mt-2 italic">"{ej.observaciones}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default TareasAnalytics
