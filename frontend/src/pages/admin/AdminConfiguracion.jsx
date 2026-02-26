// Panel de administrador: configuración general (usuarios, rubros y sucursales)
import React, { useState, useEffect } from 'react'
import Navbar from '../../components/layout/Navbar'
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
  const [editandoSucursalId, setEditandoSucursalId] = useState(null)
  const [editandoSucursalNombre, setEditandoSucursalNombre] = useState('')

  // Rubros
  const [rubros, setRubros] = useState([])
  const [cargandoRubros, setCargandoRubros] = useState(true)
  const [nuevoNombreRubro, setNuevoNombreRubro] = useState('')
  const [creandoRubro, setCreandoRubro] = useState(false)
  const [mensajeRubro, setMensajeRubro] = useState('')
  const [editandoRubroId, setEditandoRubroId] = useState(null)
  const [editandoRubroNombre, setEditandoRubroNombre] = useState('')

  // Usuarios
  const [usuarios, setUsuarios] = useState([])
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true)
  const [nuevoUsuario, setNuevoUsuario] = useState({ username: '', password: '', nombre: '', rol: 'operario', sucursal_id: '' })
  const [creandoUsuario, setCreandoUsuario] = useState(false)
  const [mensajeUsuario, setMensajeUsuario] = useState('')
  const [usuarioEditando, setUsuarioEditando] = useState(null)
  const [editUsuarioData, setEditUsuarioData] = useState({ nombre: '', rol: '', sucursal_id: '' })
  const [guardandoUsuario, setGuardandoUsuario] = useState(false)
  const [mensajeEditUsuario, setMensajeEditUsuario] = useState('')

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

  const iniciarEdicionSucursal = (sucursal) => {
    setEditandoSucursalId(sucursal.id)
    setEditandoSucursalNombre(sucursal.nombre)
  }

  const cancelarEdicionSucursal = () => {
    setEditandoSucursalId(null)
    setEditandoSucursalNombre('')
  }

  const guardarEdicionSucursal = async (id) => {
    if (!editandoSucursalNombre.trim()) return
    try {
      await api.put(`/api/sucursales/${id}`, { nombre: editandoSucursalNombre.trim() })
      setEditandoSucursalId(null)
      setEditandoSucursalNombre('')
      await cargarSucursales()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al editar sucursal')
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

  const iniciarEdicionRubro = (rubro) => {
    setEditandoRubroId(rubro.id)
    setEditandoRubroNombre(rubro.nombre)
  }

  const cancelarEdicionRubro = () => {
    setEditandoRubroId(null)
    setEditandoRubroNombre('')
  }

  const guardarEdicionRubro = async (id) => {
    if (!editandoRubroNombre.trim()) return
    try {
      await api.put(`/api/rubros/${id}`, { nombre: editandoRubroNombre.trim() })
      setEditandoRubroId(null)
      setEditandoRubroNombre('')
      await cargarRubros()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al editar rubro')
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

  const abrirEditarUsuario = (usuario) => {
    setUsuarioEditando(usuario)
    setEditUsuarioData({
      nombre: usuario.nombre,
      rol: usuario.rol,
      sucursal_id: usuario.sucursal_id || '',
    })
    setMensajeEditUsuario('')
  }

  const cerrarEditarUsuario = () => {
    setUsuarioEditando(null)
    setEditUsuarioData({ nombre: '', rol: '', sucursal_id: '' })
    setMensajeEditUsuario('')
  }

  const guardarEditarUsuario = async () => {
    if (!editUsuarioData.nombre.trim()) {
      setMensajeEditUsuario('El nombre es requerido')
      return
    }
    if (editUsuarioData.rol === 'operario' && !editUsuarioData.sucursal_id) {
      setMensajeEditUsuario('Seleccioná una sucursal para el operario')
      return
    }

    setGuardandoUsuario(true)
    setMensajeEditUsuario('')

    try {
      await api.put(`/api/auth/usuarios/${usuarioEditando.id}`, editUsuarioData)
      cerrarEditarUsuario()
      await cargarUsuarios()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al editar usuario'
      setMensajeEditUsuario(msg)
    } finally {
      setGuardandoUsuario(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo="Configuración" sinTabs />

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
                      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => abrirEditarUsuario(usuario)}>
                        <p className="text-sm font-medium text-gray-800 truncate">{usuario.nombre}</p>
                        <p className="text-xs text-gray-400 truncate">@{usuario.username} · {usuario.rol}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => abrirEditarUsuario(usuario)}
                          className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => eliminarUsuario(usuario.id, usuario.nombre)}
                          className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Eliminar
                        </button>
                      </div>
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
                      {editandoRubroId === rubro.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editandoRubroNombre}
                            onChange={(e) => setEditandoRubroNombre(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarEdicionRubro(rubro.id)
                              if (e.key === 'Escape') cancelarEdicionRubro()
                            }}
                            autoFocus
                            className="campo-form text-sm flex-1"
                          />
                          <button
                            onClick={() => guardarEdicionRubro(rubro.id)}
                            className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            OK
                          </button>
                          <button
                            onClick={cancelarEdicionRubro}
                            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <>
                          <p
                            className="text-sm font-medium text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
                            onClick={() => iniciarEdicionRubro(rubro)}
                          >
                            {rubro.nombre}
                          </p>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => iniciarEdicionRubro(rubro)}
                              className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => eliminarRubro(rubro.id, rubro.nombre)}
                              className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Eliminar
                            </button>
                          </div>
                        </>
                      )}
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
                    <div key={sucursal.id} className="flex items-center justify-between gap-2 py-2.5">
                      {editandoSucursalId === sucursal.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editandoSucursalNombre}
                            onChange={(e) => setEditandoSucursalNombre(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarEdicionSucursal(sucursal.id)
                              if (e.key === 'Escape') cancelarEdicionSucursal()
                            }}
                            autoFocus
                            className="campo-form text-sm flex-1"
                          />
                          <button
                            onClick={() => guardarEdicionSucursal(sucursal.id)}
                            className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            OK
                          </button>
                          <button
                            onClick={cancelarEdicionSucursal}
                            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <>
                          <p
                            className="text-sm font-medium text-gray-800 cursor-pointer hover:text-blue-600 transition-colors"
                            onClick={() => iniciarEdicionSucursal(sucursal)}
                          >
                            {sucursal.nombre}
                          </p>
                          <button
                            onClick={() => iniciarEdicionSucursal(sucursal)}
                            className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                          >
                            Editar
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SeccionAcordeon>

      </div>

      {/* ===== MODAL EDITAR USUARIO ===== */}
      {usuarioEditando && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={cerrarEditarUsuario}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Editar usuario</h3>
              <button onClick={cerrarEditarUsuario} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">@{usuarioEditando.username} (no editable)</p>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Nombre</label>
                <input
                  type="text"
                  value={editUsuarioData.nombre}
                  onChange={(e) => setEditUsuarioData(prev => ({ ...prev, nombre: e.target.value }))}
                  className="campo-form text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Rol</label>
                <select
                  value={editUsuarioData.rol}
                  onChange={(e) => setEditUsuarioData(prev => ({ ...prev, rol: e.target.value, sucursal_id: e.target.value === 'admin' ? '' : prev.sucursal_id }))}
                  className="campo-form text-sm"
                >
                  <option value="operario">Operario</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              {editUsuarioData.rol === 'operario' && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Sucursal</label>
                  <select
                    value={editUsuarioData.sucursal_id}
                    onChange={(e) => setEditUsuarioData(prev => ({ ...prev, sucursal_id: e.target.value }))}
                    className="campo-form text-sm"
                  >
                    <option value="">Seleccioná una sucursal</option>
                    {sucursales.map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              <MensajeForm mensaje={mensajeEditUsuario} />
            </div>

            <div className="flex gap-2 p-4 border-t border-gray-100">
              <button
                onClick={cerrarEditarUsuario}
                className="flex-1 text-sm py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={guardarEditarUsuario}
                disabled={guardandoUsuario}
                className="flex-1 btn-primario"
              >
                {guardandoUsuario ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminConfiguracion
