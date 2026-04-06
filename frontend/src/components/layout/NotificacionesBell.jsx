import React, { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../services/api'

const tiempoRelativo = (fecha) => {
  const diff = Date.now() - new Date(fecha).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min}m`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `hace ${hrs}h`
  const dias = Math.floor(hrs / 24)
  return `hace ${dias}d`
}

const NotificacionesBell = () => {
  const [count, setCount] = useState(0)
  const [notifs, setNotifs] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  // Fetch count cada 60s
  const fetchCount = useCallback(async () => {
    try {
      const { data } = await api.get('/api/notificaciones/no-leidas')
      setCount(data.count || 0)
    } catch {}
  }, [])

  useEffect(() => {
    fetchCount()
    const interval = setInterval(fetchCount, 60000)
    return () => clearInterval(interval)
  }, [fetchCount])

  // Click fuera cierra el dropdown
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleOpen = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      try {
        const { data } = await api.get('/api/notificaciones')
        setNotifs(data)
      } catch {}
      setLoading(false)
    }
  }

  const marcarLeida = async (id) => {
    try {
      await api.put(`/api/notificaciones/${id}/leer`)
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, leida: true } : n))
      setCount(prev => Math.max(0, prev - 1))
    } catch {}
  }

  const marcarTodas = async () => {
    try {
      await api.put('/api/notificaciones/leer-todas')
      setNotifs(prev => prev.map(n => ({ ...n, leida: true })))
      setCount(0)
    } catch {}
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggleOpen}
        className="relative bg-blue-700 hover:bg-blue-800 p-2 rounded-lg transition-colors"
        title="Notificaciones"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full border-2 border-blue-600 flex items-center justify-center text-[10px] font-bold leading-none px-1">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 max-h-[70vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 text-sm">Notificaciones</h3>
            {count > 0 && (
              <button onClick={marcarTodas} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                Marcar todas como leidas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Cargando...</div>
            ) : notifs.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Sin notificaciones</div>
            ) : (
              notifs.map(n => (
                <div
                  key={n.id}
                  onClick={() => !n.leida && marcarLeida(n.id)}
                  className={`px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors ${
                    n.leida ? 'bg-white' : 'bg-blue-50 hover:bg-blue-100'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Indicador */}
                    <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                      n.tipo === 'alerta' ? 'bg-red-500' : n.tipo === 'error' ? 'bg-orange-500' : 'bg-blue-500'
                    } ${n.leida ? 'opacity-30' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-tight ${n.leida ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>
                        {n.titulo}
                      </p>
                      {n.mensaje && (
                        <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.mensaje}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">{tiempoRelativo(n.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default NotificacionesBell
