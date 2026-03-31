import React, { useState, useEffect, useRef } from 'react'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import ControlArticulosModal from './ControlArticulosModal'

const RecepcionScan = () => {
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [confirmacion, setConfirmacion] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [recibidos, setRecibidos] = useState([])
  const [controlando, setControlando] = useState(null)
  const [pesoInput, setPesoInput] = useState('')
  const [bultosInput, setBultosInput] = useState('')
  const [pendientes, setPendientes] = useState([])
  const [conDiferencia, setConDiferencia] = useState([])
  const [cargandoPendientes, setCargandoPendientes] = useState(true)
  const [controlArticulosCanasto, setControlArticulosCanasto] = useState(null)
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
    if (tecladoVisible || confirmacion || controlando || controlArticulosCanasto) return
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
  }, [tecladoVisible, confirmacion, controlando, controlArticulosCanasto, buscando, enviando])

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
    if (tecladoVisible || confirmacion || controlando || controlArticulosCanasto) return
    const t = setTimeout(() => scanRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [tecladoVisible, feedback, confirmacion, controlando, controlArticulosCanasto])

  // Cargar canastos en tránsito + con diferencia hacia mi sucursal
  useEffect(() => {
    const cargar = async () => {
      try {
        const [rTransito, rDif] = await Promise.all([
          api.get('/api/traspasos/canastos/en-transito-mi-sucursal'),
          api.get('/api/traspasos/canastos/con-diferencia-mi-sucursal'),
        ])
        setPendientes(rTransito.data || [])
        setConDiferencia(rDif.data || [])
      } catch (err) {
        console.error('[Recepcion] Error cargando:', err)
      } finally {
        setCargandoPendientes(false)
      }
    }
    cargar()
  }, [])

  const buscarPrecinto = async (valor) => {
    if (!valor || buscando || enviando) return

    setBuscando(true)
    setFeedback(null)

    try {
      const r = await api.get(`/api/traspasos/canastos/buscar-precinto/${encodeURIComponent(valor)}`)
      const { canasto, orden } = r.data
      const esPallet = canasto.tipo === 'pallet'
      const label = esPallet ? (canasto.numero_pallet || valor) : valor

      if (canasto.estado === 'controlado' || canasto.estado === 'con_diferencia') {
        setFeedback({ tipo: 'duplicado', mensaje: `${esPallet ? 'Pallet' : 'Canasto'} "${label}" ya fue controlado` })
  
        setBuscando(false)
        return
      }

      if (canasto.estado === 'en_destino') {
        // Ya recibido, agregar directo a lista para controlar
        setRecibidos(prev => {
          if (prev.some(r => r.canasto.id === canasto.id)) return prev
          return [{ canasto, orden, label, tipo: esPallet ? 'pallet' : (canasto.tipo === 'bulto' ? 'bulto' : 'canasto'), accion: 'recibido' }, ...prev]
        })
        setFeedback({ tipo: 'duplicado', mensaje: `${esPallet ? 'Pallet' : 'Canasto'} "${label}" ya está en destino — disponible para controlar` })
  
        setBuscando(false)
        return
      }

      if (canasto.estado !== 'en_transito') {
        setFeedback({
          tipo: 'error',
          mensaje: `${esPallet ? 'Pallet' : 'Canasto'} en estado "${canasto.estado}", debe estar en tránsito para recibir`,
        })
  
        setBuscando(false)
        return
      }

      // en_transito → mostrar modal de confirmación
      setConfirmacion({
        canasto,
        orden,
        tipo: esPallet ? 'pallet' : (canasto.tipo === 'bulto' ? 'bulto' : 'canasto'),
        label,
      })

    } catch (err) {
      setFeedback({
        tipo: 'error',
        mensaje: err.response?.data?.error || `Error al buscar (${err.message})`,
      })

    } finally {
      setBuscando(false)
    }
  }

  const confirmarRecepcion = async () => {
    if (!confirmacion || enviando) return
    setEnviando(true)
    setFeedback(null)

    try {
      const r = await api.put('/api/traspasos/canastos/recibir-scan', { canasto_id: confirmacion.canasto.id })
      const d = r.data

      const item = {
        canasto: d.canasto,
        orden: d.orden,
        label: confirmacion.label,
        tipo: confirmacion.tipo,
        accion: d.accion,
      }

      if (d.accion === 'recibido') {
        setFeedback({ tipo: 'ok', mensaje: `${confirmacion.tipo === 'pallet' ? 'Pallet' : 'Canasto'} "${confirmacion.label}" recibido en destino` })
      } else if (d.accion === 'devuelto') {
        setFeedback({ tipo: 'devuelto', mensaje: `${confirmacion.tipo === 'pallet' ? 'Pallet' : 'Canasto'} "${confirmacion.label}" devuelto a origen` })
      }

      setRecibidos(prev => [item, ...prev])
      // Sacar de pendientes
      setPendientes(prev => prev.filter(p => p.canasto.id !== confirmacion.canasto.id))
      setConfirmacion(null)
    } catch (err) {
      setFeedback({
        tipo: 'error',
        mensaje: err.response?.data?.error || 'Error al recibir',
      })
      setConfirmacion(null)
    } finally {
      setEnviando(false)
    }
  }

  const cancelarConfirmacion = () => setConfirmacion(null)

  const iniciarControl = (id) => {
    setControlando(id)
    setPesoInput('')
    setBultosInput('')
  }

  const controlarPeso = async (item) => {
    const peso = parseFloat(pesoInput)
    if (isNaN(peso) || peso <= 0) return
    setEnviando(true)
    try {
      const r = await api.put(`/api/traspasos/canastos/${item.canasto.id}/pesar-destino`, { peso_destino: peso })
      const d = r.data
      setRecibidos(prev => prev.map(ri =>
        ri.canasto.id === item.canasto.id
          ? { ...ri, canasto: d, controlResult: { tipo: 'peso', ok: d.dentro_tolerancia, diferencia: d.diferencia_gramos } }
          : ri
      ))
      setControlando(null)
    } catch (err) {
      setFeedback({ tipo: 'error', mensaje: err.response?.data?.error || 'Error al pesar' })
    } finally {
      setEnviando(false)
    }
  }

  const controlarBultos = async (item) => {
    const bultos = parseInt(bultosInput)
    if (isNaN(bultos) || bultos < 0) return
    setEnviando(true)
    try {
      const r = await api.put(`/api/traspasos/canastos/${item.canasto.id}/verificar-pallet`, { cantidad_bultos_destino: bultos })
      const d = r.data
      setRecibidos(prev => prev.map(ri =>
        ri.canasto.id === item.canasto.id
          ? { ...ri, canasto: d, controlResult: { tipo: 'bultos', ok: d.bultos_coinciden, esperado: d.cantidad_bultos_origen, recibido: bultos } }
          : ri
      ))
      setControlando(null)
    } catch (err) {
      setFeedback({ tipo: 'error', mensaje: err.response?.data?.error || 'Error al verificar pallet' })
    } finally {
      setEnviando(false)
    }
  }

  const feedbackColors = {
    ok: 'bg-green-50 border-green-400 text-green-800',
    duplicado: 'bg-blue-50 border-blue-400 text-blue-800',
    devuelto: 'bg-amber-50 border-amber-400 text-amber-800',
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
    devuelto: (
      <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
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
      <Navbar titulo="Recepción" sinTabs />

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
                className="flex-1 border-2 border-teal-300 rounded-xl px-4 py-3 text-base text-center outline-none caret-transparent"
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
                className="flex-1 border-2 border-teal-300 rounded-xl px-4 py-3 text-base text-center outline-none"
                disabled={buscando || enviando || !!confirmacion}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setTecladoVisible(v => !v)
                setTimeout(() => inputManualRef.current?.focus(), 100)
              }}
              className={`px-3 rounded-xl border-2 ${tecladoVisible ? 'border-teal-500 bg-teal-50 text-teal-600' : 'border-gray-300 text-gray-400'}`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
              </svg>
            </button>
          </div>
          {buscando && <p className="text-xs text-teal-500 mt-2 text-center">Buscando...</p>}
        </div>

        {/* Modal de confirmación */}
        {confirmacion && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
              <div className="text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-teal-100 flex items-center justify-center">
                  <svg className="w-7 h-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-800 mb-1">Confirmar recepción</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {confirmacion.tipo === 'pallet' ? 'Pallet' : 'Canasto'}{' '}
                  <span className="font-bold text-gray-800">{confirmacion.label}</span>
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  {confirmacion.orden?.sucursal_origen_id && (
                    <>Origen → Destino</>
                  )}
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
                  Cancelar
                </button>
                <button
                  onClick={confirmarRecepcion}
                  disabled={enviando}
                  className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {enviando ? 'Procesando...' : 'Confirmar'}
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

        {/* Historial de recibidos en esta sesión */}
        {recibidos.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Recibidos ({recibidos.length})
            </h3>
            <div className="space-y-2">
              {recibidos.map((item, idx) => (
                <div key={idx} className={`rounded-lg px-3 py-2 ${item.accion === 'devuelto' ? 'bg-amber-50' : 'bg-green-50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {item.accion === 'devuelto' ? (
                        <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                      <span className="font-medium text-gray-800 text-sm">{item.label}</span>
                      {item.tipo === 'pallet' && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Pallet</span>}
                      {item.accion === 'devuelto' && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Devuelto</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.controlArticulosResult ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${item.controlArticulosResult.hay_diferencias ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {item.controlArticulosResult.hay_diferencias ? 'Con diferencias' : 'Controlado OK'}
                        </span>
                      ) : item.controlResult ? (
                        item.controlResult.ok ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">OK</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                              Existen diferencias
                            </span>
                            <button
                              onClick={() => setControlArticulosCanasto(item)}
                              className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2 py-1 rounded-lg font-medium transition-colors"
                            >
                              Controlar artículos
                            </button>
                          </div>
                        )
                      ) : item.canasto?.requiere_control_articulos ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                            Requiere control
                          </span>
                          <button
                            onClick={() => setControlArticulosCanasto(item)}
                            className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2 py-1 rounded-lg font-medium transition-colors"
                          >
                            Controlar artículos
                          </button>
                        </div>
                      ) : item.accion === 'recibido' ? (
                        <button
                          onClick={() => iniciarControl(item.canasto.id)}
                          className="text-xs bg-teal-100 text-teal-700 hover:bg-teal-200 px-2 py-1 rounded-lg font-medium transition-colors"
                        >
                          Controlar
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Control inline */}
                  {controlando === item.canasto.id && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      {item.tipo === 'pallet' ? (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500">Bultos:</label>
                          <input
                            type="number"
                            value={bultosInput}
                            onChange={e => setBultosInput(e.target.value)}
                            placeholder="Cantidad"
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                            autoFocus
                            min="0"
                          />
                          <button
                            onClick={() => controlarBultos(item)}
                            disabled={enviando || !bultosInput}
                            className="text-xs bg-teal-600 text-white px-3 py-1 rounded font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                          >
                            {enviando ? '...' : 'Verificar'}
                          </button>
                          <button onClick={() => setControlando(null)} className="text-xs text-gray-400 hover:text-gray-600">
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500">Peso (kg):</label>
                          <input
                            type="number"
                            value={pesoInput}
                            onChange={e => setPesoInput(e.target.value)}
                            placeholder="0.000"
                            step="0.001"
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-teal-500 outline-none"
                            autoFocus
                            min="0"
                          />
                          <button
                            onClick={() => controlarPeso(item)}
                            disabled={enviando || !pesoInput}
                            className="text-xs bg-teal-600 text-white px-3 py-1 rounded font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                          >
                            {enviando ? '...' : 'Pesar'}
                          </button>
                          <button onClick={() => setControlando(null)} className="text-xs text-gray-400 hover:text-gray-600">
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Con diferencias pendientes de control */}
        {conDiferencia.length > 0 && (
          <div className="bg-white rounded-xl border border-red-200 p-4">
            <h3 className="text-sm font-semibold text-red-500 uppercase tracking-wider mb-3">
              Con diferencias — pendientes de control ({conDiferencia.length})
            </h3>
            <div className="space-y-1.5">
              {conDiferencia.map((item) => {
                const c = item.canasto
                const esPallet = c.tipo === 'pallet'
                const label = c.precinto || c.numero_pallet || `#${c.id.slice(0, 8)}`
                // Verificar si ya fue controlado en esta sesión
                const enRecibidos = recibidos.find(r => r.canasto.id === c.id)
                if (enRecibidos?.controlArticulosResult) return null
                return (
                  <div key={c.id} className="text-sm bg-red-50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <span className="font-medium text-gray-800 break-all">{label}</span>
                        {esPallet && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Pallet</span>}
                        {c.requiere_control_articulos && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Requiere control</span>
                        )}
                      </div>
                      <button
                        onClick={() => setControlArticulosCanasto({ canasto: c, orden: item.orden })}
                        className="text-xs bg-red-100 text-red-700 hover:bg-red-200 px-2.5 py-1 rounded-lg font-medium transition-colors shrink-0 ml-2"
                      >
                        Controlar artículos
                      </button>
                    </div>
                    {item.orden && (
                      <p className="text-xs text-gray-400 mt-1 ml-6">Orden: {item.orden.numero}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Pendientes en tránsito hacia mi sucursal */}
        {pendientes.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              En tránsito ({pendientes.length})
            </h3>
            <div className="space-y-1.5">
              {pendientes.map((item) => {
                const c = item.canasto
                const esPallet = c.tipo === 'pallet'
                const label = c.precinto || c.numero_pallet || `#${c.id.slice(0, 8)}`
                return (
                  <div key={c.id} className="text-sm bg-yellow-50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                        <span className="font-medium text-gray-800 break-all">{label}</span>
                        {esPallet && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">Pallet</span>}
                      </div>
                      <span className="text-xs text-yellow-600 font-medium shrink-0 ml-2">En tránsito</span>
                    </div>
                    {item.orden && (
                      <p className="text-xs text-gray-400 mt-1 ml-6">Orden: {item.orden.numero}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {cargandoPendientes && pendientes.length === 0 && recibidos.length === 0 && !feedback && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400">Cargando...</p>
          </div>
        )}

        {/* Estado vacío */}
        {!cargandoPendientes && recibidos.length === 0 && pendientes.length === 0 && !feedback && (
          <div className="text-center py-16">
            <svg className="w-16 h-16 text-gray-200 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
            </svg>
            <p className="text-sm text-gray-400">No hay canastos en tránsito ni recibidos. Escaneá un precinto para empezar.</p>
          </div>
        )}
      </div>

      {/* Modal de control de artículos */}
      {controlArticulosCanasto && (
        <ControlArticulosModal
          canasto={controlArticulosCanasto.canasto}
          orden={controlArticulosCanasto.orden}
          onClose={(resultado) => {
            if (resultado) {
              // Actualizar en recibidos de la sesión
              setRecibidos(prev => {
                const exists = prev.some(ri => ri.canasto.id === controlArticulosCanasto.canasto.id)
                if (exists) {
                  return prev.map(ri =>
                    ri.canasto.id === controlArticulosCanasto.canasto.id
                      ? { ...ri, controlArticulosResult: resultado, canasto: resultado.canasto || ri.canasto }
                      : ri
                  )
                }
                // Si viene de la lista persistente, agregarlo a recibidos
                return [{
                  canasto: resultado.canasto || controlArticulosCanasto.canasto,
                  orden: controlArticulosCanasto.orden,
                  label: controlArticulosCanasto.canasto.precinto || controlArticulosCanasto.canasto.numero_pallet || '',
                  tipo: controlArticulosCanasto.canasto.tipo === 'pallet' ? 'pallet' : 'canasto',
                  accion: 'recibido',
                  controlArticulosResult: resultado,
                }, ...prev]
              })
              // Sacar de la lista persistente de con diferencia
              setConDiferencia(prev => prev.filter(d => d.canasto.id !== controlArticulosCanasto.canasto.id))
            }
            setControlArticulosCanasto(null)
          }}
          onRequiereControl={(canastoId, precinto) => {
            // Marcar otro canasto como requiere control
            setRecibidos(prev => prev.map(ri =>
              ri.canasto.id === canastoId
                ? { ...ri, canasto: { ...ri.canasto, requiere_control_articulos: true } }
                : ri
            ))
          }}
        />
      )}
    </div>
  )
}

export default RecepcionScan
