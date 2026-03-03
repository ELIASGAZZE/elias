import React, { useState, useEffect, useRef } from 'react'
import NuevoClienteModal from '../NuevoClienteModal'
import api from '../../services/api'

const PASOS = ['cliente', 'tipo', 'detalles', 'confirmar']

const ModalNuevoPedido = ({ onClose, onCreado }) => {
  const [paso, setPaso] = useState(0) // index en PASOS
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  // Paso 1: Seleccionar cliente
  const [busqueda, setBusqueda] = useState('')
  const [clientes, setClientes] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [mostrarCrearCliente, setMostrarCrearCliente] = useState(false)

  // Paso 2: Tipo de pedido
  const [tipo, setTipo] = useState(null) // 'delivery' | 'retiro'

  // Paso 3: Detalles
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [direcciones, setDirecciones] = useState([])
  const [direccionSeleccionada, setDireccionSeleccionada] = useState(null)
  const [sucursales, setSucursales] = useState([])
  const [sucursalSeleccionada, setSucursalSeleccionada] = useState(null)
  const [cargandoDetalles, setCargandoDetalles] = useState(false)

  // Nueva dirección inline
  const [mostrarNuevaDir, setMostrarNuevaDir] = useState(false)
  const [nuevaDir, setNuevaDir] = useState({ direccion: '', localidad: '' })
  const [guardandoDir, setGuardandoDir] = useState(false)

  // Paso 4: Confirmar
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)

  // Focus input al abrir
  useEffect(() => {
    if (paso === 0) setTimeout(() => inputRef.current?.focus(), 100)
  }, [paso])

  // Debounce búsqueda clientes
  useEffect(() => {
    if (paso !== 0) return
    const termino = busqueda.trim()
    if (termino.length < 2) {
      setClientes([])
      return
    }

    const timeout = setTimeout(async () => {
      setBuscando(true)
      try {
        const { data } = await api.get('/api/clientes', { params: { buscar: termino, limit: 15 } })
        setClientes(data.clientes || [])
      } catch (err) {
        console.error('Error buscando clientes:', err)
        setClientes([])
      } finally {
        setBuscando(false)
      }
    }, 350)

    return () => clearTimeout(timeout)
  }, [busqueda, paso])

  const seleccionarCliente = (cliente) => {
    if (!cliente.id_centum) {
      setError('Este cliente no tiene ID de Centum. Debe sincronizarse primero.')
      return
    }
    setClienteSeleccionado(cliente)
    setError(null)
    setPaso(1)
  }

  const onClienteCreado = (cliente) => {
    setMostrarCrearCliente(false)
    if (cliente?.id_centum) {
      seleccionarCliente(cliente)
    } else if (cliente) {
      setError('El cliente se creó pero no se pudo sincronizar con Centum. Reintentá más tarde.')
    }
  }

  const seleccionarTipo = async (t) => {
    setTipo(t)
    setError(null)
    setCargandoDetalles(true)
    setPaso(2)

    try {
      if (t === 'delivery') {
        const { data } = await api.get(`/api/clientes/${clienteSeleccionado.id}/direcciones`)
        setDirecciones(data || [])
        if (data.length > 0) setDireccionSeleccionada(data[0].id)
      } else {
        const { data } = await api.get('/api/sucursales')
        setSucursales(data || [])
        if (data.length > 0) setSucursalSeleccionada(data[0].id)
      }
    } catch (err) {
      console.error('Error cargando detalles:', err)
      setError('Error al cargar datos')
    } finally {
      setCargandoDetalles(false)
    }

    // Default fecha: mañana
    const manana = new Date()
    manana.setDate(manana.getDate() + 1)
    setFechaEntrega(manana.toISOString().split('T')[0])
  }

  const guardarNuevaDireccion = async () => {
    if (!nuevaDir.direccion.trim()) { setError('Ingresá una dirección'); return }
    setGuardandoDir(true)
    setError(null)
    try {
      const { data } = await api.post(`/api/clientes/${clienteSeleccionado.id}/direcciones`, {
        direccion: nuevaDir.direccion.trim(),
        localidad: nuevaDir.localidad.trim() || null,
      })
      setDirecciones(prev => [...prev, data])
      setDireccionSeleccionada(data.id)
      setMostrarNuevaDir(false)
      setNuevaDir({ direccion: '', localidad: '' })
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar dirección')
    } finally {
      setGuardandoDir(false)
    }
  }

  const irAConfirmar = () => {
    setError(null)
    if (!fechaEntrega) { setError('Seleccioná una fecha de entrega'); return }
    if (tipo === 'delivery' && !direccionSeleccionada && direcciones.length > 0) {
      setError('Seleccioná una dirección de entrega'); return
    }
    if (tipo === 'retiro' && !sucursalSeleccionada) {
      setError('Seleccioná una sucursal'); return
    }
    setPaso(3)
  }

  const confirmarPedido = async () => {
    setEnviando(true)
    setError(null)
    try {
      const body = {
        cliente_id: clienteSeleccionado.id,
        tipo,
        fecha_entrega: fechaEntrega,
      }
      if (tipo === 'delivery' && direccionSeleccionada) body.direccion_entrega_id = direccionSeleccionada
      if (tipo === 'retiro') body.sucursal_id = sucursalSeleccionada

      const { data } = await api.post('/api/delivery/pedido-centum', body)
      setResultado(data)
      setPaso(4) // Mostrar resultado
    } catch (err) {
      console.error('Error creando pedido:', err)
      setError(err.response?.data?.error || 'Error al crear pedido de venta')
    } finally {
      setEnviando(false)
    }
  }

  const volver = () => {
    setError(null)
    if (paso === 1) { setTipo(null); setPaso(0) }
    else if (paso === 2) { setPaso(1) }
    else if (paso === 3) { setPaso(2) }
  }

  const titulosPaso = ['Seleccionar cliente', 'Tipo de pedido', 'Detalles', 'Pedido creado']

  // Dirección seleccionada (para resumen)
  const dirObj = direcciones.find(d => d.id === direccionSeleccionada)
  const sucObj = sucursales.find(s => s.id === sucursalSeleccionada)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">
              {resultado ? 'Pedido creado' : titulosPaso[paso]}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {paso > 0 && paso < 4 && !resultado && (
            <button onClick={volver} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
              ← Volver
            </button>
          )}
          {/* Progress dots */}
          {!resultado && (
            <div className="flex gap-1.5 mt-2">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full ${i <= paso ? 'bg-amber-500' : 'bg-gray-200'}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* PASO 0: Buscar cliente */}
          {paso === 0 && (
            <>
              <input
                ref={inputRef}
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre, CUIT o código..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
              />
              {buscando && (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                </div>
              )}
              {!buscando && clientes.length > 0 && (
                <div className="space-y-1">
                  {clientes.map(c => (
                    <button
                      key={c.id}
                      onClick={() => seleccionarCliente(c)}
                      className="w-full text-left p-3 rounded-lg border border-gray-100 hover:border-amber-300 hover:bg-amber-50/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-800 truncate">{c.razon_social}</span>
                        {!c.id_centum && (
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Sin Centum</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {c.cuit && <span>{c.cuit}</span>}
                        {c.direccion && <span> · {c.direccion}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!buscando && busqueda.trim().length >= 2 && clientes.length === 0 && (
                <div className="text-center py-4 space-y-3">
                  <p className="text-sm text-gray-400">No se encontraron clientes</p>
                  <button
                    onClick={() => setMostrarCrearCliente(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    <span className="text-sm font-medium">Crear nuevo cliente</span>
                  </button>
                </div>
              )}
            </>
          )}

          {/* PASO 1: Tipo de pedido */}
          {paso === 1 && (
            <>
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <span className="text-gray-500">Cliente:</span>{' '}
                <span className="font-medium text-gray-800">{clienteSeleccionado?.razon_social}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <button
                  onClick={() => seleccionarTipo('delivery')}
                  className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                >
                  <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Delivery</span>
                </button>
                <button
                  onClick={() => seleccionarTipo('retiro')}
                  className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                >
                  <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0V7.875C3 6.839 3.839 6 4.875 6h14.25C20.16 6 21 6.839 21 7.875v1.474" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Retiro por Sucursal</span>
                </button>
              </div>
            </>
          )}

          {/* PASO 2: Detalles (fecha + dirección/sucursal) */}
          {paso === 2 && (
            <>
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div>
                  <span className="text-gray-500">Cliente:</span>{' '}
                  <span className="font-medium text-gray-800">{clienteSeleccionado?.razon_social}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tipo:</span>{' '}
                  <span className="font-medium text-gray-800">{tipo === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                </div>
              </div>

              {cargandoDetalles ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600" />
                </div>
              ) : (
                <>
                  {/* Fecha de entrega */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha de {tipo === 'delivery' ? 'entrega' : 'retiro'}
                    </label>
                    <input
                      type="date"
                      value={fechaEntrega}
                      onChange={e => setFechaEntrega(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* Delivery: seleccionar dirección */}
                  {tipo === 'delivery' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de entrega</label>
                      {direcciones.length === 0 && !mostrarNuevaDir && (
                        <p className="text-sm text-gray-400 py-2">Este cliente no tiene direcciones de entrega cargadas.</p>
                      )}
                      {direcciones.length > 0 && (
                        <div className="space-y-1">
                          {direcciones.map(d => (
                            <button
                              key={d.id}
                              onClick={() => { setDireccionSeleccionada(d.id); setMostrarNuevaDir(false) }}
                              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                                direccionSeleccionada === d.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-sm text-gray-800">{d.direccion}</span>
                              {d.localidad && <span className="text-xs text-gray-400 ml-1">({d.localidad})</span>}
                              {d.es_principal && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-2">Principal</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Nueva dirección */}
                      {mostrarNuevaDir ? (
                        <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                          <input
                            type="text"
                            value={nuevaDir.direccion}
                            onChange={e => setNuevaDir(prev => ({ ...prev, direccion: e.target.value }))}
                            placeholder="Dirección *"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={nuevaDir.localidad}
                            onChange={e => setNuevaDir(prev => ({ ...prev, localidad: e.target.value }))}
                            placeholder="Localidad"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setMostrarNuevaDir(false); setNuevaDir({ direccion: '', localidad: '' }) }}
                              className="flex-1 text-sm py-2 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={guardarNuevaDireccion}
                              disabled={guardandoDir}
                              className="flex-1 text-sm py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                            >
                              {guardandoDir ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMostrarNuevaDir(true); setDireccionSeleccionada(null) }}
                          className="w-full mt-2 flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          <span className="text-sm font-medium">Nueva dirección</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Retiro: seleccionar sucursal */}
                  {tipo === 'retiro' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal de retiro</label>
                      <div className="space-y-1">
                        {sucursales.map(s => (
                          <button
                            key={s.id}
                            onClick={() => setSucursalSeleccionada(s.id)}
                            className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                              sucursalSeleccionada === s.id
                                ? 'border-amber-400 bg-amber-50'
                                : 'border-gray-100 hover:border-gray-300'
                            }`}
                          >
                            <span className="text-sm font-medium text-gray-800">{s.nombre}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Botón continuar */}
                  <button
                    onClick={irAConfirmar}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors mt-2"
                  >
                    Continuar
                  </button>
                </>
              )}
            </>
          )}

          {/* PASO 3: Confirmar */}
          {paso === 3 && !resultado && (
            <>
              <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
                <div>
                  <span className="text-gray-500">Cliente:</span>{' '}
                  <span className="font-medium text-gray-800">{clienteSeleccionado?.razon_social}</span>
                </div>
                <div>
                  <span className="text-gray-500">Tipo:</span>{' '}
                  <span className="font-medium text-gray-800">{tipo === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Fecha:</span>{' '}
                  <span className="font-medium text-gray-800">
                    {new Date(fechaEntrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                </div>
                {tipo === 'delivery' && dirObj && (
                  <div>
                    <span className="text-gray-500">Dirección:</span>{' '}
                    <span className="font-medium text-gray-800">
                      {dirObj.direccion}{dirObj.localidad ? `, ${dirObj.localidad}` : ''}
                    </span>
                  </div>
                )}
                {tipo === 'retiro' && sucObj && (
                  <div>
                    <span className="text-gray-500">Sucursal:</span>{' '}
                    <span className="font-medium text-gray-800">{sucObj.nombre}</span>
                  </div>
                )}
                <div className="pt-1 border-t border-gray-200 mt-2">
                  <span className="text-gray-500">Artículo:</span>{' '}
                  <span className="font-medium text-gray-800">08136 - PEDIDO APP PADANO GESTION</span>
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  onClick={volver}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  Volver
                </button>
                <button
                  onClick={confirmarPedido}
                  disabled={enviando}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {enviando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {enviando ? 'Creando...' : 'Crear Pedido'}
                </button>
              </div>
            </>
          )}

          {/* PASO 4: Resultado */}
          {resultado && (
            <>
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-800">{resultado.mensaje}</p>
                {resultado.pedido?.numero_documento && (
                  <p className="text-lg font-bold text-amber-600 mt-2">{resultado.pedido.numero_documento}</p>
                )}
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div>
                  <span className="text-gray-500">Cliente:</span>{' '}
                  <span className="font-medium text-gray-800">{resultado.pedido?.clientes?.razon_social || clienteSeleccionado?.razon_social}</span>
                </div>
                <div>
                  <span className="text-gray-500">Fecha entrega:</span>{' '}
                  <span className="font-medium text-gray-800">
                    {new Date(fechaEntrega + 'T12:00:00').toLocaleDateString('es-AR')}
                  </span>
                </div>
              </div>

              <button
                onClick={() => { onCreado?.(); onClose() }}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors mt-2"
              >
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modal crear cliente (se superpone, pre-carga búsqueda) */}
      {mostrarCrearCliente && (
        <NuevoClienteModal
          onClose={() => setMostrarCrearCliente(false)}
          onCreado={onClienteCreado}
          cuitInicial={busqueda.trim()}
        />
      )}
    </div>
  )
}

export default ModalNuevoPedido
