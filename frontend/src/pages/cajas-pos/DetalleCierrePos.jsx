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
  const [controlandoGasto, setControlandoGasto] = useState(null)
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

        if (usuario?.rol !== 'operario' && !cierreData._blind) {
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
  const esBlind = cierre._blind

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

        {/* Seccion 1: Encabezado */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Metadata */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">Sesion POS</h2>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoCfg.color}`}>
                {estadoCfg.label}
              </span>
            </div>
            <div className="text-sm text-gray-500 space-y-0.5">
              {cierre.caja && (
                <p>Caja: {cierre.caja.nombre}</p>
              )}
              {cierre.caja?.sucursales?.nombre && (
                <p>Sucursal: {cierre.caja.sucursales.nombre}</p>
              )}
              {cierre.empleado && (
                <p>Abrio: {cierre.empleado.nombre}</p>
              )}
              {cierre.cerrado_por && (
                <p>Cerro: {cierre.cerrado_por.nombre}</p>
              )}
              <p>Fecha: {formatFecha(cierre.fecha)}</p>
              {cierre.apertura_at && (
                <p>Apertura: {formatHora(cierre.apertura_at)}</p>
              )}
              {cierre.cierre_at && (
                <p>Cierre: {formatHora(cierre.cierre_at)}</p>
              )}
              {cierre.fondo_fijo > 0 && (
                <p>Cambio inicial: {formatMonto(cierre.fondo_fijo)}</p>
              )}
              {posVentas && (
                <p className="text-teal-600 font-medium">Ventas POS: {posVentas.cantidad_ventas} venta(s)</p>
              )}
            </div>
          </div>

          {/* Diferencias de apertura + Retiro y cambio */}
          <div className="space-y-4">
            {cierre.diferencias_apertura && Object.keys(cierre.diferencias_apertura).length > 0 && (
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

            {cierre.estado !== 'abierta' && (parseFloat(cierre.cambio_que_queda) > 0 || parseFloat(cierre.efectivo_retirado) > 0) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-2">Retiro y cambio</h3>
                <div className="flex gap-4 text-sm">
                  <div className="flex-1 bg-white border border-amber-200 rounded-lg p-2 text-center">
                    <span className="text-xs text-gray-500 block">Cambio que queda</span>
                    <span className="font-bold text-amber-700">{formatMonto(cierre.cambio_que_queda)}</span>
                  </div>
                  <div className="flex-1 bg-white border border-amber-200 rounded-lg p-2 text-center">
                    <span className="text-xs text-gray-500 block">Efectivo retirado</span>
                    <span className="font-bold text-teal-700">{formatMonto(cierre.efectivo_retirado)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

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

        {/* Modo ciego para gestor */}
        {esBlind && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center space-y-3">
            <p className="text-sm text-yellow-800">
              Debes realizar tu conteo independiente antes de ver los montos del cajero.
            </p>
            <Link
              to={`/cajas-pos/verificar/${cierre.id}`}
              className="inline-block bg-teal-600 hover:bg-teal-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors"
            >
              Verificar cierre
            </Link>
          </div>
        )}

        {/* Seccion 2: Comparativos de cambio — dos tablas lado a lado */}
        {!esBlind && cierre.estado !== 'abierta' && (
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
                    <span className="w-24 text-right border-r border-gray-100 pr-3">Cierre ant.</span>
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
                      <span className="w-24 text-right border-r border-gray-100 pr-3">Apert. sig.</span>
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
              {posVentas && <p>Ventas POS: {posVentas.cantidad_ventas} venta(s) — Total: {formatMonto(posVentas.total_general)}</p>}
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

            <FilaComparativa
              label="Efectivo"
              valorCajero={(parseFloat(cierre.total_efectivo) || 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0)}
              valorGestor={verificacion ? (parseFloat(verificacion.total_efectivo) || 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0) : null}
              valorPos={posVentas ? posVentas.total_efectivo : null}
            />

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
              }) && upper !== 'EFECTIVO'
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
              const ajuste = (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) + gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0)
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

          {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && !esBlind && (
            <Link
              to={`/cajas-pos/verificar/${cierre.id}`}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Verificar cierre
            </Link>
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
