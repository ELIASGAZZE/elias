// Tab Calendario — vista semanal/mensual de fichajes por empleado
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const TabCalendario = () => {
  const [empleados, setEmpleados] = useState([])
  const [empleadoId, setEmpleadoId] = useState('')
  const [fichajes, setFichajes] = useState([])
  const [semanaOffset, setSemanaOffset] = useState(0)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    api.get('/api/empleados').then(({ data }) => setEmpleados(data)).catch(err => console.error('Error loading employees:', err.message))
  }, [])

  const getSemana = () => {
    const hoy = new Date()
    hoy.setDate(hoy.getDate() + semanaOffset * 7)
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7))
    const domingo = new Date(lunes)
    domingo.setDate(lunes.getDate() + 6)
    return { lunes, domingo }
  }

  useEffect(() => {
    if (!empleadoId) { setFichajes([]); return }
    const { lunes, domingo } = getSemana()
    setCargando(true)
    api.get('/api/fichajes', {
      params: {
        empleado_id: empleadoId,
        fecha_desde: lunes.toISOString().split('T')[0],
        fecha_hasta: domingo.toISOString().split('T')[0] + 'T23:59:59',
      }
    }).then(({ data }) => setFichajes(data))
      .catch(err => console.error('Error loading fichajes:', err.message))
      .finally(() => setCargando(false))
  }, [empleadoId, semanaOffset])

  const { lunes, domingo } = getSemana()
  const dias = []
  for (let d = new Date(lunes); d <= domingo; d.setDate(d.getDate() + 1)) {
    dias.push(new Date(d))
  }

  const diasNombre = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  const fichajesPorDia = (fecha) => {
    const fechaStr = fecha.toISOString().split('T')[0]
    return fichajes.filter(f => f.fecha_hora.startsWith(fechaStr))
      .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))
  }

  const calcularHoras = (fichajesDia) => {
    let total = 0
    for (let i = 0; i < fichajesDia.length - 1; i += 2) {
      if (fichajesDia[i].tipo === 'entrada' && fichajesDia[i + 1]?.tipo === 'salida') {
        total += (new Date(fichajesDia[i + 1].fecha_hora) - new Date(fichajesDia[i].fecha_hora)) / (1000 * 60 * 60)
      }
    }
    return Math.round(total * 100) / 100
  }

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select
          value={empleadoId}
          onChange={(e) => setEmpleadoId(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Seleccionar empleado</option>
          {empleados.map(e => (
            <option key={e.id} value={e.id}>{e.nombre}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button onClick={() => setSemanaOffset(s => s - 1)} className="px-2 py-1 border rounded hover:bg-gray-50">←</button>
          <span className="text-sm text-gray-600">
            {lunes.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} — {domingo.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
          </span>
          <button onClick={() => setSemanaOffset(s => s + 1)} className="px-2 py-1 border rounded hover:bg-gray-50">→</button>
          {semanaOffset !== 0 && (
            <button onClick={() => setSemanaOffset(0)} className="text-xs text-blue-600 hover:underline">Hoy</button>
          )}
        </div>
      </div>

      {!empleadoId ? (
        <p className="text-center text-gray-400 py-10">Seleccioná un empleado para ver su calendario</p>
      ) : cargando ? (
        <p className="text-center text-gray-400 py-10">Cargando...</p>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {dias.map((dia, i) => {
            const fichajesDia = fichajesPorDia(dia)
            const horas = calcularHoras(fichajesDia)
            const esHoy = dia.toDateString() === new Date().toDateString()

            return (
              <div key={i} className={`bg-white rounded-xl border p-3 min-h-[120px] ${
                esHoy ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-500">{diasNombre[dia.getDay()]}</span>
                  <span className={`text-sm font-bold ${esHoy ? 'text-blue-600' : 'text-gray-800'}`}>
                    {dia.getDate()}
                  </span>
                </div>

                {fichajesDia.length === 0 ? (
                  <p className="text-xs text-gray-300 text-center mt-4">—</p>
                ) : (
                  <div className="space-y-1">
                    {fichajesDia.map(f => (
                      <div key={f.id} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${f.tipo === 'entrada' ? 'bg-green-500' : 'bg-orange-500'}`} />
                        <span className="text-xs text-gray-600">
                          {new Date(f.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                    {horas > 0 && (
                      <p className="text-xs font-medium text-blue-600 mt-1">{horas}h</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default TabCalendario
