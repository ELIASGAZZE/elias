// Tab Planificacion — Grilla semanal multi-sucursal
import React, { useState, useEffect } from 'react'
import api from '../../services/api'

const TabPlanificacion = () => {
  const [turnos, setTurnos] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [planificacion, setPlanificacion] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [semanaOffset, setSemanaOffset] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [copiando, setCopiando] = useState(false)

  const getLunes = (offset) => {
    const hoy = new Date()
    const dia = hoy.getDay()
    const diffToLunes = dia === 0 ? -6 : 1 - dia
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() + diffToLunes + offset * 7)
    return lunes
  }

  const lunes = getLunes(semanaOffset)
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes)
    d.setDate(lunes.getDate() + i)
    return d
  })

  const formatFecha = (d) => d.toISOString().split('T')[0]
  const formatDia = (d) => {
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    return `${dias[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`
  }

  const cargar = async () => {
    setCargando(true)
    try {
      const fechaInicio = formatFecha(diasSemana[0])
      const fechaFin = formatFecha(diasSemana[6])

      const [t, s, e, p, a] = await Promise.all([
        api.get('/api/turnos'),
        api.get('/api/sucursales'),
        api.get('/api/empleados'),
        api.get(`/api/planificacion?fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}`),
        api.get('/api/turnos/asignaciones'),
      ])
      setTurnos(t.data)
      setSucursales(s.data)
      setEmpleados(e.data.filter(emp => emp.activo))
      setPlanificacion(p.data)
      setAsignaciones(a.data)
    } catch (err) {
      console.error('Error:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [semanaOffset])

  const getPlan = (empId, fecha) => {
    return planificacion.find(p => p.empleado_id === empId && p.fecha === fecha)
  }

  const getFallback = (empId, diaSemanaNum) => {
    return asignaciones.find(a => a.empleado_id === empId && a.dia_semana === diaSemanaNum)
  }

  // Generar opciones combinadas turno+sucursal
  const opciones = []
  for (const turno of turnos) {
    if (sucursales.length === 0) {
      opciones.push({ label: turno.nombre, value: `${turno.id}|`, turnoId: turno.id, sucursalId: null })
    } else {
      for (const suc of sucursales) {
        opciones.push({
          label: `${turno.nombre} — ${suc.nombre}`,
          value: `${turno.id}|${suc.id}`,
          turnoId: turno.id,
          sucursalId: suc.id,
        })
      }
      // Opcion sin sucursal
      opciones.push({ label: `${turno.nombre} — Sin suc.`, value: `${turno.id}|`, turnoId: turno.id, sucursalId: null })
    }
  }

  const handleCambio = async (empId, fecha, valor) => {
    if (!valor) {
      // Eliminar planificacion existente
      const plan = getPlan(empId, fecha)
      if (plan) {
        try {
          await api.delete(`/api/planificacion/${plan.id}`)
          setPlanificacion(prev => prev.filter(p => p.id !== plan.id))
        } catch (err) {
          alert(err.response?.data?.error || 'Error al eliminar')
        }
      }
      return
    }

    const [turnoId, sucursalId] = valor.split('|')
    try {
      const { data } = await api.post('/api/planificacion', {
        empleado_id: empId,
        turno_id: turnoId,
        sucursal_id: sucursalId || null,
        fecha,
      })
      setPlanificacion(prev => {
        const sin = prev.filter(p => !(p.empleado_id === empId && p.fecha === fecha))
        return [...sin, data]
      })
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar')
    }
  }

  const copiarSemana = async () => {
    if (!confirm('¿Copiar la planificación de esta semana a la siguiente?')) return
    setCopiando(true)
    try {
      const fechaOrigen = formatFecha(diasSemana[0])
      const lunesSig = new Date(lunes)
      lunesSig.setDate(lunes.getDate() + 7)
      const fechaDestino = formatFecha(lunesSig)

      await api.post('/api/planificacion/copiar-semana', { fecha_origen: fechaOrigen, fecha_destino: fechaDestino })
      alert('Semana copiada correctamente')
    } catch (err) {
      alert(err.response?.data?.error || 'Error al copiar semana')
    } finally {
      setCopiando(false)
    }
  }

  const getValorCelda = (empId, fecha, diaSemanaNum) => {
    const plan = getPlan(empId, fecha)
    if (plan) return `${plan.turno_id}|${plan.sucursal_id || ''}`
    return ''
  }

  const getFallbackLabel = (empId, diaSemanaNum) => {
    const fb = getFallback(empId, diaSemanaNum)
    if (!fb) return null
    const turno = turnos.find(t => t.id === fb.turno_id)
    return turno ? turno.nombre : null
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  const rangoLabel = `${formatDia(diasSemana[0])} — ${formatDia(diasSemana[6])}/${diasSemana[6].getFullYear()}`

  return (
    <div>
      {/* Navegacion semanal */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSemanaOffset(s => s - 1)}
            className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg"
          >
            &laquo; Anterior
          </button>
          <span className="text-sm font-semibold text-gray-700">{rangoLabel}</span>
          <button
            onClick={() => setSemanaOffset(s => s + 1)}
            className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg"
          >
            Siguiente &raquo;
          </button>
          {semanaOffset !== 0 && (
            <button
              onClick={() => setSemanaOffset(0)}
              className="text-xs text-blue-600 hover:underline"
            >
              Hoy
            </button>
          )}
        </div>
        <button
          onClick={copiarSemana}
          disabled={copiando}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {copiando ? 'Copiando...' : 'Copiar a sig. semana'}
        </button>
      </div>

      {/* Grilla */}
      {empleados.length === 0 ? (
        <p className="text-gray-400 text-sm">No hay empleados activos</p>
      ) : turnos.length === 0 ? (
        <p className="text-gray-400 text-sm">Creá al menos un turno en la tab Turnos</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-3 py-2 text-gray-500 font-medium sticky left-0 bg-white z-10 min-w-[140px]">Empleado</th>
                {diasSemana.map((d, i) => (
                  <th key={i} className="text-center px-1 py-2 text-gray-500 font-medium min-w-[150px]">
                    {formatDia(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empleados.map(emp => (
                <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap sticky left-0 bg-white z-10">
                    {emp.nombre}
                  </td>
                  {diasSemana.map((d, i) => {
                    const fecha = formatFecha(d)
                    const diaSemanaNum = d.getDay()
                    const valor = getValorCelda(emp.id, fecha, diaSemanaNum)
                    const fallbackLabel = !valor ? getFallbackLabel(emp.id, diaSemanaNum) : null

                    return (
                      <td key={i} className="px-1 py-1 text-center relative">
                        <select
                          value={valor}
                          onChange={(e) => handleCambio(emp.id, fecha, e.target.value)}
                          className={`w-full text-xs rounded px-1 py-1.5 border ${
                            valor
                              ? 'border-blue-200 bg-blue-50 text-blue-700'
                              : fallbackLabel
                                ? 'border-gray-200 bg-gray-50 text-gray-400 italic'
                                : 'border-gray-200 text-gray-400'
                          }`}
                          title={fallbackLabel ? `Fallback: ${fallbackLabel}` : ''}
                        >
                          <option value="">{fallbackLabel ? `(${fallbackLabel})` : '—'}</option>
                          {opciones.map(op => (
                            <option key={op.value} value={op.value}>{op.label}</option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        Las celdas en gris/itálica muestran el turno por defecto (de la tab Turnos). Seleccioná un turno+sucursal para planificar específicamente.
      </p>
    </div>
  )
}

export default TabPlanificacion
