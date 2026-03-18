// Tab Dashboard — vista general de presentes/ausentes
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const TabDashboard = () => {
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)

  const cargar = async () => {
    try {
      const { data: d } = await api.get('/api/fichajes/dashboard')
      setData(d)
    } catch (err) {
      console.error('Error cargando dashboard:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    const interval = setInterval(cargar, 30000)
    return () => clearInterval(interval)
  }, [])

  if (cargando) return <div className="text-center py-10 text-gray-400">Cargando...</div>
  if (!data) return <div className="text-center py-10 text-gray-400">Error al cargar datos</div>

  const kpis = [
    { label: 'Presentes', valor: data.presentes, color: 'bg-green-100 text-green-700' },
    { label: 'Ausentes', valor: data.ausentes, color: 'bg-red-100 text-red-700' },
    { label: 'Llegaron tarde', valor: data.tarde, color: 'bg-yellow-100 text-yellow-700' },
    { label: 'En licencia', valor: data.enLicencia, color: 'bg-gray-100 text-gray-600' },
  ]

  return (
    <div>
      {/* Feriado */}
      {data.esFeriado && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-blue-700 text-sm font-medium">
          Hoy es feriado
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {kpis.map(k => (
          <div key={k.label} className={`rounded-xl p-4 ${k.color}`}>
            <p className="text-3xl font-bold">{k.valor}</p>
            <p className="text-sm mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Detalle de empleados */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Detalle del día ({data.totalConTurno} con turno asignado)</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {(data.detalle || []).length === 0 ? (
            <p className="px-4 py-6 text-gray-400 text-center text-sm">No hay empleados con turno asignado hoy</p>
          ) : (
            data.detalle.map((d, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">{d.empleado?.nombre}</span>
                <div className="flex items-center gap-2">
                  {d.hora && (
                    <span className="text-xs text-gray-400">
                      {new Date(d.hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    d.estado === 'presente' ? 'bg-green-100 text-green-700' :
                    d.estado === 'salio' ? 'bg-blue-100 text-blue-700' :
                    d.estado === 'tarde' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {d.estado === 'presente' ? 'Presente' :
                     d.estado === 'salio' ? 'Salió' :
                     d.estado === 'tarde' ? 'Tarde' : 'Ausente'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default TabDashboard
