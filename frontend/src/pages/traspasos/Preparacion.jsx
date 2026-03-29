// Vista de preparación / picking — mobile-first para celular con escáner
// Flujo: escanear precinto → abre canasto → escanear artículos → van al canasto
// Si escaneas caja (factor>1) → bulto independiente
// Si escaneas artículo sin canasto abierto → bulto independiente
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { imprimirPallet } from '../../utils/imprimirPallet'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Círculo de progreso SVG
const CirculoProgreso = ({ actual, total, size = 48 }) => {
  const pct = total > 0 ? Math.min(actual / total, 1) : 0
  const r = size * 0.4
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct)
  const completo = pct >= 1

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" />
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke={completo ? '#10b981' : '#3b82f6'}
          strokeWidth="3" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          className="transition-all duration-300"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {completo ? (
          <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="text-xs font-bold text-gray-700">{actual}/{total}</span>
        )}
      </div>
    </div>
  )
}

const Preparacion = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { usuario } = useAuth()

  const [orden, setOrden] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [fase, setFase] = useState('picking') // 'picking' | 'detalle' | 'finalizar'
  const [itemDetalle, setItemDetalle] = useState(null)

  // Contenedores — persistidos en servidor (preparacion_state)
  const [canastoActivo, setCanastoActivo] = useState(null)
  const [contenedores, setContenedores] = useState([])
  const [modalCerrarCanasto, setModalCerrarCanasto] = useState(null) // {precinto, callback}
  const [pesoCanasto, setPesoCanasto] = useState('')

  // Pallets (se mantiene)
  const [palletsPrep, setPalletsPrep] = useState([])
  const [modalPallet, setModalPallet] = useState(false)
  const [palletBultos, setPalletBultos] = useState('')
  const [palletDesc, setPalletDesc] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [observacion, setObservacion] = useState('')

  // Stock y artículos completos
  const [stockOrigen, setStockOrigen] = useState({})
  const [todosArticulos, setTodosArticulos] = useState([])

  // Escaneo
  const scanRef = useRef(null)
  const scanDivDetalleRef = useRef(null)
  const [scanInput, setScanInput] = useState('')

  // Alertas y feedback
  const [feedback, setFeedback] = useState(null)
  const [alertaFullscreen, setAlertaFullscreen] = useState(null)
  const [alertaPeso, setAlertaPeso] = useState(null)
  const [ultimoEscaneado, setUltimoEscaneado] = useState(null)
  const itemRefs = useRef({})
  const [modalEditarCanasto, setModalEditarCanasto] = useState(false)
  const [tecladoVisible, setTecladoVisible] = useState(false)
  const inputManualRef = useRef(null)
  const [mostrarPesoManual, setMostrarPesoManual] = useState(false)
  const [pesoManualCantidad, setPesoManualCantidad] = useState('')
  const [pesoManualPeso, setPesoManualPeso] = useState('')
  const [pesoManualError, setPesoManualError] = useState(null)
  const [mostrarPiezas, setMostrarPiezas] = useState(false)

  // Contenedor expandido (ver artículos) y canasto en edición
  const [contenedorExpandido, setContenedorExpandido] = useState(null)
  const [canastoEditando, _setCanastoEditando] = useState(null)
  const canastoEditandoRef = useRef(null)
  const setCanastoEditando = (v) => {
    const val = typeof v === 'function' ? v(canastoEditandoRef.current) : v
    canastoEditandoRef.current = val
    _setCanastoEditando(val)
    // Al cerrar modal, re-enfocar input de scan
    if (!val) setTimeout(() => scanRef.current?.focus(), 150)
  }

  // Modal de artículos pendientes al cerrar
  const [modalPendientes, setModalPendientes] = useState(null)
  const [enviandoPendientes, setEnviandoPendientes] = useState(false)
  const faltantesRef = useRef(null)

  // Ref para el detalle
  const completoAlAbrir = useRef(false)
  const ordenRef = useRef(orden)
  useEffect(() => { ordenRef.current = orden }, [orden])

  const mostrarFeedback = (msg, ok, tipo) => {
    setFeedback({ msg, ok })
    if (fase === 'detalle' || fase === 'picking') {
      setAlertaFullscreen({ msg, ok, tipo: tipo || (ok ? 'ok' : 'error') })
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const playBeep = (freq, start, dur, type = 'square', vol = 0.3) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = freq
          osc.type = type
          gain.gain.value = vol
          osc.start(ctx.currentTime + start)
          osc.stop(ctx.currentTime + start + dur)
        }
        if (ok) {
          // Beep ascendente corto — éxito
          playBeep(600, 0, 0.1, 'sine', 0.25)
          playBeep(900, 0.1, 0.15, 'sine', 0.25)
        } else {
          // 3 beeps graves — error
          playBeep(800, 0, 0.15)
          playBeep(800, 0.25, 0.15)
          playBeep(800, 0.5, 0.15)
        }
      } catch (e) {}
      setTimeout(() => setAlertaFullscreen(null), ok ? 800 : 2000)
    }
    setTimeout(() => setFeedback(null), 1500)
  }

  const reproducirAlerta = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 440
      osc.type = 'square'
      gain.gain.value = 0.3
      osc.start()
      setTimeout(() => { osc.stop(); ctx.close() }, 500)
    } catch (_) {}
  }

  // === CARGA ===
  const cargar = async () => {
    try {
      const { data } = await api.get(`/api/traspasos/ordenes/${id}`)
      setOrden(data)
      // Restaurar estado de preparación (canastos/contenedores)
      if (data.preparacion_state) {
        const ps = data.preparacion_state
        if (ps.canastoActivo) setCanastoActivo(ps.canastoActivo)
        if (ps.contenedores?.length) setContenedores(ps.contenedores)
        prepStateRef.current = ps
        // Sincronizar cantidad_preparada desde contenedores reales
        const cont = ps.contenedores || []
        const canasto = ps.canastoActivo || null
        const itemsSinc = sincronizarProgreso(data.items, cont, canasto)
        if (JSON.stringify(itemsSinc) !== JSON.stringify(data.items)) {
          data.items = itemsSinc
          setOrden(prev => ({ ...prev, items: itemsSinc }))
          api.put(`/api/traspasos/ordenes/${id}/pick`, { items: itemsSinc, preparacion_state: ps }).catch(() => {})
        }
      }
      prepStateLoaded.current = true
      if (data.estado !== 'en_preparacion') {
        alert('Esta orden no está en preparación')
        navigate('/preparacion')
        return
      }
      // Verificar que el usuario actual sea quien inició la preparación
      if (data.preparado_por && usuario?.id && data.preparado_por !== usuario.id) {
        alert('Esta orden está siendo preparada por otro usuario')
        navigate('/preparacion')
        return
      }
      if (data.sucursal_origen_id) {
        api.get(`/api/traspasos/stock/${data.sucursal_origen_id}`)
          .then(r => setStockOrigen(r.data || {}))
          .catch(() => {})
      }
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [id])

  // Persistir canasto y contenedores en servidor
  const prepStateRef = useRef({ canastoActivo: null, contenedores: [] })
  const prepStateLoaded = useRef(false)
  useEffect(() => {
    if (!prepStateLoaded.current) return // No persistir hasta que se cargue la orden
    const state = { canastoActivo, contenedores }
    // Evitar guardar si no cambió
    if (JSON.stringify(state) === JSON.stringify(prepStateRef.current)) return
    prepStateRef.current = state
    // Guardar junto con items actuales
    const items = orden?.items
    if (items) {
      api.put(`/api/traspasos/ordenes/${id}/pick`, { items, preparacion_state: state }).catch(() => {})
    }
  }, [canastoActivo, contenedores])

  useEffect(() => {
    if (!orden) return
    const ids = (orden.items || []).map(i => i.articulo_id).filter(Boolean)
    if (ids.length === 0) return
    api.post('/api/traspasos/articulos-enriquecer', { ids })
      .then(r => setTodosArticulos(r.data || []))
      .catch(() => {})
  }, [orden?.id])

  // Input oculto para captura de escaneo — inputMode="none" no abre teclado
  const scanBufferRef = useRef('')
  const handleScanCodigoRef = useRef(null)
  const handleScanDetalleRef = useRef(null)
  const faseRef = useRef(fase)
  const itemDetalleRef = useRef(itemDetalle)

  // Interceptar botón Atrás de Android: si estamos en detalle → volver a picking
  useEffect(() => {
    if (fase === 'detalle') {
      window.history.pushState({ fase: 'detalle' }, '')
    }
    const handlePopState = () => {
      if (faseRef.current === 'detalle') {
        setFase('picking')
        setItemDetalle(null)
        setMostrarPiezas(false)
        setTimeout(() => scanRef.current?.focus(), 300)
        // Re-push para no salir del componente si pulsa atrás de nuevo
        window.history.pushState(null, '')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [fase])

  // Listener global de keydown para capturar scanner sin input focuseado
  useEffect(() => {
    if (fase !== 'picking' && fase !== 'detalle') return
    if (tecladoVisible) return

    const handleKeyDown = (e) => {
      // Ignorar si el foco está en un input real (teclado manual)
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === 'Enter') {
        e.preventDefault()
        const codigo = scanBufferRef.current.trim()
        scanBufferRef.current = ''
        setScanInput('')
        if (!codigo) return
        if (faseRef.current === 'detalle' && itemDetalleRef.current) {
          handleScanDetalleRef.current?.(codigo)
        } else {
          handleScanCodigoRef.current?.(codigo)
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        scanBufferRef.current += e.key
        setScanInput(scanBufferRef.current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [fase, tecladoVisible])

  // Timeout ref para detectar fin de código escaneado via onChange
  const scanTimeoutRef = useRef(null)

  // Procesar código escaneado (compartido entre onKeyDown Enter y timeout)
  const procesarCodigoEscaneado = (codigo) => {
    if (!codigo) return
    if (faseRef.current === 'detalle' && itemDetalleRef.current) {
      handleScanDetalleRef.current?.(codigo)
    } else {
      handleScanCodigoRef.current?.(codigo)
    }
    // Re-enfocar el input de scan después de procesar
    setTimeout(() => {
      if (faseRef.current === 'detalle') {
        scanDivDetalleRef.current?.focus()
      } else {
        scanRef.current?.focus()
      }
    }, 300)
  }

  // Handler onChange para inputs con inputMode="none" — captura DataWedge via InputConnection
  const handleScanInputChange = (e) => {
    const val = e.target.value
    setScanInput(val)
    scanBufferRef.current = val
    // Cada cambio resetea el timeout; cuando paran los chars → código completo
    clearTimeout(scanTimeoutRef.current)
    scanTimeoutRef.current = setTimeout(() => {
      const codigo = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      setScanInput('')
      procesarCodigoEscaneado(codigo)
    }, 200) // 200ms sin chars = fin del código
  }

  // Handler onKeyDown para inputs — captura Enter del scanner (keystroke mode)
  const handleScanInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      clearTimeout(scanTimeoutRef.current)
      const codigo = scanBufferRef.current.trim()
      scanBufferRef.current = ''
      setScanInput('')
      procesarCodigoEscaneado(codigo)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      scanBufferRef.current += e.key
      setScanInput(scanBufferRef.current)
    }
  }

  // Auto-focus el input de scan cuando se cierra el teclado manual o cambia fase
  useEffect(() => {
    if (tecladoVisible) return
    const timer = setTimeout(() => {
      if (fase === 'detalle' && itemDetalle) {
        scanDivDetalleRef.current?.focus()
      } else if (fase === 'picking') {
        scanRef.current?.focus()
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [tecladoVisible, fase, itemDetalle])

  // Focus inicial cuando termina de cargar
  useEffect(() => {
    if (cargando || tecladoVisible) return
    const timer = setTimeout(() => {
      if (fase === 'picking') {
        scanRef.current?.focus()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [cargando])

  // Auto-volver al picking cuando artículo se completa
  useEffect(() => {
    if (fase !== 'detalle' || !itemDetalle) return
    const piezasPick = pickEnPiezas(itemDetalle)
    const piezasPedidas = cantidadEnPiezas(itemDetalle)
    const estaCompleto = piezasPick > 0 && piezasPick >= piezasPedidas
    if (estaCompleto && !completoAlAbrir.current) {
      const timer = setTimeout(() => {
        setFase('picking')
        setItemDetalle(null)
        setMostrarPiezas(false)
        setTimeout(() => scanRef.current?.focus(), 300)
      }, 1200)
      return () => clearTimeout(timer)
    }
  }, [fase, itemDetalle, orden])

  // === UTILIDADES ===
  const parsearBarcodeBalanza = (barcode) => {
    const code = barcode.replace(/\s/g, '')
    if (code.length === 13 && code.startsWith('20')) {
      const plu = code.substring(2, 7)
      const pesoGramos = parseInt(code.substring(7, 12), 10)
      const pesoKg = pesoGramos / 1000
      if (pesoKg > 0) return { plu, pesoKg }
    }
    return null
  }

  const itemsEnriquecidos = useMemo(() => {
    if (!orden) return []
    const items = Array.isArray(orden.items) ? orden.items : []
    const catalogo = {}
    for (const a of todosArticulos) {
      catalogo[String(a.id)] = a
      if (a.dbId) catalogo[String(a.dbId)] = a
      if (a.codigo) catalogo['cod:' + a.codigo] = a
    }
    return items.map(item => {
      const cat = catalogo[item.articulo_id] || catalogo['cod:' + item.codigo] || {}
      return {
        ...item,
        es_pesable: item.es_pesable ?? cat.esPesable ?? false,
        rubro: cat.rubro?.nombre || '',
        marca: cat.marca || '',
        pesoPromedioPieza: item.peso_promedio_pieza || cat.pesoPromedioPieza || null,
        pppOrden: item.peso_promedio_pieza || cat.pesoPromedioPieza || null,
        pesoMinimo: cat.pesoMinimo || null,
        pesoMaximo: cat.pesoMaximo || null,
        plu: cat.codigo || item.codigo,
      }
    })
  }, [orden, todosArticulos])

  const itemsOrdenados = useMemo(() => {
    return [...itemsEnriquecidos].sort((a, b) => {
      const rubroComp = (a.rubro || 'ZZZ').localeCompare(b.rubro || 'ZZZ')
      if (rubroComp !== 0) return rubroComp
      return (a.marca || 'ZZZ').localeCompare(b.marca || 'ZZZ')
    })
  }, [itemsEnriquecidos])

  const pickeado = useMemo(() => {
    const map = {}
    if (!orden) return map
    for (const item of (orden.items || [])) {
      const cp = item.cantidad_preparada || 0
      if (cp <= 0) continue
      if (item.es_pesable && Array.isArray(item.pesos_escaneados)) {
        map[item.articulo_id] = { kg: cp, piezas: item.pesos_escaneados.length }
      } else {
        map[item.articulo_id] = { kg: 0, piezas: cp }
      }
    }
    return map
  }, [orden])

  const cantidadEnPiezas = (item) => {
    if (!item.es_pesable || !item.pppOrden) return item.cantidad_solicitada
    return Math.round(item.cantidad_solicitada / item.pppOrden)
  }

  const pickEnPiezas = (item) => pickeado[item.articulo_id]?.piezas || 0
  const pickEnKg = (item) => pickeado[item.articulo_id]?.kg || 0

  // Versión "fresca" que lee del ref (para validaciones en handlers de escaneo rápido)
  const pickEnPiezasFresh = (articuloId) => {
    const items = ordenRef.current?.items || []
    const it = items.find(i => i.articulo_id === articuloId)
    if (!it) return 0
    if (it.es_pesable && Array.isArray(it.pesos_escaneados)) return it.pesos_escaneados.length
    return it.cantidad_preparada || 0
  }

  const getFactorCaja = (item) => {
    if (item.es_pesable) return 0
    const cat = todosArticulos.find(a => String(a.id) === String(item.articulo_id))
    return cat?.codigosBarras?.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
  }

  // === PERSISTIR PICK ===
  const persistirItems = (nuevosItems) => {
    api.put(`/api/traspasos/ordenes/${id}/pick`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al guardar')
        cargar()
      })
  }

  // === BUSCAR ARTÍCULO POR BARCODE ===
  const buscarArticuloPorCodigo = (codigo) => {
    if (!orden) return null
    const items = orden.items || []

    // Intentar como barcode de balanza
    const balanza = parsearBarcodeBalanza(codigo)
    if (balanza) {
      for (const item of items) {
        const cat = todosArticulos.find(a => String(a.id) === item.articulo_id)
        const codigoArt = cat?.codigo || item.codigo
        const normPlu = balanza.plu.replace(/^0+/, '')
        const normCodigo = (codigoArt || '').replace(/^0+/, '')
        if (normCodigo === normPlu) {
          return { item, factor: 1, peso: balanza.pesoKg, balanza, cat }
        }
      }
      return null
    }

    // Buscar por código directo
    const porCodigo = items.find(i => i.codigo === codigo)
    if (porCodigo) return { item: porCodigo, factor: 1, peso: null, balanza: null, cat: null }

    // Buscar en catálogo por código o codigos_barras
    for (const cat of todosArticulos) {
      if (cat.codigo === codigo) {
        const item = items.find(i => i.articulo_id === String(cat.id))
        if (item) return { item, factor: 1, peso: null, balanza: null, cat }
      }
      if (cat.codigosBarras) {
        const match = cat.codigosBarras.find(b =>
          typeof b === 'object' ? b.codigo === codigo : b === codigo
        )
        if (match) {
          const item = items.find(i => i.articulo_id === String(cat.id))
          if (item) {
            const factor = typeof match === 'object' ? (match.factor || 1) : 1
            return { item, factor, peso: null, balanza: null, cat }
          }
        }
      }
    }
    return null
  }

  // === AGREGAR A CONTENEDOR ===
  const agregarACanastoActivo = (item, cantidad, balanza) => {
    if (!canastoActivo) return
    setCanastoActivo(prev => {
      const existente = prev.items.find(i => i.articulo_id === item.articulo_id)
      if (existente) {
        return {
          ...prev,
          items: prev.items.map(i =>
            i.articulo_id === item.articulo_id
              ? {
                  ...i,
                  cantidad: Math.round(((i.cantidad || 0) + cantidad) * 1000) / 1000,
                  pesos_escaneados: balanza
                    ? [...(i.pesos_escaneados || []), balanza.pesoKg]
                    : i.pesos_escaneados,
                }
              : i
          ),
        }
      }
      return {
        ...prev,
        items: [...prev.items, {
          articulo_id: item.articulo_id,
          nombre: item.nombre,
          codigo: item.codigo,
          cantidad,
          es_pesable: item.es_pesable || false,
          pesos_escaneados: balanza ? [balanza.pesoKg] : undefined,
        }],
      }
    })
  }

  const crearBulto = (item, cantidad, balanza) => {
    const bulto = {
      tipo: 'bulto',
      precinto: null,
      nombre: `${item.nombre}${cantidad > 1 ? ` x${cantidad}` : ''}`,
      peso_origen: null,
      items: [{
        articulo_id: item.articulo_id,
        nombre: item.nombre,
        codigo: item.codigo,
        cantidad,
        es_pesable: item.es_pesable || false,
        pesos_escaneados: balanza ? [balanza.pesoKg] : undefined,
      }],
    }
    setContenedores(prev => [...prev, bulto])
  }

  // Quitar cantidad de un artículo del canasto activo (revierte progreso)
  const quitarDeCanasto = (articuloId, cantQuitar) => {
    setCanastoActivo(prev => {
      if (!prev) return prev
      const updated = prev.items.map(i => {
        if (i.articulo_id !== articuloId) return i
        const nueva = Math.round((i.cantidad - cantQuitar) * 1000) / 1000
        if (nueva <= 0) return null
        const pesosNuevos = i.pesos_escaneados ? i.pesos_escaneados.slice(0, -Math.round(cantQuitar)) : undefined
        return { ...i, cantidad: nueva, pesos_escaneados: pesosNuevos }
      }).filter(Boolean)
      return { ...prev, items: updated }
    })
    // Revertir progreso
    revertirProgresoOrden(articuloId, cantQuitar)
  }

  // Mover cantidad de canasto a bulto suelto
  const moverABulto = (articuloId, cantMover) => {
    const itemCanasto = canastoActivo?.items.find(i => i.articulo_id === articuloId)
    if (!itemCanasto) return
    // Quitar del canasto (sin revertir progreso, ya está contado)
    setCanastoActivo(prev => {
      if (!prev) return prev
      const updated = prev.items.map(i => {
        if (i.articulo_id !== articuloId) return i
        const nueva = Math.round((i.cantidad - cantMover) * 1000) / 1000
        if (nueva <= 0) return null
        return { ...i, cantidad: nueva }
      }).filter(Boolean)
      return { ...prev, items: updated }
    })
    // Crear bulto
    const bulto = {
      tipo: 'bulto', precinto: null,
      nombre: `${itemCanasto.nombre}${cantMover > 1 ? ` x${cantMover}` : ''}`,
      peso_origen: null,
      items: [{ articulo_id: articuloId, nombre: itemCanasto.nombre, codigo: itemCanasto.codigo, cantidad: cantMover, es_pesable: itemCanasto.es_pesable }],
    }
    setContenedores(prev => [...prev, bulto])
    mostrarFeedback(`Movido a bulto: ${itemCanasto.nombre} x${cantMover}`, true)
  }

  // Revertir progreso (opuesto de actualizarProgresoOrden)
  const revertirProgresoOrden = (articuloId, cantQuitar) => {
    let nuevosItems
    setOrden(prev => {
      nuevosItems = (prev.items || []).map(i => {
        if (i.articulo_id !== articuloId) return i
        const updated = { ...i }
        updated.cantidad_preparada = Math.max(0, Math.round(((i.cantidad_preparada || 0) - cantQuitar) * 1000) / 1000)
        if (i.pesos_escaneados) {
          updated.pesos_escaneados = i.pesos_escaneados.slice(0, -Math.ceil(cantQuitar))
        }
        return updated
      })
      return { ...prev, items: nuevosItems }
    })
    setTimeout(() => { if (nuevosItems) persistirItems(nuevosItems) }, 0)
  }

  // Actualizar peso min/max del artículo si el peso escaneado expande el rango
  const actualizarPesoMinMax = (articuloId, peso) => {
    if (!peso || peso <= 0) return
    const cat = todosArticulos.find(a => String(a.id) === String(articuloId))
    if (!cat || !cat.esPesable) return
    const min = cat.pesoMinimo
    const max = cat.pesoMaximo
    const expandeMin = min === null || peso < min
    const expandeMax = max === null || peso > max
    if (!expandeMin && !expandeMax) return
    // Actualizar catálogo local inmediatamente
    setTodosArticulos(prev => prev.map(a => {
      if (String(a.id) !== String(articuloId)) return a
      return {
        ...a,
        pesoMinimo: expandeMin ? peso : a.pesoMinimo,
        pesoMaximo: expandeMax ? peso : a.pesoMaximo,
      }
    }))
    // Persistir en servidor
    api.put(`/api/traspasos/articulos/${articuloId}/pesos`, { peso }).catch(() => {})
  }

  // Actualizar progreso en orden.items (para persistencia y progress circles)
  const actualizarProgresoOrden = (articuloId, cantAgregar, balanza) => {
    if (balanza) actualizarPesoMinMax(articuloId, balanza.pesoKg)
    let nuevosItems
    setOrden(prev => {
      nuevosItems = (prev.items || []).map(i => {
        if (i.articulo_id !== articuloId) return i
        const updated = { ...i }
        if (balanza) {
          updated.cantidad_preparada = Math.round(((i.cantidad_preparada || 0) + cantAgregar) * 1000) / 1000
          updated.pesos_escaneados = [...(i.pesos_escaneados || []), balanza.pesoKg]
        } else {
          updated.cantidad_preparada = (i.cantidad_preparada || 0) + cantAgregar
        }
        return updated
      })
      return { ...prev, items: nuevosItems }
    })
    setTimeout(() => { if (nuevosItems) persistirItems(nuevosItems) }, 0)
  }

  // === SINCRONIZAR PROGRESO DESDE CONTENEDORES ===
  const sincronizarProgreso = (itemsOrden, contList, canasto) => {
    return (itemsOrden || []).map(item => {
      let total = 0
      let pesos = []

      // Sumar desde contenedores cerrados
      for (const c of (contList || [])) {
        for (const ci of (c.items || [])) {
          if (ci.articulo_id !== item.articulo_id) continue
          if (ci.es_pesable && ci.pesos_escaneados) {
            total += ci.pesos_escaneados.reduce((s, p) => s + p, 0)
            pesos.push(...ci.pesos_escaneados)
          } else {
            total += ci.cantidad || 0
          }
        }
      }

      // Sumar desde canasto abierto
      if (canasto) {
        for (const ci of (canasto.items || [])) {
          if (ci.articulo_id !== item.articulo_id) continue
          if (ci.es_pesable && ci.pesos_escaneados) {
            total += ci.pesos_escaneados.reduce((s, p) => s + p, 0)
            pesos.push(...ci.pesos_escaneados)
          } else {
            total += ci.cantidad || 0
          }
        }
      }

      total = Math.round(total * 1000) / 1000
      if (total === (item.cantidad_preparada || 0)) return item
      return { ...item, cantidad_preparada: total, pesos_escaneados: pesos.length ? pesos : undefined }
    })
  }

  // === HANDLER PRINCIPAL DE ESCANEO ===
  const handleScanCodigo = (codigo) => {

    // 0a-pre. Si hay contenedor esperando confirmación de mover a canasto
    const moverCan = confirmarMoverACanRef.current
    if (moverCan) {
      if (moverCan.codigos?.includes(codigo)) {
        ejecutarMoverACanasto()
        return
      } else {
        mostrarFeedback('Código incorrecto', false)
        return
      }
    }

    // 0a. Si hay contenedor esperando confirmación de eliminación
    const elimCont = confirmarElimContRef.current
    if (elimCont) {
      if (elimCont.tipo === 'canasto' && elimCont.codigoEsperado === codigo) {
        ejecutarEliminarContenedor()
        return
      } else if (elimCont.tipo === 'bulto' && elimCont.codigos?.includes(codigo)) {
        ejecutarEliminarContenedor()
        return
      } else {
        mostrarFeedback('Código incorrecto', false)
        return
      }
    }

    // 0b. Si hay pieza esperando confirmación de scan
    const eliminando = piezaEliminandoRef.current
    if (eliminando?.esperandoScan && codigo.startsWith('CAN-')) {
      if (eliminando.esperandoScan === codigo) {
        ejecutarEliminarPieza(eliminando.pieza)
        return
      } else {
        mostrarFeedback('Canasto incorrecto', false)
        return
      }
    }

    // 1. Detectar canasto por prefijo CAN-
    if (codigo.startsWith('CAN-')) {
      // Prioridad: si hay modal de edición esperando scan, verificar primero
      const editando = canastoEditandoRef.current
      if (editando?.esperandoScan === codigo) {
        setCanastoEditando({ idx: editando.idx, confirmado: true })
        mostrarFeedback(`🧺 Canasto ${codigo} verificado`, true, 'info')
        return
      }
      if (canastoActivo) {
        setPesoCanasto('')
        if (canastoActivo.precinto === codigo) {
          // Mismo canasto → solo cerrar (no reabrir)
          setModalCerrarCanasto({ precinto: null })
        } else {
          // Otro canasto → cerrar actual y abrir nuevo
          setModalCerrarCanasto({ precinto: codigo })
        }
        return
      }
      const idxCerrado = contenedores.findIndex(c => c.precinto === codigo)
      if (idxCerrado !== -1) {
        // Reabrir canasto cerrado como activo para agregar más artículos
        const cerrado = contenedores[idxCerrado]
        setContenedores(prev => prev.filter((_, i) => i !== idxCerrado))
        setCanastoActivo({ precinto: cerrado.precinto, items: cerrado.items || [] })
        setCanastoEditando(null)
        mostrarFeedback(`🧺 Canasto ${codigo} reabierto`, true, 'info')
        return
      }
      setCanastoActivo({ precinto: codigo, items: [] })
      mostrarFeedback(`🧺 Canasto ${codigo} abierto`, true, 'info')
      return
    }

    // 2. Buscar artículo por código
    const resultado = buscarArticuloPorCodigo(codigo)

    if (resultado) {
      const { item, factor, peso, balanza, cat } = resultado

      // Validar peso fuera de rango para pesables
      if (balanza && item.es_pesable) {
        const enriched = itemsEnriquecidos.find(i => i.articulo_id === item.articulo_id)
        const pesoMin = enriched?.pesoMinimo
        const pesoMax = enriched?.pesoMaximo
        if ((pesoMin && balanza.pesoKg < pesoMin) || (pesoMax && balanza.pesoKg > pesoMax)) {
          reproducirAlerta()
          setAlertaPeso({
            peso: balanza.pesoKg, min: pesoMin, max: pesoMax,
            nombre: item.nombre, balanza, item, factor,
          })
          return
        }
      }

      const cantAgregar = peso || factor

      // Validar que no se exceda la cantidad pedida
      const piezasYa = pickEnPiezasFresh(item.articulo_id)
      const piezasPedidas = cantidadEnPiezas(item)
      if (piezasYa >= piezasPedidas) {
        mostrarFeedback(`${item.nombre} ya está completo`, false)
        return
      }

      setUltimoEscaneado(item.articulo_id)
      const seCompletaCon = (piezasYa + (peso || factor)) >= piezasPedidas
      if (!seCompletaCon) {
        setTimeout(() => {
          itemRefs.current[item.articulo_id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 100)
      }

      if (factor > 1) {
        // Código de caja → siempre bulto independiente
        crearBulto(item, factor, null)
        actualizarProgresoOrden(item.articulo_id, factor, null)
        mostrarFeedback(`📋 Bulto: ${item.nombre} x${factor}`, true)
      } else if (canastoActivo) {
        // Artículo individual/pesable + canasto abierto → al canasto
        agregarACanastoActivo(item, cantAgregar, balanza)
        actualizarProgresoOrden(item.articulo_id, cantAgregar, balanza)
        mostrarFeedback(`🧺 +${balanza ? balanza.pesoKg + 'kg' : cantAgregar} ${item.nombre}`, true)
      } else {
        // Sin canasto abierto → bulto
        crearBulto(item, cantAgregar, balanza)
        actualizarProgresoOrden(item.articulo_id, cantAgregar, balanza)
        mostrarFeedback(`📋 Bulto: ${item.nombre}`, true)
      }
    } else {
      // 3. No matchea nada → error
      mostrarFeedback('Código no reconocido', false)
    }
  }

  // Wrapper para input manual (fallback)
  const handleScan = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const codigo = scanInput.trim()
    if (!codigo) return
    setScanInput('')
    scanBufferRef.current = ''
    if (fase === 'detalle' && itemDetalle) {
      handleScanDetalle(codigo)
    } else {
      handleScanCodigo(codigo)
    }
  }

  // Handler de escaneo en fase detalle (artículo específico)
  const handleScanDetalle = (codigo) => {
    // Si hay pieza esperando confirmación de scan para eliminar
    const eliminando = piezaEliminandoRef.current
    if (eliminando?.esperandoScan) {
      if (eliminando.esperandoScan === codigo) {
        ejecutarEliminarPieza(eliminando.pieza)
      } else {
        mostrarFeedback('Canasto incorrecto', false)
      }
      return
    }

    const itemActual = itemDetalle
    if (!itemActual) return

    const piezasYa = pickEnPiezasFresh(itemActual.articulo_id)
    const piezasPedidas = cantidadEnPiezas(itemActual)
    if (piezasYa >= piezasPedidas) {
      mostrarFeedback('Artículo ya completo', false)
      return
    }

    const balanza = parsearBarcodeBalanza(codigo)
    let coincide = false
    let cantAgregar = 1

    if (balanza && itemActual.es_pesable) {
      const cat = todosArticulos.find(a => String(a.id) === itemActual.articulo_id)
      const codigoArticulo = cat?.codigo || itemActual.codigo
      const normPlu = balanza.plu.replace(/^0+/, '')
      const normCodigo = (codigoArticulo || '').replace(/^0+/, '')
      coincide = normCodigo === normPlu
      if (coincide) {
        const enriched = itemsEnriquecidos.find(i => i.articulo_id === itemActual.articulo_id)
        const pesoMin = enriched?.pesoMinimo
        const pesoMax = enriched?.pesoMaximo
        if ((pesoMin && balanza.pesoKg < pesoMin) || (pesoMax && balanza.pesoKg > pesoMax)) {
          reproducirAlerta()
          setAlertaPeso({
            peso: balanza.pesoKg, min: pesoMin, max: pesoMax,
            nombre: itemActual.nombre, balanza, item: itemActual, factor: 1,
          })
          return
        }
        cantAgregar = balanza.pesoKg
      }
    } else {
      if (itemActual.codigo === codigo) {
        coincide = true
      } else {
        const cat = todosArticulos.find(a => String(a.id) === itemActual.articulo_id)
        if (cat) {
          if (cat.codigo === codigo) {
            coincide = true
          } else if (cat.codigosBarras) {
            const match = cat.codigosBarras.find(b =>
              typeof b === 'object' ? b.codigo === codigo : b === codigo
            )
            if (match) {
              coincide = true
              cantAgregar = typeof match === 'object' ? (match.factor || 1) : 1
            }
          }
        }
      }
    }

    if (!coincide) {
      mostrarFeedback('Código no coincide con este artículo', false)
      return
    }

    // Agregar al canasto activo o crear bulto
    if (cantAgregar > 1 && !balanza) {
      // Caja → bulto
      crearBulto(itemActual, cantAgregar, null)
    } else if (canastoActivo) {
      agregarACanastoActivo(itemActual, cantAgregar, balanza)
    } else {
      crearBulto(itemActual, cantAgregar, balanza)
    }

    actualizarProgresoOrden(itemActual.articulo_id, cantAgregar, balanza)
    mostrarFeedback(`+${balanza ? balanza.pesoKg + 'kg' : cantAgregar} ${itemActual.nombre}`, true)
  }

  // Confirmar peso fuera de rango
  // Sync refs para captura global de escaneo
  handleScanCodigoRef.current = handleScanCodigo
  handleScanDetalleRef.current = handleScanDetalle
  faseRef.current = fase
  itemDetalleRef.current = itemDetalle

  const confirmarPesoFueraDeRango = () => {
    if (!alertaPeso) return
    const { balanza, item, factor } = alertaPeso
    const cantAgregar = balanza.pesoKg

    if (canastoActivo) {
      agregarACanastoActivo(item, cantAgregar, balanza)
    } else {
      crearBulto(item, cantAgregar, balanza)
    }
    actualizarProgresoOrden(item.articulo_id, cantAgregar, balanza)
    mostrarFeedback(`+${cantAgregar}kg ${item.nombre}`, true)
    setAlertaPeso(null)
  }

  // === CERRAR CANASTO ===
  const cerrarCanastoActivo = (peso) => {
    if (!canastoActivo) return
    const canastoCerrado = {
      tipo: 'canasto',
      precinto: canastoActivo.precinto,
      items: canastoActivo.items,
      peso_origen: peso ? parseFloat(peso) : null,
    }
    const nuevosContenedores = [...contenedores, canastoCerrado]
    setContenedores(nuevosContenedores)
    setCanastoActivo(null)
    setPesoCanasto('')
    setOrden(prev => {
      const itemsSinc = sincronizarProgreso(prev.items, nuevosContenedores, null)
      setTimeout(() => persistirItems(itemsSinc), 0)
      return { ...prev, items: itemsSinc }
    })
    const msg = peso ? `🧺 ${canastoCerrado.precinto} cerrado (${peso}kg)` : `🧺 ${canastoCerrado.precinto} cerrado`
    mostrarFeedback(msg, true, 'info')
  }

  const abrirSiguienteCanasto = () => {
    if (modalCerrarCanasto?.precinto) {
      const nuevoPrecinto = modalCerrarCanasto.precinto
      if (!contenedores.some(c => c.precinto === nuevoPrecinto)) {
        setTimeout(() => {
          setCanastoActivo({ precinto: nuevoPrecinto, items: [] })
          mostrarFeedback(`🧺 Canasto ${nuevoPrecinto} abierto`, true, 'info')
        }, 50)
      }
    }
    setModalCerrarCanasto(null)
    setTimeout(() => scanRef.current?.focus(), 150)
  }

  const handleCerrarCanastoConPeso = () => {
    const peso = parseFloat(pesoCanasto)
    if (!peso || peso <= 0) return alert('Ingresá un peso válido')
    cerrarCanastoActivo(pesoCanasto)
    abrirSiguienteCanasto()
  }

  const handleCerrarCanastoSinPeso = () => {
    cerrarCanastoActivo(null)
    abrirSiguienteCanasto()
  }

  // Pesar canastos pendientes al finalizar
  const [pesandoCanastoIdx, setPesandoCanastoIdx] = useState(null)
  const [pesandoCanastoPeso, setPesandoCanastoPeso] = useState('')

  const confirmarPesoCanasto = () => {
    const peso = parseFloat(pesandoCanastoPeso)
    if (!peso || peso <= 0) return alert('Ingresá un peso válido')
    const idx = pesandoCanastoIdx
    setContenedores(prev => {
      const updated = prev.map((c, i) => i === idx ? { ...c, peso_origen: peso } : c)
      const siguiente = updated.findIndex(c => c.tipo === 'canasto' && (c.peso_origen === null || c.peso_origen === undefined))
      if (siguiente !== -1) {
        setTimeout(() => { setPesandoCanastoIdx(siguiente); setPesandoCanastoPeso('') }, 50)
      } else {
        setTimeout(() => marcarPreparado(), 50)
      }
      return updated
    })
    setPesandoCanastoIdx(null)
    setPesandoCanastoPeso('')
    mostrarFeedback('Peso registrado', true, 'info')
  }

  // Eliminar contenedor
  // Expandir items de un contenedor a líneas individuales (cada escaneo = 1 línea)
  const expandirItemsContenedor = (items) => {
    const lineas = []
    for (const ci of (items || [])) {
      if (ci.es_pesable && ci.pesos_escaneados?.length) {
        for (const peso of ci.pesos_escaneados) {
          lineas.push({ ...ci, cantidad: peso, pesos_escaneados: [peso], _individual: true })
        }
      } else if (!ci.es_pesable && ci.cantidad > 1) {
        for (let i = 0; i < ci.cantidad; i++) {
          lineas.push({ ...ci, cantidad: 1, _individual: true })
        }
      } else {
        lineas.push({ ...ci, _individual: true })
      }
    }
    return lineas
  }

  // Eliminar un item individual de un contenedor cerrado
  const eliminarItemDeContenedor = (contIdx, itemLinea) => {
    const nuevos = [...contenedores]
    const cont = { ...nuevos[contIdx], items: [...nuevos[contIdx].items] }

    const agIdx = cont.items.findIndex(i => i.articulo_id === itemLinea.articulo_id)
    if (agIdx === -1) return

    const ag = { ...cont.items[agIdx] }

    if (itemLinea.es_pesable && ag.pesos_escaneados?.length) {
      const pesoQuitar = itemLinea.pesos_escaneados[0]
      const pidx = ag.pesos_escaneados.indexOf(pesoQuitar)
      if (pidx !== -1) {
        ag.pesos_escaneados = ag.pesos_escaneados.filter((_, i) => i !== pidx)
        ag.cantidad = Math.round((ag.cantidad - pesoQuitar) * 1000) / 1000
      }
      if (ag.pesos_escaneados.length === 0) {
        cont.items = cont.items.filter((_, i) => i !== agIdx)
      } else {
        cont.items[agIdx] = ag
      }
    } else {
      ag.cantidad = ag.cantidad - 1
      if (ag.cantidad <= 0) {
        cont.items = cont.items.filter((_, i) => i !== agIdx)
      } else {
        cont.items[agIdx] = ag
      }
    }

    let nuevosContenedores
    if (cont.items.length === 0) {
      nuevosContenedores = nuevos.filter((_, i) => i !== contIdx)
      setCanastoEditando(null)
    } else {
      nuevos[contIdx] = cont
      nuevosContenedores = nuevos
      // Mantener el modal abierto con el mismo índice
      setCanastoEditando(prev => prev ? { ...prev, idx: contIdx, confirmado: true } : null)
    }

    setContenedores(nuevosContenedores)
    // Recalcular progreso sincrónico
    setOrden(prev => {
      const itemsSinc = sincronizarProgreso(prev.items, nuevosContenedores, canastoActivo)
      persistirItems(itemsSinc)
      return { ...prev, items: itemsSinc }
    })
    mostrarFeedback('Artículo eliminado', true)
  }

  const [confirmarElimCont, _setConfirmarElimCont] = useState(null) // { idx, tipo, precinto, nombre, codigoEsperado }
  const confirmarElimContRef = useRef(null)
  const setConfirmarElimCont = (v) => { const val = typeof v === 'function' ? v(confirmarElimContRef.current) : v; confirmarElimContRef.current = val; _setConfirmarElimCont(val); if (!val) setTimeout(() => scanRef.current?.focus(), 150) }

  const [confirmarMoverACan, _setConfirmarMoverACan] = useState(null) // { idx, nombre, codigoEsperado, codigos }
  const confirmarMoverACanRef = useRef(null)
  const setConfirmarMoverACan = (v) => { const val = typeof v === 'function' ? v(confirmarMoverACanRef.current) : v; confirmarMoverACanRef.current = val; _setConfirmarMoverACan(val); if (!val) setTimeout(() => scanRef.current?.focus(), 150) }

  const pedirEliminarContenedor = (idx) => {
    const c = contenedores[idx]
    if (!c) return
    if (c.tipo === 'canasto') {
      setConfirmarElimCont({ idx, tipo: 'canasto', precinto: c.precinto, codigoEsperado: c.precinto })
    } else {
      // Bulto: pedir escanear el código del primer artículo
      const primerItem = c.items[0]
      const cat = todosArticulos.find(a => String(a.id) === String(primerItem?.articulo_id))
      const codigoEsperado = cat?.codigo || primerItem?.codigo
      const codigos = [codigoEsperado]
      if (cat?.codigosBarras) {
        for (const b of cat.codigosBarras) {
          codigos.push(typeof b === 'object' ? b.codigo : b)
        }
      }
      setConfirmarElimCont({ idx, tipo: 'bulto', nombre: c.nombre, codigoEsperado, codigos })
    }
  }

  const ejecutarEliminarContenedor = () => {
    const { idx } = confirmarElimContRef.current
    setContenedorExpandido(null)
    const nuevosContenedores = contenedores.filter((_, i) => i !== idx)
    setContenedores(nuevosContenedores)
    setOrden(prev => {
      const itemsSinc = sincronizarProgreso(prev.items, nuevosContenedores, canastoActivo)
      persistirItems(itemsSinc)
      return { ...prev, items: itemsSinc }
    })
    setConfirmarElimCont(null)
    mostrarFeedback('Contenedor eliminado', true)
  }

  const pedirMoverACanasto = (idx) => {
    const c = contenedores[idx]
    if (!c || c.tipo !== 'bulto' || !canastoActivo) return
    const primerItem = c.items[0]
    const cat = todosArticulos.find(a => String(a.id) === String(primerItem?.articulo_id))
    const codigoEsperado = cat?.codigo || primerItem?.codigo
    const codigos = [codigoEsperado]
    if (cat?.codigosBarras) {
      for (const b of cat.codigosBarras) {
        codigos.push(typeof b === 'object' ? b.codigo : b)
      }
    }
    setConfirmarMoverACan({ idx, nombre: c.nombre, codigoEsperado, codigos })
  }

  const ejecutarMoverACanasto = () => {
    const { idx } = confirmarMoverACanRef.current
    const c = contenedores[idx]
    if (!c || !canastoActivo) return
    // Merge items del contenedor al canasto activo
    setCanastoActivo(prev => {
      let updated = { ...prev, items: [...prev.items] }
      for (const ci of c.items) {
        const existente = updated.items.find(i => i.articulo_id === ci.articulo_id)
        if (existente) {
          updated = {
            ...updated,
            items: updated.items.map(i =>
              i.articulo_id === ci.articulo_id
                ? {
                    ...i,
                    cantidad: Math.round(((i.cantidad || 0) + (ci.cantidad || 0)) * 1000) / 1000,
                    pesos_escaneados: ci.pesos_escaneados
                      ? [...(i.pesos_escaneados || []), ...ci.pesos_escaneados]
                      : i.pesos_escaneados,
                  }
                : i
            ),
          }
        } else {
          updated = { ...updated, items: [...updated.items, { ...ci }] }
        }
      }
      return updated
    })
    // Eliminar contenedor
    setContenedorExpandido(null)
    const nuevosContenedores = contenedores.filter((_, i) => i !== idx)
    setContenedores(nuevosContenedores)
    setOrden(prev => {
      const itemsSinc = sincronizarProgreso(prev.items, nuevosContenedores, canastoActivo)
      persistirItems(itemsSinc)
      return { ...prev, items: itemsSinc }
    })
    setConfirmarMoverACan(null)
    mostrarFeedback('Contenedor agregado al canasto', true)
  }

  // Pesaje manual (para pesables en detalle)
  const confirmarPesoManual = () => {
    if (!itemDetalle) return
    const cantidad = parseInt(pesoManualCantidad, 10)
    const pesoTotal = parseFloat(pesoManualPeso)
    if (!cantidad || cantidad <= 0 || !pesoTotal || pesoTotal <= 0) return

    const promedio = Math.round((pesoTotal / cantidad) * 1000) / 1000
    const nuevosPesos = Array.from({ length: cantidad }, () => promedio)
    const balanzaFake = { pesoKg: pesoTotal }

    actualizarPesoMinMax(itemDetalle.articulo_id, promedio)

    if (canastoActivo) {
      // Agregar como items individuales al canasto
      for (let i = 0; i < cantidad; i++) {
        agregarACanastoActivo(itemDetalle, promedio, { pesoKg: promedio })
      }
    } else {
      crearBulto(itemDetalle, pesoTotal, null)
    }

    // Actualizar orden
    let nuevosItems
    setOrden(prev => {
      nuevosItems = (prev.items || []).map(i => {
        if (i.articulo_id !== itemDetalle.articulo_id) return i
        return {
          ...i,
          cantidad_preparada: Math.round(((i.cantidad_preparada || 0) + pesoTotal) * 1000) / 1000,
          pesos_escaneados: [...(i.pesos_escaneados || []), ...nuevosPesos],
        }
      })
      return { ...prev, items: nuevosItems }
    })
    setTimeout(() => { if (nuevosItems) persistirItems(nuevosItems) }, 0)

    mostrarFeedback(`+${cantidad} pzas (${pesoTotal}kg)`, true)
    setMostrarPesoManual(false)
    setPesoManualCantidad('')
    setPesoManualPeso('')
    setPesoManualError(null)
  }

  // Eliminar pieza individual (detalle pesable)
  // Buscar en qué contenedor/canasto está cada pieza de un artículo
  const buscarPiezasEnContenedores = (articuloId) => {
    const piezas = []
    // Contenedores cerrados
    for (let ci = 0; ci < contenedores.length; ci++) {
      const cont = contenedores[ci]
      for (const item of (cont.items || [])) {
        if (item.articulo_id !== articuloId) continue
        if (item.es_pesable && item.pesos_escaneados?.length) {
          for (const peso of item.pesos_escaneados) {
            piezas.push({ contenedorIdx: ci, contenedorNombre: cont.precinto || cont.nombre, tipo: cont.tipo, peso, es_pesable: true })
          }
        } else {
          for (let u = 0; u < (item.cantidad || 0); u++) {
            piezas.push({ contenedorIdx: ci, contenedorNombre: cont.precinto || cont.nombre, tipo: cont.tipo, peso: null, es_pesable: false })
          }
        }
      }
    }
    // Canasto activo
    if (canastoActivo) {
      for (const item of (canastoActivo.items || [])) {
        if (item.articulo_id !== articuloId) continue
        if (item.es_pesable && item.pesos_escaneados?.length) {
          for (const peso of item.pesos_escaneados) {
            piezas.push({ contenedorIdx: -1, contenedorNombre: canastoActivo.precinto, tipo: 'canasto', peso, es_pesable: true, enCanastoActivo: true })
          }
        } else {
          for (let u = 0; u < (item.cantidad || 0); u++) {
            piezas.push({ contenedorIdx: -1, contenedorNombre: canastoActivo.precinto, tipo: 'canasto', peso: null, es_pesable: false, enCanastoActivo: true })
          }
        }
      }
    }
    return piezas
  }

  const [piezaEliminando, setPiezaEliminando] = useState(null) // { pieza, esperandoScan }
  const piezaEliminandoRef = useRef(null)
  const setPiezaEliminandoSync = (v) => { const val = typeof v === 'function' ? v(piezaEliminandoRef.current) : v; piezaEliminandoRef.current = val; setPiezaEliminando(val) }

  // Confirmar eliminación de pieza escaneando canasto
  const confirmarEliminarPieza = (pieza) => {
    if (pieza.enCanastoActivo || pieza.tipo === 'bulto') {
      // Canasto activo o bulto: eliminar directo sin pedir scan
      ejecutarEliminarPieza(pieza)
      return
    }
    // Canasto cerrado: pedir confirmación por scan
    const precinto = contenedores[pieza.contenedorIdx]?.precinto
    setPiezaEliminandoSync({ pieza, esperandoScan: precinto })
  }

  const ejecutarEliminarPieza = (pieza) => {
    if (!itemDetalle) return
    const articuloId = itemDetalle.articulo_id

    let nuevosContenedores, nuevoCanasto

    if (pieza.enCanastoActivo) {
      // Quitar del canasto activo — calcular nuevo canasto
      const prev = canastoActivo
      if (!prev) return
      const updated = prev.items.map(i => {
        if (i.articulo_id !== articuloId) return i
        if (pieza.es_pesable && i.pesos_escaneados?.length) {
          const pidx = i.pesos_escaneados.indexOf(pieza.peso)
          if (pidx === -1) return i
          const nuevosPesos = i.pesos_escaneados.filter((_, idx) => idx !== pidx)
          const nuevaCant = Math.round((i.cantidad - pieza.peso) * 1000) / 1000
          if (nuevosPesos.length === 0) return null
          return { ...i, cantidad: nuevaCant, pesos_escaneados: nuevosPesos }
        } else {
          if (i.cantidad <= 1) return null
          return { ...i, cantidad: i.cantidad - 1 }
        }
      }).filter(Boolean)
      nuevoCanasto = { ...prev, items: updated }
      nuevosContenedores = contenedores
      setCanastoActivo(nuevoCanasto)
    } else {
      // Quitar del contenedor cerrado
      const nuevos = [...contenedores]
      const cont = { ...nuevos[pieza.contenedorIdx], items: [...nuevos[pieza.contenedorIdx].items] }
      const agIdx = cont.items.findIndex(i => i.articulo_id === articuloId)
      if (agIdx === -1) return
      const ag = { ...cont.items[agIdx] }

      if (pieza.es_pesable && ag.pesos_escaneados?.length) {
        const pidx = ag.pesos_escaneados.indexOf(pieza.peso)
        if (pidx !== -1) {
          ag.pesos_escaneados = ag.pesos_escaneados.filter((_, i) => i !== pidx)
          ag.cantidad = Math.round((ag.cantidad - pieza.peso) * 1000) / 1000
        }
        if (ag.pesos_escaneados.length === 0) cont.items = cont.items.filter((_, i) => i !== agIdx)
        else cont.items[agIdx] = ag
      } else {
        ag.cantidad = ag.cantidad - 1
        if (ag.cantidad <= 0) cont.items = cont.items.filter((_, i) => i !== agIdx)
        else cont.items[agIdx] = ag
      }

      if (cont.items.length === 0) nuevos.splice(pieza.contenedorIdx, 1)
      else nuevos[pieza.contenedorIdx] = cont
      nuevosContenedores = nuevos
      nuevoCanasto = canastoActivo
      setContenedores(nuevos)
    }

    // Recalcular progreso directo con los datos ya calculados
    setOrden(prev => {
      const itemsSinc = sincronizarProgreso(prev.items, nuevosContenedores, nuevoCanasto)
      persistirItems(itemsSinc)
      return { ...prev, items: itemsSinc }
    })

    setPiezaEliminandoSync(null)
    mostrarFeedback('Artículo eliminado', true)
  }

  // === FINALIZACIÓN ===
  const calcularPendientes = () => {
    return itemsEnriquecidos
      .map(item => ({
        ...item,
        cantidad_preparada_real: item.cantidad_preparada || 0,
        cantidad_faltante: Math.round(((item.cantidad_solicitada || 0) - (item.cantidad_preparada || 0)) * 1000) / 1000,
      }))
      .filter(item => item.cantidad_faltante > 0)
  }

  const marcarPreparado = () => {
    // Si hay canasto abierto, cerrarlo primero
    if (canastoActivo) {
      setPesoCanasto('')
      setModalCerrarCanasto({ precinto: null })
      return
    }

    const pendientes = calcularPendientes()
    if (pendientes.length > 0) {
      setModalPendientes({ fase: 'pregunta', pendientes, motivos: {} })
      return
    }
    setFase('finalizar')
  }

  const confirmarConPendientes = async (crearNuevaOrden) => {
    setEnviandoPendientes(true)
    try {
      const pendientes = modalPendientes.pendientes
      const motivos = modalPendientes.motivos
      const articulosFaltantes = pendientes.map(p => ({
        articulo_id: p.articulo_id,
        nombre: p.nombre,
        codigo: p.codigo,
        cantidad_solicitada: p.cantidad_solicitada || 0,
        cantidad_preparada: p.cantidad_preparada_real,
        cantidad_faltante: p.cantidad_faltante,
        motivo: crearNuevaOrden ? null : (motivos[p.articulo_id] || null),
      }))
      faltantesRef.current = { articulosFaltantes, crearNuevaOrden }
      setModalPendientes(null)
      setFase('finalizar')
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setEnviandoPendientes(false)
    }
  }

  const confirmarFinal = async () => {
    const todosContenedores = [...contenedores]
    const canastos = todosContenedores.filter(c => c.tipo === 'canasto')
    const bultos = todosContenedores.filter(c => c.tipo === 'bulto')

    if (canastos.length === 0 && bultos.length === 0 && palletsPrep.length === 0) {
      alert('No hay contenedores para confirmar')
      return
    }
    const sinPesoIdx = canastos.findIndex((c, i) => {
      const realIdx = todosContenedores.indexOf(c)
      return !c.peso_origen || c.peso_origen <= 0
    })
    if (sinPesoIdx !== -1) {
      const realIdx = todosContenedores.findIndex(c => c.tipo === 'canasto' && (!c.peso_origen || c.peso_origen <= 0))
      setPesandoCanastoIdx(realIdx)
      setPesandoCanastoPeso('')
      return
    }

    setEnviando(true)
    try {
      const body = {
        canastos: canastos.map(c => ({
          precinto: c.precinto,
          peso_origen: c.peso_origen,
          items: c.items,
        })),
        bultos: bultos.map(b => ({
          nombre: b.nombre || 'Bulto',
          items: b.items,
        })),
        pallets: palletsPrep,
        observacion: observacion.trim() || undefined,
      }
      if (faltantesRef.current) {
        body.articulos_faltantes = faltantesRef.current.articulosFaltantes
        body.crear_nueva_orden = faltantesRef.current.crearNuevaOrden
      }

      const res = await api.post(`/api/traspasos/ordenes/${id}/preparar-con-canastos`, body)

      if (res.data.pallets_creados) {
        for (const pallet of res.data.pallets_creados) {
          imprimirPallet(pallet, {
            numero: orden.numero,
            sucursal_origen_nombre: orden.sucursal_origen_nombre,
            sucursal_destino_nombre: orden.sucursal_destino_nombre,
          })
        }
      }
      if (res.data.nueva_orden_numero) {
        alert(`Orden cerrada. Se creó nueva orden ${res.data.nueva_orden_numero} con los pendientes.`)
      }
      navigate('/preparacion')
    } catch (err) {
      alert(err.response?.data?.error || 'Error al confirmar')
    } finally {
      setEnviando(false)
    }
  }

  // Agregar pallet
  const agregarPallet = () => {
    const bultos = parseInt(palletBultos)
    if (!bultos || bultos <= 0) return
    setPalletsPrep(prev => [...prev, { cantidad_bultos: bultos, items_descripcion: palletDesc.trim() }])
    setPalletBultos('')
    setPalletDesc('')
    setModalPallet(false)
  }

  // === MOTIVOS FALTANTE ===
  const MOTIVOS_FALTANTE = [
    { value: 'falta_stock', label: 'Falta de stock' },
    { value: 'articulo_danado', label: 'Artículo dañado' },
    { value: 'error_pedido', label: 'Error en el pedido' },
    { value: 'otro', label: 'Otro' },
  ]

  // === RENDER ===
  if (cargando) return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  if (!orden) return null

  const totalContenedores = contenedores.length + (canastoActivo ? 1 : 0) + palletsPrep.length

  // ═══════════════════════════════════════
  // FASE: DETALLE DE ARTÍCULO
  // ═══════════════════════════════════════
  if (fase === 'detalle' && itemDetalle) {
    const pickKg = pickEnKg(itemDetalle)
    const pick = pickKg
    const stock = stockOrigen[itemDetalle.articulo_id]
    const pedidoPiezas = cantidadEnPiezas(itemDetalle)
    const pickPiezas = pickEnPiezas(itemDetalle)
    const completo = pickPiezas >= pedidoPiezas

    return (
      <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
        <div className="bg-sky-600 text-white px-2 py-2 flex items-center gap-2 flex-shrink-0">
          <button onClick={() => { setFase('picking'); setItemDetalle(null); setMostrarPiezas(false); setTimeout(() => scanRef.current?.focus(), 300) }}
            className="p-2 rounded-lg active:bg-sky-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="font-semibold text-sm flex-1">{orden.numero}</span>
          {canastoActivo && (
            <span className="text-xs bg-sky-500 px-2 py-0.5 rounded-full">🧺 {canastoActivo.precinto}</span>
          )}
        </div>

        {feedback && (
          <div className={`px-4 py-1.5 text-sm font-medium text-center flex-shrink-0 ${feedback.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {feedback.msg}
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col px-3 py-2 gap-2 overflow-hidden">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1 min-h-0 flex items-center justify-center">
            <img src={`${API_BASE}/api/articulos/${itemDetalle.articulo_id}/imagen`} alt={itemDetalle.nombre}
              className="w-full h-full object-contain bg-gray-50" />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-2.5 flex items-center gap-3 flex-shrink-0">
            <CirculoProgreso actual={pickPiezas} total={pedidoPiezas} size={46} />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-gray-800 leading-tight truncate">{itemDetalle.nombre}</h2>
              <div className="text-xs text-gray-400">
                {itemDetalle.codigo}
                {itemDetalle.es_pesable && (itemDetalle.pesoMinimo || itemDetalle.pesoMaximo) && (
                  <span className="ml-1 text-gray-500">· {itemDetalle.pesoMinimo || '—'}kg – {itemDetalle.pesoMaximo || '—'}kg</span>
                )}
              </div>
              <div className={`text-base font-bold ${completo ? 'text-emerald-600' : 'text-gray-800'}`}>
                {pickPiezas} / {pedidoPiezas}
                <span className="text-xs font-normal text-gray-500 ml-1">{itemDetalle.es_pesable ? 'piezas' : 'unidades'}</span>
                {itemDetalle.es_pesable && <span className="text-xs font-semibold text-sky-600 ml-1">· {pick} kg</span>}
                {completo && <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium ml-2">Completo</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Piezas validadas */}
        {mostrarPiezas && (() => {
          const piezas = buscarPiezasEnContenedores(itemDetalle.articulo_id)
          if (piezas.length === 0) return null

          return (
            <div className="fixed inset-0 z-40 bg-black/40 flex flex-col justify-end" onClick={() => { setMostrarPiezas(false); setPiezaEliminandoSync(null) }}>
              <div className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                  <h3 className="text-base font-semibold text-gray-800">Piezas validadas</h3>
                  <button onClick={() => { setMostrarPiezas(false); setPiezaEliminandoSync(null) }} className="p-2 rounded-lg active:bg-gray-100">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {/* Confirmación de scan para eliminar */}
                {piezaEliminando?.esperandoScan && (
                  <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-center">
                    <div className="text-sm font-medium text-amber-800">Escaneá <span className="font-bold">{piezaEliminando.esperandoScan}</span> para confirmar</div>
                    <button onClick={() => setPiezaEliminandoSync(null)} className="text-xs text-amber-600 mt-1 underline">Cancelar</button>
                    <input autoFocus inputMode="none" className="opacity-0 absolute w-0 h-0"
                      value={scanInput}
                      onChange={(e) => {
                        const val = e.target.value
                        setScanInput(val)
                        scanBufferRef.current = val
                        clearTimeout(scanTimeoutRef.current)
                        scanTimeoutRef.current = setTimeout(() => {
                          const codigo = scanBufferRef.current.trim()
                          scanBufferRef.current = ''
                          setScanInput('')
                          if (codigo) handleScanCodigoRef.current?.(codigo)
                        }, 200)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          clearTimeout(scanTimeoutRef.current)
                          const codigo = scanBufferRef.current.trim()
                          scanBufferRef.current = ''
                          setScanInput('')
                          if (codigo) handleScanCodigoRef.current?.(codigo)
                        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                          scanBufferRef.current += e.key
                          setScanInput(scanBufferRef.current)
                        }
                      }}
                    />
                  </div>
                )}
                <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
                  {piezas.map((pieza, idx) => (
                    <div key={idx} className={`flex items-center justify-between px-4 py-3 ${
                      piezaEliminando?.pieza === pieza ? 'bg-red-50' : ''
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className="bg-sky-100 text-sky-700 text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center">{idx + 1}</span>
                        <div>
                          <span className="text-base font-medium text-gray-800">
                            {pieza.es_pesable ? `${pieza.peso} kg` : `Unidad ${idx + 1}`}
                          </span>
                          <div className="text-xs text-gray-400">
                            {pieza.tipo === 'canasto' ? '🧺' : '📋'} {pieza.contenedorNombre}
                            {pieza.enCanastoActivo && <span className="text-amber-600 ml-1">(abierto)</span>}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => confirmarEliminarPieza(pieza)}
                        disabled={!!piezaEliminando}
                        className="text-red-400 active:text-red-600 p-1 disabled:opacity-30">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Pesaje manual modal */}
        {mostrarPesoManual && (() => {
          const cant = parseInt(pesoManualCantidad, 10) || 0
          const peso = parseFloat(pesoManualPeso) || 0
          const promedio = cant > 0 && peso > 0 ? peso / cant : 0
          const valido = cant > 0 && peso > 0
          return (
            <div className="fixed inset-0 z-40 bg-black/40 flex flex-col justify-end" onClick={() => setMostrarPesoManual(false)}>
              <div className="bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-base font-semibold text-gray-800">Pesaje manual — {itemDetalle.nombre}</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Cantidad de piezas</label>
                    <input type="number" inputMode="numeric" min="1" step="1" autoFocus
                      value={pesoManualCantidad} onChange={e => setPesoManualCantidad(e.target.value)}
                      className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Peso total (kg)</label>
                    <input type="number" inputMode="decimal" min="0.001" step="0.001"
                      value={pesoManualPeso} onChange={e => setPesoManualPeso(e.target.value)}
                      className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 outline-none" />
                  </div>
                </div>
                {valido && (
                  <div className="rounded-xl px-4 py-3 text-center bg-sky-50 border border-sky-200">
                    <div className="text-2xl font-bold text-sky-700">{promedio.toFixed(3)} kg/pza</div>
                  </div>
                )}
                <button onClick={confirmarPesoManual} disabled={!valido}
                  className={`w-full py-4 rounded-xl text-base font-semibold ${valido ? 'bg-sky-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  Confirmar {valido ? `· ${cant} pzas · ${peso}kg` : ''}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Alerta peso fuera de rango */}
        {alertaPeso && (
          <div className="fixed inset-0 z-50 bg-amber-500 flex flex-col items-center justify-center p-6">
            <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
              <div className="bg-amber-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-10 h-10 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-amber-700">Peso fuera de rango</h2>
              <div className="text-3xl font-bold text-amber-600">{alertaPeso.peso} kg</div>
              <div className="text-sm text-gray-500">Rango: {alertaPeso.min || '—'} – {alertaPeso.max || '—'} kg</div>
              <div className="flex gap-3 pt-2">
                <button onPointerDown={() => setAlertaPeso(null)}
                  className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-xl text-lg font-semibold">No</button>
                <button onPointerDown={() => confirmarPesoFueraDeRango()}
                  className="flex-1 bg-amber-500 text-white py-4 rounded-xl text-lg font-semibold">Sí</button>
              </div>
            </div>
          </div>
        )}

        {/* Barra inferior */}
        <div className="bg-white border-t border-gray-200 px-3 py-2 space-y-1.5 flex-shrink-0 safe-area-bottom">
          <div className="flex gap-2">
            {tecladoVisible ? (
              <input ref={inputManualRef} type="text" inputMode="numeric" value={scanInput}
                onChange={e => { setScanInput(e.target.value); scanBufferRef.current = e.target.value }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const codigo = scanInput.trim()
                    if (!codigo) return
                    setScanInput('')
                    scanBufferRef.current = ''
                    handleScanDetalle(codigo)
                    setTecladoVisible(false)
                  }
                }}
                onBlur={() => { if (!scanInput) setTecladoVisible(false) }}
                placeholder="Escribir código..."
                autoComplete="off" autoFocus
                className="flex-1 border-2 border-sky-300 rounded-xl px-4 py-3 text-base text-center focus:border-sky-500 outline-none" />
            ) : (
              <input
                ref={scanDivDetalleRef}
                type="text"
                inputMode="none"
                value={scanInput}
                onChange={handleScanInputChange}
                onKeyDown={handleScanInputKeyDown}
                placeholder="Escanear código de barras..."
                autoComplete="off"
                className="flex-1 border-2 border-sky-300 rounded-xl px-4 py-3 text-base text-center outline-none caret-transparent"
              />
            )}
            <button onClick={() => { setTecladoVisible(v => !v); setTimeout(() => inputManualRef.current?.focus(), 100) }}
              className={`px-3 rounded-xl border-2 ${tecladoVisible ? 'border-sky-500 bg-sky-50 text-sky-600' : 'border-gray-300 text-gray-400'}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
              </svg>
            </button>
          </div>
          {itemDetalle.es_pesable && (
            <button onClick={() => { setMostrarPesoManual(true); setPesoManualCantidad(''); setPesoManualPeso('') }}
              className="w-full text-xs text-gray-400 active:text-gray-600 py-0.5">Pesar manual</button>
          )}
          {pickPiezas > 0 && (
            <button onClick={() => setMostrarPiezas(true)}
              className="w-full bg-sky-50 border-2 border-sky-300 text-sky-700 py-2.5 rounded-xl text-sm font-semibold">
              Validado · {pickPiezas} {itemDetalle.es_pesable ? 'piezas' : 'unidades'}
              {itemDetalle.es_pesable && <span className="font-normal text-sky-500"> · {pick} kg</span>}
            </button>
          )}
        </div>

        {alertaFullscreen && (
          <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${
            alertaFullscreen.tipo === 'info' ? 'bg-amber-500' : alertaFullscreen.ok ? 'bg-emerald-500' : 'bg-red-600 animate-pulse'
          }`}
            onClick={() => setAlertaFullscreen(null)}>
            <div className="text-center px-6">
              {alertaFullscreen.tipo === 'info' ? (
                <svg className="w-24 h-24 text-white mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : alertaFullscreen.ok ? (
                <svg className="w-24 h-24 text-white mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-24 h-24 text-white mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              )}
              <div className="text-white text-2xl font-bold">{alertaFullscreen.msg}</div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════
  // FASE: FINALIZAR
  // ═══════════════════════════════════════
  if (fase === 'finalizar') {
    const canastos = contenedores.filter(c => c.tipo === 'canasto')
    const bultos = contenedores.filter(c => c.tipo === 'bulto')
    const puedeConfirmar = (canastos.length > 0 || bultos.length > 0 || palletsPrep.length > 0) && !enviando

    return (
      <div className="min-h-screen bg-gray-100 pb-24">
        <div className="bg-sky-600 text-white px-2 py-2 flex items-center gap-2">
          <button onClick={() => { setFase('picking'); setTimeout(() => scanRef.current?.focus(), 300) }} className="p-2 rounded-lg active:bg-sky-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="text-base font-medium">Confirmar preparación</div>
            <div className="text-sky-200 text-sm">{orden.numero}</div>
          </div>
        </div>

        <div className="px-3 py-3 space-y-3">
          {/* Canastos */}
          {canastos.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">🧺 Canastos ({canastos.length})</h3>
              {canastos.map((c, idx) => (
                <div key={idx} className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono font-medium text-sm text-gray-800">{c.precinto}</span>
                      <span className="text-xs text-gray-500 ml-2">{c.peso_origen ? `${c.peso_origen} kg` : 'Sin pesar'} · {c.items.length} art.</span>
                    </div>
                  </div>
                  {c.items.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {c.items.map((item, i) => (
                        <div key={i} className="text-xs text-gray-600 flex justify-between">
                          <span className="truncate">{item.nombre}</span>
                          <span className="font-medium ml-2 flex-shrink-0">
                            {item.es_pesable ? `${item.cantidad} kg` : `${item.cantidad} u`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Bultos */}
          {bultos.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">📋 Bultos ({bultos.length})</h3>
              {bultos.map((b, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                  <div className="text-sm font-medium text-gray-800">{b.nombre}</div>
                  {b.items.map((item, i) => (
                    <div key={i} className="text-xs text-gray-500">
                      {item.codigo} · {item.es_pesable ? `${item.cantidad} kg` : `${item.cantidad} u`}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Pallets */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">📦 Pallets ({palletsPrep.length})</h3>
              <button onClick={() => { setModalPallet(true); setPalletBultos(''); setPalletDesc('') }}
                className="text-sm bg-orange-100 text-orange-700 px-3 py-1.5 rounded-lg font-medium">
                + Pallet
              </button>
            </div>
            {palletsPrep.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-orange-50 rounded-lg p-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{p.cantidad_bultos} bultos</div>
                  {p.items_descripcion && <div className="text-xs text-gray-500">{p.items_descripcion}</div>}
                </div>
                <button onClick={() => setPalletsPrep(prev => prev.filter((_, i) => i !== idx))}
                  className="text-red-400 p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Observación */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="text-sm font-medium text-gray-700">Observación (opcional)</label>
            <textarea value={observacion} onChange={e => setObservacion(e.target.value)}
              placeholder="Notas..." rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none mt-1 focus:border-sky-400 outline-none" />
          </div>
        </div>

        {/* Modal pallet */}
        {modalPallet && (
          <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setModalPallet(false)}>
            <div className="bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-gray-800">Nuevo Pallet</h3>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Cantidad de bultos *</label>
                <input type="number" min="1" value={palletBultos} onChange={e => setPalletBultos(e.target.value)} autoFocus
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-lg text-center focus:border-orange-500 outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Descripción</label>
                <input type="text" value={palletDesc} onChange={e => setPalletDesc(e.target.value)}
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-sm focus:border-orange-500 outline-none" />
              </div>
              <button onClick={agregarPallet} disabled={!palletBultos || parseInt(palletBultos) <= 0}
                className={`w-full py-3.5 rounded-xl text-sm font-semibold ${palletBultos && parseInt(palletBultos) > 0 ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
                Agregar Pallet
              </button>
            </div>
          </div>
        )}

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 safe-area-bottom">
          <button onClick={confirmarFinal} disabled={!puedeConfirmar}
            className={`w-full py-3.5 rounded-xl text-sm font-semibold ${puedeConfirmar ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
            {enviando ? 'Procesando...' : `Confirmar preparación (${canastos.length} canastos, ${bultos.length} bultos)`}
          </button>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════
  // FASE: PICKING (principal)
  // ═══════════════════════════════════════
  const itemsPendientes = []
  const itemsCompletos = []
  for (const item of itemsOrdenados) {
    const piezas = item.es_pesable && Array.isArray(item.pesos_escaneados) ? item.pesos_escaneados.length : (item.cantidad_preparada || 0)
    const pedidas = item.es_pesable && item.pppOrden ? Math.round(item.cantidad_solicitada / item.pppOrden) : item.cantidad_solicitada
    if (piezas >= pedidas) {
      itemsCompletos.push(item)
    } else {
      itemsPendientes.push(item)
    }
  }
  const rubroGroups = {}
  for (const item of itemsPendientes) {
    const rubro = item.rubro || 'Sin rubro'
    if (!rubroGroups[rubro]) rubroGroups[rubro] = []
    rubroGroups[rubro].push(item)
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-36">
      {/* Scanner capturado via keydown global — sin input oculto */}
      {/* Banner */}
      <div className="bg-sky-600 text-white px-2 py-2 flex items-center gap-2">
        <button onClick={() => navigate('/preparacion')} className="p-2 rounded-lg active:bg-sky-700">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="text-base font-medium">{orden.sucursal_origen_nombre} → {orden.sucursal_destino_nombre}</div>
          <div className="text-sky-200 text-sm">{orden.numero} · {itemsOrdenados.length} artículos</div>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`px-4 py-1.5 text-sm font-medium text-center ${feedback.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {feedback.msg}
        </div>
      )}

      {/* Canasto activo */}
      {canastoActivo && (
        <div className="mx-3 mt-3 bg-amber-50 rounded-xl border-2 border-amber-300 p-3 cursor-pointer active:bg-amber-100"
          onClick={() => canastoActivo.items.length > 0 && setModalEditarCanasto(true)}>
          <div className="flex items-center gap-2">
            <span className="text-xl">🧺</span>
            <div>
              <div className="font-semibold text-sm text-amber-800">Canasto abierto: {canastoActivo.precinto}</div>
              <div className="text-xs text-amber-600">{canastoActivo.items.length} artículos dentro</div>
            </div>
          </div>
          {canastoActivo.items.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {canastoActivo.items.map((item, idx) => (
                <div key={idx} className="text-xs text-amber-700 flex justify-between bg-amber-100/50 rounded px-2 py-1">
                  <span className="truncate">{item.nombre}</span>
                  <span className="font-medium ml-2 flex-shrink-0">
                    {item.es_pesable ? `${item.cantidad} kg` : `${item.cantidad} u`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal editar canasto */}
      {modalEditarCanasto && canastoActivo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setModalEditarCanasto(false)}>
          <div className="bg-white rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">Canasto {canastoActivo.precinto}</h3>
              <button onClick={() => setModalEditarCanasto(false)} className="text-gray-400 p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {canastoActivo.items.map((item, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-3">
                  <div className="text-sm font-medium text-gray-800 truncate">{item.nombre}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {item.es_pesable ? `${item.cantidad} kg` : `${item.cantidad} u`}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => {
                      const max = item.cantidad
                      const cant = item.es_pesable ? max : (max === 1 ? 1 : parseInt(prompt(`Cantidad a quitar (max ${max}):`) || '0'))
                      if (cant > 0 && cant <= max) {
                        quitarDeCanasto(item.articulo_id, cant)
                        if (cant >= max) setModalEditarCanasto(false)
                      }
                    }}
                      className="flex-1 text-xs py-2 rounded-lg border border-red-200 text-red-600 font-medium active:bg-red-50">
                      Eliminar
                    </button>
                    <button onClick={() => {
                      const max = item.cantidad
                      const cant = item.es_pesable ? max : (max === 1 ? 1 : parseInt(prompt(`Cantidad a mover a bulto (max ${max}):`) || '0'))
                      if (cant > 0 && cant <= max) {
                        moverABulto(item.articulo_id, cant)
                        if (cant >= max) setModalEditarCanasto(false)
                      }
                    }}
                      className="flex-1 text-xs py-2 rounded-lg border border-blue-200 text-blue-600 font-medium active:bg-blue-50">
                      Mover a bulto
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal editar canasto cerrado — paso 1: pedir scan, paso 2: editar items */}
      {canastoEditando && (() => {
        const cont = contenedores[canastoEditando.idx]
        if (!cont) return null
        const confirmado = canastoEditando.confirmado
        const lineas = confirmado ? expandirItemsContenedor(cont.items) : []
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setCanastoEditando(null)}>
            <div className="bg-white rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">Canasto {cont.precinto}</h3>
                  <div className="text-xs text-gray-400">{cont.peso_origen ? `${cont.peso_origen}kg` : 'Sin pesar'} · {cont.items.reduce((s, i) => s + (i.es_pesable && i.pesos_escaneados ? i.pesos_escaneados.length : (i.cantidad || 0)), 0)} piezas</div>
                </div>
                <button onClick={() => setCanastoEditando(null)} className="text-gray-400 p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {!confirmado ? (
                <div className="p-8 text-center">
                  <div className="text-4xl mb-3">📷</div>
                  <div className="text-sm font-medium text-gray-700">Escaneá el precinto del canasto</div>
                  <div className="text-xs text-gray-400 mt-1">Escaneá <span className="font-semibold">{cont.precinto}</span> para verificar y editar</div>
                  {/* Input oculto para capturar escaneo dentro del modal */}
                  <input
                    autoFocus
                    inputMode="none"
                    className="opacity-0 absolute w-0 h-0"
                    value={scanInput}
                    onChange={(e) => {
                      const val = e.target.value
                      setScanInput(val)
                      scanBufferRef.current = val
                      clearTimeout(scanTimeoutRef.current)
                      scanTimeoutRef.current = setTimeout(() => {
                        const codigo = scanBufferRef.current.trim()
                        scanBufferRef.current = ''
                        setScanInput('')
                        if (codigo) handleScanCodigoRef.current?.(codigo)
                      }, 200)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        clearTimeout(scanTimeoutRef.current)
                        const codigo = scanBufferRef.current.trim()
                        scanBufferRef.current = ''
                        setScanInput('')
                        if (codigo) handleScanCodigoRef.current?.(codigo)
                      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                        scanBufferRef.current += e.key
                        setScanInput(scanBufferRef.current)
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="overflow-y-auto flex-1 p-4 space-y-2">
                  {lineas.map((linea, idx) => (
                    <div key={idx} className="flex items-center gap-3 border border-gray-200 rounded-xl p-3">
                      <img src={`${API_BASE}/api/articulos/${linea.articulo_id}/imagen`} alt=""
                        className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                        onError={e => { e.target.style.display = 'none' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{linea.nombre}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {linea.codigo}
                          {linea.es_pesable && <span className="ml-1 font-medium text-gray-600">· {linea.cantidad}kg</span>}
                        </div>
                      </div>
                      <button onClick={() => eliminarItemDeContenedor(canastoEditando.idx, linea)}
                        className="text-red-500 p-2 rounded-lg border border-red-200 active:bg-red-50">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {lineas.length === 0 && (
                    <div className="text-center text-gray-400 py-4">Canasto vacío</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Sin canasto: indicador */}
      {!canastoActivo && (
        <div className="mx-3 mt-3 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 p-3 text-center">
          <div className="text-sm text-gray-500">Sin canasto abierto</div>
          <div className="text-xs text-gray-400 mt-0.5">Escaneá un precinto para abrir un canasto, o escaneá artículos para crear bultos</div>
        </div>
      )}

      {/* Contenedores cerrados */}
      {contenedores.length > 0 && (
        <div className="mx-3 mt-3">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            Contenedores ({contenedores.length})
          </div>
          <div className="space-y-1">
            {contenedores.map((c, idx) => (
              <div key={idx} className={`rounded-lg text-xs ${
                c.tipo === 'canasto' ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'
              }`}>
                <div className="flex items-center gap-2 p-2 cursor-pointer" onClick={() => {
                  if (c.tipo === 'canasto') {
                    setCanastoEditando({ idx, esperandoScan: c.precinto })
                  } else {
                    setContenedorExpandido(contenedorExpandido === idx ? null : idx)
                  }
                }}>
                  <span className="text-base">{c.tipo === 'canasto' ? '🧺' : '📋'}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-800">{c.tipo === 'canasto' ? c.precinto : c.nombre}</span>
                    <span className="text-gray-400 ml-1">
                      {c.tipo === 'canasto' && (c.peso_origen ? `· ${c.peso_origen}kg` : '· Sin pesar')}
                      {` · ${c.items.length} art.`}
                    </span>
                  </div>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${contenedorExpandido === idx ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                  {canastoActivo && c.tipo === 'bulto' && (
                    <button onClick={(e) => { e.stopPropagation(); pedirMoverACanasto(idx) }} className="text-blue-500 p-1" title="Agregar al canasto">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                      </svg>
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); pedirEliminarContenedor(idx) }} className="text-red-400 p-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {contenedorExpandido === idx && (
                  <div className="px-3 pb-2 pt-0 border-t border-gray-200/60 space-y-1">
                    {c.items.map((ci, ciIdx) => (
                      <div key={ciIdx} className="flex items-center gap-2 py-1">
                        <img src={`${API_BASE}/api/articulos/${ci.articulo_id}/imagen`} alt=""
                          className="w-8 h-8 rounded object-cover bg-gray-100 flex-shrink-0"
                          onError={e => { e.target.style.display = 'none' }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-700 truncate">{ci.nombre}</div>
                          <div className="text-[10px] text-gray-400">{ci.codigo}</div>
                        </div>
                        <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">
                          {ci.es_pesable && ci.pesos_escaneados
                            ? `${ci.pesos_escaneados.length} pza · ${ci.cantidad}kg`
                            : `x${ci.cantidad}`
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de artículos del pedido */}
      <div className="px-3 py-3 space-y-4">
        {Object.entries(rubroGroups).map(([rubro, items]) => (
          <div key={rubro}>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 mb-1.5">{rubro}</div>
            <div className="space-y-1.5">
              {items.map((item, idx) => {
                const piezasPedidas = cantidadEnPiezas(item)
                const piezasPick = pickEnPiezas(item)
                return (
                  <button key={idx}
                    ref={el => { itemRefs.current[item.articulo_id] = el }}
                    onClick={() => { completoAlAbrir.current = piezasPick >= piezasPedidas; setItemDetalle(item); setFase('detalle'); setMostrarPiezas(false) }}
                    className={`w-full text-left rounded-xl border overflow-hidden flex items-center gap-3 p-3 active:bg-gray-50 transition-colors duration-700 ${
                      ultimoEscaneado === item.articulo_id
                        ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300'
                        : 'bg-white border-gray-200'
                    }`}>
                    <img src={`${API_BASE}/api/articulos/${item.articulo_id}/imagen`} alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                      onError={e => { e.target.style.display = 'none' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-gray-800">{item.nombre}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.codigo}
                        {item.marca && <span className="ml-1">· {item.marca}</span>}
                        {stockOrigen[item.articulo_id] != null && (
                          <span className="ml-1">· Stock: {stockOrigen[item.articulo_id]}</span>
                        )}
                      </div>
                      <div className="text-xs mt-0.5 font-medium text-blue-600">
                        {piezasPick}/{piezasPedidas} {item.es_pesable ? 'piezas' : 'unidades'}
                      </div>
                    </div>
                    <CirculoProgreso actual={piezasPick} total={piezasPedidas} size={44} />
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Artículos completados */}
        {itemsCompletos.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wide px-1 mb-1.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Completados ({itemsCompletos.length})
            </div>
            <div className="space-y-1.5">
              {itemsCompletos.map((item, idx) => {
                const piezasPedidas = cantidadEnPiezas(item)
                const piezasPick = pickEnPiezas(item)
                return (
                  <button key={idx}
                    ref={el => { itemRefs.current[item.articulo_id] = el }}
                    onClick={() => { completoAlAbrir.current = true; setItemDetalle(item); setFase('detalle'); setMostrarPiezas(false) }}
                    className={`w-full text-left rounded-xl border overflow-hidden flex items-center gap-3 p-3 active:bg-gray-50 transition-colors duration-700 ${
                      ultimoEscaneado === item.articulo_id
                        ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300'
                        : 'bg-emerald-50/50 border-emerald-200'
                    }`}>
                    <img src={`${API_BASE}/api/articulos/${item.articulo_id}/imagen`} alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                      onError={e => { e.target.style.display = 'none' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-emerald-700">{item.nombre}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.codigo}
                        {item.marca && <span className="ml-1">· {item.marca}</span>}
                      </div>
                      <div className="text-xs mt-0.5 font-medium text-emerald-600">
                        {piezasPick}/{piezasPedidas} {item.es_pesable ? 'piezas' : 'unidades'}
                      </div>
                    </div>
                    <CirculoProgreso actual={piezasPick} total={piezasPedidas} size={44} />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal confirmar eliminación de contenedor */}
      {confirmarElimCont && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-12" onClick={() => setConfirmarElimCont(null)}>
          <div className="bg-white rounded-2xl w-[90%] max-w-sm p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl mb-2">{confirmarElimCont.tipo === 'canasto' ? '🧺' : '📋'}</div>
              <h3 className="text-base font-semibold text-gray-800">
                {confirmarElimCont.tipo === 'canasto'
                  ? `¿Eliminar canasto ${confirmarElimCont.precinto}?`
                  : `¿Eliminar bulto ${confirmarElimCont.nombre}?`
                }
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {confirmarElimCont.tipo === 'canasto'
                  ? `Escaneá ${confirmarElimCont.precinto} para confirmar`
                  : 'Escaneá el artículo del bulto para confirmar'
                }
              </p>
              <input autoFocus inputMode="none" className="opacity-0 absolute w-0 h-0"
                value={scanInput}
                onChange={(e) => {
                  const val = e.target.value
                  setScanInput(val)
                  scanBufferRef.current = val
                  clearTimeout(scanTimeoutRef.current)
                  scanTimeoutRef.current = setTimeout(() => {
                    const codigo = scanBufferRef.current.trim()
                    scanBufferRef.current = ''
                    setScanInput('')
                    if (codigo) handleScanCodigoRef.current?.(codigo)
                  }, 200)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    clearTimeout(scanTimeoutRef.current)
                    const codigo = scanBufferRef.current.trim()
                    scanBufferRef.current = ''
                    setScanInput('')
                    if (codigo) handleScanCodigoRef.current?.(codigo)
                  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    scanBufferRef.current += e.key
                    setScanInput(scanBufferRef.current)
                  }
                }}
              />
              <button onClick={() => setConfirmarElimCont(null)}
                className="mt-4 w-full py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 active:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar mover contenedor a canasto */}
      {confirmarMoverACan && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-12" onClick={() => setConfirmarMoverACan(null)}>
          <div className="bg-white rounded-2xl w-[90%] max-w-sm p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="text-3xl mb-2">🧺</div>
              <h3 className="text-base font-semibold text-gray-800">
                {`¿Agregar ${confirmarMoverACan.nombre} al canasto ${canastoActivo?.precinto}?`}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Escaneá el artículo para confirmar
              </p>
              <input autoFocus inputMode="none" className="opacity-0 absolute w-0 h-0"
                value={scanInput}
                onChange={(e) => {
                  const val = e.target.value
                  setScanInput(val)
                  scanBufferRef.current = val
                  clearTimeout(scanTimeoutRef.current)
                  scanTimeoutRef.current = setTimeout(() => {
                    const codigo = scanBufferRef.current.trim()
                    scanBufferRef.current = ''
                    setScanInput('')
                    if (codigo) handleScanCodigoRef.current?.(codigo)
                  }, 200)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    clearTimeout(scanTimeoutRef.current)
                    const codigo = scanBufferRef.current.trim()
                    scanBufferRef.current = ''
                    setScanInput('')
                    if (codigo) handleScanCodigoRef.current?.(codigo)
                  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    scanBufferRef.current += e.key
                    setScanInput(scanBufferRef.current)
                  }
                }}
              />
              <button onClick={() => setConfirmarMoverACan(null)}
                className="mt-4 w-full py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 active:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cerrar canasto - pesar ahora o después */}
      {modalCerrarCanasto && !pesoCanasto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setModalCerrarCanasto(null)}>
          <div className="bg-white rounded-t-2xl p-5 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2" />
            <h3 className="text-base font-semibold text-gray-800 text-center">
              Cerrar canasto {canastoActivo?.precinto}
            </h3>
            <p className="text-sm text-gray-500 text-center">
              {canastoActivo?.items.length || 0} artículos · ¿Pesar ahora?
            </p>
            <button onClick={() => setPesoCanasto('0')}
              className="w-full py-4 rounded-xl text-base font-semibold bg-sky-600 text-white">
              Pesar ahora
            </button>
            <button onClick={handleCerrarCanastoSinPeso}
              className="w-full py-4 rounded-xl text-base font-semibold bg-gray-100 text-gray-700">
              Pesar después
            </button>
          </div>
        </div>
      )}

      {/* Modal ingresar peso canasto */}
      {modalCerrarCanasto && pesoCanasto !== '' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => { setPesoCanasto(''); setModalCerrarCanasto(null) }}>
          <div className="bg-white rounded-t-2xl p-5 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2" />
            <h3 className="text-base font-semibold text-gray-800 text-center">
              Peso de {canastoActivo?.precinto}
            </h3>
            <input type="number" inputMode="decimal" min="0.001" step="0.001"
              value={pesoCanasto === '0' ? '' : pesoCanasto}
              onChange={e => setPesoCanasto(e.target.value)} autoFocus
              placeholder="Peso en kg"
              className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 outline-none" />
            <button onClick={handleCerrarCanastoConPeso}
              disabled={!pesoCanasto || parseFloat(pesoCanasto) <= 0}
              className={`w-full py-4 rounded-xl text-base font-semibold ${
                pesoCanasto && parseFloat(pesoCanasto) > 0 ? 'bg-sky-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}>
              Confirmar peso y cerrar
            </button>
            <button onClick={() => setPesoCanasto('')}
              className="w-full py-3 text-sm text-gray-500">
              Volver
            </button>
          </div>
        </div>
      )}

      {/* Modal pesar canasto pendiente (al finalizar) */}
      {pesandoCanastoIdx !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end">
          <div className="bg-white rounded-t-2xl p-5 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2" />
            <h3 className="text-base font-semibold text-gray-800 text-center">
              Pesar canasto {contenedores[pesandoCanastoIdx]?.precinto}
            </h3>
            <p className="text-sm text-gray-500 text-center">
              {contenedores[pesandoCanastoIdx]?.items.length || 0} artículos · Pendiente de peso
            </p>
            <input type="number" inputMode="decimal" min="0.001" step="0.001"
              value={pesandoCanastoPeso} onChange={e => setPesandoCanastoPeso(e.target.value)} autoFocus
              placeholder="Peso en kg"
              className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 outline-none" />
            <button onClick={confirmarPesoCanasto}
              disabled={!pesandoCanastoPeso || parseFloat(pesandoCanastoPeso) <= 0}
              className={`w-full py-4 rounded-xl text-base font-semibold ${
                pesandoCanastoPeso && parseFloat(pesandoCanastoPeso) > 0 ? 'bg-sky-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}>
              Confirmar peso
            </button>
          </div>
        </div>
      )}

      {/* Alerta peso fuera de rango */}
      {alertaPeso && (
        <div className="fixed inset-0 z-50 bg-amber-500 flex flex-col items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center space-y-4">
            <h2 className="text-xl font-bold text-amber-700">Peso fuera de rango</h2>
            <div className="text-3xl font-bold text-amber-600">{alertaPeso.peso} kg</div>
            <div className="text-sm text-gray-500">Rango: {alertaPeso.min || '—'} – {alertaPeso.max || '—'} kg</div>
            <p className="text-base text-gray-700">¿Seguro que es <span className="font-semibold">{alertaPeso.nombre}</span>?</p>
            <div className="flex gap-3 pt-2">
              <button onPointerDown={() => setAlertaPeso(null)}
                className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-xl text-lg font-semibold">No</button>
              <button onPointerDown={() => confirmarPesoFueraDeRango()}
                className="flex-1 bg-amber-500 text-white py-4 rounded-xl text-lg font-semibold">Sí</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pendientes */}
      {modalPendientes && (
        <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end">
          <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-base font-semibold text-gray-800">
                {modalPendientes.fase === 'pregunta'
                  ? `${modalPendientes.pendientes.length} artículo(s) incompletos`
                  : 'Indicar motivos'}
              </h3>
              <button onClick={() => setModalPendientes(null)} className="p-2 rounded-lg active:bg-gray-100">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {modalPendientes.fase === 'pregunta' && (
              <>
                <div className="overflow-y-auto flex-1 px-5 py-3">
                  {modalPendientes.pendientes.map(p => (
                    <div key={p.articulo_id} className="flex justify-between py-2 border-b border-gray-100 text-sm">
                      <span className="text-gray-800 truncate">{p.nombre}</span>
                      <span className="text-amber-600 font-medium ml-2">-{p.cantidad_faltante}</span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-gray-200 space-y-3 flex-shrink-0">
                  <button onClick={() => confirmarConPendientes(true)} disabled={enviandoPendientes}
                    className="w-full bg-blue-600 text-white py-3.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                    Crear nuevo traspaso con faltantes
                  </button>
                  <button onClick={() => setModalPendientes(prev => ({ ...prev, fase: 'motivos' }))}
                    className="w-full bg-gray-200 text-gray-700 py-3.5 rounded-xl text-sm font-semibold">
                    No, indicar motivos
                  </button>
                </div>
              </>
            )}
            {modalPendientes.fase === 'motivos' && (
              <>
                <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
                  {modalPendientes.pendientes.map(p => (
                    <div key={p.articulo_id} className="border border-gray-200 rounded-xl p-3 space-y-2">
                      <div className="text-sm font-medium text-gray-800">{p.nombre} <span className="text-xs text-gray-400">· Faltan {p.cantidad_faltante}</span></div>
                      <div className="grid grid-cols-2 gap-2">
                        {MOTIVOS_FALTANTE.map(m => (
                          <button key={m.value}
                            onClick={() => setModalPendientes(prev => ({ ...prev, motivos: { ...prev.motivos, [p.articulo_id]: m.value } }))}
                            className={`text-xs py-2 px-3 rounded-lg border font-medium ${
                              modalPendientes.motivos[p.articulo_id] === m.value
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 text-gray-600'
                            }`}>{m.label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-gray-200 flex-shrink-0">
                  <button onClick={() => confirmarConPendientes(false)}
                    disabled={enviandoPendientes || modalPendientes.pendientes.some(p => !modalPendientes.motivos[p.articulo_id])}
                    className={`w-full py-3.5 rounded-xl text-sm font-semibold ${
                      !enviandoPendientes && modalPendientes.pendientes.every(p => modalPendientes.motivos[p.articulo_id])
                        ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                    }`}>Confirmar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Barra inferior — escaneo + preparar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 space-y-2 safe-area-bottom">
        <div className="flex gap-2">
          {tecladoVisible ? (
            <input ref={inputManualRef} type="text" inputMode="numeric" value={scanInput}
              onChange={e => { setScanInput(e.target.value); scanBufferRef.current = e.target.value }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const codigo = scanInput.trim()
                  if (!codigo) return
                  setScanInput('')
                  scanBufferRef.current = ''
                  if (fase === 'detalle' && itemDetalle) handleScanDetalle(codigo)
                  else handleScanCodigo(codigo)
                  setTecladoVisible(false)
                }
              }}
              placeholder="Escribir código..."
              autoComplete="off" autoFocus
              className={`flex-1 border-2 rounded-xl px-4 py-3 text-base text-center outline-none ${
                canastoActivo ? 'border-amber-400 focus:border-amber-500 bg-amber-50' : 'border-sky-300 focus:border-sky-500'
              }`} />
          ) : (
            <input
              ref={scanRef}
              type="text"
              inputMode="none"
              value={scanInput}
              onChange={handleScanInputChange}
              onKeyDown={handleScanInputKeyDown}
              placeholder={canastoActivo ? `→ canasto ${canastoActivo.precinto}` : 'Escanear...'}
              autoComplete="off"
              className={`flex-1 border-2 rounded-xl px-4 py-3 text-base text-center outline-none caret-transparent ${
                canastoActivo ? 'border-amber-400 bg-amber-50' : 'border-sky-300'
              }`}
            />
          )}
          <button onClick={() => {
            setTecladoVisible(v => !v)
            setTimeout(() => inputManualRef.current?.focus(), 100)
          }}
            className={`px-3 rounded-xl border-2 ${tecladoVisible ? 'border-sky-500 bg-sky-50 text-sky-600' : 'border-gray-300 text-gray-400'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25" />
            </svg>
          </button>
        </div>
        <button onClick={marcarPreparado}
          className="w-full bg-emerald-600 active:bg-emerald-700 text-white py-3 rounded-xl text-sm font-semibold">
          Orden preparada {totalContenedores > 0 && `(${totalContenedores} contenedores)`}
        </button>
      </div>

      {alertaFullscreen && (
        <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${
          alertaFullscreen.tipo === 'info' ? 'bg-amber-500' : alertaFullscreen.ok ? 'bg-emerald-500' : 'bg-red-600 animate-pulse'
        }`}
          onClick={() => setAlertaFullscreen(null)}>
          <div className="text-center px-6">
            {alertaFullscreen.tipo === 'info' ? (
              <svg className="w-24 h-24 text-white mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : alertaFullscreen.ok ? (
              <svg className="w-24 h-24 text-white mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-24 h-24 text-white mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            )}
            <div className="text-white text-2xl font-bold">{alertaFullscreen.msg}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Preparacion
