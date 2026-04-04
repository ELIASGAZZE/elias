// Pantalla Kiosk de Fichaje — ruta pública /fichaje
import React, { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const Fichaje = () => {
  const [pin, setPin] = useState('')
  const [hora, setHora] = useState(new Date())
  const [ultimosFichajes, setUltimosFichajes] = useState([])
  const [feedback, setFeedback] = useState(null) // { tipo, nombre, hora, error }
  const [cargando, setCargando] = useState(false)
  const [sucursal, setSucursal] = useState(null) // { id, nombre }
  const [tokenError, setTokenError] = useState(null)
  const feedbackTimer = useRef(null)
  const inputRef = useRef(null)
  const submittingRef = useRef(false)

  // Resolver token de sucursal desde URL (?s=TOKEN)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('s')
    if (!token) return

    axios.get(`${API_URL}/api/sucursales/by-token/${token}`)
      .then(({ data }) => setSucursal(data))
      .catch(() => setTokenError('Link de fichaje inválido o expirado'))
  }, [])

  // Reloj
  useEffect(() => {
    const timer = setInterval(() => setHora(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Cargar últimos fichajes (filtrados por sucursal si hay, últimos 7 días)
  const cargarUltimos = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50', dias: '7' })
      if (sucursal?.id) params.set('sucursal_id', sucursal.id)
      const { data } = await axios.get(`${API_URL}/api/fichajes/ultimos?${params}`)
      setUltimosFichajes(data)
    } catch {
      // silenciar
    }
  }, [sucursal])

  useEffect(() => {
    cargarUltimos()
    const interval = setInterval(cargarUltimos, 15000)
    return () => clearInterval(interval)
  }, [cargarUltimos])

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus()
  }, [feedback])

  const limpiarFeedback = (ms = 3000) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => {
      setFeedback(null)
      setPin('')
    }, ms)
  }

  const handleDigit = (d) => {
    if (pin.length < 12) setPin(prev => prev + d)
  }

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1))
  }

  const handleSubmit = async () => {
    if (pin.length < 1 || submittingRef.current) return
    submittingRef.current = true
    setCargando(true)
    try {
      const body = { pin }
      if (sucursal?.id) body.sucursal_id = sucursal.id
      const { data } = await axios.post(`${API_URL}/api/fichajes/pin`, body)

      setFeedback({
        tipo: data.tipo,
        nombre: data.empleado.nombre,
        hora: new Date(data.fichaje.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      })
      setPin('')
      cargarUltimos()
      limpiarFeedback()
    } catch (err) {
      // 409 = fichaje reciente (debounce server-side) — mostrar como éxito
      if (err.response?.status === 409 && err.response?.data?.fichaje) {
        const d = err.response.data
        setFeedback({
          tipo: d.tipo,
          nombre: '',
          hora: new Date(d.fichaje.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        })
        setPin('')
        limpiarFeedback()
      } else {
        setFeedback({ error: err.response?.data?.error || 'Error al fichar' })
        setPin('')
        limpiarFeedback(2000)
      }
    } finally {
      setCargando(false)
      submittingRef.current = false
    }
  }

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key)
      else if (e.key === 'Backspace') handleBackspace()
      else if (e.key === 'Enter' && !submittingRef.current) handleSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const formatFecha = (d) => `${diasSemana[d.getDay()]} ${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`

  // Agrupar fichajes por fecha
  const fichajesPorDia = ultimosFichajes.reduce((acc, f) => {
    const fecha = new Date(f.fecha_hora).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })
    if (!acc[fecha]) acc[fecha] = []
    acc[fecha].push(f)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-900 flex select-none">

      {/* Error de token inválido */}
      {tokenError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-red-600 rounded-3xl p-10 text-center max-w-sm mx-4">
            <div className="text-6xl mb-4">✕</div>
            <p className="text-white text-xl font-bold">{tokenError}</p>
          </div>
        </div>
      )}

      {/* Feedback overlay */}
      {feedback && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fadeIn`}>
          <div className={`rounded-3xl p-10 text-center max-w-sm mx-4 ${
            feedback.error ? 'bg-red-600' :
            feedback.tipo === 'entrada' ? 'bg-green-600' :
            feedback.tipo === 'salida' ? 'bg-orange-600' :
            'bg-blue-600'
          }`}>
            <div className="text-6xl mb-4">
              {feedback.error ? '✕' : feedback.tipo === 'entrada' ? '→' : feedback.tipo === 'salida' ? '←' : '✓'}
            </div>
            {feedback.error ? (
              <p className="text-white text-xl font-bold">{feedback.error}</p>
            ) : (
              <>
                <p className="text-white text-2xl font-bold mb-1">{feedback.nombre}</p>
                <p className="text-white/80 text-lg">
                  {feedback.tipo === 'entrada' ? 'Entrada' : feedback.tipo === 'salida' ? 'Salida' : 'PIN cambiado'} — {feedback.hora || ''}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Columna izquierda: Reloj + Teclado */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-gray-400 text-sm font-semibold tracking-widest uppercase mb-2">
            Control de Horario{sucursal ? ` — ${sucursal.nombre}` : ''}
          </h1>
          <div className="text-white text-6xl font-light tracking-wider tabular-nums">
            {hora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <p className="text-gray-500 mt-1">{formatFecha(hora)}</p>
        </div>

        {/* Código display */}
        <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-xs mb-6">
          <p className="text-gray-500 text-xs text-center mb-3 uppercase tracking-wider">Ingresá tu código</p>
          <div className="text-center text-white text-3xl font-mono tracking-[0.3em] h-10 flex items-center justify-center">
            {pin || <span className="text-gray-600">--------</span>}
          </div>
        </div>

        {/* Teclado numérico */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button
              key={n}
              onClick={() => handleDigit(String(n))}
              className="h-16 rounded-2xl bg-gray-800 text-white text-2xl font-medium hover:bg-gray-700 active:bg-gray-600 transition-colors"
            >
              {n}
            </button>
          ))}
          <button
            onClick={handleBackspace}
            className="h-16 rounded-2xl bg-gray-800 text-gray-400 text-xl hover:bg-gray-700 active:bg-gray-600 transition-colors"
          >
            ←
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="h-16 rounded-2xl bg-gray-800 text-white text-2xl font-medium hover:bg-gray-700 active:bg-gray-600 transition-colors"
          >
            0
          </button>
          <button
            onClick={handleSubmit}
            disabled={pin.length < 1 || cargando}
            className="h-16 rounded-2xl bg-blue-600 text-white text-xl font-bold hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 transition-colors"
          >
            {cargando ? '...' : '✓'}
          </button>
        </div>
      </div>

      {/* Columna derecha: Historial de fichajes */}
      <div className="w-80 bg-gray-800/50 border-l border-gray-700/50 overflow-y-auto p-5">
        <p className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-4">Registros recientes</p>
        {Object.keys(fichajesPorDia).length === 0 ? (
          <p className="text-gray-600 text-sm">Sin registros</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(fichajesPorDia).map(([fecha, fichajes]) => (
              <div key={fecha}>
                <p className="text-gray-500 text-[11px] uppercase tracking-wider font-medium mb-1.5">{fecha}</p>
                <div className="space-y-1">
                  {fichajes.map(f => (
                    <div key={f.id} className="flex items-center gap-2 text-sm py-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.tipo === 'entrada' ? 'bg-green-500' : 'bg-orange-500'}`} />
                      <span className="text-gray-300 truncate">{f.empleados?.nombre}</span>
                      <span className="text-gray-500 ml-auto flex-shrink-0 text-xs">
                        {f.tipo === 'entrada' ? 'E' : 'S'}{' '}
                        {new Date(f.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Fichaje
