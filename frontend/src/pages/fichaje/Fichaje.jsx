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
  const feedbackTimer = useRef(null)
  const inputRef = useRef(null)

  // Reloj
  useEffect(() => {
    const timer = setInterval(() => setHora(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Cargar últimos fichajes
  const cargarUltimos = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/fichajes/ultimos?limit=5`)
      setUltimosFichajes(data)
    } catch {
      // silenciar
    }
  }, [])

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
    if (pin.length < 1) return

    setCargando(true)
    try {
      const { data } = await axios.post(`${API_URL}/api/fichajes/pin`, { pin })

      setFeedback({
        tipo: data.tipo,
        nombre: data.empleado.nombre,
        hora: new Date(data.fichaje.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      })
      setPin('')
      cargarUltimos()
      limpiarFeedback()
    } catch (err) {
      setFeedback({ error: err.response?.data?.error || 'Error al fichar' })
      setPin('')
      limpiarFeedback(2000)
    } finally {
      setCargando(false)
    }
  }

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key)
      else if (e.key === 'Backspace') handleBackspace()
      else if (e.key === 'Enter') handleSubmit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const formatFecha = (d) => `${dias[d.getDay()]} ${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 select-none">

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

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-gray-400 text-sm font-semibold tracking-widest uppercase mb-2">Control de Horario</h1>
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
      <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-8">
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

      {/* Últimos fichajes */}
      {ultimosFichajes.length > 0 && (
        <div className="w-full max-w-xs">
          <p className="text-gray-600 text-xs uppercase tracking-wider mb-2">Últimos fichajes</p>
          <div className="space-y-1.5">
            {ultimosFichajes.map(f => (
              <div key={f.id} className="flex items-center gap-2 text-sm">
                <span className={`w-1.5 h-1.5 rounded-full ${f.tipo === 'entrada' ? 'bg-green-500' : 'bg-orange-500'}`} />
                <span className="text-gray-400">{f.empleados?.nombre}</span>
                <span className="text-gray-600 ml-auto">
                  {f.tipo === 'entrada' ? 'Entrada' : 'Salida'}{' '}
                  {new Date(f.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Fichaje
