// Panel de logs y monitoreo de APIs externas
import React, { useState, useEffect, useRef, useCallback } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

// ── Helpers ──

const formatFecha = (iso) => {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const formatDuracion = (ms) => {
  if (!ms && ms !== 0) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const tiempoRelativo = (iso) => {
  if (!iso) return 'Nunca'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Hace instantes'
  if (min < 60) return `Hace ${min} min`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `Hace ${hrs}h`
  const dias = Math.floor(hrs / 24)
  return `Hace ${dias}d`
}

const ESTADO_CONFIG = {
  ok: { color: 'bg-green-500', bgCard: 'border-green-200', badge: 'bg-green-100 text-green-700', label: 'Operativo' },
  warning: { color: 'bg-yellow-500', bgCard: 'border-yellow-300', badge: 'bg-yellow-100 text-yellow-700', label: 'Atrasado' },
  critico: { color: 'bg-red-500', bgCard: 'border-red-300', badge: 'bg-red-100 text-red-700', label: 'Crítico' },
  error: { color: 'bg-red-500', bgCard: 'border-red-300', badge: 'bg-red-100 text-red-700', label: 'Error reciente' },
  sin_datos: { color: 'bg-gray-400', bgCard: 'border-gray-200', badge: 'bg-gray-100 text-gray-500', label: 'Sin datos' },
}

// ── Componentes de logs (tab Logs) ──

const BadgeEstado = ({ estado }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
    estado === 'ok' || estado === 'ok_existente'
      ? 'bg-green-100 text-green-700'
      : 'bg-red-100 text-red-700'
  }`}>
    {estado === 'ok' || estado === 'ok_existente' ? 'OK' : 'Error'}
  </span>
)

const BadgeOrigen = ({ origen }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
    origen === 'manual'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-100 text-gray-600'
  }`}>
    {origen}
  </span>
)

// ── ServiceCard ──

