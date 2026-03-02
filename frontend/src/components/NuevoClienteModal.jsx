import React, { useState, useEffect, useRef } from 'react'
import api from '../services/api'

const NuevoClienteModal = ({ onClose, onCreado }) => {
  // Paso 1: búsqueda, Paso 2: formulario
  const [paso, setPaso] = useState(1)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [importando, setImportando] = useState(null)
  const [sinResultados, setSinResultados] = useState(false)
  const inputRef = useRef(null)

  // Formulario paso 2
  const [form, setForm] = useState({
    cuit: '',
    condicion_iva: 'CF',
    razon_social: '',
    celular: '',
    email: '',
  })
  const [direcciones, setDirecciones] = useState([{ direccion: '', localidad: '', referencia: '' }])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Focus en input al abrir
  useEffect(() => {
    if (paso === 1) inputRef.current?.focus()
  }, [paso])

  // Debounce búsqueda CUIT
  useEffect(() => {
    if (paso !== 1) return
    const termino = busqueda.replace(/\D/g, '')
    if (termino.length < 3) {
      setResultados([])
      setSinResultados(false)
      return
    }

    const timeout = setTimeout(async () => {
      setBuscando(true)
      setSinResultados(false)
      try {
        const { data } = await api.get('/api/clientes/buscar-centum', { params: { cuit: termino } })
        setResultados(data.resultados || [])
        setSinResultados((data.resultados || []).length === 0)
      } catch (err) {
        console.error('Error buscando en Centum:', err)
        setResultados([])
        setSinResultados(true)
      } finally {
        setBuscando(false)
      }
    }, 400)

    return () => clearTimeout(timeout)
  }, [busqueda, paso])

  const importarCliente = async (cliente) => {
    setImportando(cliente.id_centum)
    try {
      const { data } = await api.post('/api/clientes/importar-centum', cliente)
      onCreado?.(data)
      onClose()
    } catch (err) {
      console.error('Error importando cliente:', err)
      setError(err.response?.data?.error || 'Error al importar cliente')
      setImportando(null)
    }
  }

  const [consultandoAfip, setConsultandoAfip] = useState(false)
  const [datosAfip, setDatosAfip] = useState(null)

  const irACrear = async () => {
    const cuitLimpio = busqueda.replace(/\D/g, '')
    setForm(prev => ({ ...prev, cuit: cuitLimpio }))
    setError(null)
    setPaso(2)

    // Consultar AFIP con CUIT (11 dígitos) o DNI (7-8 dígitos)
    if (cuitLimpio.length >= 7) {
      setConsultandoAfip(true)
      setDatosAfip(null)
      try {
        const { data } = await api.get('/api/clientes/buscar-afip', { params: { cuit: cuitLimpio } })
        if (data.encontrado && data.datos) {
          const d = data.datos
          setDatosAfip(d)
          setForm(prev => ({
            ...prev,
            cuit: d.cuit || prev.cuit,
            razon_social: d.razon_social || prev.razon_social,
            condicion_iva: (d.condicion_iva === 'RI' || d.condicion_iva === 'CF') ? d.condicion_iva : prev.condicion_iva,
          }))
          // Prellenar dirección fiscal si no hay direcciones cargadas
          if (d.domicilio && (!direcciones[0]?.direccion)) {
            setDirecciones([{
              direccion: d.domicilio,
              localidad: d.localidad || '',
              referencia: '',
            }])
          }
        } else {
          setDatosAfip('no_encontrado')
        }
      } catch (err) {
        console.warn('No se pudo consultar AFIP:', err.message)
        setDatosAfip('error')
      } finally {
        setConsultandoAfip(false)
      }
    }
  }

  const actualizarForm = (campo, valor) => {
    setForm(prev => ({ ...prev, [campo]: valor }))
  }

  const actualizarDireccion = (idx, campo, valor) => {
    setDirecciones(prev => prev.map((d, i) => i === idx ? { ...d, [campo]: valor } : d))
  }

  const agregarDireccion = () => {
    setDirecciones(prev => [...prev, { direccion: '', localidad: '', referencia: '' }])
  }

  const quitarDireccion = (idx) => {
    if (direcciones.length <= 1) return
    setDirecciones(prev => prev.filter((_, i) => i !== idx))
  }

  const [warningCentum, setWarningCentum] = useState(null)

  const guardarCliente = async () => {
    if (!form.razon_social.trim()) {
      setError('La razón social es requerida')
      return
    }
    if (!form.cuit.trim()) {
      setError('El CUIT/DNI es requerido')
      return
    }

    setGuardando(true)
    setError(null)
    setWarningCentum(null)
    try {
      const direccionesValidas = direcciones.filter(d => d.direccion.trim())
      const { data } = await api.post('/api/clientes', {
        razon_social: form.razon_social,
        cuit: form.cuit,
        condicion_iva: form.condicion_iva,
        celular: form.celular,
        email: form.email,
        direcciones_entrega: direccionesValidas,
      })

      if (data.warning_centum) {
        // Cliente creado local pero falló Centum — mostrar warning y no cerrar
        setWarningCentum(data.warning_centum)
        setGuardando(false)
        return
      }

      onCreado?.(data)
      onClose()
    } catch (err) {
      console.error('Error creando cliente:', err)
      setError(err.response?.data?.error || 'Error al crear cliente')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">
              {paso === 1 ? 'Buscar cliente' : 'Nuevo cliente'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {paso === 2 && (
            <button
              onClick={() => { setPaso(1); setError(null) }}
              className="text-xs text-amber-600 hover:text-amber-700 mt-1"
            >
              ← Volver a buscar
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {warningCentum && (
            <div className="text-sm bg-amber-50 border border-amber-300 rounded-lg px-3 py-3 space-y-2">
              <p className="text-amber-800 font-medium">Cliente guardado localmente</p>
              <p className="text-amber-700">{warningCentum}</p>
              <button
                onClick={() => { onCreado?.(); onClose() }}
                className="w-full py-2 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                Entendido
              </button>
            </div>
          )}

          {paso === 1 ? (
            <>
              {/* Input de búsqueda CUIT/DNI */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">CUIT / DNI</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Ej: 20-12345678-9 o 12345678"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Spinner */}
              {buscando && (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600" />
                </div>
              )}

              {/* Resultados */}
              {!buscando && resultados.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400">{resultados.length} resultado{resultados.length !== 1 ? 's' : ''} en Centum</p>
                  {resultados.map(r => (
                    <button
                      key={r.id_centum}
                      onClick={() => importarCliente(r)}
                      disabled={importando === r.id_centum}
                      className="w-full text-left bg-gray-50 hover:bg-amber-50 border border-gray-200 hover:border-amber-300 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-50"
                    >
                      <div className="text-sm font-medium text-gray-800 truncate">{r.razon_social}</div>
                      <div className="text-xs text-gray-400 truncate">
                        CUIT: {r.cuit}
                        {r.direccion && ` · ${r.direccion}`}
                      </div>
                      {importando === r.id_centum && (
                        <div className="text-xs text-amber-600 mt-1">Importando...</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Sin resultados → botón crear */}
              {!buscando && sinResultados && (
                <div className="text-center py-4 space-y-3">
                  <p className="text-sm text-gray-400">No se encontraron clientes en Centum</p>
                  <button
                    onClick={irACrear}
                    className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Crear cliente nuevo
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Indicador AFIP */}
              {consultandoAfip && (
                <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                  Consultando AFIP...
                </div>
              )}

              {datosAfip && !consultandoAfip && datosAfip !== 'no_encontrado' && datosAfip !== 'error' && (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  Datos prellenados desde ARCA
                  {datosAfip.estado && <span> · Estado: {datosAfip.estado}</span>}
                  {datosAfip.error_afip && <p className="text-amber-600 mt-1">{datosAfip.error_afip}</p>}
                </div>
              )}

              {datosAfip === 'no_encontrado' && !consultandoAfip && (
                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  No se encontraron datos en ARCA para este CUIT/DNI. Completá los datos manualmente.
                </div>
              )}

              {datosAfip === 'error' && !consultandoAfip && (
                <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No se pudo consultar ARCA. Completá los datos manualmente.
                </div>
              )}

              {/* Formulario de creación */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">CUIT / DNI *</label>
                <input
                  type="text"
                  value={form.cuit}
                  onChange={e => actualizarForm('cuit', e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Condición IVA</label>
                <select
                  value={form.condicion_iva}
                  onChange={e => actualizarForm('condicion_iva', e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                >
                  <option value="CF">Consumidor Final</option>
                  <option value="RI">Responsable Inscripto</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Razón Social *</label>
                <input
                  type="text"
                  value={form.razon_social}
                  onChange={e => actualizarForm('razon_social', e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Celular</label>
                <input
                  type="text"
                  value={form.celular}
                  onChange={e => actualizarForm('celular', e.target.value)}
                  placeholder="Ej: 341-1234567"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => actualizarForm('email', e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Direcciones de entrega */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Direcciones de entrega</label>
                  <button
                    type="button"
                    onClick={agregarDireccion}
                    className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                  >
                    + Agregar
                  </button>
                </div>
                <div className="space-y-3">
                  {direcciones.map((dir, idx) => (
                    <div key={idx} className="bg-gray-50 rounded-lg p-3 space-y-2 relative">
                      {direcciones.length > 1 && (
                        <button
                          type="button"
                          onClick={() => quitarDireccion(idx)}
                          className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                      <input
                        type="text"
                        value={dir.direccion}
                        onChange={e => actualizarDireccion(idx, 'direccion', e.target.value)}
                        placeholder="Dirección *"
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={dir.localidad}
                          onChange={e => actualizarDireccion(idx, 'localidad', e.target.value)}
                          placeholder="Localidad"
                          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                        />
                        <input
                          type="text"
                          value={dir.referencia}
                          onChange={e => actualizarDireccion(idx, 'referencia', e.target.value)}
                          placeholder="Referencia"
                          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer - solo en paso 2 */}
        {paso === 2 && (
          <div className="flex gap-3 p-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={guardarCliente}
              disabled={guardando}
              className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default NuevoClienteModal
