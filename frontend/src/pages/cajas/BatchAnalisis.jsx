// Página de análisis batch de cierres — resúmenes diarios por sucursal
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const BatchAnalisis = () => {
  const { esAdmin, esGestor } = useAuth()
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)
  const [ejecutando, setEjecutando] = useState(false)
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [detalle, setDetalle] = useState(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  useEffect(() => {
    cargarHistorial()
  }, [])

  const cargarHistorial = async () => {
    try {
      const { data } = await api.get('/api/batch-analisis?limit=15')
      setHistorial(data || [])
    } catch {
      // silently fail
    } finally {
      setCargando(false)
    }
  }

  const ejecutarBatch = async () => {
    if (!fecha || ejecutando) return
    setEjecutando(true)
    try {
      const { data } = await api.post('/api/batch-analisis', { fecha })
      setHistorial(prev => [data, ...prev.filter(h => h.batch_id !== data.batch_id)])
      setDetalle(data)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al ejecutar análisis')
    } finally {
      setEjecutando(false)
    }
  }

  const verDetalle = async (batchId) => {
    setCargandoDetalle(true)
    try {
      const { data } = await api.get(`/api/batch-analisis/${batchId}`)
      setDetalle(data)
    } catch {
      alert('Error al cargar detalle')
    } finally {
      setCargandoDetalle(false)
    }
  }

  if (!(esAdmin || esGestor)) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Análisis Batch" sinTabs volverA="/cajas" />
        <div className="px-4 py-10 text-center text-gray-500">Acceso denegado</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Análisis Batch" sinTabs volverA="/cajas" />

      <div className="px-4 py-4 space-y-4">
        {/* Ejecutar nuevo batch */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Analizar cierres del día</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Fecha</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
              />
            </div>
            <button
              onClick={ejecutarBatch}
              disabled={ejecutando}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {ejecutando ? 'Analizando...' : 'Analizar'}
            </button>
          </div>
        </div>

        {/* Detalle del batch seleccionado */}
        {detalle && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-violet-800">
                Resultado — {formatFecha(detalle.fecha)}
              </h3>
              <button onClick={() => setDetalle(null)} className="text-xs text-violet-500 hover:text-violet-700">&times; Cerrar</button>
            </div>

            {/* Métricas resumen */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-white border border-violet-100 rounded-lg p-2 text-center">
                <span className="text-lg font-bold text-gray-800">{detalle.total_cierres || detalle.total || 0}</span>
                <span className="text-xs text-gray-500 block">Cierres</span>
              </div>
              <div className="bg-white border border-violet-100 rounded-lg p-2 text-center">
                <span className="text-lg font-bold text-red-600">{detalle.con_diferencia || 0}</span>
                <span className="text-xs text-gray-500 block">Con diferencia</span>
              </div>
              <div className="bg-white border border-violet-100 rounded-lg p-2 text-center">
                <span className="text-lg font-bold text-violet-700">{detalle.analizados || 0}</span>
                <span className="text-xs text-gray-500 block">Analizados IA</span>
              </div>
              <div className="bg-white border border-violet-100 rounded-lg p-2 text-center">
                <span className={`text-lg font-bold ${
                  (detalle.puntaje_promedio || 0) > 80 ? 'text-green-600' :
                  (detalle.puntaje_promedio || 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {detalle.puntaje_promedio || '—'}
                </span>
                <span className="text-xs text-gray-500 block">Puntaje prom.</span>
              </div>
            </div>

            {/* Patrones detectados */}
            {detalle.patrones && detalle.patrones.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-violet-700">Patrones detectados</h4>
                {detalle.patrones.map((p, idx) => (
                  <div key={idx} className="bg-white border border-violet-100 rounded-lg p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800 capitalize">{p.tipo?.replace(/_/g, ' ')} — {p.causa?.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-violet-500">{p.ocurrencias}x</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Monto prom: {formatMonto(p.monto_promedio)} | {p.cajeros_afectados} cajero(s)
                    </div>
                    {p.sugerencia && (
                      <p className="text-xs text-violet-600 mt-1 italic">{p.sugerencia}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Lista de cierres */}
            {detalle.resultados && detalle.resultados.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-violet-700">Cierres del día</h4>
                <div className="space-y-1">
                  {detalle.resultados.map(c => (
                    <Link
                      key={c.cierre_id}
                      to={`/cajas/cierre/${c.cierre_id}`}
                      className="flex items-center justify-between bg-white border border-gray-100 rounded-lg p-2 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-800 flex-shrink-0">#{c.planilla_id}</span>
                        <span className="text-xs text-gray-500 truncate">{c.caja} — {c.cajero || c.empleado}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {c.diferencia_total !== null && Math.abs(c.diferencia_total) > 0.01 && (
                          <span className={`text-xs font-medium ${Math.abs(c.diferencia_total) > 2000 ? 'text-red-600' : 'text-yellow-600'}`}>
                            {formatMonto(c.diferencia_total)}
                          </span>
                        )}
                        {c.puntaje !== null && (
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                            c.puntaje > 80 ? 'bg-green-100 text-green-700' :
                            c.puntaje >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {c.puntaje}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Cierres from detailed batch (when loaded via verDetalle) */}
            {detalle.cierres && detalle.cierres.length > 0 && !detalle.resultados && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-violet-700">Cierres del día</h4>
                <div className="space-y-1">
                  {detalle.cierres.map(c => (
                    <Link
                      key={c.id}
                      to={`/cajas/cierre/${c.id}`}
                      className="flex items-center justify-between bg-white border border-gray-100 rounded-lg p-2 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-800 flex-shrink-0">#{c.planilla_id}</span>
                        <span className="text-xs text-gray-500 truncate">{c.caja?.nombre} — {c.empleado?.nombre}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {c.analisis && (
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                            c.analisis.puntaje > 80 ? 'bg-green-100 text-green-700' :
                            c.analisis.puntaje >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {c.analisis.puntaje}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Historial de batches */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Historial de análisis</h3>

          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-violet-600" />
            </div>
          ) : historial.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No hay análisis batch previos</p>
          ) : (
            <div className="space-y-1.5">
              {historial.map(h => (
                <button
                  key={h.id || h.batch_id}
                  onClick={() => verDetalle(h.id || h.batch_id)}
                  disabled={cargandoDetalle}
                  className="w-full text-left flex items-center justify-between bg-gray-50 hover:bg-violet-50 rounded-lg p-3 transition-colors"
                >
                  <div>
                    <span className="text-sm font-medium text-gray-800">{formatFecha(h.fecha)}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {h.total_cierres} cierres, {h.con_diferencia || 0} con dif.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {h.puntaje_promedio && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        h.puntaje_promedio > 80 ? 'bg-green-100 text-green-700' :
                        h.puntaje_promedio >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {h.puntaje_promedio}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      h.estado === 'completado' ? 'bg-green-100 text-green-700' :
                      h.estado === 'procesando' ? 'bg-yellow-100 text-yellow-700' :
                      h.estado === 'error' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {h.estado}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <Link to="/cajas" className="block text-center text-sm text-gray-500 hover:text-gray-700 py-2">
          Volver a Control de Cajas
        </Link>
      </div>
    </div>
  )
}

export default BatchAnalisis
