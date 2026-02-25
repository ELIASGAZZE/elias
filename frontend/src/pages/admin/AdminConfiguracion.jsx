// Panel de administrador: configuración general (usuarios y sucursales)
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

const AdminConfiguracion = () => {
  // Sucursales
  const [sucursales, setSucursales] = useState([])
  const [cargandoSucursales, setCargandoSucursales] = useState(true)
  const [nuevoNombreSucursal, setNuevoNombreSucursal] = useState('')
  const [creandoSucursal, setCreandoSucursal] = useState(false)
  const [mensajeSucursal, setMensajeSucursal] = useState('')

  // Usuarios
  const [usuarios, setUsuarios] = useState([])
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true)
  const [nuevoUsuario, setNuevoUsuario] = useState({ username: '', password: '', nombre: '', rol: 'operario' })
  const [creandoUsuario, setCreandoUsuario] = useState(false)
  const [mensajeUsuario, setMensajeUsuario] = useState('')

  const cargarSucursales = async () => {
    try {
      const { data } = await api.get('/api/sucursales')
      setSucursales(data)
    } catch (err) {
      console.error('Error al cargar sucursales:', err)
    } finally {
      setCargandoSucursales(false)
    }
  }

  const cargarUsuarios = async () => {
    try {
      const { data } = await api.get('/api/auth/usuarios')
      setUsuarios(data)
    } catch (err) {
      console.error('Error al cargar usuarios:', err)
    } finally {
      setCargandoUsuarios(false)
    }
  }

  useEffect(() => {
    cargarSucursales()
    cargarUsuarios()
  }, [])

  // --- Sucursales ---
  const crearSucursal = async (e) => {
    e.preventDefault()
    if (!nuevoNombreSucursal.trim()) {
      setMensajeSucursal('Ingresá el nombre de la sucursal')
      return
    }

    setCreandoSucursal(true)
    setMensajeSucursal('')

    try {
      await api.post('/api/sucursales', { nombre: nuevoNombreSucursal.trim() })
      setMensajeSucursal('ok:Sucursal creada correctamente')
      setNuevoNombreSucursal('')
      await cargarSucursales()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear sucursal'
      setMensajeSucursal(msg)
    } finally {
      setCreandoSucursal(false)
    }
  }

  // --- Usuarios ---
  const crearUsuario = async (e) => {
    e.preventDefault()
    if (!nuevoUsuario.username.trim() || !nuevoUsuario.password || !nuevoUsuario.nombre.trim()) {
      setMensajeUsuario('Completá todos los campos')
      return
    }

    setCreandoUsuario(true)
    setMensajeUsuario('')

    try {
      await api.post('/api/auth/usuarios', nuevoUsuario)
      setMensajeUsuario('ok:Usuario creado correctamente')
      setNuevoUsuario({ username: '', password: '', nombre: '', rol: 'operario' })
      await cargarUsuarios()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear usuario'
      setMensajeUsuario(msg)
    } finally {
      setCreandoUsuario(false)
    }
  }

  const eliminarUsuario = async (id, nombre) => {
    if (!confirm(`¿Eliminar al usuario "${nombre}"?`)) return

    try {
      await api.delete(`/api/auth/usuarios/${id}`)
      await cargarUsuarios()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar usuario')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Configuración" tabs={ADMIN_TABS} />

      <div className="px-4 py-4 space-y-4">

        {/* ===== SECCIÓN USUARIOS ===== */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Nuevo usuario</h2>
          <form onSubmit={crearUsuario} className="space-y-3">
            <input
              type="text"
              value={nuevoUsuario.username}
              onChange={(e) => setNuevoUsuario(prev => ({ ...prev, username: e.target.value }))}
              placeholder="Nombre de usuario (ej: juan)"
              className="campo-form text-sm"
            />
            <input
              type="password"
              value={nuevoUsuario.password}
              onChange={(e) => setNuevoUsuario(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Contraseña"
              className="campo-form text-sm"
            />
            <input
              type="text"
              value={nuevoUsuario.nombre}
              onChange={(e) => setNuevoUsuario(prev => ({ ...prev, nombre: e.target.value }))}
              placeholder="Nombre completo (ej: Juan Pérez)"
              className="campo-form text-sm"
            />
            <select
              value={nuevoUsuario.rol}
              onChange={(e) => setNuevoUsuario(prev => ({ ...prev, rol: e.target.value }))}
              className="campo-form text-sm"
            >
              <option value="operario">Operario</option>
              <option value="admin">Administrador</option>
            </select>
            <button
              type="submit"
              disabled={creandoUsuario}
              className="btn-primario"
            >
              {creandoUsuario ? 'Creando...' : 'Crear usuario'}
            </button>
            {mensajeUsuario && (
              <p className={`text-sm ${mensajeUsuario.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensajeUsuario.startsWith('ok:') ? mensajeUsuario.slice(3) : mensajeUsuario}
              </p>
            )}
          </form>
        </div>

        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Usuarios existentes</h2>

          {cargandoUsuarios ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {usuarios.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">
                  No hay usuarios creados
                </p>
              )}
              {usuarios.map(usuario => (
                <div key={usuario.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{usuario.nombre}</p>
                    <p className="text-xs text-gray-400">
                      @{usuario.username} · {usuario.rol}
                    </p>
                  </div>
                  <button
                    onClick={() => eliminarUsuario(usuario.id, usuario.nombre)}
                    className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ===== SECCIÓN SUCURSALES ===== */}
        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Nueva sucursal</h2>
          <form onSubmit={crearSucursal} className="space-y-3">
            <input
              type="text"
              value={nuevoNombreSucursal}
              onChange={(e) => setNuevoNombreSucursal(e.target.value)}
              placeholder="Nombre de la sucursal"
              className="campo-form text-sm"
            />
            <button
              type="submit"
              disabled={creandoSucursal}
              className="btn-primario"
            >
              {creandoSucursal ? 'Creando...' : 'Crear sucursal'}
            </button>
            {mensajeSucursal && (
              <p className={`text-sm ${mensajeSucursal.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensajeSucursal.startsWith('ok:') ? mensajeSucursal.slice(3) : mensajeSucursal}
              </p>
            )}
          </form>
        </div>

        <div className="tarjeta">
          <h2 className="font-semibold text-gray-700 mb-3">Sucursales existentes</h2>

          {cargandoSucursales ? (
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
