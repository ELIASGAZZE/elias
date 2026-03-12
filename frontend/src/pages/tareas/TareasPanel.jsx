// Panel general: estado en tiempo real de tareas por sucursal (admin/gestor)
import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const REFRESH_MS = 30000 // Auto-refresh cada 30 segundos

const TareasPanel = () => {
  const [data, setData] = useState([])
  const [cargando, setCargando] = useState(true)
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null)
  const intervalRef = useRef(null)

  const cargar = async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const { data: res } = await api.get('/api/tareas/panel-general')
      setData(res)
      setUltimaActualizacion(new Date())
    } catch (err) {
      console.error('Error cargando panel:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    intervalRef.current = setInterval(() => cargar(true), REFRESH_MS)
    return () => clearInterval(intervalRef.current)
  }, [])

  // Totales globales
  const totalTareas = data.reduce((s, suc) => s + suc.total, 0)
  const totalCompletadas = data.reduce((s, suc) => s + suc.completadas, 0)
  const totalPendientes = data.reduce((s, suc) => s + suc.pendientes, 0)
  const porcentaje = totalTareas > 0 ? Math.round((totalCompletadas / totalTareas) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar titulo="Panel de Tareas" sinTabs volverA="/tareas" />

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* KPIs globales */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{data.length}</p>
            <p className="text-xs text-gray-500 mt-1">Sucursales</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{totalCompletadas}</p>
            <p className="text-xs text-gray-500 mt-1">Completadas</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold ${totalPendientes > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {totalPendientes}
            </p>
            <p className="text-xs text-gray-500 mt-1">Pendientes</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div className="relative w-12 h-12 mx-auto mb-1">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                <path
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none" stroke="#e5e7eb" strokeWidth="3"
                />
                <path
                  d="M18 2.0845a 15.9155 15.9155 0 0 1 0 31.831a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none" stroke={porcentaje === 100 ? '#16a34a' : '#f97316'} strokeWidth="3"
                  strokeDasharray={`${porcentaje}, 100`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                {porcentaje}%
              </span>
            </div>
            <p className="text-xs text-gray-500">Avance</p>
          </div>
        </div>

        {/* Info de actualización */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Estado por sucursal</h2>
          <div className="flex items-center gap-3">
            {ultimaActualizacion && (
              <span className="text-xs text-gray-400">
                Actualizado: {ultimaActualizacion.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button
              onClick={() => cargar()}
              className="text-xs px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg hover:bg-orange-100 font-medium"
            >
              Actualizar
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-400 mb-4">Se actualiza automaticamente cada 30 segundos</div>

        {cargando ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : data.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No hay tareas programadas para hoy</div>
        ) : (
          <div className="space-y-4">
            {data.map(suc => (
              <SucursalCard key={suc.sucursal_id} sucursal={suc} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const SucursalCard = ({ sucursal }) => {
  const [expandida, setExpandida] = useState(sucursal.pendientes > 0)
  const pct = sucursal.total > 0 ? Math.round((sucursal.completadas / sucursal.total) * 100) : 0
  const todoCompleto = sucursal.pendientes === 0

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      todoCompleto ? 'border-green-200' : 'border-gray-200'
    }`}>
      {/* Header de sucursal */}
      <button
        onClick={() => setExpandida(!expandida)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
            todoCompleto ? 'bg-green-500' : sucursal.pendientes > 0 ? 'bg-red-500 animate-pulse' : 'bg-gray-300'
          }`} />
          <div>
            <p className="font-semibold text-gray-800">{sucursal.sucursal_nombre}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {sucursal.completadas}/{sucursal.total} completadas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Barra de progreso mini */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${todoCompleto ? 'bg-green-500' : 'bg-orange-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gray-500 w-8">{pct}%</span>
          </div>

          {/* Badges */}
          {sucursal.pendientes > 0 && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-100 text-red-700">
              {sucursal.pendientes} pendiente{sucursal.pendientes > 1 ? 's' : ''}
            </span>
          )}
          {todoCompleto && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-100 text-green-700">
              Todo listo
            </span>
          )}

          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandida ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Lista de tareas */}
      {expandida && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {sucursal.tareas
            .sort((a, b) => (a.completada === b.completada ? 0 : a.completada ? 1 : -1))
            .map(tarea => (
            <div key={tarea.tarea_config_id} className={`px-4 py-3 flex items-center gap-3 ${tarea.completada ? 'bg-green-50/50' : ''}`}>
              {/* Icono estado */}
              {tarea.completada ? (
                <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${
                  tarea.atrasada ? 'border-red-400' : 'border-gray-300'
                }`} />
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${tarea.completada ? 'text-gray-500 line-through' : 'text-gray-800'}`}>
                  {tarea.nombre}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {tarea.completada ? (
                    <span className="text-xs text-green-600">
                      {tarea.completada_por || 'Completada'}
                      {tarea.hora_completada && ` - ${new Date(tarea.hora_completada).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`}
                    </span>
                  ) : tarea.atrasada ? (
                    <span className="text-xs text-red-600 font-medium">
                      Atrasada {tarea.dias_atraso}d
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Pendiente</span>
                  )}
                </div>
              </div>

              {/* Badge */}
              {!tarea.completada && tarea.atrasada && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium flex-shrink-0">
                  {tarea.dias_atraso}d
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TareasPanel
