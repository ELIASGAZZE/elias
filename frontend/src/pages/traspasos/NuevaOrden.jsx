// Crear nueva orden de traspaso — picker rápido estilo POS
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const NuevaOrden = () => {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const dropdownRef = useRef(null)
  const itemRefs = useRef([])

  const [sucursales, setSucursales] = useState([])
  const [sucursalOrigenId, setSucursalOrigenId] = useState('')
  const [sucursalDestinoId, setSucursalDestinoId] = useState('')
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState([])
  const [guardando, setGuardando] = useState(false)

  // Búsqueda estilo POS
  const [todosArticulos, setTodosArticulos] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [selIdx, setSelIdx] = useState(-1)
  const [cargandoArticulos, setCargandoArticulos] = useState(true)
  const [stockOrigen, setStockOrigen] = useState({})

  // Popup de cantidad
  const [popupArticulo, setPopupArticulo] = useState(null)
  const [popupCantidad, setPopupCantidad] = useState('')
  const [popupModo, setPopupModo] = useState('kg') // 'kg' | 'uds'
  const popupInputRef = useRef(null)
  const popupToggleRef = useRef(null)
  const fileInputRef = useRef(null)
  const [importResult, setImportResult] = useState(null) // { agregados, noEncontrados }

  // Modal de pedidos pendientes
  const [showPedidos, setShowPedidos] = useState(false)
  const [pedidosPendientes, setPedidosPendientes] = useState([])
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [importandoPedido, setImportandoPedido] = useState(null)

  // Cargar sucursales inmediatamente, artículos en paralelo sin bloquear
  useEffect(() => {
    api.get('/api/sucursales')
      .then(r => setSucursales(r.data || []))
      .catch(err => console.error('Error loading sucursales:', err.message))

    api.get('/api/pos/articulos')
      .then(r => {
        const arts = r.data?.articulos || r.data || []
        setTodosArticulos(arts)
      })
      .catch(err => console.error(err))
      .finally(() => setCargandoArticulos(false))
  }, [])

  // Cargar stock cuando cambia la sucursal de origen
  useEffect(() => {
    if (!sucursalOrigenId) { setStockOrigen({}); return }
    api.get(`/api/traspasos/stock/${sucursalOrigenId}`)
      .then(r => setStockOrigen(r.data || {}))
      .catch(() => setStockOrigen({}))
  }, [sucursalOrigenId])

  // Auto-focus en el input de búsqueda
  useEffect(() => {
    if (!cargandoArticulos) inputRef.current?.focus()
  }, [cargandoArticulos])

  // Filtrado instantáneo en memoria (multi-keyword como POS)
  const filtrados = busqueda.length >= 1
    ? (() => {
        const keywords = busqueda.toLowerCase().split(/\s+/).filter(Boolean)
        return todosArticulos.filter(a => {
          const hay = `${a.codigo || ''} ${a.nombre || ''} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
          return keywords.every(kw => hay.includes(kw))
        }).slice(0, 30)
      })()
    : []

  // Scroll al item seleccionado en el dropdown
  useEffect(() => {
    if (selIdx >= 0 && itemRefs.current[selIdx]) {
      itemRefs.current[selIdx].scrollIntoView({ block: 'nearest' })
    }
  }, [selIdx])

  const abrirPopup = useCallback((articulo) => {
    const esPesable = articulo.esPesable || articulo.es_pesable || false
    // Calcular factor de caja desde codigosBarras
    const barcodes = articulo.codigosBarras || articulo.codigos_barras || []
    const factorCaja = barcodes.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
    const hasPeso = esPesable && (articulo.pesoPromedioPieza || articulo.peso_promedio_pieza)
    setPopupArticulo({ ...articulo, esPesable, factorCaja })
    setPopupCantidad(esPesable ? '' : '1')
    setPopupModo(esPesable ? (hasPeso ? 'uds' : 'kg') : 'uds')
    setBusqueda('')
    setSelIdx(-1)
    const hasToggle = esPesable || (!esPesable && factorCaja > 1)
    setTimeout(() => {
      if (hasToggle && popupToggleRef.current) {
        popupToggleRef.current.focus()
      } else if (popupInputRef.current) {
        popupInputRef.current.focus()
      }
    }, 50)
  }, [])

  const confirmarPopup = useCallback(() => {
    if (!popupArticulo) return
    const cant = parseFloat(popupCantidad)
    if (!cant || cant <= 0) return

    const artId = String(popupArticulo.id || popupArticulo.articulo_id)
    const esPesable = popupArticulo.esPesable
    const ppp = popupArticulo.pesoPromedioPieza

    // Calcular cantidad final
    let cantidadFinal = cant
    if (esPesable && popupModo === 'uds' && ppp) {
      cantidadFinal = Math.round(cant * ppp * 1000) / 1000
    } else if (!esPesable && popupModo === 'cajas' && popupArticulo.factorCaja > 1) {
      cantidadFinal = Math.round(cant) * popupArticulo.factorCaja
    } else if (!esPesable) {
      cantidadFinal = Math.round(cant)
    }

    setItems(prev => {
      const existente = prev.findIndex(i => i.articulo_id === artId)
      if (existente >= 0) {
        const nuevos = [...prev]
        nuevos[existente] = {
          ...nuevos[existente],
          cantidad_solicitada: nuevos[existente].cantidad_solicitada + cantidadFinal,
        }
        return nuevos
      }
      return [...prev, {
        articulo_id: artId,
        codigo: popupArticulo.codigo,
        nombre: popupArticulo.nombre,
        cantidad_solicitada: cantidadFinal,
        cantidad_preparada: 0,
        es_pesable: esPesable,
        peso_promedio_pieza: ppp || null,
      }]
    })
    setPopupArticulo(null)
    setPopupCantidad('')
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [popupArticulo, popupCantidad, popupModo])

  // Abrir modal de pedidos pendientes
  const abrirPedidos = useCallback(async () => {
    setShowPedidos(true)
    setCargandoPedidos(true)
    try {
      const r = await api.get('/api/pedidos', { params: { estado: 'pendiente', limit: 50 } })
      setPedidosPendientes(r.data?.pedidos || [])
    } catch (err) {
      console.error('Error cargando pedidos:', err)
      setPedidosPendientes([])
    }
    setCargandoPedidos(false)
  }, [])

  // Importar items de un pedido interno
  const importarPedido = useCallback((pedido) => {
    if (!pedido.items_pedido?.length) return
    setImportandoPedido(pedido.id)

    let agregados = 0
    const noEncontrados = []

    for (const item of pedido.items_pedido) {
      const artPedido = item.articulos
      if (!artPedido?.codigo) continue

      // Buscar en artículos cargados
      const art = todosArticulos.find(a => a.codigo === artPedido.codigo)
      if (!art) {
        noEncontrados.push(artPedido.codigo)
        continue
      }

      const artId = String(art.id || art.articulo_id)
      const esPesable = art.esPesable || art.es_pesable || false
      const cantidad = item.cantidad

      setItems(prev => {
        const existente = prev.findIndex(i => i.articulo_id === artId)
        if (existente >= 0) {
          const nuevos = [...prev]
          nuevos[existente] = {
            ...nuevos[existente],
            cantidad_solicitada: nuevos[existente].cantidad_solicitada + cantidad,
          }
          return nuevos
        }
        return [...prev, {
          articulo_id: artId,
          codigo: art.codigo,
          nombre: art.nombre,
          cantidad_solicitada: cantidad,
          cantidad_preparada: 0,
          es_pesable: esPesable,
          peso_promedio_pieza: art.pesoPromedioPieza || art.peso_promedio_pieza || null,
          modo: esPesable ? 'pzas' : 'uds',
        }]
      })
      agregados++
    }

    setShowPedidos(false)
    setImportandoPedido(null)
    setImportResult({ agregados, noEncontrados })
    setTimeout(() => setImportResult(null), 8000)
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [todosArticulos])

  // Importar TXT de pedido interno
  const importarTxt = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // reset para poder reimportar mismo archivo

    const reader = new FileReader()
    reader.onload = (ev) => {
      const texto = ev.target.result
      const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean)
      let agregados = 0
      const noEncontrados = []

      for (const linea of lineas) {
        const partes = linea.split('\t')
        if (partes.length < 2) continue
        const codigo = partes[0].trim()
        const cantidad = parseFloat(partes[1].trim())
        if (!codigo || !cantidad || cantidad <= 0) continue

        // Buscar artículo por código en la lista cargada
        const art = todosArticulos.find(a => a.codigo === codigo)
        if (!art) {
          noEncontrados.push(codigo)
          continue
        }

        const artId = String(art.id || art.articulo_id)
        const esPesable = art.esPesable || art.es_pesable || false

        setItems(prev => {
          const existente = prev.findIndex(i => i.articulo_id === artId)
          if (existente >= 0) {
            const nuevos = [...prev]
            nuevos[existente] = {
              ...nuevos[existente],
              cantidad_solicitada: nuevos[existente].cantidad_solicitada + cantidad,
            }
            return nuevos
          }
          return [...prev, {
            articulo_id: artId,
            codigo: art.codigo,
            nombre: art.nombre,
            cantidad_solicitada: cantidad,
            cantidad_preparada: 0,
            es_pesable: esPesable,
            peso_promedio_pieza: art.pesoPromedioPieza || art.peso_promedio_pieza || null,
          }]
        })
        agregados++
      }

      setImportResult({ agregados, noEncontrados })
      setTimeout(() => setImportResult(null), 8000)
    }
    reader.readAsText(file)
  }, [todosArticulos])

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelIdx(prev => (prev + 1) % Math.max(filtrados.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelIdx(prev => prev <= 0 ? filtrados.length - 1 : prev - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selIdx >= 0 && filtrados[selIdx]) {
        abrirPopup(filtrados[selIdx])
      } else if (filtrados.length === 1) {
        abrirPopup(filtrados[0])
      } else if (busqueda.length >= 4 && /^\d+$/.test(busqueda)) {
        // Búsqueda por código exacto (barcode)
        const porCodigo = todosArticulos.find(a =>
          a.codigo === busqueda ||
          (a.codigosBarras && a.codigosBarras.some(b => (typeof b === 'object' ? b.codigo : b) === busqueda))
        )
        if (porCodigo) {
          abrirPopup(porCodigo)
        }
      }
    } else if (e.key === 'Escape') {
      setBusqueda('')
      setSelIdx(-1)
    }
  }

  const actualizarCantidad = (idx, cant) => {
    const nuevos = [...items]
    nuevos[idx].cantidad_solicitada = parseFloat(cant) || 0
    setItems(nuevos)
  }

  const quitarItem = (idx) => {
    setItems(items.filter((_, i) => i !== idx))
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  const guardar = async () => {
    if (!sucursalOrigenId || !sucursalDestinoId) return alert('Seleccioná origen y destino')
    if (sucursalOrigenId === sucursalDestinoId) return alert('Origen y destino deben ser diferentes')
    if (items.length === 0) return alert('Agregá al menos un artículo')

    setGuardando(true)
    try {
      // Convertir items a unidad base antes de guardar
      const itemsBase = items.map(item => {
        const copia = { ...item }
        if (item.modo === 'pzas' && item.peso_promedio_pieza) {
          copia.cantidad_solicitada = Math.round(item.cantidad_solicitada * item.peso_promedio_pieza * 1000) / 1000
        } else if (item.modo === 'cajas') {
          const art = todosArticulos.find(a => String(a.id) === item.articulo_id)
          const fc = art?.codigosBarras?.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
          if (fc > 1) copia.cantidad_solicitada = Math.round(item.cantidad_solicitada * fc)
        }
        delete copia.modo
        return copia
      })
      const r = await api.post('/api/traspasos/ordenes', {
        sucursal_origen_id: sucursalOrigenId,
        sucursal_destino_id: sucursalDestinoId,
        items: itemsBase,
        notas,
      })
      navigate(`/traspasos/ordenes/${r.data.id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al crear orden')
    }
    setGuardando(false)
  }

  // Toggle modo inline (kg↔pzas para pesables, uds↔cajas para unitarios)
  const toggleModoItem = (idx) => {
    setItems(prev => {
      const nuevos = [...prev]
      const item = { ...nuevos[idx] }
      if (item.es_pesable) {
        const ppp = item.peso_promedio_pieza
        if (item.modo === 'pzas') {
          // pzas → kg
          if (ppp) item.cantidad_solicitada = Math.round(item.cantidad_solicitada * ppp * 1000) / 1000
          item.modo = 'kg'
        } else {
          // kg → pzas
          if (ppp) item.cantidad_solicitada = Math.round(item.cantidad_solicitada / ppp)
          item.modo = 'pzas'
        }
      } else {
        const art = todosArticulos.find(a => String(a.id) === item.articulo_id)
        const fc = art?.codigosBarras?.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
        if (fc <= 1) return prev // sin factor de caja
        if (item.modo === 'cajas') {
          // cajas → uds
          item.cantidad_solicitada = Math.round(item.cantidad_solicitada * fc)
          item.modo = 'uds'
        } else {
          // uds → cajas (redondeo a 1 decimal)
          item.cantidad_solicitada = Math.round(item.cantidad_solicitada / fc * 10) / 10
          item.modo = 'cajas'
        }
      }
      nuevos[idx] = item
      return nuevos
    })
  }

  // Cantidad en carrito por artículo (para badge)
  const cantEnCarrito = {}
  for (const it of items) cantEnCarrito[it.articulo_id] = it.cantidad_solicitada

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Nueva Orden de Traspaso" sinTabs volverA="/traspasos/ordenes" />

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        {/* Sucursales + notas en una línea */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-gray-500 block mb-1">Origen</label>
            <select value={sucursalOrigenId} onChange={e => setSucursalOrigenId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Seleccionar...</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="text-gray-300 pb-2">→</div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-gray-500 block mb-1">Destino</label>
            <select value={sucursalDestinoId} onChange={e => setSucursalDestinoId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Seleccionar...</option>
              {sucursales.filter(s => s.id !== sucursalOrigenId).map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-gray-500 block mb-1">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              placeholder="Observaciones (opcional)..."
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            onChange={importarTxt}
            className="hidden"
          />
          <button
            onClick={abrirPedidos}
            disabled={cargandoArticulos}
            className="bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-sm"
          >
            Importar Pedido
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={cargandoArticulos}
            className="border border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 text-gray-600 px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-sm"
            title="Importar desde archivo TXT"
          >
            TXT
          </button>
          <button
            onClick={guardar}
            disabled={guardando || items.length === 0}
            className="bg-sky-600 hover:bg-sky-700 disabled:bg-gray-300 text-white px-5 py-2 rounded-lg font-medium transition-colors whitespace-nowrap text-sm"
          >
            {guardando ? 'Creando...' : `Crear OT (${items.length})`}
          </button>
        </div>

        {/* Resultado de importación TXT */}
        {importResult && (
          <div className={`rounded-xl border p-3 text-sm ${importResult.noEncontrados.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <div className="flex items-center justify-between">
              <span>
                {importResult.agregados > 0 && <span className="text-emerald-700 font-medium">{importResult.agregados} artículo{importResult.agregados !== 1 ? 's' : ''} importado{importResult.agregados !== 1 ? 's' : ''}</span>}
                {importResult.agregados > 0 && importResult.noEncontrados.length > 0 && <span className="text-gray-400 mx-1">·</span>}
                {importResult.noEncontrados.length > 0 && (
                  <span className="text-amber-700">{importResult.noEncontrados.length} código{importResult.noEncontrados.length !== 1 ? 's' : ''} no encontrado{importResult.noEncontrados.length !== 1 ? 's' : ''}: {importResult.noEncontrados.join(', ')}</span>
                )}
              </span>
              <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600 ml-2">&times;</button>
            </div>
          </div>
        )}

        {/* Buscador full width */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setSelIdx(-1) }}
            onKeyDown={handleKeyDown}
            placeholder={cargandoArticulos ? 'Cargando artículos...' : 'Buscar por nombre, código o escanear...'}
            disabled={cargandoArticulos}
            autoComplete="off"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none transition-colors bg-white shadow-sm"
          />
          {items.length > 0 && (
            <div className="absolute right-4 top-3 bg-sky-100 text-sky-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {items.length} art.
            </div>
          )}

          {/* Dropdown resultados */}
          {filtrados.length > 0 && (
            <div ref={dropdownRef} className="absolute z-10 w-full mt-1 border border-gray-200 rounded-xl shadow-lg max-h-72 overflow-y-auto bg-white">
              {filtrados.map((a, idx) => {
                const enCarrito = cantEnCarrito[String(a.id || a.articulo_id)]
                const stock = stockOrigen[a.id]
                return (
                  <button
                    key={a.id}
                    ref={el => itemRefs.current[idx] = el}
                    onClick={() => abrirPopup(a)}
                    className={`w-full text-left px-4 py-2 text-sm border-b border-gray-50 last:border-0 flex items-center gap-2 transition-colors ${
                      idx === selIdx ? 'bg-sky-50 border-l-2 border-l-sky-500' : 'hover:bg-gray-50'
                    }`}
                  >
                    {enCarrito && (
                      <span className="bg-sky-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                        {enCarrito}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800">{a.nombre}</span>
                      <span className="text-gray-400 ml-2 text-xs">{a.codigo}</span>
                      {a.rubro?.nombre && <span className="text-gray-300 ml-1 text-xs">· {a.rubro.nombre}</span>}
                    </div>
                    {stock !== undefined && (
                      <span className={`text-xs font-mono tabular-nums flex-shrink-0 min-w-[50px] text-right ${stock > 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                        {stock}{(a.esPesable || a.es_pesable) && a.pesoPromedioPieza && stock > 0
                          ? `kg (≈${Math.round(stock / a.pesoPromedioPieza)} pzas)`
                          : ''}
                      </span>
                    )}
                    {(a.esPesable || a.es_pesable) && <span className="text-amber-500 text-xs flex-shrink-0">pesable</span>}
                  </button>
                )
              })}
            </div>
          )}

          {busqueda.length >= 2 && filtrados.length === 0 && !cargandoArticulos && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl text-center text-gray-400 text-xs py-3">Sin resultados para "{busqueda}"</div>
          )}
        </div>

        <div className="text-xs text-gray-300 -mt-2 ml-1">
          ↑↓ navegar · Enter agregar · Esc limpiar
        </div>

        {/* Items agregados — tabla ancha debajo del buscador */}
        {items.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Artículos <span className="text-sky-600">({items.length})</span>
              </h3>
              <div className="flex items-center gap-3">
                {items.some(i => i.es_pesable) && (() => {
                  const todoPzas = items.filter(i => i.es_pesable).every(i => i.modo === 'pzas')
                  return (
                    <button
                      onClick={() => setItems(prev => prev.map(item => {
                        if (!item.es_pesable) return item
                        const actual = item.modo || 'kg'
                        const target = todoPzas ? 'kg' : 'pzas'
                        if (actual === target) return item
                        const ppp = item.peso_promedio_pieza
                        if (!ppp) return { ...item, modo: target }
                        if (target === 'pzas') {
                          return { ...item, modo: 'pzas', cantidad_solicitada: Math.round(item.cantidad_solicitada / ppp) }
                        } else {
                          return { ...item, modo: 'kg', cantidad_solicitada: Math.round(item.cantidad_solicitada * ppp * 1000) / 1000 }
                        }
                      }))}
                      className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                    >
                      {todoPzas ? 'Pesables → kg' : 'Pesables → pzas'}
                    </button>
                  )
                })()}
                <button onClick={() => { setItems([]); inputRef.current?.focus() }}
                  className="text-xs text-red-400 hover:text-red-600">Limpiar todo</button>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {items.map((item, idx) => {
                const modo = item.modo || (item.es_pesable ? 'kg' : 'uds')
                const art = todosArticulos.find(a => String(a.id) === item.articulo_id)
                const fc = art?.codigosBarras?.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
                const canToggle = item.es_pesable || fc > 1
                return (
                  <div key={item.articulo_id} className="flex items-center gap-3 px-4 py-2 group hover:bg-gray-50 transition-colors">
                    <div className="text-xs text-gray-300 w-5 text-center">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-800">{item.nombre}</span>
                      <span className="text-xs text-gray-400 ml-2">{item.codigo}</span>
                      {item.es_pesable && <span className="text-xs text-amber-500 ml-1">· pesable</span>}
                    </div>
                    <input
                      type="number"
                      min={modo === 'kg' ? '0.001' : '1'}
                      step={modo === 'kg' ? '0.1' : '1'}
                      value={item.cantidad_solicitada}
                      onChange={e => actualizarCantidad(idx, modo === 'kg' ? e.target.value : String(Math.max(1, Math.round(parseFloat(e.target.value) || 0))))}
                      onFocus={e => e.target.select()}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center font-mono focus:border-sky-400 outline-none"
                    />
                    {canToggle ? (
                      <button
                        onClick={() => toggleModoItem(idx)}
                        className="text-xs font-medium px-2 py-1 rounded-md border transition-colors min-w-[52px] text-center hover:bg-gray-100 border-gray-300 text-gray-600"
                        title={item.es_pesable ? 'Alternar kg / piezas' : 'Alternar uds / cajas'}
                      >
                        {modo === 'kg' ? 'kg' : modo === 'pzas' ? 'pzas' : modo === 'cajas' ? `cj x${fc}` : 'uds'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 min-w-[52px] text-center">{item.es_pesable ? 'kg' : 'uds'}</span>
                    )}
                    {/* Equivalencia */}
                    {item.es_pesable && item.peso_promedio_pieza && item.cantidad_solicitada > 0 && (
                      <span className="text-xs text-amber-600 w-20 text-right">
                        {modo === 'pzas'
                          ? `≈${Math.round(item.cantidad_solicitada * item.peso_promedio_pieza * 1000) / 1000} kg`
                          : `≈${Math.round(item.cantidad_solicitada / item.peso_promedio_pieza)} pzas`
                        }
                      </span>
                    )}
                    {!item.es_pesable && fc > 1 && item.cantidad_solicitada > 0 && (
                      <span className="text-xs text-sky-600 w-20 text-right">
                        {modo === 'cajas'
                          ? `= ${Math.round(item.cantidad_solicitada * fc)} uds`
                          : (() => {
                              const cajas = Math.floor(item.cantidad_solicitada / fc)
                              const sueltas = item.cantidad_solicitada % fc
                              return `${cajas > 0 ? `${cajas} cj` : ''}${cajas > 0 && sueltas > 0 ? ` + ${sueltas}` : sueltas > 0 ? `${sueltas} uds` : ''}`
                            })()
                        }
                      </span>
                    )}
                    <button onClick={() => quitarItem(idx)}
                      className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal pedidos pendientes */}
      {showPedidos && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowPedidos(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Pedidos internos pendientes</h3>
              <button onClick={() => setShowPedidos(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {cargandoPedidos ? (
                <div className="p-8 text-center text-gray-400 text-sm">Cargando pedidos...</div>
              ) : pedidosPendientes.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No hay pedidos pendientes</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {pedidosPendientes.map(p => {
                    const itemsErp = (p.items_pedido || []).filter(i => i.articulos?.codigo)
                    const itemsManual = (p.items_pedido || []).length - itemsErp.length
                    return (
                      <button
                        key={p.id}
                        onClick={() => importarPedido(p)}
                        disabled={importandoPedido === p.id || itemsErp.length === 0}
                        className="w-full text-left px-4 py-3 hover:bg-sky-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium text-gray-800">
                              {p.nombre || 'Sin nombre'}
                            </span>
                            <span className="text-xs text-gray-400 ml-2">
                              {p.sucursales?.nombre}
                            </span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(p.fecha || p.created_at).toLocaleDateString('es-AR')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-sky-600">{itemsErp.length} art. importables</span>
                          {itemsManual > 0 && (
                            <span className="text-xs text-gray-400">{itemsManual} manuales (no se importan)</span>
                          )}
                        </div>
                        {p.perfiles?.nombre && (
                          <span className="text-xs text-gray-300">por {p.perfiles.nombre}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Popup de cantidad */}
      {popupArticulo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => { setPopupArticulo(null); setTimeout(() => inputRef.current?.focus(), 10) }}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 text-sm truncate">{popupArticulo.nombre}</h3>
              <p className="text-xs text-gray-400">{popupArticulo.codigo}</p>
            </div>
            <div className="p-4 space-y-3">
              {/* Stock disponible */}
              {(() => { const st = stockOrigen[popupArticulo.id]; return st !== undefined ? (
                <div className={`text-xs text-center font-medium ${st > 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                  Stock origen: {st}{popupArticulo.esPesable ? ' kg' : ' uds'}
                  {popupArticulo.esPesable && popupArticulo.pesoPromedioPieza && st > 0 && ` (≈${Math.round(st / popupArticulo.pesoPromedioPieza)} pzas)`}
                  {!popupArticulo.esPesable && popupArticulo.factorCaja > 1 && st > 0 && ` (${Math.floor(st / popupArticulo.factorCaja)} cj${st % popupArticulo.factorCaja > 0 ? ` + ${st % popupArticulo.factorCaja}` : ''})`}
                </div>
              ) : null })()}

              {/* Toggle kg/uds para pesables — Tab cambia modo, Enter pasa al input */}
              {popupArticulo.esPesable && (
                <div
                  ref={popupToggleRef}
                  className="flex gap-1 bg-gray-100 rounded-lg p-1 outline-none focus:ring-2 focus:ring-sky-300 rounded-lg"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault()
                      setPopupModo(prev => prev === 'kg' ? 'uds' : 'kg')
                      setPopupCantidad('')
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      popupInputRef.current?.focus()
                    }
                  }}
                >
                  <button
                    tabIndex={-1}
                    onClick={() => { setPopupModo('uds'); setPopupCantidad('') }}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      popupModo === 'uds' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    Unidades
                  </button>
                  <button
                    tabIndex={-1}
                    onClick={() => { setPopupModo('kg'); setPopupCantidad('') }}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      popupModo === 'kg' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    Kilogramos
                  </button>
                </div>
              )}

              {/* Toggle uds/cajas para unitarios con unidad alternativa */}
              {!popupArticulo.esPesable && popupArticulo.factorCaja > 1 && (
                <div
                  ref={popupToggleRef}
                  className="flex gap-1 bg-gray-100 rounded-lg p-1 outline-none focus:ring-2 focus:ring-sky-300 rounded-lg"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Tab' && !e.shiftKey) {
                      e.preventDefault()
                      setPopupModo(prev => prev === 'uds' ? 'cajas' : 'uds')
                      setPopupCantidad('')
                    } else if (e.key === 'Enter') {
                      e.preventDefault()
                      popupInputRef.current?.focus()
                    }
                  }}
                >
                  <button
                    tabIndex={-1}
                    onClick={() => { setPopupModo('uds'); setPopupCantidad('') }}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      popupModo === 'uds' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    Unidades
                  </button>
                  <button
                    tabIndex={-1}
                    onClick={() => { setPopupModo('cajas'); setPopupCantidad('') }}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      popupModo === 'cajas' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    Cajas (x{popupArticulo.factorCaja})
                  </button>
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500 block mb-1">
                  {popupArticulo.esPesable
                    ? (popupModo === 'uds' ? 'Cantidad (unidades/piezas)' : 'Cantidad (kg)')
                    : (popupModo === 'cajas' ? `Cantidad (cajas de ${popupArticulo.factorCaja})` : 'Cantidad (unidades)')}
                </label>
                <input
                  ref={popupInputRef}
                  type="number"
                  min={popupArticulo.esPesable && popupModo === 'kg' ? '0.001' : '1'}
                  step={popupArticulo.esPesable && popupModo === 'kg' ? '0.1' : '1'}
                  value={popupCantidad}
                  onChange={e => setPopupCantidad(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarPopup() } if (e.key === 'Escape') { setPopupArticulo(null); setTimeout(() => inputRef.current?.focus(), 10) } }}
                  onFocus={e => e.target.select()}
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-lg text-center font-mono focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none"
                  placeholder="0"
                />
              </div>

              {/* Conversión automática — pesables */}
              {popupArticulo.esPesable && popupArticulo.pesoPromedioPieza && popupCantidad && parseFloat(popupCantidad) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-700 text-center">
                  {popupModo === 'uds'
                    ? `${parseFloat(popupCantidad)} pza${parseFloat(popupCantidad) !== 1 ? 's' : ''} ≈ ${Math.round(parseFloat(popupCantidad) * popupArticulo.pesoPromedioPieza * 1000) / 1000} kg`
                    : `${parseFloat(popupCantidad)} kg ≈ ${Math.round(parseFloat(popupCantidad) / popupArticulo.pesoPromedioPieza)} pza${Math.round(parseFloat(popupCantidad) / popupArticulo.pesoPromedioPieza) !== 1 ? 's' : ''}`
                  }
                </div>
              )}

              {/* Conversión automática — unitarios con cajas */}
              {!popupArticulo.esPesable && popupModo === 'cajas' && popupArticulo.factorCaja > 1 && popupCantidad && parseFloat(popupCantidad) > 0 && (
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-sm text-sky-700 text-center">
                  {`${parseFloat(popupCantidad)} caja${parseFloat(popupCantidad) !== 1 ? 's' : ''} = ${Math.round(parseFloat(popupCantidad) * popupArticulo.factorCaja)} unidades`}
                </div>
              )}

              {popupArticulo.esPesable && popupModo === 'uds' && !popupArticulo.pesoPromedioPieza && (
                <p className="text-xs text-amber-500 text-center">
                  Sin peso promedio — se cargará como piezas sin conversión a kg
                </p>
              )}
            </div>
            <div className="flex gap-3 p-4 border-t border-gray-100">
              <button
                onClick={() => { setPopupArticulo(null); setTimeout(() => inputRef.current?.focus(), 10) }}
                className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarPopup}
                disabled={!popupCantidad || parseFloat(popupCantidad) <= 0}
                className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default NuevaOrden
