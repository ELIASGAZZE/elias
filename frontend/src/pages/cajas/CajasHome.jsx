// Página principal de la app Control de Cajas
import React, { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ContadorDenominacion from '../../components/cajas/ContadorDenominacion'
import api from '../../services/api'

const ESTADOS = {
  abierta: { label: 'Abierta', color: 'bg-emerald-100 text-emerald-700' },
  pendiente_gestor: { label: 'Pendiente verificación', color: 'bg-yellow-100 text-yellow-700' },
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

const CajasHome = () => {
  const navigate = useNavigate()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierres, setCierres] = useState([])
  const [cargando, setCargando] = useState(true)

  // Modal abrir caja
  const [mostrarAbrir, setMostrarAbrir] = useState(false)
  const [planillaId, setPlanillaId] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [errorAbrir, setErrorAbrir] = useState('')

  // Selectores para abrir caja
  const [sucursales, setSucursales] = useState([])
  const [cajas, setCajas] = useState([])
  const [sucursalId, setSucursalId] = useState('')
  const [cajaId, setCajaId] = useState('')
  const [cargandoCajas, setCargandoCajas] = useState(false)

  // Código de empleado
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

  // Último cambio dejado en caja (para comparación)
  const [ultimoCambio, setUltimoCambio] = useState(null)
  const [ultimoCambioCajaId, setUltimoCambioCajaId] = useState(null)

  const totalCambioInicial = useMemo(
    () => denomBilletes.reduce((sum, d) => sum + d.valor * (billetesApertura[d.valor] || 0), 0),
    [denomBilletes, billetesApertura]
  )

  // Verificar si hay diferencia con el último cierre para una denominación
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
        setDenomBilletes(activas.filter(d => d.tipo === 'billete').sort((a, b) => a.orden - b.orden))
      } catch (err) {
        console.error('Error cargando denominaciones:', err)
      } finally {
        setCargandoDenominaciones(false)
      }
    }

    cargarDenominaciones()
  }, [mostrarAbrir])

  // Cargar último cambio cuando se selecciona una caja
  useEffect(() => {
    if (!cajaId || cajaId === ultimoCambioCajaId) return

    const cargarUltimoCambio = async () => {
      try {
        const { data } = await api.get(`/api/cierres/ultimo-cambio?caja_id=${cajaId}`)
        setUltimoCambio(data)
        setUltimoCambioCajaId(cajaId)
      } catch (err) {
        console.error('Error cargando último cambio:', err)
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
      setErrorEmpleado('Código no válido')
    } finally {
      setValidandoEmpleado(false)
    }
  }

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/cierres')
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
      setErrorAbrir('Seleccioná una caja')
      return
    }
    if (!empleadoResuelto) {
      setErrorAbrir('Ingresá un código de empleado válido')
      return
    }
    if (!planillaId.trim()) {
      setErrorAbrir('Ingresá el ID de planilla de caja')
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

      await api.post('/api/cierres/abrir', {
        caja_id: cajaId,
        codigo_empleado: codigoEmpleado.trim(),
        planilla_id: planillaId.trim(),
        fondo_fijo: totalCambioInicial,
        fondo_fijo_billetes: ffBilletes,
        fondo_fijo_monedas: {},
        diferencias_apertura: calcularDiferencias(),
        observaciones_apertura: observacionesApertura.trim() || null,
      })
      // Resetear formulario
      setPlanillaId('')
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
    setPlanillaId('')
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

  // Separar cajas abiertas del resto
  const cajasAbiertas = cierres.filter(c => c.estado === 'abierta')
  const cierresCerrados = cierres.filter(c => c.estado !== 'abierta')

  const getLinkCierre = (cierre) => {
    if (cierre.estado === 'abierta' && (usuario?.rol === 'operario' || esAdmin)) {
      return `/cajas/cierre/${cierre.id}/cerrar`
    }
    if (esGestor && cierre.estado === 'pendiente_gestor') {
      return `/cajas/verificar/${cierre.id}`
    }
    return `/cajas/cierre/${cierre.id}`
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Control de Cajas" sinTabs />

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">

        {/* Botón abrir caja (operario/admin) */}
        {(usuario?.rol === 'operario' || esAdmin) && (
          <button
            onClick={() => mostrarAbrir ? handleCerrarFormulario() : setMostrarAbrir(true)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-medium transition-colors text-sm"
          >
            {mostrarAbrir ? 'Cancelar' : 'Abrir Caja'}
          </button>
        )}

        {/* Formulario abrir caja — layout desktop */}
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
                    {cargandoCajas ? 'Cargando cajas...' : !sucursalId ? 'Seleccioná una sucursal primero' : 'Seleccionar caja...'}
                  </option>
                  {cajas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Código de empleado */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Código de empleado</label>
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
                  placeholder="Ingresá el código"
                  className={`campo-form text-sm ${empleadoResuelto ? 'border-green-400' : errorEmpleado ? 'border-red-400' : ''}`}
                />
                {validandoEmpleado && <p className="text-xs text-gray-400 mt-1">Validando...</p>}
                {empleadoResuelto && <p className="text-xs text-green-600 mt-1">{empleadoResuelto.nombre}</p>}
                {errorEmpleado && <p className="text-xs text-red-600 mt-1">{errorEmpleado}</p>}
              </div>

              {/* Planilla ID */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">ID Planilla de Caja (Centum)</label>
                <input
                  type="text"
                  value={planillaId}
                  onChange={(e) => setPlanillaId(e.target.value)}
                  placeholder="Ej: 12345"
                  className="campo-form text-sm"
                />
              </div>
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

            {/* Cambio inicial — billetes siempre visibles */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-gray-700">Cambio inicial (billetes)</h4>
                {totalCambioInicial > 0 && (
                  <span className="text-sm font-bold text-emerald-600">{formatMonto(totalCambioInicial)}</span>
                )}
              </div>

              {cargandoDenominaciones ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
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
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex justify-between items-center mt-3">
                      <span className="text-sm font-medium text-emerald-800">Total cambio inicial</span>
                      <span className="text-sm font-bold text-emerald-700">{formatMonto(totalCambioInicial)}</span>
                    </div>
                  )}

                  {hayUltimoCambio && calcularDiferencias() && (
                    <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2 mt-2">
                      <p className="text-xs font-semibold text-red-700">
                        El cambio ingresado difiere del último cierre de esta caja
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Las denominaciones con diferencia están marcadas en rojo
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {errorAbrir && <p className="text-sm text-red-600">{errorAbrir}</p>}

            <button
              type="submit"
              disabled={abriendo}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              {abriendo ? 'Abriendo...' : 'Confirmar apertura'}
            </button>
          </form>
        )}

        {/* Ocultar listas cuando se está abriendo caja */}
        {!mostrarAbrir && (
          <>
            {/* Cajas abiertas (operario/admin) */}
            {cajasAbiertas.length > 0 && (usuario?.rol === 'operario' || esAdmin) && (
              <div>
                <h3 className="font-semibold text-gray-700 text-sm mb-3">Cajas abiertas</h3>
                <div className="space-y-2">
                  {cajasAbiertas.map(cierre => (
                    <Link
                      key={cierre.id}
                      to={`/cajas/cierre/${cierre.id}/cerrar`}
                      className="block bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 hover:border-emerald-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-800">
                          Planilla #{cierre.planilla_id}
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
                        <span className="text-xs font-medium text-emerald-600">Cerrar</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Lista de cierres */}
            <div>
              <h3 className="font-semibold text-gray-700 text-sm mb-3">
                {esGestor ? 'Cierres pendientes de verificación' : 'Cierres de caja'}
              </h3>

              {cargando ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
                </div>
              ) : cierresCerrados.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-gray-400 text-sm">No hay cierres</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cierresCerrados.map(cierre => (
                    <Link
                      key={cierre.id}
                      to={getLinkCierre(cierre)}
                      className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-800">
                          Planilla #{cierre.planilla_id}
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
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CajasHome
