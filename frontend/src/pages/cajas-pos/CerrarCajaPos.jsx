// Cierre de caja POS — layout desktop 2 columnas (billetes | medios)
import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'
import { imprimirCierre } from '../../utils/imprimirComprobante'
import ModalRetiroPos from '../../components/cajas-pos/ModalRetiroPos'
import ModalGastoPos from '../../components/cajas-pos/ModalGastoPos'
import { useAuth } from '../../context/AuthContext'

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
          className="campo-form text-sm"
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
          className="campo-form text-sm"
          placeholder="0"
        />
      </div>
    </div>
  </div>
)

const CerrarCajaPos = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { esAdmin } = useAuth()
  const modoEdicion = location.pathname.endsWith('/editar')
  const [cierre, setCierre] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  // Cupones MP (informativo)
  const [cuponesMP, setCuponesMP] = useState({ posnet: 0, qr: 0, problema: 0 })

  // Retiros del turno
  const [retiros, setRetiros] = useState([])
  const [mostrarRetiro, setMostrarRetiro] = useState(false)

  // Gastos del turno
  const [gastos, setGastos] = useState([])
  const [mostrarGasto, setMostrarGasto] = useState(false)

  // API-driven denominations and payment methods
  const [denomBilletes, setDenomBilletes] = useState([])
  const [denomMonedas] = useState([])
  const [formasCobro, setFormasCobro] = useState([])

  // Efectivo
  const [billetes, setBilletes] = useState({})
  const [monedas, setMonedas] = useState({})

  // Cambio que queda en caja
  const [cambioBilletes, setCambioBilletes] = useState({})

  // Otros medios (keyed by forma_cobro id)
  const [mediosPago, setMediosPago] = useState({})
  const [observaciones, setObservaciones] = useState('')

  // Codigo de empleado que cierra
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null)
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      try {
        const [cierreRes, denomRes, formasRes, retirosRes, gastosRes, posVentasRes] = await Promise.all([
          api.get(`/api/cierres-pos/${id}`),
          api.get('/api/denominaciones'),
          api.get('/api/formas-cobro'),
          api.get(`/api/cierres-pos/${id}/retiros`).catch(() => ({ data: [] })),
          api.get(`/api/cierres-pos/${id}/gastos`).catch(() => ({ data: [] })),
          api.get(`/api/cierres-pos/${id}/pos-ventas`).catch(() => ({ data: { medios_pago: [] } })),
        ])

        setRetiros(retirosRes.data || [])
        setGastos(gastosRes.data || [])

        // Calcular cupones MP desde detalle de ventas
        let posnet = 0, qr = 0, problema = 0
        const detalleVentas = posVentasRes.data?.detalle_ventas || []
        detalleVentas.forEach(v => {
          (v.pagos || []).forEach(p => {
            if (p.detalle?.mp_problema) {
              problema++
            } else if (p.tipo === 'QR MP') {
              qr++
            } else if (p.tipo === 'Posnet MP') {
              posnet++
            }
          })
        })
        setCuponesMP({ posnet, qr, problema })

        const cierreData = cierreRes.data
        setCierre(cierreData)
        if (modoEdicion) {
          if (cierreData.estado !== 'pendiente_gestor') {
            setError('Este cierre ya fue verificado y no se puede editar')
          }
        } else if (cierreData.estado !== 'abierta') {
          setError('Esta caja ya fue cerrada')
        }

        // Filter active, split by tipo, sort by orden
        const denomActivas = (denomRes.data || []).filter(d => d.activo)
        setDenomBilletes(
          denomActivas.filter(d => d.tipo === 'billete').sort((a, b) => a.orden - b.orden)
        )
        // Filter active formas de cobro, sorted by orden
        const formasActivas = (formasRes.data || [])
          .filter(f => f.activo)
          .sort((a, b) => a.orden - b.orden)
        setFormasCobro(formasActivas)

        // Initialize mediosPago state for each forma de cobro
        const mediosInit = {}
        formasActivas.forEach(f => {
          mediosInit[f.id] = { monto: 0, cantidad: 0 }
        })
        setMediosPago(mediosInit)

        // Pre-cargar datos existentes en modo edicion
        if (modoEdicion && cierreData.estado === 'pendiente_gestor') {
          if (cierreData.billetes) {
            const billetesInit = {}
            Object.entries(cierreData.billetes).forEach(([val, cant]) => {
              billetesInit[Number(val)] = cant
            })
            setBilletes(billetesInit)
          }
          if (cierreData.monedas) {
            const monedasInit = {}
            Object.entries(cierreData.monedas).forEach(([val, cant]) => {
              monedasInit[Number(val)] = cant
            })
            setMonedas(monedasInit)
          }
          if (cierreData.cambio_billetes) {
            const cambioInit = {}
            Object.entries(cierreData.cambio_billetes).forEach(([val, cant]) => {
              cambioInit[Number(val)] = cant
            })
            setCambioBilletes(cambioInit)
          }
          if (cierreData.observaciones) {
            setObservaciones(cierreData.observaciones)
          }
          if (Array.isArray(cierreData.medios_pago)) {
            const mediosEdit = { ...mediosInit }
            cierreData.medios_pago.forEach(mp => {
              if (mediosEdit[mp.forma_cobro_id] !== undefined) {
                mediosEdit[mp.forma_cobro_id] = { monto: mp.monto || 0, cantidad: mp.cantidad || 0 }
              }
            })
            setMediosPago(mediosEdit)
          }
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar datos')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

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
    setEnviando(true)
    setError('')
    try {
      // Build billetes payload: { "20000": 2, "10000": 5, ... }
      const billetesPayload = {}
      denomBilletes.forEach(d => {
        const cant = billetes[d.valor] || 0
        if (cant > 0) billetesPayload[String(d.valor)] = cant
      })

      // Build monedas payload: { "500": 1, "100": 3, ... }
      const monedasPayload = {}
      denomMonedas.forEach(d => {
        const cant = monedas[d.valor] || 0
        if (cant > 0) monedasPayload[String(d.valor)] = cant
      })

      // Build medios_pago array (only entries with monto > 0)
      const mediosPagoPayload = formasCobro
        .filter(f => (mediosPago[f.id]?.monto || 0) > 0)
        .map(f => ({
          forma_cobro_id: f.id,
          nombre: f.nombre,
          monto: mediosPago[f.id].monto,
          cantidad: mediosPago[f.id].cantidad,
        }))

      // Build cambio billetes payload
      const cambioBilletesPayload = {}
      denomBilletes.forEach(d => {
        const cant = cambioBilletes[d.valor] || 0
        if (cant > 0) cambioBilletesPayload[String(d.valor)] = cant
      })

      const payload = {
        billetes: billetesPayload,
        monedas: monedasPayload,
        total_efectivo: totalEfectivo,
        medios_pago: mediosPagoPayload,
        total_general: totalGeneral,
        observaciones,
        cambio_billetes: cambioBilletesPayload,
        cambio_monedas: {},
        cambio_que_queda: cambioQueQueda,
        efectivo_retirado: efectivoRetirado,
        codigo_empleado: codigoEmpleado.trim(),
      }

      if (modoEdicion) {
        await api.put(`/api/cierres-pos/${id}/editar-conteo`, payload)
        navigate('/cajas-pos')
      } else {
        const { data: cierreActualizado } = await api.put(`/api/cierres-pos/${id}/cerrar`, payload)

        // Fetch retiros, gastos y denominaciones para imprimir
        const [retirosRes, gastosRes, denomRes] = await Promise.all([
          api.get(`/api/cierres-pos/${id}/retiros`).catch(() => ({ data: [] })),
          api.get(`/api/cierres-pos/${id}/gastos`).catch(() => ({ data: [] })),
          api.get('/api/denominaciones').catch(() => ({ data: [] })),
        ])
        imprimirCierre(cierreActualizado, retirosRes.data || [], denomRes.data || [], gastosRes.data || [])

        navigate(`/cajas-pos/cierre/${id}`)
      }
    } catch (err) {
      setError(err.response?.data?.error || (modoEdicion ? 'Error al guardar cambios' : 'Error al cerrar caja'))
    } finally {
      setEnviando(false)
    }
  }

  const titulo = modoEdicion ? 'Editar Cierre POS' : 'Cerrar Caja POS'
  const volverA = modoEdicion ? `/cajas-pos/cierre/${id}` : '/cajas-pos'

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo={titulo} sinTabs volverA={volverA} />
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
        </div>
      </div>
    )
  }

  if (error && !cierre) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar titulo={titulo} sinTabs volverA={volverA} />
        <div className="px-4 py-10 text-center">
          <p className="text-red-600 text-sm">{error}</p>
          <Link to={volverA} className="text-sm text-teal-600 mt-4 inline-block">Volver</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo={titulo} sinTabs volverA={volverA} />

      <div className="px-4 py-4 max-w-5xl mx-auto">

        {/* Header: info de la caja + total efectivo */}
        <div className="flex items-center justify-between bg-teal-50 border border-teal-200 rounded-xl p-3 mb-4">
          <div className="text-sm text-teal-800">
            <p className="font-semibold">Sesion POS</p>
            <p>Caja: {cierre.caja?.nombre || '-'} · Empleado: {cierre.empleado?.nombre || '-'} · {formatFecha(cierre.fecha)} · Apertura: {formatHora(cierre.apertura_at)} · Cambio: {formatMonto(cierre.fondo_fijo)}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-teal-600">Total efectivo</span>
            <p className="text-lg font-bold text-teal-700">{formatMonto(totalEfectivo)}</p>
          </div>
        </div>

        {/* Efectivo (billetes) */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Efectivo</h3>
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

        {/* Otros medios de pago + Observaciones */}
        <div className="space-y-3 mb-6">
          <h3 className="text-sm font-medium text-gray-500">Otros medios de pago</h3>
          <div className="grid grid-cols-3 gap-3">
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
              className="campo-form text-sm"
              rows={2}
              placeholder="Observaciones opcionales..."
            />
          </div>
        </div>

        {/* Cupones Mercado Pago (informativo) */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 mb-4 flex items-center gap-6">
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
          {cuponesMP.problema > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-amber-700">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Problema: <strong>{cuponesMP.problema}</strong></span>
            </div>
          )}
        </div>

        {/* Retiro de alivio + retiros existentes */}
        {!modoEdicion && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
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
        )}

        {modoEdicion && retiros.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-800 font-medium">
                Retiros durante el turno: {retiros.length}
              </span>
              <span className="text-blue-800 font-bold">
                Total: {formatMonto(retiros.reduce((s, r) => s + parseFloat(r.total || 0), 0))}
              </span>
            </div>
          </div>
        )}

        {/* Gastos del turno */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4">
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

        {/* Cambio que queda en caja */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-amber-800 mb-3">Cambio que queda en caja</h3>
          <div className="grid grid-cols-1 gap-2">
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
              <span className="font-bold text-teal-700">{formatMonto(efectivoRetirado)}</span>
            </div>
          </div>
        </div>

        {/* Resumen + boton confirmar — ancho completo */}
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-teal-800 mb-2">Resumen del cierre</h3>
          <div className="flex gap-6 text-sm">
            <div className="flex gap-2 text-gray-600">
              <span>Apertura:</span>
              <span className="font-medium">{formatHora(cierre.apertura_at)}</span>
            </div>
            <div className="flex gap-2 text-gray-600">
              <span>Cambio inicial:</span>
              <span className="font-medium">{formatMonto(cierre.fondo_fijo)}</span>
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
            <div className="flex gap-2 text-teal-800 font-bold ml-auto">
              <span>Total general:</span>
              <span>{formatMonto(totalGeneral)}</span>
            </div>
          </div>
        </div>

        {/* Codigo de empleado que cierra (admins exentos) */}
        {!esAdmin && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
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
            className={`campo-form text-sm ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : ''}`}
          />
          {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
          {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
          {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
        </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded-xl mb-4">{error}</p>
        )}

        <button
          onClick={cerrarCaja}
          disabled={enviando}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition-colors"
        >
          {enviando
            ? (modoEdicion ? 'Guardando...' : 'Cerrando...')
            : (modoEdicion ? 'Guardar cambios' : 'Confirmar cierre')
          }
        </button>
      </div>

      {/* Modal retiro */}
      {mostrarRetiro && (
        <ModalRetiroPos
          cierreId={id}
          cierre={cierre}
          onClose={() => setMostrarRetiro(false)}
          onRetiroCreado={(nuevoRetiro) => {
            setRetiros(prev => [...prev, nuevoRetiro])
          }}
        />
      )}

      {/* Modal gasto */}
      {mostrarGasto && (
        <ModalGastoPos
          cierreId={id}
          cierre={cierre}
          gastosExistentes={gastos}
          onClose={() => setMostrarGasto(false)}
          onGastoCreado={(nuevoGasto) => {
            setGastos(prev => [...prev, nuevoGasto])
          }}
        />
      )}
    </div>
  )
}

export default CerrarCajaPos
