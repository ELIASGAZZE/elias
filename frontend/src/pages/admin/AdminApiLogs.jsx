// Panel de logs de APIs externas
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const BadgeEstado = ({ estado }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
    estado === 'ok'
      ? 'bg-green-100 text-green-700'
      : 'bg-red-100 text-red-700'
  }`}>
    {estado === 'ok' ? 'OK' : 'Error'}
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

const AdminApiLogs = () => {
  const [logs, setLogs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState(null)

  const cargarLogs = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/api-logs')
      setLogs(data)
    } catch (err) {
      console.error('Error al cargar logs:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarLogs()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="API" sinTabs />

      <div className="px-4 py-4">
        {/* Header con refresh */}
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

        {/* Spinner */}
        {cargando && logs.length === 0 && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {/* Sin logs */}
        {!cargando && logs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No hay logs registrados</p>
          </div>
        )}

        {/* Lista de logs */}
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
                  {/* Fila principal */}
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

                  {/* Resumen */}
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

                {/* Detalle expandido */}
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
      </div>
    </div>
  )
}

export default AdminApiLogs
