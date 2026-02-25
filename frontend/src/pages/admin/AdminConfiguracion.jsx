// Panel de administrador: configuración general (sucursales)
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

const AdminConfiguracion = () => {
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [creando, setCreando] = useState(false)
  const [mensaje, setMensaje] = useState('')

  const cargarSucursales = async () => {
    try {
      const { data } = await api.get('/api/sucursales')
      setSucursales(data)
    } catch (err) {
      console.error('Error al cargar sucursales:', err)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarSucursales()
  }, [])

  const crearSucursal = async (e) => {
    e.preventDefault()
    if (!nuevoNombre.trim()) {
      setMensaje('Ingresá el nombre de la sucursal')
      return
    }

    setCreando(true)
    setMensaje('')

    try {
      await api.post('/api/sucursales', { nombre: nuevoNombre.trim() })
      setMensaje('ok:Sucursal creada correctamente')
      setNuevoNombre('')
      await cargarSucursales()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear sucursal'
      setMensaje(msg)
    } finally {
      setCreando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Configuración" tabs={ADMIN_TABS} />

      <div className="px-4 py-4 space-y-4">

        {/* Crear nueva sucursal */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Nueva sucursal</h2>
          <form onSubmit={crearSucursal} className="space-y-3">
            <input
              type="text"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre de la sucursal"
              className="campo-form text-sm"
            />
            <button
              type="submit"
              disabled={creando}
              className="btn-primario"
            >
              {creando ? 'Creando...' : 'Crear sucursal'}
            </button>
            {mensaje && (
              <p className={`text-sm ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
              </p>
            )}
          </form>
        </div>

        {/* Lista de sucursales */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Sucursales existentes</h2>

          {cargando ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {sucursales.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  No hay sucursales creadas
                </p>
              )}
              {sucursales.map(sucursal => (
                <div key={sucursal.id} className="flex items-center py-2 border-b border-gray-100 last:border-0">
                  <p className="text-sm font-medium text-gray-800">{sucursal.nombre}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AdminConfiguracion
