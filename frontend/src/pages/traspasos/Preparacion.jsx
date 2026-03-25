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
  const [moverFase, setMoverFase] = useState('destino') // 'destino' | 'cantidad'
  const [moverCantidad, setMoverCantidad] = useState(1)
  const [moverPiezasSeleccionadas, setMoverPiezasSeleccionadas] = useState([])
  const [moverDestinoId, setMoverDestinoId] = useState(null)

  // Alerta de peso fuera de rango
  const [alertaPeso, setAlertaPeso] = useState(null) // { peso, min, max, nombre }

  // Pesaje manual (artículos sin etiqueta)
  const [mostrarPesoManual, setMostrarPesoManual] = useState(false)
  const [pesoManualCantidad, setPesoManualCantidad] = useState('')
  const [pesoManualPeso, setPesoManualPeso] = useState('')
  const [pesoManualError, setPesoManualError] = useState(null)

  // Modal de artículos pendientes al cerrar
  const [modalPendientes, setModalPendientes] = useState(null) // { fase: 'pregunta'|'motivos', pendientes: [...], motivos: {} }
  const [enviandoPendientes, setEnviandoPendientes] = useState(false)

  // Bulto
  const [mostrarNuevoBulto, setMostrarNuevoBulto] = useState(false)
  const [nombreBulto, setNombreBulto] = useState('')

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
        pppOrden: item.peso_promedio_pieza || null, // el ppp con el que se creó la orden (para cálculo de piezas)
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
  // Usa pppOrden (el ppp al momento de crear la orden) — si no había ppp, cantidad_solicitada ya está en piezas
  const cantidadEnPiezas = (item) => {
    if (!item.es_pesable || !item.pppOrden) return item.cantidad_solicitada
    return Math.round(item.cantidad_solicitada / item.pppOrden)
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
      a.codigo === codigo || (a.codigosBarras && a.codigosBarras.some(b => (typeof b === 'object' ? b.codigo : b) === codigo))
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

  const crearBulto = async () => {
    const nombre = nombreBulto.trim()
    if (!nombre) return
    try {
      const { data } = await api.post(`/api/traspasos/ordenes/${id}/canastos`, {
        tipo: 'bulto',
        nombre,
      })
      setMostrarNuevoBulto(false)
      setNombreBulto('')
      await cargar()
      if (data?.id) {
        setCanastoActivo(data)
        setFase('picking')
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error al crear bulto')
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
      // Barcode normal — soporta formato objeto {codigo,factor} y string legacy
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
    mostrarFeedback(`+${cantAgregar} ${itemActual.nombre}`, true)
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

  const cerrarCanasto = async () => {
    if (!canastoActivo) return
    // Bultos: cerrar directamente sin escaneo de precinto
    if (canastoActivo.tipo === 'bulto') {
      try {
        await api.put(`/api/traspasos/canastos/${canastoActivo.id}/cerrar`)
        setCanastoActivo(null)
        setItemDetalle(null)
        setFase('canasto')
        const { data } = await api.get(`/api/traspasos/ordenes/${id}`)
        setOrden(data)
        const cs = data?.canastos || []
        const todosCerr = cs.length > 0 && cs.every(c => c.estado === 'cerrado')
        if (todosCerr) {
          const pesos = {}
          for (const c of cs) pesos[c.id] = c.peso_origen ? String(c.peso_origen) : ''
          setPesosCanastos(pesos)
          setPesandoCanastoId(null)
          setMostrarCerrarPedido(true)
        }
      } catch (err) {
        alert(err.response?.data?.error || 'Error al cerrar bulto')
      }
      return
    }
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

  const cancelarMover = () => {
    setMoverItem(null)
    setMoverFase('destino')
    setMoverCantidad(1)
    setMoverPiezasSeleccionadas([])
    setMoverDestinoId(null)
  }

  const volverADestino = () => {
    setMoverFase('destino')
    setMoverCantidad(1)
    setMoverPiezasSeleccionadas([])
    setMoverDestinoId(null)
  }

  const seleccionarDestinoMover = (destinoId) => {
    setMoverDestinoId(destinoId)
    setMoverCantidad(1)
    setMoverPiezasSeleccionadas([])
    setMoverFase('cantidad')
  }

  const ejecutarMover = async () => {
    if (!moverItem || !moverDestinoId) return
    const { item, canastoOrigenId } = moverItem
    const canastoOrigen = (orden.canastos || []).find(c => c.id === canastoOrigenId)
    const canastoDestino = (orden.canastos || []).find(c => c.id === moverDestinoId)
    if (!canastoOrigen || !canastoDestino) return

    const esPesableConPiezas = item.es_pesable && (item.pesos_escaneados || []).length > 0
    const totalDisponible = esPesableConPiezas ? (item.pesos_escaneados || []).length : item.cantidad
    const moverTodo = esPesableConPiezas
      ? moverPiezasSeleccionadas.length === totalDisponible
      : moverCantidad >= totalDisponible

    let itemParaMover
    let itemOrigenRestante

    if (esPesableConPiezas) {
      // Pesable con piezas: mover las seleccionadas
      const pesosSeleccionados = moverPiezasSeleccionadas.map(i => item.pesos_escaneados[i])
      const pesosRestantes = item.pesos_escaneados.filter((_, i) => !moverPiezasSeleccionadas.includes(i))
      const kgMover = Math.round(pesosSeleccionados.reduce((s, p) => s + p, 0) * 1000) / 1000
      const kgRestante = Math.round(pesosRestantes.reduce((s, p) => s + p, 0) * 1000) / 1000

      itemParaMover = { ...item, cantidad: kgMover, pesos_escaneados: pesosSeleccionados }
      itemOrigenRestante = moverTodo ? null : { ...item, cantidad: kgRestante, pesos_escaneados: pesosRestantes }
    } else {
      // No pesable (o pesable sin piezas): mover por cantidad
      const cantMover = Math.min(moverCantidad, totalDisponible)
      itemParaMover = { ...item, cantidad: cantMover }
      itemOrigenRestante = moverTodo ? null : { ...item, cantidad: Math.round((item.cantidad - cantMover) * 1000) / 1000 }
    }

    // Items origen: quitar o reducir
    let itemsOrigen
    if (moverTodo) {
      itemsOrigen = (canastoOrigen.items || []).filter(i => i.articulo_id !== item.articulo_id)
    } else {
      itemsOrigen = (canastoOrigen.items || []).map(i => {
        if (i.articulo_id !== item.articulo_id) return i
        return itemOrigenRestante
      })
    }

    // Items destino: merge si ya existe
    const itemsDestino = canastoDestino.items || []
    const yaExiste = itemsDestino.find(i => i.articulo_id === item.articulo_id)
    let nuevosItemsDestino
    if (yaExiste) {
      nuevosItemsDestino = itemsDestino.map(i => {
        if (i.articulo_id !== item.articulo_id) return i
        return {
          ...i,
          cantidad: Math.round((i.cantidad + itemParaMover.cantidad) * 1000) / 1000,
          pesos_escaneados: [...(i.pesos_escaneados || []), ...(itemParaMover.pesos_escaneados || [])],
        }
      })
    } else {
      nuevosItemsDestino = [...itemsDestino, { ...itemParaMover }]
    }

    try {
      // Enviar peso_origen: null para forzar re-pesaje en ambos canastos
      await api.put(`/api/traspasos/canastos/${canastoOrigenId}`, { items: itemsOrigen, peso_origen: null })
      await api.put(`/api/traspasos/canastos/${moverDestinoId}`, { items: nuevosItemsDestino, peso_origen: null })
      cancelarMover()
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
      // Actualizar estado local sin recargar toda la orden
      setOrden(prev => ({
        ...prev,
        canastos: (prev.canastos || []).map(c =>
          c.id === canastoId ? { ...c, peso_origen: peso } : c
        )
      }))
      setPesosCanastos(prev => ({ ...prev, [canastoId]: String(peso) }))
      setPesandoCanastoId(null)
      setFasePesaje('scan')
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar peso')
    }
  }

  const calcularPendientes = () => {
    const items = orden.items || []
    const preparadoPorArt = {}
    for (const c of (orden.canastos || [])) {
      for (const ci of (c.items || [])) {
        preparadoPorArt[ci.articulo_id] = (preparadoPorArt[ci.articulo_id] || 0) + ci.cantidad
      }
    }
    return items
      .map(item => ({
        ...item,
        cantidad_preparada: preparadoPorArt[item.articulo_id] || 0,
        cantidad_faltante: (item.cantidad_solicitada || item.cantidad) - (preparadoPorArt[item.articulo_id] || 0),
      }))
      .filter(item => item.cantidad_faltante > 0)
  }

  const marcarPreparado = async () => {
    // Verificar que todos los canastos (excepto bultos) tengan peso
    const sinPeso = (orden.canastos || []).filter(c => c.tipo !== 'bulto' && !c.peso_origen)
    if (sinPeso.length > 0) {
      alert('Todos los canastos deben tener peso registrado')
      return
    }

    // Calcular artículos pendientes
    const pendientes = calcularPendientes()
    if (pendientes.length > 0) {
      setModalPendientes({ fase: 'pregunta', pendientes, motivos: {} })
      return
    }

    // Sin pendientes → cerrar directamente
    try {
      await api.put(`/api/traspasos/ordenes/${id}/preparado`)
      navigate('/preparacion')
    } catch (err) {
      alert(err.response?.data?.error || 'Error')
    }
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
        cantidad_solicitada: p.cantidad_solicitada || p.cantidad,
        cantidad_preparada: p.cantidad_preparada,
        cantidad_faltante: p.cantidad_faltante,
        motivo: crearNuevaOrden ? null : (motivos[p.articulo_id] || null),
      }))

      const res = await api.put(`/api/traspasos/ordenes/${id}/preparado`, {
        crear_nueva_orden: crearNuevaOrden,
        articulos_faltantes: articulosFaltantes,
      })

      setModalPendientes(null)
      if (crearNuevaOrden && res.data.nueva_orden_numero) {
        alert(`Orden cerrada. Se creó nueva orden ${res.data.nueva_orden_numero} con los pendientes.`)
      }
      navigate('/preparacion')
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cerrar orden')
    } finally {
      setEnviandoPendientes(false)
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
  const todosConPesoOrden = canastosOrden.length > 0 && canastosOrden.every(c => c.tipo === 'bulto' || c.peso_origen)
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
                const esBulto = c.tipo === 'bulto'
                const tienePeso = esBulto || !!c.peso_origen
                const itemsCount = (c.items || []).length
                return (
                  <div key={c.id} className={`border rounded-xl p-4 space-y-2 ${tienePeso ? 'border-emerald-300 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/50'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{esBulto ? (c.nombre || 'Bulto') : c.precinto}</span>
                        {esBulto && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">Bulto</span>}
                        <span className="text-xs text-gray-400">{itemsCount} item{itemsCount !== 1 ? 's' : ''}</span>
                      </div>
                      {esBulto ? (
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">Sin peso</span>
                      ) : tienePeso ? (
                        <span className="text-sm font-bold text-emerald-700">{c.peso_origen} kg</span>
                      ) : (
                        <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-medium">Sin peso</span>
                      )}
                    </div>
                    {!esBulto && (
                      <button onClick={() => { setPesandoCanastoId(c.id); setFasePesaje('scan'); setScanPesaje('') }}
                        className={`w-full py-2 rounded-lg text-sm font-medium ${c.peso_origen ? 'text-emerald-700 active:bg-emerald-100' : 'bg-amber-200 text-amber-800 active:bg-amber-300'}`}>
                        {c.peso_origen ? 'Cambiar peso' : 'Pesar ahora'}
                      </button>
                    )}
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
            <button onClick={() => guardarPesoCanasto(pesandoCanastoId)}
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
                  {modalPendientes.pendientes.map(p => (
                    <tr key={p.articulo_id}>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.nombre}</div>
                        <div className="text-xs text-gray-400">{p.codigo}</div>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-600">{p.cantidad_solicitada || p.cantidad}</td>
                      <td className="py-2 px-2 text-right text-gray-600">{p.cantidad_preparada}</td>
                      <td className="py-2 pl-2 text-right font-semibold text-amber-600">{p.cantidad_faltante}</td>
                    </tr>
                  ))}
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
                    <div className="font-medium text-gray-800 flex items-center gap-2">
                      {c.tipo === 'bulto' ? (c.nombre || 'Bulto') : c.precinto}
                      {c.tipo === 'bulto' && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Bulto</span>}
                    </div>
                    <div className="text-xs text-gray-400">{(c.items || []).length} items{c.tipo !== 'bulto' && c.peso_origen ? ` · ${c.peso_origen}kg` : ''}</div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${c.estado === 'en_preparacion' ? 'bg-amber-100 text-amber-700' : c.tipo === 'bulto' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                    {c.estado === 'en_preparacion' ? 'Abierto' : c.tipo === 'bulto' ? 'Bulto cerrado' : 'Cerrado'}
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
            <button onClick={() => { setMostrarNuevoBulto(true); setNombreBulto('') }}
              className="w-full mt-3 bg-orange-50 active:bg-orange-100 border-2 border-orange-300 text-orange-700 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Agregar bulto suelto
            </button>
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
                  <h3 className="text-base font-semibold text-gray-800">{canastoViendo.tipo === 'bulto' ? `Bulto: ${canastoViendo.nombre || 'Bulto'}` : `Canasto ${canastoViendo.precinto}`}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{(canastoViendo.items || []).length} artículo{(canastoViendo.items || []).length !== 1 ? 's' : ''}{canastoViendo.tipo !== 'bulto' && canastoViendo.peso_origen ? ` · ${canastoViendo.peso_origen} kg` : ''}</p>
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

        {/* Modal mover artículo — 2 fases */}
        {moverItem && (() => {
          const _item = moverItem.item
          const _esPesableConPiezas = _item.es_pesable && (_item.pesos_escaneados || []).length > 0
          const _totalDisponible = _esPesableConPiezas ? (_item.pesos_escaneados || []).length : _item.cantidad
          const _unidad = _item.es_pesable && !_esPesableConPiezas ? 'kg' : 'ud'

          return (
            <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={cancelarMover}>
              <div className="bg-white rounded-t-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {moverFase === 'cantidad' && (
                      <button onClick={volverADestino} className="p-1.5 rounded-lg active:bg-gray-100">
                        <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                      </button>
                    )}
                    <div>
                      <h3 className="text-base font-semibold text-gray-800">Mover artículo</h3>
                      <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[220px]">{_item.nombre}</p>
                    </div>
                  </div>
                  <button onClick={cancelarMover} className="p-2 rounded-lg active:bg-gray-100">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Fase 1: elegir destino */}
                {moverFase === 'destino' && (
                  <>
                    <p className="text-sm text-gray-500">¿A qué canasto querés moverlo?</p>
                    <div className="space-y-2">
                      {canastos.filter(c => c.id !== moverItem.canastoOrigenId).map(c => (
                        <button key={c.id} onClick={() => seleccionarDestinoMover(c.id)}
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
                  </>
                )}

                {/* Fase 2: elegir cantidad / piezas */}
                {moverFase === 'cantidad' && (
                  <>
                    {_esPesableConPiezas ? (
                      /* Pesable con piezas → checkboxes */
                      <>
                        <p className="text-sm text-gray-500">Seleccioná las piezas a mover</p>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {_item.pesos_escaneados.map((peso, idx) => {
                            const sel = moverPiezasSeleccionadas.includes(idx)
                            return (
                              <label key={idx}
                                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${sel ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200 active:bg-gray-100'}`}>
                                <input type="checkbox" checked={sel}
                                  onChange={() => {
                                    setMoverPiezasSeleccionadas(prev =>
                                      sel ? prev.filter(i => i !== idx) : [...prev, idx]
                                    )
                                  }}
                                  className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <span className="text-sm text-gray-700">Pieza {idx + 1}</span>
                                <span className="text-sm font-semibold text-gray-800 ml-auto">{peso.toFixed(3)} kg</span>
                              </label>
                            )
                          })}
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
                          <button onClick={() => {
                            if (moverPiezasSeleccionadas.length === _item.pesos_escaneados.length) {
                              setMoverPiezasSeleccionadas([])
                            } else {
                              setMoverPiezasSeleccionadas(_item.pesos_escaneados.map((_, i) => i))
                            }
                          }} className="text-blue-600 font-medium active:text-blue-800">
                            {moverPiezasSeleccionadas.length === _item.pesos_escaneados.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                          </button>
                          <span>{moverPiezasSeleccionadas.length} de {_item.pesos_escaneados.length} piezas</span>
                        </div>
                        <button onClick={ejecutarMover}
                          disabled={moverPiezasSeleccionadas.length === 0}
                          className={`w-full py-3 rounded-xl font-semibold text-white text-sm ${moverPiezasSeleccionadas.length > 0 ? 'bg-blue-600 active:bg-blue-700' : 'bg-gray-300'}`}>
                          Mover {moverPiezasSeleccionadas.length} pieza{moverPiezasSeleccionadas.length !== 1 ? 's' : ''}
                        </button>
                      </>
                    ) : (
                      /* No pesable (o pesable sin piezas) → stepper */
                      <>
                        <p className="text-sm text-gray-500">¿Cuántas {_unidad === 'kg' ? 'kg' : 'unidades'} querés mover?</p>
                        <div className="flex items-center justify-center gap-5 py-3">
                          <button onClick={() => setMoverCantidad(prev => Math.max(1, prev - 1))}
                            disabled={moverCantidad <= 1}
                            className={`w-12 h-12 rounded-xl text-2xl font-bold flex items-center justify-center ${moverCantidad <= 1 ? 'bg-gray-100 text-gray-300' : 'bg-gray-200 text-gray-700 active:bg-gray-300'}`}>
                            −
                          </button>
                          <div className="text-center">
                            <span className="text-3xl font-bold text-gray-800">{moverCantidad}</span>
                            <span className="text-lg text-gray-400 ml-1">/ {_totalDisponible}</span>
                          </div>
                          <button onClick={() => setMoverCantidad(prev => Math.min(_totalDisponible, prev + 1))}
                            disabled={moverCantidad >= _totalDisponible}
                            className={`w-12 h-12 rounded-xl text-2xl font-bold flex items-center justify-center ${moverCantidad >= _totalDisponible ? 'bg-gray-100 text-gray-300' : 'bg-gray-200 text-gray-700 active:bg-gray-300'}`}>
                            +
                          </button>
                        </div>
                        <button onClick={ejecutarMover}
                          className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-blue-600 active:bg-blue-700">
                          Mover {moverCantidad} {_unidad === 'kg' ? 'kg' : `unidad${moverCantidad !== 1 ? 'es' : ''}`}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })()}

        {/* Modal nuevo bulto */}
        {mostrarNuevoBulto && (
          <div className="fixed inset-0 z-50 bg-black/40 flex flex-col justify-end" onClick={() => setMostrarNuevoBulto(false)}>
            <div className="bg-white rounded-t-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-800">Nuevo bulto suelto</h3>
                <button onClick={() => setMostrarNuevoBulto(false)} className="p-2 rounded-lg active:bg-gray-100">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-gray-500">Para artículos que no entran en canasto (cajas de vino, pallets, etc.)</p>
              <input type="text" value={nombreBulto}
                onChange={e => setNombreBulto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') crearBulto() }}
                placeholder="Nombre del bulto (ej: Caja vinos)" autoFocus
                className="w-full border-2 border-orange-300 rounded-xl px-4 py-4 text-lg text-center focus:border-orange-500 focus:ring-2 focus:ring-orange-200 outline-none"
              />
              <button onClick={crearBulto}
                disabled={!nombreBulto.trim()}
                className={`w-full py-4 rounded-xl text-base font-semibold ${
                  nombreBulto.trim()
                    ? 'bg-orange-500 active:bg-orange-600 text-white'
                    : 'bg-gray-200 text-gray-400'
                }`}>
                Crear bulto
              </button>
            </div>
          </div>
        )}

        {modalCerrarPedido}
        {modalPendientesJSX}
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
      <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
        {/* Banner canasto con navegación */}
        <div className="bg-amber-500 text-white px-2 py-2 flex items-center gap-2 flex-shrink-0">
          <button onClick={() => { setFase('picking'); setItemDetalle(null); setMostrarPiezas(false) }}
            className="p-2 rounded-lg active:bg-amber-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <span className="font-semibold text-sm flex-1">{canastoActivo?.tipo === 'bulto' ? `Bulto: ${canastoActivo?.nombre || 'Bulto'}` : `Canasto: ${canastoActivo?.precinto}`}</span>
          <button onClick={cerrarCanasto}
            className="text-xs bg-amber-600 active:bg-amber-700 px-3 py-1.5 rounded-lg font-medium">
            Cerrar canasto
          </button>
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`px-4 py-1.5 text-sm font-medium text-center flex-shrink-0 ${feedback.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
            {feedback.msg}
          </div>
        )}

        {/* Contenido central — flex-1 para ocupar todo el espacio disponible */}
        <div className="flex-1 min-h-0 flex flex-col px-3 py-2 gap-2 overflow-hidden">
          {/* Imagen ocupa todo el espacio libre */}
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
                  // Para no pesables: mostrar uds + cajas si hay unidad alternativa
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
                <span className="text-xs font-normal text-gray-500 ml-1">{itemDetalle.es_pesable ? 'pzas' : 'uds'}</span>
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

          // Buscar en TODOS los canastos, no solo el activo
          let piezas = []
          for (const c of (orden.canastos || [])) {
            const ic = (c.items || []).find(i => i.articulo_id === itemDetalle.articulo_id)
            if (!ic) continue
            const pesos = ic.pesos_escaneados || []
            if (pesos.length > 0) {
              pesos.forEach((p, i) => piezas.push({ canasto: c.precinto, peso: p }))
            } else if (esPesable && ppUnit && ic.cantidad > 0) {
              const n = Math.round(ic.cantidad / ppUnit)
              for (let i = 0; i < n; i++) piezas.push({ canasto: c.precinto, peso: Math.round(ppUnit * 1000) / 1000 })
            } else if (ic.cantidad > 0) {
              for (let i = 0; i < ic.cantidad; i++) piezas.push({ canasto: c.precinto, peso: null })
            }
          }
          piezas = piezas.map((p, i) => ({ ...p, idx: i }))
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
                          <div>
                            <span className="text-base font-medium text-gray-800">
                              {pieza.peso != null ? `${pieza.peso} kg` : `Unidad ${pieza.idx + 1}`}
                            </span>
                            {pieza.canasto && <span className="text-xs text-gray-400 ml-2">C: {pieza.canasto}</span>}
                          </div>
                        </div>
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
              Validado · {pickPiezas} {itemDetalle.es_pesable ? 'pza' : 'ud'}{pickPiezas !== 1 ? 's' : ''}
              {itemDetalle.es_pesable && <span className="font-normal text-sky-500"> · {pick} kg</span>}
            </button>
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
        <span className="font-semibold flex-1">{canastoActivo?.tipo === 'bulto' ? `Bulto: ${canastoActivo?.nombre || 'Bulto'}` : `Canasto: ${canastoActivo?.precinto}`}</span>
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
      {modalPendientesJSX}
    </div>
  )
}

export default Preparacion
