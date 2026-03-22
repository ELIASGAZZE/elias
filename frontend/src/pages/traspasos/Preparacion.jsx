// Vista de preparación / picking — mobile-first para celular con escáner
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../services/api'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Flecha de volver simple — sin barra para maximizar espacio
const BotonVolver = ({ onClick }) => (
  <button onClick={onClick} className="fixed top-3 left-3 z-30 bg-white/90 active:bg-gray-100 shadow-md rounded-full w-10 h-10 flex items-center justify-center">
    <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  </button>
)

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
  const [fase, setFase] = useState('canasto') // 'canasto' | 'picking' | 'detalle'
  const [canastoActivo, setCanastoActivo] = useState(null)
  const [itemDetalle, setItemDetalle] = useState(null) // item abierto para pickear

  // Stock y artículos completos (para imágenes, barras, rubro, marca)
  const [stockOrigen, setStockOrigen] = useState({})
  const [todosArticulos, setTodosArticulos] = useState([])

  // Escaneo
  const scanCanastoRef = useRef(null)
  const scanArticuloRef = useRef(null)
  const [scanCanasto, setScanCanasto] = useState('')
  const [scanArticulo, setScanArticulo] = useState('')

  // Panel de piezas validadas
  const [mostrarPiezas, setMostrarPiezas] = useState(false)

  // Modal confirmar cierre de canasto
  const [confirmarCierre, setConfirmarCierre] = useState(false)
  const [scanCierre, setScanCierre] = useState('')
  const scanCierreRef = useRef(null)
  const [faseCierre, setFaseCierre] = useState('scan') // 'scan' | 'peso'
  const [pesoCanasto, setPesoCanasto] = useState('')

  // Modal cerrar pedido (listado de canastos con pesos)
  const [mostrarCerrarPedido, setMostrarCerrarPedido] = useState(false)
  const [pesosCanastos, setPesosCanastos] = useState({}) // { canastoId: 'peso' }
  const [pesandoCanastoId, setPesandoCanastoId] = useState(null)
  const [fasePesaje, setFasePesaje] = useState('scan') // 'scan' | 'peso'
  const [scanPesaje, setScanPesaje] = useState('')

  // Ver contenido de canasto cerrado
  const [canastoViendo, setCanastoViendo] = useState(null) // canasto completo
  const [moverItem, setMoverItem] = useState(null) // { item, canastoOrigenId }

  // Alerta de peso fuera de rango
  const [alertaPeso, setAlertaPeso] = useState(null) // { peso, min, max, nombre }

  // Pesaje manual (artículos sin etiqueta)
  const [mostrarPesoManual, setMostrarPesoManual] = useState(false)
  const [pesoManualCantidad, setPesoManualCantidad] = useState('')
  const [pesoManualPeso, setPesoManualPeso] = useState('')
  const [pesoManualError, setPesoManualError] = useState(null)

  // Feedback visual
  const [feedback, setFeedback] = useState(null) // { msg, ok }

  const mostrarFeedback = (msg, ok) => {
    setFeedback({ msg, ok })
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
      const abierto = (data.canastos || []).find(c => c.estado === 'en_preparacion')
      if (abierto) {
        setCanastoActivo(abierto)
        if (fase === 'canasto') setFase('picking')
      }
    } catch (err) {
      console.error(err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [id])

  useEffect(() => {
    api.get('/api/pos/articulos')
      .then(r => setTodosArticulos(r.data?.articulos || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (fase === 'canasto') setTimeout(() => scanCanastoRef.current?.focus(), 150)
    if (fase === 'detalle') setTimeout(() => scanArticuloRef.current?.focus(), 150)
  }, [fase, canastoActivo, itemDetalle])

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
    for (const a of todosArticulos) catalogo[String(a.id)] = a

    return items.map(item => {
      const cat = catalogo[item.articulo_id] || {}
      return {
        ...item,
        rubro: cat.rubro?.nombre || '',
        marca: cat.marca || '',
        pesoPromedioPieza: item.peso_promedio_pieza || cat.pesoPromedioPieza || null,
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

  // Cantidad pickeada por artículo: kg totales y piezas (conteo de escaneos)
  const pickeado = useMemo(() => {
    const map = {} // { articulo_id: { kg, piezas } }
    if (!orden) return map
    for (const c of (orden.canastos || [])) {
      for (const ci of (c.items || [])) {
        if (!map[ci.articulo_id]) map[ci.articulo_id] = { kg: 0, piezas: 0 }
        map[ci.articulo_id].kg += ci.cantidad
        // Contar piezas: si tiene pesos_escaneados, cada entrada = 1 pieza
        // Si no (no pesable o escaneo viejo), cantidad = piezas
        if (ci.es_pesable && Array.isArray(ci.pesos_escaneados)) {
          map[ci.articulo_id].piezas += ci.pesos_escaneados.length
        } else {
          map[ci.articulo_id].piezas += ci.cantidad
        }
      }
    }
    return map
  }, [orden])

  // Convertir cantidad pedida a piezas para pesables
  const cantidadEnPiezas = (item) => {
    if (!item.es_pesable || !item.pesoPromedioPieza) return item.cantidad_solicitada
    return Math.round(item.cantidad_solicitada / item.pesoPromedioPieza)
  }

  const pickEnPiezas = (item) => {
    const data = pickeado[item.articulo_id]
    if (!data) return 0
    if (!item.es_pesable) return data.piezas
    return data.piezas
  }

  const pickEnKg = (item) => {
    return pickeado[item.articulo_id]?.kg || 0
  }

  // Buscar artículo por código de barras
  const buscarPorBarcode = (codigo) => {
    if (!orden) return null
    const items = orden.items || []
    const porCodigo = items.find(i => i.codigo === codigo)
    if (porCodigo) return porCodigo
    const artCatalogo = todosArticulos.find(a =>
      a.codigo === codigo || (a.codigosBarras && a.codigosBarras.includes(codigo))
    )
    if (artCatalogo) {
      return items.find(i => i.articulo_id === String(artCatalogo.id))
    }
    return null
  }

  // === ACCIONES ===

  const handleScanCanasto = async (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const precinto = scanCanasto.trim()
    if (!precinto) return

    const existente = (orden.canastos || []).find(c => c.precinto === precinto)
    if (existente) {
      if (existente.estado === 'en_preparacion') {
        setCanastoActivo(existente)
        setFase('picking')
        setScanCanasto('')
      } else {
        alert('Ese canasto ya está cerrado')
        setScanCanasto('')
      }
      return
    }

    try {
      const { data } = await api.post(`/api/traspasos/ordenes/${id}/canastos`, { precinto })
      setScanCanasto('')
      await cargar()
      if (data?.id) {
        setCanastoActivo(data)
        setFase('picking')
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error al crear canasto')
      setScanCanasto('')
    }
  }

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
    if (!codigo || !canastoActivo) return

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
      // Barcode de balanza: verificar PLU coincide con el artículo (normalizar sin ceros a la izquierda)
      const cat = todosArticulos.find(a => String(a.id) === itemActual.articulo_id)
      const codigoArticulo = cat?.codigo || itemActual.codigo
      const normPlu = balanza.plu.replace(/^0+/, '')
      const normCodigo = (codigoArticulo || '').replace(/^0+/, '')
      coincide = normCodigo === normPlu

      if (coincide) {
        // Verificar peso contra min/max
        const enriched = itemsEnriquecidos.find(i => i.articulo_id === itemActual.articulo_id)
        const pesoMin = enriched?.pesoMinimo
        const pesoMax = enriched?.pesoMaximo
        if ((pesoMin && balanza.pesoKg < pesoMin) || (pesoMax && balanza.pesoKg > pesoMax)) {
          reproducirAlerta()
          setAlertaPeso({
            peso: balanza.pesoKg,
            min: pesoMin,
            max: pesoMax,
            nombre: itemActual.nombre,
            balanza,
            itemActual,
          })
          setScanArticulo('')
          return
        }
        // Cada escaneo pesable = 1 pieza, peso real del escaneo
        cantAgregar = balanza.pesoKg
      }
    } else {
      // Barcode normal
      coincide =
        itemActual.codigo === codigo ||
        (() => {
          const cat = todosArticulos.find(a => String(a.id) === itemActual.articulo_id)
          return cat && (cat.codigo === codigo || (cat.codigosBarras && cat.codigosBarras.includes(codigo)))
        })()
    }

    if (!coincide) {
      mostrarFeedback('Código no coincide con este artículo', false)
      setScanArticulo('')
      return
    }

    // Agregar al canasto
    const canasto = (orden.canastos || []).find(c => c.id === canastoActivo.id)
    if (!canasto || canasto.estado !== 'en_preparacion') return

    const itemsActuales = canasto.items || []
    const yaExiste = itemsActuales.find(i => i.articulo_id === itemActual.articulo_id)

    let nuevosItems
    if (yaExiste) {
      nuevosItems = itemsActuales.map(i => {
        if (i.articulo_id !== itemActual.articulo_id) return i
        const updated = { ...i, cantidad: Math.round((i.cantidad + cantAgregar) * 1000) / 1000 }
        // Guardar pesos individuales de pesables para cálculo automático
        if (balanza && itemActual.es_pesable) {
          updated.pesos_escaneados = [...(i.pesos_escaneados || []), balanza.pesoKg]
        }
        return updated
      })
    } else {
      const nuevoItem = {
        articulo_id: itemActual.articulo_id,
        codigo: itemActual.codigo,
        nombre: itemActual.nombre,
        cantidad: cantAgregar,
        es_pesable: itemActual.es_pesable,
      }
      if (balanza && itemActual.es_pesable) {
        nuevoItem.pesos_escaneados = [balanza.pesoKg]
      }
      nuevosItems = [...itemsActuales, nuevoItem]
    }

    // Actualización optimista — actualizar estado local de inmediato
    setOrden(prev => ({
      ...prev,
      canastos: prev.canastos.map(c =>
        c.id === canastoActivo.id ? { ...c, items: nuevosItems } : c
      )
    }))
    mostrarFeedback('+1 ' + itemActual.nombre, true)
    setScanArticulo('')

    // Persistir en background
    api.put(`/api/traspasos/canastos/${canastoActivo.id}`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al guardar')
        cargar() // revertir al estado real si falla
      })
  }

  // Eliminar una pieza individual (por índice en pesos_escaneados)
  const eliminarPieza = async (indicePieza) => {
    if (!canastoActivo || !itemDetalle) return
    const canasto = (orden.canastos || []).find(c => c.id === canastoActivo.id)
    if (!canasto || canasto.estado !== 'en_preparacion') return

    const itemsActuales = canasto.items || []
    const itemCanasto = itemsActuales.find(i => i.articulo_id === itemDetalle.articulo_id)
    if (!itemCanasto) return

    const pesos = [...(itemCanasto.pesos_escaneados || [])]
    const pesoEliminado = pesos[indicePieza] || 0
    pesos.splice(indicePieza, 1)

    const nuevaCantidad = Math.round((itemCanasto.cantidad - pesoEliminado) * 1000) / 1000

    let nuevosItems
    if (nuevaCantidad <= 0 || pesos.length === 0) {
      // Eliminar el item completo si no quedan piezas
      nuevosItems = itemsActuales.filter(i => i.articulo_id !== itemDetalle.articulo_id)
    } else {
      nuevosItems = itemsActuales.map(i =>
        i.articulo_id === itemDetalle.articulo_id
          ? { ...i, cantidad: nuevaCantidad, pesos_escaneados: pesos }
          : i
      )
    }

    const quedanPiezas = pesos.length > 0

    setOrden(prev => ({
      ...prev,
      canastos: prev.canastos.map(c =>
        c.id === canastoActivo.id ? { ...c, items: nuevosItems } : c
      )
    }))
    mostrarFeedback(`Pieza eliminada (${pesoEliminado}kg)`, true)
    if (!quedanPiezas) setMostrarPiezas(false)

    api.put(`/api/traspasos/canastos/${canastoActivo.id}`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al eliminar pieza')
        cargar()
      })
  }

  // Eliminar una unidad (no pesable resta 1, pesable sin pesos_escaneados resta pesoPromedioPieza)
  const eliminarUnidad = async () => {
    if (!canastoActivo || !itemDetalle) return
    const canasto = (orden.canastos || []).find(c => c.id === canastoActivo.id)
    if (!canasto || canasto.estado !== 'en_preparacion') return

    const itemsActuales = canasto.items || []
    const itemCanasto = itemsActuales.find(i => i.articulo_id === itemDetalle.articulo_id)
    if (!itemCanasto) return

    const restar = itemDetalle.es_pesable && itemDetalle.pesoPromedioPieza
      ? itemDetalle.pesoPromedioPieza
      : 1
    const nuevaCantidad = Math.round((itemCanasto.cantidad - restar) * 1000) / 1000
    let nuevosItems
    if (nuevaCantidad <= 0) {
      nuevosItems = itemsActuales.filter(i => i.articulo_id !== itemDetalle.articulo_id)
    } else {
      nuevosItems = itemsActuales.map(i =>
        i.articulo_id === itemDetalle.articulo_id ? { ...i, cantidad: nuevaCantidad } : i
      )
    }

    setOrden(prev => ({
      ...prev,
      canastos: prev.canastos.map(c =>
        c.id === canastoActivo.id ? { ...c, items: nuevosItems } : c
      )
    }))
    mostrarFeedback('-1 ' + itemDetalle.nombre, true)
    if (nuevaCantidad <= 0) setMostrarPiezas(false)

    api.put(`/api/traspasos/canastos/${canastoActivo.id}`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al eliminar unidad')
        cargar()
      })
  }

  // Confirmar pieza con peso fuera de rango
  const confirmarPesoFueraDeRango = async () => {
    if (!alertaPeso || !canastoActivo) return
    const { balanza, itemActual } = alertaPeso

    // Bloquear si ya está completo
    if (pickEnPiezas(itemActual) >= cantidadEnPiezas(itemActual)) {
      mostrarFeedback('Artículo ya completo', false)
      setAlertaPeso(null)
      return
    }

    const canasto = (orden.canastos || []).find(c => c.id === canastoActivo.id)
    if (!canasto || canasto.estado !== 'en_preparacion') { setAlertaPeso(null); return }

    const cantAgregar = balanza.pesoKg
    const itemsActuales = canasto.items || []
    const yaExiste = itemsActuales.find(i => i.articulo_id === itemActual.articulo_id)

    let nuevosItems
    if (yaExiste) {
      nuevosItems = itemsActuales.map(i => {
        if (i.articulo_id !== itemActual.articulo_id) return i
        const updated = { ...i, cantidad: Math.round((i.cantidad + cantAgregar) * 1000) / 1000 }
        updated.pesos_escaneados = [...(i.pesos_escaneados || []), balanza.pesoKg]
        return updated
      })
    } else {
      nuevosItems = [...itemsActuales, {
        articulo_id: itemActual.articulo_id,
        codigo: itemActual.codigo,
        nombre: itemActual.nombre,
        cantidad: cantAgregar,
        es_pesable: itemActual.es_pesable,
        pesos_escaneados: [balanza.pesoKg],
      }]
    }

    setOrden(prev => ({
      ...prev,
      canastos: prev.canastos.map(c =>
        c.id === canastoActivo.id ? { ...c, items: nuevosItems } : c
      )
    }))
    mostrarFeedback('+1 ' + itemActual.nombre, true)
    setAlertaPeso(null)

    api.put(`/api/traspasos/canastos/${canastoActivo.id}`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al guardar')
        cargar()
      })
  }

  // Confirmar pesaje manual grupal
  const confirmarPesoManual = () => {
    if (!canastoActivo || !itemDetalle) return
    const cantidad = parseInt(pesoManualCantidad, 10)
    const pesoTotal = parseFloat(pesoManualPeso)
    if (!cantidad || cantidad <= 0 || !pesoTotal || pesoTotal <= 0) return

    // Validar que no exceda piezas pedidas
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

    // Si fuera de rango, mostrar alerta pero no bloquear
    if ((pesoMin && promedio < pesoMin) || (pesoMax && promedio > pesoMax)) {
      reproducirAlerta()
    }

    // Agregar N piezas al canasto
    const canasto = (orden.canastos || []).find(c => c.id === canastoActivo.id)
    if (!canasto || canasto.estado !== 'en_preparacion') return

    const itemsActuales = canasto.items || []
    const yaExiste = itemsActuales.find(i => i.articulo_id === itemDetalle.articulo_id)
    const nuevosPesos = Array.from({ length: cantidad }, () => promedio)

    let nuevosItems
    if (yaExiste) {
      nuevosItems = itemsActuales.map(i => {
        if (i.articulo_id !== itemDetalle.articulo_id) return i
        return {
          ...i,
          cantidad: Math.round((i.cantidad + pesoTotal) * 1000) / 1000,
          pesos_escaneados: [...(i.pesos_escaneados || []), ...nuevosPesos],
        }
      })
    } else {
      nuevosItems = [...itemsActuales, {
        articulo_id: itemDetalle.articulo_id,
        codigo: itemDetalle.codigo,
        nombre: itemDetalle.nombre,
        cantidad: Math.round(pesoTotal * 1000) / 1000,
        es_pesable: itemDetalle.es_pesable,
        pesos_escaneados: nuevosPesos,
      }]
    }

    setOrden(prev => ({
      ...prev,
      canastos: prev.canastos.map(c =>
        c.id === canastoActivo.id ? { ...c, items: nuevosItems } : c
      )
    }))
    mostrarFeedback(`+${cantidad} pzas (${pesoTotal}kg)`, true)
    setMostrarPesoManual(false)
    setPesoManualCantidad('')
    setPesoManualPeso('')
    setPesoManualError(null)

    api.put(`/api/traspasos/canastos/${canastoActivo.id}`, { items: nuevosItems })
      .catch(err => {
        alert(err.response?.data?.error || 'Error al guardar')
        cargar()
      })
  }

  const cerrarCanasto = () => {
    if (!canastoActivo) return
    setConfirmarCierre(true)
    setFaseCierre('scan')
    setScanCierre('')
    setPesoCanasto('')
    setTimeout(() => scanCierreRef.current?.focus(), 150)
  }

  const handleScanCierre = async (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const codigo = scanCierre.trim()
    if (!codigo) return

    if (codigo !== canastoActivo.precinto) {
      alert('El código no coincide con el canasto abierto')
      setScanCierre('')
      return
    }

    // Precinto validado → cerrar canasto y preguntar si pesar
    try {
      await api.put(`/api/traspasos/canastos/${canastoActivo.id}/cerrar`)
      setFaseCierre('pregunta')
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cerrar')
      setScanCierre('')
    }
  }

  const confirmarCierreConPeso = async () => {
    const peso = parseFloat(pesoCanasto)
    if (!peso || peso <= 0) return

    try {
      await api.put(`/api/traspasos/canastos/${canastoActivo.id}`, { peso_origen: peso })
      setConfirmarCierre(false)
      setCanastoActivo(null)
      setItemDetalle(null)
      setFase('canasto')
      const { data } = await api.get(`/api/traspasos/ordenes/${id}`)
      setOrden(data)
      const canastos = data?.canastos || []
      const todosCerr = canastos.length > 0 && canastos.every(c => c.estado === 'cerrado')
      if (todosCerr) {
        const pesos = {}
        for (const c of canastos) pesos[c.id] = c.peso_origen ? String(c.peso_origen) : ''
        setPesosCanastos(pesos)
        setPesandoCanastoId(null)
        setMostrarCerrarPedido(true)
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar peso')
    }
  }

  const saltarPesaje = async () => {
    setConfirmarCierre(false)
    setCanastoActivo(null)
    setItemDetalle(null)
    setFase('canasto')
    const { data } = await api.get(`/api/traspasos/ordenes/${id}`)
    setOrden(data)
    // Si todos los canastos están cerrados, abrir modal cerrar pedido automáticamente
    const canastos = data?.canastos || []
    const todosCerr = canastos.length > 0 && canastos.every(c => c.estado === 'cerrado')
    if (todosCerr) {
      const pesos = {}
      for (const c of canastos) pesos[c.id] = c.peso_origen ? String(c.peso_origen) : ''
      setPesosCanastos(pesos)
      setPesandoCanastoId(null)
      setMostrarCerrarPedido(true)
    }
  }

  const moverItemACanasto = async (destinoId) => {
    if (!moverItem) return
    const { item, canastoOrigenId } = moverItem
    const canastoOrigen = (orden.canastos || []).find(c => c.id === canastoOrigenId)
    const canastoDestino = (orden.canastos || []).find(c => c.id === destinoId)
    if (!canastoOrigen || !canastoDestino) return

    // Quitar del origen
    const itemsOrigen = (canastoOrigen.items || []).filter(i => i.articulo_id !== item.articulo_id)
    // Agregar al destino
    const itemsDestino = canastoDestino.items || []
    const yaExiste = itemsDestino.find(i => i.articulo_id === item.articulo_id)
    let nuevosItemsDestino
    if (yaExiste) {
      nuevosItemsDestino = itemsDestino.map(i => {
        if (i.articulo_id !== item.articulo_id) return i
        return {
          ...i,
          cantidad: Math.round((i.cantidad + item.cantidad) * 1000) / 1000,
          pesos_escaneados: [...(i.pesos_escaneados || []), ...(item.pesos_escaneados || [])],
        }
      })
    } else {
      nuevosItemsDestino = [...itemsDestino, { ...item }]
    }

    try {
      await api.put(`/api/traspasos/canastos/${canastoOrigenId}`, { items: itemsOrigen })
      await api.put(`/api/traspasos/canastos/${destinoId}`, { items: nuevosItemsDestino })
      setMoverItem(null)
      setCanastoViendo(null)
      mostrarFeedback(`Movido a ${canastoDestino.precinto}`, true)
      await cargar()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al mover artículo')
    }
  }

  const abrirCerrarPedido = () => {
    // Si hay canasto activo, pedir cerrarlo primero
    if (canastoActivo && canastoActivo.estado === 'en_preparacion') {
      mostrarFeedback('Cerrá el canasto abierto primero', false)
      cerrarCanasto()
      return
    }
    const pesos = {}
    for (const c of (orden.canastos || [])) {
      pesos[c.id] = c.peso_origen ? String(c.peso_origen) : ''
    }
    setPesosCanastos(pesos)
    setPesandoCanastoId(null)
    setMostrarCerrarPedido(true)
  }

  const guardarPesoCanasto = async (canastoId) => {
    const peso = parseFloat(pesosCanastos[canastoId])
    if (!peso || peso <= 0) return
    try {
      await api.put(`/api/traspasos/canastos/${canastoId}`, { peso_origen: peso })
      setPesandoCanastoId(null)
      await cargar()
      // Actualizar pesos locales tras recargar
      setPesosCanastos(prev => ({ ...prev, [canastoId]: String(peso) }))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar peso')
    }
  }

  const marcarPreparado = async () => {
    // Verificar que todos los canastos tengan peso
    const sinPeso = (orden.canastos || []).filter(c => !c.peso_origen)
    if (sinPeso.length > 0) {
      alert('Todos los canastos deben tener peso registrado')
      return
    }
    try {
      await api.put(`/api/traspasos/ordenes/${id}/preparado`)
      navigate('/preparacion')
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
  }

  // Modal de confirmación de cierre de canasto
  const modalCierreCanasto = confirmarCierre && (
    <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => faseCierre === 'scan' ? setConfirmarCierre(false) : null}>
      <div className="bg-white rounded-t-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {faseCierre === 'scan' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">Cerrar canasto</h3>
              <button onClick={() => setConfirmarCierre(false)} className="p-2 rounded-lg active:bg-gray-100">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-500">Escaneá el precinto del canasto <span className="font-semibold text-gray-700">{canastoActivo?.precinto}</span> para confirmar el cierre</p>
            <input ref={scanCierreRef} type="text" value={scanCierre}
              onChange={e => setScanCierre(e.target.value)} onKeyDown={handleScanCierre}
              placeholder="Escanear precinto..." autoComplete="off" autoFocus
              className="w-full border-2 border-sky-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
          </>
        )}

        {faseCierre === 'pregunta' && (
          <>
            <div className="text-center space-y-3 pt-2">
              <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Canasto cerrado</h3>
              <p className="text-sm text-gray-500">¿Desea pesar el canasto ahora?</p>
            </div>
            <div className="flex gap-3">
              <button onClick={saltarPesaje}
                className="flex-1 bg-gray-200 active:bg-gray-300 text-gray-700 py-4 rounded-xl text-base font-semibold">
                No, después
              </button>
              <button onClick={() => { setFaseCierre('peso'); setPesoCanasto('') }}
                className="flex-1 bg-sky-600 active:bg-sky-700 text-white py-4 rounded-xl text-base font-semibold">
                Sí, pesar
              </button>
            </div>
          </>
        )}

        {faseCierre === 'peso' && (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">Pesar canasto</h3>
              <button onClick={saltarPesaje} className="p-2 rounded-lg active:bg-gray-100">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-500">Ingresá el peso total del canasto <span className="font-semibold text-gray-700">{canastoActivo?.precinto}</span></p>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Peso (kg)</label>
              <input type="number" inputMode="decimal" min="0.001" step="0.001"
                value={pesoCanasto} onChange={e => setPesoCanasto(e.target.value)}
                placeholder="Ej: 12.500" autoFocus
                className="w-full border-2 border-sky-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>
            <button onClick={confirmarCierreConPeso}
              disabled={!pesoCanasto || parseFloat(pesoCanasto) <= 0}
              className={`w-full py-4 rounded-xl text-base font-semibold ${
                pesoCanasto && parseFloat(pesoCanasto) > 0
                  ? 'bg-emerald-600 active:bg-emerald-700 text-white'
                  : 'bg-gray-200 text-gray-400'
              }`}>
              Guardar peso · {pesoCanasto ? `${pesoCanasto} kg` : '—'}
            </button>
          </>
        )}
      </div>
    </div>
  )

  // Modal cerrar pedido — listado de canastos con pesos
  const canastosOrden = orden?.canastos || []
  const todosConPesoOrden = canastosOrden.length > 0 && canastosOrden.every(c => c.peso_origen)
  const handleScanPesaje = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const codigo = scanPesaje.trim()
    if (!codigo || !pesandoCanastoId) return
    const canasto = canastosOrden.find(c => c.id === pesandoCanastoId)
    if (!canasto || codigo !== canasto.precinto) {
      mostrarFeedback('Código no coincide con este canasto', false)
      setScanPesaje('')
      return
    }
    setFasePesaje('peso')
    setScanPesaje('')
  }

  const modalCerrarPedido = mostrarCerrarPedido && (
    <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => { if (!pesandoCanastoId) setMostrarCerrarPedido(false) }}>
      <div className="bg-white rounded-t-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-800">
            {pesandoCanastoId ? (fasePesaje === 'scan' ? 'Escanear canasto' : 'Pesar canasto') : 'Cerrar pedido'}
          </h3>
          <button onClick={() => { if (pesandoCanastoId) { setPesandoCanastoId(null); setFasePesaje('scan') } else { setMostrarCerrarPedido(false) } }} className="p-2 rounded-lg active:bg-gray-100">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!pesandoCanastoId ? (
          <>
            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
              {canastosOrden.map(c => {
                const tienePeso = !!c.peso_origen
                const itemsCount = (c.items || []).length
                return (
                  <div key={c.id} className={`border rounded-xl p-4 space-y-2 ${tienePeso ? 'border-emerald-300 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/50'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-800">{c.precinto}</span>
                        <span className="text-xs text-gray-400 ml-2">{itemsCount} item{itemsCount !== 1 ? 's' : ''}</span>
                      </div>
                      {tienePeso ? (
                        <span className="text-sm font-bold text-emerald-700">{c.peso_origen} kg</span>
                      ) : (
                        <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">Sin peso</span>
                      )}
                    </div>
                    <button onClick={() => { setPesandoCanastoId(c.id); setFasePesaje('scan'); setScanPesaje('') }}
                      className={`w-full py-2 rounded-lg text-sm font-medium ${tienePeso ? 'text-emerald-700 active:bg-emerald-100' : 'bg-amber-200 text-amber-800 active:bg-amber-300'}`}>
                      {tienePeso ? 'Cambiar peso' : 'Pesar ahora'}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex-shrink-0">
              <button onClick={() => { setMostrarCerrarPedido(false); marcarPreparado() }}
                disabled={!todosConPesoOrden}
                className={`w-full py-4 rounded-xl text-base font-semibold ${
                  todosConPesoOrden
                    ? 'bg-emerald-600 active:bg-emerald-700 text-white'
                    : 'bg-gray-200 text-gray-400'
                }`}>
                {todosConPesoOrden ? 'Orden preparada' : 'Faltan pesos por registrar'}
              </button>
            </div>
          </>
        ) : fasePesaje === 'scan' ? (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-500">Escaneá el precinto del canasto <span className="font-semibold text-gray-700">{canastosOrden.find(c => c.id === pesandoCanastoId)?.precinto}</span></p>
            <input type="text" value={scanPesaje}
              onChange={e => setScanPesaje(e.target.value)} onKeyDown={handleScanPesaje}
              placeholder="Escanear precinto..." autoComplete="off" autoFocus
              className="w-full border-2 border-sky-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-500">Ingresá el peso del canasto <span className="font-semibold text-gray-700">{canastosOrden.find(c => c.id === pesandoCanastoId)?.precinto}</span></p>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Peso (kg)</label>
              <input type="number" inputMode="decimal" min="0.001" step="0.001"
                value={pesosCanastos[pesandoCanastoId] || ''} onChange={e => setPesosCanastos(prev => ({ ...prev, [pesandoCanastoId]: e.target.value }))}
                placeholder="Ej: 12.500" autoFocus
                className="w-full border-2 border-sky-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
              />
            </div>
            <button onClick={() => { guardarPesoCanasto(pesandoCanastoId); setFasePesaje('scan') }}
              disabled={!pesosCanastos[pesandoCanastoId] || parseFloat(pesosCanastos[pesandoCanastoId]) <= 0}
              className={`w-full py-4 rounded-xl text-base font-semibold ${
                pesosCanastos[pesandoCanastoId] && parseFloat(pesosCanastos[pesandoCanastoId]) > 0
                  ? 'bg-emerald-600 active:bg-emerald-700 text-white'
                  : 'bg-gray-200 text-gray-400'
              }`}>
              Guardar peso · {pesosCanastos[pesandoCanastoId] ? `${pesosCanastos[pesandoCanastoId]} kg` : '—'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  // === RENDER ===

  if (cargando) return (
    <div className="min-h-screen bg-gray-100">
      <BotonVolver onClick={() => navigate('/preparacion')} />
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600" />
      </div>
    </div>
  )

  if (!orden) return null

  const canastos = orden.canastos || []
  const todosCerrados = canastos.length > 0 && canastos.every(c => c.estado === 'cerrado')

  // ═══════════════════════════════════════
  // FASE 1: ESCANEAR CANASTO
  // ═══════════════════════════════════════
  if (fase === 'canasto') {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="bg-sky-600 text-white px-2 py-3 flex items-center gap-2">
          <button onClick={() => navigate('/preparacion')} className="p-2 rounded-lg active:bg-sky-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="text-base font-medium">{orden.sucursal_origen_nombre} → {orden.sucursal_destino_nombre}</div>
            <div className="text-sky-200 text-sm">{itemsOrdenados.length} artículos · {canastos.length} canasto{canastos.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <div className="px-4 py-6 space-y-6">
          {canastos.length > 0 && (
            <div className="space-y-2">
              {canastos.map(c => (
                <button key={c.id}
                  onClick={() => {
                    if (c.estado === 'en_preparacion') { setCanastoActivo(c); setFase('picking') }
                    else { setCanastoViendo(c) }
                  }}
                  className={`w-full text-left bg-white rounded-xl border p-4 flex items-center justify-between ${
                    c.estado === 'en_preparacion' ? 'border-amber-300 active:bg-amber-50' : 'border-gray-200 active:bg-gray-50'
                  }`}
                >
                  <div>
                    <div className="font-medium text-gray-800">{c.precinto}</div>
                    <div className="text-xs text-gray-400">{(c.items || []).length} items{c.peso_origen ? ` · ${c.peso_origen}kg` : ''}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${c.estado === 'en_preparacion' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {c.estado === 'en_preparacion' ? 'Abierto' : 'Cerrado'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-4">
            <div className="bg-sky-100 text-sky-600 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Escanear canasto</h2>
              <p className="text-sm text-gray-500 mt-1">Escaneá el precinto para abrir un canasto</p>
            </div>
            <input ref={scanCanastoRef} type="text" value={scanCanasto}
              onChange={e => setScanCanasto(e.target.value)} onKeyDown={handleScanCanasto}
              placeholder="Código de precinto..." autoComplete="off" autoFocus
              className="w-full border-2 border-sky-300 rounded-xl px-4 py-4 text-lg text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
            />
          </div>

          {todosCerrados && (
            <button onClick={abrirCerrarPedido}
              className="w-full bg-emerald-600 active:bg-emerald-700 text-white py-4 rounded-xl text-base font-semibold">
              Cerrar pedido
            </button>
          )}
        </div>
        {/* Modal ver contenido de canasto cerrado */}
        {canastoViendo && !moverItem && (
          <div className="fixed inset-0 z-40 bg-black/40 flex flex-col justify-end" onClick={() => setCanastoViendo(null)}>
            <div className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">Canasto {canastoViendo.precinto}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{(canastoViendo.items || []).length} artículo{(canastoViendo.items || []).length !== 1 ? 's' : ''}{canastoViendo.peso_origen ? ` · ${canastoViendo.peso_origen} kg` : ''}</p>
                </div>
                <button onClick={() => setCanastoViendo(null)} className="p-2 rounded-lg active:bg-gray-100">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
                {(canastoViendo.items || []).map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{item.nombre}</div>
                      <div className="text-xs text-gray-400">{item.codigo} · {item.es_pesable ? `${item.cantidad} kg` : `${item.cantidad} ud${item.cantidad !== 1 ? 's' : ''}`}
                        {item.pesos_escaneados?.length > 0 && ` · ${item.pesos_escaneados.length} pza${item.pesos_escaneados.length !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    {canastos.filter(c => c.id !== canastoViendo.id).length > 0 && (
                      <button onClick={() => setMoverItem({ item, canastoOrigenId: canastoViendo.id })}
                        className="text-red-500 active:text-red-700 p-2 rounded-lg active:bg-red-50 ml-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Modal seleccionar canasto destino */}
        {moverItem && (
          <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setMoverItem(null)}>
            <div className="bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-800">Mover artículo</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{moverItem.item.nombre}</p>
                </div>
                <button onClick={() => setMoverItem(null)} className="p-2 rounded-lg active:bg-gray-100">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-500">¿A qué canasto querés moverlo?</p>
              <div className="space-y-2">
                {canastos.filter(c => c.id !== moverItem.canastoOrigenId).map(c => (
                  <button key={c.id} onClick={() => moverItemACanasto(c.id)}
                    className="w-full text-left bg-gray-50 active:bg-gray-100 border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-gray-800">{c.precinto}</span>
                      <span className="text-xs text-gray-400 ml-2">{(c.items || []).length} items</span>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {modalCerrarPedido}
      </div>
    )
  }

  // ═══════════════════════════════════════
  // FASE 3: DETALLE DE ARTÍCULO (escaneo)
  // ═══════════════════════════════════════
  if (fase === 'detalle' && itemDetalle) {
    const pickKg = pickEnKg(itemDetalle)
    const pick = pickKg
    const pedido = itemDetalle.cantidad_solicitada || 0
    const ppp = itemDetalle.pesoPromedioPieza
    const stock = stockOrigen[itemDetalle.articulo_id]

    const pedidoPiezas = cantidadEnPiezas(itemDetalle)
    const pickPiezas = pickEnPiezas(itemDetalle)
    const completo = pickPiezas >= pedidoPiezas

    return (
      <div className="min-h-screen bg-gray-100 pb-40">
        {/* Banner canasto con navegación */}
        <div className="bg-amber-500 text-white px-2 py-2 flex items-center gap-2">
          <button onClick={() => { setFase('picking'); setItemDetalle(null); setMostrarPiezas(false) }}
            className="p-2 rounded-lg active:bg-amber-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="font-semibold text-sm flex-1">Canasto: {canastoActivo?.precinto}</span>
          <button onClick={cerrarCanasto}
            className="text-xs bg-amber-600 active:bg-amber-700 px-3 py-1.5 rounded-lg font-medium">
            Cerrar canasto
          </button>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`px-4 py-2 text-sm font-medium text-center ${feedback.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {feedback.msg}
          </div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* Imagen grande */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <img
              src={`${API_BASE}/api/articulos/${itemDetalle.articulo_id}/imagen`}
              alt={itemDetalle.nombre}
              className="w-full h-64 object-contain bg-gray-50"
            />
          </div>

          {/* Info del artículo */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h2 className="text-lg font-semibold text-gray-800">{itemDetalle.nombre}</h2>
            <div className="text-sm text-gray-400">{itemDetalle.codigo}</div>

            {/* Stock */}
            {stock !== undefined && (
              <div className="flex gap-4">
                <div className="bg-gray-50 rounded-lg px-3 py-2 flex-1 text-center">
                  <div className="text-lg font-bold text-gray-800">{stock}<span className="text-sm font-normal text-gray-500"> kg</span></div>
                  <div className="text-xs text-gray-400">Stock</div>
                </div>
                {ppp && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 flex-1 text-center">
                    <div className="text-lg font-bold text-gray-800">{Math.round(stock / ppp)}<span className="text-sm font-normal text-gray-500"> pzas</span></div>
                    <div className="text-xs text-gray-400">≈ Piezas</div>
                  </div>
                )}
              </div>
            )}

            {/* Progreso de picking */}
            <div className="flex items-center gap-4 pt-2">
              <CirculoProgreso actual={pickPiezas} total={pedidoPiezas} size={64} />
              <div className="flex-1">
                <div className={`text-2xl font-bold ${completo ? 'text-emerald-600' : 'text-gray-800'}`}>
                  {pickPiezas} / {pedidoPiezas}
                </div>
                <div className="text-sm text-gray-500">
                  {itemDetalle.es_pesable ? 'piezas escaneadas' : 'unidades escaneadas'}
                </div>
                {itemDetalle.es_pesable && (
                  <div className="text-sm text-sky-600 font-semibold mt-0.5">
                    {pick} kg validados
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Modal de piezas validadas */}
        {mostrarPiezas && (() => {
          const canasto = (orden.canastos || []).find(c => c.id === canastoActivo?.id)
          const itemCanasto = canasto ? (canasto.items || []).find(i => i.articulo_id === itemDetalle.articulo_id) : null
          const pesos = itemCanasto?.pesos_escaneados || []
          const esPesable = itemDetalle.es_pesable
          const ppUnit = itemDetalle.pesoPromedioPieza

          // Construir lista de piezas: si hay pesos_escaneados usar esos, sino generar desde cantidad
          let piezas = []
          if (pesos.length > 0) {
            piezas = pesos.map((p, i) => ({ idx: i, peso: p }))
          } else if (esPesable && ppUnit && itemCanasto) {
            // Fallback: N piezas con peso promedio
            const n = Math.round(itemCanasto.cantidad / ppUnit)
            piezas = Array.from({ length: n }, (_, i) => ({ idx: i, peso: Math.round(ppUnit * 1000) / 1000 }))
          } else if (itemCanasto) {
            piezas = Array.from({ length: itemCanasto.cantidad }, (_, i) => ({ idx: i, peso: null }))
          }
          const totalKg = piezas.reduce((s, p) => s + (p.peso || 0), 0)

          return (
            <div className="fixed inset-0 z-40 bg-black/40 flex flex-col justify-end" onClick={() => setMostrarPiezas(false)}>
              <div className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
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

                {/* Lista scrolleable */}
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
                        <button onClick={() => pesos.length > 0 ? eliminarPieza(pieza.idx) : eliminarUnidad()}
                          className="text-red-500 active:text-red-700 p-2 rounded-lg active:bg-red-50">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer con total */}
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

                {/* Cálculo en vivo */}
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

                {/* Error de validación */}
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
                    valido
                      ? 'bg-sky-600 active:bg-sky-700 text-white'
                      : 'bg-gray-200 text-gray-400'
                  }`}>
                  Confirmar {valido ? `· ${cant} pza${cant !== 1 ? 's' : ''} · ${peso}kg` : ''}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Alerta de peso fuera de rango — advertencia con confirmación */}
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

        {/* Barra inferior fija — escaneo + validado */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 space-y-2 safe-area-bottom">
          <input ref={scanArticuloRef} type="text" value={scanArticulo}
            onChange={e => setScanArticulo(e.target.value)} onKeyDown={handleScanArticulo}
            placeholder="Escanear código de barras..." autoComplete="off" autoFocus
            className="w-full border-2 border-sky-300 rounded-xl px-4 py-3.5 text-base text-center focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none"
          />
          {itemDetalle.es_pesable && (
            <button onClick={() => { setMostrarPesoManual(true); setPesoManualCantidad(''); setPesoManualPeso(''); setPesoManualError(null) }}
              className="w-full text-sm text-gray-400 active:text-gray-600 py-1">
              Pesar manual (sin etiqueta)
            </button>
          )}
          {pickPiezas > 0 && (
            <button onClick={() => setMostrarPiezas(true)}
              className="w-full bg-sky-50 active:bg-sky-100 border-2 border-sky-300 text-sky-700 py-3 rounded-xl text-base font-semibold">
              Validado · {pickPiezas} {itemDetalle.es_pesable ? 'pza' : 'ud'}{pickPiezas !== 1 ? 's' : ''}
              {itemDetalle.es_pesable && <span className="font-normal text-sky-500"> · {pick} kg</span>}
            </button>
          )}
          {completo && (
            <div className="text-center text-emerald-600 text-sm font-medium py-1">
              Artículo completo
            </div>
          )}
        </div>

        {modalCierreCanasto}
      </div>
    )
  }

  // ═══════════════════════════════════════
  // FASE 2: LISTA DE ARTÍCULOS (picking)
  // ═══════════════════════════════════════

  // Agrupar por rubro
  const rubroGroups = {}
  for (const item of itemsOrdenados) {
    const rubro = item.rubro || 'Sin rubro'
    if (!rubroGroups[rubro]) rubroGroups[rubro] = []
    rubroGroups[rubro].push(item)
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* Banner canasto con navegación */}
      <div className="bg-amber-500 text-white px-2 py-2 flex items-center gap-2">
        <button onClick={() => { setFase('canasto'); setCanastoActivo(null) }}
          className="p-2 rounded-lg active:bg-amber-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <span className="font-semibold flex-1">Canasto: {canastoActivo?.precinto}</span>
        <button onClick={cerrarCanasto}
          className="text-xs bg-amber-600 active:bg-amber-700 px-3 py-1.5 rounded-lg font-medium">
          Cerrar canasto
        </button>
      </div>

      {/* Lista de artículos por rubro */}
      <div className="px-3 py-3 space-y-4">
        {Object.entries(rubroGroups).map(([rubro, items]) => (
          <div key={rubro}>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1 mb-1.5">{rubro}</div>
            <div className="space-y-1.5">
              {items.map((item, idx) => {
                const piezasPedidas = cantidadEnPiezas(item)
                const piezasPick = pickEnPiezas(item)
                const completo = pickEnPiezas(item) >= cantidadEnPiezas(item)

                return (
                  <button key={idx}
                    onClick={() => {
                      completoAlAbrir.current = pickEnPiezas(item) >= cantidadEnPiezas(item)
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
                        {piezasPick}/{piezasPedidas} {item.es_pesable ? 'pzas' : 'uds'}
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

      {/* Barra inferior — cerrar pedido */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 safe-area-bottom">
        <button onClick={abrirCerrarPedido}
          className="w-full bg-blue-600 active:bg-blue-700 text-white py-3.5 rounded-xl text-sm font-semibold">
          Cerrar pedido
        </button>
      </div>

      {modalCerrarPedido}
      {modalCierreCanasto}
    </div>
  )
}

export default Preparacion
