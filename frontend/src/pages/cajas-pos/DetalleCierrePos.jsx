// Detalle de un cierre de caja POS con comparacion cajero vs gestor vs ventas POS
import React, { useState, useEffect } from 'react'
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import { imprimirCierre } from '../../utils/imprimirComprobante'

const ESTADOS = {
  abierta: { label: 'Abierta', color: 'bg-teal-100 text-teal-700' },
  pendiente_gestor: { label: 'Pendiente verificacion', color: 'bg-yellow-100 text-yellow-700' },
  pendiente_agente: { label: 'Verificado', color: 'bg-blue-100 text-blue-700' },
  cerrado: { label: 'Cerrado', color: 'bg-green-100 text-green-700' },
  con_diferencia: { label: 'Con diferencia', color: 'bg-red-100 text-red-700' },
}

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const formatHora = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const FilaComparativa = ({ label, valorCajero, valorGestor, valorPos, esMoneda = true }) => {
  const formatVal = (val) => {
    if (val == null) return '—'
    return esMoneda ? formatMonto(val) : val
  }
  // Diferencia: gestor vs pos si hay gestor, sino cajero vs pos
  const base = valorGestor != null ? valorGestor : valorCajero
  const diff = valorPos != null ? base - valorPos : null
  const hayDiferencia = (valorGestor != null && valorCajero !== valorGestor) ||
                        (valorPos != null && base !== valorPos)

  return (
    <div className={`text-sm py-1.5 ${hayDiferencia ? 'bg-red-50 -mx-2 px-2 rounded-lg' : ''}`}>
      <div className="flex items-center">
        <span className="flex-1 text-gray-600 min-w-0 truncate">{label}</span>
        <span className="w-28 text-right font-medium text-gray-800 flex-shrink-0 border-r border-gray-100 pr-3">{formatVal(valorCajero)}</span>
        <span className={`w-28 text-right font-medium flex-shrink-0 border-r border-gray-100 pr-3 ${
          valorGestor == null ? 'text-gray-400' :
          valorCajero !== valorGestor ? 'text-red-600 font-bold' : 'text-gray-800'
        }`}>{formatVal(valorGestor)}</span>
        <span className={`w-28 text-right font-medium flex-shrink-0 border-r border-gray-100 pr-3 ${
          valorPos == null ? 'text-gray-400' :
          base !== valorPos ? 'text-red-600 font-bold' : 'text-teal-700'
        }`}>{formatVal(valorPos)}</span>
        <span className={`w-28 text-right font-medium flex-shrink-0 ${
          diff == null ? 'text-gray-400' :
          diff === 0 ? 'text-green-600' : 'text-red-600 font-bold'
        }`}>{diff == null ? '—' : formatMonto(diff)}</span>
      </div>
    </div>
  )
}

