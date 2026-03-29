// Detalle de un cierre de caja POS con comparacion cajero vs gestor vs ventas POS
import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
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
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierre, setCierre] = useState(null)
  const [verificacion, setVerificacion] = useState(null)
  const [posVentas, setPosVentas] = useState(null)
  const [posNoEncontrado, setPosNoEncontrado] = useState(false)
  const [denominaciones, setDenominaciones] = useState([])
  const [retiros, setRetiros] = useState([])
  const [gastos, setGastos] = useState([])
  const [cambiosPrecio, setCambiosPrecio] = useState([])
  const [controlandoGasto, setControlandoGasto] = useState(null)
  const [retiroEmpleadoExpandido, setRetiroEmpleadoExpandido] = useState(null)
  const [cuponesExpanded, setCuponesExpanded] = useState(false)
  const [efectivoExpanded, setEfectivoExpanded] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
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

        // Fetch retiros, verificacion and POS ventas data in parallel
        const promises = []

        // Retiros: todos los roles, cualquier estado
        promises.push(
          api.get(`/api/cierres-pos/${id}/retiros`)
            .then(res => setRetiros(res.data || []))
            .catch(() => {})
        )

        // Gastos
        promises.push(
          api.get(`/api/cierres-pos/${id}/gastos`)
            .then(res => setGastos(res.data || []))
            .catch(() => {})
        )

        if (usuario?.rol !== 'operario') {
          promises.push(
            api.get(`/api/cierres-pos/${id}/verificacion`)
              .then(res => setVerificacion(res.data))
              .catch(() => {})
          )
        }

        // Fetch POS ventas data (for admin/gestor, when cierre is not open)
        if (usuario?.rol !== 'operario' && cierreData.estado !== 'abierta') {
          promises.push(
            api.get(`/api/cierres-pos/${id}/pos-ventas`)
              .then(res => setPosVentas(res.data))
              .catch(() => setPosNoEncontrado(true))
          )
        }

        // Cambios de precio (solo admin)
        if (esAdmin) {
          promises.push(
            api.get(`/api/cierres-pos/${id}/cambios-precio`)
              .then(res => setCambiosPrecio(res.data || []))
              .catch(() => {})
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
  }, [id, usuario?.rol])

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
            {cierre.apertura_at && <span>Apertura: <strong className="text-gray-700">{formatHora(cierre.apertura_at)}</strong></span>}
            {cierre.cierre_at && <span>Cierre: <strong className="text-gray-700">{formatHora(cierre.cierre_at)}</strong></span>}
            {cierre.fondo_fijo > 0 && cierre.tipo !== 'delivery' && <span>Cambio inicial: <strong className="text-gray-700">{formatMonto(cierre.fondo_fijo)}</strong></span>}
            {posVentas && <span className="text-teal-600 font-medium">Ventas POS: {posVentas.cantidad_ventas} venta(s)</span>}
          </div>
        </div>

        {/* Diferencias de apertura */}
        {cierre.tipo !== 'delivery' && cierre.diferencias_apertura && Object.keys(cierre.diferencias_apertura).length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-red-700">Diferencias en apertura vs cierre anterior</h3>
            <p className="text-xs text-red-600">El cambio inicial no coincide con lo dejado en el cierre anterior.</p>
            <div className="space-y-1">
              {Object.entries(cierre.diferencias_apertura).map(([denom, diff]) => (
                <div key={denom} className="flex justify-between text-sm">
                  <span className="text-red-700">
                    ${Number(denom).toLocaleString('es-AR')} ({diff.tipo === 'billete' ? 'billete' : 'moneda'})
                  </span>
                  <span className="text-red-800 font-medium">
                    Anterior: {diff.anterior} → Actual: {diff.actual}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {/* Banner verificar para gestor/admin */}
        {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center space-y-3">
            <p className="text-sm text-yellow-800">
              Este cierre está pendiente de verificación.
            </p>
            <button
              onClick={async () => {
                try {
                  await api.post(`/api/cierres-pos/${cierre.id}/verificar`)
                  setCierre(prev => ({ ...prev, estado: 'pendiente_agente' }))
                } catch (err) {
                  alert(err.response?.data?.error || 'Error al verificar')
                }
              }}
              className="inline-block bg-teal-600 hover:bg-teal-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors"
            >
              Marcar como verificado
            </button>
          </div>
        )}

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

        {/* Seccion 3: Cuadro comparativo principal — Cajero vs Gestor vs Ventas POS */}
        {!esBlind && cierre.estado !== 'abierta' && (
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

            <div
              className="cursor-pointer hover:bg-gray-50 rounded transition-colors"
              onClick={() => esAdmin && posVentas && setEfectivoExpanded(!efectivoExpanded)}
            >
              <FilaComparativa
                label={esAdmin && posVentas ? (efectivoExpanded ? 'Efectivo ▲' : 'Efectivo ▼') : 'Efectivo'}
                valorCajero={(parseFloat(cierre.total_efectivo) || 0) + retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0)}
                valorGestor={verificacion ? (parseFloat(verificacion.total_efectivo) || 0) + retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0) : null}
                valorPos={posVentas ? posVentas.total_efectivo : null}
              />
            </div>
            {efectivoExpanded && posVentas && (() => {
              const ventasConEfectivo = (posVentas.detalle_ventas || []).filter(v =>
                (v.pagos || []).some(p => (p.tipo || 'Efectivo') === 'Efectivo')
              )
              return ventasConEfectivo.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3 -mt-1 mb-1">
                  <div className="flex items-center text-[10px] font-medium text-gray-400 py-1 border-b border-gray-200 mb-1">
                    <span className="w-16">Venta</span>
                    <span className="w-14 text-center">Hora</span>
                    <span className="flex-1 text-right">Total venta</span>
                    <span className="w-24 text-right">Efectivo</span>
                    <span className="w-20 text-right">Vuelto</span>
                    <span className="w-24 text-right font-semibold">Neto</span>
                  </div>
                  {ventasConEfectivo.map(v => {
                    const pagoEfectivo = (v.pagos || []).filter(p => (p.tipo || 'Efectivo') === 'Efectivo').reduce((s, p) => s + (parseFloat(p.monto) || 0), 0)
                    const vuelto = parseFloat(v.vuelto) || 0
                    const neto = pagoEfectivo - vuelto
                    return (
                      <div key={v.id} className="flex items-center text-xs py-1 border-b border-gray-100 last:border-b-0">
                        <span className="w-16 text-blue-600 font-medium">#{v.numero_venta || '—'}</span>
                        <span className="w-14 text-center text-gray-400">{new Date(v.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="flex-1 text-right text-gray-500">{formatMonto(v.total)}</span>
                        <span className="w-24 text-right text-gray-700">{formatMonto(pagoEfectivo)}</span>
                        <span className="w-20 text-right text-red-500">{vuelto > 0 ? `-${formatMonto(vuelto)}` : '—'}</span>
                        <span className="w-24 text-right font-medium text-teal-700">{formatMonto(neto)}</span>
                      </div>
                    )
                  })}
                  <div className="flex items-center text-xs font-bold pt-2 border-t border-gray-200 mt-1">
                    <span className="flex-1 text-gray-700">{ventasConEfectivo.length} venta(s) con efectivo</span>
                    <span className="w-24 text-right text-teal-700">{formatMonto(posVentas.total_efectivo)}</span>
                  </div>
                </div>
              )
            })()}

            {/* Medios de pago dinamicos */}
            {allFormaCobroIds.map(fcId => {
              const cierreMp = cierreMediosMap[fcId]
              const verifMp = verifMediosMap[fcId]
              const nombre = cierreMp?.nombre || verifMp?.nombre || 'Medio de pago'
              return (
                <FilaComparativa
                  key={fcId}
                  label={nombre}
                  valorCajero={parseFloat(cierreMp?.monto) || 0}
                  valorGestor={verificacion ? (parseFloat(verifMp?.monto) || 0) : null}
                  valorPos={getPosMonto(nombre)}
                />
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
              <FilaComparativa
                key={`pos-${pmp.nombre}-${idx}`}
                label={pmp.nombre}
                valorCajero={0}
                valorGestor={verificacion ? 0 : null}
                valorPos={pmp.total}
              />
            ))}

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

            {/* Observaciones del cajero */}
            {cierre.observaciones && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-400">Observaciones del cajero</p>
                <p className="text-sm text-gray-700">{cierre.observaciones}</p>
              </div>
            )}
          </div>
        )}

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
                    <span className="w-16 text-center">Hora</span>
                    <span className="w-24 text-right">Importe</span>
                  </div>
                  {mp.detalle.map((c, idx) => (
                    <div key={idx} className={`flex items-center text-xs py-1.5 ${c.mp_problema ? 'bg-amber-50 rounded px-1 -mx-1' : 'border-b border-blue-50'}`}>
                      <span className="flex-1 text-gray-700">
                        {c.numero_venta ? `#${c.numero_venta}` : '—'}
                      </span>
                      <span className="w-20 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c.tipo.toLowerCase() === 'qr mp' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {c.tipo.toLowerCase() === 'qr mp' ? 'QR' : 'Posnet'}
                        </span>
                      </span>
                      <span className="w-24 text-center text-gray-500 text-[10px]">
                        {c.card_brand && c.card_last_four ? `${c.card_brand} ···${c.card_last_four}` : c.payment_type === 'account_money' ? 'QR Wallet' : '—'}
                      </span>
                      <span className="w-16 text-center text-gray-400">
                        {new Date(c.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="w-24 text-right font-medium text-gray-700">{formatMonto(c.monto)}</span>
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

          {!esBlind && cierre.estado === 'pendiente_gestor' && !verificacion && (
            <Link
              to={`/cajas-pos/cierre/${cierre.id}/editar`}
              className="flex-1 border border-amber-400 text-amber-700 hover:bg-amber-50 text-center py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              Editar conteo
            </Link>
          )}

          {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && (
            <button
              onClick={async () => {
                try {
                  await api.post(`/api/cierres-pos/${cierre.id}/verificar`)
                  setCierre(prev => ({ ...prev, estado: 'pendiente_agente' }))
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
