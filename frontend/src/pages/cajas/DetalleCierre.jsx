// Detalle de un cierre de caja con comparación cajero vs gestor
import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

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

const FilaComparativa = ({ label, valorCajero, valorGestor, valorErp, esMoneda = true, conErp = false }) => {
  const cajero = esMoneda ? formatMonto(valorCajero) : valorCajero
  const gestor = esMoneda ? formatMonto(valorGestor) : valorGestor
  const erp = esMoneda ? formatMonto(valorErp) : valorErp
  const hayDiferencia = valorCajero !== valorGestor || (conErp && valorErp != null && valorCajero !== valorErp)
  return (
    <div className={`flex items-center text-sm py-1.5 ${hayDiferencia ? 'bg-red-50 -mx-2 px-2 rounded-lg' : ''}`}>
      <span className="flex-1 text-gray-600 min-w-0 truncate">{label}</span>
      <span className="w-24 text-right font-medium text-gray-800 flex-shrink-0">{cajero}</span>
      <span className={`w-24 text-right font-medium flex-shrink-0 ${valorCajero !== valorGestor ? 'text-red-600 font-bold' : 'text-gray-800'}`}>{gestor}</span>
      {conErp && (
        <span className={`w-24 text-right font-medium flex-shrink-0 ${valorErp != null && valorCajero !== valorErp ? 'text-red-600 font-bold' : 'text-indigo-700'}`}>{valorErp != null ? erp : '—'}</span>
      )}
    </div>
  )
}

