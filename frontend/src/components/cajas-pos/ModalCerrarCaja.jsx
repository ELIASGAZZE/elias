// Modal para cierre de caja POS — se abre inline sin salir del POS
import React, { useState, useEffect, useMemo, useRef } from 'react'
import ContadorDenominacion from '../cajas/ContadorDenominacion'
import ModalRetiroPos from './ModalRetiroPos'
import ModalGastoPos from './ModalGastoPos'
import api from '../../services/api'
import { imprimirCierre } from '../../utils/imprimirComprobante'
import { useAuth } from '../../context/AuthContext'

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const formatHora = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const CampoMedio = ({ label, monto, onMontoChange, cantidad, onCantidadChange }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
    <span className="text-sm font-medium text-gray-700">{label}</span>
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="text-xs text-gray-400">Monto total</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={monto || ''}
          onChange={(e) => onMontoChange(parseFloat(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="$0.00"
        />
      </div>
      <div className="w-24">
        <label className="text-xs text-gray-400">Cantidad</label>
        <input
          type="number"
          min="0"
          value={cantidad || ''}
          onChange={(e) => onCantidadChange(parseInt(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="0"
        />
      </div>
    </div>
  </div>
)

const ModalCerrarCaja = ({ cierreId, onClose, onCajaCerrada }) => {
  const { esAdmin } = useAuth()
  const [cierre, setCierre] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Cupones MP (informativo)
  const [cuponesMP, setCuponesMP] = useState({ posnet: 0, qr: 0, problema: 0, anulaciones: 0 })

  // Retiros y gastos del turno
  const [retiros, setRetiros] = useState([])
  const [mostrarRetiro, setMostrarRetiro] = useState(false)
  const [gastos, setGastos] = useState([])
  const [mostrarGasto, setMostrarGasto] = useState(false)


  // Denominaciones y formas de cobro
  const [denomBilletes, setDenomBilletes] = useState([])
  const [formasCobro, setFormasCobro] = useState([])

  // Efectivo
  const [billetes, setBilletes] = useState({})

  // Cambio que queda en caja
  const [cambioBilletes, setCambioBilletes] = useState({})

  // Otros medios
  const [mediosPago, setMediosPago] = useState({})
  const [observaciones, setObservaciones] = useState('')

  // Codigo de empleado
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null)
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)

  // Chequeo pedidos pendientes (solo cierre PM — último del día)
  const [pedidosPendientesPM, setPedidosPendientesPM] = useState([])
  const [mostrarCheckPendientes, setMostrarCheckPendientes] = useState(false)
  const checkPendientesListoRef = useRef(false)
  const respuestaPendientesRef = useRef(null) // 'si' | 'no'

  useEffect(() => {
    const cargar = async () => {
      try {
        const [cierreRes, denomRes, formasRes, retirosRes, gastosRes, posVentasRes] = await Promise.all([
          api.get(`/api/cierres-pos/${cierreId}`),
          api.get('/api/denominaciones'),
          api.get('/api/formas-cobro'),
          api.get(`/api/cierres-pos/${cierreId}/retiros`).catch(() => ({ data: [] })),
          api.get(`/api/cierres-pos/${cierreId}/gastos`).catch(() => ({ data: [] })),
          api.get(`/api/cierres-pos/${cierreId}/pos-ventas`).catch(() => ({ data: { medios_pago: [] } })),
        ])

        setRetiros(retirosRes.data || [])
        setGastos(gastosRes.data || [])

        // Calcular cupones MP desde detalle de ventas
        let posnet = 0, qr = 0, problema = 0, anulaciones = 0
        const detalleVentas = posVentasRes.data?.detalle_ventas || []
        detalleVentas.forEach(v => {
          const esNC = v.tipo === 'nota_credito'
          ;(v.pagos || []).forEach(p => {
            const esMPTipo = p.tipo === 'QR MP' || p.tipo === 'Posnet MP'
            if (esNC && esMPTipo) {
              anulaciones++
            } else if (p.detalle?.mp_problema) {
              problema++
            } else if (p.tipo === 'QR MP') {
              qr++
            } else if (p.tipo === 'Posnet MP') {
              posnet++
            }
          })
        })
        setCuponesMP({ posnet, qr, problema, anulaciones })

        const cierreData = cierreRes.data
        setCierre(cierreData)
        if (cierreData.estado !== 'abierta') {
          setError('Esta caja ya fue cerrada')
        }

        const denomActivas = (denomRes.data || []).filter(d => d.activo)
        setDenomBilletes(
          denomActivas.filter(d => d.tipo === 'billete').sort((a, b) => a.orden - b.orden)
        )

        const formasActivas = (formasRes.data || [])
          .filter(f => f.activo)
          .sort((a, b) => a.orden - b.orden)
        setFormasCobro(formasActivas)

        const mediosInit = {}
        formasActivas.forEach(f => {
          mediosInit[f.id] = { monto: 0, cantidad: 0 }
        })
        setMediosPago(mediosInit)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar datos')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [cierreId])

  const totalBilletes = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetes[d.valor] || 0), 0),
    [denomBilletes, billetes]
  )

  const totalEfectivo = totalBilletes

  const cambioQueQueda = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (cambioBilletes[d.valor] || 0), 0),
    [denomBilletes, cambioBilletes]
  )
  const efectivoRetirado = totalEfectivo - cambioQueQueda

  const totalOtrosMedios = useMemo(
    () => Object.values(mediosPago).reduce((sum, m) => sum + (m.monto || 0), 0),
    [mediosPago]
  )

  const totalGeneral = totalEfectivo + totalOtrosMedios

  const actualizarMedio = (formaId, campo, valor) => {
    setMediosPago(prev => ({
      ...prev,
      [formaId]: { ...prev[formaId], [campo]: valor },
    }))
  }

  const validarCodigoEmpleado = async () => {
    const codigo = codigoEmpleado.trim()
    if (!codigo) {
      setEmpleadoResuelto(null)
      setErrorEmpleado('')
      return
    }
    setValidandoEmpleado(true)
    setErrorEmpleado('')
    try {
      const { data } = await api.get(`/api/empleados/por-codigo/${encodeURIComponent(codigo)}`)
      setEmpleadoResuelto(data)
      setErrorEmpleado('')
    } catch {
      setEmpleadoResuelto(null)
      setErrorEmpleado('Codigo no valido')
    } finally {
      setValidandoEmpleado(false)
    }
  }

  const cerrarCaja = async () => {
    if (!esAdmin && !empleadoResuelto) {
      setError('Ingresa un codigo de empleado valido')
      return
    }

    // Chequeo pedidos pendientes (solo cuando es cierre PM — último del día)
    if (!checkPendientesListoRef.current) {
      try {
        const { data } = await api.get(`/api/cierres-pos/${cierreId}/pedidos-pendientes-pm`)
        if (data.es_pm && (data.pedidos || []).length > 0) {
          setPedidosPendientesPM(data.pedidos)
          setMostrarCheckPendientes(true)
          return
        }
      } catch (err) {
        // No bloquear cierre si falla el chequeo — log silencioso
        console.warn('No se pudo verificar pedidos pendientes:', err?.message)
      }
      checkPendientesListoRef.current = true
    }

    setEnviando(true)
    setError('')
    try {
      const billetesPayload = {}
      denomBilletes.forEach(d => {
        const cant = billetes[d.valor] || 0
        if (cant > 0) billetesPayload[String(d.valor)] = cant
      })

      const mediosPagoPayload = formasCobro
        .filter(f => (mediosPago[f.id]?.monto || 0) > 0)
        .map(f => ({
          forma_cobro_id: f.id,
          nombre: f.nombre,
          monto: mediosPago[f.id].monto,
          cantidad: mediosPago[f.id].cantidad,
        }))

      const cambioBilletesPayload = {}
      denomBilletes.forEach(d => {
        const cant = cambioBilletes[d.valor] || 0
        if (cant > 0) cambioBilletesPayload[String(d.valor)] = cant
      })

      // Anexar respuesta del chequeo de pedidos pendientes a observaciones
      let observacionesFinal = observaciones
      if (respuestaPendientesRef.current && pedidosPendientesPM.length > 0) {
        const nums = pedidosPendientesPM.map(p => `#${p.numero}`).join(', ')
        const linea = respuestaPendientesRef.current === 'si'
          ? `[Cierre PM] Pedidos pendientes no entregados (${pedidosPendientesPM.length}): ${nums}`
          : `[Cierre PM] Operador confirmó que los pedidos ${nums} ya fueron entregados (quedaron marcados pendientes por error).`
        observacionesFinal = observacionesFinal ? `${observacionesFinal}\n${linea}` : linea
      }

      const payload = {
        billetes: billetesPayload,
        monedas: {},
        total_efectivo: totalEfectivo,
        medios_pago: mediosPagoPayload,
        total_general: totalGeneral,
        observaciones: observacionesFinal,
        cambio_billetes: cambioBilletesPayload,
        cambio_monedas: {},
        cambio_que_queda: cambioQueQueda,
        efectivo_retirado: efectivoRetirado,
        codigo_empleado: codigoEmpleado.trim(),
      }

      const { data: cierreActualizado } = await api.put(`/api/cierres-pos/${cierreId}/cerrar`, payload)

      // Imprimir cierre
      const [retirosRes, gastosRes, denomRes] = await Promise.all([
        api.get(`/api/cierres-pos/${cierreId}/retiros`).catch(() => ({ data: [] })),
        api.get(`/api/cierres-pos/${cierreId}/gastos`).catch(() => ({ data: [] })),
        api.get('/api/denominaciones').catch(() => ({ data: [] })),
      ])
      imprimirCierre(cierreActualizado, retirosRes.data || [], denomRes.data || [], gastosRes.data || [])

      if (onCajaCerrada) onCajaCerrada()
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cerrar caja')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-violet-700 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-semibold text-base">Cerrar Caja</h2>
          <button onClick={onClose} className="text-violet-200 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cargando ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
            </div>
          ) : (
            <>
              {/* Info sesion */}
              {cierre && (
                <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-xl p-3">
                  <div className="text-sm text-violet-800">
                    <p className="font-semibold">Sesion POS</p>
                    <p>Caja: {cierre.caja?.nombre || '-'} · Empleado: {cierre.empleado?.nombre || '-'} · {formatFecha(cierre.fecha)} · Apertura: {formatHora(cierre.apertura_at)} · Cambio: {formatMonto(cierre.fondo_fijo)}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-violet-600">Total efectivo</span>
                    <p className="text-lg font-bold text-violet-700">{formatMonto(totalEfectivo)}</p>
                  </div>
                </div>
              )}

              {/* Cupones Mercado Pago (informativo) */}
              <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-center gap-6">
                <span className="text-sm font-medium text-sky-800">Cupones Mercado Pago</span>
                <div className="flex items-center gap-1.5 text-sm text-sky-700">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  <span>Posnet: <strong>{cuponesMP.posnet}</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-sky-700">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                  <span>QR: <strong>{cuponesMP.qr}</strong></span>
                </div>
                {cuponesMP.anulaciones > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-700">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                    <span>Anulaciones: <strong>{cuponesMP.anulaciones}</strong></span>
                  </div>
                )}
                {cuponesMP.problema > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-700">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>Problema: <strong>{cuponesMP.problema}</strong></span>
                  </div>
                )}
              </div>

              {/* Retiros */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-blue-800 font-medium">
                      Retiros durante el turno: {retiros.length}
                    </span>
                    {retiros.length > 0 && (
                      <span className="text-blue-800 font-bold ml-2">
                        ({formatMonto(retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0))})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setMostrarRetiro(true)}
                    className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Nuevo retiro
                  </button>
                </div>
              </div>

              {/* Gastos */}
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-orange-800 font-medium">
                      Gastos durante el turno: {gastos.length}
                    </span>
                    {gastos.length > 0 && (
                      <span className="text-orange-800 font-bold ml-2">
                        ({formatMonto(gastos.reduce((s, g) => s + parseFloat(g.importe || 0), 0))})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setMostrarGasto(true)}
                    className="text-sm bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    Nuevo gasto
                  </button>
                </div>
                {gastos.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {gastos.map(g => (
                      <div key={g.id} className="flex items-center justify-between text-xs text-orange-700 bg-white/60 rounded-lg px-2 py-1">
                        <span className="truncate flex-1">{g.descripcion}</span>
                        <span className="font-medium ml-2 whitespace-nowrap">{formatMonto(g.importe)}</span>
                        <button
                          onClick={async () => {
                            if (!confirm(`¿Eliminar gasto "${g.descripcion}"?`)) return
                            try {
                              await api.delete(`/api/gastos-pos/${g.id}`)
                              setGastos(prev => prev.filter(x => x.id !== g.id))
                            } catch (err) {
                              setError(err.response?.data?.error || 'Error al eliminar gasto')
                            }
                          }}
                          className="ml-2 text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                          title="Eliminar gasto"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Efectivo (billetes) */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Efectivo a retirar</h3>
                <div className="space-y-1.5">
                  {denomBilletes.map(d => (
                    <ContadorDenominacion
                      key={`b-${d.id}`}
                      valor={d.valor}
                      cantidad={billetes[d.valor] || 0}
                      onChange={(val) => setBilletes(prev => ({ ...prev, [d.valor]: val }))}
                    />
                  ))}
                </div>
                <div className="text-right mt-2">
                  <span className="text-sm font-medium text-gray-600">Subtotal: {formatMonto(totalBilletes)}</span>
                </div>
              </div>

              {/* Otros medios de pago */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-500">Otros medios de pago</h3>
                <div className="grid grid-cols-2 gap-3">
                  {formasCobro.map(f => (
                    <CampoMedio
                      key={f.id}
                      label={f.nombre}
                      monto={mediosPago[f.id]?.monto || 0}
                      onMontoChange={(val) => actualizarMedio(f.id, 'monto', val)}
                      cantidad={mediosPago[f.id]?.cantidad || 0}
                      onCantidadChange={(val) => actualizarMedio(f.id, 'cantidad', val)}
                    />
                  ))}
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Observaciones</label>
                  <textarea
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    rows={2}
                    placeholder="Observaciones opcionales..."
                  />
                </div>
              </div>

              {/* Cambio que queda en caja */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-3">Cambio que queda en caja</h3>
                <div className="space-y-1.5">
                  {denomBilletes.map(d => (
                    <ContadorDenominacion
                      key={`cb-${d.id}`}
                      valor={d.valor}
                      cantidad={cambioBilletes[d.valor] || 0}
                      onChange={(val) => setCambioBilletes(prev => ({ ...prev, [d.valor]: val }))}
                    />
                  ))}
                </div>
                <div className="mt-3 flex gap-4 text-sm">
                  <div className="flex-1 bg-white border border-amber-200 rounded-lg p-2 text-center">
                    <span className="text-xs text-gray-500 block">Cambio que queda</span>
                    <span className="font-bold text-amber-700">{formatMonto(cambioQueQueda)}</span>
                  </div>
                  <div className="flex-1 bg-white border border-amber-200 rounded-lg p-2 text-center">
                    <span className="text-xs text-gray-500 block">Efectivo retirado</span>
                    <span className="font-bold text-violet-700">{formatMonto(efectivoRetirado)}</span>
                  </div>
                </div>
              </div>

              {/* Resumen */}
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-violet-800 mb-2">Resumen del cierre</h3>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex gap-2 text-gray-600">
                    <span>Apertura:</span>
                    <span className="font-medium">{cierre && formatHora(cierre.apertura_at)}</span>
                  </div>
                  <div className="flex gap-2 text-gray-600">
                    <span>Cambio inicial:</span>
                    <span className="font-medium">{cierre && formatMonto(cierre.fondo_fijo)}</span>
                  </div>
                  <div className="flex gap-2 text-gray-600">
                    <span>Total efectivo:</span>
                    <span className="font-medium">{formatMonto(totalEfectivo)}</span>
                  </div>
                  {totalOtrosMedios > 0 && (
                    <div className="flex gap-2 text-gray-600">
                      <span>Otros medios:</span>
                      <span className="font-medium">{formatMonto(totalOtrosMedios)}</span>
                    </div>
                  )}
                  <div className="flex gap-2 text-amber-700">
                    <span>Cambio queda:</span>
                    <span className="font-medium">{formatMonto(cambioQueQueda)}</span>
                  </div>
                  <div className="flex gap-2 text-gray-600">
                    <span>Retirado:</span>
                    <span className="font-medium">{formatMonto(efectivoRetirado)}</span>
                  </div>
                  <div className="flex gap-2 text-violet-800 font-bold ml-auto">
                    <span>Total general:</span>
                    <span>{formatMonto(totalGeneral)}</span>
                  </div>
                </div>
              </div>

              {/* Codigo empleado (admins exentos) */}
              {!esAdmin && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Codigo de empleado que cierra</label>
                <input
                  type="text"
                  value={codigoEmpleado}
                  onChange={(e) => {
                    setCodigoEmpleado(e.target.value)
                    setEmpleadoResuelto(null)
                    setErrorEmpleado('')
                  }}
                  onBlur={validarCodigoEmpleado}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); validarCodigoEmpleado() } }}
                  placeholder="Ingresa el codigo"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : 'border-gray-300'}`}
                />
                {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
                {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
                {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
              </div>
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Footer fijo */}
        {!cargando && (
          <div className="border-t border-gray-200 p-4 flex-shrink-0">
            <button
              onClick={cerrarCaja}
              disabled={enviando}
              className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
            >
              {enviando ? 'Cerrando...' : 'Confirmar cierre'}
            </button>
          </div>
        )}
      </div>

      {/* Sub-modales de retiro y gasto */}
      {mostrarRetiro && (
        <ModalRetiroPos
          cierreId={cierreId}
          cierre={cierre}
          onClose={() => setMostrarRetiro(false)}
          onRetiroCreado={(nuevoRetiro) => {
            setRetiros(prev => [...prev, nuevoRetiro])
          }}
        />
      )}

      {mostrarGasto && (
        <ModalGastoPos
          cierreId={cierreId}
          cierre={cierre}
          gastosExistentes={gastos}
          onClose={() => setMostrarGasto(false)}
          onGastoCreado={(nuevoGasto) => {
            setGastos(prev => [...prev, nuevoGasto])
          }}
        />
      )}

      {/* Popup chequeo pedidos pendientes PM */}
      {mostrarCheckPendientes && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
            <div className="bg-amber-500 px-5 py-3">
              <h3 className="text-white font-semibold text-base flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Pedidos pendientes
              </h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700 font-medium">
                ¿Estos pedidos no fueron entregados aún?
              </p>
              <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {pedidosPendientesPM.map(p => (
                  <div key={p.id} className="px-3 py-2 flex items-center justify-between text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">#{p.numero}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 uppercase">{p.tipo}</span>
                        {p.turno_entrega && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{p.turno_entrega}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 truncate">
                        {p.nombre_cliente || 'Sin cliente'} · {formatFecha(p.fecha_entrega)}
                      </div>
                    </div>
                    <span className="text-sm font-medium text-gray-700 ml-2 whitespace-nowrap">
                      {formatMonto(p.total_pagado || 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-gray-200 px-5 py-3 flex gap-3">
              <button
                onClick={() => {
                  respuestaPendientesRef.current = 'no'
                  checkPendientesListoRef.current = true
                  setMostrarCheckPendientes(false)
                  setTimeout(() => cerrarCaja(), 0)
                }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 py-2.5 rounded-xl font-medium transition-colors"
              >
                No
              </button>
              <button
                onClick={() => {
                  respuestaPendientesRef.current = 'si'
                  checkPendientesListoRef.current = true
                  setMostrarCheckPendientes(false)
                  setTimeout(() => cerrarCaja(), 0)
                }}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl font-medium transition-colors"
              >
                Sí
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ModalCerrarCaja