const DetalleCierrePos = () => {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierre, setCierre] = useState(null)
  const [verificacion, setVerificacion] = useState(null)
  const [posVentas, setPosVentas] = useState(null)
  const [posNoEncontrado, setPosNoEncontrado] = useState(false)
  const [denominaciones, setDenominaciones] = useState([])
  const [retiros, setRetiros] = useState([])
  const [gastos, setGastos] = useState([])
  const [cambiosPrecio, setCambiosPrecio] = useState([])
  const [cancelaciones, setCancelaciones] = useState([])
  const [eliminaciones, setEliminaciones] = useState([])
  const [guiaDelivery, setGuiaDelivery] = useState(null)
  const [controlandoGasto, setControlandoGasto] = useState(null)
  const [retiroEmpleadoExpandido, setRetiroEmpleadoExpandido] = useState(null)
  const [cuponesExpanded, setCuponesExpanded] = useState(false)
  const [expandedMedio, setExpandedMedio] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [tabActiva, setTabActiva] = useState('detalle')
  const [movimientos, setMovimientos] = useState(null)
  const [movimientosCargando, setMovimientosCargando] = useState(false)

  useEffect(() => {
    setCargando(true)
    setError('')
    const cargar = async () => {
      try {
        // Fetch cierre and denominaciones in parallel
        const [cierreRes, denomRes] = await Promise.all([
          api.get(`/api/cierres-pos/${id}`),
          api.get('/api/denominaciones'),
        ])

        const cierreData = cierreRes.data
        setCierre(cierreData)
        setDenominaciones(denomRes.data || [])

        // Usar UUID real para todas las llamadas subsiguientes (el id de la URL puede ser un número)
        const cierreId = cierreData.id

        // Fetch retiros, verificacion and POS ventas data in parallel
        const promises = []

        // Retiros: todos los roles, cualquier estado
        promises.push(
          api.get(`/api/cierres-pos/${cierreId}/retiros`)
            .then(res => setRetiros(res.data || []))
            .catch(err => console.error('Error loading retiros:', err.message))
        )

        // Gastos
        promises.push(
          api.get(`/api/cierres-pos/${cierreId}/gastos`)
            .then(res => setGastos(res.data || []))
            .catch(err => console.error('Error loading gastos:', err.message))
        )

        if (usuario?.rol !== 'operario') {
          promises.push(
            api.get(`/api/cierres-pos/${cierreId}/verificacion`)
              .then(res => setVerificacion(res.data))
              .catch(err => console.error('Error loading verificacion:', err.message))
          )
        }

        // Fetch POS ventas data or guia delivery (for admin/gestor, when cierre is not open)
        if (usuario?.rol !== 'operario' && cierreData.estado !== 'abierta') {
          if (cierreData.tipo === 'delivery') {
            promises.push(
              api.get(`/api/cierres-pos/${cierreId}/guia-delivery`)
                .then(res => setGuiaDelivery(res.data))
                .catch(() => setGuiaDelivery(null))
            )
          } else {
            promises.push(
              api.get(`/api/cierres-pos/${cierreId}/pos-ventas`)
                .then(res => setPosVentas(res.data))
                .catch(() => setPosNoEncontrado(true))
            )
          }
        }

        // Cambios de precio, cancelaciones y eliminaciones (solo admin)
        if (esAdmin) {
          promises.push(
            api.get(`/api/cierres-pos/${cierreId}/cambios-precio`)
              .then(res => setCambiosPrecio(res.data || []))
              .catch(err => console.error('Error loading cambios-precio:', err.message))
          )
          promises.push(
            api.get(`/api/cierres-pos/${cierreId}/cancelaciones`)
              .then(res => setCancelaciones(res.data || []))
              .catch(err => console.error('Error loading cancelaciones:', err.message))
          )
          promises.push(
            api.get(`/api/cierres-pos/${cierreId}/eliminaciones`)
              .then(res => setEliminaciones(res.data || []))
              .catch(err => console.error('Error loading eliminaciones:', err.message))
          )
        }

        await Promise.all(promises)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar cierre')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id, usuario?.rol, location.key])

  const toggleControlarGasto = async (gastoId, controlado) => {
    setControlandoGasto(gastoId)
    try {
      const { data } = await api.put(`/api/gastos-pos/${gastoId}/controlar`, { controlado: !controlado })
      setGastos(prev => prev.map(g => g.id === gastoId ? { ...g, ...data } : g))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al controlar gasto')
    } finally {
      setControlandoGasto(null)
    }
  }

  const cargarMovimientos = async () => {
    setMovimientosCargando(true)
    try {
      const { data } = await api.get(`/api/cierres-pos/${cierre?.id || id}/movimientos`)
      setMovimientos(data)
    } catch (err) {
      console.error('Error al cargar movimientos:', err)
    } finally {
      setMovimientosCargando(false)
    }
  }

  const handleTabChange = (tab) => {
    setTabActiva(tab)
    if (tab === 'movimientos') cargarMovimientos()
  }

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Cierre POS" sinTabs volverA="/cajas-pos" />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Cierre POS" sinTabs volverA="/cajas-pos" />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
          <Link to="/cajas-pos" className="text-sm text-teal-600 mt-4 inline-block">Volver</Link>
        </div>
      </div>
    )
  }

  const estadoCfg = ESTADOS[cierre.estado] || { label: cierre.estado, color: 'bg-gray-100 text-gray-700' }
  const esBlind = false // blind mode removed

  // Collect all unique forma_cobro_ids from cierre and verificacion medios_pago
  const buildMediosPagoMap = (medios) => {
    const map = {}
    if (Array.isArray(medios)) {
      medios.forEach(mp => {
        map[mp.forma_cobro_id] = mp
      })
    }
    return map
  }

  const cierreMediosMap = buildMediosPagoMap(cierre.medios_pago)
  const verifMediosMap = verificacion ? buildMediosPagoMap(verificacion.medios_pago) : {}

  // All unique forma_cobro_ids for comparison, preserving cierre order first
  const allFormaCobroIds = []
  const seenIds = new Set()
  if (Array.isArray(cierre.medios_pago)) {
    cierre.medios_pago.forEach(mp => {
      if (!seenIds.has(mp.forma_cobro_id)) {
        seenIds.add(mp.forma_cobro_id)
        allFormaCobroIds.push(mp.forma_cobro_id)
      }
    })
  }
  if (verificacion && Array.isArray(verificacion.medios_pago)) {
    verificacion.medios_pago.forEach(mp => {
      if (!seenIds.has(mp.forma_cobro_id)) {
        seenIds.add(mp.forma_cobro_id)
        allFormaCobroIds.push(mp.forma_cobro_id)
      }
    })
  }

  // Build POS ventas medios map for comparison
  const posMediosMap = {}
  if (posVentas?.medios_pago) {
    posVentas.medios_pago.forEach(mp => {
      posMediosMap[mp.nombre.toUpperCase()] = mp
    })
  }
  // Normaliza nombre para comparar
  const normalizarMedio = (n) => n.toUpperCase().replace(/[\/\-,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ')
  const mediosSonIguales = (a, b) => {
    const na = a.toUpperCase(), nb = b.toUpperCase()
    if (na.includes(nb) || nb.includes(na)) return true
    return normalizarMedio(a) === normalizarMedio(b)
  }
  const getPosMonto = (nombre) => {
    if (!posVentas) return null
    for (const [key, mp] of Object.entries(posMediosMap)) {
      if (mediosSonIguales(nombre, key)) return mp.total
    }
    return 0
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Cierre POS" sinTabs volverA="/cajas-pos" />

      <div className="px-4 py-4 space-y-4">

        {/* Seccion 1: Encabezado — ancho completo */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">{cierre.numero ? `#${cierre.numero} · ` : ''}{cierre.tipo === 'delivery' ? (cierre.observaciones_apertura || 'Delivery') : 'Sesion POS'}</h2>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoCfg.color}`}>
              {estadoCfg.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
            {cierre.caja && <span>Caja: <strong className="text-gray-700">{cierre.caja.nombre}</strong></span>}
            {cierre.caja?.sucursales?.nombre && <span>Sucursal: <strong className="text-gray-700">{cierre.caja.sucursales.nombre}</strong></span>}
            {cierre.empleado && <span>Abrió: <strong className="text-gray-700">{cierre.empleado.nombre}</strong></span>}
            {cierre.cerrado_por && <span>Cerró: <strong className="text-gray-700">{cierre.cerrado_por.nombre}</strong></span>}
            <span>Fecha: <strong className="text-gray-700">{formatFecha(cierre.fecha)}</strong></span>
            {cierre.apertura_at && <span>Hora apertura: <strong className="text-gray-700">{formatHora(cierre.apertura_at)}</strong></span>}
            {cierre.cierre_at && <span>Fecha cierre: <strong className="text-gray-700">{formatFecha(cierre.cierre_at.split('T')[0])}</strong></span>}
            {cierre.cierre_at && <span>Hora cierre: <strong className="text-gray-700">{formatHora(cierre.cierre_at)}</strong></span>}
            {cierre.fondo_fijo > 0 && cierre.tipo !== 'delivery' && <span>Cambio inicial: <strong className="text-gray-700">{formatMonto(cierre.fondo_fijo)}</strong></span>}
            {cierre.fondo_fijo > 0 && cierre.tipo === 'delivery' && <span className="text-amber-600 font-medium">Cambio entregado: <strong>{formatMonto(cierre.fondo_fijo)}</strong></span>}
            {posVentas && <span className="text-teal-600 font-medium">Ventas POS: {posVentas.cantidad_ventas} venta(s)</span>}
            {guiaDelivery && <span className="text-purple-600 font-medium">Guía: {guiaDelivery.turno} · {guiaDelivery.cantidad_pedidos} pedido(s)</span>}
          </div>
        </div>

        {/* Diferencias de apertura */}
        {/* Si esta abierta, botones cerrar + nuevo retiro */}
        {cierre.estado === 'abierta' && (usuario?.rol === 'operario' || esAdmin) && (
          <div className="flex gap-3">
            <Link
              to={`/cajas-pos/cierre/${cierre.id}/cerrar`}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Cerrar caja
            </Link>
            <Link
              to={`/cajas-pos/cierre/${cierre.id}/retiro`}
              className="flex-1 border border-teal-600 text-teal-700 hover:bg-teal-50 text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Nuevo retiro
            </Link>
          </div>
        )}

        {/* Tabs — solo admin */}
        {esAdmin && (
          <div className="flex border-b border-gray-200 bg-white rounded-t-xl overflow-hidden">
            <button
              onClick={() => handleTabChange('detalle')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tabActiva === 'detalle'
                  ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              Detalle
            </button>
            <button
              onClick={() => handleTabChange('movimientos')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tabActiva === 'movimientos'
                  ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              Movimientos
            </button>
          </div>
        )}


        {/* ─── Tab Movimientos ─── */}
        {tabActiva === 'movimientos' && esAdmin && (
          <div className="space-y-4">
            {movimientosCargando ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
              </div>
            ) : movimientos ? (
              <>
                {/* Resumen */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Resumen de movimientos</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-teal-50 border border-teal-200 rounded-lg p-2.5 text-center">
                      <span className="text-[11px] text-gray-500 block">Fondo fijo</span>
                      <span className="font-bold text-teal-700 text-sm">{formatMonto(movimientos.resumen.fondo_fijo)}</span>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-center">
                      <span className="text-[11px] text-gray-500 block">Ventas (efectivo)</span>
                      <span className="font-bold text-green-700 text-sm">{formatMonto(movimientos.resumen.total_ventas_efectivo)}</span>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-center">
                      <span className="text-[11px] text-gray-500 block">Retiros</span>
                      <span className="font-bold text-red-700 text-sm">-{formatMonto(movimientos.resumen.total_retiros)}</span>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-center">
                      <span className="text-[11px] text-gray-500 block">Gastos</span>
                      <span className="font-bold text-amber-700 text-sm">-{formatMonto(movimientos.resumen.total_gastos)}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">Efectivo neto teórico (Ventas POS)</span>
                    <span className={`text-lg font-bold ${movimientos.resumen.efectivo_neto_teorico >= 0 ? 'text-teal-700' : 'text-red-600'}`}>
                      {formatMonto(movimientos.resumen.efectivo_neto_teorico)}
                    </span>
                  </div>
                </div>

                {/* Timeline de movimientos */}
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Todos los movimientos ({movimientos.movimientos.length})
                    </h3>
                    <span className="text-xs text-gray-400">Orden cronológico</span>
                  </div>
                  {/* Header */}
                  <div className="hidden sm:flex items-center text-[11px] font-medium text-gray-400 uppercase tracking-wider px-4 py-2 border-b border-gray-100 bg-gray-50/50">
                    <span className="w-16">Hora</span>
                    <span className="flex-1 min-w-0">Movimiento</span>
                    <span className="w-24 text-right">Monto</span>
                    <span className="w-28 text-right">Saldo</span>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {movimientos.movimientos.map((mov, idx) => {
                      const TIPO_CONFIG = {
                        apertura: { icon: '🏦', bg: 'bg-teal-50' },
                        venta: { icon: '💰', bg: 'bg-green-50' },
                        retiro: { icon: '📤', bg: 'bg-red-50' },
                        gasto: { icon: '🧾', bg: 'bg-amber-50' },
                        cierre: { icon: '🔒', bg: 'bg-indigo-50' },
                      }
                      const cfg = TIPO_CONFIG[mov.tipo] || TIPO_CONFIG.gasto
                      const esCierre = mov.tipo === 'cierre'

                      if (esCierre) {
                        return (
                          <div key={idx} className="px-4 py-3 bg-indigo-50/60 border-t-2 border-indigo-200">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs flex-shrink-0">🔒</span>
                              <span className="font-semibold text-indigo-800 text-sm">{mov.descripcion}</span>
                              <span className="text-xs text-gray-400 ml-auto">{formatHora(mov.fecha)}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                              <div className="bg-white rounded-lg p-2 border border-indigo-100">
                                <span className="text-[10px] text-gray-500 block">Ventas POS (teórico)</span>
                                <span className="font-bold text-gray-800">{formatMonto(mov.saldo)}</span>
                              </div>
                              <div className="bg-white rounded-lg p-2 border border-indigo-100">
                                <span className="text-[10px] text-gray-500 block">Cajero (neto)</span>
                                <span className="font-bold text-indigo-700">{formatMonto(mov.monto)}</span>
                              </div>
                              <div className={`bg-white rounded-lg p-2 border ${mov.diferencia === 0 ? 'border-green-200' : 'border-red-200'}`}>
                                <span className="text-[10px] text-gray-500 block">Diferencia</span>
                                <span className={`font-bold ${mov.diferencia === 0 ? 'text-green-600' : 'text-red-600'}`}>{formatMonto(mov.diferencia)}</span>
                              </div>
                            </div>
                            {mov.detalle && (
                              <p className="text-xs text-indigo-600 mt-2 text-center">{mov.detalle}</p>
                            )}
                          </div>
                        )
                      }

                      return (
                        <div key={idx} className={`flex items-center px-4 py-2.5 text-sm hover:bg-gray-50/50 ${idx === 0 ? 'bg-teal-50/30' : ''}`}>
                          <span className="w-16 text-xs text-gray-400 flex-shrink-0">
                            {formatHora(mov.fecha)}
                          </span>
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full ${cfg.bg} flex items-center justify-center text-xs flex-shrink-0`}>
                              {cfg.icon}
                            </span>
                            <div className="min-w-0">
                              <span className="text-gray-800 text-sm truncate block">{mov.descripcion}</span>
                              {mov.detalle && (
                                <span className="text-[11px] text-gray-400 truncate block">{mov.detalle}</span>
                              )}
                            </div>
                          </div>
                          <span className={`w-24 text-right font-medium flex-shrink-0 ${
                            mov.signo === '+' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {mov.signo === '-' ? '-' : '+'}{formatMonto(mov.monto)}
                          </span>
                          <span className={`w-28 text-right font-bold flex-shrink-0 ${
                            mov.saldo >= 0 ? 'text-gray-800' : 'text-red-600'
                          }`}>
                            {formatMonto(mov.saldo)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-10 text-sm text-gray-400">No se pudieron cargar los movimientos</div>
            )}
          </div>
        )}

        {/* ─── Tab Detalle (contenido original) ─── */}
        {tabActiva === 'detalle' && (<>

        {/* Seccion 2: Comparativos de cambio — dos tablas lado a lado (no aplica a delivery) */}
        {!esBlind && cierre.estado !== 'abierta' && cierre.tipo !== 'delivery' && (
          cierre.cierre_anterior || cierre.apertura_siguiente ||
          (cierre.fondo_fijo_billetes && Object.keys(cierre.fondo_fijo_billetes).length > 0) ||
          (cierre.cambio_billetes && Object.keys(cierre.cambio_billetes).length > 0)
        ) && (
          <div className="grid grid-cols-2 gap-4">
            {/* Tabla izquierda: Inicio de turno */}
            {(cierre.cierre_anterior || (cierre.fondo_fijo_billetes && Object.keys(cierre.fondo_fijo_billetes).length > 0)) && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Cambio — Inicio de turno</h3>
                {cierre.cierre_anterior ? (
                  <p className="text-xs text-gray-400">Cambio cierre anterior vs apertura</p>
                ) : (
                  <p className="text-xs text-gray-400">Apertura (sin cierre anterior)</p>
                )}

                <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-200">
                  <span className="flex-1">Denominacion</span>
                  {cierre.cierre_anterior && (
                    <span className="w-24 text-right border-r border-gray-100 pr-3">
                      {esAdmin && cierre.cierre_anterior.id ? (
                        <a
                          href={`/cajas-pos/cierre/${cierre.cierre_anterior.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
                        >
                          Cierre ant.
                        </a>
                      ) : (
                        'Cierre ant.'
                      )}
                    </span>
                  )}
                  <span className="w-24 text-right border-r border-gray-100 pr-3">Apertura</span>
                  {cierre.cierre_anterior && (
                    <span className="w-20 text-right">Dif.</span>
                  )}
                </div>

                {(() => {
                  const ffb = cierre.fondo_fijo_billetes || {}
                  const antBilletes = cierre.cierre_anterior?.cambio_billetes || {}
                  const hayAnterior = cierre.cierre_anterior != null

                  const allDenoms = new Set([
                    ...Object.keys(ffb).map(Number),
                    ...Object.keys(antBilletes).map(Number)
                  ])
                  const sortedDenoms = [...allDenoms].sort((a, b) => b - a)

                  let totalAnterior = 0
                  let totalActual = 0

                  const rows = sortedDenoms.map(denom => {
                    const actual = ffb[String(denom)] || 0
                    const anterior = antBilletes[String(denom)] || 0
                    totalAnterior += anterior * denom
                    totalActual += actual * denom
                    const diff = actual - anterior
                    const hayDif = hayAnterior && diff !== 0

                    return (
                      <div key={denom} className={`flex items-center text-sm py-1 ${hayDif ? 'bg-red-50 -mx-2 px-2 rounded' : ''}`}>
                        <span className="flex-1 text-gray-600">${Number(denom).toLocaleString('es-AR')}</span>
                        {hayAnterior && (
                          <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{anterior}</span>
                        )}
                        <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{actual}</span>
                        {hayAnterior && (
                          <span className={`w-20 text-right font-medium ${hayDif ? 'text-red-600' : 'text-gray-400'}`}>
                            {hayDif ? (diff > 0 ? `+${diff}` : diff) : '—'}
                          </span>
                        )}
                      </div>
                    )
                  })

                  return (
                    <>
                      {rows}
                      <div className="flex items-center text-sm py-1.5 border-t border-gray-200 font-bold">
                        <span className="flex-1 text-gray-700">Total</span>
                        {hayAnterior && (
                          <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{formatMonto(totalAnterior)}</span>
                        )}
                        <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{formatMonto(totalActual)}</span>
                        {hayAnterior && (
                          <span className={`w-20 text-right ${totalActual !== totalAnterior ? 'text-red-600' : 'text-gray-400'}`}>
                            {totalActual !== totalAnterior ? formatMonto(totalActual - totalAnterior) : '—'}
                          </span>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Tabla derecha: Fin de turno */}
            {cierre.cambio_billetes && Object.keys(cierre.cambio_billetes).length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Cambio — Fin de turno</h3>
                {cierre.apertura_siguiente ? (
                  <p className="text-xs text-gray-400">Cambio dejado vs apertura siguiente</p>
                ) : (
                  <p className="text-xs text-gray-400">Cambio dejado (sin apertura siguiente)</p>
                )}

                <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-200">
                  <span className="flex-1">Denominacion</span>
                  <span className="w-24 text-right border-r border-gray-100 pr-3">Cambio</span>
                  {cierre.apertura_siguiente ? (
                    <>
                      <span className="w-24 text-right border-r border-gray-100 pr-3">
                        {esAdmin && cierre.apertura_siguiente?.id ? (
                          <a
                            href={`/cajas-pos/cierre/${cierre.apertura_siguiente.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
                          >
                            Apert. sig.
                          </a>
                        ) : (
                          'Apert. sig.'
                        )}
                      </span>
                      <span className="w-20 text-right">Dif.</span>
                    </>
                  ) : (
                    <span className="w-24 text-right text-gray-300">Total</span>
                  )}
                </div>

                {(() => {
                  const cambioBilletes = cierre.cambio_billetes || {}
                  const sigBilletes = cierre.apertura_siguiente?.fondo_fijo_billetes || {}
                  const haySiguiente = cierre.apertura_siguiente != null

                  const allDenoms = new Set([
                    ...Object.keys(cambioBilletes).map(Number),
                    ...(haySiguiente ? Object.keys(sigBilletes).map(Number) : [])
                  ])
                  const sortedDenoms = [...allDenoms].sort((a, b) => b - a)

                  let totalDejado = 0
                  let totalSiguiente = 0

                  const rows = sortedDenoms.map(denom => {
                    const dejado = cambioBilletes[String(denom)] || 0
                    const siguiente = sigBilletes[String(denom)] || 0
                    totalDejado += dejado * denom
                    totalSiguiente += siguiente * denom
                    const diff = siguiente - dejado
                    const hayDif = haySiguiente && diff !== 0

                    return (
                      <div key={denom} className={`flex items-center text-sm py-1 ${hayDif ? 'bg-red-50 -mx-2 px-2 rounded' : ''}`}>
                        <span className="flex-1 text-gray-600">${Number(denom).toLocaleString('es-AR')}</span>
                        <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{dejado}</span>
                        {haySiguiente ? (
                          <>
                            <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{siguiente}</span>
                            <span className={`w-20 text-right font-medium ${hayDif ? 'text-red-600' : 'text-gray-400'}`}>
                              {hayDif ? (diff > 0 ? `+${diff}` : diff) : '—'}
                            </span>
                          </>
                        ) : (
                          <span className="w-24 text-right text-gray-800">{formatMonto(dejado * denom)}</span>
                        )}
                      </div>
                    )
                  })

                  return (
                    <>
                      {rows}
                      <div className="flex items-center text-sm py-1.5 border-t border-gray-200 font-bold">
                        <span className="flex-1 text-gray-700">Total</span>
                        <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{formatMonto(totalDejado)}</span>
                        {haySiguiente ? (
                          <>
                            <span className="w-24 text-right text-gray-800 border-r border-gray-100 pr-3">{formatMonto(totalSiguiente)}</span>
                            <span className={`w-20 text-right ${totalSiguiente !== totalDejado ? 'text-red-600' : 'text-gray-400'}`}>
                              {totalSiguiente !== totalDejado ? formatMonto(totalSiguiente - totalDejado) : '—'}
                            </span>
                          </>
                        ) : (
                          <span className="w-24 text-right text-gray-800">{formatMonto(totalDejado)}</span>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* Seccion 3a: Vista Delivery — reemplaza cuadro comparativo */}
        {cierre.tipo === 'delivery' && cierre.estado !== 'abierta' && (() => {
          if (!guiaDelivery) {
            return (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                <p className="text-sm text-gray-500">No se encontró guía de delivery vinculada a este cierre.</p>
              </div>
            )
          }

          const pedidos = guiaDelivery.guia_delivery_pedidos || []
          const entregados = pedidos.filter(p => p.estado_entrega === 'entregado')
          const noEntregados = pedidos.filter(p => p.estado_entrega === 'no_entregado' || p.estado_entrega === 'rechazado')
          const revertidos = pedidos.filter(p => p.estado_entrega === 'revertido')

          const efectivoCobrado = entregados.filter(p => p.forma_pago === 'efectivo').reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
          const anticipadoEntregado = entregados.filter(p => p.forma_pago === 'anticipado').reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
          const taloPayEntregado = entregados.filter(p => p.forma_pago === 'talo_pay').reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
          const cambioEntregado = parseFloat(guiaDelivery.cambio_entregado) || 0
          const totalADevolver = efectivoCobrado + cambioEntregado

          const guiaCerrada = guiaDelivery.estado === 'cerrada' || guiaDelivery.estado === 'con_diferencia'
          const efectivoRecibido = parseFloat(guiaDelivery.efectivo_recibido) || 0
          const diferencia = parseFloat(guiaDelivery.diferencia) || 0

          const ESTADO_GUIA = {
            despachada: { label: 'Despachada', color: 'bg-purple-100 text-purple-700' },
            cerrada: { label: 'Cerrada', color: 'bg-green-100 text-green-700' },
            con_diferencia: { label: 'Con diferencia', color: 'bg-red-100 text-red-700' },
          }
          const estadoGuia = ESTADO_GUIA[guiaDelivery.estado] || { label: guiaDelivery.estado, color: 'bg-gray-100 text-gray-700' }

          return (
            <>
              {/* Card resumen guía */}
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-purple-800">Guía de Delivery</h3>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoGuia.color}`}>{estadoGuia.label}</span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span>Turno: <strong className="text-purple-700">{guiaDelivery.turno}</strong></span>
                  {guiaDelivery.cadete_nombre && <span>Cadete: <strong className="text-purple-700">{guiaDelivery.cadete_nombre}</strong></span>}
                  <span>Pedidos: <strong className="text-purple-700">{pedidos.length}</strong></span>
                  <span>Entregados: <strong className="text-green-700">{entregados.length}</strong></span>
                  {noEntregados.length > 0 && <span>No entregados: <strong className="text-red-700">{noEntregados.length}</strong></span>}
                </div>
              </div>

              {/* Grid de totales */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-gray-500 block">Efectivo a cobrar</span>
                  <span className="font-bold text-green-700">{formatMonto(efectivoCobrado)}</span>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-gray-500 block">Anticipado</span>
                  <span className="font-bold text-blue-700">{formatMonto(anticipadoEntregado)}</span>
                </div>
                {taloPayEntregado > 0 && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
                    <span className="text-[11px] text-gray-500 block">Talo Pay (no rinde)</span>
                    <span className="font-bold text-indigo-700">{formatMonto(taloPayEntregado)}</span>
                  </div>
                )}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-gray-500 block">Cambio entregado</span>
                  <span className="font-bold text-amber-700">{formatMonto(cambioEntregado)}</span>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-center">
                  <span className="text-[11px] text-gray-500 block">Total a devolver</span>
                  <span className="font-bold text-purple-700">{formatMonto(totalADevolver)}</span>
                </div>
              </div>

              {/* Resultado del cierre */}
              {guiaCerrada && (
                <div className={`border rounded-xl p-4 space-y-2 ${diferencia === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <h3 className="text-sm font-semibold text-gray-700">Resultado del cierre</h3>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-white rounded-lg p-2 border border-gray-100">
                      <span className="text-[10px] text-gray-500 block">Total a devolver</span>
                      <span className="font-bold text-gray-800">{formatMonto(totalADevolver)}</span>
                    </div>
                    <div className="bg-white rounded-lg p-2 border border-gray-100">
                      <span className="text-[10px] text-gray-500 block">Efectivo recibido</span>
                      <span className="font-bold text-purple-700">{formatMonto(efectivoRecibido)}</span>
                    </div>
                    <div className={`bg-white rounded-lg p-2 border ${diferencia === 0 ? 'border-green-200' : 'border-red-200'}`}>
                      <span className="text-[10px] text-gray-500 block">Diferencia</span>
                      <span className={`font-bold ${diferencia === 0 ? 'text-green-600' : 'text-red-600'}`}>{formatMonto(diferencia)}</span>
                    </div>
                  </div>
                  {guiaDelivery.observaciones_cierre && (
                    <p className="text-xs text-gray-500 pt-1 border-t border-gray-100">{guiaDelivery.observaciones_cierre}</p>
                  )}
                </div>
              )}

              {/* Tabla de pedidos */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-700">Pedidos ({pedidos.length})</h3>
                </div>
                <div className="hidden sm:flex items-center text-[11px] font-medium text-gray-400 uppercase tracking-wider px-4 py-2 border-b border-gray-100 bg-gray-50/50">
                  <span className="w-16">#</span>
                  <span className="flex-1 min-w-0">Cliente</span>
                  <span className="w-24 text-center">Pago</span>
                  <span className="w-28 text-center">Estado</span>
                  <span className="w-24 text-right">Monto</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {pedidos.map(gp => {
                    const pedido = gp.pedido || {}
                    const esNoEntregado = gp.estado_entrega === 'no_entregado' || gp.estado_entrega === 'rechazado'
                    const esRevertido = gp.estado_entrega === 'revertido'
                    const bgClass = esNoEntregado ? 'bg-red-50/60' : esRevertido ? 'bg-amber-50/60' : ''

                    const ESTADO_ENTREGA = {
                      pendiente: { label: 'Pendiente', color: 'bg-gray-100 text-gray-600' },
                      entregado: { label: 'Entregado', color: 'bg-green-100 text-green-700' },
                      no_entregado: { label: 'No entregado', color: 'bg-red-100 text-red-700' },
                      rechazado: { label: 'Rechazado', color: 'bg-red-100 text-red-700' },
                      revertido: { label: 'Revertido', color: 'bg-amber-100 text-amber-700' },
                    }
                    const estadoEnt = ESTADO_ENTREGA[gp.estado_entrega] || { label: gp.estado_entrega, color: 'bg-gray-100 text-gray-600' }

                    return (
                      <div key={gp.id}>
                        <div className={`flex items-center px-4 py-2.5 text-sm ${bgClass}`}>
                          <span className="w-16 font-medium text-gray-700">#{pedido.numero || '—'}</span>
                          <span className="flex-1 min-w-0 truncate text-gray-700">{pedido.nombre_cliente || '—'}</span>
                          <span className="w-24 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${gp.forma_pago === 'talo_pay' ? 'bg-indigo-100 text-indigo-700' : gp.forma_pago === 'anticipado' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                              {gp.forma_pago === 'talo_pay' ? 'Talo Pay' : gp.forma_pago === 'anticipado' ? 'Anticipado' : 'Efectivo'}
                            </span>
                          </span>
                          <span className="w-28 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${estadoEnt.color}`}>{estadoEnt.label}</span>
                          </span>
                          <span className="w-24 text-right font-medium text-gray-800">{formatMonto(gp.monto)}</span>
                        </div>
                        {esNoEntregado && gp.motivo_no_entrega && (
                          <div className="px-4 pb-2 -mt-1">
                            <p className="text-xs text-red-600 ml-16">Motivo: {gp.motivo_no_entrega}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {/* Footer con sub-totales */}
                <div className="px-4 py-3 border-t border-gray-200 bg-gray-50/50 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Efectivo cobrado ({entregados.filter(p => p.forma_pago === 'efectivo').length})</span>
                    <span className="font-medium text-green-700">{formatMonto(efectivoCobrado)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Anticipado entregado ({entregados.filter(p => p.forma_pago === 'anticipado').length})</span>
                    <span className="font-medium text-blue-700">{formatMonto(anticipadoEntregado)}</span>
                  </div>
                  {taloPayEntregado > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Talo Pay - no rinde ({entregados.filter(p => p.forma_pago === 'talo_pay').length})</span>
                      <span className="font-medium text-indigo-700">{formatMonto(taloPayEntregado)}</span>
                    </div>
                  )}
                  {noEntregados.length > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-red-600">No entregados ({noEntregados.length})</span>
                      <span className="font-medium text-red-600">{formatMonto(noEntregados.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0))}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )
        })()}

        {/* Seccion 3b: Cuadro comparativo principal — Cajero vs Gestor vs Ventas POS (solo POS normal) */}
        {!esBlind && cierre.estado !== 'abierta' && cierre.tipo !== 'delivery' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Cuadro comparativo</h3>

            <div className="text-xs text-gray-400 space-y-0.5">
              {verificacion && <p>Gestor: {verificacion.gestor?.nombre}</p>}
              {posVentas && <p>Ventas POS: {posVentas.cantidad_ventas} venta(s) — Total: {formatMonto(posVentas.total_general_todas || posVentas.total_general)}</p>}
              {posNoEncontrado && <p>Ventas POS: No encontrado</p>}
            </div>

            {/* Header */}
            <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-200">
              <span className="flex-1">Concepto</span>
              <span className="w-28 text-right border-r border-gray-100 pr-3">Cajero</span>
              <span className="w-28 text-right border-r border-gray-100 pr-3">Gestor</span>
              <span className="w-28 text-right border-r border-gray-100 pr-3">Ventas POS</span>
              <span className="w-28 text-right">Diferencia</span>
            </div>

            {/* Fila expandible genérica para cualquier medio de pago */}
            {(() => {
              const toggleMedio = (key) => esAdmin && posVentas && setExpandedMedio(prev => prev === key ? null : key)

              const renderExpansion = (medioKey, filterFn, labelMedio) => {
                if (expandedMedio !== medioKey || !posVentas) return null
                const ventasFiltradas = (posVentas.detalle_ventas || []).filter(v =>
                  (v.pagos || []).some(filterFn)
                )
                // Incluir anticipos de pedidos cobrados en este cierre que coincidan con el medio
                const matchMedio = (tipo) => (tipo || '').toLowerCase() === labelMedio.toLowerCase()
                const anticipadosEnMedio = (posVentas?.pagos_anticipados?.detalle || []).filter(ped =>
                  (ped.pagos || []).some(p => matchMedio(p.tipo))
                )
                const totalAnticipadosMedio = anticipadosEnMedio.reduce((s, ped) =>
                  s + (ped.pagos || []).filter(p => matchMedio(p.tipo)).reduce((ss, p) => ss + (parseFloat(p.monto) || 0), 0), 0)
                if (ventasFiltradas.length === 0 && anticipadosEnMedio.length === 0) return null
                const totalMedio = ventasFiltradas.reduce((sum, v) => {
                  return sum + (v.pagos || []).filter(filterFn).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
                }, 0) + totalAnticipadosMedio
                return (
                  <div className="bg-gray-50 rounded-lg p-3 -mt-1 mb-1">
                    <div className="flex items-center text-[10px] font-medium text-gray-400 py-1 border-b border-gray-200 mb-1">
                      <span className="w-16">Venta</span>
                      <span className="w-14 text-center">Hora</span>
                      <span className="flex-1 text-right">Total venta</span>
                      <span className="w-24 text-right">{labelMedio}</span>
                      {medioKey === 'Efectivo' && <span className="w-20 text-right">Vuelto</span>}
                      {medioKey === 'Efectivo' && <span className="w-24 text-right font-semibold">Neto</span>}
                    </div>
                    {ventasFiltradas.map(v => {
                      const pagoMedio = (v.pagos || []).filter(filterFn).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
                      const vuelto = parseFloat(v.vuelto) || 0
                      const neto = pagoMedio - vuelto
                      const esNC = v.tipo === 'nota_credito'
                      return (
                        <div key={v.id} className={`flex items-center text-xs py-1 border-b last:border-b-0 ${esNC ? 'bg-red-50 rounded px-1 -mx-1 border-red-100' : 'border-gray-100'}`}>
                          <span className="w-16 flex items-center gap-1">
                            <a href={`/ventas/${v.id}`} target="_blank" rel="noopener noreferrer" className={`font-medium hover:underline ${esNC ? 'text-red-600' : 'text-blue-600'}`}>#{v.numero_venta || '—'}</a>
                            {esNC && <span className="text-[8px] font-bold text-red-600 bg-red-200 px-0.5 rounded">NC</span>}
                            {v.canal === 'delivery' && <span className="text-[8px] font-bold text-orange-700 bg-orange-100 px-0.5 rounded">DLV</span>}
                          </span>
                          <span className="w-14 text-center text-gray-400 whitespace-nowrap">{new Date(v.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                          <span className={`flex-1 text-right ${esNC ? 'text-red-500' : 'text-gray-500'}`}>{formatMonto(v.total)}</span>
                          <span className={`w-24 text-right ${esNC ? 'text-red-600 font-medium' : 'text-gray-700'}`}>{formatMonto(pagoMedio)}</span>
                          {medioKey === 'Efectivo' && <span className="w-20 text-right text-red-500">{vuelto > 0 ? `-${formatMonto(vuelto)}` : '—'}</span>}
                          {medioKey === 'Efectivo' && <span className={`w-24 text-right font-medium ${esNC ? 'text-red-700' : 'text-teal-700'}`}>{formatMonto(neto)}</span>}
                        </div>
                      )
                    })}
                    {/* Anticipos de pedidos cobrados en este cierre */}
                    {anticipadosEnMedio.map(ped => {
                      const montoMedio = (ped.pagos || []).filter(p => matchMedio(p.tipo)).reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
                      return (
                        <div key={`ant-${ped.id}`} className="flex items-center text-xs py-1 border-b last:border-b-0 border-emerald-100 bg-emerald-50 rounded px-1 -mx-1">
                          <span className="w-16 flex items-center gap-1">
                            <span className="text-[8px] font-bold text-emerald-700 bg-emerald-200 px-1 rounded">ANT</span>
                          </span>
                          <span className="w-14 text-center text-gray-400 whitespace-nowrap">{ped.cobrado_at ? new Date(ped.cobrado_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span>
                          <span className="flex-1 text-right text-emerald-700 text-[11px]">Pedido #{ped.numero} — {ped.nombre_cliente}</span>
                          <span className="w-24 text-right text-emerald-700 font-medium">{formatMonto(montoMedio)}</span>
                          {medioKey === 'Efectivo' && <span className="w-20 text-right text-gray-400">—</span>}
                          {medioKey === 'Efectivo' && <span className="w-24 text-right font-medium text-emerald-700">{formatMonto(montoMedio)}</span>}
                        </div>
                      )
                    })}
                    {(() => {
                      const ventasNorm = ventasFiltradas.filter(v => v.tipo !== 'nota_credito')
                      const ventasNC = ventasFiltradas.filter(v => v.tipo === 'nota_credito')
                      const anticipadosEnFooter = anticipadosEnMedio
                      return (
                        <div className="flex items-center text-xs font-bold pt-2 border-t border-gray-200 mt-1">
                          <span className="flex-1 text-gray-700">
                            {ventasNorm.length} venta(s){ventasNC.length > 0 && <span className="text-red-600"> · {ventasNC.length} anulación(es)</span>}{anticipadosEnFooter.length > 0 && <span className="text-emerald-600"> · {anticipadosEnFooter.length} anticipo(s)</span>}
                          </span>
                          <span className="w-24 text-right text-teal-700">{formatMonto(totalMedio)}</span>
                        </div>
                      )
                    })()}
                  </div>
                )
              }

              const medioLabel = (nombre, key) => esAdmin && posVentas ? (expandedMedio === key ? `${nombre} ▲` : `${nombre} ▼`) : nombre

              return (
                <>
                  {/* Efectivo */}
                  <div className="cursor-pointer hover:bg-gray-50 rounded transition-colors" onClick={() => toggleMedio('Efectivo')}>
                    <FilaComparativa
                      label={medioLabel('Efectivo', 'Efectivo')}
                      valorCajero={(parseFloat(cierre.total_efectivo) || 0) + retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0)}
                      valorGestor={verificacion ? (parseFloat(verificacion.total_efectivo) || 0) + retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0) : null}
                      valorPos={posVentas ? posVentas.total_efectivo : null}
                    />
                  </div>
                  {renderExpansion('Efectivo', p => (p.tipo || 'Efectivo') === 'Efectivo', 'Efectivo')}

                  {/* Medios de pago dinámicos */}
                  {allFormaCobroIds.map(fcId => {
                    const cierreMp = cierreMediosMap[fcId]
                    const verifMp = verifMediosMap[fcId]
                    const nombre = cierreMp?.nombre || verifMp?.nombre || 'Medio de pago'
                    return (
                      <React.Fragment key={fcId}>
                        <div className="cursor-pointer hover:bg-gray-50 rounded transition-colors" onClick={() => toggleMedio(`fc-${fcId}`)}>
                          <FilaComparativa
                            label={medioLabel(nombre, `fc-${fcId}`)}
                            valorCajero={parseFloat(cierreMp?.monto) || 0}
                            valorGestor={verificacion ? (parseFloat(verifMp?.monto) || 0) : null}
                            valorPos={getPosMonto(nombre)}
                          />
                        </div>
                        {renderExpansion(`fc-${fcId}`, p => mediosSonIguales(p.tipo, nombre), nombre)}
                      </React.Fragment>
                    )
                  })}

                  {/* Medios que solo existen en Ventas POS */}
                  {posVentas && posVentas.medios_pago.filter(pmp => {
                    const upper = pmp.nombre.toUpperCase()
                    return !allFormaCobroIds.some(fcId => {
                      const nombre = cierreMediosMap[fcId]?.nombre || verifMediosMap[fcId]?.nombre || ''
                      return mediosSonIguales(nombre, pmp.nombre)
                    }) && upper !== 'EFECTIVO' && upper !== 'CUENTA_CORRIENTE' && upper !== 'POSNET MP' && upper !== 'QR MP'
                  }).map((pmp, idx) => (
                    <React.Fragment key={`pos-${pmp.nombre}-${idx}`}>
                      <div className="cursor-pointer hover:bg-gray-50 rounded transition-colors" onClick={() => toggleMedio(`pos-${pmp.nombre}`)}>
                        <FilaComparativa
                          label={medioLabel(pmp.nombre, `pos-${pmp.nombre}`)}
                          valorCajero={0}
                          valorGestor={verificacion ? 0 : null}
                          valorPos={pmp.total}
                        />
                      </div>
                      {renderExpansion(`pos-${pmp.nombre}`, p => mediosSonIguales(p.tipo, pmp.nombre), pmp.nombre)}
                    </React.Fragment>
                  ))}
                </>
              )
            })()}

            {/* Total general — ajustado con cambio y gastos */}
            {(() => {
              const ajuste = retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0)
              const totalCajero = (parseFloat(cierre.total_general) || 0) + ajuste
              const totalGestor = verificacion ? (parseFloat(verificacion.total_general) || 0) + ajuste : null
              const totalPos = posVentas ? posVentas.total_general : null
              const base = totalGestor != null ? totalGestor : totalCajero
              const diffTotal = totalPos != null ? base - totalPos : null

              return (
                <div className="border-t border-gray-200 pt-2">
                  <div className="flex items-center text-sm py-1.5 font-bold">
                    <span className="flex-1 text-gray-800">TOTAL GENERAL</span>
                    <span className="w-28 text-right text-gray-800 flex-shrink-0 border-r border-gray-100 pr-3">{formatMonto(totalCajero)}</span>
                    <span className={`w-28 text-right flex-shrink-0 border-r border-gray-100 pr-3 ${
                      totalGestor == null ? 'text-gray-400' :
                      totalCajero !== totalGestor ? 'text-red-600' : 'text-gray-800'
                    }`}>{totalGestor != null ? formatMonto(totalGestor) : '—'}</span>
                    <span className={`w-28 text-right flex-shrink-0 border-r border-gray-100 pr-3 ${
                      totalPos == null ? 'text-gray-400' :
                      base !== totalPos ? 'text-red-600' : 'text-teal-700'
                    }`}>{totalPos != null ? formatMonto(totalPos) : '—'}</span>
                    <span className={`w-28 text-right flex-shrink-0 font-bold ${
                      diffTotal == null ? 'text-gray-400' :
                      diffTotal === 0 ? 'text-green-600' : 'text-red-600'
                    }`}>{diffTotal != null ? formatMonto(diffTotal) : '—'}</span>
                  </div>
                </div>
              )
            })()}

          </div>
        )}

        {/* Seccion Ventas Delivery */}
        {!esBlind && cierre.estado !== 'abierta' && cierre.tipo !== 'delivery' && posVentas && (() => {
          const ventasDelivery = (posVentas.detalle_ventas || []).filter(v => v.canal === 'delivery')
          if (ventasDelivery.length === 0) return null
          const totalDelivery = ventasDelivery.reduce((s, v) => s + (parseFloat(v.total) || 0), 0)
          return (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
                Ventas Delivery — {ventasDelivery.length} venta(s) — Total: {formatMonto(totalDelivery)}
              </h3>
              <div className="bg-white rounded-lg border border-orange-100 overflow-hidden">
                <div className="flex items-center text-[10px] font-medium text-gray-400 py-1.5 px-3 border-b border-orange-100">
                  <span className="w-16">Venta</span>
                  <span className="w-14 text-center">Hora</span>
                  <span className="w-28">ID Plataforma</span>
                  <span className="flex-1">Forma de cobro</span>
                  <span className="w-24 text-right">Total</span>
                </div>
                {ventasDelivery.map(v => {
                  const formaCobro = (v.pagos || []).map(p => p.tipo || 'Efectivo').join(', ')
                  return (
                    <div key={v.id} className="flex items-center text-xs py-1.5 px-3 border-b last:border-b-0 border-orange-50 hover:bg-orange-50/50">
                      <span className="w-16">
                        <a href={`/ventas/${v.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">#{v.numero_venta || '—'}</a>
                      </span>
                      <span className="w-14 text-center text-gray-400">{new Date(v.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                      <span className="w-28 font-mono text-orange-700 font-medium">{v.id_pedido_plataforma || '—'}</span>
                      <span className="flex-1 text-gray-600">{formaCobro}</span>
                      <span className="w-24 text-right font-medium text-gray-800">{formatMonto(v.total)}</span>
                    </div>
                  )
                })}
                <div className="flex items-center text-xs font-bold py-2 px-3 border-t border-orange-200 bg-orange-50">
                  <span className="flex-1 text-orange-800">{ventasDelivery.length} venta(s) delivery</span>
                  <span className="w-24 text-right text-orange-800">{formatMonto(totalDelivery)}</span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Alertas de pagos posnet con problema */}
        {posVentas && (() => {
          const pagosConProblema = []
          ;(posVentas.detalle_ventas || []).forEach(v => {
            ;(v.pagos || []).forEach(p => {
              if (p.detalle?.mp_problema) {
                pagosConProblema.push({
                  venta_id: v.id,
                  fecha: v.created_at,
                  monto: p.monto,
                  tipo_problema: p.detalle.mp_problema,
                  descripcion: p.detalle.mp_problema_desc,
                })
              }
            })
          })
          if (pagosConProblema.length === 0) return null

          return (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                Pagos posnet con problema ({pagosConProblema.length})
              </h3>
              <div className="space-y-2">
                {pagosConProblema.map((pp, idx) => (
                  <div key={idx} className="border border-amber-200 rounded-lg p-3 bg-white/60">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-900">
                        {pp.tipo_problema === 'cobro_sin_confirmar'
                          ? 'Cobro realizado sin confirmacion del sistema'
                          : 'Cobrado en posnet manual'}
                      </span>
                      <span className="text-sm font-bold text-amber-800">{formatMonto(pp.monto)}</span>
                    </div>
                    <div className="text-xs text-amber-700/70 mt-1">
                      {pp.fecha && new Date(pp.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      {pp.descripcion && <span className="ml-2">— {pp.descripcion}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Aviso POS ventas no encontrado */}
        {!esBlind && posNoEncontrado && cierre.estado !== 'abierta' && !posVentas && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500">No se encontraron datos de ventas POS para esta sesion.</p>
          </div>
        )}

        {/* Retiros durante el turno */}
        {retiros.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Retiros durante el turno ({retiros.length})
            </h3>
            <div className="space-y-2">
              {retiros.map(r => {
                const formatRetiroFecha = (iso) => {
                  if (!iso) return ''
                  const d = new Date(iso)
                  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                }

                return (
                  <div key={r.id} className="border border-gray-100 rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">#{r.numero}</span>
                        {!r._blind && (
                          <span className="text-sm font-bold text-teal-700">{formatMonto(r.total)}</span>
                        )}
                        {r._blind && (
                          <span className="text-xs text-yellow-600 italic">Montos ocultos</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {r.verificado ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Verificado</span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
                        )}
                        {!r.verificado && (esGestor || esAdmin) && !r._blind && cierre.estado === 'pendiente_gestor' && (
                          <Link
                            to={`/cajas-pos/retiro/${r.id}/verificar`}
                            className="text-xs text-teal-600 hover:text-teal-800 font-medium"
                          >
                            Verificar
                          </Link>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {r.empleado?.nombre && <span>Empleado: {r.empleado.nombre}</span>}
                      {r.created_at && <span className="ml-2">{formatRetiroFecha(r.created_at)}</span>}
                    </div>
                    {/* Comparacion inline si verificado y no blind */}
                    {r.verificado && !r._blind && r.verificacion_total != null && (
                      <div className="text-xs pt-1 border-t border-gray-50">
                        <span className="text-gray-500">Cajero: {formatMonto(r.total)}</span>
                        <span className={`ml-3 ${parseFloat(r.total) !== parseFloat(r.verificacion_total) ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                          Gestor: {formatMonto(r.verificacion_total)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Total retiros */}
            {!retiros.some(r => r._blind) && (
              <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-medium">
                <span className="text-gray-600">Total retiros</span>
                <span className="text-teal-700">{formatMonto(retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0))}</span>
              </div>
            )}
          </div>
        )}

        {/* Notas de Crédito / Problemas */}
        {posVentas?.notas_credito?.cantidad > 0 && (() => {
          const nc = posVentas.notas_credito
          return (
            <div className="bg-white border border-red-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  </svg>
                  Problemas / Notas de Crédito
                  <span className="text-xs font-normal text-red-600 bg-red-50 px-2 py-0.5 rounded">{nc.cantidad}</span>
                </h3>
                <span className="text-sm font-bold text-red-700">{formatMonto(nc.total)}</span>
              </div>

              <div className="space-y-2">
                {nc.detalle.map((item, idx) => {
                  const pagos = item.pagos || []
                  const formasPago = pagos.map(p => `${p.tipo} ${formatMonto(p.monto)}`).join(', ')
                  return (
                    <div key={idx} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <a href={`/ventas/${item.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-red-700 hover:underline">
                            NC #{item.numero_venta}
                          </a>
                          {item.venta_origen_numero && (
                            <span className="text-[10px] text-gray-500">
                              anula <a href={`/ventas/${item.venta_origen_id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">#{item.venta_origen_numero}</a>
                            </span>
                          )}
                          {item.centum_comprobante && (
                            <span className="text-[10px] text-violet-500 font-medium">{item.centum_comprobante}</span>
                          )}
                        </div>
                        <span className="text-sm font-bold text-red-700">{formatMonto(item.total)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{item.nombre_cliente || 'Consumidor Final'}</span>
                        <span>{new Date(item.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {item.motivo && (
                        <div className="text-xs text-red-600 mt-1 italic">Motivo: {item.motivo}</div>
                      )}
                      {pagos.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {pagos.map((p, pidx) => (
                            <span key={pidx} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                              {p.tipo} {formatMonto(p.monto)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Cupones Mercado Pago */}
        {esAdmin && posVentas?.cupones_mp?.cantidad > 0 && (() => {
          const mp = posVentas.cupones_mp
          const problemas = mp.detalle.filter(c => c.mp_problema)
          return (
            <div className="bg-white border border-blue-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-3">
                  Cupones Mercado Pago
                  {mp.posnet > 0 && (
                    <span className="text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      Posnet: {mp.posnet}
                    </span>
                  )}
                  {mp.qr > 0 && (
                    <span className="text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      QR: {mp.qr}
                    </span>
                  )}
                  {mp.anulaciones > 0 && (
                    <span className="text-xs font-normal text-red-700 bg-red-50 px-2 py-0.5 rounded">
                      Anulaciones: {mp.anulaciones}
                    </span>
                  )}
                  {mp.problemas > 0 && (
                    <span className="text-xs font-normal text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                      Problema: {mp.problemas}
                    </span>
                  )}
                </h3>
                <span className="text-sm font-bold text-blue-700">{formatMonto(mp.total)}</span>
              </div>

              <button
                onClick={() => setCuponesExpanded(!cuponesExpanded)}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium"
              >
                {cuponesExpanded ? 'Ocultar detalle' : 'Ver detalle'}
              </button>

              {cuponesExpanded && (
                <div className="space-y-1">
                  <div className="flex items-center text-[10px] font-medium text-gray-400 py-1 border-b border-blue-100">
                    <span className="flex-1">Venta</span>
                    <span className="w-20 text-center">Tipo</span>
                    <span className="w-24 text-center">Tarjeta</span>
                    <span className="w-36 text-center">ID Pago MP</span>
                    <span className="w-16 text-center">Hora</span>
                    <span className="w-24 text-right">Importe</span>
                  </div>
                  {mp.detalle.map((c, idx) => (
                    <div key={idx} className={`flex items-center text-xs py-1.5 ${c.es_anulacion ? 'bg-red-50 rounded px-1 -mx-1' : c.mp_problema ? 'bg-amber-50 rounded px-1 -mx-1' : 'border-b border-blue-50'}`}>
                      <span className="flex-1 flex items-center gap-1.5">
                        {c.numero_venta && c.venta_id ? <a href={`/ventas/${c.venta_id}`} target="_blank" rel="noopener noreferrer" className={`font-medium hover:underline ${c.es_anulacion ? 'text-red-600' : 'text-blue-600'}`}>#{c.numero_venta}</a> : c.numero_venta ? `#${c.numero_venta}` : '—'}
                        {c.es_anulacion && <span className="text-[9px] font-bold text-red-600 bg-red-200 px-1 py-0.5 rounded">ANULACIÓN</span>}
                      </span>
                      <span className="w-20 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c.es_anulacion ? 'bg-red-100 text-red-700' : c.tipo.toLowerCase() === 'qr mp' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {c.tipo.toLowerCase() === 'qr mp' ? 'QR' : 'Posnet'}
                        </span>
                      </span>
                      <span className="w-24 text-center text-gray-500 text-[10px]">
                        {c.card_brand && c.card_last_four ? `${c.card_brand} ···${c.card_last_four}` : c.payment_type === 'account_money' ? 'QR Wallet' : '—'}
                      </span>
                      <span className="w-36 text-center text-gray-500 text-[10px] font-mono truncate" title={c.mp_payment_id || c.mp_order_id || ''}>
                        {c.mp_payment_id || c.mp_order_id || '—'}
                      </span>
                      <span className="w-16 text-center text-gray-400">
                        {new Date(c.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={`w-24 text-right font-medium ${c.es_anulacion ? 'text-red-600' : 'text-gray-700'}`}>{formatMonto(c.monto)}</span>
                    </div>
                  ))}

                  {/* Detalle de problemas */}
                  {problemas.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] font-medium text-amber-700 uppercase">Problemas detectados</p>
                      {problemas.map((c, idx) => (
                        <div key={idx} className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-amber-800">
                              Venta #{c.numero_venta || '—'} · {formatMonto(c.monto)}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 font-medium">
                              {c.mp_problema === 'cobro_sin_confirmar' ? 'Cobro sin confirmar' : c.mp_problema === 'posnet_manual' ? 'Posnet manual' : c.mp_problema}
                            </span>
                          </div>
                          {c.mp_problema_desc && (
                            <p className="text-amber-700 mt-1">{c.mp_problema_desc}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {/* Retiros mercadería empleados */}
        {esAdmin && posVentas?.retiro_empleados?.cantidad > 0 && (
          <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-orange-800">
              Retiros mercadería empleados ({posVentas.retiro_empleados.cantidad})
            </h3>
            <div className="space-y-2">
              {posVentas.retiro_empleados.detalle.map(re => {
                const expandido = retiroEmpleadoExpandido === re.id
                return (
                  <div key={re.id} className="border border-orange-100 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setRetiroEmpleadoExpandido(expandido ? null : re.id)}
                      className="w-full flex items-center justify-between p-3 hover:bg-orange-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-800">{re.empleado_nombre}</span>
                        <span className="text-xs text-gray-400">
                          {re.numero_venta ? `Venta #${re.numero_venta}` : ''} · {new Date(re.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-orange-700">{formatMonto(re.total)}</span>
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandido ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>
                    {expandido && re.items?.length > 0 && (() => {
                      return (
                        <div className="border-t border-orange-100 p-3 bg-orange-50/50">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-500 border-b border-orange-100">
                                <th className="text-left py-1 font-medium">Artículo</th>
                                <th className="text-right py-1 font-medium w-16">Cant.</th>
                                <th className="text-right py-1 font-medium w-24">Precio</th>
                                <th className="text-right py-1 font-medium w-24">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {re.items.map((item, idx) => {
                                const precioFinal = parseFloat(item.precio_final || item.precio_unitario || 0)
                                const precioOriginal = parseFloat(item.precio_original || precioFinal)
                                const cantidad = parseFloat(item.cantidad || 1)
                                const descPct = item.descuento_pct || (precioOriginal > precioFinal ? Math.round((1 - precioFinal / precioOriginal) * 100) : 0)
                                return (
                                  <tr key={idx} className="border-b border-orange-50">
                                    <td className="py-1.5 text-gray-700">
                                      <div>
                                        <span className="font-medium">{item.nombre}</span>
                                        {item.codigo && <span className="text-gray-400 ml-1">({item.codigo})</span>}
                                      </div>
                                      {descPct > 0 && (
                                        <div className="text-orange-600 text-[10px]">
                                          Desc. empleado -{descPct}% (orig. {formatMonto(precioOriginal)})
                                        </div>
                                      )}
                                    </td>
                                    <td className="text-right text-gray-600">{cantidad}</td>
                                    <td className="text-right text-gray-700 font-medium">{formatMonto(precioFinal)}</td>
                                    <td className="text-right text-gray-700 font-medium">{formatMonto(precioFinal * cantidad)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
            <div className="border-t border-orange-200 pt-2 flex justify-between text-sm font-medium">
              <span className="text-orange-800">Total retiros empleados</span>
              <span className="text-orange-700">{formatMonto(posVentas.retiro_empleados.total)}</span>
            </div>
          </div>
        )}

        {/* Talo Pay — conciliación automática, no impacta en caja */}
        {posVentas?.talo_pay?.cantidad > 0 && (
          <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-indigo-800">
              Talo Pay - conciliación automática ({posVentas.talo_pay.cantidad})
            </h3>
            <p className="text-xs text-gray-500">Estos cobros no impactan en la caja. Se concilian de forma independiente.</p>
            <div className="space-y-1">
              {posVentas.talo_pay.detalle.map(v => (
                <div key={v.id} className="flex items-center justify-between px-3 py-2 bg-indigo-50/50 rounded-lg text-sm">
                  <span className="text-gray-700">{v.nombre_cliente || 'Sin cliente'}</span>
                  <span className="font-medium text-indigo-700">{formatMonto(v.total)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-indigo-200 pt-2 flex justify-between text-sm font-medium">
              <span className="text-indigo-800">Total Talo Pay</span>
              <span className="text-indigo-700">{formatMonto(posVentas.talo_pay.total)}</span>
            </div>
          </div>
        )}

        {/* Pagos anticipados de pedidos — impactan en caja */}
        {posVentas?.pagos_anticipados?.cantidad > 0 && (
          <div className="bg-white border border-emerald-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-emerald-800">
              Pagos anticipados de pedidos ({posVentas.pagos_anticipados.cantidad})
            </h3>
            <p className="text-xs text-gray-500">Cobros de pedidos recibidos durante este turno. Incluidos en el total de caja.</p>
            <div className="space-y-1">
              {posVentas.pagos_anticipados.detalle.map(ped => (
                <div key={ped.id} className="flex items-center justify-between px-3 py-2 bg-emerald-50/50 rounded-lg text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-emerald-600">#{ped.numero}</span>
                    <span className="text-gray-700">{ped.nombre_cliente || 'Sin cliente'}</span>
                    {ped.pagos?.map((p, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{p.tipo || 'Efectivo'}</span>
                    ))}
                  </div>
                  <span className="font-medium text-emerald-700">{formatMonto(ped.total_pagado)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-emerald-200 pt-2 flex justify-between text-sm font-medium">
              <span className="text-emerald-800">Total pagos anticipados</span>
              <span className="text-emerald-700">{formatMonto(posVentas.pagos_anticipados.total)}</span>
            </div>
          </div>
        )}

        {/* Gastos durante el turno */}
        {gastos.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Gastos durante el turno ({gastos.length})
            </h3>
            <div className="space-y-2">
              {gastos.map(g => {
                const formatGastoFecha = (iso) => {
                  if (!iso) return ''
                  const d = new Date(iso)
                  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                }

                return (
                  <div key={g.id} className="border border-gray-100 rounded-lg p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Checkbox de control para gestor/admin */}
                        {(esGestor || esAdmin) && cierre.estado !== 'abierta' && (
                          <button
                            onClick={() => toggleControlarGasto(g.id, g.controlado)}
                            disabled={controlandoGasto === g.id}
                            className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              g.controlado
                                ? 'bg-green-500 border-green-500 text-white'
                                : 'border-gray-300 hover:border-orange-400'
                            } ${controlandoGasto === g.id ? 'opacity-50' : ''}`}
                          >
                            {g.controlado && (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        )}
                        <span className="text-sm font-medium text-gray-800 truncate">{g.descripcion}</span>
                      </div>
                      <span className="text-sm font-bold text-orange-700 flex-shrink-0 ml-2">{formatMonto(g.importe)}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {g.created_at && <span>{formatGastoFecha(g.created_at)}</span>}
                      {g.controlado && g.controlado_por_perfil && (
                        <span className="ml-2 text-green-600">Controlado por {g.controlado_por_perfil.nombre}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Total gastos */}
            <div className="border-t border-gray-100 pt-2 flex justify-between text-sm font-medium">
              <span className="text-gray-600">Total gastos</span>
              <span className="text-orange-700">{formatMonto(gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0))}</span>
            </div>
            {/* Alerta si hay gastos sin controlar */}
            {(esGestor || esAdmin) && cierre.estado !== 'abierta' && gastos.some(g => !g.controlado) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 text-xs text-orange-700 font-medium">
                Hay {gastos.filter(g => !g.controlado).length} gasto(s) sin controlar
              </div>
            )}
          </div>
        )}

        {/* Cambios de precio durante el turno (solo admin) */}
        {esAdmin && cambiosPrecio.length > 0 && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Cambios de precio ({cambiosPrecio.length})
            </h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-white border border-violet-200 rounded-lg p-2">
                <span className="text-xs text-gray-500 block">Total cambios</span>
                <span className="font-bold text-violet-700">{cambiosPrecio.length}</span>
              </div>
              <div className="bg-white border border-violet-200 rounded-lg p-2">
                <span className="text-xs text-gray-500 block">Importe diferencia</span>
                <span className={`font-bold ${cambiosPrecio.reduce((s, c) => s + parseFloat(c.diferencia || 0) * parseFloat(c.cantidad || 1), 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatMonto(cambiosPrecio.reduce((s, c) => s + parseFloat(c.diferencia || 0) * parseFloat(c.cantidad || 1), 0))}
                </span>
              </div>
              <div className="bg-white border border-violet-200 rounded-lg p-2">
                <span className="text-xs text-gray-500 block">Artículos afectados</span>
                <span className="font-bold text-violet-700">{new Set(cambiosPrecio.map(c => c.articulo_id)).size}</span>
              </div>
            </div>
            <div className="space-y-2">
              {cambiosPrecio.map((cp, idx) => (
                <div key={idx} className="border border-violet-100 rounded-lg p-3 bg-white/60">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-800 block truncate">
                        {cp.articulo_nombre} {cp.articulo_codigo ? `(${cp.articulo_codigo})` : ''}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatMonto(cp.precio_original)} → {formatMonto(cp.precio_nuevo)}
                        {parseFloat(cp.cantidad) !== 1 && ` × ${cp.cantidad}`}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <span className={`text-sm font-bold ${parseFloat(cp.diferencia) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {parseFloat(cp.diferencia) > 0 ? '+' : ''}{formatMonto(parseFloat(cp.diferencia) * parseFloat(cp.cantidad || 1))}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{cp.motivo}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(cp.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tickets cancelados, reversiones delivery y cobros cancelados (solo admin) */}
        {esAdmin && cancelaciones.length > 0 && (() => {
          const cobrosCancelados = cancelaciones.filter(c => c.motivo === 'Cobro cancelado')
          const reversiones = cancelaciones.filter(c => c.motivo?.startsWith('Reversión pedido'))
          const ticketsCancelados = cancelaciones.filter(c => c.motivo !== 'Cobro cancelado' && !c.motivo?.startsWith('Reversión pedido'))
          const totalCobros = cobrosCancelados.reduce((s, c) => s + parseFloat(c.total || 0), 0)
          const totalTickets = ticketsCancelados.reduce((s, c) => s + parseFloat(c.total || 0), 0)
          const totalReversiones = reversiones.reduce((s, c) => s + parseFloat(c.total || 0), 0)

          const renderCancelacion = (canc, colorScheme = 'red') => (
            <div key={canc.id} className={`border ${colorScheme === 'amber' ? 'border-amber-100' : 'border-red-100'} rounded-lg p-2.5 bg-white/60`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-gray-700 truncate">{canc.cajero_nombre}</span>
                  {canc.cliente_nombre && <span className="text-[10px] text-gray-400 truncate">· {canc.cliente_nombre}</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs font-bold ${colorScheme === 'amber' ? 'text-amber-700' : 'text-red-700'}`}>{formatMonto(canc.total)}</span>
                  <span className="text-xs text-gray-400">{formatHora(canc.created_at)}</span>
                </div>
              </div>
              {canc.motivo && (
                <p className={`text-xs ${colorScheme === 'amber' ? 'text-amber-600' : 'text-red-600'} mb-1`}>{canc.motivo}</p>
              )}
              {Array.isArray(canc.items) && canc.items.length > 0 && (
                <div className="space-y-0.5">
                  {canc.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                      <span className="truncate flex-1 min-w-0 text-gray-600">
                        {item.nombre || item.articulo_nombre || 'Artículo'}
                        {parseFloat(item.cantidad || 1) !== 1 && ` × ${item.cantidad}`}
                      </span>
                      <span className="flex-shrink-0 ml-2 text-gray-700">
                        {formatMonto(parseFloat(item.precio || item.precio_unitario || 0) * parseFloat(item.cantidad || 1))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )

          return (
            <>
              {/* Pedidos revertidos (delivery) */}
              {reversiones.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    Pedidos revertidos ({reversiones.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-white border border-amber-200 rounded-lg p-2">
                      <span className="text-xs text-gray-500 block">Pedidos revertidos</span>
                      <span className="font-bold text-amber-700">{reversiones.length}</span>
                    </div>
                    <div className="bg-white border border-amber-200 rounded-lg p-2">
                      <span className="text-xs text-gray-500 block">Monto revertido</span>
                      <span className="font-bold text-amber-600">{formatMonto(totalReversiones)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {reversiones.map(c => renderCancelacion(c, 'amber'))}
                  </div>
                </div>
              )}

              {/* Tickets cancelados (F9) */}
              {ticketsCancelados.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-red-800 flex items-center gap-2">
                    <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    Tickets cancelados ({ticketsCancelados.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-white border border-red-200 rounded-lg p-2">
                      <span className="text-xs text-gray-500 block">Total tickets</span>
                      <span className="font-bold text-red-700">{ticketsCancelados.length}</span>
                    </div>
                    <div className="bg-white border border-red-200 rounded-lg p-2">
                      <span className="text-xs text-gray-500 block">Pérdida teórica</span>
                      <span className="font-bold text-red-600">{formatMonto(totalTickets)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {ticketsCancelados.map(c => renderCancelacion(c))}
                  </div>
                </div>
              )}
            </>
          )
        })()}

        {/* Artículos eliminados de tickets (solo admin) */}
        {esAdmin && eliminaciones.length > 0 && (() => {
          // Flatten all items with metadata
          const allItems = eliminaciones.flatMap(e =>
            (Array.isArray(e.items) ? e.items : []).map(item => ({
              ...item,
              usuario: e.usuario_nombre,
              fecha: e.fecha || e.created_at,
              elimId: e.id,
              venta_pos_id: e.venta_pos_id || null,
              numero_venta: e.numero_venta || null,
              ticket_uid: e.ticket_uid || null,
            }))
          )
          const totalImporte = allItems.reduce((s, i) => s + parseFloat(i.precio || i.precio_unitario || 0) * parseFloat(i.cantidad || 1), 0)

          // Group by ticket_uid (if available) or by user + time proximity (2 min)
          const grupos = []
          const sorted = [...allItems].sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
          for (const item of sorted) {
            const t = new Date(item.fecha).getTime()
            const last = grupos[grupos.length - 1]
            const mismoTicket = item.ticket_uid && last?.ticket_uid && item.ticket_uid === last.ticket_uid
            const mismoGrupoLegacy = !item.ticket_uid && last && last.usuario === item.usuario && t - last.lastTime < 120000
            if (mismoTicket || mismoGrupoLegacy) {
              last.items.push(item)
              last.lastTime = t
              last.total += parseFloat(item.precio || item.precio_unitario || 0) * parseFloat(item.cantidad || 1)
              if (item.venta_pos_id) { last.venta_pos_id = item.venta_pos_id; last.numero_venta = item.numero_venta }
            } else {
              grupos.push({
                usuario: item.usuario,
                firstTime: t,
                lastTime: t,
                items: [item],
                total: parseFloat(item.precio || item.precio_unitario || 0) * parseFloat(item.cantidad || 1),
                venta_pos_id: item.venta_pos_id,
                numero_venta: item.numero_venta,
                ticket_uid: item.ticket_uid,
              })
            }
          }

          return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Artículos eliminados de tickets ({allItems.length})
              </h3>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-white border border-amber-200 rounded-lg p-2">
                  <span className="text-xs text-gray-500 block">Total registros</span>
                  <span className="font-bold text-amber-700">{allItems.length}</span>
                </div>
                <div className="bg-white border border-amber-200 rounded-lg p-2">
                  <span className="text-xs text-gray-500 block">Importe eliminado</span>
                  <span className="font-bold text-amber-600">{formatMonto(totalImporte)}</span>
                </div>
              </div>
              <div className="space-y-2">
                {grupos.map((g, gIdx) => (
                  <div key={gIdx} className="border border-amber-100 rounded-lg p-2.5 bg-white/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-gray-700">{g.usuario}</span>
                        {g.numero_venta ? (
                          <a
                            href={`/ventas?busqueda=${g.numero_venta}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium hover:bg-emerald-200 transition-colors cursor-pointer"
                            title="Ver venta en nueva pestaña"
                          >
                            Venta #{g.numero_venta}
                          </a>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                            Sin venta asociada
                          </span>
                        )}
                        {!g.numero_venta && g.items.length >= 3 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Posible ticket cancelado</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatHora(new Date(g.firstTime).toISOString())}</span>
                    </div>
                    {g.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs py-0.5">
                        <span className="truncate flex-1 min-w-0 text-gray-600">
                          {item.nombre || item.articulo_nombre || 'Artículo'}
                          {parseFloat(item.cantidad || 1) !== 1 && ` × ${item.cantidad}`}
                        </span>
                        <span className="flex-shrink-0 ml-2 text-gray-700">
                          {formatMonto(parseFloat(item.precio || item.precio_unitario || 0) * parseFloat(item.cantidad || 1))}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-end mt-1 pt-1 border-t border-amber-100">
                      <span className="text-xs font-bold text-amber-700">
                        {formatMonto(g.total)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Observaciones del cajero */}
        {cierre.observaciones && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-medium text-amber-700 mb-1">Observaciones del cajero</p>
            <p className="text-base text-gray-800">{cierre.observaciones}</p>
          </div>
        )}

        {/* Botones de accion */}
        <div className="flex gap-3">
          {!esBlind && cierre.estado !== 'abierta' && (
            <button
              onClick={() => imprimirCierre(cierre, retiros, denominaciones, gastos)}
              className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-100 py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              Imprimir comprobante
            </button>
          )}

          {!esBlind && cierre.estado === 'pendiente_gestor' && !verificacion && cierre.tipo !== 'delivery' && (
            <Link
              to={`/cajas-pos/cierre/${cierre.id}/editar?from=detalle`}
              className="flex-1 border border-amber-400 text-amber-700 hover:bg-amber-50 text-center py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              Editar conteo
            </Link>
          )}

          {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && cierre.tipo === 'delivery' && (
            <button
              onClick={async () => {
                try {
                  await api.post(`/api/cierres-pos/${cierre.id}/verificar`, {
                    billetes: {},
                    monedas: {},
                    total_efectivo: cierre.total_efectivo || 0,
                    medios_pago: [],
                    total_general: cierre.total_efectivo || 0,
                    observaciones: '',
                  })
                  navigate('/cajas-pos')
                } catch (err) {
                  alert(err.response?.data?.error || 'Error al verificar delivery')
                }
              }}
              className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Verificar delivery
            </button>
          )}

          {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && cierre.tipo !== 'delivery' && (
            <button
              onClick={async () => {
                try {
                  await api.post(`/api/cierres-pos/${cierre.id}/verificar`)
                  navigate('/cajas-pos')
                } catch (err) {
                  alert(err.response?.data?.error || 'Error al verificar')
                }
              }}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Marcar como verificado
            </button>
          )}
        </div>

        </>)}

        <Link
          to="/cajas-pos"
          className="block text-center text-sm text-gray-500 hover:text-gray-700 py-2"
        >
          Volver a Control de Caja POS
        </Link>
      </div>
    </div>
  )
}

export default DetalleCierrePos