const ServiceCard = ({ servicio, onSync }) => {
  const [syncing, setSyncing] = useState(false)
  const cfg = ESTADO_CONFIG[servicio.estado] || ESTADO_CONFIG.sin_datos

  const handleSync = async () => {
    if (!servicio.endpointManual || syncing) return
    setSyncing(true)
    try {
      await onSync(servicio)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={`bg-white rounded-xl border-2 ${cfg.bgCard} p-4 flex flex-col gap-2`}>
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full ${cfg.color} flex-shrink-0`} />
        <span className="font-semibold text-gray-800 text-sm">{servicio.nombre}</span>
      </div>

      <span className={`inline-flex self-start items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badge}`}>
        {cfg.label}
      </span>

      <div className="text-xs text-gray-500 space-y-0.5">
        {servicio.ultimoOk && (
          <p>Última sync OK: {tiempoRelativo(servicio.ultimoOk.fecha)}</p>
        )}
        {servicio.ultimoOk?.items != null && (
          <p>{servicio.ultimoOk.items} items</p>
        )}
        {servicio.ultimoLog?.error && servicio.estado === 'error' && (
          <p className="text-red-500 truncate" title={servicio.ultimoLog.error}>
            {servicio.ultimoLog.error.slice(0, 80)}
          </p>
        )}
        {!servicio.ultimoLog && (
          <p className="text-gray-400">Sin actividad registrada</p>
        )}
      </div>

      {servicio.endpointManual && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="mt-auto text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {syncing ? 'Sincronizando...' : 'Sincronizar'}
        </button>
      )}
    </div>
  )
}

// ── Banner de alertas ──

const AlertBanner = ({ alertas }) => {
  const total = alertas.criticos + alertas.errores
  if (total === 0) return null

  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
      <p className="text-sm text-red-700 font-medium">
        {total} servicio{total > 1 ? 's' : ''} con problemas
        {alertas.warnings > 0 && ` · ${alertas.warnings} atrasado${alertas.warnings > 1 ? 's' : ''}`}
      </p>
    </div>
  )
}

// ── Componente principal ──

const AdminApiLogs = () => {
  const [tab, setTab] = useState('estado')
  const [health, setHealth] = useState(null)
  const [logs, setLogs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState(null)
  const intervalRef = useRef(null)

  const cargarHealth = useCallback(async () => {
    try {
      const { data } = await api.get('/api/api-logs/health')
      setHealth(data)
    } catch (err) {
      console.error('Error al cargar health:', err)
    }
  }, [])

  const cargarLogs = useCallback(async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/api-logs')
      setLogs(data)
    } catch (err) {
      console.error('Error al cargar logs:', err)
    } finally {
      setCargando(false)
    }
  }, [])

  // Cargar datos según tab activo
  useEffect(() => {
    if (tab === 'estado') {
      cargarHealth()
      intervalRef.current = setInterval(cargarHealth, 60000)
    } else {
      cargarLogs()
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [tab, cargarHealth, cargarLogs])

  const handleSync = async (servicio) => {
    try {
      await api({ method: servicio.metodoManual, url: servicio.endpointManual })
      // Refrescar health después del sync
      await cargarHealth()
    } catch (err) {
      console.error('Error en sync manual:', err)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="API" sinTabs />

      {/* Tabs */}
      <div className="px-4 pt-3 flex gap-2">
        <button
          onClick={() => setTab('estado')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'estado'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Estado
        </button>
        <button
          onClick={() => setTab('logs')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'logs'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          Logs
        </button>
      </div>

      <div className="px-4 py-4">
        {/* ── Tab Estado ── */}
        {tab === 'estado' && (
          <>
            {!health ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : (
              <>
                <AlertBanner alertas={health.alertas} />

                <div className="grid grid-cols-2 gap-3">
                  {health.servicios.map(svc => (
                    <ServiceCard key={svc.id} servicio={svc} onSync={handleSync} />
                  ))}
                </div>

                <p className="text-xs text-gray-400 text-center mt-4">
                  Auto-refresh cada 60s
                </p>
              </>
            )}
          </>
        )}

        {/* ── Tab Logs ── */}
        {tab === 'logs' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">
                Logs de conexiones a APIs externas
              </p>
              <button
                onClick={cargarLogs}
                disabled={cargando}
                className="text-sm bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {cargando ? 'Cargando...' : 'Actualizar'}
              </button>
            </div>

            {cargando && logs.length === 0 && (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            )}

            {!cargando && logs.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">No hay logs registrados</p>
              </div>
            )}

            {logs.length > 0 && (
              <div className="space-y-2">
                {logs.map(log => (
                  <div
                    key={log.id}
                    className={`bg-white rounded-xl border overflow-hidden transition-colors ${
                      log.estado === 'error' ? 'border-red-200' : 'border-gray-200'
                    }`}
                  >
                    <button
                      onClick={() => setExpandido(expandido === log.id ? null : log.id)}
                      className="w-full text-left p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <BadgeEstado estado={log.estado} />
                          <span className="text-sm font-medium text-gray-800 truncate">
                            {log.servicio}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <BadgeOrigen origen={log.origen} />
                          <span className="text-xs text-gray-400">
                            {formatFecha(log.created_at)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                        <span>{log.metodo}</span>
                        {log.duracion_ms != null && (
                          <span>{formatDuracion(log.duracion_ms)}</span>
                        )}
                        {log.items_procesados != null && (
                          <span>{log.items_procesados} items</span>
                        )}
                        {log.status_code && (
                          <span>HTTP {log.status_code}</span>
                        )}
                      </div>
                    </button>

                    {expandido === log.id && (
                      <div className="px-3 pb-3 border-t border-gray-100 pt-2 space-y-1">
                        <p className="text-xs text-gray-500">
                          <span className="font-medium">Endpoint:</span> {log.endpoint}
                        </p>
                        {log.error_mensaje && (
                          <div className="bg-red-50 rounded-lg p-2 mt-1">
                            <p className="text-xs text-red-700 font-medium">Error:</p>
                            <p className="text-xs text-red-600 mt-0.5 break-all">{log.error_mensaje}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default AdminApiLogs
