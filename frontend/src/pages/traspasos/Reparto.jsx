import React, { useState, useEffect, useRef } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const Reparto = () => {
  const [ordenes, setOrdenes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [precinto, setPrecinto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState(null) // { tipo, mensaje }
  const [expandida, setExpandida] = useState(null)
  const inputRef = useRef(null)

  const cargar = async () => {
    try {
      const r = await api.get('/api/traspasos/ordenes-reparto')
      setOrdenes(r.data)
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [feedback])

  const despacharBulto = async (canastoId) => {
    setEnviando(true)
    setFeedback(null)
    try {
      const r = await api.put('/api/traspasos/canastos/despachar-scan', { canasto_id: canastoId })
      const d = r.data
      if (d.orden_completada) {
        setFeedback({ tipo: 'completada', mensaje: `Orden ${d.orden?.numero || ''} COMPLETADA - Todos los canastos despachados` })
      } else {
        setFeedback({ tipo: 'ok', mensaje: `Bulto despachado (${d.total_canastos - d.canastos_restantes}/${d.total_canastos})` })
      }
      cargar()
    } catch (err) {
      setFeedback({ tipo: 'error', mensaje: err.response?.data?.error || 'Error al despachar bulto' })
    } finally {
      setEnviando(false)
    }
  }

  const escanear = async (e) => {
    e.preventDefault()
    const valor = precinto.trim()
    if (!valor || enviando) return

    setEnviando(true)
    setFeedback(null)

    try {
      const r = await api.put('/api/traspasos/canastos/despachar-scan', { precinto: valor })
      const d = r.data

      if (d.orden_completada) {
        setFeedback({
          tipo: 'completada',
          mensaje: `Orden ${d.orden?.numero || ''} COMPLETADA - Todos los canastos despachados`,
        })
      } else if (d.ya_escaneado) {
        setFeedback({
          tipo: 'duplicado',
          mensaje: `Canasto "${valor}" ya estaba escaneado (${d.total_canastos - d.canastos_restantes}/${d.total_canastos})`,
        })
      } else {
        setFeedback({
          tipo: 'ok',
          mensaje: `Canasto "${valor}" despachado (${d.total_canastos - d.canastos_restantes}/${d.total_canastos})`,
        })
      }

      setPrecinto('')
      cargar()
    } catch (err) {
      setFeedback({
        tipo: 'error',
        mensaje: err.response?.data?.error || 'Error al escanear',
      })
      setPrecinto('')
    } finally {
      setEnviando(false)
    }
  }

  const feedbackColors = {
    ok: 'bg-green-50 border-green-400 text-green-800',
    duplicado: 'bg-blue-50 border-blue-400 text-blue-800',
    completada: 'bg-purple-50 border-purple-400 text-purple-800',
    error: 'bg-red-50 border-red-400 text-red-800',
  }

  const feedbackIconos = {
    ok: (
      <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    duplicado: (
      <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    ),
    completada: (
      <svg className="w-5 h-5 text-purple-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
    ),
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Reparto" sinTabs />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Input de escaneo */}
        <form onSubmit={escanear} className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Escanear precinto de canasto
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={precinto}
              onChange={e => setPrecinto(e.target.value)}
              placeholder="Escanear o escribir precinto..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
              autoFocus
              disabled={enviando}
            />
            <button
              type="submit"
              disabled={!precinto.trim() || enviando}
              className="px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {enviando ? 'Enviando...' : 'Despachar'}
            </button>
          </div>
        </form>

        {/* Feedback */}
        {feedback && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${feedbackColors[feedback.tipo]}`}>
            {feedbackIconos[feedback.tipo]}
            <span className="text-sm font-medium">{feedback.mensaje}</span>
          </div>
        )}

        {/* Lista de órdenes */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Órdenes preparadas ({ordenes.length})
          </h2>

          {cargando ? (
            <p className="text-sm text-gray-400 text-center py-8">Cargando...</p>
          ) : ordenes.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
              </svg>
              <p className="text-sm text-gray-400">No hay órdenes preparadas para despachar</p>
            </div>
          ) : (
            ordenes.map(orden => {
              const progreso = orden.total_canastos > 0
                ? Math.round((orden.canastos_despachados / orden.total_canastos) * 100)
                : 0
              const abierta = expandida === orden.id

              return (
                <div key={orden.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Header de orden */}
                  <button
                    onClick={() => setExpandida(abierta ? null : orden.id)}
                    className="w-full p-4 text-left"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-800">{orden.numero}</span>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${abierta ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                      <span className="text-xs font-medium text-gray-500">
                        {orden.canastos_despachados}/{orden.total_canastos} canastos
                      </span>
                    </div>

                    <p className="text-xs text-gray-500 mb-2">
                      {orden.sucursal_origen_nombre} → {orden.sucursal_destino_nombre}
                    </p>

                    {/* Barra de progreso */}
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          progreso === 100 ? 'bg-purple-600' : 'bg-green-500'
                        }`}
                        style={{ width: `${progreso}%` }}
                      />
                    </div>
                  </button>

                  {/* Detalle de canastos */}
                  {abierta && (
                    <div className="border-t border-gray-100 px-4 pb-4">
                      <div className="space-y-2 pt-3">
                        {(orden.canastos || []).map(c => {
                          const esBulto = c.tipo === 'bulto'
                          return (
                            <div
                              key={c.id}
                              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                                c.estado === 'despachado'
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-gray-50 text-gray-600'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`font-medium ${esBulto ? '' : 'font-mono'} truncate`}>
                                  {esBulto ? (c.nombre || 'Bulto') : c.precinto}
                                </span>
                                {esBulto && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Bulto</span>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {esBulto && c.estado === 'cerrado' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      despacharBulto(c.id)
                                    }}
                                    className="text-xs bg-purple-100 text-purple-700 px-2.5 py-1 rounded-lg font-medium active:bg-purple-200"
                                  >
                                    Despachar
                                  </button>
                                )}
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  c.estado === 'despachado'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-200 text-gray-500'
                                }`}>
                                  {c.estado === 'despachado' ? 'Despachado' : 'Pendiente'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

export default Reparto
