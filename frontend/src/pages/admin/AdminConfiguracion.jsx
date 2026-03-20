// Panel de administrador: configuración general (usuarios, cajas, denominaciones, formas de cobro, rubros y sucursales)
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import AdminPromociones from '../../components/pos/AdminPromociones'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import SeccionClientes from '../../components/admin/SeccionClientes'
import AdminArticulosAtributos from '../../components/admin/AdminArticulosAtributos'
import SeccionDelivery from './SeccionDelivery'
import SeccionGruposDescuento from '../../components/admin/SeccionGruposDescuento'

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

const BotonActivo = ({ activo, onClick }) => (
  <button
    onClick={onClick}
    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
      activo
        ? 'bg-green-50 text-green-600 hover:bg-green-100'
        : 'bg-red-50 text-red-600 hover:bg-red-100'
    }`}
  >
    {activo ? 'Activo' : 'Inactivo'}
  </button>
)

const TITULOS_SECCION = {
  usuarios: 'Usuarios',
  cajas: 'Cajas',
  denominaciones: 'Denominaciones',
  'formas-cobro': 'Formas de Cobro',
  rubros: 'Rubros',
  sucursales: 'Sucursales',
  'articulos-atributos': 'Artículos',
  promociones: 'Promociones POS',
  clientes: 'Clientes',
  'delivery': 'Precios Delivery',
  'bloqueos-pedidos': 'Bloqueos de Pedidos',
  'grupos-descuento': 'Grupos de Descuento',
}

const AdminConfiguracion = () => {
  const { seccion } = useParams()
  const navigate = useNavigate()
  const { esAdmin } = useAuth()

  // Gestor solo puede acceder a promociones
  if (!esAdmin && seccion !== 'promociones') {
    navigate('/admin/configuracion', { replace: true })
    return null
  }

  // Acordeón (legacy, ahora siempre abierta la sección de la URL)
  const seccionAbierta = seccion || null

  // Sync POS
  const [sincronizandoPOS, setSincronizandoPOS] = useState(false)
  const [mensajeSyncPOS, setMensajeSyncPOS] = useState(null)

  // Sucursales
  const [sucursales, setSucursales] = useState([])
  const [cargandoSucursales, setCargandoSucursales] = useState(true)
  const [nuevoNombreSucursal, setNuevoNombreSucursal] = useState('')
  const [creandoSucursal, setCreandoSucursal] = useState(false)
  const [mensajeSucursal, setMensajeSucursal] = useState('')
  const [editandoSucursalId, setEditandoSucursalId] = useState(null)
  const [editandoSucursalNombre, setEditandoSucursalNombre] = useState('')
  const [editandoSucursalCentumId, setEditandoSucursalCentumId] = useState('')
  const [editandoOperadorEmpresa, setEditandoOperadorEmpresa] = useState('')
  const [editandoOperadorPrueba, setEditandoOperadorPrueba] = useState('')

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
  const [editUsuarioData, setEditUsuarioData] = useState({ nombre: '', rol: '', sucursal_id: '', username: '', password: '' })
  const [guardandoUsuario, setGuardandoUsuario] = useState(false)
  const [mensajeEditUsuario, setMensajeEditUsuario] = useState('')

  // Cajas
  const [cajas, setCajas] = useState([])
  const [cargandoCajas, setCargandoCajas] = useState(true)
  const [nuevaCaja, setNuevaCaja] = useState({ nombre: '', sucursal_id: '' })
  const [creandoCaja, setCreandoCaja] = useState(false)
  const [mensajeCaja, setMensajeCaja] = useState('')
  const [editandoCajaId, setEditandoCajaId] = useState(null)
  const [editandoCajaData, setEditandoCajaData] = useState({ nombre: '', punto_venta_centum: '' })

  // Denominaciones
  const [denominaciones, setDenominaciones] = useState([])
  const [cargandoDenominaciones, setCargandoDenominaciones] = useState(true)
  const [nuevaDenominacion, setNuevaDenominacion] = useState({ valor: '', tipo: 'billete', orden: '' })
  const [creandoDenominacion, setCreandoDenominacion] = useState(false)
  const [mensajeDenominacion, setMensajeDenominacion] = useState('')
  const [editandoDenominacionId, setEditandoDenominacionId] = useState(null)
  const [editandoDenominacionData, setEditandoDenominacionData] = useState({ valor: '', tipo: '', orden: '' })

  // Formas de Cobro
  const [formasCobro, setFormasCobro] = useState([])
  const [cargandoFormasCobro, setCargandoFormasCobro] = useState(true)
  const [nuevaFormaCobro, setNuevaFormaCobro] = useState({ nombre: '', orden: '' })
  const [creandoFormaCobro, setCreandoFormaCobro] = useState(false)
  const [mensajeFormaCobro, setMensajeFormaCobro] = useState('')
  const [editandoFormaCobroId, setEditandoFormaCobroId] = useState(null)
  const [editandoFormaCobroData, setEditandoFormaCobroData] = useState({ nombre: '', orden: '' })

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

  const cargarCajas = async () => {
    try {
      const { data } = await api.get('/api/cajas?todas=true')
      setCajas(data)
    } catch (err) {
      console.error('Error al cargar cajas:', err)
    } finally {
      setCargandoCajas(false)
    }
  }

  const cargarDenominaciones = async () => {
    try {
      const { data } = await api.get('/api/denominaciones')
      setDenominaciones(data)
    } catch (err) {
      console.error('Error al cargar denominaciones:', err)
    } finally {
      setCargandoDenominaciones(false)
    }
  }

  const cargarFormasCobro = async () => {
    try {
      const { data } = await api.get('/api/formas-cobro')
      setFormasCobro(data)
    } catch (err) {
      console.error('Error al cargar formas de cobro:', err)
    } finally {
      setCargandoFormasCobro(false)
    }
  }

  useEffect(() => {
    // Sucursales se necesita para usuarios y cajas
    if (['usuarios', 'cajas'].includes(seccion)) {
      cargarSucursales()
    }
    if (seccion === 'usuarios') cargarUsuarios()
    if (seccion === 'cajas') cargarCajas()
    if (seccion === 'denominaciones') cargarDenominaciones()
    if (seccion === 'formas-cobro') cargarFormasCobro()
    if (seccion === 'rubros') cargarRubros()
    if (seccion === 'sucursales') cargarSucursales()
  }, [seccion])

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
    setEditandoSucursalCentumId(sucursal.centum_sucursal_id || '')
    setEditandoOperadorEmpresa(sucursal.centum_operador_empresa || '')
    setEditandoOperadorPrueba(sucursal.centum_operador_prueba || '')
  }

  const cancelarEdicionSucursal = () => {
    setEditandoSucursalId(null)
    setEditandoSucursalNombre('')
    setEditandoSucursalCentumId('')
    setEditandoOperadorEmpresa('')
    setEditandoOperadorPrueba('')
  }

  const guardarEdicionSucursal = async (id) => {
    if (!editandoSucursalNombre.trim()) return
    try {
      await api.put(`/api/sucursales/${id}`, {
        nombre: editandoSucursalNombre.trim(),
        centum_sucursal_id: editandoSucursalCentumId || null,
        centum_operador_empresa: editandoOperadorEmpresa || null,
        centum_operador_prueba: editandoOperadorPrueba || null,
      })
      setEditandoSucursalId(null)
      setEditandoSucursalNombre('')
      setEditandoSucursalCentumId('')
      setEditandoOperadorEmpresa('')
      setEditandoOperadorPrueba('')
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
      username: usuario.username,
      password: '',
    })
    setMensajeEditUsuario('')
  }

  const cerrarEditarUsuario = () => {
    setUsuarioEditando(null)
    setEditUsuarioData({ nombre: '', rol: '', sucursal_id: '', username: '', password: '' })
    setMensajeEditUsuario('')
  }

  const guardarEditarUsuario = async () => {
    if (!editUsuarioData.nombre.trim()) {
      setMensajeEditUsuario('El nombre es requerido')
      return
    }
    if (!editUsuarioData.username.trim()) {
      setMensajeEditUsuario('El usuario es requerido')
      return
    }
    if (editUsuarioData.password && editUsuarioData.password.length < 6) {
      setMensajeEditUsuario('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (editUsuarioData.rol === 'operario' && !editUsuarioData.sucursal_id) {
      setMensajeEditUsuario('Seleccioná una sucursal')
      return
    }

    setGuardandoUsuario(true)
    setMensajeEditUsuario('')

    try {
      const payload = { ...editUsuarioData }
      if (!payload.password) delete payload.password
      await api.put(`/api/auth/usuarios/${usuarioEditando.id}`, payload)
      cerrarEditarUsuario()
      await cargarUsuarios()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al editar usuario'
      setMensajeEditUsuario(msg)
    } finally {
      setGuardandoUsuario(false)
    }
  }

  // --- Cajas ---
  const crearCaja = async (e) => {
    e.preventDefault()
    if (!nuevaCaja.nombre.trim()) {
      setMensajeCaja('Ingresá el nombre de la caja')
      return
    }
    if (!nuevaCaja.sucursal_id) {
      setMensajeCaja('Seleccioná una sucursal')
      return
    }

    setCreandoCaja(true)
    setMensajeCaja('')

    try {
      await api.post('/api/cajas', { nombre: nuevaCaja.nombre.trim(), sucursal_id: nuevaCaja.sucursal_id })
      setMensajeCaja('ok:Caja creada correctamente')
      setNuevaCaja({ nombre: '', sucursal_id: '' })
      await cargarCajas()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear caja'
      setMensajeCaja(msg)
    } finally {
      setCreandoCaja(false)
    }
  }

  const iniciarEdicionCaja = (caja) => {
    setEditandoCajaId(caja.id)
    setEditandoCajaData({ nombre: caja.nombre, punto_venta_centum: caja.punto_venta_centum || '' })
  }

  const cancelarEdicionCaja = () => {
    setEditandoCajaId(null)
    setEditandoCajaData({ nombre: '', punto_venta_centum: '' })
  }

  const guardarEdicionCaja = async (id) => {
    if (!editandoCajaData.nombre.trim()) return
    try {
      await api.put(`/api/cajas/${id}`, {
        nombre: editandoCajaData.nombre.trim(),
        punto_venta_centum: editandoCajaData.punto_venta_centum || null,
      })
      setEditandoCajaId(null)
      setEditandoCajaData({ nombre: '', punto_venta_centum: '' })
      await cargarCajas()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al editar caja')
    }
  }

  const toggleActivoCaja = async (caja) => {
    try {
      await api.put(`/api/cajas/${caja.id}`, { activo: !caja.activo })
      await cargarCajas()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cambiar estado de la caja')
    }
  }

  const eliminarCaja = async (caja) => {
    if (!confirm(`¿Eliminar la caja "${caja.nombre}"?`)) return
    try {
      await api.delete(`/api/cajas/${caja.id}`)
      await cargarCajas()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar caja')
    }
  }

  // --- Denominaciones ---
  const crearDenominacion = async (e) => {
    e.preventDefault()
    if (!nuevaDenominacion.valor) {
      setMensajeDenominacion('Ingresá el valor de la denominación')
      return
    }

    setCreandoDenominacion(true)
    setMensajeDenominacion('')

    try {
      const payload = {
        valor: Number(nuevaDenominacion.valor),
        tipo: nuevaDenominacion.tipo,
      }
      if (nuevaDenominacion.orden !== '') payload.orden = Number(nuevaDenominacion.orden)
      await api.post('/api/denominaciones', payload)
      setMensajeDenominacion('ok:Denominación creada correctamente')
      setNuevaDenominacion({ valor: '', tipo: 'billete', orden: '' })
      await cargarDenominaciones()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear denominación'
      setMensajeDenominacion(msg)
    } finally {
      setCreandoDenominacion(false)
    }
  }

  const iniciarEdicionDenominacion = (den) => {
    setEditandoDenominacionId(den.id)
    setEditandoDenominacionData({ valor: String(den.valor), tipo: den.tipo, orden: den.orden != null ? String(den.orden) : '' })
  }

  const cancelarEdicionDenominacion = () => {
    setEditandoDenominacionId(null)
    setEditandoDenominacionData({ valor: '', tipo: '', orden: '' })
  }

  const guardarEdicionDenominacion = async (id) => {
    if (!editandoDenominacionData.valor) return
    try {
      const payload = {
        valor: Number(editandoDenominacionData.valor),
        tipo: editandoDenominacionData.tipo,
      }
      if (editandoDenominacionData.orden !== '') payload.orden = Number(editandoDenominacionData.orden)
      await api.put(`/api/denominaciones/${id}`, payload)
      setEditandoDenominacionId(null)
      setEditandoDenominacionData({ valor: '', tipo: '', orden: '' })
      await cargarDenominaciones()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al editar denominación')
    }
  }

  const toggleActivoDenominacion = async (den) => {
    try {
      await api.put(`/api/denominaciones/${den.id}`, { activo: !den.activo })
      await cargarDenominaciones()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cambiar estado de la denominación')
    }
  }

  const eliminarDenominacion = async (den) => {
    if (!confirm(`¿Eliminar la denominación $${den.valor} (${den.tipo})?`)) return
    try {
      await api.delete(`/api/denominaciones/${den.id}`)
      await cargarDenominaciones()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar denominación')
    }
  }

  // --- Formas de Cobro ---
  const crearFormaCobro = async (e) => {
    e.preventDefault()
    if (!nuevaFormaCobro.nombre.trim()) {
      setMensajeFormaCobro('Ingresá el nombre de la forma de cobro')
      return
    }

    setCreandoFormaCobro(true)
    setMensajeFormaCobro('')

    try {
      const payload = { nombre: nuevaFormaCobro.nombre.trim() }
      if (nuevaFormaCobro.orden !== '') payload.orden = Number(nuevaFormaCobro.orden)
      await api.post('/api/formas-cobro', payload)
      setMensajeFormaCobro('ok:Forma de cobro creada correctamente')
      setNuevaFormaCobro({ nombre: '', orden: '' })
      await cargarFormasCobro()
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al crear forma de cobro'
      setMensajeFormaCobro(msg)
    } finally {
      setCreandoFormaCobro(false)
    }
  }

  const iniciarEdicionFormaCobro = (forma) => {
    setEditandoFormaCobroId(forma.id)
    setEditandoFormaCobroData({ nombre: forma.nombre, orden: forma.orden != null ? String(forma.orden) : '' })
  }

  const cancelarEdicionFormaCobro = () => {
    setEditandoFormaCobroId(null)
    setEditandoFormaCobroData({ nombre: '', orden: '' })
  }

  const guardarEdicionFormaCobro = async (id) => {
    if (!editandoFormaCobroData.nombre.trim()) return
    try {
      const payload = { nombre: editandoFormaCobroData.nombre.trim() }
      if (editandoFormaCobroData.orden !== '') payload.orden = Number(editandoFormaCobroData.orden)
      await api.put(`/api/formas-cobro/${id}`, payload)
      setEditandoFormaCobroId(null)
      setEditandoFormaCobroData({ nombre: '', orden: '' })
      await cargarFormasCobro()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al editar forma de cobro')
    }
  }

  const toggleActivoFormaCobro = async (forma) => {
    try {
      await api.put(`/api/formas-cobro/${forma.id}`, { activo: !forma.activo })
      await cargarFormasCobro()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cambiar estado de la forma de cobro')
    }
  }

  const eliminarFormaCobro = async (forma) => {
    if (!confirm(`¿Eliminar la forma de cobro "${forma.nombre}"?`)) return
    try {
      await api.delete(`/api/formas-cobro/${forma.id}`)
      await cargarFormasCobro()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar forma de cobro')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      <Navbar titulo={TITULOS_SECCION[seccion] || 'Configuración'} sinTabs />

      {/* Botón volver */}
      <div className="px-4 pt-3">
        <button
          onClick={() => navigate('/admin/configuracion')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Volver a configuración
        </button>
      </div>

      <div className="px-4 py-4 space-y-3">

        {/* ===== USUARIOS ===== */}
        {seccion === 'usuarios' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
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
              <option value="gestor">Gestor</option>
              <option value="admin">Administrador</option>
            </select>
            {(nuevoUsuario.rol === 'operario' || nuevoUsuario.rol === 'gestor') && (
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
        </div>}

        {/* ===== CAJAS ===== */}
        {seccion === 'cajas' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <form onSubmit={crearCaja} className="space-y-3 pt-4">
            <input
              type="text"
              value={nuevaCaja.nombre}
              onChange={(e) => setNuevaCaja(prev => ({ ...prev, nombre: e.target.value }))}
              placeholder="Nombre de la caja (ej: Caja 1)"
              className="campo-form text-sm"
            />
            <select
              value={nuevaCaja.sucursal_id}
              onChange={(e) => setNuevaCaja(prev => ({ ...prev, sucursal_id: e.target.value }))}
              className="campo-form text-sm"
            >
              <option value="">Seleccioná una sucursal</option>
              {sucursales.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
            <button type="submit" disabled={creandoCaja} className="btn-primario">
              {creandoCaja ? 'Creando...' : 'Crear caja'}
            </button>
            <MensajeForm mensaje={mensajeCaja} />
          </form>

          {cargandoCajas ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="mt-4">
              {cajas.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No hay cajas creadas</p>
              ) : (
                <div className="space-y-0 divide-y divide-gray-100">
                  {cajas.map(caja => (
                    <div key={caja.id} className="flex items-center justify-between gap-2 py-2.5">
                      {editandoCajaId === caja.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={editandoCajaData.nombre}
                            onChange={(e) => setEditandoCajaData(prev => ({ ...prev, nombre: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarEdicionCaja(caja.id)
                              if (e.key === 'Escape') cancelarEdicionCaja()
                            }}
                            autoFocus
                            placeholder="Nombre"
                            className="campo-form text-sm flex-1"
                          />
                          <input
                            type="number"
                            value={editandoCajaData.punto_venta_centum}
                            onChange={(e) => setEditandoCajaData(prev => ({ ...prev, punto_venta_centum: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarEdicionCaja(caja.id)
                              if (e.key === 'Escape') cancelarEdicionCaja()
                            }}
                            placeholder="PV Centum"
                            className="campo-form text-sm w-24"
                          />
                          <button
                            onClick={() => guardarEdicionCaja(caja.id)}
                            className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            OK
                          </button>
                          <button
                            onClick={cancelarEdicionCaja}
                            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <>
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => iniciarEdicionCaja(caja)}
                          >
                            <p className="text-sm font-medium text-gray-800 truncate">{caja.nombre}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {caja.sucursales?.nombre || 'Sin sucursal'}
                              {caja.punto_venta_centum ? ` · PV Centum: ${caja.punto_venta_centum}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <BotonActivo activo={caja.activo} onClick={() => toggleActivoCaja(caja)} />
                            <button
                              onClick={() => iniciarEdicionCaja(caja)}
                              className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => eliminarCaja(caja)}
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
        </div>}

        {/* ===== DENOMINACIONES ===== */}
        {seccion === 'denominaciones' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <form onSubmit={crearDenominacion} className="space-y-3 pt-4">
            <input
              type="number"
              value={nuevaDenominacion.valor}
              onChange={(e) => setNuevaDenominacion(prev => ({ ...prev, valor: e.target.value }))}
              placeholder="Valor (ej: 1000)"
              className="campo-form text-sm"
              min="0"
              step="any"
            />
            <select
              value={nuevaDenominacion.tipo}
              onChange={(e) => setNuevaDenominacion(prev => ({ ...prev, tipo: e.target.value }))}
              className="campo-form text-sm"
            >
              <option value="billete">Billete</option>
              <option value="moneda">Moneda</option>
            </select>
            <input
              type="number"
              value={nuevaDenominacion.orden}
              onChange={(e) => setNuevaDenominacion(prev => ({ ...prev, orden: e.target.value }))}
              placeholder="Orden (opcional)"
              className="campo-form text-sm"
              min="0"
            />
            <button type="submit" disabled={creandoDenominacion} className="btn-primario">
              {creandoDenominacion ? 'Creando...' : 'Crear denominación'}
            </button>
            <MensajeForm mensaje={mensajeDenominacion} />
          </form>

          {cargandoDenominaciones ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="mt-4">
              {denominaciones.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No hay denominaciones creadas</p>
              ) : (
                <div className="space-y-0 divide-y divide-gray-100">
                  {denominaciones.map(den => (
                    <div key={den.id} className="flex items-center justify-between gap-2 py-2.5">
                      {editandoDenominacionId === den.id ? (
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          <input
                            type="number"
                            value={editandoDenominacionData.valor}
                            onChange={(e) => setEditandoDenominacionData(prev => ({ ...prev, valor: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarEdicionDenominacion(den.id)
                              if (e.key === 'Escape') cancelarEdicionDenominacion()
                            }}
                            autoFocus
                            className="campo-form text-sm w-24"
                            min="0"
                            step="any"
                          />
                          <select
                            value={editandoDenominacionData.tipo}
                            onChange={(e) => setEditandoDenominacionData(prev => ({ ...prev, tipo: e.target.value }))}
                            className="campo-form text-sm w-28"
                          >
                            <option value="billete">Billete</option>
                            <option value="moneda">Moneda</option>
                          </select>
                          <input
                            type="number"
                            value={editandoDenominacionData.orden}
                            onChange={(e) => setEditandoDenominacionData(prev => ({ ...prev, orden: e.target.value }))}
                            placeholder="Orden"
                            className="campo-form text-sm w-20"
                            min="0"
                          />
                          <button
                            onClick={() => guardarEdicionDenominacion(den.id)}
                            className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            OK
                          </button>
                          <button
                            onClick={cancelarEdicionDenominacion}
                            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <>
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => iniciarEdicionDenominacion(den)}
                          >
                            <p className="text-sm font-medium text-gray-800 truncate">
                              ${den.valor} ({den.tipo})
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              Orden: {den.orden != null ? den.orden : '-'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <BotonActivo activo={den.activo} onClick={() => toggleActivoDenominacion(den)} />
                            <button
                              onClick={() => iniciarEdicionDenominacion(den)}
                              className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => eliminarDenominacion(den)}
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
        </div>}

        {/* ===== FORMAS DE COBRO ===== */}
        {seccion === 'formas-cobro' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <form onSubmit={crearFormaCobro} className="space-y-3 pt-4">
            <input
              type="text"
              value={nuevaFormaCobro.nombre}
              onChange={(e) => setNuevaFormaCobro(prev => ({ ...prev, nombre: e.target.value }))}
              placeholder="Nombre (ej: Efectivo, Tarjeta, etc.)"
              className="campo-form text-sm"
            />
            <input
              type="number"
              value={nuevaFormaCobro.orden}
              onChange={(e) => setNuevaFormaCobro(prev => ({ ...prev, orden: e.target.value }))}
              placeholder="Orden (opcional)"
              className="campo-form text-sm"
              min="0"
            />
            <button type="submit" disabled={creandoFormaCobro} className="btn-primario">
              {creandoFormaCobro ? 'Creando...' : 'Crear forma de cobro'}
            </button>
            <MensajeForm mensaje={mensajeFormaCobro} />
          </form>

          {cargandoFormasCobro ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="mt-4">
              {formasCobro.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No hay formas de cobro creadas</p>
              ) : (
                <div className="space-y-0 divide-y divide-gray-100">
                  {formasCobro.map(forma => (
                    <div key={forma.id} className="flex items-center justify-between gap-2 py-2.5">
                      {editandoFormaCobroId === forma.id ? (
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          <input
                            type="text"
                            value={editandoFormaCobroData.nombre}
                            onChange={(e) => setEditandoFormaCobroData(prev => ({ ...prev, nombre: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') guardarEdicionFormaCobro(forma.id)
                              if (e.key === 'Escape') cancelarEdicionFormaCobro()
                            }}
                            autoFocus
                            className="campo-form text-sm flex-1 min-w-[120px]"
                          />
                          <input
                            type="number"
                            value={editandoFormaCobroData.orden}
                            onChange={(e) => setEditandoFormaCobroData(prev => ({ ...prev, orden: e.target.value }))}
                            placeholder="Orden"
                            className="campo-form text-sm w-20"
                            min="0"
                          />
                          <button
                            onClick={() => guardarEdicionFormaCobro(forma.id)}
                            className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            OK
                          </button>
                          <button
                            onClick={cancelarEdicionFormaCobro}
                            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            X
                          </button>
                        </div>
                      ) : (
                        <>
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => iniciarEdicionFormaCobro(forma)}
                          >
                            <p className="text-sm font-medium text-gray-800 truncate">{forma.nombre}</p>
                            <p className="text-xs text-gray-400 truncate">
                              Orden: {forma.orden != null ? forma.orden : '-'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <BotonActivo activo={forma.activo} onClick={() => toggleActivoFormaCobro(forma)} />
                            <button
                              onClick={() => iniciarEdicionFormaCobro(forma)}
                              className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => eliminarFormaCobro(forma)}
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
        </div>}

        {/* ===== RUBROS ===== */}
        {seccion === 'rubros' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
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
        </div>}

        {/* ===== SUCURSALES ===== */}
        {seccion === 'sucursales' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
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
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editandoSucursalNombre}
                              onChange={(e) => setEditandoSucursalNombre(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') guardarEdicionSucursal(sucursal.id)
                                if (e.key === 'Escape') cancelarEdicionSucursal()
                              }}
                              autoFocus
                              placeholder="Nombre"
                              className="campo-form text-sm flex-1"
                            />
                            <input
                              type="number"
                              value={editandoSucursalCentumId}
                              onChange={(e) => setEditandoSucursalCentumId(e.target.value)}
                              placeholder="ID Sucursal Centum"
                              className="campo-form text-sm w-40"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editandoOperadorEmpresa}
                              onChange={(e) => setEditandoOperadorEmpresa(e.target.value)}
                              placeholder="Operador Empresa"
                              className="campo-form text-sm flex-1"
                            />
                            <input
                              type="text"
                              value={editandoOperadorPrueba}
                              onChange={(e) => setEditandoOperadorPrueba(e.target.value)}
                              placeholder="Operador Prueba"
                              className="campo-form text-sm flex-1"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => guardarEdicionSucursal(sucursal.id)}
                              className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg transition-colors"
                            >
                              Guardar
                            </button>
                            <button
                              onClick={cancelarEdicionSucursal}
                              className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => iniciarEdicionSucursal(sucursal)}
                          >
                            <p className="text-sm font-medium text-gray-800 hover:text-blue-600 transition-colors">
                              {sucursal.nombre}
                            </p>
                            {sucursal.centum_sucursal_id && (
                              <p className="text-xs text-gray-400">
                                Centum ID: {sucursal.centum_sucursal_id}
                                {sucursal.centum_operador_empresa && <span className="ml-2">| Emp: {sucursal.centum_operador_empresa}</span>}
                                {sucursal.centum_operador_prueba && <span className="ml-2">| Prueba: {sucursal.centum_operador_prueba}</span>}
                              </p>
                            )}
                          </div>
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
        </div>}

        {/* ===== ARTÍCULOS Y ATRIBUTOS ===== */}
        {seccion === 'articulos-atributos' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <AdminArticulosAtributos />
        </div>}

        {/* ===== PROMOCIONES POS ===== */}
        {seccion === 'promociones' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={async () => {
                setSincronizandoPOS(true)
                setMensajeSyncPOS(null)
                try {
                  const { data } = await api.post('/api/pos/sincronizar-articulos')
                  setMensajeSyncPOS(`ok:${data.mensaje || data.cantidad + ' artículos sincronizados'}`)
                } catch (err) {
                  setMensajeSyncPOS(err.response?.data?.error || err.message)
                } finally {
                  setSincronizandoPOS(false)
                }
              }}
              disabled={sincronizandoPOS}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {sincronizandoPOS ? 'Sincronizando...' : 'Sincronizar artículos POS'}
            </button>
            {mensajeSyncPOS && (
              <span className={`text-sm ${mensajeSyncPOS.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensajeSyncPOS.startsWith('ok:') ? mensajeSyncPOS.slice(3) : mensajeSyncPOS}
              </span>
            )}
          </div>
          <AdminPromociones />
        </div>}

        {/* ===== CLIENTES ===== */}
        {seccion === 'clientes' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <SeccionClientes />
        </div>}

        {/* ===== BLOQUEOS DE PEDIDOS ===== */}
        {seccion === 'delivery' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <SeccionDelivery />
        </div>}

        {seccion === 'bloqueos-pedidos' && <SeccionBloqueosPedidos />}

        {/* ===== GRUPOS DE DESCUENTO ===== */}
        {seccion === 'grupos-descuento' && <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
          <SeccionGruposDescuento />
        </div>}

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
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Usuario</label>
                <input
                  type="text"
                  value={editUsuarioData.username}
                  onChange={(e) => setEditUsuarioData(prev => ({ ...prev, username: e.target.value }))}
                  className="campo-form text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Nueva contraseña</label>
                <input
                  type="password"
                  value={editUsuarioData.password}
                  onChange={(e) => setEditUsuarioData(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Dejar vacío para no cambiar"
                  className="campo-form text-sm"
                />
              </div>

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
                  <option value="gestor">Gestor</option>
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

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const TURNOS_OPT = [
  { value: 'todo', label: 'Todo el día' },
  { value: 'AM', label: 'AM (9-13hs)' },
  { value: 'PM', label: 'PM (17-21hs)' },
]
const APLICA_OPT = [
  { value: 'todos', label: 'Delivery y Retiro' },
  { value: 'delivery', label: 'Solo Delivery' },
  { value: 'retiro', label: 'Solo Retiro' },
]

function SeccionBloqueosPedidos() {
  const [bloqueos, setBloqueos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [tipo, setTipo] = useState('semanal')
  const [diaSemana, setDiaSemana] = useState(1)
  const [fecha, setFecha] = useState('')
  const [turno, setTurno] = useState('todo')
  const [aplicaA, setAplicaA] = useState('todos')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    setCargando(true)
    try {
      const { data } = await api.get('/api/pos/bloqueos')
      setBloqueos(data || [])
    } catch (err) {
      console.error('Error cargando bloqueos:', err)
    } finally {
      setCargando(false)
    }
  }

  async function crear(e) {
    e.preventDefault()
    setGuardando(true)
    try {
      const body = { tipo, turno, aplica_a: aplicaA, motivo: motivo.trim() || null }
      if (tipo === 'semanal') body.dia_semana = parseInt(diaSemana)
      if (tipo === 'fecha') {
        if (!fecha) { alert('Seleccioná una fecha'); setGuardando(false); return }
        body.fecha = fecha
      }
      await api.post('/api/pos/bloqueos', body)
      setMotivo('')
      setFecha('')
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este bloqueo?')) return
    try {
      await api.delete(`/api/pos/bloqueos/${id}`)
      cargar()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const semanales = bloqueos.filter(b => b.tipo === 'semanal')
  const porFecha = bloqueos.filter(b => b.tipo === 'fecha')

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden p-4">
      {/* Formulario */}
      <form onSubmit={crear} className="space-y-3">
        <div className="flex items-center gap-2">
          <select value={tipo} onChange={e => setTipo(e.target.value)} className="campo-form text-sm flex-1">
            <option value="semanal">Día de la semana (recurrente)</option>
            <option value="fecha">Fecha específica</option>
          </select>
          {tipo === 'semanal' ? (
            <select value={diaSemana} onChange={e => setDiaSemana(e.target.value)} className="campo-form text-sm flex-1">
              {DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          ) : (
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="campo-form text-sm flex-1" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <select value={turno} onChange={e => setTurno(e.target.value)} className="campo-form text-sm flex-1">
            {TURNOS_OPT.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={aplicaA} onChange={e => setAplicaA(e.target.value)} className="campo-form text-sm flex-1">
            {APLICA_OPT.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <input
          type="text"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Motivo (opcional, ej: Feriado, Sucursal cerrada)"
          className="campo-form text-sm w-full"
        />
        <button type="submit" disabled={guardando} className="btn-primario">
          {guardando ? 'Guardando...' : 'Agregar bloqueo'}
        </button>
      </form>

      {/* Lista */}
      {cargando ? (
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600" />
        </div>
      ) : bloqueos.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">No hay bloqueos configurados</p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Semanales */}
          {semanales.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recurrentes (semanal)</h4>
              <div className="space-y-1">
                {semanales.map(b => (
                  <div key={b.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-gray-700">{DIAS_SEMANA[b.dia_semana]}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        b.turno === 'todo' ? 'bg-red-100 text-red-700' : b.turno === 'AM' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {b.turno === 'todo' ? 'Todo el día' : b.turno}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        b.aplica_a === 'todos' ? 'bg-gray-100 text-gray-600' : b.aplica_a === 'delivery' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {b.aplica_a === 'todos' ? 'Delivery + Retiro' : b.aplica_a === 'delivery' ? 'Delivery' : 'Retiro'}
                      </span>
                      {b.motivo && <span className="text-gray-400 text-xs">— {b.motivo}</span>}
                    </div>
                    <button onClick={() => eliminar(b.id)} className="text-red-400 hover:text-red-600 text-xs font-medium">Eliminar</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Por fecha */}
          {porFecha.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Fechas específicas</h4>
              <div className="space-y-1">
                {porFecha.map(b => (
                  <div key={b.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-gray-700">
                        {new Date(b.fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        b.turno === 'todo' ? 'bg-red-100 text-red-700' : b.turno === 'AM' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-100 text-indigo-700'
                      }`}>
                        {b.turno === 'todo' ? 'Todo el día' : b.turno}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        b.aplica_a === 'todos' ? 'bg-gray-100 text-gray-600' : b.aplica_a === 'delivery' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {b.aplica_a === 'todos' ? 'Delivery + Retiro' : b.aplica_a === 'delivery' ? 'Delivery' : 'Retiro'}
                      </span>
                      {b.motivo && <span className="text-gray-400 text-xs">— {b.motivo}</span>}
                    </div>
                    <button onClick={() => eliminar(b.id)} className="text-red-400 hover:text-red-600 text-xs font-medium">Eliminar</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AdminConfiguracion
