// Punto de Venta — POS con motor de promociones local
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import ModalCobrar from '../../components/pos/ModalCobrar'
import ModalVentaEmpleado from '../../components/pos/ModalVentaEmpleado'
import PedidosPOS from './PedidosPOS'
import SaldosPOS from './SaldosPOS'
import GiftCardsPOS from './GiftCardsPOS'
import ConsultaPOS from '../../components/pos/ConsultaPOS'
import NuevoClienteModal from '../../components/NuevoClienteModal'
import EditarClienteModal from '../../components/EditarClienteModal'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import TecladoVirtual from '../../components/pos/TecladoVirtual'
import api, { isNetworkError } from '../../services/api'
import useOnlineStatus from '../../hooks/useOnlineStatus'
import { guardarArticulos, getArticulos, guardarPromociones, getPromociones, guardarClientes, getClientes } from '../../services/offlineDB'
import { syncVentasPendientes } from '../../services/offlineSync'
import { imprimirTicketDevolucion } from '../../utils/imprimirComprobante'
import ActualizacionesPOS from '../../components/pos/ActualizacionesPOS'
import ModalCerrarCaja from '../../components/cajas-pos/ModalCerrarCaja'

import { calcularPromocionesLocales, calcularPrecioConDescuentosBase, formatPrecio } from './utils/promotionEngine'
import useProblemaWizard from './hooks/useProblemaWizard'
import ProblemaModal from './components/ProblemaModal'
import { usePedidoWizard } from './hooks/usePedidoWizard'
import PedidoWizardModal from './components/PedidoWizardModal'
// Paleta de colores para tiles por rubro
const TILE_COLORS = [
  { border: '#3B82F6', bg: '#EFF6FF', tab: '#3B82F6' },
  { border: '#10B981', bg: '#ECFDF5', tab: '#10B981' },
  { border: '#8B5CF6', bg: '#F5F3FF', tab: '#8B5CF6' },
  { border: '#F59E0B', bg: '#FFFBEB', tab: '#F59E0B' },
  { border: '#EC4899', bg: '#FDF2F8', tab: '#EC4899' },
  { border: '#14B8A6', bg: '#F0FDFA', tab: '#14B8A6' },
  { border: '#F97316', bg: '#FFF7ED', tab: '#F97316' },
  { border: '#6366F1', bg: '#EEF2FF', tab: '#6366F1' },
  { border: '#EF4444', bg: '#FEF2F2', tab: '#EF4444' },
  { border: '#06B6D4', bg: '#ECFEFF', tab: '#06B6D4' },
]

// ============ CONFIGURACIÓN TERMINAL POS ============
const TERMINAL_KEY = 'pos_terminal_config'

function getTerminalConfig() {
  try {
    return JSON.parse(localStorage.getItem(TERMINAL_KEY))
  } catch { return null }
}

function saveTerminalConfig(config) {
  localStorage.setItem(TERMINAL_KEY, JSON.stringify(config))
}

