// Tab Reportes — tabla + gráficos + exportación
import React, { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../../services/api'

const COLORES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

const TabReportes = () => {
  const [empleados, setEmpleados] = useState([])
  const [empleadoId, setEmpleadoId] = useState('')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [fechaHasta, setFechaHasta] = useState(() => new Date().toISOString().split('T')[0])
  const [reporte, setReporte] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    api.get('/api/empleados').then(({ data }) => setEmpleados(data)).catch(() => {})
  }, [])

  const generar = async () => {
    setCargando(true)
    try {
      const params = { fecha_desde: fechaDesde, fecha_hasta: fechaHasta }
      if (empleadoId) params.empleado_id = empleadoId
      const { data } = await api.get('/api/fichajes/reporte', { params })
      setReporte(data)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al generar reporte')
    } finally {
      setCargando(false)
    }
  }

  const exportar = () => {
    const params = new URLSearchParams({ fecha_desde: fechaDesde, fecha_hasta: fechaHasta })
    if (empleadoId) params.set('empleado_id', empleadoId)
    const token = localStorage.getItem('token')
    const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    window.open(`${baseURL}/api/fichajes/export?${params}&token=${token}`, '_blank')
  }

  // Datos para gráficos
  const datosBarras = reporte.map(r => ({
    nombre: r.empleado?.nombre?.split(' ')[0] || '?',
    horas: r.totales.horas,
    extras: r.totales.extras,
  }))

  const totalDias = reporte.reduce((s, r) => s + r.totales.diasTrabajados, 0)
  const totalTardes = reporte.reduce((s, r) => s + r.totales.tardes, 0)
  const datosTorta = [
    { name: 'A tiempo', value: Math.max(0, totalDias - totalTardes) },
    { name: 'Tarde', value: totalTardes },
  ].filter(d => d.value > 0)

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Empleado</label>
          <select
            value={empleadoId}
            onChange={(e) => setEmpleadoId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {empleados.map(e => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={generar} disabled={cargando} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          {cargando ? 'Generando...' : 'Generar'}
        </button>
        {reporte.length > 0 && (
          <button onClick={exportar} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">
            Exportar CSV
          </button>
        )}
      </div>

      {reporte.length === 0 ? (
        <p className="text-center text-gray-400 py-10">Seleccioná un rango y generá el reporte</p>
      ) : (
        <>
          {/* Tabla resumen */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Empleado</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Días trabajados</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Horas totales</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Horas extra</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Llegadas tarde</th>
                </tr>
              </thead>
              <tbody>
                {reporte.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{r.empleado?.nombre}</td>
                    <td className="text-center px-3 py-2">{r.totales.diasTrabajados}</td>
                    <td className="text-center px-3 py-2">{r.totales.horas}h</td>
                    <td className="text-center px-3 py-2">
                      {r.totales.extras > 0 ? (
                        <span className="text-blue-600 font-medium">{r.totales.extras}h</span>
                      ) : '—'}
                    </td>
                    <td className="text-center px-3 py-2">
                      {r.totales.tardes > 0 ? (
                        <span className="text-red-500 font-medium">{r.totales.tardes}</span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Barras: horas por empleado */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="font-medium text-gray-700 text-sm mb-3">Horas por empleado</h4>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={datosBarras}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="nombre" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="horas" fill="#3b82f6" name="Horas" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="extras" fill="#10b981" name="Extras" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Torta: puntualidad */}
            {datosTorta.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h4 className="font-medium text-gray-700 text-sm mb-3">Puntualidad</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={datosTorta}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {datosTorta.map((_, i) => (
                        <Cell key={i} fill={COLORES[i]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default TabReportes
