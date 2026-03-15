// Pagina principal de la app Control de Caja POS
import React, { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import ModalRetiroPos from '../../components/cajas-pos/ModalRetiroPos'
import ModalGastoPos from '../../components/cajas-pos/ModalGastoPos'
import api from '../../services/api'

const ESTADOS = {
  abierta: { label: 'Abierta', color: 'bg-teal-100 text-teal-700' },
  pendiente_gestor: { label: 'Pendiente verificacion', color: 'bg-yellow-100 text-yellow-700' },
  pendiente_agente: { label: 'Verificado', color: 'bg-blue-100 text-blue-700' },
  cerrado: { label: 'Cerrado', color: 'bg-green-100 text-green-700' },
  con_diferencia: { label: 'Con diferencia', color: 'bg-red-100 text-red-700' },
}

const BadgeEstado = ({ estado }) => {
  const cfg = ESTADOS[estado] || { label: estado, color: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      {cfg.label}
    </span>
  )
}

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const formatMonto = (monto) => {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)
}

const formatHora = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const CajasPosHome = () => {
  const navigate = useNavigate()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierres, setCierres] = useState([])
  const [cargando, setCargando] = useState(true)

  // Modal abrir caja
  const [mostrarAbrir, setMostrarAbrir] = useState(false)
  const [abriendo, setAbriendo] = useState(false)
  const [errorAbrir, setErrorAbrir] = useState('')

  // Selectores para abrir caja
  const [sucursales, setSucursales] = useState([])
  const [cajas, setCajas] = useState([])
  const [sucursalId, setSucursalId] = useState('')
  const [cajaId, setCajaId] = useState('')
  const [cargandoCajas, setCargandoCajas] = useState(false)

  // Codigo de empleado
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleadoResuelto, setEmpleadoResuelto] = useState(null) // { id, nombre }
  const [errorEmpleado, setErrorEmpleado] = useState('')
  const [validandoEmpleado, setValidandoEmpleado] = useState(false)

  // Observaciones apertura
  const [observacionesApertura, setObservacionesApertura] = useState('')

  // Denominaciones para cambio inicial (billetes solamente)
  const [denomBilletes, setDenomBilletes] = useState([])
  const [billetesApertura, setBilletesApertura] = useState({})
  const [cargandoDenominaciones, setCargandoDenominaciones] = useState(false)

  // Ultimo cambio dejado en caja (para comparacion)
  const [ultimoCambio, setUltimoCambio] = useState(null)
  const [ultimoCambioCajaId, setUltimoCambioCajaId] = useState(null)

  const totalCambioInicial = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetesApertura[d.valor] || 0), 0),
    [denomBilletes, billetesApertura]
  )

  // Verificar si hay diferencia con el ultimo cierre para una denominacion
  const hayUltimoCambio = ultimoCambio && (
    Object.keys(ultimoCambio.cambio_billetes || {}).length > 0
  )

  const tieneDiferencia = (valor) => {
    if (!hayUltimoCambio) return false
    const anterior = (ultimoCambio.cambio_billetes || {})[String(valor)] || 0
    const actual = billetesApertura[valor] || 0
    return anterior !== actual
  }

  // Calcular diferencias_apertura
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

  useEffect(() => {
    cargarDatos()
  }, [])

  // Cargar denominaciones al abrir el formulario
  useEffect(() => {
    if (!mostrarAbrir || denomBilletes.length > 0) return

    const cargarDenominaciones = async () => {
      setCargandoDenominaciones(true)
      try {
        const { data } = await api.get('/api/denominaciones')
        const activas = (data || []).filter(d => d.activo)
        setDenomBilletes(activas.filter(d => d.tipo === 'billete').sort((a, b) => b.valor - a.valor))
      } catch (err) {
        console.error('Error cargando denominaciones:', err)
      } finally {
        setCargandoDenominaciones(false)
      }
    }

    cargarDenominaciones()
  }, [mostrarAbrir])

  // Cargar ultimo cambio cuando se selecciona una caja
  useEffect(() => {
    if (!cajaId || cajaId === ultimoCambioCajaId) return

    const cargarUltimoCambio = async () => {
      try {
        const { data } = await api.get(`/api/cierres-pos/ultimo-cambio?caja_id=${cajaId}`)
        setUltimoCambio(data)
        setUltimoCambioCajaId(cajaId)
      } catch (err) {
        console.error('Error cargando ultimo cambio:', err)
        setUltimoCambio(null)
      }
    }

    cargarUltimoCambio()
  }, [cajaId])

  // Cargar sucursales al abrir el formulario
  useEffect(() => {
    if (!mostrarAbrir) return

    const cargarSucursales = async () => {
      try {
        const { data } = await api.get('/api/sucursales')
        setSucursales(data)

        // Para operario: auto-seleccionar su sucursal
        if (!esAdmin && usuario?.sucursal_id) {
          setSucursalId(usuario.sucursal_id)
        }
      } catch (err) {
        console.error('Error cargando sucursales:', err)
      }
    }

    cargarSucursales()
  }, [mostrarAbrir, esAdmin, usuario?.sucursal_id])

  // Cargar cajas cuando cambia la sucursal seleccionada
  useEffect(() => {
    if (!sucursalId) {
      setCajas([])
      setCajaId('')
      return
    }

    const cargarCajas = async () => {
      setCargandoCajas(true)
      setCajaId('')

      try {
        const { data } = await api.get(`/api/cajas?sucursal_id=${sucursalId}`)
        setCajas(data)
      } catch (err) {
        console.error('Error cargando cajas:', err)
      } finally {
        setCargandoCajas(false)
      }
    }

    cargarCajas()
  }, [sucursalId])

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

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/cierres-pos')
      setCierres(data)
    } catch (err) {
      console.error('Error cargando datos:', err)
    } finally {
      setCargando(false)
    }
  }

  const abrirCaja = async (e) => {
    e.preventDefault()

    if (!cajaId) {
      setErrorAbrir('Selecciona una caja')
      return
    }
    if (!empleadoResuelto) {
      setErrorAbrir('Ingresa un codigo de empleado valido')
      return
    }

    setAbriendo(true)
    setErrorAbrir('')
    try {
      // Build fondo_fijo_billetes payload
      const ffBilletes = {}
      denomBilletes.forEach(d => {
        const cant = billetesApertura[d.valor] || 0
        if (cant > 0) ffBilletes[String(d.valor)] = cant
      })

      await api.post('/api/cierres-pos/abrir', {
        caja_id: cajaId,
        codigo_empleado: codigoEmpleado.trim(),
        fondo_fijo: totalCambioInicial,
        fondo_fijo_billetes: ffBilletes,
        fondo_fijo_monedas: {},
        diferencias_apertura: calcularDiferencias(),
        observaciones_apertura: observacionesApertura.trim() || null,
      })
      // Resetear formulario
      setBilletesApertura({})
      setUltimoCambio(null)
      setUltimoCambioCajaId(null)
      setSucursalId(esAdmin ? '' : (usuario?.sucursal_id || ''))
      setCajaId('')
      setCodigoEmpleado('')
      setEmpleadoResuelto(null)
      setErrorEmpleado('')
      setObservacionesApertura('')
      setMostrarAbrir(false)
      await cargarDatos()
    } catch (err) {
      setErrorAbrir(err.response?.data?.error || 'Error al abrir caja')
    } finally {
      setAbriendo(false)
    }
  }

  const handleCerrarFormulario = () => {
    setMostrarAbrir(false)
    setErrorAbrir('')
    setBilletesApertura({})
    setUltimoCambio(null)
    setUltimoCambioCajaId(null)
    setSucursalId('')
    setCajaId('')
    setCodigoEmpleado('')
    setEmpleadoResuelto(null)
    setErrorEmpleado('')
    setObservacionesApertura('')
    setCajas([])
  }

  const [eliminando, setEliminando] = useState(null)
  const [retiroCierre, setRetiroCierre] = useState(null) // cierre para el modal de retiro
  const [gastoCierre, setGastoCierre] = useState(null) // cierre para el modal de gasto

  const eliminarCierre = async (e, cierre) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Eliminar sesion POS del ${formatFecha(cierre.fecha)} a las ${formatHora(cierre.apertura_at)}? Se borraran tambien retiros y verificaciones.`)) return
    setEliminando(cierre.id)
    try {
      await api.delete(`/api/cierres-pos/${cierre.id}`)
      setCierres(prev => prev.filter(c => c.id !== cierre.id))
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar')
    } finally {
      setEliminando(null)
    }
  }

  // Separar cajas abiertas del resto
  const cajasAbiertas = cierres.filter(c => c.estado === 'abierta')
  const cierresCerrados = cierres.filter(c => c.estado !== 'abierta')

  const getLinkCierre = (cierre) => {
    if (cierre.estado === 'abierta' && (usuario?.rol === 'operario' || esAdmin)) {
      return `/cajas-pos/cierre/${cierre.id}/cerrar`
    }
    if (esGestor && cierre.estado === 'pendiente_gestor') {
      return `/cajas-pos/verificar/${cierre.id}`
    }
    return `/cajas-pos/cierre/${cierre.id}`
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Control Caja POS" sinTabs />

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">

        {/* Boton abrir caja (operario/admin) */}
        {(usuario?.rol === 'operario' || esAdmin) && (
          <button
            onClick={() => mostrarAbrir ? handleCerrarFormulario() : setMostrarAbrir(true)}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white py-3 rounded-xl font-medium transition-colors text-sm"
          >
            {mostrarAbrir ? 'Cancelar' : 'Abrir Caja'}
          </button>
        )}

        {/* Formulario abrir caja */}
        {mostrarAbrir && (
          <form onSubmit={abrirCaja} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
            <h3 className="font-semibold text-gray-700">Abrir caja</h3>

            {/* Selectores en fila para desktop */}
            <div className="grid grid-cols-2 gap-4">
              {/* Sucursal selector — solo visible para admin */}
              {esAdmin && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Sucursal</label>
                  <select
                    value={sucursalId}
                    onChange={(e) => setSucursalId(e.target.value)}
                    className="campo-form text-sm"
                  >
                    <option value="">Seleccionar sucursal...</option>
                    {sucursales.map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Caja selector */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Caja</label>
                <select
                  value={cajaId}
                  onChange={(e) => setCajaId(e.target.value)}
                  className="campo-form text-sm"
                  disabled={!sucursalId || cargandoCajas}
                >
                  <option value="">
                    {cargandoCajas ? 'Cargando cajas...' : !sucursalId ? 'Selecciona una sucursal primero' : 'Seleccionar caja...'}
                  </option>
                  {cajas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Codigo de empleado */}
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
                  className={`campo-form text-sm ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : ''}`}
                />
                {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
                {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
                {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
              </div>
            </div>

            {/* Cambio inicial — billetes siempre visibles */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-gray-700">Cambio inicial (billetes)</h4>
                {totalCambioInicial > 0 && (
                  <span className="text-sm font-bold text-teal-600">{formatMonto(totalCambioInicial)}</span>
                )}
              </div>

              {cargandoDenominaciones ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2">
                    {denomBilletes.map(d => (
                      <ContadorDenominacion
                        key={`ba-${d.id}`}
                        valor={d.valor}
                        cantidad={billetesApertura[d.valor] || 0}
                        onChange={(val) => setBilletesApertura(prev => ({ ...prev, [d.valor]: val }))}
                        alerta={tieneDiferencia(d.valor)}
                      />
                    ))}
                  </div>

                  {totalCambioInicial > 0 && (
                    <div className="bg-teal-50 border border-teal-200 rounded-xl px-3 py-2 flex justify-between items-center mt-3">
                      <span className="text-sm font-medium text-teal-800">Total cambio inicial</span>
                      <span className="text-sm font-bold text-teal-700">{formatMonto(totalCambioInicial)}</span>
                    </div>
                  )}

                  {hayUltimoCambio && calcularDiferencias() && (
                    <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2 mt-2">
                      <p className="text-xs font-semibold text-red-700">
                        El cambio ingresado difiere del ultimo cierre de esta caja
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Las denominaciones con diferencia estan marcadas en rojo
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Observaciones apertura */}
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Observaciones (opcional)</label>
              <textarea
                value={observacionesApertura}
                onChange={(e) => setObservacionesApertura(e.target.value)}
                className="campo-form text-sm"
                rows={2}
                placeholder="Notas sobre la apertura..."
              />
            </div>

            {errorAbrir && <p className="text-sm text-red-600">{errorAbrir}</p>}

            <button
              type="submit"
              disabled={abriendo}
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              {abriendo ? 'Abriendo...' : 'Confirmar apertura'}
            </button>
          </form>
        )}

        {/* Ocultar listas cuando se esta abriendo caja */}
        {!mostrarAbrir && (
          <>
            {/* Cajas abiertas (operario/admin) */}
            {cajasAbiertas.length > 0 && (usuario?.rol === 'operario' || esAdmin) && (
              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-3">Cajas abiertas</h3>
                <div className="space-y-2">
                  {cajasAbiertas.map(cierre => (
                    <div key={cierre.id} className="flex items-center gap-2">
                      <Link
                        to={`/cajas-pos/cierre/${cierre.id}/cerrar`}
                        className="flex-1 bg-teal-50 border-2 border-teal-200 rounded-xl p-4 hover:border-teal-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-800">
                            Sesion POS · {formatHora(cierre.apertura_at)}
                          </span>
                          <BadgeEstado estado={cierre.estado} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-gray-500">
                            {formatFecha(cierre.fecha)}
                            {cierre.caja?.nombre && (
                              <span> · {cierre.caja.nombre}</span>
                            )}
                            {cierre.caja?.sucursales?.nombre && (
                              <span> · {cierre.caja.sucursales.nombre}</span>
                            )}
                            {cierre.empleado?.nombre && (
                              <span> · {cierre.empleado.nombre}</span>
                            )}
                            {cierre.fondo_fijo > 0 && (
                              <span> · Cambio: {formatMonto(cierre.fondo_fijo)}</span>
                            )}
                          </div>
                          <span className="text-xs font-medium text-teal-600">Cerrar</span>
                        </div>
                      </Link>
                      <button
                        onClick={(e) => { e.preventDefault(); setGastoCierre(cierre) }}
                        className="flex-shrink-0 p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                        title="Registrar gasto"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); setRetiroCierre(cierre) }}
                        className="flex-shrink-0 p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Retiro de alivio"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </button>
                      {esAdmin && (
                        <button
                          onClick={(e) => eliminarCierre(e, cierre)}
                          disabled={eliminando === cierre.id}
                          className="flex-shrink-0 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Eliminar cierre"
                        >
                          {eliminando === cierre.id ? (
                            <div className="w-5 h-5 animate-spin rounded-full border-2 border-red-300 border-t-red-600" />
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lista de cierres */}
            <div>
              <h3 className="font-semibold text-gray-700 text-sm mb-3">
                {esGestor ? 'Cierres pendientes de verificacion' : 'Cierres de caja'}
              </h3>

              {cargando ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
                </div>
              ) : cierresCerrados.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-gray-400 text-sm">No hay cierres</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cierresCerrados.map(cierre => (
                    <div key={cierre.id} className="flex items-center gap-2">
                      <Link
                        to={getLinkCierre(cierre)}
                        className={`flex-1 rounded-xl p-4 hover:shadow-sm transition-all ${
                          cierre.tipo === 'delivery'
                            ? 'bg-purple-50 border border-purple-200 hover:border-purple-300'
                            : 'bg-white border border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-800">
                            {cierre.tipo === 'delivery' ? (
                              <span className="flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                                </svg>
                                {cierre.observaciones_apertura || 'Delivery'}
                              </span>
                            ) : (
                              <>Sesion POS · {formatHora(cierre.apertura_at)}</>
                            )}
                          </span>
                          <BadgeEstado estado={cierre.estado} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-gray-400">
                            {formatFecha(cierre.fecha)}
                            {cierre.caja?.nombre && (
                              <span> · {cierre.caja.nombre}</span>
                            )}
                            {cierre.caja?.sucursales?.nombre && (
                              <span> · {cierre.caja.sucursales.nombre}</span>
                            )}
                            {cierre.empleado?.nombre && (
                              <span> · {cierre.empleado.nombre}</span>
                            )}
                          </div>
                          {cierre.total_general !== undefined && !esGestor && (
                            <span className="text-sm font-medium text-gray-700">
                              {formatMonto(cierre.total_general)}
                            </span>
                          )}
                        </div>
                      </Link>
                      {esAdmin && cierre.estado === 'pendiente_gestor' && (
                        <Link
                          to={`/cajas-pos/cierre/${cierre.id}/editar`}
                          className="flex-shrink-0 p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Editar conteo"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </Link>
                      )}
                      {esAdmin && (
                        <button
                          onClick={(e) => eliminarCierre(e, cierre)}
                          disabled={eliminando === cierre.id}
                          className="flex-shrink-0 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Eliminar cierre"
                        >
                          {eliminando === cierre.id ? (
                            <div className="w-5 h-5 animate-spin rounded-full border-2 border-red-300 border-t-red-600" />
                          ) : (
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal retiro */}
      {retiroCierre && (
        <ModalRetiroPos
          cierreId={retiroCierre.id}
          cierre={retiroCierre}
          onClose={() => setRetiroCierre(null)}
          onRetiroCreado={() => {}}
        />
      )}

      {/* Modal gasto */}
      {gastoCierre && (
        <ModalGastoPos
          cierreId={gastoCierre.id}
          cierre={gastoCierre}
          onClose={() => setGastoCierre(null)}
          onGastoCreado={() => {}}
        />
      )}
    </div>
  )
}

export default CajasPosHome
