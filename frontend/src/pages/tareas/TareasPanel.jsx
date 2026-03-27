// Panel general: registros y pendientes por sucursal, filtrado por fecha
import React, { useState, useEffect, useRef } from 'react'
import Navbar from '../../components/layout/Navbar'
import TareasNav from '../../components/tareas/TareasNav'
import api from '../../services/api'

const REFRESH_MS = 30000

const hoyArg = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

const formatHoraArg = (isoStr) => new Date(isoStr).toLocaleTimeString('es-AR', {
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires'
})

const navFecha = (fecha, dias) =>
  new Date(new Date(fecha + 'T12:00:00').getTime() + dias * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

const DIAS_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

const formatProxima = (proximaStr, fechaBase) => {
  if (!proximaStr) return null
  const base = new Date(fechaBase + 'T12:00:00')
  const prox = new Date(proximaStr + 'T12:00:00')
  const diffDias = Math.round((prox - base) / 86400000)
  if (diffDias <= 0) return null
  if (diffDias === 1) return 'día siguiente'
  if (diffDias <= 7) {
    const dia = DIAS_NOMBRE[prox.getDay()]
    return `${dia} ${prox.getDate()}/${prox.getMonth() + 1}`
  }
  return `${diffDias} días después`
}

const TareasPanel = () => {
  const [fecha, setFecha] = useState(hoyArg())
  const [data, setData] = useState([])
  const [cargando, setCargando] = useState(true)
  const intervalRef = useRef(null)

  const cargar = async (f, silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const { data: res } = await api.get('/api/tareas/panel-dia', { params: { fecha: f || fecha } })
      setData(res || [])
    } catch (err) {
      console.error('Error cargando panel:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar(fecha)
    intervalRef.current = setInterval(() => cargar(fecha, true), REFRESH_MS)
    return () => clearInterval(intervalRef.current)
  }, [fecha])

  const cambiarFecha = (f) => {
    setFecha(f)
  }

  // KPIs globales
  const totalRealizadas = data.reduce((s, suc) => s + suc.total_realizadas, 0)
  const totalNoRealizadas = data.reduce((s, suc) => s + suc.total_no_realizadas, 0)
  const total = totalRealizadas + totalNoRealizadas
  const porcentaje = total > 0 ? Math.round((totalRealizadas / total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Tareas" sinTabs />
      <TareasNav />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header con fecha */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-800">Panel general</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => cambiarFecha(navFecha(fecha, -1))}
              className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <input
              type="date"
              value={fecha}
              onChange={e => cambiarFecha(e.target.value)}
              max={hoyArg()}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
            <button
              onClick={() => cambiarFecha(navFecha(fecha, 1))}
              disabled={fecha >= hoyArg()}
              className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
            {fecha !== hoyArg() && (
              <button
                onClick={() => cambiarFecha(hoyArg())}
                className="text-xs px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 font-medium"
              >
                Hoy
              </button>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{data.length}</p>
            <p className="text-xs text-gray-500 mt-1">Sucursales</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{totalRealizadas}</p>
            <p className="text-xs text-gray-500 mt-1">Realizadas</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold ${totalNoRealizadas > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {totalNoRealizadas}
            </p>
            <p className="text-xs text-gray-500 mt-1">No realizadas</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="relative w-12 h-12 mx-auto mb-1">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <path d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={porcentaje === 100 ? '#16a34a' : '#f97316'} strokeWidth="3" strokeDasharray={`${porcentaje}, 100`} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">{porcentaje}%</span>
            </div>
            <p className="text-xs text-gray-500">Cumplimiento</p>
          </div>
        </div>

        {cargando ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No hay datos para esta fecha</div>
        ) : (
          <div className="space-y-6">
            {data.map(suc => (
              <SucursalDia key={suc.sucursal_id} sucursal={suc} fechaBase={fecha} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const SucursalDia = ({ sucursal, fechaBase }) => {
  const [expandida, setExpandida] = useState(true)
  const { registros, no_realizadas, total_realizadas, total_no_realizadas } = sucursal
  const total = total_realizadas + total_no_realizadas
  const pct = total > 0 ? Math.round((total_realizadas / total) * 100) : 0
  const todoListo = total_no_realizadas === 0 && total_realizadas > 0

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${todoListo ? 'border-green-200' : 'border-gray-200'}`}>
      {/* Header */}
      <button
        onClick={() => setExpandida(!expandida)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
            todoListo ? 'bg-green-500' : total_no_realizadas > 0 ? 'bg-red-500' : 'bg-gray-300'
          }`} />
          <div>
            <p className="font-semibold text-gray-800">{sucursal.sucursal_nombre}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {total_realizadas} realizada{total_realizadas !== 1 ? 's' : ''}
              {total_no_realizadas > 0 && <span className="text-red-600 ml-1">· {total_no_realizadas} sin hacer</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${todoListo ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-500 w-8">{pct}%</span>
          </div>
          {todoListo && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">Todo listo</span>
          )}
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandida ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expandida && (
        <div className="border-t border-gray-100">
          {/* Registros realizados */}
          {registros.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2 font-medium text-gray-500 w-20">Hora</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-500 w-24">Estado</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500">Tarea</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500">Empleados</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500">Registrado por</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-500 w-28">Calificación</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-500 w-20">Subtareas</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500">Observaciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {registros.map(reg => (
                    <tr key={reg.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{formatHoraArg(reg.hora)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {reg.a_tiempo === null ? (
                          <span className="text-gray-300">-</span>
                        ) : reg.a_tiempo ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">A tiempo</span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            Tarde{reg.dias_tarde > 0 ? ` ${reg.dias_tarde}d` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-800 font-medium">{reg.tarea}</td>
                      <td className="px-4 py-2.5 text-gray-600">{reg.empleados.join(', ') || '-'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{reg.registrado_por}</td>
                      <td className="px-4 py-2.5 text-center">
                        {reg.calificacion ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            reg.calificacion >= 4 ? 'bg-green-100 text-green-700' :
                            reg.calificacion >= 3 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {'★'.repeat(reg.calificacion)}{'☆'.repeat(5 - reg.calificacion)}
                          </span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center text-gray-600">
                        {reg.subtareas_total > 0 ? `${reg.subtareas_completadas}/${reg.subtareas_total}` : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500">{reg.observaciones || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tareas no realizadas */}
          {no_realizadas.length > 0 && (
            <div className={registros.length > 0 ? 'border-t border-gray-100' : ''}>
              <div className="px-4 py-2 bg-red-50/50">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">No realizadas</p>
              </div>
              <div className="divide-y divide-gray-50">
                {no_realizadas.map(t => {
                  const prox = formatProxima(t.proxima_fecha, fechaBase)
                  return (
                    <div key={t.tarea_config_id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${t.dias_atraso > 0 ? 'border-red-400' : 'border-gray-300'}`} />
                      <span className="text-sm text-gray-700 flex-1">{t.nombre}</span>
                      {t.dias_atraso > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium flex-shrink-0">
                          {t.dias_atraso}d atraso
                        </span>
                      )}
                      {prox && (
                        <span className={`text-xs flex-shrink-0 ${t.reprogramada ? 'text-orange-500' : 'text-gray-400'}`}>
                          {t.reprogramada ? `Se reprogramó para ${prox}` : `Próxima: ${prox}`}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {registros.length === 0 && no_realizadas.length === 0 && (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">Sin actividad para esta fecha</div>
          )}
        </div>
      )}
    </div>
  )
}

export default TareasPanel
