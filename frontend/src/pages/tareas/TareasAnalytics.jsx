// Dashboard análisis: cumplimiento, rankings, historial + gráficos Recharts
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import TareasNav from '../../components/tareas/TareasNav'
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
  const [tareaDetalle, setTareaDetalle] = useState(null)
  const [tareaSeleccionada, setTareaSeleccionada] = useState('')
  const [listaTareas, setListaTareas] = useState([])
  const [calidad, setCalidad] = useState(null)
  const [rendimiento, setRendimiento] = useState(null)
  const [empleados, setEmpleados] = useState([])
  const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState('')
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
  const [filtroDetalle, setFiltroDetalle] = useState(null) // 'a_tiempo' | 'atrasadas' | null

  useEffect(() => {
    api.get('/api/sucursales').then(r => setSucursales(r.data)).catch(err => console.error('Error loading sucursales:', err.message))
    api.get('/api/empleados').then(r => setEmpleados(r.data)).catch(err => console.error('Error loading employees:', err.message))
  }, [])

  useEffect(() => {
    cargarTab()
  }, [tab, desde, hasta, sucursalId, tareaSeleccionada, empleadoSeleccionado])

  const cargarTab = async () => {
    setCargando(true)
    setFiltroDetalle(null)
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
          // Si hay empleado seleccionado, cargar su rendimiento también
          if (empleadoSeleccionado) {
            params.set('empleado_id', empleadoSeleccionado)
            const { data: rend } = await api.get(`/api/tareas/analytics/rendimiento-empleado?${params}`)
            setRendimiento(rend)
          } else {
            setRendimiento(null)
          }
          break
        }
        case 'incumplimiento': {
          const { data } = await api.get(`/api/tareas/analytics/incumplimiento?${params}`)
          setIncumplimiento(data)
          break
        }
        case 'calidad': {
          const { data } = await api.get(`/api/tareas/analytics/calidad?${params}`)
          setCalidad(data)
          break
        }
        case 'historial': {
          // Cargar lista de tareas para el selector
          const { data: tareasData } = await api.get('/api/tareas')
          setListaTareas(tareasData.filter(t => t.activo))
          // Si ya hay tarea seleccionada, cargar su detalle
          if (tareaSeleccionada) {
            params.set('tarea_id', tareaSeleccionada)
            const { data: detalle } = await api.get(`/api/tareas/analytics/tarea-detalle?${params}`)
            setTareaDetalle(detalle)
          } else {
            setTareaDetalle(null)
          }
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
    { id: 'calidad', label: 'Calidad' },
    { id: 'historial', label: 'Historial' },
  ]

  // Datos para gráfico torta
  const dataPie = resumen ? [
    { name: 'A tiempo', value: resumen.a_tiempo || 0 },
    { name: 'Atrasadas', value: resumen.atrasadas || 0 },
  ].filter(d => d.value > 0) : []

  // Datos para barras por sucursal (stacked: a tiempo, atrasadas, no ejecutadas)
  const dataSucursales = resumen?.por_sucursal?.map(s => ({
    sucursal: s.sucursal,
    'A tiempo': s.a_tiempo || 0,
    'Atrasadas': s.atrasadas || 0,
    'No ejecutadas': s.no_ejecutadas || 0,
  })) || []

  // Datos para barras empleados (horizontal) con detalle de tareas
  const dataEmpleados = ranking.map(emp => ({
    nombre: emp.nombre,
    cantidad: emp.cantidad,
    score: emp.score || 0,
    calificacion_promedio: emp.calificacion_promedio,
    tareas: emp.tareas || [],
  }))

  // Ya no se usa dataIncumplimiento para barras

  const COLORES_PIE = [VERDE, ROJO]

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Tareas" sinTabs />
      <TareasNav />

      <div className="w-full px-6 py-6">
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
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-orange-600">
                      {resumen.total_ejecutadas}<span className="text-lg text-gray-400">/{resumen.total_esperadas}</span>
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Tareas completadas</p>
                    {resumen.total_esperadas > 0 && (
                      <p className={`text-xs font-medium mt-1 ${
                        resumen.total_ejecutadas >= resumen.total_esperadas ? 'text-green-600' : 'text-red-500'
                      }`}>
                        {Math.round((resumen.total_ejecutadas / resumen.total_esperadas) * 100)}% de cumplimiento
                      </p>
                    )}
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-gray-800">{resumen.total_configs_activas}</p>
                    <p className="text-sm text-gray-500 mt-1">Configs activas</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className={`text-3xl font-bold ${resumen.total_ejecutadas >= resumen.total_esperadas ? 'text-green-600' : 'text-red-500'}`}>
                      {Math.round(resumen.total_esperadas > 0 ? (resumen.total_ejecutadas / resumen.total_esperadas) * 100 : 0)}%
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Cumplimiento</p>
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
                          cursor="pointer"
                          onClick={(_, idx) => {
                            const tipo = idx === 0 ? 'a_tiempo' : 'atrasadas'
                            setFiltroDetalle(prev => prev === tipo ? null : tipo)
                          }}
                        >
                          {dataPie.map((_, i) => (
                            <Cell key={i} fill={COLORES_PIE[i]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend
                          onClick={(e) => {
                            const tipo = e.value === 'A tiempo' ? 'a_tiempo' : 'atrasadas'
                            setFiltroDetalle(prev => prev === tipo ? null : tipo)
                          }}
                          wrapperStyle={{ cursor: 'pointer' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>

                    {/* Detalle agrupado al hacer click */}
                    {filtroDetalle && (() => {
                      const items = filtroDetalle === 'a_tiempo' ? resumen.detalle_a_tiempo : resumen.detalle_atrasadas
                      // Agrupar por tarea+sucursal
                      const agrupado = {}
                      for (const item of (items || [])) {
                        const key = `${item.tarea}__${item.sucursal}`
                        if (!agrupado[key]) {
                          agrupado[key] = { tarea: item.tarea, sucursal: item.sucursal, cantidad: 0 }
                        }
                        agrupado[key].cantidad++
                      }
                      const lista = Object.values(agrupado).sort((a, b) => b.cantidad - a.cantidad)
                      const total = items?.length || 0

                      return (
                        <div className="mt-4 border-t border-gray-100 pt-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className={`text-sm font-semibold ${filtroDetalle === 'a_tiempo' ? 'text-green-700' : 'text-red-700'}`}>
                              {filtroDetalle === 'a_tiempo' ? 'Tareas a tiempo' : 'Tareas atrasadas'} ({total})
                            </h4>
                            <button onClick={() => setFiltroDetalle(null)} className="text-xs text-gray-400 hover:text-gray-600">
                              Cerrar
                            </button>
                          </div>
                          <div className="max-h-64 overflow-y-auto space-y-1.5">
                            {lista.map((item, i) => (
                              <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                                <div>
                                  <p className="text-sm font-medium text-gray-800">{item.tarea}</p>
                                  <p className="text-xs text-gray-400">{item.sucursal}</p>
                                </div>
                                <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${
                                  filtroDetalle === 'a_tiempo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                                }`}>
                                  {item.cantidad}x
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Gráfico barras por sucursal */}
                {dataSucursales.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Desempeño por sucursal</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={dataSucursales}>
                        <XAxis dataKey="sucursal" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="A tiempo" stackId="a" fill={VERDE} />
                        <Bar dataKey="Atrasadas" stackId="a" fill={NARANJA} />
                        <Bar dataKey="No ejecutadas" stackId="a" fill={ROJO} radius={[4, 4, 0, 0]} />
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
                            <span className="text-sm font-medium text-gray-800">{s.ejecutadas}/{s.esperadas}</span>
                            <span className={`text-xs font-medium ${s.ejecutadas >= s.esperadas ? 'text-green-600' : 'text-red-500'}`}>
                              {s.esperadas > 0 ? Math.round((s.ejecutadas / s.esperadas) * 100) : 0}%
                            </span>
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
                {/* Explicación del score */}
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-orange-800 mb-1">Como se calcula el score</p>
                  <p className="text-xs text-orange-700">
                    <span className="font-mono bg-orange-100 px-1.5 py-0.5 rounded">Score = Tareas completadas x (Calificacion promedio / 5)</span>
                  </p>
                  <p className="text-xs text-orange-600 mt-1">
                    Combina cantidad y calidad. Un empleado con muchas tareas pero baja calificacion tendra score similar a uno con pocas tareas bien hechas.
                    {' '}Si no hay calificaciones, se usa factor 0.6 por defecto.
                  </p>
                </div>

                {/* Gráfico barras horizontal ranking por score */}
                {dataEmpleados.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Ranking de empleados</h3>
                    <ResponsiveContainer width="100%" height={Math.max(200, dataEmpleados.length * 40)}>
                      <BarChart data={dataEmpleados} layout="vertical" margin={{ left: 20 }}>
                        <XAxis type="number" tick={{ fontSize: 12 }} />
                        <YAxis type="category" dataKey="nombre" tick={{ fontSize: 12 }} width={100} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null
                          const data = payload[0].payload
                          return (
                            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs">
                              <p className="font-semibold text-gray-800 text-sm">{data.nombre}</p>
                              <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                                <p>Score: <span className="font-bold text-orange-600">{data.score}</span></p>
                                <p>Tareas: {data.cantidad} | Calificacion: {data.calificacion_promedio != null ? `★${data.calificacion_promedio}` : 'Sin datos'}</p>
                                <p className="text-gray-400 font-mono text-[10px]">{data.cantidad} x ({data.calificacion_promedio != null ? data.calificacion_promedio : '3.0'}/5) = {data.score}</p>
                              </div>
                              {data.tareas?.length > 0 && (
                                <div className="border-t border-gray-100 pt-2 mt-2 space-y-1">
                                  {data.tareas.map((t, i) => (
                                    <div key={i} className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-gray-600 truncate">{t.nombre}</span>
                                      <span className="text-xs font-medium text-orange-600 whitespace-nowrap">{t.cantidad}x</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        }} />
                        <Bar dataKey="score" name="Score" fill={NARANJA} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Lista detallada con desglose */}
                <div className="bg-white rounded-xl border border-gray-200">
                  {ranking.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">Sin datos en el periodo</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-[2.5rem_1fr_4.5rem_5rem_4.5rem] gap-2 px-5 py-2 border-b border-gray-200 text-xs font-medium text-gray-500">
                        <span>#</span>
                        <span>Empleado</span>
                        <span className="text-right">Tareas</span>
                        <span className="text-right">Calific.</span>
                        <span className="text-right">Score</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {ranking.map((emp, i) => (
                          <div key={i} className="grid grid-cols-[2.5rem_1fr_4.5rem_5rem_4.5rem] gap-2 items-center px-5 py-3">
                            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                              i === 0 ? 'bg-yellow-100 text-yellow-700' :
                              i === 1 ? 'bg-gray-100 text-gray-600' :
                              i === 2 ? 'bg-orange-100 text-orange-700' :
                              'bg-gray-50 text-gray-500'
                            }`}>
                              {i + 1}
                            </span>
                            <span className="text-sm font-medium text-gray-800">{emp.nombre}</span>
                            <span className="text-sm text-gray-600 text-right">{emp.cantidad}</span>
                            <span className="text-sm text-right">
                              {emp.calificacion_promedio != null ? (
                                <span className="text-yellow-600">★ {emp.calificacion_promedio}</span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </span>
                            <span className="text-sm font-bold text-orange-600 text-right">{emp.score}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Rendimiento individual */}
                <div className="border-t-2 border-orange-200 pt-4 mt-2">
                  <h3 className="font-semibold text-gray-800 mb-3 text-lg">Rendimiento individual</h3>
                  <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
                    <select
                      value={empleadoSeleccionado}
                      onChange={e => setEmpleadoSeleccionado(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                    >
                      <option value="">-- Seleccionar empleado --</option>
                      {empleados.filter(e => e.activo).map(e => (
                        <option key={e.id} value={e.id}>{e.nombre}</option>
                      ))}
                    </select>
                  </div>

                  {!empleadoSeleccionado && (
                    <div className="text-center py-8 text-gray-400">
                      <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                      <p className="text-sm">Selecciona un empleado para ver su rendimiento detallado</p>
                    </div>
                  )}

                  {empleadoSeleccionado && rendimiento && (
                    <div className="space-y-4">
                      {/* KPIs */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                          <p className="text-3xl font-bold text-orange-600">{rendimiento.kpis.total_completadas}</p>
                          <p className="text-sm text-gray-500 mt-1">Tareas completadas</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                          <p className="text-3xl font-bold text-yellow-500">
                            {rendimiento.kpis.calificacion_promedio != null ? `★ ${rendimiento.kpis.calificacion_promedio}` : '-'}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">Calificacion promedio</p>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                          <p className="text-3xl font-bold text-gray-800">{rendimiento.kpis.tareas_por_dia}</p>
                          <p className="text-sm text-gray-500 mt-1">Tareas/dia</p>
                        </div>
                      </div>

                      {/* Comparación vs equipo */}
                      {rendimiento.comparacion_equipo && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-4">Comparacion vs equipo</h3>
                          <div className="grid grid-cols-2 gap-6">
                            {(() => {
                              const c = rendimiento.comparacion_equipo
                              const items = [
                                { label: 'Tareas completadas', emp: c.empleado_completadas, equipo: c.equipo_promedio_completadas, suffix: '' },
                                { label: 'Calificacion', emp: c.empleado_calificacion, equipo: c.equipo_promedio_calificacion, suffix: '', prefix: '★ ' },
                              ]
                              return items.map((item, i) => {
                                const mejor = item.emp != null && item.equipo != null && item.emp >= item.equipo
                                return (
                                  <div key={i} className="text-center">
                                    <p className="text-xs text-gray-500 mb-2">{item.label}</p>
                                    <div className="flex items-center justify-center gap-4">
                                      <div>
                                        <p className={`text-2xl font-bold ${mejor ? 'text-green-600' : 'text-red-500'}`}>
                                          {item.prefix || ''}{item.emp != null ? item.emp : '-'}{item.suffix}
                                        </p>
                                        <p className="text-xs text-gray-400">Empleado</p>
                                      </div>
                                      <span className="text-gray-300 text-lg">vs</span>
                                      <div>
                                        <p className="text-2xl font-bold text-gray-400">
                                          {item.prefix || ''}{item.equipo != null ? item.equipo : '-'}{item.suffix}
                                        </p>
                                        <p className="text-xs text-gray-400">Promedio equipo</p>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Evolución diaria */}
                      {rendimiento.evolucion_diaria.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Evolucion diaria</h3>
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={rendimiento.evolucion_diaria}>
                              <XAxis dataKey="fecha" tickFormatter={formatFechaCorta} tick={{ fontSize: 11 }} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                              <Tooltip labelFormatter={formatFecha} />
                              <Bar dataKey="completadas" name="Completadas" fill={NARANJA} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Por tipo de tarea */}
                      {rendimiento.por_tipo_tarea.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Tareas que realiza</h3>
                          <ResponsiveContainer width="100%" height={Math.max(180, rendimiento.por_tipo_tarea.length * 40)}>
                            <BarChart data={rendimiento.por_tipo_tarea} layout="vertical" margin={{ left: 20 }}>
                              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                              <YAxis type="category" dataKey="tarea" tick={{ fontSize: 12 }} width={120} />
                              <Tooltip content={({ active, payload }) => {
                                if (!active || !payload?.[0]) return null
                                const d = payload[0].payload
                                return (
                                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                                    <p className="font-semibold text-sm">{d.tarea}</p>
                                    <p className="text-xs text-gray-500">{d.cantidad} ejecuciones</p>
                                    <p className="text-xs text-gray-500">Puntualidad: {d.puntualidad_pct}%</p>
                                    {d.calificacion_promedio != null && (
                                      <p className="text-xs text-yellow-600">★ {d.calificacion_promedio}</p>
                                    )}
                                  </div>
                                )
                              }} />
                              <Bar dataKey="cantidad" fill={NARANJA} radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Calidad: distribución de calificaciones */}
                      {rendimiento.calidad.total_calificadas > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Distribucion de calificaciones</h3>
                          <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={rendimiento.calidad.distribucion}>
                              <XAxis dataKey="estrellas" tick={{ fontSize: 12 }} tickFormatter={v => `★${v}`} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                              <Tooltip labelFormatter={v => `${v} estrellas`} />
                              <Bar dataKey="cantidad" fill="#eab308" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Detalle rendimiento por tarea (tabla) */}
                      {rendimiento.por_tipo_tarea.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Rendimiento por tarea</h3>
                          <div className="space-y-2">
                            {rendimiento.por_tipo_tarea.map((t, i) => (
                              <div key={i} className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-medium text-gray-800">{t.tarea}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-semibold text-orange-600">{t.cantidad}x</span>
                                  {t.calificacion_promedio != null && (
                                    <span className="text-sm text-yellow-600 font-medium">★ {t.calificacion_promedio}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Incumplimiento */}
            {tab === 'incumplimiento' && (
              <div>
                {incumplimiento.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Sin datos en el periodo</p>
                ) : (
                  <div className="grid grid-cols-7 gap-3">
                    {incumplimiento.map((item, i) => {
                      const pct = item.cumplimiento
                      const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#ea580c' : '#dc2626'
                      const bgColor = pct >= 80 ? 'border-green-200' : pct >= 50 ? 'border-orange-200' : 'border-red-200'
                      return (
                        <div key={i} className={`bg-white rounded-xl border-2 ${bgColor} p-4 flex flex-col items-center`}>
                          {/* Anillo de progreso */}
                          <div className="relative w-20 h-20 mb-3">
                            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
                              <path
                                d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none" stroke="#e5e7eb" strokeWidth="3.5"
                              />
                              <path
                                d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                                fill="none" stroke={color} strokeWidth="3.5"
                                strokeDasharray={`${pct}, 100`}
                                strokeLinecap="round"
                              />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>
                              {pct}%
                            </span>
                          </div>

                          {/* Info */}
                          <h4 className="font-semibold text-gray-800 text-sm text-center truncate w-full">{item.tarea}</h4>
                          {item.sucursal !== 'Todas' && (
                            <p className="text-xs text-gray-400 mt-0.5">{item.sucursal}</p>
                          )}

                          {/* Stats */}
                          <div className="flex items-center gap-3 mt-3 text-xs">
                            <div className="text-center">
                              <p className="font-bold text-green-600">{item.a_tiempo}</p>
                              <p className="text-gray-400">A tiempo</p>
                            </div>
                            <div className="text-center">
                              <p className="font-bold text-orange-600">{item.atrasadas}</p>
                              <p className="text-gray-400">Tarde</p>
                            </div>
                            <div className="text-center">
                              <p className="font-bold text-red-600">{item.no_ejecutadas}</p>
                              <p className="text-gray-400">Sin hacer</p>
                            </div>
                          </div>

                          {/* Barra de detalle */}
                          {item.ejecutadas > 0 && (
                            <div className="w-full flex rounded-full overflow-hidden h-2 mt-3">
                              {item.a_tiempo > 0 && (
                                <div className="bg-green-500" style={{ width: `${(item.a_tiempo / item.esperadas) * 100}%` }} />
                              )}
                              {item.atrasadas > 0 && (
                                <div className="bg-orange-500" style={{ width: `${(item.atrasadas / item.esperadas) * 100}%` }} />
                              )}
                              {item.no_ejecutadas > 0 && (
                                <div className="bg-red-200" style={{ width: `${(item.no_ejecutadas / item.esperadas) * 100}%` }} />
                              )}
                            </div>
                          )}

                          {/* Calificación y frecuencia */}
                          <div className="flex items-center justify-between w-full mt-3">
                            <span className="text-xs text-gray-400">Cada {item.frecuencia_dias}d</span>
                            {item.promedio_calificacion && (
                              <span className="text-xs text-yellow-600 font-medium">★ {item.promedio_calificacion}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{item.ejecutadas}/{item.esperadas} ejecutadas</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Calidad */}
            {tab === 'calidad' && calidad && (
              <div className="space-y-4">
                {/* KPIs */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-yellow-500">
                      {calidad.promedio_general ? `★ ${calidad.promedio_general}` : '-'}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">Promedio general</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-gray-800">{calidad.total_calificadas}</p>
                    <p className="text-sm text-gray-500 mt-1">Tareas calificadas</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    <p className="text-3xl font-bold text-gray-400">{calidad.total_sin_calificar}</p>
                    <p className="text-sm text-gray-500 mt-1">Sin calificar</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                    {calidad.tendencia ? (
                      <>
                        <div className="flex items-center justify-center gap-2">
                          <span className={`text-3xl font-bold ${
                            calidad.tendencia.direccion === 'mejorando' ? 'text-green-600' :
                            calidad.tendencia.direccion === 'empeorando' ? 'text-red-600' :
                            'text-gray-600'
                          }`}>
                            {calidad.tendencia.direccion === 'mejorando' ? '↑' :
                             calidad.tendencia.direccion === 'empeorando' ? '↓' : '→'}
                          </span>
                          <span className={`text-lg font-bold ${
                            calidad.tendencia.direccion === 'mejorando' ? 'text-green-600' :
                            calidad.tendencia.direccion === 'empeorando' ? 'text-red-600' :
                            'text-gray-600'
                          }`}>
                            {calidad.tendencia.diferencia > 0 ? '+' : ''}{calidad.tendencia.diferencia}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          Tendencia: {calidad.tendencia.direccion === 'mejorando' ? 'Mejorando' :
                            calidad.tendencia.direccion === 'empeorando' ? 'Empeorando' : 'Estable'}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{calidad.tendencia.primera_mitad} → {calidad.tendencia.segunda_mitad}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-3xl font-bold text-gray-300">-</p>
                        <p className="text-sm text-gray-500 mt-1">Tendencia</p>
                        <p className="text-xs text-gray-400 mt-0.5">Datos insuficientes</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Distribucion + Evolución lado a lado */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Distribución de estrellas */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-3">Distribucion de calificaciones</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={calidad.distribucion}>
                        <XAxis dataKey="estrellas" tickFormatter={v => `${v}★`} tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(v) => [v, 'Tareas']} labelFormatter={l => `${l} estrella${l > 1 ? 's' : ''}`} />
                        <Bar dataKey="cantidad" fill="#eab308" radius={[4, 4, 0, 0]}>
                          {calidad.distribucion.map((entry, i) => (
                            <Cell key={i} fill={entry.estrellas <= 2 ? '#ef4444' : entry.estrellas === 3 ? '#f97316' : '#eab308'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Evolución semanal */}
                  {calidad.evolucion.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-800 mb-3">Evolucion semanal del promedio</h3>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={calidad.evolucion}>
                          <XAxis dataKey="fecha" tickFormatter={formatFechaCorta} tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                          <Tooltip
                            labelFormatter={formatFecha}
                            formatter={(v, name) => [name === 'promedio' ? `★ ${v}` : v, name === 'promedio' ? 'Promedio' : 'Cantidad']}
                          />
                          <Line type="monotone" dataKey="promedio" name="promedio" stroke="#eab308" strokeWidth={2.5} dot={{ r: 4, fill: '#eab308' }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Peores tareas + Peores empleados lado a lado */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Tareas peor calificadas */}
                  {calidad.peores_tareas.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-800 mb-3">Calificacion por tarea</h3>
                      <div className="space-y-2">
                        {calidad.peores_tareas.map((t, i) => {
                          const pctBuena = ((t.promedio / 5) * 100)
                          const colorBarra = t.promedio <= 2 ? 'bg-red-500' : t.promedio <= 3 ? 'bg-orange-500' : t.promedio <= 4 ? 'bg-yellow-500' : 'bg-green-500'
                          return (
                            <div key={i}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium text-gray-700 truncate">{t.tarea}</span>
                                <div className="flex items-center gap-2">
                                  {t.bajas > 0 && (
                                    <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{t.bajas} baja{t.bajas > 1 ? 's' : ''}</span>
                                  )}
                                  <span className="text-sm font-bold text-yellow-600">★ {t.promedio}</span>
                                </div>
                              </div>
                              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${colorBarra}`} style={{ width: `${pctBuena}%` }} />
                              </div>
                              <div className="flex items-center justify-between mt-0.5">
                                <span className="text-xs text-gray-400">{t.total} ejecucion{t.total > 1 ? 'es' : ''}</span>
                                {t.con_observaciones > 0 && (
                                  <span className="text-xs text-gray-400">{t.con_observaciones} con obs.</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Empleados por calidad */}
                  {calidad.peores_empleados.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-800 mb-3">Calificacion por empleado</h3>
                      <div className="space-y-2">
                        {calidad.peores_empleados.map((emp, i) => {
                          const pctBuena = ((emp.promedio / 5) * 100)
                          const colorBarra = emp.promedio <= 2 ? 'bg-red-500' : emp.promedio <= 3 ? 'bg-orange-500' : emp.promedio <= 4 ? 'bg-yellow-500' : 'bg-green-500'
                          return (
                            <div key={i} className="flex items-center gap-3">
                              <span className="text-sm font-medium text-gray-700 w-28 truncate">{emp.nombre}</span>
                              <div className="flex-1">
                                <div className="h-4 bg-gray-100 rounded-full overflow-hidden relative">
                                  <div className={`h-full rounded-full ${colorBarra}`} style={{ width: `${pctBuena}%` }} />
                                  <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                                    ★ {emp.promedio} ({emp.total})
                                  </span>
                                </div>
                              </div>
                              {emp.pct_bajas > 0 && (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                                  emp.pct_bajas >= 50 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                                }`}>
                                  {emp.pct_bajas}% bajas
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Observaciones críticas */}
                {calidad.observaciones_criticas.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-1">Observaciones en tareas mal calificadas</h3>
                    <p className="text-xs text-gray-400 mb-3">Ejecuciones con 1 o 2 estrellas que tienen observaciones</p>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {calidad.observaciones_criticas.map((obs, i) => (
                        <div key={i} className="border border-red-100 rounded-lg p-3 bg-red-50/30">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-red-600">★ {obs.calificacion}</span>
                              <span className="text-sm font-medium text-gray-800">{obs.tarea}</span>
                              {obs.sucursal && <span className="text-xs text-gray-400">· {obs.sucursal}</span>}
                            </div>
                            <span className="text-xs text-gray-400">{formatFecha(obs.fecha)}</span>
                          </div>
                          <p className="text-sm text-gray-700 bg-white rounded px-3 py-2 border border-gray-100">{obs.observaciones}</p>
                          <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                            {obs.completada_por && <span>Registrada por: {obs.completada_por}</span>}
                            {obs.empleados.length > 0 && <span>· Empleados: {obs.empleados.join(', ')}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Alertas */}
                {calidad.peores_tareas.some(t => t.promedio <= 2) && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-red-700">Tareas con calidad critica</p>
                      <p className="text-xs text-red-600 mt-0.5">
                        {calidad.peores_tareas.filter(t => t.promedio <= 2).map(t => t.tarea).join(', ')} — promedio de 2 estrellas o menos. Requieren atencion.
                      </p>
                    </div>
                  </div>
                )}
                {calidad.peores_empleados.some(e => e.pct_bajas >= 50) && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div>
                      <p className="text-sm font-semibold text-orange-700">Empleados con alto porcentaje de tareas mal calificadas</p>
                      <p className="text-xs text-orange-600 mt-0.5">
                        {calidad.peores_empleados.filter(e => e.pct_bajas >= 50).map(e => `${e.nombre} (${e.pct_bajas}%)`).join(', ')} — mas del 50% de sus tareas tienen calificacion baja.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Historial por tarea */}
            {tab === 'historial' && (
              <div className="space-y-4">
                {/* Selector de tarea */}
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Seleccionar tarea para analizar</label>
                  <select
                    value={tareaSeleccionada}
                    onChange={e => setTareaSeleccionada(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="">-- Seleccionar tarea --</option>
                    {listaTareas.map(t => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>

                {!tareaSeleccionada && (
                  <div className="text-center py-12 text-gray-400">
                    <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
                    </svg>
                    <p>Selecciona una tarea para ver su analisis detallado</p>
                  </div>
                )}

                {tareaSeleccionada && tareaDetalle && (
                  <>
                    {/* KPIs resumen */}
                    <div className="grid grid-cols-5 gap-3">
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <p className="text-2xl font-bold text-gray-800">{tareaDetalle.resumen.total_ejecuciones}</p>
                        <p className="text-xs text-gray-500 mt-1">Ejecuciones</p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <p className="text-2xl font-bold text-green-600">{tareaDetalle.resumen.a_tiempo}</p>
                        <p className="text-xs text-gray-500 mt-1">A tiempo</p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <p className="text-2xl font-bold text-red-600">{tareaDetalle.resumen.atrasadas}</p>
                        <p className="text-xs text-gray-500 mt-1">Atrasadas</p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <p className="text-2xl font-bold text-yellow-500">
                          {tareaDetalle.resumen.promedio_calificacion ? `★ ${tareaDetalle.resumen.promedio_calificacion}` : '-'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Calificacion promedio</p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                        <p className="text-2xl font-bold text-gray-600">
                          {tareaDetalle.resumen.peor_calificacion && tareaDetalle.resumen.mejor_calificacion
                            ? `${tareaDetalle.resumen.peor_calificacion} - ${tareaDetalle.resumen.mejor_calificacion}`
                            : '-'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Rango calificacion</p>
                      </div>
                    </div>

                    {/* Gráficos lado a lado */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Evolución calificación */}
                      {tareaDetalle.evolucion_calificacion.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Evolucion de calificacion</h3>
                          <ResponsiveContainer width="100%" height={220}>
                            <LineChart data={tareaDetalle.evolucion_calificacion}>
                              <XAxis dataKey="fecha" tickFormatter={formatFechaCorta} tick={{ fontSize: 11 }} />
                              <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 12 }} />
                              <Tooltip labelFormatter={formatFecha} />
                              <Line type="monotone" dataKey="calificacion" name="Calificacion" stroke="#eab308" strokeWidth={2.5} dot={{ r: 4, fill: '#eab308' }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Evolución puntualidad */}
                      {tareaDetalle.evolucion_puntualidad.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Puntualidad en el tiempo</h3>
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={tareaDetalle.evolucion_puntualidad}>
                              <XAxis dataKey="fecha" tickFormatter={formatFechaCorta} tick={{ fontSize: 11 }} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                              <Tooltip labelFormatter={formatFecha} />
                              <Legend />
                              <Bar dataKey="a_tiempo" name="A tiempo" stackId="a" fill={VERDE} />
                              <Bar dataKey="atrasadas" name="Atrasadas" stackId="a" fill={ROJO} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Concentración de empleados */}
                      {tareaDetalle.empleados.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Quien realiza esta tarea</h3>
                          <div className="space-y-2">
                            {tareaDetalle.empleados.map((emp, i) => {
                              const concentrado = emp.porcentaje >= 50
                              return (
                                <div key={i} className="flex items-center gap-3">
                                  <span className="text-sm font-medium text-gray-700 w-32 truncate">{emp.nombre}</span>
                                  <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                                    <div
                                      className={`h-full rounded-full transition-all ${concentrado ? 'bg-red-400' : 'bg-orange-400'}`}
                                      style={{ width: `${emp.porcentaje}%` }}
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                                      {emp.cantidad}x ({emp.porcentaje}%)
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          {tareaDetalle.empleados.some(e => e.porcentaje >= 50) && (
                            <p className="text-xs text-red-500 mt-3 flex items-center gap-1">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                              </svg>
                              Alta concentracion: un empleado realiza mas del 50% de las ejecuciones
                            </p>
                          )}
                        </div>
                      )}

                      {/* Cumplimiento de subtareas */}
                      {tareaDetalle.subtareas_cumplimiento.length > 0 && (
                        <div className="bg-white rounded-xl border border-gray-200 p-5">
                          <h3 className="font-semibold text-gray-800 mb-3">Cumplimiento por subtarea</h3>
                          <div className="space-y-2">
                            {tareaDetalle.subtareas_cumplimiento.map((sub, i) => {
                              const color = sub.porcentaje >= 80 ? 'bg-green-500' : sub.porcentaje >= 50 ? 'bg-orange-500' : 'bg-red-500'
                              return (
                                <div key={i}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-gray-600 truncate">{sub.nombre}</span>
                                    <span className="text-xs font-medium text-gray-500">{sub.completadas}/{sub.total} ({sub.porcentaje}%)</span>
                                  </div>
                                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${color}`} style={{ width: `${sub.porcentaje}%` }} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Historial de ejecuciones */}
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-800 mb-3">Ultimas ejecuciones</h3>
                      <div className="space-y-1.5 max-h-72 overflow-y-auto">
                        {tareaDetalle.ejecuciones.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">Sin ejecuciones en el periodo</p>
                        ) : [...tareaDetalle.ejecuciones].reverse().map((ej, i) => (
                          <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-3">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ej.puntualidad === 'a_tiempo' ? 'bg-green-500' : 'bg-red-500'}`} />
                              <div>
                                <p className="text-sm text-gray-700">{formatFecha(ej.fecha)}</p>
                                <p className="text-xs text-gray-400">
                                  {ej.completada_por || ''}
                                  {ej.dias_atraso > 0 && ` · +${ej.dias_atraso}d atraso`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {ej.calificacion && (
                                <span className="text-sm text-yellow-500 font-medium">★ {ej.calificacion}</span>
                              )}
                              {ej.observaciones && (
                                <span title={ej.observaciones} className="text-gray-400 cursor-help">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                                  </svg>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

          </>
        )}
      </div>
    </div>
  )
}

export default TareasAnalytics