const DetalleCierre = () => {
  const { id } = useParams()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierre, setCierre] = useState(null)
  const [verificacion, setVerificacion] = useState(null)
  const [erpData, setErpData] = useState(null)
  const [denominaciones, setDenominaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

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

        // Fetch verificacion and ERP data in parallel
        const promises = []

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

  // Separate denominaciones into billetes and monedas
  const denomBilletes = denominaciones
    .filter(d => d.tipo === 'billete')
    .sort((a, b) => b.valor - a.valor)
  const denomMonedas = denominaciones
    .filter(d => d.tipo === 'moneda')
    .sort((a, b) => b.valor - a.valor)

  // Filter to only those with count > 0 in cierre
  const billetesActivos = denomBilletes.filter(d => cierre.billetes && cierre.billetes[String(d.valor)] > 0)
  const monedasActivas = denomMonedas.filter(d => cierre.monedas && cierre.monedas[String(d.valor)] > 0)

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

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Detalle Cierre" sinTabs volverA="/cajas" />

      <div className="px-4 py-4 max-w-lg mx-auto space-y-4">

        {/* Metadata */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Planilla #{cierre.planilla_id}</h2>
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

        {/* Diferencias de apertura (si hay) */}
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

        {/* Retiro y cambio que queda (solo si hay datos y no está abierta) */}
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

        {/* Si está abierta, botón para cerrar */}
        {cierre.estado === 'abierta' && (usuario?.rol === 'operario' || esAdmin) && (
          <Link
            to={`/cajas/cierre/${cierre.id}/cerrar`}
            className="block w-full bg-emerald-600 hover:bg-emerald-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
          >
            Cerrar caja
          </Link>
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

        {/* Detalle del cierre (si no es blind y no hay verificación) */}
        {!esBlind && !verificacion && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Detalle del cierre</h3>

            {/* Billetes */}
            {billetesActivos.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Billetes</p>
                {billetesActivos.map(d => {
                  const cantidad = cierre.billetes[String(d.valor)]
                  return (
                    <div key={d.valor} className="flex justify-between text-sm py-0.5">
                      <span className="text-gray-600">${Number(d.valor).toLocaleString('es-AR')} x {cantidad}</span>
                      <span className="text-gray-800 font-medium">{formatMonto(d.valor * cantidad)}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Monedas */}
            {monedasActivas.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Monedas</p>
                {monedasActivas.map(d => {
                  const cantidad = cierre.monedas[String(d.valor)]
                  return (
                    <div key={d.valor} className="flex justify-between text-sm py-0.5">
                      <span className="text-gray-600">${Number(d.valor).toLocaleString('es-AR')} x {cantidad}</span>
                      <span className="text-gray-800 font-medium">{formatMonto(d.valor * cantidad)}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="border-t border-gray-100 pt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Total efectivo</span>
                <span className="font-medium">{formatMonto(cierre.total_efectivo)}</span>
              </div>

              {parseFloat(cierre.cambio_que_queda) > 0 && (
                <div className="flex justify-between">
                  <span className="text-amber-700">Cambio que queda</span>
                  <span className="font-medium text-amber-700">{formatMonto(cierre.cambio_que_queda)}</span>
                </div>
              )}

              {parseFloat(cierre.efectivo_retirado) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Efectivo retirado</span>
                  <span className="font-medium">{formatMonto(cierre.efectivo_retirado)}</span>
                </div>
              )}

              {/* Dynamic medios de pago */}
              {Array.isArray(cierre.medios_pago) && cierre.medios_pago.map(mp => (
                <div key={mp.forma_cobro_id} className="flex justify-between">
                  <span className="text-gray-600">
                    {mp.nombre}{mp.cantidad > 0 ? ` (${mp.cantidad})` : ''}
                  </span>
                  <span className="font-medium">{formatMonto(mp.monto)}</span>
                </div>
              ))}

              <div className="flex justify-between font-bold pt-1 border-t border-gray-200">
                <span>Total general</span>
                <span className="text-emerald-700">{formatMonto(cierre.total_general)}</span>
              </div>
            </div>

            {cierre.observaciones && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-400">Observaciones</p>
                <p className="text-sm text-gray-700">{cierre.observaciones}</p>
              </div>
            )}
          </div>
        )}

        {/* Tabla comparativa (si hay verificación) */}
        {!esBlind && verificacion && (() => {
          const conErp = !!erpData
          // Build ERP medios map by normalized name
          const erpMediosMap = {}
          if (erpData?.medios_pago) {
            erpData.medios_pago.forEach(mp => {
              erpMediosMap[mp.nombre.toUpperCase()] = mp
            })
          }
          // Helper to find ERP value for a given medio name
          const getErpMonto = (nombre) => {
            if (!conErp) return null
            const upper = nombre.toUpperCase()
            for (const [key, mp] of Object.entries(erpMediosMap)) {
              if (key.includes(upper) || upper.includes(key)) return mp.total
            }
            return 0
          }

          return (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Comparación {conErp ? 'cajero vs gestor vs ERP' : 'cajero vs gestor'}
              </h3>
              <div className="text-xs text-gray-400 space-y-0.5">
                <p>Gestor: {verificacion.gestor?.nombre}</p>
                {conErp && <p>ERP: Planilla #{erpData.planilla_id} — {erpData.nombre_cajero} {erpData.cerrada ? '(cerrada)' : '(abierta)'}</p>}
              </div>

              {/* Header */}
              <div className="flex items-center text-xs font-medium text-gray-400 py-1 border-b border-gray-100">
                <span className="flex-1">Concepto</span>
                <span className="w-24 text-right">Cajero</span>
                <span className="w-24 text-right">Gestor</span>
                {conErp && <span className="w-24 text-right">ERP</span>}
              </div>

              <FilaComparativa
                label="Efectivo"
                valorCajero={parseFloat(cierre.total_efectivo) || 0}
                valorGestor={parseFloat(verificacion.total_efectivo) || 0}
                valorErp={conErp ? erpData.total_efectivo : null}
                conErp={conErp}
              />

              {/* Dynamic medios de pago comparison */}
              {allFormaCobroIds.map(fcId => {
                const cierreMp = cierreMediosMap[fcId]
                const verifMp = verifMediosMap[fcId]
                const nombre = cierreMp?.nombre || verifMp?.nombre || 'Medio de pago'
                const montoCajero = parseFloat(cierreMp?.monto) || 0
                const montoGestor = parseFloat(verifMp?.monto) || 0
                const montoErp = getErpMonto(nombre)
                return (
                  <FilaComparativa
                    key={fcId}
                    label={nombre}
                    valorCajero={montoCajero}
                    valorGestor={montoGestor}
                    valorErp={montoErp}
                    conErp={conErp}
                  />
                )
              })}

              {/* ERP medios that don't exist in cajero/gestor */}
              {conErp && erpData.medios_pago.filter(emp => {
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
                  valorGestor={0}
                  valorErp={emp.total}
                  conErp={conErp}
                />
              ))}

              <div className="border-t border-gray-200 pt-2">
                <FilaComparativa
                  label="TOTAL GENERAL"
                  valorCajero={parseFloat(cierre.total_general) || 0}
                  valorGestor={parseFloat(verificacion.total_general) || 0}
                  valorErp={conErp ? erpData.total_general : null}
                  conErp={conErp}
                />
              </div>

              {/* Diferencias */}
              {(() => {
                const totalCajero = parseFloat(cierre.total_general) || 0
                const totalGestor = parseFloat(verificacion.total_general) || 0
                const totalErp = conErp ? erpData.total_general : null
                const diffCG = totalCajero !== totalGestor
                const diffCE = conErp && totalErp != null && totalCajero !== totalErp

                if (!diffCG && !diffCE) {
                  return (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
                      <p className="text-sm font-semibold text-green-700">Sin diferencias</p>
                    </div>
                  )
                }
                return (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2 space-y-1">
                    {diffCG && (
                      <p className="text-sm font-semibold text-red-700">
                        Cajero vs Gestor: {formatMonto(totalGestor - totalCajero)}
                      </p>
                    )}
                    {diffCE && (
                      <p className="text-sm font-semibold text-red-700">
                        Cajero vs ERP: {formatMonto(totalErp - totalCajero)}
                      </p>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {/* ERP data standalone (when no verification yet but ERP data exists) */}
        {!esBlind && !verificacion && erpData && cierre.estado !== 'abierta' && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-indigo-700">Datos del ERP (Centum)</h3>
            <p className="text-xs text-indigo-400">
              Planilla #{erpData.planilla_id} — {erpData.nombre_cajero} {erpData.cerrada ? '(cerrada)' : '(abierta)'}
            </p>
            {erpData.medios_pago.map(mp => (
              <div key={mp.valor_id} className="flex justify-between text-sm py-0.5">
                <span className="text-gray-600">{mp.nombre} ({mp.operaciones} ops)</span>
                <span className="text-gray-800 font-medium">{formatMonto(mp.total)}</span>
              </div>
            ))}
            <div className="border-t border-indigo-200 pt-2 flex justify-between font-bold text-sm">
              <span>Total ERP</span>
              <span className="text-indigo-700">{formatMonto(erpData.total_general)}</span>
            </div>
          </div>
        )}

        {/* Botón verificar para gestor/admin si aún no verificado */}
        {(esGestor || esAdmin) && cierre.estado === 'pendiente_gestor' && !esBlind && (
          <Link
            to={`/cajas/verificar/${cierre.id}`}
            className="block w-full bg-emerald-600 hover:bg-emerald-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
          >
            Verificar cierre
          </Link>
        )}

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
