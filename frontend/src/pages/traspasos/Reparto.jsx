import React, { useState, useEffect, useRef } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const Reparto = () => {
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [confirmacion, setConfirmacion] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [cargados, setCargados] = useState([]) // historial de la sesión
  const [scanInput, setScanInput] = useState('')
  const [tecladoVisible, setTecladoVisible] = useState(false)

  const scanBufferRef = useRef('')
  const scanTimeoutRef = useRef(null)
  const scanRef = useRef(null)
  const inputManualRef = useRef(null)

  // === Procesar código escaneado ===
  const procesarCodigo = (codigo) => {
    if (!codigo || buscando || enviando) return
    buscarPrecinto(codigo)
    setTimeout(() => scanRef.current?.focus(), 300)
  }

  // === Global keydown listener ===
  useEffect(() => {
    if (tecladoVisible || confirmacion) return
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Enter') {
        e.preventDefault()
        const codigo = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        setScanInput('')
        if (codigo) procesarCodigo(codigo)
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        scanBufferRef.current += e.key
        setScanInput(scanBufferRef.current)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tecladoVisible, confirmacion, buscando, enviando])

  // === onChange para DataWedge (InputConnection) ===
  const handleScanChange = (e) => {
    const val = e.target.value
    setScanInput(val)
    scanBufferRef.current = val
    clearTimeout(scanTimeoutRef.current)
    scanTimeoutRef.current = setTimeout(() => {
      const codigo = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      setScanInput('')
      procesarCodigo(codigo)
    }, 200)
  }

  // === onKeyDown para Enter ===
  const handleScanKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      clearTimeout(scanTimeoutRef.current)
      const codigo = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      setScanInput('')
      procesarCodigo(codigo)
    }
  }

  // === Auto-focus ===
  useEffect(() => {
    if (tecladoVisible || confirmacion) return
    const t = setTimeout(() => scanRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [tecladoVisible, feedback, confirmacion])

  const buscarPrecinto = async (valor) => {
    if (!valor || buscando || enviando) return

    setBuscando(true)
    setFeedback(null)

    try {
      const r = await api.get(`/api/traspasos/canastos/buscar-precinto/${encodeURIComponent(valor)}`)
      const { canasto, orden } = r.data
      const esPallet = canasto.tipo === 'pallet'

      if (canasto.estado === 'en_transito') {
        setFeedback({
          tipo: 'duplicado',
          mensaje: `${esPallet ? 'Pallet' : 'Canasto'} "${esPallet ? (canasto.numero_pallet || valor) : valor}" ya está en tránsito`,
        })

        setBuscando(false)
        return
      }

      if (canasto.estado !== 'en_origen') {
        setFeedback({
          tipo: 'error',
          mensaje: `${esPallet ? 'Pallet' : 'Canasto'} en estado "${canasto.estado}", debe estar en origen para despachar`,
        })

        setBuscando(false)
        return
      }

      setConfirmacion({
        canasto,
        orden,
        tipo: esPallet ? 'pallet' : (canasto.tipo === 'bulto' ? 'bulto' : 'canasto'),
        label: esPallet ? (canasto.numero_pallet || valor) : valor,
      })
      setPrecinto('')
    } catch (err) {
      console.error('[Reparto] Error buscar-precinto:', err.response?.status, err.response?.data, err.message)
      setFeedback({
        tipo: 'error',
        mensaje: err.response?.data?.error || `Error al buscar (${err.message})`,
      })
      setPrecinto('')
    } finally {
      setBuscando(false)
    }
  }

  const confirmarDespacho = async () => {
    if (!confirmacion || enviando) return
    setEnviando(true)
    setFeedback(null)

    try {
      const r = await api.put('/api/traspasos/canastos/despachar-scan', { canasto_id: confirmacion.canasto.id })
      const d = r.data

      const item = {
        label: confirmacion.label,
        tipo: confirmacion.tipo,
        destino: confirmacion.orden?.sucursal_destino_nombre,
        orden: d.orden?.numero,
      }

      if (d.orden_completada) {
        setFeedback({
          tipo: 'completada',
          mensaje: `Orden ${d.orden?.numero || ''} COMPLETADA - Todos los bultos despachados`,
        })
      } else {
        setFeedback({
          tipo: 'ok',
          mensaje: `${confirmacion.tipo === 'pallet' ? 'Pallet' : 'Canasto'} "${confirmacion.label}" cargado → ${confirmacion.orden?.sucursal_destino_nombre}`,
        })
      }

      setCargados(prev => [item, ...prev])
      setConfirmacion(null)
    } catch (err) {
      setFeedback({
        tipo: 'error',
        mensaje: err.response?.data?.error || 'Error al despachar',
      })
      setConfirmacion(null)
    } finally {
      setEnviando(false)
    }
  }

  const cancelarConfirmacion = () => {
    setConfirmacion(null)
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
      <Navbar titulo="Reparto v2" sinTabs />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Input de escaneo */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Escanear precinto de canasto o pallet
          </label>
          <div className="flex gap-2">
            {!tecladoVisible ? (
              <input
                ref={scanRef}
                type="text"
                inputMode="none"
                value={scanInput}
                onChange={handleScanChange}
                onKeyDown={handleScanKeyDown}
                placeholder="Escanear..."
                autoComplete="off"
                className="flex-1 border-2 border-purple-300 rounded-xl px-4 py-3 text-base text-center outline-none caret-transparent"
                autoFocus
                disabled={buscando || enviando || !!confirmacion}
              />
            ) : (
              <input
                ref={inputManualRef}
                type="text"
                inputMode="numeric"
                value={scanInput}
                onChange={e => { setScanInput(e.target.value); scanBufferRef.current = e.target.value }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const codigo = scanInput.trim()
                    if (!codigo) return
                    setScanInput('')
                    scanBufferRef.current = ''
                    procesarCodigo(codigo)
                    setTecladoVisible(false)
                  }
                }}
                onBlur={() => { if (!scanInput) setTecladoVisible(false) }}
                placeholder="Escribir código..."
                autoComplete="off"
                autoFocus
                className="flex-1 border-2 border-purple-300 rounded-xl px-4 py-3 text-base text-center outline-none"
                disabled={buscando || enviando || !!confirmacion}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setTecladoVisible(v => !v)
                setTimeout(() => inputManualRef.current?.focus(), 100)
              }}
              className={`px-3 rounded-xl border-2 ${tecladoVisible ? 'border-purple-500 bg-purple-50 text-purple-600' : 'border-gray-300 text-gray-400'}`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
              </svg>
            </button>
          </div>
          {buscando && <p className="text-xs text-purple-500 mt-2 text-center">Buscando...</p>}
        </div>

        {/* Popup de confirmación */}
        {confirmacion && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-purple-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Confirmar carga</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  El {confirmacion.tipo === 'pallet' ? 'pallet' : 'canasto'}{' '}
                  <span className="font-bold text-gray-800">{confirmacion.label}</span>{' '}
                  va a la sucursal{' '}
                  <span className="font-bold text-purple-700">{confirmacion.orden?.sucursal_destino_nombre}</span>
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Orden: {confirmacion.orden?.numero}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={cancelarConfirmacion}
                  disabled={enviando}
                  className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  No
                </button>
                <button
                  onClick={confirmarDespacho}
                  disabled={enviando}
                  className="flex-1 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {enviando ? 'Cargando...' : 'Sí, cargar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${feedbackColors[feedback.tipo]}`}>
            {feedbackIconos[feedback.tipo]}
            <span className="text-sm font-medium">{feedback.mensaje}</span>
          </div>
        )}

        {/* Historial de cargados en esta sesión */}
        {cargados.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Cargados ({cargados.length})
            </h3>
            <div className="space-y-1.5">
              {cargados.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm bg-green-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span className="font-medium text-gray-800">{item.label}</span>
                    {item.tipo === 'pallet' && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Pallet</span>}
                  </div>
                  <span className="text-xs text-gray-500">→ {item.destino}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Estado vacío */}
        {cargados.length === 0 && !feedback && (
          <div className="text-center py-16">
            <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
            </svg>
            <p className="text-sm text-gray-400">Escaneá un canasto o pallet para cargarlo al vehículo</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Reparto
