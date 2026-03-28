// Vista de preparación / picking — mobile-first para celular con escáner
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../services/api'
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

  const [orden, setOrden] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [fase, setFase] = useState('picking') // 'picking' | 'detalle' | 'canastos'
  const [itemDetalle, setItemDetalle] = useState(null)

  // Fase canastos
  const [canastosPrep, setCanastosPrep] = useState([]) // [{precinto, peso_origen}]
  const [palletsPrep, setPalletsPrep] = useState([])    // [{cantidad_bultos, items_descripcion}]
  const [scanCanasto, setScanCanasto] = useState('')
  const scanCanastoRef = useRef(null)
  const [modalPallet, setModalPallet] = useState(false)
  const [palletBultos, setPalletBultos] = useState('')
  const [palletDesc, setPalletDesc] = useState('')
  const [enviandoCanastos, setEnviandoCanastos] = useState(false)
  const [observacionCanastos, setObservacionCanastos] = useState('')

  // Stock y artículos completos (para imágenes, barras, rubro, marca)
  const [stockOrigen, setStockOrigen] = useState({})
  const [todosArticulos, setTodosArticulos] = useState([])

  // Escaneo
  const scanArticuloRef = useRef(null)
  const [scanArticulo, setScanArticulo] = useState('')

  // Panel de piezas validadas
  const [mostrarPiezas, setMostrarPiezas] = useState(false)

  // Alerta de peso fuera de rango
  const [alertaPeso, setAlertaPeso] = useState(null)

  // Pesaje manual (artículos sin etiqueta)
  const [mostrarPesoManual, setMostrarPesoManual] = useState(false)
  const [pesoManualCantidad, setPesoManualCantidad] = useState('')
  const [pesoManualPeso, setPesoManualPeso] = useState('')
  const [pesoManualError, setPesoManualError] = useState(null)

  // Modal de artículos pendientes al cerrar
  const [modalPendientes, setModalPendientes] = useState(null)
  const [enviandoPendientes, setEnviandoPendientes] = useState(false)

  // Feedback visual
  const [feedback, setFeedback] = useState(null)
  const [alertaFullscreen, setAlertaFullscreen] = useState(null)

  const mostrarFeedback = (msg, ok) => {
    setFeedback({ msg, ok })
    if (fase === 'detalle') {
      setAlertaFullscreen({ msg, ok })
      if (!ok) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          const playBeep = (freq, start, dur) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.frequency.value = freq
            osc.type = 'square'
            gain.gain.value = 0.3
            osc.start(ctx.currentTime + start)
            osc.stop(ctx.currentTime + start + dur)
          }
          playBeep(800, 0, 0.15)
          playBeep(800, 0.25, 0.15)
          playBeep(800, 0.5, 0.15)
        } catch (e) {}
      }
      setTimeout(() => setAlertaFullscreen(null), ok ? 800 : 2000)
    }
    setTimeout(() => setFeedback(null), 1500)
  }

  const cargar = async () => {
    try {
      const { data } = await api.get(`/api/traspasos/ordenes/${id}`)
      setOrden(data)
      if (data.estado !== 'en_preparacion') {
        alert('Esta orden no está en preparación')
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

  // Cargar solo los artículos de la orden (ligero, no todo el catálogo)
  useEffect(() => {
    if (!orden) return
    const ids = (orden.items || []).map(i => i.articulo_id).filter(Boolean)
    if (ids.length === 0) return
    api.post('/api/traspasos/articulos-enriquecer', { ids })
      .then(r => setTodosArticulos(r.data || []))
      .catch(() => {})
  }, [orden?.id])

  useEffect(() => {
    if (fase === 'detalle') setTimeout(() => scanArticuloRef.current?.focus(), 150)
  }, [fase, itemDetalle])

  // Trackear si el artículo ya estaba completo al abrir el detalle
  const completoAlAbrir = useRef(false)

  // Auto-volver al picking cuando el artículo se completa durante el escaneo
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
      }, 1200)
      return () => clearTimeout(timer)
    }
  }, [fase, itemDetalle, orden])

  // Parser de código de barras de balanza (EAN-13 Kretz: 20 PPPPP WWWWW C)
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

  // Enriquecer items con rubro/marca del catálogo
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

  // Ordenar por rubro luego marca
  const itemsOrdenados = useMemo(() => {
    return [...itemsEnriquecidos].sort((a, b) => {
      const rubroComp = (a.rubro || 'ZZZ').localeCompare(b.rubro || 'ZZZ')
      if (rubroComp !== 0) return rubroComp
      return (a.marca || 'ZZZ').localeCompare(b.marca || 'ZZZ')
    })
  }, [itemsEnriquecidos])

  // Cantidad pickeada por artículo — leída directamente de los items de la orden
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

  const pickEnPiezas = (item) => {
    return pickeado[item.articulo_id]?.piezas || 0
  }

  const pickEnKg = (item) => {
    return pickeado[item.articulo_id]?.kg || 0
  }

  // Factor caja del catálogo
  const getFactorCaja = (item) => {
    if (item.es_pesable) return 0
    const cat = todosArticulos.find(a => String(a.id) === String(item.articulo_id))
    return cat?.codigosBarras?.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
  }

  // Buscar artículo por código de barras
  const buscarPorBarcode = (codigo) => {
    if (!orden) return null
    const items = orden.items || []
    const porCodigo = items.find(i => i.codigo === codigo)
    if (porCodigo) return porCodigo
    const artCatalogo = todosArticulos.find(a =>
      a.codigo === codigo || (a.codigosBarras && a.codigosBarras.some(b => (typeof b === 'object' ? b.codigo : b) === codigo))
    )
    if (artCatalogo) {
      return items.find(i => i.articulo_id === String(artCatalogo.id))
    }
    return null
  }

  // === PERSISTIR PICK ===

  const persistirItems = (nuevosItems) => {
    api.put(`/api/traspasos/ordenes/${id}/pick`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al guardar')
        cargar()
      })
  }

  // Actualizar un item específico en la orden (optimistic) y persistir
  const actualizarItem = (articuloId, updater) => {
    let nuevosItems
    setOrden(prev => {
      nuevosItems = (prev.items || []).map(i =>
        i.articulo_id === articuloId ? updater(i) : i
      )
      return { ...prev, items: nuevosItems }
    })
    // Usar setTimeout para leer el state actualizado
    setTimeout(() => {
      if (nuevosItems) persistirItems(nuevosItems)
    }, 0)
  }

  // === ACCIONES ===

  // Sonido de alerta para peso fuera de rango
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

  const handleScanArticulo = async (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const codigo = scanArticulo.trim()
    if (!codigo) return

    const itemActual = itemDetalle
    if (!itemActual) { setScanArticulo(''); return }

    // Bloquear si ya está completo
    const piezasYa = pickEnPiezas(itemActual)
    const piezasPedidas = cantidadEnPiezas(itemActual)
    if (piezasYa >= piezasPedidas) {
      mostrarFeedback('Artículo ya completo', false)
      setScanArticulo('')
      return
    }

    // Intentar parsear como barcode de balanza (pesable)
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
          setAlertaPeso({ peso: balanza.pesoKg, min: pesoMin, max: pesoMax, nombre: itemActual.nombre, balanza, itemActual })
          setScanArticulo('')
          return
        }
        cantAgregar = balanza.pesoKg
      }
    } else {
      // Barcode normal
      if (itemActual.codigo === codigo) {
        coincide = true
      } else {
        const cat = todosArticulos.find(a => String(a.id) === itemActual.articulo_id)
        if (cat) {
          if (cat.codigo === codigo) {
            coincide = true
          } else if (cat.codigosBarras && cat.codigosBarras.length > 0) {
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
      setScanArticulo('')
      return
    }

    // Agregar al item de la orden
    const nuevosItems = (orden.items || []).map(i => {
      if (i.articulo_id !== itemActual.articulo_id) return i
      const updated = { ...i }
      if (balanza && itemActual.es_pesable) {
        updated.cantidad_preparada = Math.round(((i.cantidad_preparada || 0) + cantAgregar) * 1000) / 1000
        updated.pesos_escaneados = [...(i.pesos_escaneados || []), balanza.pesoKg]
      } else {
        updated.cantidad_preparada = (i.cantidad_preparada || 0) + cantAgregar
      }
      return updated
    })

    setOrden(prev => ({ ...prev, items: nuevosItems }))
    mostrarFeedback(`+${cantAgregar} ${itemActual.nombre}`, true)
    setScanArticulo('')
    persistirItems(nuevosItems)
  }

  // Eliminar una pieza individual (por índice en pesos_escaneados)
  const eliminarPieza = (indicePieza) => {
    if (!itemDetalle) return
    const item = (orden.items || []).find(i => i.articulo_id === itemDetalle.articulo_id)
    if (!item) return

    const pesos = [...(item.pesos_escaneados || [])]
    const pesoEliminado = pesos[indicePieza] || 0
    pesos.splice(indicePieza, 1)

    const nuevaCantidad = Math.round((item.cantidad_preparada - pesoEliminado) * 1000) / 1000

    const nuevosItems = (orden.items || []).map(i => {
      if (i.articulo_id !== itemDetalle.articulo_id) return i
      return {
        ...i,
        cantidad_preparada: Math.max(0, nuevaCantidad),
        pesos_escaneados: pesos,
      }
    })

    setOrden(prev => ({ ...prev, items: nuevosItems }))
    mostrarFeedback(`Pieza eliminada (${pesoEliminado}kg)`, true)
    if (pesos.length === 0) setMostrarPiezas(false)
    persistirItems(nuevosItems)
  }

  // Eliminar una unidad
  const eliminarUnidad = () => {
    if (!itemDetalle) return
    const item = (orden.items || []).find(i => i.articulo_id === itemDetalle.articulo_id)
    if (!item || !item.cantidad_preparada) return

    const restar = itemDetalle.es_pesable && itemDetalle.pesoPromedioPieza
      ? itemDetalle.pesoPromedioPieza
      : 1
    const nuevaCantidad = Math.round(((item.cantidad_preparada || 0) - restar) * 1000) / 1000

    const nuevosItems = (orden.items || []).map(i => {
      if (i.articulo_id !== itemDetalle.articulo_id) return i
      return { ...i, cantidad_preparada: Math.max(0, nuevaCantidad) }
    })

    setOrden(prev => ({ ...prev, items: nuevosItems }))
    mostrarFeedback('-1 ' + itemDetalle.nombre, true)
    if (nuevaCantidad <= 0) setMostrarPiezas(false)
    persistirItems(nuevosItems)
  }

  // Confirmar pieza con peso fuera de rango
  const confirmarPesoFueraDeRango = () => {
    if (!alertaPeso) return
    const { balanza, itemActual } = alertaPeso

    if (pickEnPiezas(itemActual) >= cantidadEnPiezas(itemActual)) {
      mostrarFeedback('Artículo ya completo', false)
      setAlertaPeso(null)
      return
    }

    const cantAgregar = balanza.pesoKg
    const nuevosItems = (orden.items || []).map(i => {
      if (i.articulo_id !== itemActual.articulo_id) return i
      return {
        ...i,
        cantidad_preparada: Math.round(((i.cantidad_preparada || 0) + cantAgregar) * 1000) / 1000,
        pesos_escaneados: [...(i.pesos_escaneados || []), balanza.pesoKg],
      }
    })

    setOrden(prev => ({ ...prev, items: nuevosItems }))
    mostrarFeedback('+1 ' + itemActual.nombre, true)
    setAlertaPeso(null)
    persistirItems(nuevosItems)
  }

  // Confirmar pesaje manual grupal
  const confirmarPesoManual = () => {
    if (!itemDetalle) return
    const cantidad = parseInt(pesoManualCantidad, 10)
    const pesoTotal = parseFloat(pesoManualPeso)
    if (!cantidad || cantidad <= 0 || !pesoTotal || pesoTotal <= 0) return

    const piezasYa = pickEnPiezas(itemDetalle)
    const piezasPedidas = cantidadEnPiezas(itemDetalle)
    const restantes = piezasPedidas - piezasYa
    if (restantes <= 0) {
      setPesoManualError('Artículo ya completo')
      return
    }
    if (cantidad > restantes) {
      setPesoManualError(`Máximo ${restantes} pieza${restantes !== 1 ? 's' : ''} más`)
      return
    }

    const promedio = Math.round((pesoTotal / cantidad) * 1000) / 1000
    const enriched = itemsEnriquecidos.find(i => i.articulo_id === itemDetalle.articulo_id)
    const pesoMin = enriched?.pesoMinimo
    const pesoMax = enriched?.pesoMaximo
    if ((pesoMin && promedio < pesoMin) || (pesoMax && promedio > pesoMax)) {
      reproducirAlerta()
    }

    const nuevosPesos = Array.from({ length: cantidad }, () => promedio)
    const nuevosItems = (orden.items || []).map(i => {
      if (i.articulo_id !== itemDetalle.articulo_id) return i
      return {
        ...i,
        cantidad_preparada: Math.round(((i.cantidad_preparada || 0) + pesoTotal) * 1000) / 1000,
        pesos_escaneados: [...(i.pesos_escaneados || []), ...nuevosPesos],
      }
    })

    setOrden(prev => ({ ...prev, items: nuevosItems }))
    mostrarFeedback(`+${cantidad} pzas (${pesoTotal}kg)`, true)
    setMostrarPesoManual(false)
    setPesoManualCantidad('')
    setPesoManualPeso('')
    setPesoManualError(null)
    persistirItems(nuevosItems)
  }

  const calcularPendientes = () => {
    return itemsEnriquecidos
      .map(item => ({
        ...item,
        cantidad_preparada_real: item.cantidad_preparada || 0,
        cantidad_faltante: Math.round(((item.cantidad_solicitada || 0) - (item.cantidad_preparada || 0)) * 1000) / 1000,
      }))
      .filter(item => item.cantidad_faltante > 0)
  }

  const marcarPreparado = async () => {
    const pendientes = calcularPendientes()
    if (pendientes.length > 0) {
      setModalPendientes({ fase: 'pregunta', pendientes, motivos: {} })
      return
    }

    // Ir a fase canastos
    setFase('canastos')
  }

  const confirmarConPendientes = async (crearNuevaOrden) => {
    setEnviandoPendientes(true)
    try {
      const pendientes = modalPendientes.pendientes
      const motivos = modalPendientes.motivos
      // Guardar los faltantes para enviarlos después en el batch
      const articulosFaltantes = pendientes.map(p => ({
        articulo_id: p.articulo_id,
        nombre: p.nombre,
        codigo: p.codigo,
        cantidad_solicitada: p.cantidad_solicitada || 0,
        cantidad_preparada: p.cantidad_preparada_real,
        cantidad_faltante: p.cantidad_faltante,
        motivo: crearNuevaOrden ? null : (motivos[p.articulo_id] || null),
      }))

      // Guardar en state para enviar en el batch
      setModalPendientes(prev => ({ ...prev, articulosFaltantes, crearNuevaOrden }))
      setModalPendientes(null)

      // Ir a fase canastos con datos de faltantes
      setFase('canastos')
      // Guardar faltantes en ref para usar en el batch
      faltantesRef.current = { articulosFaltantes, crearNuevaOrden }
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    } finally {
      setEnviandoPendientes(false)
    }
  }

  // Ref para faltantes pendientes (se envían en el batch de canastos)
  const faltantesRef = useRef(null)

  // Escanear canasto
  const handleScanCanasto = (e) => {
    if (e.key !== 'Enter') return
    const valor = scanCanasto.trim()
    if (!valor) return
    // Evitar duplicados
    if (canastosPrep.some(c => c.precinto === valor)) {
      alert('Este precinto ya fue escaneado')
      setScanCanasto('')
      return
    }
    setCanastosPrep(prev => [...prev, { precinto: valor, peso_origen: '' }])
    setScanCanasto('')
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

  // Confirmar canastos y marcar preparada
  const confirmarCanastos = async () => {
    if (canastosPrep.length === 0 && palletsPrep.length === 0) return
    if (canastosPrep.some(c => !c.peso_origen || parseFloat(c.peso_origen) <= 0)) {
      alert('Todos los canastos deben tener peso')
      return
    }

    setEnviandoCanastos(true)
    try {
      const body = {
        canastos: canastosPrep.map(c => ({ precinto: c.precinto, peso_origen: parseFloat(c.peso_origen) })),
        pallets: palletsPrep,
        observacion: observacionCanastos.trim() || undefined,
      }
      // Incluir faltantes si los hay
      if (faltantesRef.current) {
        body.articulos_faltantes = faltantesRef.current.articulosFaltantes
        body.crear_nueva_orden = faltantesRef.current.crearNuevaOrden
      }

      const res = await api.post(`/api/traspasos/ordenes/${id}/preparar-con-canastos`, body)

      // Imprimir pallets creados
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
      setEnviandoCanastos(false)
    }
  }

  // Modal de artículos pendientes
  const MOTIVOS_FALTANTE = [
    { value: 'falta_stock', label: 'Falta de stock' },
    { value: 'articulo_danado', label: 'Artículo dañado' },
    { value: 'error_pedido', label: 'Error en el pedido' },
    { value: 'otro', label: 'Otro' },
  ]

  const modalPendientesJSX = modalPendientes && (
    <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end">
      <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-800">
            {modalPendientes.fase === 'pregunta'
              ? `Hay ${modalPendientes.pendientes.length} artículo${modalPendientes.pendientes.length !== 1 ? 's' : ''} sin preparar completos`
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                    <th className="pb-2 pr-2">Artículo</th>
                    <th className="pb-2 px-2 text-right">Pedido</th>
                    <th className="pb-2 px-2 text-right">Prep.</th>
                    <th className="pb-2 pl-2 text-right">Falta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {modalPendientes.pendientes.map(p => {
                    const ppp = p.pesoPromedioPieza || p.pppOrden || p.peso_promedio_pieza || null
                    const piezasPedidas = p.es_pesable && ppp ? Math.round(p.cantidad_solicitada / ppp) : null
                    const piezasPrep = p.es_pesable && ppp ? Math.round(p.cantidad_preparada_real / ppp) : null
                    const piezasFalta = (piezasPedidas != null && piezasPrep != null) ? Math.max(0, piezasPedidas - piezasPrep) : null
                    return (
                    <tr key={p.articulo_id}>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.nombre}</div>
                        <div className="text-xs text-gray-400">{p.codigo}</div>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-600">
                        {p.es_pesable ? (
                          <>{piezasPedidas != null && <div>{piezasPedidas} pzas</div>}<div className="text-xs text-gray-400">{p.cantidad_solicitada} kg</div></>
                        ) : p.cantidad_solicitada}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-600">
                        {p.es_pesable ? (
                          <>{piezasPrep != null && <div>{piezasPrep} pzas</div>}<div className="text-xs text-gray-400">{p.cantidad_preparada_real} kg</div></>
                        ) : p.cantidad_preparada_real}
                      </td>
                      <td className="py-2 pl-2 text-right font-semibold text-amber-600">
                        {p.es_pesable ? (
                          <>{piezasFalta != null && <div>{piezasFalta} pzas</div>}<div className="text-xs">{p.cantidad_faltante} kg</div></>
                        ) : p.cantidad_faltante}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 space-y-3 flex-shrink-0">
              <button onClick={() => confirmarConPendientes(true)} disabled={enviandoPendientes}
                className="w-full bg-blue-600 active:bg-blue-700 text-white py-3.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {enviandoPendientes ? 'Procesando...' : 'Crear nuevo traspaso con faltantes'}
              </button>
              <button onClick={() => setModalPendientes(prev => ({ ...prev, fase: 'motivos' }))}
                className="w-full bg-gray-200 active:bg-gray-300 text-gray-700 py-3.5 rounded-xl text-sm font-semibold">
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
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{p.nombre}</div>
                      <div className="text-xs text-gray-400">{p.codigo} · Faltan {p.cantidad_faltante}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {MOTIVOS_FALTANTE.map(m => (
                      <button key={m.value}
                        onClick={() => setModalPendientes(prev => ({
                          ...prev,
                          motivos: { ...prev.motivos, [p.articulo_id]: m.value }
                        }))}
                        className={`text-xs py-2 px-3 rounded-lg border font-medium ${
                          modalPendientes.motivos[p.articulo_id] === m.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 text-gray-600 active:bg-gray-50'
                        }`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={() => confirmarConPendientes(false)}
                disabled={enviandoPendientes || modalPendientes.pendientes.some(p => !modalPendientes.motivos[p.articulo_id])}
                className={`w-full py-3.5 rounded-xl text-sm font-semibold ${
                  !enviandoPendientes && modalPendientes.pendientes.every(p => modalPendientes.motivos[p.articulo_id])
                    ? 'bg-emerald-600 active:bg-emerald-700 text-white'
                    : 'bg-gray-200 text-gray-400'
                }`}>
                {enviandoPendientes ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  // === RENDER ===

  if (cargando) return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  if (!orden) return null

  // ═══════════════════════════════════════
  // FASE: DETALLE DE ARTÍCULO (escaneo)
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
        {/* Banner con navegación */}
        <div className="bg-sky-600 text-white px-2 py-2 flex items-center gap-2 flex-shrink-0">
          <button onClick={() => { setFase('picking'); setItemDetalle(null); setMostrarPiezas(false) }}
            className="p-2 rounded-lg active:bg-sky-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="font-semibold text-sm flex-1">{orden.numero}</span>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`px-4 py-1.5 text-sm font-medium text-center flex-shrink-0 ${feedback.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {feedback.msg}
          </div>
        )}

        {/* Contenido central */}
        <div className="flex-1 min-h-0 flex flex-col px-3 py-2 gap-2 overflow-hidden">
          {/* Imagen */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1 min-h-0 flex items-center justify-center">
            <img
              src={`${API_BASE}/api/articulos/${itemDetalle.articulo_id}/imagen`}
              alt={itemDetalle.nombre}
              className="w-full h-full object-contain bg-gray-50"
            />
          </div>

          {/* Info + progreso compacto */}
          <div className="bg-white rounded-xl border border-gray-200 p-2.5 flex items-center gap-3 flex-shrink-0">
            <CirculoProgreso actual={pickPiezas} total={pedidoPiezas} size={46} />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-gray-800 leading-tight truncate">{itemDetalle.nombre}</h2>
              <div className="text-xs text-gray-400">{itemDetalle.codigo}
                {stock !== undefined && (() => {
                  if (itemDetalle.es_pesable) {
                    const ppp = itemDetalle.pesoPromedioPieza
                    const pzasEst = ppp > 0 ? Math.round(stock / ppp) : null
                    return <span className="ml-1">· Stock: {stock} kg{pzasEst !== null ? ` (~${pzasEst} pzas)` : ''}</span>
                  }
                  const cat = todosArticulos.find(a => String(a.id) === itemDetalle.articulo_id)
                  const factorCaja = cat?.codigosBarras?.reduce((max, b) => typeof b === 'object' && b.factor > 1 ? Math.max(max, b.factor) : max, 0) || 0
                  if (factorCaja > 1) {
                    const cajas = Math.floor(stock / factorCaja)
                    const sueltas = stock % factorCaja
                    return <span className="ml-1">· Stock: {cajas} cj{sueltas > 0 ? ` + ${sueltas} ud${sueltas !== 1 ? 's' : ''}` : ''} <span className="text-gray-300">({stock})</span></span>
                  }
                  return <span className="ml-1">· Stock: {stock} uds</span>
                })()}
              </div>
              <div className={`text-base font-bold ${completo ? 'text-emerald-600' : 'text-gray-800'}`}>
                {pickPiezas} / {pedidoPiezas}
                {(() => {
                  const fc = !itemDetalle.es_pesable ? getFactorCaja(itemDetalle) : 0
                  const cajasTotal = fc > 1 ? Math.floor(pedidoPiezas / fc) : 0
                  if (fc > 1 && cajasTotal >= 1) {
                    const sueltas = pedidoPiezas - cajasTotal * fc
                    return <>
                      <span className="text-xs font-normal text-gray-500 ml-1">unidades</span>
                      <span className="text-xs font-normal text-gray-400 ml-1">· {cajasTotal} {cajasTotal === 1 ? 'caja' : 'cajas'}{sueltas > 0 ? ` +${sueltas}` : ''}</span>
                    </>
                  }
                  return <span className="text-xs font-normal text-gray-500 ml-1">{itemDetalle.es_pesable ? 'piezas' : 'unidades'}</span>
                })()}
                {itemDetalle.es_pesable && <span className="text-xs font-semibold text-sky-600 ml-1">· {pick} kg</span>}
                {completo && <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium ml-2">Completo</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Modal de piezas validadas */}
        {mostrarPiezas && (() => {
          const esPesable = itemDetalle.es_pesable
          const ppUnit = itemDetalle.pesoPromedioPieza
          const item = (orden.items || []).find(i => i.articulo_id === itemDetalle.articulo_id)
          if (!item) return null

          let piezas = []
          const pesos = item.pesos_escaneados || []
          if (pesos.length > 0) {
            pesos.forEach((p, i) => piezas.push({ peso: p, idx: i }))
          } else if (esPesable && ppUnit && item.cantidad_preparada > 0) {
            const n = Math.round(item.cantidad_preparada / ppUnit)
            for (let i = 0; i < n; i++) piezas.push({ peso: Math.round(ppUnit * 1000) / 1000, idx: i })
          } else if (item.cantidad_preparada > 0) {
            for (let i = 0; i < item.cantidad_preparada; i++) piezas.push({ peso: null, idx: i })
          }
          const totalKg = piezas.reduce((s, p) => s + (p.peso || 0), 0)

          return (
            <div className="fixed inset-0 z-40 bg-black/40 flex flex-col justify-end" onClick={() => setMostrarPiezas(false)}>
              <div className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                  <div>
                    <h3 className="text-base font-semibold text-gray-800">Piezas validadas</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{itemDetalle.nombre}</p>
                  </div>
                  <button onClick={() => setMostrarPiezas(false)} className="p-2 rounded-lg active:bg-gray-100">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="overflow-y-auto flex-1">
                  <div className="divide-y divide-gray-100">
                    {piezas.map((pieza) => (
                      <div key={pieza.idx} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="bg-sky-100 text-sky-700 text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center">{pieza.idx + 1}</span>
                          <span className="text-base font-medium text-gray-800">
                            {pieza.peso != null ? `${pieza.peso} kg` : `Unidad ${pieza.idx + 1}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {totalKg > 0 && (
                  <div className="px-4 py-3 border-t border-gray-200 flex justify-between items-center flex-shrink-0 bg-gray-50">
                    <span className="text-sm text-gray-500">Total · {piezas.length} pieza{piezas.length !== 1 ? 's' : ''}</span>
                    <span className="text-lg font-bold text-gray-800">{totalKg.toFixed(3)} kg</span>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Modal pesaje manual */}
        {mostrarPesoManual && (() => {
          const cant = parseInt(pesoManualCantidad, 10) || 0
          const peso = parseFloat(pesoManualPeso) || 0
          const promedio = cant > 0 && peso > 0 ? peso / cant : 0
          const enriched = itemsEnriquecidos.find(i => i.articulo_id === itemDetalle.articulo_id)
          const pesoMin = enriched?.pesoMinimo
          const pesoMax = enriched?.pesoMaximo
          const fueraDeRango = promedio > 0 && ((pesoMin && promedio < pesoMin) || (pesoMax && promedio > pesoMax))
          const valido = cant > 0 && peso > 0

          return (
            <div className="fixed inset-0 z-40 bg-black/40 flex flex-col justify-end" onClick={() => setMostrarPesoManual(false)}>
              <div className="bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-gray-800">Pesaje manual</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{itemDetalle.nombre}</p>
                  </div>
                  <button onClick={() => setMostrarPesoManual(false)} className="p-2 rounded-lg active:bg-gray-100">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Cantidad de piezas</label>
                    <input type="number" inputMode="numeric" min="1" step="1"
                      value={pesoManualCantidad} onChange={e => { setPesoManualCantidad(e.target.value); setPesoManualError(null) }}
                      placeholder="Ej: 3" autoFocus
                      className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 mb-1 block">Peso total (kg)</label>
                    <input type="number" inputMode="decimal" min="0.001" step="0.001"
                      value={pesoManualPeso} onChange={e => setPesoManualPeso(e.target.value)}
                      placeholder="Ej: 1.500"
                      className="w-full border-2 border-gray-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
                    />
                  </div>
                </div>
                {valido && (
                  <div className={`rounded-xl px-4 py-3 text-center ${fueraDeRango ? 'bg-amber-50 border border-amber-300' : 'bg-sky-50 border border-sky-200'}`}>
                    <div className={`text-2xl font-bold ${fueraDeRango ? 'text-amber-600' : 'text-sky-700'}`}>
                      {promedio.toFixed(3)} kg/pza
                    </div>
                    {(pesoMin || pesoMax) && (
                      <div className="text-xs text-gray-500 mt-1">
                        Rango: {pesoMin || '—'} – {pesoMax || '—'} kg
                      </div>
                    )}
                    {fueraDeRango && (
                      <div className="text-xs font-medium text-amber-600 mt-1">Promedio fuera de rango</div>
                    )}
                  </div>
                )}
                {pesoManualError && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="bg-red-100 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <span className="text-base font-semibold text-red-700">{pesoManualError}</span>
                  </div>
                )}
                <button onClick={confirmarPesoManual} disabled={!valido}
                  className={`w-full py-4 rounded-xl text-base font-semibold ${
                    valido ? 'bg-sky-600 active:bg-sky-700 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                  Confirmar {valido ? `· ${cant} pza${cant !== 1 ? 's' : ''} · ${peso}kg` : ''}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Alerta de peso fuera de rango */}
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
              <div className="text-sm text-gray-500">
                Rango esperado: {alertaPeso.min || '—'} kg – {alertaPeso.max || '—'} kg
              </div>
              <p className="text-base text-gray-700">
                ¿Seguro que el producto escaneado es <span className="font-semibold">{alertaPeso.nombre}</span>?
              </p>
              <div className="flex gap-3 pt-2">
                <button type="button" onPointerDown={(e) => { e.stopPropagation(); setAlertaPeso(null) }}
                  className="flex-1 bg-gray-200 active:bg-gray-300 text-gray-700 py-4 rounded-xl text-lg font-semibold">
                  No
                </button>
                <button type="button" onPointerDown={(e) => { e.stopPropagation(); confirmarPesoFueraDeRango() }}
                  className="flex-1 bg-amber-500 active:bg-amber-600 text-white py-4 rounded-xl text-lg font-semibold">
                  Sí
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Barra inferior — escaneo + validado */}
        <div className="bg-white border-t border-gray-200 px-3 py-2 space-y-1.5 flex-shrink-0 safe-area-bottom">
          <input ref={scanArticuloRef} type="text" value={scanArticulo}
            onChange={e => setScanArticulo(e.target.value)} onKeyDown={handleScanArticulo}
            placeholder="Escanear código de barras..." autoComplete="off" autoFocus
            className="w-full border-2 border-sky-300 rounded-xl px-4 py-3 text-base text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
          />
          {itemDetalle.es_pesable && (
            <button onClick={() => { setMostrarPesoManual(true); setPesoManualCantidad(''); setPesoManualPeso(''); setPesoManualError(null) }}
              className="w-full text-xs text-gray-400 active:text-gray-600 py-0.5">
              Pesar manual (sin etiqueta)
            </button>
          )}
          {pickPiezas > 0 && (
            <button onClick={() => setMostrarPiezas(true)}
              className="w-full bg-sky-50 active:bg-sky-100 border-2 border-sky-300 text-sky-700 py-2.5 rounded-xl text-sm font-semibold">
              Validado · {pickPiezas} {itemDetalle.es_pesable ? (pickPiezas !== 1 ? 'piezas' : 'pieza') : (pickPiezas !== 1 ? 'unidades' : 'unidad')}
              {itemDetalle.es_pesable && <span className="font-normal text-sky-500"> · {pick} kg</span>}
            </button>
          )}
        </div>

        {/* Alerta fullscreen OK/Error */}
        {alertaFullscreen && (
          <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${alertaFullscreen.ok ? 'bg-emerald-500' : 'bg-red-600 animate-pulse'}`}
            onClick={() => setAlertaFullscreen(null)}>
            <div className="text-center px-6">
              {alertaFullscreen.ok ? (
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
  // FASE: CANASTOS
  // ═══════════════════════════════════════
  if (fase === 'canastos') {
    const canastosValidos = canastosPrep.every(c => c.peso_origen && parseFloat(c.peso_origen) > 0)
    const hayAlgo = canastosPrep.length > 0 || palletsPrep.length > 0
    const puedeConfirmar = hayAlgo && canastosValidos && !enviandoCanastos

    return (
      <div className="min-h-screen bg-gray-100 pb-24">
        {/* Banner */}
        <div className="bg-sky-600 text-white px-2 py-2 flex items-center gap-2">
          <button onClick={() => setFase('picking')}
            className="p-2 rounded-lg active:bg-sky-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="text-base font-medium">Escanea los canastos</div>
            <div className="text-sky-200 text-sm">{orden.numero} · {orden.sucursal_origen_nombre} → {orden.sucursal_destino_nombre}</div>
          </div>
        </div>

        <div className="px-3 py-3 space-y-4">
          {/* Input escaneo canastos */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <label className="text-sm font-medium text-gray-700">Escanear precinto de canasto</label>
            <input
              ref={scanCanastoRef}
              type="text"
              value={scanCanasto}
              onChange={e => setScanCanasto(e.target.value)}
              onKeyDown={handleScanCanasto}
              placeholder="Escanear o escribir precinto..."
              className="w-full border-2 border-sky-300 rounded-xl px-4 py-3 text-base text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              autoFocus
            />
          </div>

          {/* Lista canastos escaneados */}
          {canastosPrep.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Canastos ({canastosPrep.length})</h3>
              {canastosPrep.map((c, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono font-medium text-gray-800 truncate">{c.precinto}</div>
                  </div>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="Peso (kg)"
                    value={c.peso_origen}
                    onChange={e => setCanastosPrep(prev => prev.map((x, i) => i === idx ? { ...x, peso_origen: e.target.value } : x))}
                    className={`w-28 border rounded-lg px-2 py-2 text-sm text-center ${
                      c.peso_origen && parseFloat(c.peso_origen) > 0 ? 'border-green-300' : 'border-red-300'
                    }`}
                  />
                  <span className="text-xs text-gray-400">kg</span>
                  <button onClick={() => setCanastosPrep(prev => prev.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 p-1">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Sección pallets */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Pallets ({palletsPrep.length})</h3>
              <button onClick={() => { setModalPallet(true); setPalletBultos(''); setPalletDesc('') }}
                className="text-sm bg-orange-100 text-orange-700 px-3 py-1.5 rounded-lg font-medium active:bg-orange-200">
                + Generar Pallet
              </button>
            </div>
            {palletsPrep.length > 0 && (
              <div className="space-y-2">
                {palletsPrep.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-orange-50 rounded-lg p-3">
                    <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">Pallet</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800">{p.cantidad_bultos} bultos</div>
                      {p.items_descripcion && <div className="text-xs text-gray-500 truncate">{p.items_descripcion}</div>}
                    </div>
                    <button onClick={() => setPalletsPrep(prev => prev.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-600 p-1">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Observación */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <label className="text-sm font-medium text-gray-700">Observación (opcional)</label>
            <textarea
              value={observacionCanastos}
              onChange={e => setObservacionCanastos(e.target.value)}
              placeholder="Notas sobre la preparación..."
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 outline-none"
            />
          </div>
        </div>

        {/* Modal pallet */}
        {modalPallet && (
          <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setModalPallet(false)}>
            <div className="bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-800">Nuevo Pallet</h3>
                <button onClick={() => setModalPallet(false)} className="p-2 rounded-lg active:bg-gray-100">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Cantidad de bultos *</label>
                <input type="number" min="1" step="1" value={palletBultos}
                  onChange={e => setPalletBultos(e.target.value)} autoFocus
                  placeholder="Ej: 12"
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-lg text-center focus:border-orange-500 focus:ring-2 focus:ring-orange-200 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Descripción (opcional)</label>
                <input type="text" value={palletDesc}
                  onChange={e => setPalletDesc(e.target.value)}
                  placeholder="Ej: 6 cajas vino malbec"
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 outline-none"
                />
              </div>
              <button onClick={agregarPallet}
                disabled={!palletBultos || parseInt(palletBultos) <= 0}
                className={`w-full py-3.5 rounded-xl text-sm font-semibold ${
                  palletBultos && parseInt(palletBultos) > 0
                    ? 'bg-orange-500 active:bg-orange-600 text-white'
                    : 'bg-gray-200 text-gray-400'
                }`}>
                Agregar Pallet
              </button>
            </div>
          </div>
        )}

        {/* Botón confirmar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 safe-area-bottom">
          <button onClick={confirmarCanastos} disabled={!puedeConfirmar}
            className={`w-full py-3.5 rounded-xl text-sm font-semibold ${
              puedeConfirmar
                ? 'bg-emerald-600 active:bg-emerald-700 text-white'
                : 'bg-gray-200 text-gray-400'
            }`}>
            {enviandoCanastos ? 'Procesando...' : 'Confirmar y marcar preparada'}
          </button>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════
  // FASE: LISTA DE ARTÍCULOS (picking)
  // ═══════════════════════════════════════

  const rubroGroups = {}
  for (const item of itemsOrdenados) {
    const rubro = item.rubro || 'Sin rubro'
    if (!rubroGroups[rubro]) rubroGroups[rubro] = []
    rubroGroups[rubro].push(item)
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* Banner */}
      <div className="bg-sky-600 text-white px-2 py-2 flex items-center gap-2">
        <button onClick={() => navigate('/preparacion')}
          className="p-2 rounded-lg active:bg-sky-700">
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

      {/* Lista de artículos por rubro */}
      <div className="px-3 py-3 space-y-4">
        {Object.entries(rubroGroups).map(([rubro, items]) => (
          <div key={rubro}>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 mb-1.5">{rubro}</div>
            <div className="space-y-1.5">
              {items.map((item, idx) => {
                const piezasPedidas = cantidadEnPiezas(item)
                const piezasPick = pickEnPiezas(item)
                const completo = piezasPick >= piezasPedidas

                return (
                  <button key={idx}
                    onClick={() => {
                      completoAlAbrir.current = piezasPick >= piezasPedidas
                      setItemDetalle(item); setFase('detalle'); setMostrarPiezas(false)
                    }}
                    className={`w-full text-left bg-white rounded-xl border overflow-hidden flex items-center gap-3 p-3 active:bg-gray-50 ${
                      completo ? 'border-emerald-300' : 'border-gray-200'
                    }`}
                  >
                    {/* Miniatura */}
                    <img
                      src={`${API_BASE}/api/articulos/${item.articulo_id}/imagen`}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                      onError={e => { e.target.style.display = 'none' }}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${completo ? 'text-emerald-700' : 'text-gray-800'}`}>
                        {item.nombre}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.codigo}
                        {item.marca && <span className="ml-1">· {item.marca}</span>}
                      </div>
                      <div className={`text-xs mt-0.5 font-medium ${completo ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {(() => {
                          const fc = !item.es_pesable ? getFactorCaja(item) : 0
                          const cajasTotal = fc > 1 ? Math.floor(piezasPedidas / fc) : 0
                          if (fc > 1 && cajasTotal >= 1) {
                            const sueltas = piezasPedidas - cajasTotal * fc
                            return <>
                              {cajasTotal} {cajasTotal === 1 ? 'caja' : 'cajas'}{sueltas > 0 ? ` + ${sueltas} ud${sueltas !== 1 ? 's' : ''}` : ''}
                              <span className="text-gray-400 font-normal ml-1">({piezasPick}/{piezasPedidas} unidades)</span>
                            </>
                          }
                          return <>{piezasPick}/{piezasPedidas} {item.es_pesable ? 'piezas' : 'unidades'}</>
                        })()}
                      </div>
                    </div>

                    {/* Círculo */}
                    <CirculoProgreso actual={piezasPick} total={piezasPedidas} size={44} />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Barra inferior — marcar preparado */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 safe-area-bottom">
        <button onClick={marcarPreparado}
          className="w-full bg-emerald-600 active:bg-emerald-700 text-white py-3.5 rounded-xl text-sm font-semibold">
          Orden preparada
        </button>
      </div>

      {modalPendientesJSX}

    </div>
  )
}

export default Preparacion
