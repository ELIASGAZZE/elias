// Pagina principal de la app Control de Caja POS
import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import ModalRetiroPos from '../../components/cajas-pos/ModalRetiroPos'
import ModalGastoPos from '../../components/cajas-pos/ModalGastoPos'
import { imprimirCierre } from '../../utils/imprimirComprobante'
import api, { isNetworkError } from '../../services/api'
import { contarCierresPendientes } from '../../services/offlineDB'

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
  const location = useLocation()
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierres, setCierres] = useState([])
  const [cargando, setCargando] = useState(true)
  const [cierresEncolados, setCierresEncolados] = useState(0)
  const cierreEncolado = location.state?.cierreEncolado

  useEffect(() => {
    cargarDatos()
    contarCierresPendientes().then(n => setCierresEncolados(n))
  }, [])

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

  const [eliminando, setEliminando] = useState(null)
  const [retiroCierre, setRetiroCierre] = useState(null) // cierre para el modal de retiro
  const [gastoCierre, setGastoCierre] = useState(null) // cierre para el modal de gasto

  // Modal de codigo de empleado para editar/reimprimir (operario)
  const [modalEmpleado, setModalEmpleado] = useState(null) // { cierre, accion: 'editar'|'reimprimir' }
  const [codigoModal, setCodigoModal] = useState('')
  const [errorModal, setErrorModal] = useState('')
  const [validandoModal, setValidandoModal] = useState(false)

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

  const confirmarCodigoEmpleado = async () => {
    if (!codigoModal.trim()) {
      setErrorModal('Ingresa el codigo de empleado')
      return
    }
    setValidandoModal(true)
    setErrorModal('')
    try {
      const { data: emp } = await api.get(`/api/empleados/por-codigo/${encodeURIComponent(codigoModal.trim())}`)
      // Verificar que es el empleado que cerro la caja
      const cierre = modalEmpleado.cierre
      if (emp.id !== cierre.cerrado_por_empleado_id) {
        setErrorModal('El codigo no corresponde al empleado que cerro esta caja')
        setValidandoModal(false)
        return
      }
      const accion = modalEmpleado.accion
      setModalEmpleado(null)
      setCodigoModal('')
      setErrorModal('')

      if (accion === 'editar') {
        navigate(`/cajas-pos/cierre/${cierre.id}/editar`)
      } else if (accion === 'reimprimir') {
        // Cargar datos del cierre y reimprimir
        try {
          const [cierreRes, denomRes, retirosRes, gastosRes] = await Promise.all([
            api.get(`/api/cierres-pos/${cierre.id}`),
            api.get('/api/denominaciones'),
            api.get(`/api/cierres-pos/${cierre.id}/retiros`),
            api.get(`/api/cierres-pos/${cierre.id}/gastos`),
          ])
          const denomActivas = (denomRes.data || []).filter(d => d.activo)
          imprimirCierre(cierreRes.data, retirosRes.data || [], denomActivas, gastosRes.data || [])
        } catch (err) {
          alert('Error al reimprimir: ' + (err.response?.data?.error || err.message))
        }
      }
    } catch {
      setErrorModal('Codigo no valido')
    } finally {
      setValidandoModal(false)
    }
  }

  // Separar cajas abiertas del resto
  const cajasAbiertas = cierres.filter(c => c.estado === 'abierta')
  const cierresCerrados = cierres.filter(c => c.estado !== 'abierta')

  const getLinkCierre = (cierre) => {
    if (cierre.estado === 'abierta' && esAdmin) {
      return `/cajas-pos/cierre/${cierre.id}/cerrar`
    }
    return `/cajas-pos/cierre/${cierre.id}`
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Control Caja POS" sinTabs />

      <div className="px-4 py-4 space-y-4 max-w-4xl mx-auto">

        {/* Banner cierre encolado offline */}
        {(cierreEncolado || cierresEncolados > 0) && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 11-12.728 0M12 9v4m0 4h.01" />
            </svg>
            <span>
              <strong>Cierre guardado offline.</strong> Se sincronizara automaticamente cuando vuelva la conexion.
              {cierresEncolados > 0 && <span className="ml-1">({cierresEncolados} pendiente{cierresEncolados > 1 ? 's' : ''})</span>}
            </span>
          </div>
        )}

        {/* Cajas abiertas (solo admin) */}
            {cajasAbiertas.length > 0 && esAdmin && (
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
                            {cierre.numero ? `#${cierre.numero} · ` : ''}Sesion POS · {formatHora(cierre.apertura_at)}
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
                              <>{cierre.numero ? `#${cierre.numero} · ` : ''}Sesion POS · {formatHora(cierre.apertura_at)}</>
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
                          {cierre.total_general !== undefined && !esGestor && usuario?.rol !== 'operario' && (
                            <span className="text-sm font-medium text-gray-700">
                              {formatMonto(cierre.total_general)}
                            </span>
                          )}
                        </div>
                      </Link>
                      {cierre.estado === 'pendiente_gestor' && (esAdmin || usuario?.rol === 'operario') && (
                        <>
                          {/* Boton editar */}
                          {esAdmin ? (
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
                          ) : (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setModalEmpleado({ cierre, accion: 'editar' }) }}
                              className="flex-shrink-0 p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                              title="Editar conteo"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          {/* Boton reimprimir */}
                          {esAdmin ? (
                            <button
                              onClick={async (e) => {
                                e.preventDefault(); e.stopPropagation()
                                try {
                                  const [cierreRes, denomRes, retirosRes, gastosRes] = await Promise.all([
                                    api.get(`/api/cierres-pos/${cierre.id}`),
                                    api.get('/api/denominaciones'),
                                    api.get(`/api/cierres-pos/${cierre.id}/retiros`),
                                    api.get(`/api/cierres-pos/${cierre.id}/gastos`),
                                  ])
                                  const denomActivas = (denomRes.data || []).filter(d => d.activo)
                                  imprimirCierre(cierreRes.data, retirosRes.data || [], denomActivas, gastosRes.data || [])
                                } catch (err) {
                                  alert('Error al reimprimir: ' + (err.response?.data?.error || err.message))
                                }
                              }}
                              className="flex-shrink-0 p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                              title="Reimprimir comprobante"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setModalEmpleado({ cierre, accion: 'reimprimir' }) }}
                              className="flex-shrink-0 p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                              title="Reimprimir comprobante"
                            >
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

      {/* Modal codigo de empleado para editar/reimprimir */}
      {modalEmpleado && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-gray-800">
              {modalEmpleado.accion === 'editar' ? 'Editar conteo' : 'Reimprimir comprobante'}
            </h3>
            <p className="text-sm text-gray-500">
              Ingresa el codigo del empleado que cerro esta caja para continuar.
            </p>
            <div>
              <input
                type="text"
                value={codigoModal}
                onChange={(e) => { setCodigoModal(e.target.value); setErrorModal('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarCodigoEmpleado() } }}
                placeholder="Codigo de empleado"
                className={`campo-form text-sm w-full ${errorModal ? 'border-red-400' : ''}`}
                autoFocus
              />
              {errorModal && <p className="text-xs text-red-600 mt-1">{errorModal}</p>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setModalEmpleado(null); setCodigoModal(''); setErrorModal('') }}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-xl text-sm font-medium hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCodigoEmpleado}
                disabled={validandoModal}
                className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white py-2 rounded-xl text-sm font-medium"
              >
                {validandoModal ? 'Validando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CajasPosHome