// Pantalla de configuración inicial del terminal (solo admin)
const ConfigurarTerminal = ({ onConfigurar, configActual }) => {
  const [sucursales, setSucursales] = useState([])
  const [cajas, setCajas] = useState([])
  const [sucursalId, setSucursalId] = useState(configActual?.sucursal_id || '')
  const [cajaId, setCajaId] = useState(configActual?.caja_id || '')
  const [mpDevices, setMpDevices] = useState([])
  const [mpDeviceId, setMpDeviceId] = useState(configActual?.mp_device_id || '')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    api.get('/api/sucursales')
      .then(({ data }) => setSucursales(data || []))
      .catch((err) => console.error('Error cargando sucursales:', err.message))
      .finally(() => setCargando(false))
    // Cargar dispositivos MP Point
    api.get('/api/mp-point/devices')
      .then(({ data }) => {
        const devs = data.devices || data || []
        setMpDevices(Array.isArray(devs) ? devs : [])
      })
      .catch((err) => console.warn('MP Point devices no disponible:', err.message))
  }, [])

  useEffect(() => {
    if (!sucursalId) { setCajas([]); return }
    api.get('/api/cajas', { params: { sucursal_id: sucursalId } })
      .then(({ data }) => setCajas(data || []))
      .catch((err) => { console.error('Error cargando cajas:', err.message); setCajas([]) })
  }, [sucursalId])

  const sucursalSeleccionada = sucursales.find(s => s.id === sucursalId)
  const cajaSeleccionada = cajas.find(c => c.id === cajaId)

  const [cambiandoModo, setCambiandoModo] = useState(false)
  const [errorModo, setErrorModo] = useState('')
  const [qrError, setQrError] = useState('')
  const [resolviendoQr, setResolviendoQr] = useState(false)

  const confirmar = async () => {
    if (!sucursalId || !cajaId) return
    setErrorModo('')
    setQrError('')

    // Si seleccionó un posnet, cambiar a modo PDV automáticamente
    if (mpDeviceId) {
      const device = mpDevices.find(d => d.id === mpDeviceId)
      if (device && device.operating_mode !== 'PDV') {
        setCambiandoModo(true)
        try {
          const resp = await api.patch(`/api/mp-point/devices/${mpDeviceId}`, { operating_mode: 'PDV' })
          console.log('[MP Point] Modo cambiado a PDV:', resp.data)
        } catch (err) {
          const msg = err.response?.data?.message || err.response?.data?.error || err.message
          console.error('Error cambiando posnet a modo PDV:', msg, err.response?.data)
          setErrorModo(msg.includes('one pos-store') ? 'Solo 1 posnet en modo PDV por cada caja. Revisar en MP.' : `No se pudo cambiar a modo PDV: ${msg}`)
          setCambiandoModo(false)
          return // No continuar si falla el cambio de modo
        }
        setCambiandoModo(false)
      }
    }

    // Si es N950, auto-resolver QR vinculado
    let mpQrPosId = null
    if (mpDeviceId && mpDeviceId.includes('N950')) {
      setResolviendoQr(true)
      try {
        const { data } = await api.post(`/api/mp-point/devices/${mpDeviceId}/resolve-qr`)
        mpQrPosId = data.external_id
        console.log(`[MP QR] Resuelto: ${mpQrPosId} (auto_assigned: ${data.auto_assigned})`)
      } catch (err) {
        const msg = err.response?.data?.error || err.message
        console.error('Error resolviendo QR:', msg)
        setQrError(msg)
        setResolviendoQr(false)
        return
      }
      setResolviendoQr(false)
    }

    onConfigurar({
      sucursal_id: sucursalId,
      sucursal_nombre: sucursalSeleccionada?.nombre || '',
      caja_id: cajaId,
      caja_nombre: cajaSeleccionada?.nombre || '',
      punto_venta_centum: cajaSeleccionada?.punto_venta_centum || null,
      mp_device_id: mpDeviceId || null,
      mp_qr_pos_id: mpQrPosId,
    })
  }

  if (cargando) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-400">Cargando configuracion...</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-violet-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Configurar Terminal POS</h2>
          <p className="text-sm text-gray-400 mt-1">Selecciona la sucursal y caja para esta PC</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sucursal</label>
            <select
              value={sucursalId}
              onChange={e => { setSucursalId(e.target.value); setCajaId('') }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="">Seleccionar sucursal...</option>
              {sucursales.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Caja</label>
            <select
              value={cajaId}
              onChange={e => setCajaId(e.target.value)}
              disabled={!sucursalId}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">{sucursalId ? 'Seleccionar caja...' : 'Primero selecciona sucursal'}</option>
              {cajas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Posnet Mercado Pago (opcional)</label>
            {mpDevices.length > 0 ? (
              <select
                value={mpDeviceId}
                onChange={e => setMpDeviceId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              >
                <option value="">Sin posnet</option>
                {mpDevices.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.id}{d.operating_mode === 'PDV' ? ' (PDV)' : ' (Standalone)'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={mpDeviceId}
                onChange={e => setMpDeviceId(e.target.value)}
                placeholder="ID del dispositivo (ej: PAX_A910__SMARTPOS...)"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            )}
            <p className="text-xs text-gray-400 mt-1">Al guardar, el posnet se configurará automáticamente en modo PDV</p>
            {errorModo && <p className="text-xs text-red-500 mt-1 font-medium">{errorModo}</p>}
          </div>

          {mpDeviceId && mpDeviceId.includes('N950') && (
            <div>
              <p className="text-xs text-sky-600 bg-sky-50 rounded-lg px-3 py-2">La caja QR vinculada al posnet se detectará automáticamente al guardar.</p>
              {qrError && <p className="text-xs text-red-500 mt-1 font-medium">{qrError}</p>}
            </div>
          )}
        </div>

        <button
          onClick={confirmar}
          disabled={!sucursalId || !cajaId || cambiandoModo || resolviendoQr}
          className="w-full mt-6 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {cambiandoModo ? 'Configurando posnet...' : resolviendoQr ? 'Detectando caja QR...' : 'Guardar configuracion'}
        </button>

        {configActual && (
          <button
            onClick={() => onConfigurar(null)}
            className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}

// ============ PANTALLA APERTURA DE CAJA POS ============
const AbrirCajaPOS = ({ terminalConfig, onCajaAbierta }) => {
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null)
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)

  const [denomBilletes, setDenomBilletes] = useState([])
  const [billetesApertura, setBilletesApertura] = useState({})
  const [cargandoDenominaciones, setCargandoDenominaciones] = useState(true)

  const [ultimoCambio, setUltimoCambio] = useState(null)
  const [observaciones, setObservaciones] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [errorAbrir, setErrorAbrir] = useState('')

  const totalCambioInicial = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetesApertura[d.valor] || 0), 0),
    [denomBilletes, billetesApertura]
  )

  const hayUltimoCambio = ultimoCambio && Object.keys(ultimoCambio.cambio_billetes || {}).length > 0

  const tieneDiferencia = (valor) => {
    if (!hayUltimoCambio) return false
    const anterior = (ultimoCambio.cambio_billetes || {})[String(valor)] || 0
    const actual = billetesApertura[valor] || 0
    return anterior !== actual
  }

  const calcularDiferencias = () => {
    if (!hayUltimoCambio) return null
    const diffs = {}
    denomBilletes.forEach(d => {
      const anterior = (ultimoCambio.cambio_billetes || {})[String(d.valor)] || 0
      const actual = billetesApertura[d.valor] || 0
      if (anterior !== actual) {
        diffs[String(d.valor)] = { anterior, actual, tipo: 'billete' }
      }
    })
    return Object.keys(diffs).length > 0 ? diffs : null
  }

  // Sync ventas offline pendientes al montar
  useEffect(() => {
    syncVentasPendientes().then(() => actualizarPendientes()).catch(err => console.error('Error syncing pending sales:', err.message))
  }, [])

  // Cargar denominaciones y último cambio al montar
  useEffect(() => {
    Promise.all([
      api.get('/api/denominaciones'),
      api.get(`/api/cierres-pos/ultimo-cambio?caja_id=${terminalConfig.caja_id}`),
    ]).then(([denomRes, cambioRes]) => {
      const activas = (denomRes.data || []).filter(d => d.activo)
      setDenomBilletes(activas.filter(d => d.tipo === 'billete').sort((a, b) => b.valor - a.valor))
      setUltimoCambio(cambioRes.data)
    }).catch(err => {
      console.error('Error cargando datos apertura:', err)
    }).finally(() => {
      setCargandoDenominaciones(false)
    })
  }, [terminalConfig.caja_id])

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

  const abrirCaja = async (e) => {
    e.preventDefault()
    if (!empleadoResuelto) {
      setErrorAbrir('Ingresa un codigo de empleado valido')
      return
    }
    setAbriendo(true)
    setErrorAbrir('')
    try {
      const ffBilletes = {}
      denomBilletes.forEach(d => {
        const cant = billetesApertura[d.valor] || 0
        if (cant > 0) ffBilletes[String(d.valor)] = cant
      })

      const { data } = await api.post('/api/cierres-pos/abrir', {
        caja_id: terminalConfig.caja_id,
        codigo_empleado: codigoEmpleado.trim(),
        fondo_fijo: totalCambioInicial,
        fondo_fijo_billetes: ffBilletes,
        fondo_fijo_monedas: {},
        diferencias_apertura: calcularDiferencias(),
        observaciones_apertura: observaciones.trim() || null,
      })
      onCajaAbierta(data)
    } catch (err) {
      setErrorAbrir(err.response?.data?.error || 'Error al abrir caja')
    } finally {
      setAbriendo(false)
    }
  }

  const formatMonto = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)

  return (
    <div className="h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-6">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Abrir Caja</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {terminalConfig.sucursal_nombre} — {terminalConfig.caja_nombre}
          </p>
        </div>

        <form onSubmit={abrirCaja} className="space-y-4">
          {/* Código de empleado */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Codigo de empleado</label>
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
              autoFocus
              className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : 'border-gray-300'}`}
            />
            {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
            {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
            {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
          </div>

          {/* Cambio inicial — billetes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-gray-700">Cambio inicial (billetes)</h4>
              {totalCambioInicial > 0 && (
                <span className="text-sm font-bold text-violet-600">{formatMonto(totalCambioInicial)}</span>
              )}
            </div>

            {cargandoDenominaciones ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {denomBilletes.map(d => (
                    <ContadorDenominacion
                      key={`ba-${d.id}`}
                      valor={d.valor}
                      cantidad={billetesApertura[d.valor] || 0}
                      onChange={(val) => setBilletesApertura(prev => ({ ...prev, [d.valor]: val }))}
                    />
                  ))}
                </div>

                {totalCambioInicial > 0 && (
                  <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 flex justify-between items-center mt-3">
                    <span className="text-sm font-medium text-violet-800">Total cambio inicial</span>
                    <span className="text-sm font-bold text-violet-700">{formatMonto(totalCambioInicial)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Observaciones */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Observaciones (opcional)</label>
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              rows={2}
              placeholder="Notas sobre la apertura..."
            />
          </div>

          {errorAbrir && <p className="text-sm text-red-600">{errorAbrir}</p>}

          <div className="flex gap-3">
            <a
              href="/fichaje"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 border border-violet-300 text-violet-600 hover:bg-violet-50 font-medium py-3 px-4 rounded-lg transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Control asistencia
            </a>
            <button
              type="submit"
              disabled={abriendo}
              className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {abriendo ? 'Abriendo...' : 'Abrir Caja'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const POS = () => {
  const { usuario, esAdmin } = useAuth()
  const { isOnline, ventasPendientes, actualizarPendientes } = useOnlineStatus()

  // Terminal config (sucursal + caja de esta PC)
  const [terminalConfig, setTerminalConfig] = useState(() => getTerminalConfig())
  const [mostrarConfigTerminal, setMostrarConfigTerminal] = useState(false)

  // Apertura de caja obligatoria
  const [cierreActivo, setCierreActivo] = useState(null)
  const [verificandoCaja, setVerificandoCaja] = useState(true)

  function handleConfigurarTerminal(config) {
    if (config) {
      saveTerminalConfig(config)
      setTerminalConfig(config)
    }
    setMostrarConfigTerminal(false)
  }

  const necesitaConfig = !terminalConfig && !mostrarConfigTerminal

  // Verificar si la caja tiene un cierre abierto
  useEffect(() => {
    if (!terminalConfig?.caja_id) {
      setVerificandoCaja(false)
      return
    }
    let cancelled = false
    setVerificandoCaja(true)
    api.get(`/api/cierres-pos/abierta?caja_id=${terminalConfig.caja_id}`)
      .then(({ data }) => {
        if (cancelled) return
        if (data.abierta) {
          setCierreActivo(data.cierre)
          // Cachear cierre activo para modo offline
          try { localStorage.setItem('cierre_activo', JSON.stringify(data.cierre)) } catch {}
        } else {
          setCierreActivo(null)
          localStorage.removeItem('cierre_activo')
        }
      })
      .catch((err) => {
        if (cancelled) return
        // Sin internet: restaurar cierre desde cache
        if (isNetworkError(err)) {
          try {
            const cached = localStorage.getItem('cierre_activo')
            if (cached) {
              setCierreActivo(JSON.parse(cached))
              console.log('[POS] Modo offline — cierre restaurado desde cache')
            } else {
              setCierreActivo(null)
            }
          } catch { setCierreActivo(null) }
        } else {
          setCierreActivo(null)
        }
      })
      .finally(() => {
        if (!cancelled) setVerificandoCaja(false)
      })
    return () => { cancelled = true }
  }, [terminalConfig?.caja_id])

  // Estado cliente
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clienteIdx, setClienteIdx] = useState(-1)
  const [clientesCentum, setClientesCentum] = useState([])
  const [buscandoClientes, setBuscandoClientes] = useState(false)
  const [seleccionandoCliente, setSeleccionandoCliente] = useState(false)
  const [mostrarCrearClienteCaja, setMostrarCrearClienteCaja] = useState(false)
  const [mostrarEditarCliente, setMostrarEditarCliente] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)
  const [guardandoContacto, setGuardandoContacto] = useState(false)
  const CLIENTE_DEFAULT = { id_centum: 0, codigo: '', razon_social: 'Consumidor Final', lista_precio_id: 1, email: '', celular: '', condicion_iva: 'CF', grupo_descuento_id: null, grupo_descuento_nombre: null, grupo_descuento_porcentaje: 0 }
  const [descuentosGrupoRubros, setDescuentosGrupoRubros] = useState({}) // { rubroNombre: porcentaje }

  // Multi-ticket: 2 tickets en paralelo
  const [tickets, setTickets] = useState([
    { carrito: [], cliente: { ...CLIENTE_DEFAULT }, ticketUid: crypto.randomUUID() },
    { carrito: [], cliente: { ...CLIENTE_DEFAULT }, ticketUid: crypto.randomUUID() },
  ])
  const [ticketActivo, setTicketActivo] = useState(0)
  const ticketActivoRef = useRef(ticketActivo)
  ticketActivoRef.current = ticketActivo

  // Derivar carrito y cliente del ticket activo
  const carrito = tickets[ticketActivo].carrito
  const cliente = tickets[ticketActivo].cliente
  const ticketUid = tickets[ticketActivo].ticketUid
  const ticketUidRef = useRef(ticketUid)
  ticketUidRef.current = ticketUid

  // Auto-expiración: si un ticket inactivo con items no se usa en 7 min, se limpia
  const TICKET_TIMEOUT = 7 * 60 * 1000
  const ticketTimestamps = useRef([0, 0]) // última actividad por ticket

  useEffect(() => {
    // Al cambiar de ticket, marcar timestamp del que se deja
    ticketTimestamps.current[ticketActivo] = Date.now()
  }, [ticketActivo])

  useEffect(() => {
    const interval = setInterval(() => {
      const ahora = Date.now()
      setTickets(prev => {
        let changed = false
        const nuevo = prev.map((t, idx) => {
          if (idx === ticketActivoRef.current) return t // no tocar el activo
          if (t.carrito.length === 0) return t // ya vacío
          const lastActivity = ticketTimestamps.current[idx]
          if (lastActivity > 0 && ahora - lastActivity >= TICKET_TIMEOUT) {
            changed = true
            ticketTimestamps.current[idx] = 0
            return { carrito: [], cliente: { ...CLIENTE_DEFAULT }, ticketUid: crypto.randomUUID() }
          }
          return t
        })
        return changed ? nuevo : prev
      })
    }, 30000) // revisar cada 30s
    return () => clearInterval(interval)
  }, [CLIENTE_DEFAULT])

  // setCarrito/setCliente usan ref para que no cambien de identidad al cambiar de ticket
  const setCarrito = useCallback((updater) => {
    setTickets(prev => {
      const idx = ticketActivoRef.current
      ticketTimestamps.current[idx] = Date.now()
      const nuevo = [...prev]
      nuevo[idx] = {
        ...nuevo[idx],
        carrito: typeof updater === 'function' ? updater(nuevo[idx].carrito) : updater,
      }
      return nuevo
    })
  }, [])

  const setCliente = useCallback((cliOrUpdater) => {
    setTickets(prev => {
      const idx = ticketActivoRef.current
      ticketTimestamps.current[idx] = Date.now()
      const nuevo = [...prev]
      const clienteActual = nuevo[idx].cliente
      const nuevoCliente = typeof cliOrUpdater === 'function' ? cliOrUpdater(clienteActual) : cliOrUpdater
      nuevo[idx] = { ...nuevo[idx], cliente: nuevoCliente }
      return nuevo
    })
  }, [])

  // Estado artículos
  const [articulos, setArticulos] = useState([])
  const [cargandoArticulos, setCargandoArticulos] = useState(false)
  const [sincronizandoERP, setSincronizandoERP] = useState(false)
  const [busquedaArt, setBusquedaArt] = useState('')
  const [busquedaIdx, setBusquedaIdx] = useState(-1) // índice seleccionado en dropdown
  const [mostrarTeclado, setMostrarTeclado] = useState(false)
  const [carritoIdx, setCarritoIdx] = useState(-1) // índice seleccionado en carrito (-1 = no seleccionado, foco en buscador)
  const [alertaBarcode, setAlertaBarcode] = useState(null) // código no encontrado
  const [alertaDuplicado, setAlertaDuplicado] = useState(null) // duplicado (balanza o barcode)
  const ultimoBarcodaBalanzaRef = useRef(null) // último código de balanza escaneado
  const ultimoBarcodeRef = useRef({ codigo: null, time: 0 }) // último barcode normal escaneado
  const [popupPesable, setPopupPesable] = useState(null) // { articulo } — pedir peso manual
  const [popupPesableKg, setPopupPesableKg] = useState('')

  // Alarma continua con Web Audio API — suena hasta que se cierra la alerta
  const alertCtxRef = useRef(null)
  const playAlertSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.value = 880
      // Sirena: oscila entre 880 y 1200 Hz
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      lfo.frequency.value = 5
      lfoGain.gain.value = 300
      gain.gain.value = 0.5
      lfo.start()
      osc.start()
      alertCtxRef.current = ctx
    } catch {}
  }, [])

  const stopAlertSound = useCallback(() => {
    if (alertCtxRef.current) {
      alertCtxRef.current.close()
      alertCtxRef.current = null
    }
  }, [])

  // Promociones
  const [promociones, setPromociones] = useState([])
  const [cargandoPromos, setCargandoPromos] = useState(false)

  // Modal cobrar
  const [mostrarCobrar, setMostrarCobrar] = useState(false)

  // Buscador de cliente para montos altos (AFIP)
  const MONTO_LIMITE_DNI = 180000
  const [mostrarDniPopup, setMostrarDniPopup] = useState(false)
  const [busquedaDniCliente, setBusquedaDniCliente] = useState('')
  const [clientesDni, setClientesDni] = useState([])
  const [buscandoDniCliente, setBuscandoDniCliente] = useState(false)
  const [mostrarCrearClienteDni, setMostrarCrearClienteDni] = useState(false)
  const inputDniClienteRef = useRef(null)

  function handleCobrar() {
    if (mostrarCobrar) return // Prevenir doble apertura del modal
    const clienteIdentificado = (cliente.id_centum && cliente.id_centum !== 0) || (cliente.razon_social && cliente.razon_social !== 'Consumidor Final')
    if (totalConGiftCards > MONTO_LIMITE_DNI && !clienteIdentificado) {
      setBusquedaDniCliente('')
      setClientesDni([])
      setMostrarDniPopup(true)
      setTimeout(() => inputDniClienteRef.current?.focus(), 100)
      return
    }
    setMostrarCobrar(true)
  }

  function seleccionarClienteDni(cli) {
    setCliente({
      id_centum: cli.id_centum || 0,
      codigo: cli.codigo || '',
      razon_social: cli.razon_social,
      condicion_iva: cli.condicion_iva || 'CF',
      email: cli.email || '',
      celular: cli.celular || '',
      lista_precio_id: cli.lista_precio_id || 1,
      grupo_descuento_id: cli.grupo_descuento_id || null,
      grupo_descuento_nombre: cli.grupos_descuento?.nombre || null,
      grupo_descuento_porcentaje: cli.grupos_descuento?.porcentaje || 0,
    })
    // Cargar descuentos por rubro del grupo
    if (cli.grupos_descuento?.grupos_descuento_rubros?.length > 0) {
      const rubroMap = {}
      for (const r of cli.grupos_descuento.grupos_descuento_rubros) {
        rubroMap[r.rubro] = parseFloat(r.porcentaje) || 0
      }
      setDescuentosGrupoRubros(rubroMap)
    } else {
      setDescuentosGrupoRubros({})
    }
    setMostrarDniPopup(false)
    setMostrarCobrar(true)
  }

  function onClienteDniCreado(clienteNuevo) {
    setMostrarCrearClienteDni(false)
    if (clienteNuevo) {
      seleccionarClienteDni(clienteNuevo)
    }
  }

  // Debounce búsqueda cliente por DNI/CUIT únicamente
  useEffect(() => {
    if (!mostrarDniPopup) return
    const termino = busquedaDniCliente.trim().replace(/\D/g, '')
    // Solo buscar con DNI (7-8) o CUIT (11), no con 9-10 dígitos que son inválidos
    if (termino.length < 7 || termino.length === 9 || termino.length === 10) { setClientesDni([]); return }
    setBuscandoDniCliente(true)
    const timeout = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/clientes', { params: { buscar: termino, solo_dni: 'true', limit: 10 } })
        setClientesDni(data.clientes || data || [])
      } catch { setClientesDni([]) }
      finally { setBuscandoDniCliente(false) }
    }, 400)
    return () => clearTimeout(timeout)
  }, [busquedaDniCliente, mostrarDniPopup])

  useEffect(() => {
    if (mostrarDniPopup) setTimeout(() => inputDniClienteRef.current?.focus(), 100)
  }, [mostrarDniPopup])
  // Modal venta empleado
  const [mostrarVentaEmpleado, setMostrarVentaEmpleado] = useState(false)

  // Pedidos POS — pedidosRefreshKey se mantiene aquí porque lo usa PedidosPOS
  const [pedidosRefreshKey, setPedidosRefreshKey] = useState(0)

  // Edición inline de precio
  const [editandoPrecio, setEditandoPrecio] = useState(null) // articuloId o null
  const [pendientePrecio, setPendientePrecio] = useState(null) // { articuloId, nuevoPrecio, precioOriginal }

  const MOTIVOS_CAMBIO_PRECIO = [
    'Precio mal cargado en sistema',
    'Precio de góndola diferente',
    'Autorizado por supervisor',
    'Promoción no cargada',
    'Precio especial cliente',
    'Error de etiqueta',
  ]

  // Saldo a favor del cliente seleccionado
  const [saldoCliente, setSaldoCliente] = useState(0)
  const [saldoDesglose, setSaldoDesglose] = useState({})

  // Vista activa: tabs estilo Chrome (venta vs pedidos vs saldos)
  const [vistaActiva, setVistaActiva] = useState('venta')

  // Modo delivery: solo artículos configurados, precios delivery, sin promos ni descuentos
  const [modoDelivery, setModoDelivery] = useState(false)
  const [articulosDelivery, setArticulosDelivery] = useState([])

  // Gift cards para vender junto con artículos
  const [giftCardsEnVenta, setGiftCardsEnVenta] = useState([])
  const [mostrarAgregarGC, setMostrarAgregarGC] = useState(false)
  const [gcCodigo, setGcCodigo] = useState('')
  const [gcMonto, setGcMonto] = useState('')
  const [gcComprador, setGcComprador] = useState('')
  const [gcError, setGcError] = useState('')

  // Pedido en proceso de entrega (viene de tab Pedidos)
  const [pedidoEnProceso, setPedidoEnProceso] = useState(null) // { id, esPagado, ... }
  const carritoBloquedado = pedidoEnProceso?.esPagado && !pedidoEnProceso?.editando

  // Modal problema
  const [mostrarActualizaciones, setMostrarActualizaciones] = useState(false)
  const [mostrarCerrarCaja, setMostrarCerrarCaja] = useState(false)
  const [mostrarConfirmarCancelar, setMostrarConfirmarCancelar] = useState(false)
  const {
    mostrarProblema, setMostrarProblema,
    problemaSeleccionado, setProblemaSeleccionado,
    problemaPaso, setProblemaPaso,
    problemaBusqueda, setProblemaBusqueda,
    problemaBusFactura, setProblemaBusFactura,
    problemaFecha, setProblemaFecha,
    problemaBusArticulo, setProblemaBusArticulo,
    problemaSucursal, setProblemaSucursal,
    problemaSucursales, setProblemaSucursales,
    problemaVentas, setProblemaVentas,
    problemaBuscando,
    problemaVentaSel, setProblemaVentaSel,
    problemaItemsSel, setProblemaItemsSel,
    problemaDescripciones, setProblemaDescripciones,
    problemaYaDevuelto, setProblemaYaDevuelto,
    problemaCliente, setProblemaCliente,
    problemaBusCliente, setProblemaBusCliente,
    problemaClientesRes, setProblemaClientesRes,
    problemaBuscandoCli, setProblemaBuscandoCli,
    problemaCrearCliente, setProblemaCrearCliente,
    problemaConfirmando, setProblemaConfirmando,
    problemaObservacion, setProblemaObservacion,
    problemaPreciosCorregidos, setProblemaPreciosCorregidos,
    problemaEmailCliente, setProblemaEmailCliente,
    problemaCliTimerRef,
    cerrarModalProblema,
    buscarVentasProblema,
    buscarVentasProblemaDebounced,
  } = useProblemaWizard({ terminalConfig })

  // Modal cancelar venta
  const [mostrarCancelar, setMostrarCancelar] = useState(false)
  const [cancelarMotivo, setCancelarMotivo] = useState(null)
  const [cancelarMotivoOtro, setCancelarMotivoOtro] = useState('')
  const [cancelarPasoConfirm, setCancelarPasoConfirm] = useState(false)

  // Carrito mobile toggle
  const [carritoVisible, setCarritoVisible] = useState(false)

  // Modo empleado (cuenta corriente)
  const [empleadoActivo, setEmpleadoActivo] = useState(null) // { id, nombre, codigo }
  const [descuentosEmpleado, setDescuentosEmpleado] = useState({}) // { rubroNombre: porcentaje }

  // Favoritos (globales desde DB)
  const [favoritos, setFavoritos] = useState([])

  const inputBusquedaRef = useRef(null)
  const inputClienteRef = useRef(null)

  // Refocus al buscador tras cualquier click (excepto otros inputs)
  const handlePOSClick = useCallback((e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
    // No refocalizar si hay un modal abierto (gift card, cobro, etc.)
    if (e.target.closest('[data-modal]')) return
    setTimeout(() => {
      if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'SELECT') {
        inputBusquedaRef.current?.focus()
      }
    }, 0)
  }, [])

  // Cargar promos, artículos, clientes y favoritos al montar (1 sola vez)
  useEffect(() => {
    cargarPromociones()
    cargarArticulos()
    cargarClientesCache()
    cargarFavoritos()
    cargarArticulosDelivery()
  }, [])

  async function cargarFavoritos() {
    try {
      const { data } = await api.get('/api/pos/favoritos')
      setFavoritos(data.articulo_ids || [])
    } catch (err) {
      console.error('Error cargando favoritos:', err)
    }
  }

  async function cargarArticulosDelivery() {
    try {
      const { data } = await api.get('/api/pos/articulos-delivery')
      setArticulosDelivery(data || [])
    } catch (err) {
      console.error('Error cargando artículos delivery:', err)
    }
  }

  async function cargarPromociones() {
    setCargandoPromos(true)
    try {
      const { data } = await api.get('/api/pos/promociones')
      const promos = data.promociones || []
      setPromociones(promos)
      guardarPromociones(promos).catch(err => console.error('Error caching promotions:', err.message))
    } catch (err) {
      console.error('Error cargando promos:', err)
      if (isNetworkError(err)) {
        try {
          const cached = await getPromociones()
          if (cached.length > 0) setPromociones(cached)
        } catch {}
      }
    } finally {
      setCargandoPromos(false)
    }
  }

  // Precargar clientes en IndexedDB para búsqueda offline
  async function cargarClientesCache() {
    try {
      const { data } = await api.get('/api/clientes', { params: { limit: 5000 } })
      const clientes = data.clientes || data.data || []
      guardarClientes(clientes).catch(err => console.error('Error caching clients:', err.message))
    } catch (err) {
      // Si falla la red, no pasa nada — usaremos cache existente
      console.error('Error precargando clientes:', err)
    }
  }

  // Buscar clientes en Centum (debounced) — offline: busca en IndexedDB
  useEffect(() => {
    let cancelled = false

    if (!busquedaCliente.trim() || busquedaCliente.trim().length < 2) {
      setClientesCentum([])
      setClienteIdx(-1)
      return
    }

    const timeout = setTimeout(async () => {
      setBuscandoClientes(true)
      try {
        if (isOnline) {
          const { data } = await api.get('/api/clientes', {
            params: { buscar: busquedaCliente.trim(), limit: 10 }
          })
          let resultados = data.clientes || data.data || []
          // Si busca por DNI (7-8 dígitos), filtrar solo Consumidor Final
          // Buscar por DNI implica que quiere factura B, no mostrar clientes con CUIT (factura A)
          const digitos = busquedaCliente.trim().replace(/\D/g, '')
          if (digitos.length >= 7 && digitos.length <= 8) {
            resultados = resultados.filter(c => !c.condicion_iva || c.condicion_iva === 'CF')
          }
          if (!cancelled) setClientesCentum(resultados)
        } else {
          let cached = await getClientes(busquedaCliente.trim())
          const digitos2 = busquedaCliente.trim().replace(/\D/g, '')
          if (digitos2.length >= 7 && digitos2.length <= 8) {
            cached = cached.filter(c => !c.condicion_iva || c.condicion_iva === 'CF')
          }
          if (!cancelled) setClientesCentum(cached.slice(0, 10))
        }
      } catch (err) {
        console.error('Error buscando clientes:', err)
        // Fallback a IndexedDB si la API falla
        if (!cancelled && isNetworkError(err)) {
          try {
            let cached = await getClientes(busquedaCliente.trim())
            const digitos3 = busquedaCliente.trim().replace(/\D/g, '')
            if (digitos3.length >= 7 && digitos3.length <= 8) {
              cached = cached.filter(c => !c.condicion_iva || c.condicion_iva === 'CF')
            }
            if (!cancelled) setClientesCentum(cached.slice(0, 10))
          } catch {}
        }
      } finally {
        if (!cancelled) setBuscandoClientes(false)
      }
    }, 400)

    return () => { cancelled = true; clearTimeout(timeout) }
  }, [busquedaCliente, isOnline])

  // Cargar artículos desde DB local (precios minoristas, sync 1x/día)
  async function cargarArticulos() {
    setCargandoArticulos(true)
    try {
      const { data } = await api.get('/api/pos/articulos')
      const arts = data.articulos || []
      setArticulos(arts)
      guardarArticulos(arts).catch(err => console.error('Error caching articles:', err.message))
    } catch (err) {
      console.error('Error cargando artículos:', err)
      try {
        const cached = await getArticulos()
        if (cached.length > 0) {
          setArticulos(cached)
          return
        }
      } catch {}
      alert('Error al cargar artículos: ' + (err.response?.data?.error || err.message))
    } finally {
      setCargandoArticulos(false)
    }
  }

  // Sincronizar precios desde Centum ERP
  async function sincronizarPrecios() {
    if (sincronizandoERP) return
    setSincronizandoERP(true)
    try {
      await api.post('/api/articulos/sincronizar-precios')
      await cargarArticulos()
    } catch (err) {
      alert('Error al sincronizar: ' + (err.response?.data?.error || err.message))
    } finally {
      setSincronizandoERP(false)
    }
  }

  // Consultar saldo a favor del cliente seleccionado
  useEffect(() => {
    if (!cliente.id_centum || cliente.id_centum === 0) {
      setSaldoCliente(0)
      setSaldoDesglose({})
      return
    }
    let cancelled = false
    api.get(`/api/pos/saldo/${cliente.id_centum}`)
      .then(({ data }) => {
        if (!cancelled) {
          setSaldoCliente(data.saldo || 0)
          setSaldoDesglose(data.desglose_forma_pago || {})
        }
      })
      .catch(() => { if (!cancelled) { setSaldoCliente(0); setSaldoDesglose({}) } })
    return () => { cancelled = true }
  }, [cliente.id_centum])

  async function seleccionarCliente(cli) {
    if (seleccionandoCliente) return // evitar doble click
    setSeleccionandoCliente(true)
    // Cerrar lista y limpiar búsqueda inmediatamente para dar feedback visual
    setClientesCentum([])
    setBusquedaCliente('')
    // Setear cliente con datos locales al instante (se actualiza luego con refresh)
    const clienteLocal = {
      id_centum: cli.id_centum || 0,
      codigo: cli.codigo || '',
      razon_social: cli.razon_social || 'Consumidor Final',
      lista_precio_id: cli.lista_precio_id || 1,
      email: cli.email || '',
      celular: cli.celular || '',
      condicion_iva: cli.condicion_iva || 'CF',
      grupo_descuento_id: cli.grupo_descuento_id || null,
      grupo_descuento_nombre: cli.grupos_descuento?.nombre || null,
      grupo_descuento_porcentaje: cli.grupos_descuento?.porcentaje || 0,
    }
    setCliente(clienteLocal)

    // Cargar descuentos por rubro del grupo
    if (cli.grupos_descuento?.grupos_descuento_rubros?.length > 0) {
      const rubroMap = {}
      for (const r of cli.grupos_descuento.grupos_descuento_rubros) {
        rubroMap[r.rubro] = parseFloat(r.porcentaje) || 0
      }
      setDescuentosGrupoRubros(rubroMap)
    } else {
      setDescuentosGrupoRubros({})
    }

    // Verificar en Centum que el cliente esté activo (en background, con timeout)
    let emailFinal = clienteLocal.email
    let condicionFinal = clienteLocal.condicion_iva
    if (cli.id_centum) {
      try {
        const { data } = await api.get(`/api/clientes/refresh/${cli.id_centum}`, { timeout: 8000 })
        emailFinal = data.email || ''
        condicionFinal = data.condicion_iva || condicionFinal
        // Actualizar con datos frescos de Centum
        setCliente(prev => ({
          ...prev,
          codigo: data.codigo || prev.codigo,
          razon_social: data.razon_social || prev.razon_social,
          email: emailFinal,
          celular: data.celular || prev.celular,
          condicion_iva: condicionFinal,
        }))
      } catch (err) {
        if (err.response?.status === 410) {
          alert('Este cliente está desactivado en Centum y no se puede usar.')
          setCliente({ ...CLIENTE_DEFAULT })
          setSeleccionandoCliente(false)
          return
        }
        // Si falla o timeout, ya tiene los datos locales cargados
      }
    }
    setSeleccionandoCliente(false)
    setTimeout(() => inputBusquedaRef.current?.focus(), 50)

    // Alerta si es Factura A y no tiene email
    if ((condicionFinal === 'RI' || condicionFinal === 'MT') && !emailFinal) {
      alert('Este cliente no tiene email cargado. No se podrá enviar el comprobante por email.')
    }
  }

  async function guardarContactoCliente() {
    if (!cliente.id_centum || cliente.id_centum === 0) return
    setGuardandoContacto(true)
    try {
      await api.put(`/api/clientes/contacto/${cliente.id_centum}`, {
        email: cliente.email,
        celular: cliente.celular,
      })
    } catch (err) {
      console.error('Error guardando contacto:', err)
    } finally {
      setGuardandoContacto(false)
    }
  }

  // Extraer rubros únicos de los artículos cargados
  const rubros = useMemo(() => {
    const map = new Map()
    articulos.forEach(a => {
      if (a.rubro?.nombre && !map.has(a.rubro.nombre)) {
        map.set(a.rubro.nombre, a.rubro)
      }
    })
    return Array.from(map.values())
  }, [articulos])

  // Mapa rubro -> color
  const rubroColorMap = useMemo(() => {
    const map = {}
    rubros.forEach((r, i) => {
      map[r.nombre] = TILE_COLORS[i % TILE_COLORS.length]
    })
    return map
  }, [rubros])

  // Toggle favorito (solo admin, guarda en DB global)
  const toggleFavorito = useCallback((articuloId, e) => {
    e.stopPropagation()
    if (!esAdmin) return
    setFavoritos(prev => {
      const next = prev.includes(articuloId)
        ? prev.filter(id => id !== articuloId)
        : [...prev, articuloId]
      api.post('/api/pos/favoritos', { articulo_ids: next }).catch(err => {
        console.error('Error guardando favoritos:', err)
      })
      return next
    })
  }, [esAdmin])

  // Precio con descuento empleado (si modo empleado activo)
  const precioConDescEmpleado = useCallback((articulo) => {
    const precioBase = calcularPrecioConDescuentosBase(articulo)
    if (!empleadoActivo) return precioBase
    const rubroNombre = articulo.rubro?.nombre || ''
    const descPct = descuentosEmpleado[rubroNombre] || 0
    if (descPct <= 0) return precioBase
    return Math.round(precioBase * (1 - descPct / 100) * 100) / 100
  }, [empleadoActivo, descuentosEmpleado])

  // Mapa de precios delivery: articulo_id_centum → precio_delivery
  const deliveryPriceMap = useMemo(() => {
    const map = {}
    articulosDelivery.filter(d => d.activo).forEach(d => { map[d.articulo_id_centum] = d.precio_delivery })
    return map
  }, [articulosDelivery])

  // Toggle modo delivery
  const toggleModoDelivery = useCallback(() => {
    setModoDelivery(prev => {
      setCarrito([])
      setBusquedaArt('')
      if (!prev) {
        // Activando: desactivar modo empleado
        setEmpleadoActivo(null)
        setDescuentosEmpleado({})
      }
      return !prev
    })
  }, [])

  // Favoritos: siempre visibles como tiles, ordenados por rubro
  const articulosFavoritos = useMemo(() => {
    let favs = articulos.filter(a => favoritos.includes(a.id))
    if (modoDelivery) favs = favs.filter(a => a.id in deliveryPriceMap)
    const rubroOrden = {}
    rubros.forEach((r, i) => { rubroOrden[r.nombre] = i })
    favs.sort((a, b) => (rubroOrden[a.rubro?.nombre] ?? 999) - (rubroOrden[b.rubro?.nombre] ?? 999))
    return favs
  }, [articulos, favoritos, rubros, modoDelivery, deliveryPriceMap])

  // Resultados de búsqueda: dropdown autocompletado
  const resultadosBusqueda = useMemo(() => {
    if (!busquedaArt.trim()) return []
    const terminos = busquedaArt.toLowerCase().trim().split(/\s+/)
    let filtered = articulos.filter(a => {
      const texto = `${a.codigo} ${a.nombre} ${a.rubro?.nombre || ''} ${a.subRubro?.nombre || ''}`.toLowerCase()
      return terminos.every(t => texto.includes(t))
    })
    if (modoDelivery) filtered = filtered.filter(a => a.id in deliveryPriceMap)
    return filtered.slice(0, 30)
  }, [articulos, busquedaArt, modoDelivery, deliveryPriceMap])

  // Agregar al carrito — pesables abren popup para ingresar peso, no pesables suman 1
  const agregarAlCarrito = useCallback((articulo, cantidad = 1) => {
    if (giftCardsEnVenta.length > 0) return // No mezclar artículos con gift cards
    if (articulo.esPesable) {
      setPopupPesable({ articulo })
      setPopupPesableKg('')
      return
    }
    const deliveryPrice = modoDelivery ? deliveryPriceMap[articulo.id] : undefined
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articulo.id)
      if (idx >= 0) {
        const nuevo = [...prev]
        nuevo[idx] = { ...nuevo[idx], cantidad: nuevo[idx].cantidad + cantidad }
        return nuevo
      }
      return [...prev, { articulo, cantidad, ...(deliveryPrice != null ? { precioOverride: parseFloat(deliveryPrice) } : {}) }]
    })
  }, [modoDelivery, deliveryPriceMap, giftCardsEnVenta.length])

  const confirmarPesable = useCallback(() => {
    if (!popupPesable || giftCardsEnVenta.length > 0) return
    const kg = parseFloat(popupPesableKg)
    if (!kg || kg <= 0) return
    const deliveryPrice = modoDelivery ? deliveryPriceMap[popupPesable.articulo.id] : undefined
    setCarrito(prev => [...prev, { articulo: popupPesable.articulo, cantidad: Math.round(kg * 1000) / 1000, ...(deliveryPrice != null ? { precioOverride: parseFloat(deliveryPrice) } : {}) }])
    setPopupPesable(null)
    setPopupPesableKg('')
    setTimeout(() => inputBusquedaRef.current?.focus(), 50)
  }, [popupPesable, popupPesableKg, modoDelivery, deliveryPriceMap, giftCardsEnVenta.length])

  // Parsear código de barras de balanza Kretz (EAN-13, prefijo 20)
  // Formato: 20 PPPPP WWWWW C → PLU (5 dígitos) + Peso en gramos (5 dígitos) + check
  const parsearBarcodeBalanza = useCallback((barcode) => {
    const code = barcode.replace(/\s/g, '')
    if (code.length === 13 && code.startsWith('20')) {
      const plu = code.substring(2, 7)        // 5 dígitos PLU
      const pesoGramos = parseInt(code.substring(7, 12), 10) // 5 dígitos peso
      const pesoKg = pesoGramos / 1000
      if (pesoKg > 0) {
        return { plu, pesoKg }
      }
    }
    return null
  }, [])

  // Buscar artículo por código de barras (también busca por código interno y balanza)
  const buscarPorBarcode = useCallback((barcode) => {
    const codigo = barcode.trim()

    // 1. Verificar si es código de balanza Kretz (prefijo 20, 13 dígitos)
    const balanza = parsearBarcodeBalanza(codigo)
    if (balanza) {
      const articuloPlu = articulos.find(a => a.codigo === balanza.plu)
      if (articuloPlu) {
        // En modo delivery, rechazar si no está configurado
        if (modoDelivery && !(articuloPlu.id in deliveryPriceMap)) {
          setAlertaBarcode(codigo)
          setBusquedaArt('')
          return true
        }
        // Detectar duplicado: mismo código de barras escaneado dos veces seguidas (solo pesables)
        const ultimo = ultimoBarcodaBalanzaRef.current
        if (articuloPlu.esPesable && ultimo && ultimo === codigo) {
          // Mostrar alerta de duplicado y guardar datos para agregar si confirma
          setAlertaDuplicado({ articulo: articuloPlu, pesoKg: balanza.pesoKg, barcode: codigo })
          setBusquedaArt('')
          return true
        }
        // Guardar como último escaneado
        ultimoBarcodaBalanzaRef.current = codigo
        // Si el artículo NO es pesable, tratarlo como unitario (cantidad 1) aunque venga de balanza
        const cantidadFinal = articuloPlu.esPesable ? balanza.pesoKg : 1
        const dPrice = modoDelivery ? deliveryPriceMap[articuloPlu.id] : undefined
        if (!articuloPlu.esPesable) {
          // Unitario: sumar al existente o agregar con cantidad 1
          setCarrito(prev => {
            const idx = prev.findIndex(i => i.articulo.id === articuloPlu.id)
            if (idx >= 0) {
              const nuevo = [...prev]
              nuevo[idx] = { ...nuevo[idx], cantidad: nuevo[idx].cantidad + 1 }
              return nuevo
            }
            return [...prev, { articulo: articuloPlu, cantidad: 1, ...(dPrice != null ? { precioOverride: parseFloat(dPrice) } : {}) }]
          })
        } else {
          // Pesable: agregar como línea separada con el peso
          setCarrito(prev => [...prev, { articulo: articuloPlu, cantidad: cantidadFinal, ...(dPrice != null ? { precioOverride: parseFloat(dPrice) } : {}) }])
        }
        setBusquedaArt('')
        return true
      }
    }

    // 2. Buscar en codigos_barras (soporta formato objeto {codigo,factor} y string legacy)
    let encontrado = null
    let factorUnidad = 1
    for (const a of articulos) {
      if (!a.codigosBarras || a.codigosBarras.length === 0) continue
      const match = a.codigosBarras.find(b =>
        typeof b === 'object' ? b.codigo === codigo : b === codigo
      )
      if (match) {
        encontrado = a
        factorUnidad = typeof match === 'object' ? (match.factor || 1) : 1
        break
      }
    }
    // 3. Si no se encuentra, buscar por código interno exacto
    if (!encontrado) {
      encontrado = articulos.find(a => a.codigo === codigo)
    }
    if (encontrado) {
      // En modo delivery, rechazar si no está configurado
      if (modoDelivery && !(encontrado.id in deliveryPriceMap)) {
        setAlertaBarcode(codigo)
        setBusquedaArt('')
        return true
      }
      // Detectar duplicado: mismo barcode escaneado rápido (< 3 seg)
      const ahora = Date.now()
      const ultimo = ultimoBarcodeRef.current
      if (ultimo.codigo === codigo && (ahora - ultimo.time) < 1500) {
        setAlertaDuplicado({ articulo: encontrado, cantidad: factorUnidad })
        setBusquedaArt('')
        return true
      }
      ultimoBarcodeRef.current = { codigo, time: ahora }
      agregarAlCarrito(encontrado, factorUnidad)
      setBusquedaArt('')
      return true
    }
    return false
  }, [articulos, agregarAlCarrito, parsearBarcodeBalanza, modoDelivery, deliveryPriceMap])

  // Detectar entrada rápida tipo escáner de barras
  const ultimoInputRef = useRef({ time: 0 })

  const handleBusquedaChange = useCallback((e) => {
    const valor = e.target.value
    setBusquedaArt(valor)
    setBusquedaIdx(-1)
    ultimoInputRef.current.time = Date.now()
  }, [])

  const handleBusquedaKeyDown = useCallback((e) => {
    // Navegación con flechas en dropdown de resultados
    if (e.key === 'ArrowDown' && resultadosBusqueda.length > 0) {
      e.preventDefault()
      setBusquedaIdx(prev => prev < resultadosBusqueda.length - 1 ? prev + 1 : 0)
      return
    }
    if (e.key === 'ArrowUp' && resultadosBusqueda.length > 0) {
      e.preventDefault()
      setBusquedaIdx(prev => prev > 0 ? prev - 1 : resultadosBusqueda.length - 1)
      return
    }
    if (e.key === 'Escape' && busquedaArt.trim()) {
      e.preventDefault()
      setBusquedaArt('')
      setBusquedaIdx(-1)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      // Leer valor directo del input (no del state que puede estar desactualizado)
      const valor = e.target.value.trim()
      if (!valor) return

      // Si es un código numérico largo, buscar como barcode
      if (/^\d{4,}$/.test(valor)) {
        if (!buscarPorBarcode(valor)) {
          setAlertaBarcode(valor)
          playAlertSound()
          setTimeout(() => { setAlertaBarcode(null); stopAlertSound() }, 3000)
        }
        setBusquedaArt('')
        setBusquedaIdx(-1)
        return
      }

      // Detectar entrada rápida de scanner (no numérica, ej: QR con URL)
      const dt = Date.now() - ultimoInputRef.current.time
      const esScanner = dt < 80 && valor.length > 6

      if (esScanner) {
        setAlertaBarcode(valor)
        playAlertSound()
        setTimeout(() => { setAlertaBarcode(null); stopAlertSound() }, 3000)
        setBusquedaArt('')
        setBusquedaIdx(-1)
        return
      }

      // Si hay un item seleccionado con flechas, agregarlo
      if (busquedaIdx >= 0 && busquedaIdx < resultadosBusqueda.length) {
        agregarAlCarrito(resultadosBusqueda[busquedaIdx])
        setBusquedaArt('')
        setBusquedaIdx(-1)
        return
      }

      // Si hay exactamente un resultado de búsqueda por texto, agregarlo
      if (resultadosBusqueda.length === 1) {
        agregarAlCarrito(resultadosBusqueda[0])
        setBusquedaArt('')
        setBusquedaIdx(-1)
      }
    }
  }, [buscarPorBarcode, resultadosBusqueda, agregarAlCarrito, busquedaIdx, busquedaArt])

  const cambiarCantidad = useCallback((articuloId, delta, esPesable) => {
    const paso = esPesable ? 0.1 : 1
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevaCantidad = Math.round((prev[idx].cantidad + paso * delta) * 1000) / 1000
      if (nuevaCantidad <= 0) {
        const item = prev[idx]
        const precio = item.precioOverride ?? item.articulo.precio ?? 0
        api.post('/api/pos/log-eliminacion', {
          usuario_nombre: cierreActivo?.empleado?.nombre || usuario?.nombre || 'Desconocido',
          cierre_id: cierreActivo?.id || null,
          ticket_uid: ticketUidRef.current,
          items: [{ articulo_id: articuloId, nombre: item.articulo.nombre, cantidad: item.cantidad, precio, hora: new Date().toISOString() }],
        }).catch(err => console.error('Error registrando eliminación:', err))
        return prev.filter(i => i.articulo.id !== articuloId)
      }
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: nuevaCantidad }
      return nuevo
    })
  }, [cierreActivo, usuario])

  const setCantidadDirecta = useCallback((articuloId, cantidad) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      if (cantidad <= 0) {
        const item = prev[idx]
        const precio = item.precioOverride ?? item.articulo.precio ?? 0
        api.post('/api/pos/log-eliminacion', {
          usuario_nombre: cierreActivo?.empleado?.nombre || usuario?.nombre || 'Desconocido',
          cierre_id: cierreActivo?.id || null,
          ticket_uid: ticketUidRef.current,
          items: [{ articulo_id: articuloId, nombre: item.articulo.nombre, cantidad: item.cantidad, precio, hora: new Date().toISOString() }],
        }).catch(err => console.error('Error registrando eliminación:', err))
        return prev.filter(i => i.articulo.id !== articuloId)
      }
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], cantidad: Math.round(cantidad * 1000) / 1000 }
      return nuevo
    })
  }, [cierreActivo, usuario])


  const quitarDelCarrito = useCallback((articuloId) => {
    setCarrito(prev => {
      const item = prev.find(i => i.articulo.id === articuloId)
      if (item) {
        const precio = item.precioOverride ?? item.articulo.precio ?? 0
        api.post('/api/pos/log-eliminacion', {
          usuario_nombre: cierreActivo?.empleado?.nombre || usuario?.nombre || 'Desconocido',
          cierre_id: cierreActivo?.id || null,
          ticket_uid: ticketUidRef.current,
          items: [{ articulo_id: articuloId, nombre: item.articulo.nombre, cantidad: item.cantidad, precio, hora: new Date().toISOString() }],
        }).catch(err => console.error('Error registrando eliminación:', err))
      }
      return prev.filter(i => i.articulo.id !== articuloId)
    })
    setCarritoIdx(-1)
    setTimeout(() => inputBusquedaRef.current?.focus(), 50)
  }, [usuario, cierreActivo])

  // Atajos de teclado para modales y acciones rápidas
  useEffect(() => {
    const handler = (e) => {
      // Confirmar cancelación
      if (mostrarConfirmarCancelar) {
        if (e.key === 'Enter') { e.preventDefault(); ejecutarCancelacion() }
        if (e.key === 'Escape') { e.preventDefault(); setMostrarConfirmarCancelar(false) }
        return
      }
      // Si hay un modal abierto (cobrar, etc.) no interceptar F-keys pero bloquear defaults del browser
      if (mostrarCobrar) {
        if (e.key.startsWith('F') && e.key.length <= 3) e.preventDefault()
        return
      }

      // No interceptar teclas cuando el foco está en un select (para permitir navegación del dropdown)
      if (document.activeElement?.tagName === 'SELECT') return

      const tieneItems = carrito.length > 0 || giftCardsEnVenta.length > 0

      // F1 = Tab Venta
      if (e.key === 'F1') {
        e.preventDefault()
        setVistaActiva('venta')
      }
      // F2 = Tab Pedidos
      if (e.key === 'F2') {
        e.preventDefault()
        setVistaActiva('pedidos')
      }
      // F3 = Tab Saldos
      if (e.key === 'F3') {
        e.preventDefault()
        setVistaActiva('saldos')
      }
      // F4 = Tab Gift Cards
      if (e.key === 'F4') {
        e.preventDefault()
        setVistaActiva('giftcards')
      }
      // F5 = Tab Consulta
      if (e.key === 'F5') {
        e.preventDefault()
        setVistaActiva('consulta')
      }
      // F6 = Cambiar cliente
      if (e.key === 'F6') {
        e.preventDefault()
        setVistaActiva('venta')
        setTimeout(() => inputClienteRef.current?.focus(), 50)
      }
      // F7 = Foco buscador artículos
      if (e.key === 'F7') {
        e.preventDefault()
        setVistaActiva('venta')
        setTimeout(() => { inputBusquedaRef.current?.focus(); inputBusquedaRef.current?.select() }, 50)
      }
      // F12 = Sincronizar precios
      if (e.key === 'F12') {
        e.preventDefault()
        sincronizarPrecios()
      }
      // F8 = Problema
      if (e.key === 'F8') {
        e.preventDefault()
        setMostrarProblema(true)
      }
      // F9 = Cancelar venta
      if (e.key === 'F9' && tieneItems) {
        e.preventDefault()
        setMostrarConfirmarCancelar(true)
      }
      // F10 = Es pedido
      if (e.key === 'F10' && tieneItems && !pedidoEnProceso) {
        e.preventDefault()
        handleEsPedido()
      }
      // F11 = Cobrar (solo si el modal de cobro no está abierto)
      if (e.key === 'F11' && tieneItems && !mostrarCobrar) {
        e.preventDefault()
        handleCobrar()
      }
      // + / - = Cantidad del item seleccionado (o último) (solo si no hay foco en input)
      if ((e.key === '+' || e.key === '-') && carrito.length > 0 && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        const idx = carritoIdx >= 0 && carritoIdx < carrito.length ? carritoIdx : carrito.length - 1
        const item = carrito[idx]
        cambiarCantidad(item.articulo.id, e.key === '+' ? 1 : -1, item.articulo.esPesable)
      }

      // Flecha izquierda = entrar al carrito (seleccionar último item)
      if (e.key === 'ArrowLeft' && carrito.length > 0 && document.activeElement?.tagName !== 'TEXTAREA') {
        // Solo si el cursor está al inicio del input de búsqueda o no hay texto
        const input = inputBusquedaRef.current
        if (input && document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault()
          input.blur()
          setCarritoIdx(carrito.length - 1)
        } else if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault()
          setCarritoIdx(carrito.length - 1)
        }
      }
      // Flecha derecha = volver al buscador
      if (e.key === 'ArrowRight' && carritoIdx >= 0) {
        e.preventDefault()
        setCarritoIdx(-1)
        setTimeout(() => inputBusquedaRef.current?.focus(), 50)
      }
      // Flechas arriba/abajo = navegar carrito (solo si estamos en modo carrito)
      if (e.key === 'ArrowUp' && carritoIdx >= 0) {
        e.preventDefault()
        setCarritoIdx(prev => Math.max(0, prev - 1))
      }
      if (e.key === 'ArrowDown' && carritoIdx >= 0) {
        e.preventDefault()
        setCarritoIdx(prev => Math.min(carrito.length - 1, prev + 1))
      }
      // Backspace = eliminar item seleccionado del carrito
      if (e.key === 'Backspace' && carritoIdx >= 0 && carritoIdx < carrito.length && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        const item = carrito[carritoIdx]
        quitarDelCarrito(item.articulo.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mostrarCancelar, cancelarMotivo, cancelarMotivoOtro, mostrarCobrar, carrito, giftCardsEnVenta.length, pedidoEnProceso, sincronizarPrecios, cambiarCantidad, carritoIdx, quitarDelCarrito, cierreActivo])

  const setPrecioOverride = useCallback((articuloId, nuevoPrecio, motivo = null, precioOriginal = null) => {
    setCarrito(prev => {
      const idx = prev.findIndex(i => i.articulo.id === articuloId)
      if (idx < 0) return prev
      const nuevo = [...prev]
      if (nuevoPrecio == null) {
        // Restaurar precio original
        nuevo[idx] = { ...nuevo[idx], precioOverride: null, motivoCambioPrecio: null, precioOriginalAntesCambio: null }
      } else {
        nuevo[idx] = { ...nuevo[idx], precioOverride: nuevoPrecio, motivoCambioPrecio: motivo, precioOriginalAntesCambio: precioOriginal }
      }
      return nuevo
    })
  }, [])

  // Calcular totales — precio de Centum ya incluye IVA
  const { subtotal, subtotalSinDescEmpleado, descuentoTotal, descEmpleadoDetalle, descEmpleadoTotal, total, promosAplicadas } = useMemo(() => {
    let sub = 0
    let subSinDesc = 0
    const rubroMap = {}

    for (const item of carrito) {
      const precioOriginal = item.precioOverride != null ? item.precioOverride : calcularPrecioConDescuentosBase(item.articulo)
      const precioFinal = item.precioOverride != null ? item.precioOverride : precioConDescEmpleado(item.articulo)
      sub += precioFinal * item.cantidad
      subSinDesc += precioOriginal * item.cantidad

      // Acumular descuento empleado por rubro
      if (empleadoActivo && precioOriginal !== precioFinal) {
        const rubroNombre = item.articulo.rubro?.nombre || 'Sin rubro'
        const descItem = (precioOriginal - precioFinal) * item.cantidad
        if (!rubroMap[rubroNombre]) {
          rubroMap[rubroNombre] = { rubro: rubroNombre, porcentaje: descuentosEmpleado[rubroNombre] || 0, descuento: 0 }
        }
        rubroMap[rubroNombre].descuento += descItem
      }
    }

    const descEmpleado = Object.values(rubroMap)
    const totalDescEmpleado = descEmpleado.reduce((s, d) => s + d.descuento, 0)

    const aplicadas = (modoDelivery || cliente.grupo_descuento_porcentaje > 0) ? [] : calcularPromocionesLocales(carrito, promociones)
    const descTotal = aplicadas.reduce((sum, p) => sum + p.descuento, 0)

    return {
      subtotal: sub,
      subtotalSinDescEmpleado: subSinDesc,
      descuentoTotal: descTotal,
      descEmpleadoDetalle: descEmpleado,
      descEmpleadoTotal: totalDescEmpleado,
      total: sub - descTotal,
      promosAplicadas: aplicadas,
    }
  }, [carrito, promociones, empleadoActivo, descuentosEmpleado, precioConDescEmpleado, modoDelivery, cliente.grupo_descuento_porcentaje])

  function ejecutarCancelacion() {
    api.post('/api/auditoria/cancelacion', {
      motivo: 'Cancelación rápida',
      items: carrito.map(i => ({ articulo_id: i.articulo.id, codigo: i.articulo.codigo, nombre: i.articulo.nombre, cantidad: i.cantidad, precio: i.precioOverride ?? i.articulo.precio })),
      subtotal,
      total,
      cliente_nombre: cliente?.nombre || null,
      caja_id: terminalConfig?.caja_id || null,
      sucursal_id: terminalConfig?.sucursal_id || null,
      cierre_id: cierreActivo?.id || null,
    }).catch(err => console.error('Error registrando cancelación:', err))
    limpiarVenta()
    setMostrarConfirmarCancelar(false)
  }

  function limpiarVenta() {
    setCarrito([])
    setCliente({ ...CLIENTE_DEFAULT })
    setDescuentosGrupoRubros({})
    setBusquedaArt('')
    setBusquedaCliente('')
    setPedidoEnProceso(null)
    setGiftCardsEnVenta([])
    setMostrarAgregarGC(false)
    // Regenerar ticketUid para el próximo ticket
    setTickets(prev => {
      const idx = ticketActivoRef.current
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], ticketUid: crypto.randomUUID() }
      return nuevo
    })
  }

  // --- Pedido Wizard Hook ---
  const pedidoWizard = usePedidoWizard({
    carrito,
    cliente,
    setCliente,
    terminalConfig,
    total,
    subtotal,
    descuentoTotal,
    promosAplicadas,
    limpiarVenta,
    precioConDescEmpleado,
    isOnline,
    cierreActivo,
    pedidoEnProceso,
    saldoCliente,
    actualizarPendientes,
    setPedidosRefreshKey,
    setVistaActiva,
    turnoPedidoProp: null,
  })
  const {
    cargandoPedidos,
    guardandoPedido,
    setGuardandoPedido,
    mostrarBuscarClientePedido,
    pasoPedido,
    setPasoPedido,
    fechaEntregaPedido,
    setFechaEntregaPedido,
    turnoPedido,
    setTurnoPedido,
    observacionEntregaPedido,
    setObservacionEntregaPedido,
    tarjetaRegaloPedido,
    setTarjetaRegaloPedido,
    observacionesPedidoTexto,
    setObservacionesPedidoTexto,
    bloqueosFecha,
    setBloqueosFecha,
    mostrarCobrarPedido,
    setMostrarCobrarPedido,
    cobrarPedidoExistente,
    setCobrarPedidoExistente,
    pedidoWizardDataRef,
    clientePedido,
    setClientePedido,
    busquedaClientePedido,
    setBusquedaClientePedido,
    clientesPedido,
    buscandoClientePedido,
    mostrarCrearClientePedido,
    setMostrarCrearClientePedido,
    inputClientePedidoRef,
    tipoPedidoSeleccionado,
    setTipoPedidoSeleccionado,
    direccionesPedido,
    direccionSeleccionadaPedido,
    setDireccionSeleccionadaPedido,
    sucursalesPedido,
    sucursalSeleccionadaPedido,
    setSucursalSeleccionadaPedido,
    cargandoDetallePedido,
    mostrarNuevaDirPedido,
    setMostrarNuevaDirPedido,
    nuevaDirPedido,
    setNuevaDirPedido,
    guardandoDirPedido,
    editandoDirPedido,
    setEditandoDirPedido,
    guardandoEditDirPedido,
    cerrarWizardPedido,
    seleccionarClienteParaPedido,
    onClientePedidoCreado,
    seleccionarTipoPedido,
    guardarNuevaDirPedido,
    guardarEditDirPedido,
    confirmarPedidoWizard,
    finalizarPedidoWizard,
    guardarPedidoYGenerarLink,
    handleEsPedido,
    guardarComoPedidoConCliente,
    handleCobroPedidoExitoso,
    handleCobrarPedidoEnCaja,
  } = pedidoWizard

  // Descuento por grupo de cliente (por rubro, con fallback al % general)
  const { descuentoGrupoCliente, descuentoGrupoDetalle } = useMemo(() => {
    if (cliente.grupo_descuento_porcentaje <= 0) return { descuentoGrupoCliente: 0, descuentoGrupoDetalle: [] }
    const pctGeneral = cliente.grupo_descuento_porcentaje
    const tieneRubros = Object.keys(descuentosGrupoRubros).length > 0
    const rubroMap = {} // { rubroNombre: { rubro, porcentaje, descuento } }
    for (const item of carrito) {
      const rubroNombre = item.articulo.rubro?.nombre || 'Sin rubro'
      const precio = item.precioOverride != null ? item.precioOverride : (item.articulo.precio || 0)
      const pct = tieneRubros ? (descuentosGrupoRubros[rubroNombre] ?? pctGeneral) : pctGeneral
      const desc = Math.round(precio * item.cantidad * pct / 100 * 100) / 100
      if (!rubroMap[rubroNombre]) {
        rubroMap[rubroNombre] = { rubro: rubroNombre, porcentaje: pct, descuento: 0 }
      }
      rubroMap[rubroNombre].descuento += desc
    }
    const detalle = Object.values(rubroMap).filter(d => d.descuento > 0)
    const totalDesc = Math.round(detalle.reduce((s, d) => s + d.descuento, 0) * 100) / 100
    return { descuentoGrupoCliente: totalDesc, descuentoGrupoDetalle: detalle }
  }, [carrito, cliente.grupo_descuento_porcentaje, descuentosGrupoRubros])
  const totalConDescGrupo = Math.round((total - descuentoGrupoCliente) * 100) / 100

  const totalGiftCardsEnVenta = giftCardsEnVenta.reduce((s, g) => s + g.monto, 0)
  const totalConGiftCards = totalConDescGrupo + totalGiftCardsEnVenta

  async function agregarGiftCardAVenta() {
    if (carrito.length > 0) return // No mezclar gift cards con artículos
    if (!gcCodigo.trim() || !gcMonto || parseFloat(gcMonto) <= 0) return
    if (gcCodigo.trim().length !== 19) {
      setGcError('El código debe tener exactamente 19 dígitos')
      return
    }
    if (giftCardsEnVenta.some(g => g.codigo === gcCodigo.trim())) {
      setGcError('Esta gift card ya fue agregada')
      return
    }
    // Verificar que el código no exista ya en el sistema
    try {
      const { data } = await api.get(`/api/gift-cards/consultar/${encodeURIComponent(gcCodigo.trim())}`)
      if (data.gift_card) {
        setGcError('Este código de gift card ya existe en el sistema')
        return
      }
    } catch (err) {
      // 404 = no existe, está bien, se puede crear
      if (err.response?.status !== 404) {
        setGcError('Error al verificar el código')
        return
      }
    }
    setGiftCardsEnVenta(prev => [...prev, {
      codigo: gcCodigo.trim(),
      monto: parseFloat(gcMonto),
      comprador_nombre: gcComprador.trim() || null,
    }])
    setGcCodigo('')
    setGcMonto('')
    setGcComprador('')
    setGcError('')
    setMostrarAgregarGC(false) // cierra el modal
  }

  function quitarGiftCardDeVenta(codigo) {
    setGiftCardsEnVenta(prev => prev.filter(g => g.codigo !== codigo))
  }

  // Callback desde tab Pedidos: cargar pedido al carrito para entregar
  function handleEntregarPedido(pedido) {
    const itemsPedido = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items
    const nuevoCarrito = itemsPedido.map(item => ({
      articulo: {
        id: item.id,
        codigo: item.codigo || '',
        nombre: item.nombre,
        precio: item.precio,
        esPesable: item.esPesable || false,
        descuento1: 0, descuento2: 0, descuento3: 0,
      },
      cantidad: item.cantidad,
      precioOverride: item.precio,
    }))
    setCarrito(nuevoCarrito)
    if (pedido.nombre_cliente) {
      setCliente({
        id_centum: pedido.id_cliente_centum || 0,
        razon_social: pedido.nombre_cliente,
        lista_precio_id: 1,
        email: pedido.email_cliente || '',
        celular: pedido.celular_cliente || '',
      })
    }
    const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO') || (pedido.observaciones || '').includes('TALO PAY')
    const totalPagado = parseFloat(pedido.total_pagado) || 0
    setPedidoEnProceso({
      id: pedido.id, numero: pedido.numero, esPagado, totalPagado,
      ventaAnticipadaId: pedido.venta_anticipada_id || null,
      pagos: pedido.pagos || null,
      descuento_forma_pago: pedido.descuento_forma_pago || null,
      caja_cobro_id: pedido.caja_cobro_id || null,
      mp_payment_id: pedido.mp_payment_id || null,
    })
    setVistaActiva('venta')
  }

  // Callback desde tab Pedidos: cargar pedido al carrito para editar
  function handleEditarPedido(pedido) {
    const itemsPedido = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items
    const nuevoCarrito = itemsPedido.map(item => ({
      articulo: {
        id: item.id,
        codigo: item.codigo || '',
        nombre: item.nombre,
        precio: item.precio,
        esPesable: item.esPesable || false,
        descuento1: 0, descuento2: 0, descuento3: 0,
      },
      cantidad: item.cantidad,
      precioOverride: item.precio,
    }))
    setCarrito(nuevoCarrito)
    if (pedido.nombre_cliente) {
      setCliente({
        id_centum: pedido.id_cliente_centum || 0,
        razon_social: pedido.nombre_cliente,
        lista_precio_id: 1,
        email: pedido.email_cliente || '',
        celular: pedido.celular_cliente || '',
      })
    }
    const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO') || (pedido.observaciones || '').includes('TALO PAY')
    const totalPagado = parseFloat(pedido.total_pagado) || 0
    // Extraer dirección de observaciones
    const obsMatch = (pedido.observaciones || '').match(/Dirección: ([^|]+)/)
    const direccionTexto = obsMatch ? obsMatch[1].trim() : ''
    const pedidoData = {
      id: pedido.id, numero: pedido.numero, esPagado, totalPagado, editando: true,
      observaciones: pedido.observaciones || '',
      tipo: pedido.tipo || 'retiro',
      fecha_entrega: pedido.fecha_entrega || '',
      direccion_entrega: direccionTexto,
      direccionesCliente: [],
      turno_entrega: pedido.turno_entrega || '',
      sucursal_id: pedido.sucursal_id || '',
      ventaAnticipadaId: pedido.venta_anticipada_id || null,
    }
    setPedidoEnProceso(pedidoData)
    // Cargar campos extras del pedido
    const obsEntregaMatch = (pedido.observaciones || '').match(/ENTREGA:\s*(.+?)(?:\s*\|(?=[A-Z]+:)|$)/)
    setObservacionEntregaPedido(obsEntregaMatch ? obsEntregaMatch[1].trim() : '')
    setTarjetaRegaloPedido(pedido.tarjeta_regalo || '')
    setObservacionesPedidoTexto(pedido.observaciones_pedido || '')
    setVistaActiva('venta')

    // Cargar direcciones del cliente en background
    if (pedido.id_cliente_centum) {
      api.get(`/api/clientes/por-centum/${pedido.id_cliente_centum}/direcciones`)
        .then(({ data }) => {
          if (data?.length) {
            setPedidoEnProceso(prev => prev ? { ...prev, direccionesCliente: data } : prev)
          }
        })
        .catch(err => console.error('Error loading client addresses:', err.message))
    }
  }

  // Guardar edición de pedido (PUT) desde la vista POS
  async function handleGuardarEdicionPedido() {
    if (!pedidoEnProceso || carrito.length === 0) return

    const items = carrito.map(i => ({
      id: i.articulo.id,
      codigo: i.articulo.codigo,
      nombre: i.articulo.nombre,
      precio: i.precioOverride != null ? i.precioOverride : i.articulo.precio,
      cantidad: i.cantidad,
      esPesable: i.articulo.esPesable || false,
      rubro: i.articulo.rubro?.nombre || null,
    }))
    const nuevoTotal = items.reduce((sum, i) => sum + (i.precio * i.cantidad), 0)
    const totalPagado = pedidoEnProceso.totalPagado || 0

    // Validar perecederos
    if (pedidoEnProceso.fecha_entrega) {
      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
      const manana = new Date()
      manana.setDate(manana.getDate() + 1)
      const mananaISO = manana.toISOString().split('T')[0]
      const tienePerecedor = carrito.some(i => {
        const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
        return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
      })
      if (tienePerecedor && pedidoEnProceso.fecha_entrega > mananaISO) {
        alert('Los pedidos con Fiambres, Quesos o Frescos no pueden tener fecha de entrega mayor a mañana.')
        return
      }
    }

    // Validar campos obligatorios para delivery
    if (pedidoEnProceso.tipo === 'delivery') {
      if (!pedidoEnProceso.turno_entrega) {
        alert('Seleccioná un turno de entrega (AM o PM) para pedidos delivery.')
        return
      }
      if (!pedidoEnProceso.direccion_entrega?.trim()) {
        alert('Completá la dirección de entrega para pedidos delivery.')
        return
      }
    }

    // Si el pedido estaba pagado y el nuevo total es menor, confirmar generación de saldo
    if (totalPagado > 0 && nuevoTotal < totalPagado) {
      const diferencia = totalPagado - nuevoTotal
      if (!confirm(`Se generará saldo a favor de ${formatPrecio(diferencia)} para el cliente.\n\n¿Guardar cambios?`)) return
    }

    setGuardandoPedido(true)
    try {
      // Reconstruir observaciones con entrega si corresponde
      let obsActualizada = pedidoEnProceso.observaciones || ''
      // Quitar entrega vieja si existía
      obsActualizada = obsActualizada.replace(/\s*\|?\s*ENTREGA:\s*.+?(?:\s*\|(?=[A-Z]+:)|$)/, '').trim()
      if (observacionEntregaPedido.trim()) {
        obsActualizada = obsActualizada
          ? `${obsActualizada} | ENTREGA: ${observacionEntregaPedido.trim()}`
          : `ENTREGA: ${observacionEntregaPedido.trim()}`
      }
      await api.put(`/api/pos/pedidos/${pedidoEnProceso.id}`, {
        items,
        total: nuevoTotal,
        observaciones: obsActualizada || null,
        tipo: pedidoEnProceso.tipo,
        fecha_entrega: pedidoEnProceso.fecha_entrega || null,
        direccion_entrega: pedidoEnProceso.tipo === 'delivery' ? pedidoEnProceso.direccion_entrega : null,
        nombre_cliente: cliente.razon_social || null,
        id_cliente_centum: cliente.id_centum || 0,
        turno_entrega: pedidoEnProceso.tipo === 'delivery' ? (pedidoEnProceso.turno_entrega || null) : null,
        sucursal_id: pedidoEnProceso.tipo === 'delivery' ? 'c254cac8-4c6e-4098-9119-485d7172f281' : pedidoEnProceso.sucursal_id || null,
        tarjeta_regalo: tarjetaRegaloPedido.trim() || null,
        observaciones_pedido: observacionesPedidoTexto.trim() || null,
      })
      alert(`Pedido #${pedidoEnProceso.numero} actualizado`)
      limpiarVenta()
      setVistaActiva('pedidos')
    } catch (err) {
      console.error('Error al guardar edición del pedido:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  // Marcar pedido como entregado en backend
  async function marcarPedidoEntregado(pedidoId) {
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/estado`, { estado: 'entregado', caja_id: terminalConfig?.caja_id || null })
    } catch (err) {
      console.error('Error marcando pedido como entregado:', err)
    }
  }

  // Entregar pedido ya pagado: crear la venta (con descuento) y marcar como entregado
  async function handleEntregarPedidoPagado() {
    if (!pedidoEnProceso || carrito.length === 0) return

    const totalPagado = pedidoEnProceso.totalPagado || 0
    // Calcular total efectivo considerando descuento forma pago del pedido
    const descFormaPago = pedidoEnProceso.descuento_forma_pago
    const descuentoTotal = descFormaPago?.total || 0
    const totalConDescuento = Math.round((total - descuentoTotal) * 100) / 100
    const difRaw = totalConDescuento - totalPagado
    // Tolerancia de $1 por redondeo a centenas del efectivo
    const diferencia = Math.abs(difRaw) < 1 ? 0 : difRaw

    // Si falta cobrar pero el cliente tiene saldo, descontar automáticamente
    let saldoAplicadoEntrega = 0
    if (diferencia > 0.01 && saldoCliente > 0) {
      saldoAplicadoEntrega = Math.min(saldoCliente, diferencia)
    }
    const faltante = diferencia - saldoAplicadoEntrega

    // Si aún falta cobrar después de aplicar saldo, no permitir
    if (faltante > 0.01) {
      alert(`Falta cobrar ${formatPrecio(faltante)} antes de entregar.`)
      return
    }

    // Si sobró dinero (pagó de más), generar saldo a favor
    if (diferencia < -0.01) {
      if (!confirm(`El cliente pagó ${formatPrecio(totalPagado)} pero el total actual es ${formatPrecio(totalConDescuento)}.\nSe generará saldo a favor de ${formatPrecio(Math.abs(diferencia))}.\n\n¿Continuar?`)) return
    }

    setGuardandoPedido(true)
    try {
      // Si ya existe venta anticipada (pedidos legacy), solo marcar entregado
      if (pedidoEnProceso.ventaAnticipadaId) {
        await marcarPedidoEntregado(pedidoEnProceso.id)
        limpiarVenta()
        return
      }

      // Crear venta al entregar con los datos de pago del pedido
      const items = carrito.map(i => ({
        id_articulo: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio_unitario: i.precioOverride != null ? i.precioOverride : precioConDescEmpleado(i.articulo),
        cantidad: i.cantidad,
        iva_tasa: i.articulo.iva?.tasa || 21,
        rubro: i.articulo.rubro?.nombre || null,
        subRubro: i.articulo.subRubro?.nombre || null,
      }))

      // Usar pagos del pedido si existen, sino fallback
      // Si el pedido fue pagado con Talo Pay (mp_payment_id presente y pagos null), marcar como 'Talo Pay'
      const esTaloPay = !pedidoEnProceso.pagos && pedidoEnProceso.mp_payment_id
      const pagosVenta = pedidoEnProceso.pagos || [
        { tipo: esTaloPay ? 'Talo Pay' : 'Pago anticipado', monto: totalPagado, detalle: null },
      ]

      // Si la diferencia entre total y pagado es < $1 (redondeo centenas), igualar para que no falle validación
      const montoPagadoFinal = (totalPagado + saldoAplicadoEntrega)
      const montoAjustado = Math.abs(totalConDescuento - montoPagadoFinal) < 1 ? totalConDescuento : montoPagadoFinal

      const payload = {
        id_cliente_centum: cliente.id_centum,
        nombre_cliente: cliente.razon_social,
        caja_id: pedidoEnProceso.caja_cobro_id || terminalConfig?.caja_id || null,
        items,
        promociones_aplicadas: null,
        subtotal: total,
        descuento_total: descuentoTotal,
        total: totalConDescuento,
        monto_pagado: montoAjustado,
        vuelto: 0,
        pagos: [
          ...pagosVenta,
          ...(saldoAplicadoEntrega > 0 ? [{ tipo: 'Saldo', monto: saldoAplicadoEntrega, detalle: null }] : []),
        ],
        descuento_forma_pago: descFormaPago || null,
        pedido_pos_id: pedidoEnProceso.id,
      }
      if (saldoAplicadoEntrega > 0) {
        payload.saldo_aplicado = saldoAplicadoEntrega
      }
      await api.post('/api/pos/ventas', payload)
      await marcarPedidoEntregado(pedidoEnProceso.id)
      limpiarVenta()
    } catch (err) {
      console.error('Error al entregar pedido pagado:', err)
      alert('Error al guardar venta: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardandoPedido(false)
    }
  }

  function handleVentaExitosa() {
    setMostrarCobrar(false)
    // Si hay pedido en proceso, marcarlo como entregado
    if (pedidoEnProceso) {
      marcarPedidoEntregado(pedidoEnProceso.id)
    }
    setCarrito([])
    setCliente({ ...CLIENTE_DEFAULT })
    setDescuentosGrupoRubros({})
    setBusquedaArt('')
    setPedidoEnProceso(null)
    setGiftCardsEnVenta([])
    // Regenerar ticketUid para el próximo ticket
    setTickets(prev => {
      const idx = ticketActivoRef.current
      const nuevo = [...prev]
      nuevo[idx] = { ...nuevo[idx], ticketUid: crypto.randomUUID() }
      return nuevo
    })
    syncVentasPendientes().then(() => actualizarPendientes()).catch(err => console.error('Error syncing pending sales:', err.message))
  }

  // Pedido wizard functions are now provided by usePedidoWizard hook


  const cantidadItems = carrito.reduce((s, i) => s + i.cantidad, 0)

  // Pantallas de configuración de terminal (antes del POS principal)
  if (necesitaConfig) {
    return <ConfigurarTerminal onConfigurar={handleConfigurarTerminal} configActual={null} />
  }

  if (mostrarConfigTerminal) {
    return <ConfigurarTerminal onConfigurar={handleConfigurarTerminal} configActual={terminalConfig} />
  }

  // Verificando si la caja está abierta
  if (verificandoCaja) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
          <span className="text-sm text-gray-400">Verificando caja...</span>
        </div>
      </div>
    )
  }

  // Caja no abierta — mostrar pantalla de apertura
  if (!cierreActivo) {
    return <AbrirCajaPOS terminalConfig={terminalConfig} onCajaAbierta={setCierreActivo} />
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden" onClick={handlePOSClick}>
      {/* Barra tipo Chrome: tabs + info terminal */}
      <div className={`${modoDelivery ? 'bg-orange-800' : 'bg-violet-900'} flex-shrink-0 transition-colors`}>
        <div className="flex items-center justify-between">
          {/* Izquierda: botón volver + tabs */}
          <div className="flex items-center">
            {/* Tab Venta */}
            <button
              onClick={() => setVistaActiva('venta')}
              className={`relative px-3 py-1.5 text-xs font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'venta'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Venta <span className="text-[10px] opacity-60 ml-1">F1</span>
            </button>

            {/* Tab Pedidos */}
            <button
              onClick={() => setVistaActiva('pedidos')}
              className={`relative px-3 py-1.5 text-xs font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'pedidos'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Pedidos <span className="text-[10px] opacity-60 ml-1">F2</span>
            </button>

            {/* Tab Saldos */}
            <button
              onClick={() => setVistaActiva('saldos')}
              className={`relative px-3 py-1.5 text-xs font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'saldos'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Saldos <span className="text-[10px] opacity-60 ml-1">F3</span>
            </button>

            {/* Tab Gift Cards */}
            <button
              onClick={() => setVistaActiva('giftcards')}
              className={`relative px-3 py-1.5 text-xs font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'giftcards'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Gift Cards <span className="text-[10px] opacity-60 ml-1">F4</span>
            </button>

            {/* Tab Consulta */}
            <button
              onClick={() => setVistaActiva('consulta')}
              className={`relative px-3 py-1.5 text-xs font-medium transition-colors rounded-t-lg mt-1 ${
                vistaActiva === 'consulta'
                  ? 'bg-violet-700 text-white'
                  : 'text-violet-400 hover:text-violet-200 hover:bg-violet-800/50'
              }`}
            >
              Consulta <span className="text-[10px] opacity-60 ml-1">F5</span>
            </button>

          </div>

          {/* Derecha: info terminal + config */}
          <div className="flex items-center gap-1.5 pr-3 text-xs">
            <span className="text-violet-300">{terminalConfig?.sucursal_nombre}</span>
            <span className="bg-violet-700 text-violet-100 px-2 py-0.5 rounded font-medium">{terminalConfig?.caja_nombre}</span>
            <span className="text-violet-300">|</span>
            <span className="text-violet-200 font-medium">Cajero: {cierreActivo?.empleado?.nombre || usuario?.nombre}</span>
            {/* Botón Delivery */}
            <button
              onClick={toggleModoDelivery}
              className={`${modoDelivery
                ? 'bg-orange-500 hover:bg-orange-600 text-white animate-pulse'
                : 'bg-orange-900/40 hover:bg-orange-500 text-orange-200 hover:text-white'
              } px-2 py-1 rounded font-semibold transition-colors flex items-center gap-1`}
              title={modoDelivery ? 'Desactivar modo delivery' : 'Activar modo delivery'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21a.375.375 0 00.375-.375v-3.375a3 3 0 00-3-3h-1.5m-6.375 7.5H10.5m0 0h-1.875M10.5 18.75v-7.5m0 0h6v1.875M10.5 11.25L3.375 11.25M16.5 13.125v-1.875m0 0L21 11.25" />
              </svg>
              Delivery{modoDelivery ? ' ✕' : ''}
            </button>
            {empleadoActivo ? (
              <button
                onClick={() => { setEmpleadoActivo(null); setDescuentosEmpleado({}); setCarrito([]); }}
                className="bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded font-semibold transition-colors flex items-center gap-1 animate-pulse"
                title="Desactivar modo empleado"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                {empleadoActivo.nombre}
                {empleadoActivo.disponible != null && (
                  <span className="bg-orange-700 text-orange-100 text-[10px] px-1.5 py-0.5 rounded ml-1">
                    Disp: {formatPrecio(empleadoActivo.disponible - total)}
                  </span>
                )}
                ✕
              </button>
            ) : (
              <button
                onClick={() => setMostrarVentaEmpleado(true)}
                disabled={modoDelivery}
                className={`${modoDelivery ? 'opacity-30 cursor-not-allowed' : 'bg-orange-900/40 hover:bg-orange-500 text-orange-200 hover:text-white'} px-2 py-1 rounded font-semibold transition-colors flex items-center gap-1`}
                title={modoDelivery ? 'Desactivado en modo delivery' : 'Venta a empleado (cta cte)'}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                Empleado
              </button>
            )}
            <button
              onClick={() => window.open('/fichaje', '_blank')}
              className="bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1 rounded font-semibold transition-colors flex items-center gap-1"
              title="Registrar asistencia"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Asistencia
            </button>
            <button
              onClick={() => setMostrarProblema(true)}
              className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded font-semibold transition-colors flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
              </svg>
              PROBLEMA <span className="text-[10px] opacity-70">F8</span>
            </button>
            <span className="text-violet-300 text-xs font-medium opacity-70">{cierreActivo?.numero ? `#${cierreActivo.numero}` : ''}</span>
            <button
              onClick={() => setMostrarCerrarCaja(true)}
              className="text-violet-400 hover:text-red-300 px-1.5 py-0.5 rounded transition-colors flex items-center gap-1"
              title="Cerrar caja"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <span>Cerrar Caja</span>
            </button>
            <button
              onClick={() => setMostrarActualizaciones(true)}
              className="text-violet-400 hover:text-white px-1.5 py-0.5 rounded transition-colors text-[11px] font-medium"
              title="Ver actualizaciones de precios"
            >
              Actualizaciones
            </button>
            <button
              onClick={sincronizarPrecios}
              disabled={sincronizandoERP}
              className="text-violet-400 hover:text-white p-1 rounded transition-colors disabled:opacity-50"
              title="Sincronizar precios desde Centum (F12)"
            >
              <svg className={`w-3.5 h-3.5 ${sincronizandoERP ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.66v4.993" />
              </svg>
            </button>
            {esAdmin && (
              <button
                onClick={() => setMostrarConfigTerminal(true)}
                className="text-violet-400 hover:text-white p-1 rounded transition-colors"
                title="Reconfigurar terminal"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* === TAB PEDIDOS === */}
      {vistaActiva === 'pedidos' && (
        <div className="flex-1 overflow-hidden">
          <PedidosPOS key={pedidosRefreshKey} embebido terminalConfig={terminalConfig} onEntregarPedido={handleEntregarPedido} onEditarPedido={handleEditarPedido} onCobrarEnCaja={handleCobrarPedidoEnCaja} />
        </div>
      )}

      {/* === TAB SALDOS === */}
      {vistaActiva === 'saldos' && (
        <div className="flex-1 overflow-hidden">
          <SaldosPOS embebido />
        </div>
      )}

      {/* === TAB GIFT CARDS === */}
      {vistaActiva === 'giftcards' && (
        <div className="flex-1 overflow-hidden">
          <GiftCardsPOS embebido terminalConfig={terminalConfig} cierreActivo={cierreActivo} />
        </div>
      )}

      {/* === TAB CONSULTA === */}
      {vistaActiva === 'consulta' && (
        <div className="flex-1 overflow-hidden">
          <ConsultaPOS articulos={articulos} promociones={promociones} />
        </div>
      )}

      {/* === TAB VENTA === */}
      {vistaActiva === 'venta' && <>
      {/* Banner modo delivery */}
      {modoDelivery && (
        <div className="bg-orange-500 text-white text-center py-1.5 text-sm font-bold tracking-wide">
          MODO DELIVERY — Solo artículos y precios configurados — Sin promos ni descuentos
        </div>
      )}
      {/* Banner pedido en proceso */}
      {pedidoEnProceso && (
        <div className="bg-violet-50 border-b border-violet-200">
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm text-violet-700 font-medium">
              {pedidoEnProceso.editando ? 'Editando' : 'Entregando'} pedido {pedidoEnProceso.numero ? `#${pedidoEnProceso.numero}` : ''} de <strong>{cliente.razon_social}</strong>
              {!pedidoEnProceso.editando && (pedidoEnProceso.esPagado ? ' (ya pagado)' : ' (pendiente de cobro)')}
            </span>
            <button
              onClick={limpiarVenta}
              className="text-xs text-violet-500 hover:text-violet-700 font-medium"
            >
              Cancelar entrega
            </button>
          </div>
          {/* Controles de edición: tipo, fecha, dirección */}
          {pedidoEnProceso.editando && (
            <div className="px-4 pb-2 flex items-center gap-3 flex-wrap">
              {/* Tipo */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPedidoEnProceso(prev => ({ ...prev, tipo: 'retiro', direccion_entrega: '' }))}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${pedidoEnProceso.tipo === 'retiro' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}
                >
                  Retiro
                </button>
                <button
                  onClick={() => setPedidoEnProceso(prev => ({ ...prev, tipo: 'delivery' }))}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${pedidoEnProceso.tipo === 'delivery' ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}
                >
                  Delivery
                </button>
              </div>
              {/* Fecha */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-violet-600">Entrega:</span>
                <input
                  type="date"
                  value={pedidoEnProceso.fecha_entrega || ''}
                  onChange={e => setPedidoEnProceso(prev => ({ ...prev, fecha_entrega: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  className="text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                />
              </div>
              {/* Turno (solo delivery) */}
              {pedidoEnProceso.tipo === 'delivery' && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-violet-600">Turno:</span>
                  <select
                    value={pedidoEnProceso.turno_entrega || ''}
                    onChange={e => setPedidoEnProceso(prev => ({ ...prev, turno_entrega: e.target.value }))}
                    className="text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                  >
                    <option value="">Sin turno</option>
                    <option value="AM">AM (9-13hs)</option>
                    <option value="PM">PM (17-21hs)</option>
                  </select>
                </div>
              )}
              {/* Dirección (solo delivery) */}
              {pedidoEnProceso.tipo === 'delivery' && (
                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <span className="text-xs text-violet-600 flex-shrink-0">Dir:</span>
                  {pedidoEnProceso.direccionesCliente?.length > 0 && !pedidoEnProceso.dirManual ? (
                    <select
                      value={pedidoEnProceso.direccion_entrega || ''}
                      onChange={e => {
                        if (e.target.value === '__otra__') {
                          setPedidoEnProceso(prev => ({ ...prev, direccion_entrega: '', dirManual: true }))
                        } else {
                          setPedidoEnProceso(prev => ({ ...prev, direccion_entrega: e.target.value }))
                        }
                      }}
                      className="flex-1 text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                    >
                      <option value="">Seleccionar dirección...</option>
                      {(() => {
                        const opciones = pedidoEnProceso.direccionesCliente.map(d => ({
                          id: d.id,
                          val: `${d.direccion}${d.localidad ? `, ${d.localidad}` : ''}`,
                          principal: d.es_principal,
                        }))
                        // Si la dirección actual no coincide con ninguna opción, mostrarla también
                        const dirActual = pedidoEnProceso.direccion_entrega || ''
                        const coincide = !dirActual || opciones.some(o => o.val === dirActual)
                        return (
                          <>
                            {!coincide && <option value={dirActual}>{dirActual} (actual)</option>}
                            {opciones.map(o => (
                              <option key={o.id} value={o.val}>{o.val}{o.principal ? ' (principal)' : ''}</option>
                            ))}
                          </>
                        )
                      })()}
                      <option value="__otra__">Otra dirección...</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        type="text"
                        value={pedidoEnProceso.direccion_entrega || ''}
                        onChange={e => setPedidoEnProceso(prev => ({ ...prev, direccion_entrega: e.target.value }))}
                        placeholder="Dirección de entrega..."
                        autoFocus={pedidoEnProceso.dirManual}
                        className="flex-1 text-xs border rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-violet-400"
                      />
                      {pedidoEnProceso.dirManual && pedidoEnProceso.direccionesCliente?.length > 0 && (
                        <button
                          onClick={() => setPedidoEnProceso(prev => ({ ...prev, dirManual: false }))}
                          className="text-[10px] text-violet-600 hover:text-violet-800 whitespace-nowrap"
                        >
                          Ver guardadas
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Indicadores offline */}
      {(!isOnline || ventasPendientes > 0) && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-b">
          {!isOnline && (
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Sin conexion
            </span>
          )}
          {ventasPendientes > 0 && (
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {ventasPendientes} venta{ventasPendientes > 1 ? 's' : ''} pendiente{ventasPendientes > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">

        {/* ====== IZQUIERDA: PANEL CARRITO ====== */}
        <div className={`
          lg:w-[380px] xl:w-[420px] bg-white border-r flex flex-col flex-shrink-0
          ${carritoVisible ? 'fixed inset-0 z-20 lg:relative' : 'hidden lg:flex'}
        `}>
          {/* Tabs de tickets */}
          <div className="flex border-b bg-gray-100">
            {tickets.map((t, idx) => {
              const items = t.carrito.length
              const activo = idx === ticketActivo
              const ts = ticketTimestamps.current[idx]
              const inactivo = !activo && items > 0 && ts > 0
              const minRestantes = inactivo ? Math.max(0, Math.ceil((TICKET_TIMEOUT - (Date.now() - ts)) / 60000)) : null
              return (
                <button
                  key={idx}
                  onClick={() => { setTicketActivo(idx); setBusquedaArt(''); setBusquedaCliente('') }}
                  className={`flex-1 py-2 px-3 text-xs font-semibold transition-colors relative ${
                    activo
                      ? 'bg-white text-violet-700 border-b-2 border-violet-600'
                      : items > 0
                        ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  Ticket {idx + 1}
                  {items > 0 && (
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      activo ? 'bg-violet-100 text-violet-700' : 'bg-amber-200 text-amber-800'
                    }`}>
                      {items}
                    </span>
                  )}
                  {minRestantes != null && minRestantes <= 3 && (
                    <span className="ml-1 text-[9px] text-red-500 font-normal">{minRestantes}min</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Barra cliente */}
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {/* Fila 1: nombre, código, condición IVA, tipo factura */}
                <div className="flex items-center gap-2">
                  <span className="bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5 rounded truncate">
                    {cliente.razon_social}
                  </span>
                  {cliente.id_centum > 0 && cliente.codigo && (
                    <span className="text-gray-500 text-[10px] font-mono flex-shrink-0">{cliente.codigo}</span>
                  )}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                    cliente.condicion_iva === 'RI' ? 'bg-blue-100 text-blue-700'
                    : cliente.condicion_iva === 'MT' ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-200 text-gray-600'
                  }`}>
                    {cliente.condicion_iva === 'RI' ? 'Resp. Inscripto' : cliente.condicion_iva === 'MT' ? 'Monotributo' : 'Cons. Final'}
                  </span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                    cliente.condicion_iva === 'RI' || cliente.condicion_iva === 'MT'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    Fact {cliente.condicion_iva === 'RI' || cliente.condicion_iva === 'MT' ? 'A' : 'B'}
                  </span>
                </div>
                {/* Fila 2: grupo descuento, saldo, botones */}
                <div className="flex items-center gap-2 mt-1">
                  {cliente.grupo_descuento_nombre && (
                    <span className="bg-violet-100 text-violet-700 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      {cliente.grupo_descuento_nombre} -{cliente.grupo_descuento_porcentaje}%
                    </span>
                  )}
                  {saldoCliente > 0 && (
                    <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded">
                      Saldo: {formatPrecio(saldoCliente)}
                    </span>
                  )}
                  {cliente.id_centum > 0 && (
                    <>
                      <button
                        onClick={() => !carritoBloquedado && setMostrarEditarCliente(true)}
                        disabled={carritoBloquedado}
                        className={carritoBloquedado ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-violet-600"}
                        title="Editar cliente"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            const { data } = await api.get(`/api/clientes/refresh/${cliente.id_centum}`)
                            setCliente(prev => ({
                              ...prev,
                              razon_social: data.razon_social,
                              codigo: data.codigo || prev.codigo || '',
                              cuit: data.cuit,
                              condicion_iva: data.condicion_iva || 'CF',
                              email: data.email || '',
                              celular: data.celular || '',
                              lista_precio_id: data.lista_precio_id || 1,
                            }))
                            setToastMsg('Datos del cliente actualizados')
                            setTimeout(() => setToastMsg(null), 3000)
                          } catch (err) {
                            console.error('Error refrescando cliente:', err)
                            setToastMsg('Error al actualizar cliente')
                            setTimeout(() => setToastMsg(null), 3000)
                          }
                        }}
                        className="text-gray-400 hover:text-violet-600"
                        title="Actualizar datos del cliente"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => { if (carritoBloquedado) return; setCliente({ ...CLIENTE_DEFAULT }); setDescuentosGrupoRubros({}) }}
                    disabled={carritoBloquedado}
                    className={carritoBloquedado ? "text-gray-300 cursor-not-allowed" : "text-gray-400 hover:text-red-500"}
                    title="Volver a Consumidor Final"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {(cliente.condicion_iva === 'RI' || cliente.condicion_iva === 'MT') && !cliente.email && (
                  <div className="mt-1.5 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                    <span className="text-amber-500 text-sm">⚠</span>
                    <span className="text-xs font-medium text-amber-700">Sin email — no se podrá enviar comprobante</span>
                  </div>
                )}
                <div className="relative mt-2">
                  <input
                    ref={inputClienteRef}
                    type="text"
                    placeholder={carritoBloquedado ? "Cliente fijo para este pedido" : "DNI / CUIT del cliente… (F6)"}
                    value={busquedaCliente}
                    disabled={carritoBloquedado}
                    onChange={e => { if (carritoBloquedado) return; const v = e.target.value.replace(/[^0-9-]/g, ''); setBusquedaCliente(v); setClienteIdx(-1) }}
                    onKeyDown={e => {
                      const dropdownVisible = clientesCentum.length > 0 || (busquedaCliente.trim().length >= 2 && !buscandoClientes)
                      const maxIdx = clientesCentum.length // último índice = "Crear cliente nuevo"
                      if (e.key === 'ArrowDown' && dropdownVisible) {
                        e.preventDefault()
                        setClienteIdx(prev => prev < maxIdx ? prev + 1 : 0)
                      } else if (e.key === 'ArrowUp' && dropdownVisible) {
                        e.preventDefault()
                        setClienteIdx(prev => prev > 0 ? prev - 1 : maxIdx)
                      } else if (e.key === 'Enter' && clienteIdx >= 0 && clienteIdx < clientesCentum.length) {
                        e.preventDefault()
                        seleccionarCliente(clientesCentum[clienteIdx])
                        setClienteIdx(-1)
                      } else if (e.key === 'Enter' && clienteIdx === clientesCentum.length && dropdownVisible) {
                        e.preventDefault()
                        setMostrarCrearClienteCaja(true)
                        setClientesCentum([])
                        setClienteIdx(-1)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setBusquedaCliente('')
                        setClientesCentum([])
                        setClienteIdx(-1)
                      }
                    }}
                    className="w-full border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                  />
                  {buscandoClientes && (
                    <div className="absolute right-2 top-1 text-gray-500 text-[10px]">Buscando...</div>
                  )}
                  {seleccionandoCliente && (
                    <div className="absolute right-2 top-1 text-violet-600 text-[10px] flex items-center gap-1">
                      <div className="animate-spin h-3 w-3 border-2 border-violet-400 border-t-transparent rounded-full" />
                      Verificando...
                    </div>
                  )}
                  {(clientesCentum.length > 0 || (busquedaCliente.trim().length >= 2 && !buscandoClientes)) && (
                    <div className="absolute z-20 w-full bg-white border rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {(() => {
                        // Detectar CUITs duplicados en los resultados
                        const cuitCount = {}
                        clientesCentum.forEach(c => {
                          const cuit = (c.cuit || '').replace(/\D/g, '')
                          if (cuit.length >= 7) cuitCount[cuit] = (cuitCount[cuit] || 0) + 1
                        })
                        return clientesCentum.map((cli, idx) => {
                          const cuitNorm = (cli.cuit || '').replace(/\D/g, '')
                          const esDuplicado = cuitNorm.length >= 7 && cuitCount[cuitNorm] > 1
                          return (
                            <button
                              key={cli.id || cli.id_centum}
                              onClick={() => { seleccionarCliente(cli); setClienteIdx(-1) }}
                              className={`w-full text-left px-2 py-1.5 text-xs border-b last:border-b-0 ${esDuplicado ? 'bg-amber-50 border-l-2 border-l-amber-400' : ''} ${idx === clienteIdx ? 'bg-violet-100' : 'hover:bg-violet-50'}`}
                            >
                              <div className="flex items-center gap-1">
                                <span className="font-medium">{cli.razon_social}</span>
                                {cli.codigo && <span className="text-gray-400 text-[10px]">({cli.codigo})</span>}
                              </div>
                              <div className="flex items-center gap-1">
                                {cli.cuit && <span className="text-gray-500">CUIT: {cli.cuit}</span>}
                                {cli.condicion_iva && cli.condicion_iva !== 'CF' && (
                                  <span className={`text-[10px] px-1 rounded ${cli.condicion_iva === 'RI' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {cli.condicion_iva}
                                  </span>
                                )}
                                {esDuplicado && (
                                  <span className="text-[10px] px-1 rounded bg-amber-200 text-amber-800 font-medium">CUIT duplicado</span>
                                )}
                              </div>
                            </button>
                          )
                        })
                      })()}
                      <button
                        onClick={() => { setMostrarCrearClienteCaja(true); setClientesCentum([]); setClienteIdx(-1) }}
                        className={`w-full text-left px-2 py-2 text-xs border-t border-dashed border-gray-300 text-violet-600 font-medium flex items-center gap-1.5 ${clienteIdx === clientesCentum.length ? 'bg-violet-100' : 'hover:bg-violet-50'}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        Crear cliente nuevo
                      </button>
                    </div>
                  )}
                  {mostrarCrearClienteCaja && (
                    <NuevoClienteModal
                      onClose={() => setMostrarCrearClienteCaja(false)}
                      onCreado={(cli) => {
                        setMostrarCrearClienteCaja(false)
                        setBusquedaCliente('')
                        seleccionarCliente(cli)
                      }}
                      cuitInicial={busquedaCliente.trim()}
                    />
                  )}
                  {mostrarEditarCliente && (
                    <EditarClienteModal
                      cliente={cliente}
                      onClose={() => setMostrarEditarCliente(false)}
                      onGuardado={(cli) => {
                        setCliente(prev => ({ ...prev, ...cli }))
                        setMostrarEditarCliente(false)
                        setToastMsg('Cliente actualizado')
                        setTimeout(() => setToastMsg(null), 3000)
                      }}
                    />
                  )}
                </div>
              </div>
              {/* Cerrar carrito (mobile) */}
              <button
                onClick={() => setCarritoVisible(false)}
                className="lg:hidden text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {cliente.id_centum > 0 && !carritoBloquedado && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="email"
                  placeholder="Email"
                  value={cliente.email || ''}
                  onChange={e => setCliente({ ...cliente, email: e.target.value })}
                  className="flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                />
                <input
                  type="tel"
                  placeholder="Tel / Cel"
                  value={cliente.celular || ''}
                  onChange={e => setCliente({ ...cliente, celular: e.target.value })}
                  className="flex-1 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                />
                <button
                  onClick={guardarContactoCliente}
                  disabled={guardandoContacto}
                  className="bg-violet-600 text-white text-[10px] px-2 py-0.5 rounded hover:bg-violet-700 disabled:opacity-50 flex-shrink-0"
                >
                  {guardandoContacto ? '...' : 'Guardar'}
                </button>
              </div>
            )}
          </div>

          {/* Banner modo empleado */}
          {empleadoActivo && (
            <div className="bg-orange-500 text-white px-3 py-1.5 flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-3">
                <span>Retiro empleado: {empleadoActivo.nombre}</span>
                {empleadoActivo.disponible != null && (
                  <span className="bg-orange-700/60 text-orange-100 text-xs px-2 py-0.5 rounded">
                    Disponible: {formatPrecio(Math.max(0, empleadoActivo.disponible - total))}
                  </span>
                )}
              </div>
              <button onClick={() => { setEmpleadoActivo(null); setDescuentosEmpleado({}); setCarrito([]) }} className="text-orange-200 hover:text-white text-xs underline">
                Cancelar
              </button>
            </div>
          )}

          {/* Items del carrito */}
          <div className="flex-1 overflow-y-auto">
            {carrito.length === 0 && giftCardsEnVenta.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                {empleadoActivo ? 'Agregá artículos para el retiro' : 'Carrito vacío'}
              </div>
            ) : (
              <div className="divide-y">
                {carrito.map((item, itemIdx) => {
                  const precioBase = calcularPrecioConDescuentosBase(item.articulo)
                  const precioDescEmpleado = precioConDescEmpleado(item.articulo)
                  const precioOriginal = precioDescEmpleado
                  // Mostrar precio base (sin desc empleado) para consistencia con subtotal
                  const precioDisplay = empleadoActivo ? precioBase : precioDescEmpleado
                  const precioUnit = item.precioOverride != null ? item.precioOverride : precioDisplay
                  const lineTotal = precioUnit * item.cantidad
                  const tieneOverride = item.precioOverride != null
                  const estaEditando = editandoPrecio === item.articulo.id
                  const seleccionadoEnCarrito = carritoIdx === itemIdx
                  return (
                    <div key={item.articulo.id} className={`px-3 py-2 ${seleccionadoEnCarrito ? 'bg-violet-100 border-l-4 border-l-violet-600' : 'hover:bg-gray-50/80'}`} ref={seleccionadoEnCarrito ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate flex-1">{item.articulo.nombre} <span className="text-[10px] text-gray-400 font-normal">{item.articulo.codigo}</span></span>
                        <span className="text-sm font-bold text-gray-800 flex-shrink-0">{formatPrecio(lineTotal)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => !carritoBloquedado && cambiarCantidad(item.articulo.id, -1, item.articulo.esPesable)}
                            disabled={carritoBloquedado}
                            className={`w-6 h-6 rounded flex items-center justify-center text-sm font-bold ${carritoBloquedado ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-300 hover:bg-gray-400 text-gray-700'}`}
                          >−</button>
                          {item.articulo.esPesable ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              defaultValue={item.cantidad}
                              key={`${item.articulo.id}-${item.cantidad}`}
                              onBlur={e => {
                                const val = parseFloat(e.target.value)
                                if (!isNaN(val) && val > 0) setCantidadDirecta(item.articulo.id, val)
                                else e.target.value = item.cantidad
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                              onClick={e => e.target.select()}
                              className="w-16 text-center text-sm font-semibold border rounded px-1 py-0.5 focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                            />
                          ) : (
                            <span className="w-7 text-center text-sm font-semibold">{item.cantidad}</span>
                          )}
                          <button
                            onClick={() => !carritoBloquedado && cambiarCantidad(item.articulo.id, 1, item.articulo.esPesable)}
                            disabled={carritoBloquedado}
                            className={`w-6 h-6 rounded flex items-center justify-center text-sm font-bold ${carritoBloquedado ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-violet-100 hover:bg-violet-200 text-violet-700'}`}
                          >+</button>
                        </div>
                        {item.articulo.esPesable && <span className="text-[10px] text-amber-600 font-medium">kg</span>}
                        {estaEditando ? (
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={precioUnit}
                            autoFocus
                            onClick={e => e.target.select()}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const val = parseFloat(e.target.value)
                                if (!isNaN(val) && val >= 0 && val !== precioOriginal) {
                                  setPendientePrecio({ articuloId: item.articulo.id, nuevoPrecio: val, precioOriginal, nombreArticulo: item.articulo.nombre })
                                } else if (val === precioOriginal) {
                                  setPrecioOverride(item.articulo.id, null)
                                }
                                setEditandoPrecio(null)
                              } else if (e.key === 'Escape') {
                                setEditandoPrecio(null)
                              }
                            }}
                            onBlur={e => {
                              const val = parseFloat(e.target.value)
                              if (!isNaN(val) && val >= 0 && val !== precioOriginal) {
                                setPendientePrecio({ articuloId: item.articulo.id, nuevoPrecio: val, precioOriginal, nombreArticulo: item.articulo.nombre })
                              } else if (val === precioOriginal) {
                                setPrecioOverride(item.articulo.id, null)
                              }
                              setEditandoPrecio(null)
                            }}
                            className="w-20 text-center text-xs font-semibold border border-violet-400 rounded px-1 py-0.5 focus:ring-1 focus:ring-violet-500 focus:border-transparent"
                          />
                        ) : (
                          <span
                            onClick={() => !carritoBloquedado && setEditandoPrecio(item.articulo.id)}
                            className={`text-xs ${carritoBloquedado ? 'text-gray-500 cursor-default' : `cursor-pointer hover:underline ${tieneOverride ? 'text-violet-600 font-semibold' : 'text-gray-500'}`}`}
                            title={carritoBloquedado ? '' : (tieneOverride ? `Motivo: ${item.motivoCambioPrecio || 'Sin motivo'}` : 'Click para editar precio')}
                          >
                            {formatPrecio(precioUnit)} {item.articulo.esPesable ? '/kg' : 'c/u'}
                          </span>
                        )}
                        {tieneOverride && !estaEditando && (
                          <button
                            onClick={() => setPrecioOverride(item.articulo.id, null)}
                            className="text-violet-400 hover:text-violet-600 p-0.5"
                            title="Restaurar precio original"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                        <div className="flex-1" />
                        <button
                          onClick={() => !carritoBloquedado && quitarDelCarrito(item.articulo.id)}
                          disabled={carritoBloquedado}
                          className={`p-0.5 ${carritoBloquedado ? 'text-gray-300 cursor-not-allowed' : 'text-red-300 hover:text-red-500'}`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Gift cards en venta — como items del carrito */}
            {giftCardsEnVenta.length > 0 && (
              <div className="divide-y divide-gray-100">
                {giftCardsEnVenta.map(gc => (
                  <div key={gc.codigo} className="px-3 py-2.5 bg-white hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-800 truncate">Gift Card {gc.codigo}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-500">1 x {formatPrecio(gc.monto)}</span>
                          {gc.comprador_nombre && <span className="text-xs text-gray-400">— {gc.comprador_nombre}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-800">{formatPrecio(gc.monto)}</span>
                        <button onClick={() => quitarGiftCardDeVenta(gc.codigo)} className="text-red-300 hover:text-red-500 p-0.5">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Promos aplicadas */}
            {promosAplicadas.length > 0 && (
              <div className="px-3 py-2 space-y-1 border-t">
                {promosAplicadas.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded px-2 py-1 text-xs text-green-700">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                    </svg>
                    <span className="flex-1 truncate">{p.promoNombre} ({p.detalle})</span>
                    <span className="font-semibold">-{formatPrecio(p.descuento)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Descuentos empleado por rubro */}
            {descEmpleadoDetalle.length > 0 && (
              <div className="px-3 py-2 space-y-1 border-t">
                {descEmpleadoDetalle.map((d, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded px-2 py-1 text-xs text-orange-700">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    <span className="flex-1 truncate">Desc. empleado {d.porcentaje}% — {d.rubro}</span>
                    <span className="font-semibold">-{formatPrecio(d.descuento)}</span>
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* Totales + botones */}
          <div className="border-t bg-gray-50 px-4 py-3">
            <div className="space-y-0.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatPrecio(descEmpleadoTotal > 0 ? subtotalSinDescEmpleado : subtotal)}</span>
              </div>
              {descEmpleadoTotal > 0 && (
                <div className="flex justify-between text-orange-600">
                  <span>Desc. empleado</span>
                  <span>-{formatPrecio(descEmpleadoTotal)}</span>
                </div>
              )}
              {descuentoTotal > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Promos</span>
                  <span>-{formatPrecio(descuentoTotal)}</span>
                </div>
              )}
              {descuentoGrupoCliente > 0 && (
                <div className="text-violet-600">
                  <div className="flex justify-between">
                    <span>{cliente.grupo_descuento_nombre}</span>
                    <span>-{formatPrecio(descuentoGrupoCliente)}</span>
                  </div>
                  {descuentoGrupoDetalle.length > 1 && descuentoGrupoDetalle.map(d => (
                    <div key={d.rubro} className="flex justify-between text-xs text-violet-400 pl-2">
                      <span>{d.rubro} ({d.porcentaje}%)</span>
                      <span>-{formatPrecio(d.descuento)}</span>
                    </div>
                  ))}
                </div>
              )}
              {totalGiftCardsEnVenta > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Gift Cards</span>
                  <span>+{formatPrecio(totalGiftCardsEnVenta)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-gray-800 pt-1 border-t">
                <span>TOTAL</span>
                <span>{formatPrecio(totalConGiftCards)}</span>
              </div>
            </div>

            {(carrito.length > 0 || giftCardsEnVenta.length > 0) && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setMostrarConfirmarCancelar(true)}
                  className="px-3 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors"
                  title="F9"
                >
                  Cancelar <span className="text-[9px] opacity-70">F9</span>
                </button>
                {/* Si está editando un pedido: botón guardar cambios */}
                {pedidoEnProceso && pedidoEnProceso.editando && (
                  <button
                    onClick={handleGuardarEdicionPedido}
                    disabled={guardandoPedido}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                  >
                    {guardandoPedido ? 'Guardando...' : `Guardar cambios #${pedidoEnProceso.numero}`}
                  </button>
                )}
                {/* Si NO hay pedido en proceso: botones normales */}
                {!pedidoEnProceso && !empleadoActivo && (
                  <>
                    <button
                      onClick={handleEsPedido}
                      disabled={guardandoPedido}
                      className="px-3 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-semibold rounded-lg transition-colors"
                      title="F10"
                    >
                      {guardandoPedido ? 'Guardando...' : <>{`Es pedido `}<span className="text-[9px] opacity-70">F10</span></>}
                    </button>
                    <button
                      onClick={handleCobrar}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                      title="F11"
                    >
                      Cobrar {formatPrecio(totalConGiftCards)} <span className="text-[9px] opacity-70">F11</span>
                    </button>
                  </>
                )}
                {/* Modo empleado activo: botón registrar retiro */}
                {!pedidoEnProceso && empleadoActivo && (
                  <button
                    onClick={() => setMostrarVentaEmpleado(true)}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                  >
                    Registrar retiro {formatPrecio(totalConGiftCards)}
                  </button>
                )}
                {/* Si hay pedido en proceso NO pagado y NO editando: cobrar primero */}
                {pedidoEnProceso && !pedidoEnProceso.editando && !pedidoEnProceso.esPagado && (
                  <button
                    onClick={handleCobrar}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-base transition-colors"
                    title="F11"
                  >
                    Cobrar {formatPrecio(totalConGiftCards)}
                  </button>
                )}
                {/* Si hay pedido en proceso YA pagado y NO editando: entregar directo */}
                {pedidoEnProceso && !pedidoEnProceso.editando && pedidoEnProceso.esPagado && (() => {
                  const dif = total - (pedidoEnProceso.totalPagado || 0)
                  const saldoCubreFaltante = dif > 0.01 && saldoCliente >= dif
                  const habilitado = dif <= 0.01 || saldoCubreFaltante
                  return (
                    <button
                      onClick={handleEntregarPedidoPagado}
                      disabled={guardandoPedido || !habilitado}
                      className={`flex-1 ${!habilitado ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400'} text-white font-bold py-2.5 rounded-lg text-base transition-colors`}
                    >
                      {guardandoPedido ? 'Guardando...'
                        : dif > 0.01 && saldoCubreFaltante ? `Entregar (usa saldo ${formatPrecio(dif)})`
                        : dif > 0.01 ? `Falta cobrar ${formatPrecio(dif)}`
                        : dif < -0.01 ? `Entregar (saldo +${formatPrecio(Math.abs(dif))})`
                        : `Entregar ${formatPrecio(total)}`
                      }
                    </button>
                  )
                })()}
              </div>
            )}
          </div>
        </div>

        {/* ====== DERECHA: PANEL PRODUCTOS ====== */}
        <div className="flex-1 flex flex-col min-w-0 p-4">
          {/* Buscador con dropdown autocompletado */}
          <div className="relative mb-4">
            <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-500 z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputBusquedaRef}
              type="text"
              placeholder={carritoBloquedado ? "Pedido pagado — solo entregar" : "Buscar por nombre, código o escanear... (F7)"}
              value={busquedaArt}
              onChange={carritoBloquedado ? undefined : handleBusquedaChange}
              onKeyDown={carritoBloquedado ? undefined : handleBusquedaKeyDown}
              disabled={carritoBloquedado}
              className={`w-full border rounded-xl pl-10 pr-12 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent shadow-sm ${carritoBloquedado ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white'}`}
              autoFocus={!carritoBloquedado}
            />
            {/* Botón teclado virtual */}
            <button
              type="button"
              onClick={() => setMostrarTeclado(v => !v)}
              className={`absolute right-2 top-1.5 p-1.5 rounded-lg transition-colors z-10 ${mostrarTeclado ? 'bg-violet-100 text-violet-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              title="Teclado virtual"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75A2.25 2.25 0 014.5 4.5h15a2.25 2.25 0 012.25 2.25v10.5A2.25 2.25 0 0119.5 19.5h-15a2.25 2.25 0 01-2.25-2.25V6.75zM6 8.25h.01M6 12h.01M6 15.75h12M9.75 8.25h.01M13.5 8.25h.01M17.25 8.25h.01M9.75 12h.01M13.5 12h.01M17.25 12h.01" />
              </svg>
            </button>
            {cargandoArticulos && (
              <div className="absolute right-10 top-3 text-gray-500 text-xs z-10">Cargando...</div>
            )}

            {/* Dropdown de resultados de búsqueda */}
            {busquedaArt.trim() && !cargandoArticulos && (
              <div className={`${mostrarTeclado ? 'relative max-h-48' : 'absolute z-30 max-h-80'} w-full bg-white border border-gray-300 rounded-xl shadow-xl mt-1 overflow-y-auto`}>
                {resultadosBusqueda.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">
                    Sin resultados para "{busquedaArt}"
                  </div>
                ) : (
                  resultadosBusqueda.map((art, idx) => {
                    const precioFinal = precioConDescEmpleado(art)
                    const enCarrito = carrito.find(i => i.articulo.id === art.id)
                    const esFav = favoritos.includes(art.id)
                    const seleccionado = idx === busquedaIdx
                    return (
                      <div
                        key={art.id}
                        ref={seleccionado ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                        onClick={() => { if (carritoBloquedado) return; agregarAlCarrito(art); setBusquedaArt(''); setBusquedaIdx(-1); inputBusquedaRef.current?.focus() }}
                        className={`flex items-center justify-between px-4 py-2.5 cursor-pointer border-b last:border-b-0 transition-colors ${
                          seleccionado ? 'bg-violet-200 border-l-4 border-l-violet-600' : enCarrito ? 'bg-violet-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        {esAdmin && (
                        <button
                          onClick={(e) => toggleFavorito(art.id, e)}
                          className={`mr-3 flex-shrink-0 transition-colors ${
                            esFav ? 'text-amber-400 hover:text-amber-500' : 'text-gray-400 hover:text-amber-400'
                          }`}
                        >
                          <svg className="w-5 h-5" fill={esFav ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                          </svg>
                        </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{art.nombre}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {art.codigo && <span className="mr-2">{art.codigo}</span>}
                            {art.rubro?.nombre && <span>{art.rubro.nombre}</span>}
                            {art.subRubro?.nombre && <span> / {art.subRubro.nombre}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                          <span className="text-sm font-semibold text-gray-700">{formatPrecio(precioFinal)}</span>
                          {enCarrito && (
                            <span className="bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
                              {enCarrito.cantidad}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

          </div>

          {/* Grilla de favoritos (oculta si teclado virtual abierto) */}
          <div className={`flex-1 overflow-y-auto ${mostrarTeclado ? 'hidden' : ''}`}>
            {cargandoArticulos ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Cargando artículos...
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                {/* Tile Gift Card — solo visible si no hay artículos en el carrito */}
                {carrito.length === 0 && (
                <div
                  onClick={() => setMostrarAgregarGC(true)}
                  className={`relative rounded-xl cursor-pointer transition-all duration-150 hover:shadow-md hover:scale-[1.02] active:scale-95 select-none shadow-sm ${
                    giftCardsEnVenta.length > 0 ? 'ring-2 ring-amber-500 shadow-md' : ''
                  }`}
                  style={{ borderTop: '4px solid #F59E0B', backgroundColor: giftCardsEnVenta.length > 0 ? '#FFFBEB' : '#fff' }}
                >
                  {giftCardsEnVenta.length > 0 && (
                    <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow z-10">
                      {giftCardsEnVenta.length}
                    </span>
                  )}
                  <div className="p-3 flex flex-col items-center text-center min-h-[100px] justify-center">
                    <svg className="w-7 h-7 text-amber-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    <span className="text-xs font-semibold text-amber-700">Gift Card</span>
                  </div>
                </div>
                )}

                {giftCardsEnVenta.length === 0 && articulosFavoritos.map(art => {
                  const precioFinal = precioConDescEmpleado(art)
                  const enCarrito = carrito.find(i => i.articulo.id === art.id)
                  const color = rubroColorMap[art.rubro?.nombre] || TILE_COLORS[0]

                  return (
                    <div
                      key={art.id}
                      onClick={() => !carritoBloquedado && agregarAlCarrito(art)}
                      className={`relative rounded-xl transition-all duration-150 select-none ${carritoBloquedado ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:shadow-md hover:scale-[1.02] active:scale-95'} ${
                        enCarrito ? 'ring-2 ring-violet-500 shadow-md' : 'shadow-sm'
                      }`}
                      style={{ borderTop: `4px solid ${color.border}`, backgroundColor: color.bg }}
                    >
                      {enCarrito && (
                        <span className="absolute -top-2 -right-2 bg-violet-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow z-10">
                          {enCarrito.cantidad}
                        </span>
                      )}
                      <div className="p-3 flex flex-col items-center text-center min-h-[100px] justify-center">
                        {art.codigo && <span className="text-xl font-bold text-gray-800 font-mono">{art.codigo}</span>}
                        <span className="text-xs font-semibold text-gray-700 mt-1 line-clamp-2 leading-tight">{art.nombre}</span>
                        <span className="text-[11px] text-gray-500 mt-1.5">{formatPrecio(precioFinal)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Teclado virtual — fijo abajo del panel */}
          {mostrarTeclado && (
            <div className="flex-shrink-0 pt-2">
              <TecladoVirtual
                valor={busquedaArt}
                onChange={(v) => { setBusquedaArt(v); setBusquedaIdx(-1) }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Botón flotante carrito (mobile) */}
      <button
        onClick={() => setCarritoVisible(!carritoVisible)}
        className="lg:hidden fixed bottom-4 right-4 z-30 bg-violet-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        {cantidadItems > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {cantidadItems}
          </span>
        )}
      </button>
      </>}

      {/* Modal agregar gift card a la venta */}
      {mostrarAgregarGC && (
        <div data-modal className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setMostrarAgregarGC(false); setGcError('') }}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
                Vender Gift Card
              </h3>
              <button onClick={() => { setMostrarAgregarGC(false); setGcError('') }} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Código (escanear barcode)</label>
                <input
                  type="text"
                  value={gcCodigo}
                  onChange={e => setGcCodigo(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (gcCodigo.trim()) document.getElementById('gc-monto-input')?.focus() } }}
                  placeholder="Escanear o tipear código..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Monto</label>
                <input
                  id="gc-monto-input"
                  type="number"
                  value={gcMonto}
                  onChange={e => setGcMonto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (gcMonto && parseFloat(gcMonto) > 0) agregarGiftCardAVenta() } }}
                  placeholder="$0"
                  min="0"
                  step="0.01"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Comprador (opcional)</label>
                <input
                  type="text"
                  value={gcComprador}
                  onChange={e => setGcComprador(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarGiftCardAVenta() } }}
                  placeholder="Nombre..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                />
              </div>
              {gcError && <div className="text-red-500 text-sm">{gcError}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button
                onClick={() => { setMostrarAgregarGC(false); setGcCodigo(''); setGcMonto(''); setGcComprador(''); setGcError('') }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={agregarGiftCardAVenta}
                disabled={!gcCodigo.trim() || !gcMonto || parseFloat(gcMonto) <= 0}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
              >
                Agregar al cobro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar cancelación */}
      {mostrarConfirmarCancelar && (
        <div className="fixed inset-0 z-[999] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-xs w-full mx-4 text-center">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Cancelar venta?</h3>
            <div className="flex gap-3">
              <button
                onClick={() => setMostrarConfirmarCancelar(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                No <span className="text-[10px] opacity-60">Esc</span>
              </button>
              <button
                onClick={ejecutarCancelacion}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
              >
                Si <span className="text-[10px] opacity-60">Enter</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Actualizaciones */}
      {mostrarActualizaciones && (
        <ActualizacionesPOS onCerrar={() => setMostrarActualizaciones(false)} />
      )}

      {/* Modal Cerrar Caja */}
      {mostrarCerrarCaja && cierreActivo && (
        <ModalCerrarCaja
          cierreId={cierreActivo.id}
          onClose={() => setMostrarCerrarCaja(false)}
          onCajaCerrada={() => {
            setMostrarCerrarCaja(false)
            setCierreActivo(null)
            localStorage.removeItem('cierre_activo')
          }}
        />
      )}

      {/* Modal Problema */}
      <ProblemaModal
        mostrarProblema={mostrarProblema}
        problemaSeleccionado={problemaSeleccionado} setProblemaSeleccionado={setProblemaSeleccionado}
        problemaPaso={problemaPaso} setProblemaPaso={setProblemaPaso}
        problemaBusqueda={problemaBusqueda} setProblemaBusqueda={setProblemaBusqueda}
        problemaBusFactura={problemaBusFactura} setProblemaBusFactura={setProblemaBusFactura}
        problemaFecha={problemaFecha} setProblemaFecha={setProblemaFecha}
        problemaBusArticulo={problemaBusArticulo} setProblemaBusArticulo={setProblemaBusArticulo}
        problemaSucursal={problemaSucursal} setProblemaSucursal={setProblemaSucursal}
        problemaSucursales={problemaSucursales} setProblemaSucursales={setProblemaSucursales}
        problemaVentas={problemaVentas} setProblemaVentas={setProblemaVentas}
        problemaBuscando={problemaBuscando}
        problemaVentaSel={problemaVentaSel} setProblemaVentaSel={setProblemaVentaSel}
        problemaItemsSel={problemaItemsSel} setProblemaItemsSel={setProblemaItemsSel}
        problemaDescripciones={problemaDescripciones} setProblemaDescripciones={setProblemaDescripciones}
        problemaYaDevuelto={problemaYaDevuelto} setProblemaYaDevuelto={setProblemaYaDevuelto}
        problemaCliente={problemaCliente} setProblemaCliente={setProblemaCliente}
        problemaBusCliente={problemaBusCliente} setProblemaBusCliente={setProblemaBusCliente}
        problemaClientesRes={problemaClientesRes} setProblemaClientesRes={setProblemaClientesRes}
        problemaBuscandoCli={problemaBuscandoCli} setProblemaBuscandoCli={setProblemaBuscandoCli}
        problemaCrearCliente={problemaCrearCliente} setProblemaCrearCliente={setProblemaCrearCliente}
        problemaConfirmando={problemaConfirmando} setProblemaConfirmando={setProblemaConfirmando}
        problemaObservacion={problemaObservacion} setProblemaObservacion={setProblemaObservacion}
        problemaPreciosCorregidos={problemaPreciosCorregidos} setProblemaPreciosCorregidos={setProblemaPreciosCorregidos}
        problemaEmailCliente={problemaEmailCliente} setProblemaEmailCliente={setProblemaEmailCliente}
        problemaCliTimerRef={problemaCliTimerRef}
        cerrarModalProblema={cerrarModalProblema}
        buscarVentasProblema={buscarVentasProblema}
        buscarVentasProblemaDebounced={buscarVentasProblemaDebounced}
        terminalConfig={terminalConfig}
      />


      {/* Buscador de cliente para montos > $180.000 (AFIP) */}
      {mostrarDniPopup && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center" onClick={() => setMostrarDniPopup(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3 relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => setMostrarDniPopup(false)} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h2 className="text-base font-semibold text-gray-800">Seleccionar cliente</h2>
            <p className="text-xs text-gray-400">Para ventas mayores a {formatPrecio(MONTO_LIMITE_DNI)} es obligatorio identificar al consumidor final.</p>
            <input
              ref={inputDniClienteRef}
              type="text"
              inputMode="numeric"
              value={busquedaDniCliente}
              onChange={e => setBusquedaDniCliente(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="DNI (7-8 dígitos) o CUIT (11 dígitos)"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-green-400"
              autoFocus
            />
            {busquedaDniCliente.length === 9 || busquedaDniCliente.length === 10 ? (
              <p className="text-amber-600 text-xs mt-1">Ingresá un DNI (7-8 dígitos) o CUIT completo (11 dígitos)</p>
            ) : null}
            {buscandoDniCliente && (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600" />
              </div>
            )}
            {!buscandoDniCliente && clientesDni.length > 0 && (
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {(() => {
                  const cuitCount = {}
                  clientesDni.forEach(c => {
                    const cuit = (c.cuit || '').replace(/\D/g, '')
                    if (cuit.length >= 7) cuitCount[cuit] = (cuitCount[cuit] || 0) + 1
                  })
                  return clientesDni.map(c => {
                    const cuitNorm = (c.cuit || '').replace(/\D/g, '')
                    const esDup = cuitNorm.length >= 7 && cuitCount[cuitNorm] > 1
                    return (
                      <button
                        key={c.id || c.id_centum}
                        onClick={() => seleccionarClienteDni(c)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${esDup ? 'border-amber-300 bg-amber-50/50 hover:bg-amber-100/50' : 'border-gray-100 hover:border-green-300 hover:bg-green-50/50'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-800 truncate">{c.razon_social}</span>
                          <div className="flex gap-1">
                            {esDup && (
                              <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-medium">CUIT duplicado</span>
                            )}
                            {!c.id_centum && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Sin Centum</span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {c.codigo && <span>{c.codigo} · </span>}
                          {c.cuit && <span>{c.cuit}</span>}
                          {c.condicion_iva && <span> · {c.condicion_iva}</span>}
                        </div>
                      </button>
                    )
                  })
                })()}
              </div>
            )}
            {!buscandoDniCliente && busquedaDniCliente.trim().length >= 7 && busquedaDniCliente.trim().length !== 9 && busquedaDniCliente.trim().length !== 10 && clientesDni.length === 0 && (
              <div className="text-center py-4 space-y-3">
                <p className="text-sm text-gray-400">No se encontraron clientes</p>
                <button
                  onClick={() => setMostrarCrearClienteDni(true)}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-green-400 hover:bg-green-50/50 text-gray-500 hover:text-green-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span className="text-sm font-medium">Crear nuevo cliente</span>
                </button>
              </div>
            )}

            {/* Modal crear cliente superpuesto */}
            {mostrarCrearClienteDni && (
              <NuevoClienteModal
                onClose={() => setMostrarCrearClienteDni(false)}
                onCreado={onClienteDniCreado}
                cuitInicial={busquedaDniCliente.trim()}
              />
            )}
          </div>
        </div>
      )}

      {/* Modal de cobro */}
      {mostrarCobrar && (
        <ModalCobrar
          total={totalConGiftCards}
          subtotal={subtotal}
          descuentoTotal={descuentoTotal}
          ivaTotal={0}
          carrito={carrito}
          cliente={cliente}
          promosAplicadas={promosAplicadas}
          ticketUid={ticketUid}
          onConfirmar={handleVentaExitosa}
          onCerrar={() => {
            // Log cobro cancelado (F11 → Escape)
            if (carrito.length > 0) {
              api.post('/api/auditoria/cancelacion', {
                motivo: 'Cobro cancelado',
                items: carrito.map(i => ({ articulo_id: i.articulo.id, codigo: i.articulo.codigo, nombre: i.articulo.nombre, cantidad: i.cantidad, precio: i.precioOverride ?? i.articulo.precio })),
                subtotal,
                total,
                cliente_nombre: cliente?.nombre || null,
                caja_id: terminalConfig?.caja_id || null,
                sucursal_id: terminalConfig?.sucursal_id || null,
                cierre_id: cierreActivo?.id || null,
              }).catch(err => console.error('Error registrando cobro cancelado:', err))
            }
            setMostrarCobrar(false)
          }}
          isOnline={isOnline}
          onVentaOffline={actualizarPendientes}
          pedidoPosId={pedidoEnProceso?.id || null}
          saldoCliente={saldoCliente}
          saldoDesglose={saldoDesglose}
          canal={modoDelivery ? 'delivery' : 'pos'}
          modoDelivery={modoDelivery}
          giftCardsEnVenta={giftCardsEnVenta}
          descuentoGrupoCliente={descuentoGrupoCliente}
          grupoDescuentoNombre={cliente.grupo_descuento_nombre}
          grupoDescuentoPorcentaje={cliente.grupo_descuento_porcentaje}
        />
      )}

      {/* Modal venta empleado — seleccionar o confirmar */}
      {mostrarVentaEmpleado && (
        <ModalVentaEmpleado
          mode={empleadoActivo ? 'confirmar' : 'seleccionar'}
          carrito={carrito}
          empleadoActivo={empleadoActivo}
          descuentosEmpleado={descuentosEmpleado}
          precioConDescEmpleado={precioConDescEmpleado}
          terminalConfig={terminalConfig}
          cajero={cierreActivo?.empleado ? { nombre: cierreActivo.empleado.nombre, id: cierreActivo.empleado.id } : usuario}
          onCerrar={() => setMostrarVentaEmpleado(false)}
          onEmpleadoSeleccionado={(emp, descs) => {
            setEmpleadoActivo(emp)
            setDescuentosEmpleado(descs)
            setMostrarVentaEmpleado(false)
          }}
          onExito={() => {
            setMostrarVentaEmpleado(false)
            setCarrito([])
            setCliente({ ...CLIENTE_DEFAULT })
            setBusquedaArt('')
            setGiftCardsEnVenta([])
            setEmpleadoActivo(null)
            setDescuentosEmpleado({})
          }}
        />
      )}

      {/* Pedido Wizard Modal (cobro + wizard + crear cliente) */}
      <PedidoWizardModal
        carrito={carrito}
        cliente={cliente}
        total={total}
        subtotal={subtotal}
        descuentoTotal={descuentoTotal}
        promosAplicadas={promosAplicadas}
        isOnline={isOnline}
        actualizarPendientes={actualizarPendientes}
        terminalConfig={terminalConfig}
        mostrarCobrarPedido={mostrarCobrarPedido}
        cobrarPedidoExistente={cobrarPedidoExistente}
        handleCobroPedidoExitoso={handleCobroPedidoExitoso}
        setMostrarCobrarPedido={setMostrarCobrarPedido}
        setCobrarPedidoExistente={setCobrarPedidoExistente}
        pedidoWizardDataRef={pedidoWizardDataRef}
        mostrarBuscarClientePedido={mostrarBuscarClientePedido}
        cerrarWizardPedido={cerrarWizardPedido}
        pasoPedido={pasoPedido}
        setPasoPedido={setPasoPedido}
        fechaEntregaPedido={fechaEntregaPedido}
        setFechaEntregaPedido={setFechaEntregaPedido}
        turnoPedido={turnoPedido}
        setTurnoPedido={setTurnoPedido}
        observacionEntregaPedido={observacionEntregaPedido}
        setObservacionEntregaPedido={setObservacionEntregaPedido}
        tarjetaRegaloPedido={tarjetaRegaloPedido}
        setTarjetaRegaloPedido={setTarjetaRegaloPedido}
        observacionesPedidoTexto={observacionesPedidoTexto}
        setObservacionesPedidoTexto={setObservacionesPedidoTexto}
        bloqueosFecha={bloqueosFecha}
        setBloqueosFecha={setBloqueosFecha}
        clientePedido={clientePedido}
        setClientePedido={setClientePedido}
        busquedaClientePedido={busquedaClientePedido}
        setBusquedaClientePedido={setBusquedaClientePedido}
        clientesPedido={clientesPedido}
        buscandoClientePedido={buscandoClientePedido}
        inputClientePedidoRef={inputClientePedidoRef}
        seleccionarClienteParaPedido={seleccionarClienteParaPedido}
        mostrarCrearClientePedido={mostrarCrearClientePedido}
        setMostrarCrearClientePedido={setMostrarCrearClientePedido}
        onClientePedidoCreado={onClientePedidoCreado}
        tipoPedidoSeleccionado={tipoPedidoSeleccionado}
        setTipoPedidoSeleccionado={setTipoPedidoSeleccionado}
        seleccionarTipoPedido={seleccionarTipoPedido}
        cargandoDetallePedido={cargandoDetallePedido}
        direccionesPedido={direccionesPedido}
        direccionSeleccionadaPedido={direccionSeleccionadaPedido}
        setDireccionSeleccionadaPedido={setDireccionSeleccionadaPedido}
        editandoDirPedido={editandoDirPedido}
        setEditandoDirPedido={setEditandoDirPedido}
        guardandoEditDirPedido={guardandoEditDirPedido}
        guardarEditDirPedido={guardarEditDirPedido}
        mostrarNuevaDirPedido={mostrarNuevaDirPedido}
        setMostrarNuevaDirPedido={setMostrarNuevaDirPedido}
        nuevaDirPedido={nuevaDirPedido}
        setNuevaDirPedido={setNuevaDirPedido}
        guardandoDirPedido={guardandoDirPedido}
        guardarNuevaDirPedido={guardarNuevaDirPedido}
        sucursalesPedido={sucursalesPedido}
        sucursalSeleccionadaPedido={sucursalSeleccionadaPedido}
        setSucursalSeleccionadaPedido={setSucursalSeleccionadaPedido}
        confirmarPedidoWizard={confirmarPedidoWizard}
        finalizarPedidoWizard={finalizarPedidoWizard}
        guardandoPedido={guardandoPedido}
        formatPrecio={formatPrecio}
      />
      {/* Popup peso manual para pesables */}
      {popupPesable && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Ingresar peso</h3>
            <p className="text-sm text-gray-500 mb-4 truncate">{popupPesable.articulo.nombre}</p>
            <div className="flex items-center gap-2 mb-5">
              <input
                autoFocus
                type="number"
                step="0.001"
                min="0.001"
                value={popupPesableKg}
                onChange={e => setPopupPesableKg(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmarPesable()
                  if (e.key === 'Escape') { setPopupPesable(null); setTimeout(() => inputBusquedaRef.current?.focus(), 50) }
                }}
                placeholder="0.000"
                className="flex-1 border-2 border-gray-300 focus:border-violet-500 rounded-xl px-4 py-3 text-2xl font-mono text-center outline-none"
              />
              <span className="text-lg font-semibold text-gray-500">kg</span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setPopupPesable(null); setTimeout(() => inputBusquedaRef.current?.focus(), 50) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                disabled={!popupPesableKg || parseFloat(popupPesableKg) <= 0}
                onClick={confirmarPesable}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pantalla roja fullscreen — artículo no encontrado */}
      {alertaBarcode && (
        <div className="fixed inset-0 z-[100] bg-red-600 flex flex-col items-center justify-center text-white" onClick={() => { setAlertaBarcode(null); stopAlertSound() }}>
          <svg className="w-24 h-24 mb-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-4xl font-black mb-3">ARTÍCULO NO ENCONTRADO</span>
          <span className="text-2xl font-mono opacity-80">{alertaBarcode}</span>
        </div>
      )}

      {/* Pantalla amarilla fullscreen — artículo duplicado (balanza o barcode) */}
      {alertaDuplicado && (
        <div className="fixed inset-0 z-[100] bg-amber-500 flex flex-col items-center justify-center text-white"
          tabIndex={0}
          ref={el => el?.focus()}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (alertaDuplicado.pesoKg) {
                setCarrito(prev => [...prev, { articulo: alertaDuplicado.articulo, cantidad: alertaDuplicado.pesoKg }])
              } else {
                agregarAlCarrito(alertaDuplicado.articulo)
              }
              setAlertaDuplicado(null)
              setTimeout(() => inputBusquedaRef.current?.focus(), 50)
            } else if (e.key === 'Escape') {
              setAlertaDuplicado(null)
              setTimeout(() => inputBusquedaRef.current?.focus(), 50)
            }
          }}>
          <svg className="w-24 h-24 mb-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-4xl font-black mb-3">ARTÍCULO DUPLICADO</span>
          <span className="text-xl opacity-90 mb-2">{alertaDuplicado.articulo.nombre}</span>
          {alertaDuplicado.pesoKg && (
            <span className="text-2xl font-mono opacity-80 mb-8">{alertaDuplicado.pesoKg} kg</span>
          )}
          {alertaDuplicado.cantidad && !alertaDuplicado.pesoKg && (
            <span className="text-2xl font-mono opacity-80 mb-8">x{alertaDuplicado.cantidad}</span>
          )}
          <span className="text-xl mb-8">¿Deseas agregar igual?</span>
          <div className="flex gap-6">
            <button
              onClick={() => { setAlertaDuplicado(null); setTimeout(() => inputBusquedaRef.current?.focus(), 50) }}
              className="px-10 py-4 bg-white/20 hover:bg-white/30 rounded-2xl text-2xl font-bold transition-colors"
            >
              No
            </button>
            <button
              onClick={() => {
                if (alertaDuplicado.pesoKg) {
                  setCarrito(prev => [...prev, { articulo: alertaDuplicado.articulo, cantidad: alertaDuplicado.pesoKg }])
                } else {
                  agregarAlCarrito(alertaDuplicado.articulo)
                }
                setAlertaDuplicado(null)
                setTimeout(() => inputBusquedaRef.current?.focus(), 50)
              }}
              className="px-10 py-4 bg-white text-amber-600 hover:bg-amber-50 rounded-2xl text-2xl font-bold transition-colors"
            >
              Sí, agregar
            </button>
          </div>
        </div>
      )}

      {/* Modal confirmación eliminación de artículo */}

      {/* Modal selección de motivo para cambio de precio */}
      {pendientePrecio && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setPendientePrecio(null)}>
          <div className="bg-white rounded-xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">Motivo del cambio de precio</h3>
              <p className="text-xs text-gray-500 mt-1">
                {pendientePrecio.nombreArticulo}: {formatPrecio(pendientePrecio.precioOriginal)} → {formatPrecio(pendientePrecio.nuevoPrecio)}
              </p>
            </div>
            <div className="p-3 space-y-2">
              {MOTIVOS_CAMBIO_PRECIO.map(motivo => (
                <button
                  key={motivo}
                  onClick={() => {
                    setPrecioOverride(pendientePrecio.articuloId, pendientePrecio.nuevoPrecio, motivo, pendientePrecio.precioOriginal)
                    setPendientePrecio(null)
                  }}
                  className="w-full text-left px-4 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700 transition-colors border border-gray-100"
                >
                  {motivo}
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-gray-100">
              <button
                onClick={() => setPendientePrecio(null)}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-gray-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg animate-fade-in">
          {toastMsg}
        </div>
      )}
    </div>
  )
}

// Error boundary para diagnosticar pantalla blanca
class POSErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="bg-white rounded-xl shadow p-6 max-w-lg">
            <h2 className="text-red-600 font-bold text-lg mb-2">Error en POS</h2>
            <pre className="text-sm text-red-800 whitespace-pre-wrap">{this.state.error.message}</pre>
            <pre className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{this.state.error.stack}</pre>
            <button onClick={() => window.location.reload()} className="mt-4 bg-red-600 text-white px-4 py-2 rounded">Recargar</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const POSWithErrorBoundary = () => (
  <POSErrorBoundary>
    <POS />
  </POSErrorBoundary>
)

export default POSWithErrorBoundary
