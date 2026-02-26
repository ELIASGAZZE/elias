// Panel de administrador: configuración general (usuarios, rubros y sucursales)
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
import { ADMIN_TABS } from '../../components/layout/navTabs'
import api from '../../services/api'

const ChevronIcon = ({ abierta }) => (
  <svg
    className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${abierta ? 'rotate-90' : ''}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
)

const SeccionAcordeon = ({ id, titulo, count, abierta, onToggle, cargando, children }) => (
  <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
    <button
      onClick={() => onToggle(id)}
      className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <ChevronIcon abierta={abierta} />
        <span className="font-semibold text-gray-700">{titulo}</span>
      </div>
      <span className="bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1 rounded-full">
        {cargando ? '…' : count}
      </span>
    </button>
    {abierta && (
      <div className="px-4 pb-4 border-t border-gray-100">
        {children}
      </div>
    )}
  </div>
)

const MensajeForm = ({ mensaje }) => {
  if (!mensaje) return null
  const esOk = mensaje.startsWith('ok:')
  return (
    <p className={`text-sm mt-2 ${esOk ? 'text-green-600' : 'text-red-600'}`}>
      {esOk ? mensaje.slice(3) : mensaje}
    </p>
  )
}

const AdminConfiguracion = () => {
  // Acordeón
  const [seccionAbierta, setSeccionAbierta] = useState(null)

  // Sucursales
  const [sucursales, setSucursales] = useState([])
  const [cargandoSucursales, setCargandoSucursales] = useState(true)
  const [nuevoNombreSucursal, setNuevoNombreSucursal] = useState('')
  const [creandoSucursal, setCreandoSucursal] = useState(false)
  const [mensajeSucursal, setMensajeSucursal] = useState('')

  // Rubros
  const [rubros, setRubros] = useState([])
  const [cargandoRubros, setCargandoRubros] = useState(true)
  const [nuevoNombreRubro, setNuevoNombreRubro] = useState('')
  const [creandoRubro, setCreandoRubro] = useState(false)
  const [mensajeRubro, setMensajeRubro] = useState('')

  // Usuarios
  const [usuarios, setUsuarios] = useState([])
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true)
  const [nuevoUsuario, setNuevoUsuario] = useState({ username: '', password: '', nombre: '', rol: 'operario', sucursal_id: '' })
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

  const cargarRubros = async () => {
    try {
      const { data } = await api.get('/api/rubros')
      setRubros(data)
    } catch (err) {
      console.error('Error al cargar rubros:', err)
    } finally {
      setCargandoRubros(false)
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
    cargarRubros()
    cargarUsuarios()
  }, [])

  const toggleSeccion = (id) => {
    setSeccionAbierta(prev => prev === id ? null : id)
  }

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

  // --- Rubros ---
  const crearRubro = async (e) => {
    e.preventDefault()
    if (!nuevoNombreRubro.trim()) {
      setMensajeRubro('Ingresá el nombre del rubro')
      return
    }

    setCreandoRubro(true)
    setMensajeRubro('')

    try {
      await api.post('/api/rubros', { nombre: nuevoNombreRubro.trim() })
      setMensajeRubro('ok:Rubro creado correctamente')
      setNuevoNombreRubro('')
      await cargarRubros()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear rubro'
      setMensajeRubro(msg)
    } finally {
      setCreandoRubro(false)
    }
  }

  const eliminarRubro = async (id, nombre) => {
    if (!confirm(`¿Eliminar el rubro "${nombre}"?`)) return

    try {
      await api.delete(`/api/rubros/${id}`)
      await cargarRubros()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar rubro')
    }
  }

  // --- Usuarios ---
  const crearUsuario = async (e) => {
    e.preventDefault()
    if (!nuevoUsuario.username.trim() || !nuevoUsuario.password || !nuevoUsuario.nombre.trim()) {
      setMensajeUsuario('Completá todos los campos')
      return
    }

    if (nuevoUsuario.rol === 'operario' && !nuevoUsuario.sucursal_id) {
      setMensajeUsuario('Seleccioná una sucursal para el operario')
      return
    }

    setCreandoUsuario(true)
    setMensajeUsuario('')

    try {
      await api.post('/api/auth/usuarios', nuevoUsuario)
      setMensajeUsuario('ok:Usuario creado correctamente')
      setNuevoUsuario({ username: '', password: '', nombre: '', rol: 'operario', sucursal_id: '' })
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

      <div className="px-4 py-4 space-y-3">

        {/* ===== USUARIOS ===== */}
        <SeccionAcordeon
          id="usuarios"
          titulo="Usuarios"
          count={usuarios.length}
          abierta={seccionAbierta === 'usuarios'}
          onToggle={toggleSeccion}
          cargando={cargandoUsuarios}
        >
          <form onSubmit={crearUsuario} className="space-y-3 pt-4">
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
              onChange={(e) => setNuevoUsuario(prev => ({ ...prev, rol: e.target.value, sucursal_id: '' }))}
              className="campo-form text-sm"
            >
              <option value="operario">Operario</option>
              <option value="admin">Administrador</option>
            </select>
            {nuevoUsuario.rol === 'operario' && (
              <select
                value={nuevoUsuario.sucursal_id}
                onChange={(e) => setNuevoUsuario(prev => ({ ...prev, sucursal_id: e.target.value }))}
                className="campo-form text-sm"
              >
                <option value="">Seleccioná una sucursal</option>
                {sucursales.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            )}
            <button type="submit" disabled={creandoUsuario} className="btn-primario">
              {creandoUsuario ? 'Creando...' : 'Crear usuario'}
            </button>
            <MensajeForm mensaje={mensajeUsuario} />
          </form>

          {cargandoUsuarios ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="mt-4">
              {usuarios.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No hay usuarios creados</p>
              ) : (
                <div className="space-y-0 divide-y divide-gray-100">
                  {usuarios.map(usuario => (
                    <div key={usuario.id} className="flex items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{usuario.nombre}</p>
                        <p className="text-xs text-gray-400 truncate">@{usuario.username} · {usuario.rol}</p>
                      </div>
                      <button
                        onClick={() => eliminarUsuario(usuario.id, usuario.nombre)}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SeccionAcordeon>

        {/* ===== RUBROS ===== */}
        <SeccionAcordeon
          id="rubros"
          titulo="Rubros"
          count={rubros.length}
          abierta={seccionAbierta === 'rubros'}
          onToggle={toggleSeccion}
          cargando={cargandoRubros}
        >
          <form onSubmit={crearRubro} className="flex items-center gap-2 pt-4">
            <input
              type="text"
              value={nuevoNombreRubro}
              onChange={(e) => setNuevoNombreRubro(e.target.value)}
              placeholder="Nuevo rubro..."
              className="campo-form text-sm flex-1"
            />
            <button
              type="submit"
              disabled={creandoRubro}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-50"
            >
              {creandoRubro ? '...' : '+'}
            </button>
          </form>
          <MensajeForm mensaje={mensajeRubro} />

          {cargandoRubros ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="mt-3">
              {rubros.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No hay rubros creados</p>
              ) : (
                <div className="space-y-0 divide-y divide-gray-100">
                  {rubros.map(rubro => (
                    <div key={rubro.id} className="flex items-center justify-between gap-2 py-2.5">
                      <p className="text-sm font-medium text-gray-800">{rubro.nombre}</p>
                      <button
                        onClick={() => eliminarRubro(rubro.id, rubro.nombre)}
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SeccionAcordeon>

        {/* ===== SUCURSALES ===== */}
        <SeccionAcordeon
          id="sucursales"
          titulo="Sucursales"
          count={sucursales.length}
          abierta={seccionAbierta === 'sucursales'}
          onToggle={toggleSeccion}
          cargando={cargandoSucursales}
        >
          <form onSubmit={crearSucursal} className="flex items-center gap-2 pt-4">
            <input
              type="text"
              value={nuevoNombreSucursal}
              onChange={(e) => setNuevoNombreSucursal(e.target.value)}
              placeholder="Nueva sucursal..."
              className="campo-form text-sm flex-1"
            />
            <button
              type="submit"
              disabled={creandoSucursal}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-50"
            >
              {creandoSucursal ? '...' : '+'}
            </button>
          </form>
          <MensajeForm mensaje={mensajeSucursal} />

          {cargandoSucursales ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="mt-3">
              {sucursales.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No hay sucursales creadas</p>
              ) : (
                <div className="space-y-0 divide-y divide-gray-100">
                  {sucursales.map(sucursal => (
                    <div key={sucursal.id} className="flex items-center py-2.5">
                      <p className="text-sm font-medium text-gray-800">{sucursal.nombre}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SeccionAcordeon>

      </div>
    </div>
  )
}

export default AdminConfiguracion
