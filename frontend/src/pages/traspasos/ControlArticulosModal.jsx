import React, { useState, useEffect, useRef, useMemo } from 'react'
import api from '../../services/api'

const parsearBarcodeBalanza = (barcode) => {
  const code = barcode.replace(/[^0-9]/g, '')
  if (code.length === 13 && code.startsWith('20')) {
    const plu = code.substring(2, 7)
    const pesoGramos = parseInt(code.substring(7, 12), 10)
    const pesoKg = pesoGramos / 1000
    if (pesoKg > 0) return { plu, pesoKg }
  }
  if (code.length === 14 && code.startsWith('020')) {
    const plu = code.substring(3, 8)
    const pesoGramos = parseInt(code.substring(8, 13), 10)
    const pesoKg = pesoGramos / 1000
    if (pesoKg > 0) return { plu, pesoKg }
  }
  return null
}

const ControlArticulosModal = ({ canasto, orden, onClose, onRequiereControl }) => {
  const [fase, setFase] = useState('scanning')
  const [catalogo, setCatalogo] = useState([])
  const [itemsRecibidos, setItemsRecibidos] = useState(new Map())
  const [scanInput, setScanInput] = useState('')
  const [pesoManual, setPesoManual] = useState(null)
  const [pesoManualInput, setPesoManualInput] = useState('')
  const [piezasManualInput, setPiezasManualInput] = useState('1')
  const [enviando, setEnviando] = useState(false)
  const [feedbackScan, setFeedbackScan] = useState(null)
  const [fotos, setFotos] = useState([])
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [tecladoVisible, setTecladoVisible] = useState(false)
  const scanBufferRef = useRef('')
  const scanTimeoutRef = useRef(null)
  const scanRef = useRef(null)
  const inputManualRef = useRef(null)
  const fotoInputRef = useRef(null)

  // Cargar items del canasto + catálogo completo de artículos
  useEffect(() => {
    const cargar = async () => {
      try {
        // Items consolidados del canasto (incluye hijos si es pallet)
        const rItems = await api.get(`/api/traspasos/canastos/${canasto.id}/items-control`)
        setItems(rItems.data?.items || [])

        // Catálogo completo de artículos (mismo que usa el POS)
        const rArt = await api.get('/api/pos/articulos')
        const arts = (rArt.data?.articulos || rArt.data || []).map(a => ({
          id: String(a.id || a.id_centum),
          codigo: a.codigo || '',
          nombre: a.nombre || '',
          esPesable: a.esPesable || a.es_pesable || false,
          codigosBarras: a.codigosBarras || a.codigos_barras || [],
        }))
        setCatalogo(arts)
      } catch (err) {
        console.error('[ControlArticulos] Error cargando:', err)
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  // === Procesar código escaneado ===
  const procesarCodigoScan = (codigo) => {
    if (!codigo) return
    setFeedbackScan(null)

    const resultado = buscarArticuloEnCatalogo(codigo)

    if (!resultado) {
      setFeedbackScan({ tipo: 'error', mensaje: `Código "${codigo}" no encontrado` })
      setTimeout(() => scanRef.current?.focus(), 300)
      return
    }

    const { articulo, peso, balanza, factor } = resultado
    const cant = factor || 1

    if (articulo.esPesable && !balanza) {
      setPesoManual({ articulo_id: String(articulo.id), nombre: articulo.nombre })
      return
    }

    if (peso) {
      agregarRecibido(String(articulo.id), peso, [peso])
      setFeedbackScan({ tipo: 'ok', mensaje: `${articulo.nombre} +${peso.toFixed(3)}kg` })
    } else {
      agregarRecibido(String(articulo.id), cant, null)
      setFeedbackScan({ tipo: 'ok', mensaje: `${articulo.nombre} +${cant}` })
    }
    setTimeout(() => scanRef.current?.focus(), 300)
  }

  // === Global keydown listener ===
  useEffect(() => {
    if (tecladoVisible || pesoManual || enviando || fase !== 'scanning') return
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Enter') {
        e.preventDefault()
        const codigo = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        setScanInput('')
        if (codigo) procesarCodigoScan(codigo)
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        scanBufferRef.current += e.key
        setScanInput(scanBufferRef.current)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tecladoVisible, pesoManual, enviando, fase, catalogo])

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
      procesarCodigoScan(codigo)
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
      procesarCodigoScan(codigo)
    }
  }

  // === Auto-focus ===
  useEffect(() => {
    if (tecladoVisible || pesoManual || fase !== 'scanning') return
    const t = setTimeout(() => scanRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [tecladoVisible, fase, pesoManual, feedbackScan])

  // Mapa de catálogo para búsquedas rápidas
  const catalogoMap = useMemo(() => {
    const map = {}
    for (const a of catalogo) {
      map[String(a.id)] = a
      if (a.codigo) map['cod:' + a.codigo] = a
      if (a.codigosBarras) {
        for (const cb of a.codigosBarras) {
          map['cb:' + cb] = a
        }
      }
    }
    return map
  }, [catalogo])

  // Items esperados enriquecidos
  const itemsEsperados = useMemo(() => {
    return items.map(item => {
      const cat = catalogoMap[String(item.articulo_id)]
      return {
        ...item,
        nombre: cat?.nombre || item.nombre || item.codigo || item.articulo_id,
        esPesable: cat?.esPesable || false,
        codigo_cat: cat?.codigo || item.codigo || '',
        codigosBarras: cat?.codigosBarras || [],
      }
    })
  }, [items, catalogoMap])

  // Buscar artículo en catálogo (modo ciego — no distingue esperado/extra en scan)
  const buscarArticuloEnCatalogo = (codigo) => {
    const balanza = parsearBarcodeBalanza(codigo)
    if (balanza) {
      const normPlu = balanza.plu.replace(/^0+/, '')
      for (const a of catalogo) {
        const normCod = (a.codigo || '').replace(/^0+/, '')
        if (normCod === normPlu) {
          return { articulo: a, peso: balanza.pesoKg, balanza: true }
        }
      }
      return null
    }

    // Búsqueda directa por código, id, o codigos_barras
    for (const a of catalogo) {
      if (String(a.id) === codigo || a.codigo === codigo) {
        return { articulo: a, peso: null, balanza: false }
      }
      if (a.codigosBarras) {
        const match = a.codigosBarras.find(b =>
          typeof b === 'object' ? b.codigo === codigo : b === codigo
        )
        if (match) {
          return { articulo: a, peso: null, balanza: false, factor: typeof match === 'object' ? (match.factor || 1) : 1 }
        }
      }
    }

    return null
  }

  const agregarRecibido = (articuloId, cantidad, pesos) => {
    setItemsRecibidos(prev => {
      const next = new Map(prev)
      const existing = next.get(articuloId) || { cantidad_recibida: 0, pesos_escaneados_destino: [] }
      next.set(articuloId, {
        cantidad_recibida: existing.cantidad_recibida + cantidad,
        pesos_escaneados_destino: pesos
          ? [...existing.pesos_escaneados_destino, ...pesos]
          : existing.pesos_escaneados_destino,
      })
      return next
    })
  }


  const confirmarPesoManual = () => {
    const peso = parseFloat(pesoManualInput)
    const piezas = parseInt(piezasManualInput) || 1
    if (isNaN(peso) || peso <= 0) return
    agregarRecibido(pesoManual.articulo_id, peso * piezas, Array(piezas).fill(peso))
    setFeedbackScan({ tipo: 'ok', mensaje: `${pesoManual.nombre} +${(peso * piezas).toFixed(3)}kg (${piezas} pza)` })
    setPesoManual(null)
    setPesoManualInput('')
    setPiezasManualInput('1')
  }

  const comprimirImagen = (file, maxWidth = 1200, quality = 0.7) => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let w = img.width, h = img.height
        if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth }
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = URL.createObjectURL(file)
    })
  }

  const handleFoto = async (e) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      const data = await comprimirImagen(file)
      setFotos(prev => [...prev, { data, name: file.name, ts: Date.now() }])
    }
    if (fotoInputRef.current) fotoInputRef.current.value = ''
  }

  const eliminarFoto = (ts) => setFotos(prev => prev.filter(f => f.ts !== ts))

  const finalizarControl = () => confirmarControl()

  // Construir datos de comparación
  const comparacion = useMemo(() => {
    const filas = []
    const recibidosUsados = new Set()

    // Items esperados (preparados)
    for (const item of itemsEsperados) {
      const recibido = itemsRecibidos.get(item.articulo_id)
      const cantPreparada = item.esPesable
        ? (item.pesos_escaneados || []).reduce((s, p) => s + p, 0) || item.cantidad
        : item.cantidad
      const cantRecibida = recibido?.cantidad_recibida || 0
      recibidosUsados.add(item.articulo_id)

      let estado = 'ok'
      if (cantRecibida === 0) estado = 'faltante'
      else if (item.esPesable) {
        const tol = Math.max(cantPreparada * 0.02, 0.05)
        if (Math.abs(cantRecibida - cantPreparada) > tol) estado = 'diferencia'
      } else if (cantRecibida !== cantPreparada) {
        estado = 'diferencia'
      }

      filas.push({
        articulo_id: item.articulo_id,
        nombre: item.nombre,
        esPesable: item.esPesable,
        preparado: cantPreparada,
        recibido: cantRecibida,
        estado,
        es_extra: false,
      })
    }

    // Extras: artículos escaneados que no estaban en los esperados
    for (const [artId, data] of itemsRecibidos.entries()) {
      if (recibidosUsados.has(artId)) continue
      const cat = catalogo.find(a => String(a.id) === String(artId))
      filas.push({
        articulo_id: artId,
        nombre: cat?.nombre || artId,
        esPesable: cat?.esPesable || false,
        preparado: 0,
        recibido: data.cantidad_recibida,
        estado: 'extra',
        es_extra: true,
      })
    }

    return filas
  }, [itemsEsperados, itemsRecibidos, catalogo])

  const confirmarControl = async () => {
    setEnviando(true)
    try {
      const itemsPayload = comparacion.map(f => ({
        articulo_id: f.articulo_id,
        cantidad_recibida: f.recibido,
        pesos_escaneados_destino: itemsRecibidos.get(f.articulo_id)?.pesos_escaneados_destino || [],
        es_extra: f.es_extra,
      }))

      const r = await api.put(`/api/traspasos/canastos/${canasto.id}/control-articulos`, {
        items_recibidos: itemsPayload,
        fotos: fotos.map(f => ({ data: f.data, name: f.name })),
      })

      onClose?.(r.data)
    } catch (err) {
      setFeedbackScan({ tipo: 'error', mensaje: err.response?.data?.error || 'Error al guardar control' })
    } finally {
      setEnviando(false)
    }
  }

  const estadoColor = {
    ok: 'bg-green-50 text-green-700',
    diferencia: 'bg-red-50 text-red-700',
    faltante: 'bg-red-50 text-red-700',
    extra: 'bg-amber-50 text-amber-700',
  }

  const estadoLabel = {
    ok: 'OK',
    diferencia: 'Diferencia',
    faltante: 'Faltante',
    extra: 'Extra',
  }

  // Lista de artículos escaneados para mostrar en modo ciego
  const articulosEscaneados = useMemo(() => {
    const lista = []
    for (const [artId, data] of itemsRecibidos.entries()) {
      const cat = catalogo.find(a => String(a.id) === String(artId))
      const itemOrig = itemsEsperados.find(i => i.articulo_id === artId)
      lista.push({
        articulo_id: artId,
        nombre: cat?.nombre || itemOrig?.nombre || artId,
        esPesable: cat?.esPesable || itemOrig?.esPesable || false,
        cantidad_recibida: data.cantidad_recibida,
      })
    }
    return lista
  }, [itemsRecibidos, catalogo, itemsEsperados])

  const totalEscaneados = articulosEscaneados.length

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex flex-col">
      <div className="bg-white flex flex-col h-full">
        {/* Header */}
        <div className="bg-teal-600 text-white px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-lg">Control de artículos</h2>
            <p className="text-teal-100 text-xs">
              {canasto.precinto || canasto.numero_pallet || `#${canasto.id?.slice(0, 8)}`}
              {orden?.numero ? ` — Orden ${orden.numero}` : ''}
            </p>
          </div>
          <button
            onClick={() => onClose?.(null)}
            className="text-teal-200 hover:text-white p-1"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {fase === 'scanning' && cargando && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">Cargando artículos...</p>
          </div>
        )}

        {fase === 'scanning' && !cargando && (
          <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
            {/* Scanner input */}
            <div className="flex gap-2">
              {!tecladoVisible ? (
                <input
                  ref={scanRef}
                  type="text"
                  inputMode="none"
                  value={scanInput}
                  onChange={handleScanChange}
                  onKeyDown={handleScanKeyDown}
                  placeholder="Escanear artículo..."
                  autoComplete="off"
                  className="flex-1 border-2 border-teal-300 rounded-xl px-4 py-3 text-base text-center outline-none caret-transparent"
                  autoFocus
                  disabled={!!pesoManual || enviando}
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
                      procesarCodigoScan(codigo)
                      setTecladoVisible(false)
                    }
                  }}
                  onBlur={() => { if (!scanInput) setTecladoVisible(false) }}
                  placeholder="Escribir código..."
                  autoComplete="off"
                  autoFocus
                  className="flex-1 border-2 border-teal-300 rounded-xl px-4 py-3 text-base text-center outline-none"
                  disabled={!!pesoManual || enviando}
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

            {/* Feedback */}
            {feedbackScan && (
              <div className={`text-sm px-3 py-2 rounded-lg font-medium ${
                feedbackScan.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' :
                feedbackScan.tipo === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {feedbackScan.mensaje}
              </div>
            )}

            {/* Progreso ciego — solo muestra cantidad escaneada */}
            <div className="text-xs text-gray-500 font-medium">
              Artículos escaneados: {totalEscaneados}
            </div>

            {/* Lista de lo escaneado (sin revelar esperados) */}
            {totalEscaneados > 0 && (
              <div className="space-y-1.5">
                {articulosEscaneados.map(art => (
                  <div
                    key={art.articulo_id}
                    className="rounded-lg px-3 py-2 text-sm border bg-gray-50 border-gray-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-gray-800 text-sm">{art.nombre}</span>
                        {art.esPesable && <span className="text-xs text-gray-400 ml-1">(pesable)</span>}
                      </div>
                      <span className="text-sm font-mono font-bold text-teal-600 ml-2 shrink-0">
                        {art.esPesable ? art.cantidad_recibida.toFixed(3) + ' kg' : art.cantidad_recibida}
                      </span>
                    </div>
                  </div>
                ))}

              </div>
            )}

            {totalEscaneados === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-gray-400">Escaneá los artículos que llegaron en este canasto</p>
              </div>
            )}

            {/* Fotos */}
            <div>
              <input
                ref={fotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handleFoto}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fotoInputRef.current?.click()}
                className="flex items-center gap-2 text-sm text-teal-600 font-medium hover:text-teal-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
                Adjuntar foto
              </button>
              {fotos.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto">
                  {fotos.map(f => (
                    <div key={f.ts} className="relative shrink-0">
                      <img src={f.data} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                      <button
                        onClick={() => eliminarFoto(f.ts)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Botón finalizar */}
            <button
              onClick={finalizarControl}
              disabled={enviando}
              className="w-full py-3 bg-teal-600 text-white rounded-xl font-medium hover:bg-teal-700 transition-colors text-sm disabled:opacity-50"
            >
              {enviando ? 'Guardando...' : 'Finalizar control'}
            </button>
          </div>
        )}

        {/* Modal peso manual */}
        {pesoManual && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-gray-800">Peso manual</h3>
              <p className="text-sm text-gray-600">{pesoManual.nombre}</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Peso (kg)</label>
                  <input
                    type="number"
                    value={pesoManualInput}
                    onChange={e => setPesoManualInput(e.target.value)}
                    placeholder="0.000"
                    step="0.001"
                    min="0"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none mt-1"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Piezas</label>
                  <input
                    type="number"
                    value={piezasManualInput}
                    onChange={e => setPiezasManualInput(e.target.value)}
                    min="1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 outline-none mt-1"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setPesoManual(null); setPesoManualInput(''); setPiezasManualInput('1') }}
                  className="flex-1 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarPesoManual}
                  disabled={!pesoManualInput || parseFloat(pesoManualInput) <= 0}
                  className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ControlArticulosModal
