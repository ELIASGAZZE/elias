// Detalle de un cierre de caja con comparación cajero vs gestor
import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import { imprimirCierre } from '../../utils/imprimirComprobante'

const ESTADOS = {
  abierta: { label: 'Abierta', color: 'bg-emerald-100 text-emerald-700' },
  pendiente_gestor: { label: 'Pendiente verificación', color: 'bg-yellow-100 text-yellow-700' },
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

const FilaComparativa = ({ label, valorCajero, valorGestor, valorErp, esMoneda = true }) => {
  const formatVal = (val) => {
    if (val == null) return '—'
    return esMoneda ? formatMonto(val) : val
  }
  // Diferencia: gestor vs erp si hay gestor, sino cajero vs erp
  const base = valorGestor != null ? valorGestor : valorCajero
  const diff = valorErp != null ? base - valorErp : null
  const hayDiferencia = (valorGestor != null && valorCajero !== valorGestor) ||
                        (valorErp != null && base !== valorErp)
  return (
    <div className={`flex items-center text-sm py-1.5 ${hayDiferencia ? 'bg-red-50 -mx-2 px-2 rounded-lg' : ''}`}>
      <span className="flex-1 text-gray-600 min-w-0 truncate">{label}</span>
      <span className="w-28 text-right font-medium text-gray-800 flex-shrink-0 border-r border-gray-100 pr-3">{formatVal(valorCajero)}</span>
      <span className={`w-28 text-right font-medium flex-shrink-0 border-r border-gray-100 pr-3 ${
        valorGestor == null ? 'text-gray-400' :
        valorCajero !== valorGestor ? 'text-red-600 font-bold' : 'text-gray-800'
      }`}>{formatVal(valorGestor)}</span>
      <span className={`w-28 text-right font-medium flex-shrink-0 border-r border-gray-100 pr-3 ${
        valorErp == null ? 'text-gray-400' :
        base !== valorErp ? 'text-red-600 font-bold' : 'text-indigo-700'
      }`}>{formatVal(valorErp)}</span>
      <span className={`w-28 text-right font-medium flex-shrink-0 ${
        diff == null ? 'text-gray-400' :
        diff === 0 ? 'text-green-600' : 'text-red-600 font-bold'
      }`}>{diff == null ? '—' : formatMonto(diff)}</span>
    </div>
  )
}

const DetalleCierre = () => {
  const { id } = useParams()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierre, setCierre] = useState(null)
  const [verificacion, setVerificacion] = useState(null)
  const [erpData, setErpData] = useState(null)
  const [erpNoEncontrado, setErpNoEncontrado] = useState(false)
  const [comprobantes, setComprobantes] = useState(null)
  const [ncExpanded, setNcExpanded] = useState(false)
  const [ventasSinConfirmar, setVentasSinConfirmar] = useState(null)
  const [ventasExpanded, setVentasExpanded] = useState(false)
  const [denominaciones, setDenominaciones] = useState([])
  const [retiros, setRetiros] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  // Estado IA
  const [analisisIA, setAnalisisIA] = useState(null)
  const [cargandoIA, setCargandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState('')
  const [chatMensajes, setChatMensajes] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [enviandoChat, setEnviandoChat] = useState(false)
  const [guardandoRegla, setGuardandoRegla] = useState(null)
  const [reglaGuardada, setReglaGuardada] = useState(null)
  const chatEndRef = useRef(null)

  useEffect(() => {
    const cargar = async () => {
      try {
        // Fetch cierre and denominaciones in parallel
        const [cierreRes, denomRes] = await Promise.all([
          api.get(`/api/cierres/${id}`),
          api.get('/api/denominaciones'),
        ])

        const cierreData = cierreRes.data
        setCierre(cierreData)
        setDenominaciones(denomRes.data || [])

        // Fetch retiros, verificacion and ERP data in parallel
        const promises = []

        // Retiros: todos los roles, cualquier estado
        promises.push(
          api.get(`/api/cierres/${id}/retiros`)
            .then(res => setRetiros(res.data || []))
            .catch(() => {})
        )

        if (usuario?.rol !== 'operario' && !cierreData._blind) {
          promises.push(
            api.get(`/api/cierres/${id}/verificacion`)
              .then(res => setVerificacion(res.data))
              .catch(() => {})
          )
        }

        // Fetch ERP data (for admin/gestor, when cierre is not open)
        if (usuario?.rol !== 'operario' && cierreData.estado !== 'abierta') {
          promises.push(
            api.get(`/api/cierres/${id}/erp`)
              .then(res => setErpData(res.data))
              .catch(() => setErpNoEncontrado(true))
          )
          promises.push(
            api.get(`/api/cierres/${id}/ventas-sin-confirmar`)
              .then(res => setVentasSinConfirmar(res.data))
              .catch(() => {})
          )
          promises.push(
            api.get(`/api/cierres/${id}/comprobantes`)
              .then(res => setComprobantes(res.data))
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

  const analizarConIA = async () => {
    setCargandoIA(true)
    setErrorIA('')
    try {
      const { data } = await api.get(`/api/cierres/${id}/analisis-ia`)
      setAnalisisIA(data)
    } catch (err) {
      setErrorIA(err.response?.data?.error || 'Error al generar análisis')
    } finally {
      setCargandoIA(false)
    }
  }

  const enviarChat = async () => {
    const msg = chatInput.trim()
    if (!msg || enviandoChat) return
    setChatInput('')
    setChatMensajes(prev => [...prev, { rol: 'user', contenido: msg }])
    setEnviandoChat(true)
    try {
      const historial = chatMensajes.map(m => ({ rol: m.rol, contenido: m.contenido }))
      const { data } = await api.post(`/api/cierres/${id}/chat-ia`, { mensaje: msg, historial })
      setChatMensajes(prev => [...prev, { rol: 'assistant', contenido: data.respuesta }])
    } catch (err) {
      setChatMensajes(prev => [...prev, { rol: 'assistant', contenido: 'Error: no se pudo obtener respuesta.' }])
    } finally {
      setEnviandoChat(false)
    }
  }

  const guardarComoRegla = async (texto, idx) => {
    setGuardandoRegla(idx)
    try {
      await api.post('/api/reglas-ia', { regla: texto })
      setReglaGuardada(idx)
      setTimeout(() => setReglaGuardada(null), 3000)
    } catch (err) {
      alert('Error al guardar regla')
    } finally {
      setGuardandoRegla(null)
    }
  }

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMensajes])

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Cierre" sinTabs volverA="/cajas" />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo="Detalle Cierre" sinTabs volverA="/cajas" />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
          <Link to="/cajas" className="text-sm text-emerald-600 mt-4 inline-block">Volver</Link>
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

  // Build ERP medios map for comparison
  const erpMediosMap = {}
  if (erpData?.medios_pago) {
    erpData.medios_pago.forEach(mp => {
      erpMediosMap[mp.nombre.toUpperCase()] = mp
    })
  }
  const getErpMonto = (nombre) => {
    if (!erpData) return null
    const upper = nombre.toUpperCase()
    for (const [key, mp] of Object.entries(erpMediosMap)) {
      if (key.includes(upper) || upper.includes(key)) return mp.total
    }
    return 0
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Cierre" sinTabs volverA="/cajas" />

      <div className="px-4 py-4 space-y-4">

        {/* Sección 1: Encabezado */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Metadata */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">Planilla #{cierre.planilla_id}</h2>
              <div className="flex items-center gap-1.5">
                {ventasSinConfirmar?.cantidad > 0 && (
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                    {ventasSinConfirmar.cantidad} sin confirmar
                  </span>
                )}
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoCfg.color}`}>
                  {estadoCfg.label}
                </span>
              </div>
            </div>
            <div className="text-sm text-gray-500 space-y-0.5">
              {cierre.caja && (
                <p>Caja: {cierre.caja.nombre}</p>
              )}
              {cierre.caja?.sucursales?.nombre && (
                <p>Sucursal: {cierre.caja.sucursales.nombre}</p>
              )}
              {cierre.empleado && (
                <p>Abrió: {cierre.empleado.nombre}</p>
              )}
              {cierre.cerrado_por && (
                <p>Cerró: {cierre.cerrado_por.nombre}</p>
              )}
              <p>Fecha: {formatFecha(cierre.fecha)}</p>
              {cierre.fondo_fijo > 0 && (
                <p>Cambio inicial: {formatMonto(cierre.fondo_fijo)}</p>
              )}
            </div>
          </div>

          {/* Diferencias de apertura + Retiro y cambio (columna derecha del header) */}
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
                    <span className="font-bold text-emerald-700">{formatMonto(cierre.efectivo_retirado)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Si está abierta, botones cerrar + nuevo retiro */}
        {cierre.estado === 'abierta' && (usuario?.rol === 'operario' || esAdmin) && (
          <div className="flex gap-3">
            <Link
              to={`/cajas/cierre/${cierre.id}/cerrar`}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Cerrar caja
            </Link>
            <Link
              to={`/cajas/cierre/${cierre.id}/retiro`}
              className="flex-1 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Nuevo retiro
            </Link>
          </div>
        )}

        {/* Modo ciego para gestor */}
        {esBlind && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center space-y-3">
            <p className="text-sm text-yellow-800">
              Debés realizar tu conteo independiente antes de ver los montos del cajero.
            </p>
            <Link
              to={`/cajas/verificar/${cierre.id}`}
              className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors"
            >
              Verificar cierre
            </Link>
          </div>
        )}

        {/* Sección 2: Comparativos de cambio — dos tablas lado a lado */}
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
                  <p className="text-xs text-gray-400">Cambio planilla #{cierre.cierre_anterior.planilla_id} vs apertura</p>
                ) : (
                  <p className="text-xs text-gray-400">Apertura (sin cierre anterior)</p>
                )}

                <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-200">
                  <span className="flex-1">Denominación</span>
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
                  <p className="text-xs text-gray-400">Cambio dejado vs apertura #{cierre.apertura_siguiente.planilla_id}</p>
                ) : (
                  <p className="text-xs text-gray-400">Cambio dejado (sin apertura siguiente)</p>
                )}

                <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-200">
                  <span className="flex-1">Denominación</span>
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

        {/* Sección 3: Cuadro comparativo principal — siempre 3 columnas */}
        {!esBlind && cierre.estado !== 'abierta' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Cuadro comparativo</h3>

            <div className="text-xs text-gray-400 space-y-0.5">
              {verificacion && <p>Gestor: {verificacion.gestor?.nombre}</p>}
              {erpData && <p>ERP: Planilla #{erpData.planilla_id} — {erpData.nombre_cajero} {erpData.cerrada ? '(cerrada)' : '(abierta)'}</p>}
              {erpNoEncontrado && <p>ERP: No encontrado</p>}
            </div>

            {/* Header */}
            <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-200">
              <span className="flex-1">Concepto</span>
              <span className="w-28 text-right border-r border-gray-100 pr-3">Cajero</span>
              <span className="w-28 text-right border-r border-gray-100 pr-3">Gestor</span>
              <span className="w-28 text-right border-r border-gray-100 pr-3">ERP</span>
              <span className="w-28 text-right">Diferencia</span>
            </div>

            <FilaComparativa
              label="Efectivo"
              valorCajero={(parseFloat(cierre.total_efectivo) || 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0)}
              valorGestor={verificacion ? (parseFloat(verificacion.total_efectivo) || 0) + (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0) : null}
              valorErp={erpData ? erpData.total_efectivo : null}
            />



            {/* Medios de pago dinámicos */}
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
                  valorErp={getErpMonto(nombre)}
                />
              )
            })}

            {/* Medios que solo existen en ERP */}
            {erpData && erpData.medios_pago.filter(emp => {
              const upper = emp.nombre.toUpperCase()
              return !allFormaCobroIds.some(fcId => {
                const nombre = (cierreMediosMap[fcId]?.nombre || verifMediosMap[fcId]?.nombre || '').toUpperCase()
                return nombre.includes(upper) || upper.includes(nombre)
              }) && upper !== 'EFECTIVO'
            }).map(emp => (
              <FilaComparativa
                key={`erp-${emp.valor_id}`}
                label={emp.nombre}
                valorCajero={0}
                valorGestor={verificacion ? 0 : null}
                valorErp={emp.total}
              />
            ))}

            {/* Total general — ajustado con cambio */}
            {(() => {
              const ajuste = (parseFloat(cierre.cambio_que_queda) || 0) - (parseFloat(cierre.fondo_fijo) || 0)
              const totalCajero = (parseFloat(cierre.total_general) || 0) + ajuste
              const totalGestor = verificacion ? (parseFloat(verificacion.total_general) || 0) + ajuste : null
              const totalErp = erpData ? erpData.total_general : null
              const base = totalGestor != null ? totalGestor : totalCajero
              const diffTotal = totalErp != null ? base - totalErp : null

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
                      totalErp == null ? 'text-gray-400' :
                      base !== totalErp ? 'text-red-600' : 'text-indigo-700'
                    }`}>{totalErp != null ? formatMonto(totalErp) : '—'}</span>
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

        {/* Aviso ERP no encontrado */}
        {!esBlind && erpNoEncontrado && cierre.estado !== 'abierta' && !erpData && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500">No se encontraron datos del ERP para esta planilla.</p>
          </div>
        )}

        {/* Comprobantes del ERP */}
        {!esBlind && comprobantes && cierre.estado !== 'abierta' && usuario?.rol !== 'operario' && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-indigo-700">
              Comprobantes ({comprobantes.total_comprobantes} total)
            </h3>

            {/* Tabla resumen por tipo */}
            <div className="space-y-0.5">
              <div className="flex items-center text-xs font-medium text-indigo-400 py-1 border-b border-indigo-200">
                <span className="w-14">Código</span>
                <span className="flex-1">Tipo</span>
                <span className="w-12 text-right">Cant.</span>
                <span className="w-24 text-right">Total</span>
              </div>
              {comprobantes.resumen.map(r => (
                <div key={r.tipo_id} className="flex items-center text-sm py-1">
                  <span className="w-14 text-indigo-600 font-medium">{r.codigo}</span>
                  <span className="flex-1 text-gray-600 truncate">{r.nombre}</span>
                  <span className="w-12 text-right text-gray-800 font-medium">{r.cantidad}</span>
                  <span className="w-24 text-right text-gray-800 font-medium">{formatMonto(r.total)}</span>
                </div>
              ))}
            </div>

            {/* Notas de Crédito expandible */}
            {comprobantes.notas_credito.length > 0 && (
              <div className="border-t border-indigo-200 pt-2">
                <button
                  onClick={() => setNcExpanded(!ncExpanded)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <span className="text-sm font-semibold text-red-700">
                    Notas de Crédito ({comprobantes.notas_credito.length})
                  </span>
                  <span className="text-xs text-indigo-600 font-medium">
                    {ncExpanded ? 'Ocultar' : 'Ver detalle'}
                  </span>
                </button>

                {ncExpanded && (
                  <div className="space-y-3 pt-2">
                    {comprobantes.notas_credito.map(nc => (
                      <div key={nc.venta_id} className="bg-white border border-red-200 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-800">{nc.numero || `#${nc.venta_id}`}</span>
                          <span className="text-sm font-bold text-red-600">{formatMonto(nc.total)}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs text-gray-500">
                          {nc.fecha && <span>Fecha: {new Date(nc.fecha).toLocaleDateString('es-AR')}</span>}
                          {nc.cliente && <span>Cliente: {nc.cliente}</span>}
                        </div>
                        {nc.articulos.length > 0 && (
                          <div className="text-xs text-gray-500 space-y-0.5 pt-1 border-t border-gray-100">
                            {nc.articulos.map((art, i) => (
                              <div key={i} className="flex justify-between">
                                <span className="truncate flex-1">
                                  {art.codigo ? `${art.codigo} — ` : ''}{art.nombre || 'Sin nombre'}
                                  {' x '}{art.cantidad}
                                </span>
                                <span className="ml-2 flex-shrink-0">{formatMonto(art.precio)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Ventas sin confirmar */}
        {ventasSinConfirmar?.cantidad > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-amber-800">
                Ventas sin confirmar ({ventasSinConfirmar.cantidad})
              </h3>
              <button
                onClick={() => setVentasExpanded(!ventasExpanded)}
                className="text-xs text-amber-600 hover:text-amber-800 font-medium"
              >
                {ventasExpanded ? 'Ocultar' : 'Ver detalle'}
              </button>
            </div>
            <p className="text-xs text-amber-600">
              Se detectaron ventas cerradas sin confirmar durante esta sesión. Podrían explicar diferencias en el arqueo.
            </p>
            {ventasExpanded && (
              <div className="space-y-3 pt-1">
                {ventasSinConfirmar.ventas.map((venta, idx) => (
                  <div key={venta.id || idx} className="bg-white border border-amber-200 rounded-lg p-3 space-y-1.5">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {venta.usuario && <span>Usuario: {venta.usuario}</span>}
                      {venta.fecha && <span>Fecha: {venta.fecha}</span>}
                      {venta.equipo && <span>Equipo: {venta.equipo}</span>}
                      {venta.sucursal && <span>Sucursal: {venta.sucursal}</span>}
                    </div>
                    {venta.cliente_nombre && (
                      <p className="text-xs text-gray-600">
                        Cliente: {venta.cliente_id} — {venta.cliente_nombre}
                      </p>
                    )}
                    {venta.articulos && venta.articulos.length > 0 && (
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <p className="font-medium text-gray-600">Artículos:</p>
                        {venta.articulos.map((art, i) => (
                          <p key={i}>
                            {art.codigo ? `${art.codigo} — ${art.nombre} x ${art.cantidad}` : art.descripcion}
                          </p>
                        ))}
                      </div>
                    )}
                    {!venta.usuario && !venta.cliente_nombre && venta.descripcion_raw && (
                      <p className="text-xs text-gray-500 break-words">{venta.descripcion_raw}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                          <span className="text-sm font-bold text-emerald-700">{formatMonto(r.total)}</span>
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
                            to={`/cajas/retiro/${r.id}/verificar`}
                            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
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
                    {/* Comparación inline si verificado y no blind */}
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
                <span className="text-emerald-700">{formatMonto(retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0))}</span>
              </div>
            )}
          </div>
        )}

        {/* Panel de Análisis IA */}
        {(esGestor || esAdmin) && !esBlind && cierre.estado !== 'abierta' && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-violet-800 flex items-center gap-1.5">
                <span className="text-violet-500">&#10022;</span> Análisis IA
              </h3>
              {!analisisIA && !cargandoIA && (
                <button
                  onClick={analizarConIA}
                  className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                >
                  Analizar
                </button>
              )}
            </div>

            {cargandoIA && (
              <div className="flex items-center justify-center py-6 gap-2">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-violet-600" />
                <span className="text-sm text-violet-600">Analizando cierre...</span>
              </div>
            )}

            {errorIA && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-600">{errorIA}</p>
                <button onClick={analizarConIA} className="text-xs text-red-700 underline mt-1">Reintentar</button>
              </div>
            )}

            {analisisIA && (
              <div className="space-y-3">
                {/* Puntaje y nivel de riesgo */}
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className={`text-3xl font-bold ${
                      analisisIA.puntaje > 80 ? 'text-green-600' :
                      analisisIA.puntaje >= 50 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {analisisIA.puntaje}
                    </div>
                    <div className="text-xs text-gray-500">Puntaje</div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    analisisIA.nivel_riesgo === 'bajo' ? 'bg-green-100 text-green-700' :
                    analisisIA.nivel_riesgo === 'medio' ? 'bg-yellow-100 text-yellow-700' :
                    analisisIA.nivel_riesgo === 'alto' ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    Riesgo {analisisIA.nivel_riesgo}
                  </span>
                </div>

                {/* Resumen */}
                <p className="text-sm text-gray-700">{analisisIA.resumen}</p>

                {/* Alertas */}
                {analisisIA.alertas && analisisIA.alertas.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-violet-700">Alertas</h4>
                    {analisisIA.alertas.map((alerta, i) => (
                      <div key={i} className={`flex items-start gap-2 text-sm p-2 rounded-lg ${
                        alerta.severidad === 'critico' ? 'bg-red-50 text-red-700' :
                        alerta.severidad === 'advertencia' ? 'bg-yellow-50 text-yellow-700' :
                        'bg-blue-50 text-blue-700'
                      }`}>
                        <span className="flex-shrink-0 mt-0.5">
                          {alerta.severidad === 'critico' ? '!!' :
                           alerta.severidad === 'advertencia' ? '!' : 'i'}
                        </span>
                        <span>{alerta.mensaje}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recomendaciones */}
                {analisisIA.recomendaciones && analisisIA.recomendaciones.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-violet-700">Recomendaciones</h4>
                    <ul className="text-sm text-gray-600 space-y-0.5">
                      {analisisIA.recomendaciones.map((rec, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-violet-400 mt-1 flex-shrink-0">-</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Chat inline */}
            {(analisisIA || chatMensajes.length > 0) && (
              <div className="border-t border-violet-200 pt-3 space-y-3">
                <h4 className="text-xs font-semibold text-violet-700">Chat con IA</h4>

                {chatMensajes.length > 0 && (
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                    {chatMensajes.map((msg, i) => (
                      <div key={i} className={`flex ${msg.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className="max-w-[85%]">
                          <div className={`text-sm px-3 py-2 rounded-xl ${
                            msg.rol === 'user'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-violet-100 text-violet-900'
                          }`}>
                            {msg.contenido}
                          </div>
                          {msg.rol === 'user' && (
                            <div className="flex justify-end mt-0.5">
                              <button
                                onClick={() => guardarComoRegla(msg.contenido, i)}
                                disabled={guardandoRegla === i || reglaGuardada === i}
                                className="text-[10px] text-violet-400 hover:text-violet-600 disabled:text-green-500 transition-colors"
                              >
                                {reglaGuardada === i ? 'Guardada' : guardandoRegla === i ? 'Guardando...' : 'Guardar como regla'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {enviandoChat && (
                      <div className="flex justify-start">
                        <div className="bg-violet-100 text-violet-600 text-sm px-3 py-2 rounded-xl">
                          <div className="flex items-center gap-1.5">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-violet-500" />
                            Pensando...
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') enviarChat() }}
                    placeholder="Preguntá sobre este cierre..."
                    className="flex-1 text-sm border border-violet-200 rounded-lg px-3 py-2 focus:outline-none focus:border-violet-400"
                    disabled={enviandoChat}
                  />
                  <button
                    onClick={enviarChat}
                    disabled={enviandoChat || !chatInput.trim()}
                    className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Botones de acción */}
        <div className="flex gap-3">
          {!esBlind && cierre.estado !== 'abierta' && (
            <button
              onClick={() => imprimirCierre(cierre, retiros, denominaciones)}
              className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-100 py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              Imprimir comprobante
            </button>
          )}

          {!esBlind && cierre.estado === 'pendiente_gestor' && !verificacion && (
            <Link
              to={`/cajas/cierre/${cierre.id}/editar`}
              className="flex-1 border border-amber-400 text-amber-700 hover:bg-amber-50 text-center py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              Editar conteo
            </Link>
          )}

          {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && !esBlind && (
            <Link
              to={`/cajas/verificar/${cierre.id}`}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              Verificar cierre
            </Link>
          )}
        </div>

        <Link
          to="/cajas"
          className="block text-center text-sm text-gray-500 hover:text-gray-700 py-2"
        >
          Volver a Control de Cajas
        </Link>
      </div>
    </div>
  )
}

export default DetalleCierre
