// Página principal de la app Control de Cajas
import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  const [fondoFijo, setFondoFijo] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [errorAbrir, setErrorAbrir] = useState('')

  useEffect(() => {
    cargarDatos()
  }, [])

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
    if (!planillaId.trim()) {
      setErrorAbrir('Ingresá el ID de planilla de caja')
      return
    }

    setAbriendo(true)
    setErrorAbrir('')
    try {
      const { data } = await api.post('/api/cierres/abrir', {
        planilla_id: planillaId.trim(),
        fondo_fijo: parseFloat(fondoFijo) || 0,
      })
      setPlanillaId('')
      setFondoFijo('')
      setMostrarAbrir(false)
      await cargarDatos()
    } catch (err) {
      setErrorAbrir(err.response?.data?.error || 'Error al abrir caja')
    } finally {
      setAbriendo(false)
    }
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

      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto">

        {/* Botón abrir caja (operario/admin) */}
        {(usuario?.rol === 'operario' || esAdmin) && (
          <button
            onClick={() => setMostrarAbrir(!mostrarAbrir)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-medium transition-colors text-sm"
          >
            {mostrarAbrir ? 'Cancelar' : 'Abrir Caja'}
          </button>
        )}

        {/* Formulario abrir caja */}
        {mostrarAbrir && (
          <form onSubmit={abrirCaja} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">Abrir caja</h3>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">ID Planilla de Caja (Centum)</label>
              <input
                type="text"
                value={planillaId}
                onChange={(e) => setPlanillaId(e.target.value)}
                placeholder="Ej: 12345"
                className="campo-form text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Cambio inicial</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fondoFijo}
                onChange={(e) => setFondoFijo(e.target.value)}
                placeholder="$0.00"
                className="campo-form text-sm"
              />
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
                      {formatFecha(cierre.fecha)} · {cierre.cajero?.nombre}
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
                      {formatFecha(cierre.fecha)} · {cierre.cajero?.nombre}
                      {cierre.cajero?.sucursales?.nombre && (
                        <span> · {cierre.cajero.sucursales.nombre}</span>
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
      </div>
    </div>
  )
}

export default CajasHome
