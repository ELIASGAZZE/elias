// Página principal de la app Control de Cajas
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const ESTADOS = {
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
  const { usuario, esAdmin, esGestor } = useAuth()
  const [cierres, setCierres] = useState([])
  const [cargando, setCargando] = useState(true)
  const [cajas, setCajas] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [filtroSucursal, setFiltroSucursal] = useState('')

  // Admin: gestión de cajas
  const [mostrarGestionCajas, setMostrarGestionCajas] = useState(false)
  const [nuevaCaja, setNuevaCaja] = useState({ nombre: '', sucursal_id: '' })
  const [creandoCaja, setCreandoCaja] = useState(false)
  const [mensajeCaja, setMensajeCaja] = useState('')

  useEffect(() => {
    cargarDatos()
  }, [filtroSucursal])

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const params = {}
      if (filtroSucursal) params.sucursal_id = filtroSucursal

      const [cierresRes, cajasRes] = await Promise.all([
        api.get('/api/cierres', { params }),
        api.get('/api/cajas', { params: { todas: 'true', ...(filtroSucursal ? { sucursal_id: filtroSucursal } : {}) } }),
      ])
      setCierres(cierresRes.data)
      setCajas(cajasRes.data)

      if (esAdmin) {
        const sucRes = await api.get('/api/sucursales')
        setSucursales(sucRes.data)
      }
    } catch (err) {
      console.error('Error cargando datos:', err)
    } finally {
      setCargando(false)
    }
  }

  const crearCaja = async (e) => {
    e.preventDefault()
    if (!nuevaCaja.nombre.trim() || !nuevaCaja.sucursal_id) {
      setMensajeCaja('Completá nombre y sucursal')
      return
    }
    setCreandoCaja(true)
    setMensajeCaja('')
    try {
      await api.post('/api/cajas', nuevaCaja)
      setNuevaCaja({ nombre: '', sucursal_id: '' })
      setMensajeCaja('')
      await cargarDatos()
    } catch (err) {
      setMensajeCaja(err.response?.data?.error || 'Error al crear caja')
    } finally {
      setCreandoCaja(false)
    }
  }

  const toggleActivoCaja = async (caja) => {
    try {
      await api.put(`/api/cajas/${caja.id}`, { activo: !caja.activo })
      await cargarDatos()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al actualizar caja')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <Navbar titulo="Control de Cajas" sinTabs />

      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto">

        {/* Acciones principales */}
        <div className="flex flex-wrap gap-2">
          {(usuario?.rol === 'operario' || esAdmin) && (
            <Link
              to="/cajas/cierre/nuevo"
              className="flex-1 min-w-[140px] bg-emerald-600 hover:bg-emerald-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              + Nuevo Cierre
            </Link>
          )}
          {esAdmin && (
            <button
              onClick={() => setMostrarGestionCajas(!mostrarGestionCajas)}
              className="flex-1 min-w-[140px] bg-gray-600 hover:bg-gray-700 text-white text-center py-3 rounded-xl font-medium transition-colors text-sm"
            >
              {mostrarGestionCajas ? 'Ocultar Cajas' : 'Gestionar Cajas'}
            </button>
          )}
        </div>

        {/* Filtro admin por sucursal */}
        {esAdmin && (
          <select
            value={filtroSucursal}
            onChange={(e) => setFiltroSucursal(e.target.value)}
            className="campo-form text-sm"
          >
            <option value="">Todas las sucursales</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        )}

        {/* Gestión de cajas (admin) */}
        {esAdmin && mostrarGestionCajas && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-gray-700 text-sm">Cajas registradoras</h3>

            <form onSubmit={crearCaja} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={nuevaCaja.nombre}
                onChange={(e) => setNuevaCaja(prev => ({ ...prev, nombre: e.target.value }))}
                placeholder="Nombre de caja (ej: Caja 1)"
                className="campo-form text-sm flex-1"
              />
              <select
                value={nuevaCaja.sucursal_id}
                onChange={(e) => setNuevaCaja(prev => ({ ...prev, sucursal_id: e.target.value }))}
                className="campo-form text-sm"
              >
                <option value="">Sucursal</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <button type="submit" disabled={creandoCaja} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {creandoCaja ? '...' : 'Crear'}
              </button>
            </form>
            {mensajeCaja && <p className="text-sm text-red-600">{mensajeCaja}</p>}

            <div className="divide-y divide-gray-100">
              {cajas.map(caja => (
                <div key={caja.id} className="flex items-center justify-between py-2">
                  <div>
                    <span className="text-sm font-medium text-gray-800">{caja.nombre}</span>
                    <span className="text-xs text-gray-400 ml-2">{caja.sucursales?.nombre}</span>
                  </div>
                  <button
                    onClick={() => toggleActivoCaja(caja)}
                    className={`text-xs px-3 py-1 rounded-lg transition-colors ${
                      caja.activo
                        ? 'bg-green-50 text-green-600 hover:bg-green-100'
                        : 'bg-red-50 text-red-600 hover:bg-red-100'
                    }`}
                  >
                    {caja.activo ? 'Activa' : 'Inactiva'}
                  </button>
                </div>
              ))}
              {cajas.length === 0 && (
                <p className="text-sm text-gray-400 py-3 text-center">No hay cajas creadas</p>
              )}
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
          ) : cierres.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-gray-400 text-sm">No hay cierres</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cierres.map(cierre => (
                <Link
                  key={cierre.id}
                  to={
                    esGestor && cierre.estado === 'pendiente_gestor'
                      ? `/cajas/verificar/${cierre.id}`
                      : `/cajas/cierre/${cierre.id}`
                  }
                  className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-800">
                      {cierre.cajas?.nombre}
                    </span>
                    <BadgeEstado estado={cierre.estado} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-400">
                      {formatFecha(cierre.fecha)} · {cierre.cajero?.nombre}
                      {cierre.cajas?.sucursales?.nombre && (
                        <span> · {cierre.cajas.sucursales.nombre}</span>
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
