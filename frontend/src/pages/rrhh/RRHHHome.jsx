import React, { useState, useEffect, useRef } from 'react'
import api from '../../services/api'
import Navbar from '../../components/layout/Navbar'
import { imprimirCierreCuentaEmpleado } from '../../utils/imprimirComprobante'
import TabDashboard from '../control-horario/TabDashboard'
import TabCalendario from '../control-horario/TabCalendario'
import TabTurnos from '../control-horario/TabTurnos'
import TabLicencias from '../control-horario/TabLicencias'
import TabFeriados from '../control-horario/TabFeriados'
import TabAutorizaciones from '../control-horario/TabAutorizaciones'
import TabReportes from '../control-horario/TabReportes'
import TabPlanificacion from '../control-horario/TabPlanificacion'

const formatPrecio = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0)

const formatFechaHora = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const TABS = [
  { id: 'empleados', label: 'Empleados' },
  { id: 'cuenta', label: 'Cuenta Corriente' },
  { id: 'descuentos', label: 'Descuentos' },
  { id: 'topes', label: 'Topes' },
  { id: 'asistencia', label: 'Asistencia' },
  { id: 'turnos', label: 'Turnos' },
  { id: 'planificacion', label: 'Planificación' },
  { id: 'licencias', label: 'Licencias' },
  { id: 'feriados', label: 'Feriados' },
  { id: 'autorizaciones', label: 'Autorizaciones' },
  { id: 'reportes-horario', label: 'Reportes Horario' },
]

// ===== TAB: EMPLEADOS (ABM) =====
const TabEmpleados = () => {
  const [empleados, setEmpleados] = useState([])
  const [cargando, setCargando] = useState(true)
  const [nuevoEmpleado, setNuevoEmpleado] = useState({ nombre: '', codigo: '', empresa: 'zaatar', fecha_cumpleanos: '' })
  const [creando, setCreando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [editandoId, setEditandoId] = useState(null)
  const [editandoData, setEditandoData] = useState({ nombre: '', codigo: '', empresa: '', fecha_cumpleanos: '' })
  const [mostrarForm, setMostrarForm] = useState(false)

  useEffect(() => { cargarEmpleados() }, [])

  const cargarEmpleados = async () => {
    try {
      const { data } = await api.get('/api/empleados?todas=true')
      setEmpleados(data)
    } catch (err) {
      console.error('Error al cargar empleados:', err)
    } finally {
      setCargando(false)
    }
  }

  const crearEmpleado = async (e) => {
    e.preventDefault()
    if (!nuevoEmpleado.nombre.trim()) { setMensaje('Ingresá el nombre'); return }
    if (!nuevoEmpleado.codigo.trim()) { setMensaje('Ingresá el código'); return }
    setCreando(true)
    setMensaje('')
    try {
      await api.post('/api/empleados', { nombre: nuevoEmpleado.nombre.trim(), codigo: nuevoEmpleado.codigo.trim(), empresa: nuevoEmpleado.empresa, fecha_cumpleanos: nuevoEmpleado.fecha_cumpleanos || null })
      setMensaje('ok:Empleado creado')
      setNuevoEmpleado({ nombre: '', codigo: '', empresa: 'zaatar', fecha_cumpleanos: '' })
      setMostrarForm(false)
      await cargarEmpleados()
      setTimeout(() => setMensaje(''), 3000)
    } catch (err) {
      setMensaje(err.response?.data?.error || 'Error al crear empleado')
    } finally {
      setCreando(false)
    }
  }

  const iniciarEdicion = (emp) => {
    setEditandoId(emp.id)
    setEditandoData({ nombre: emp.nombre, codigo: emp.codigo || '', empresa: emp.empresa || 'zaatar', fecha_cumpleanos: emp.fecha_cumpleanos || '' })
  }

  const guardarEdicion = async (id) => {
    if (!editandoData.nombre.trim()) return
    try {
      await api.put(`/api/empleados/${id}`, { nombre: editandoData.nombre.trim(), codigo: editandoData.codigo.trim(), empresa: editandoData.empresa, fecha_cumpleanos: editandoData.fecha_cumpleanos || null })
      setEditandoId(null)
      await cargarEmpleados()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al editar empleado')
    }
  }

  const toggleActivo = async (emp) => {
    try {
      await api.put(`/api/empleados/${emp.id}`, { activo: !emp.activo })
      await cargarEmpleados()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al cambiar estado')
    }
  }

  const eliminarEmpleado = async (emp) => {
    if (!confirm(`¿Eliminar al empleado "${emp.nombre}"?`)) return
    try {
      await api.delete(`/api/empleados/${emp.id}`)
      await cargarEmpleados()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar')
    }
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600" />
      </div>
    )
  }

  return (
    <div>
      {/* Header + botón crear */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{empleados.length} empleado{empleados.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setMostrarForm(!mostrarForm)}
          className="bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {mostrarForm ? 'Cancelar' : '+ Nuevo empleado'}
        </button>
      </div>

      {/* Form crear */}
      {mostrarForm && (
        <form onSubmit={crearEmpleado} className="bg-cyan-50 border border-cyan-100 rounded-xl p-4 mb-4 space-y-2">
          <input
            type="text"
            value={nuevoEmpleado.nombre}
            onChange={e => setNuevoEmpleado(prev => ({ ...prev, nombre: e.target.value }))}
            placeholder="Nombre del empleado"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-cyan-400 outline-none"
            autoFocus
          />
          <input
            type="text"
            value={nuevoEmpleado.codigo}
            onChange={e => setNuevoEmpleado(prev => ({ ...prev, codigo: e.target.value }))}
            placeholder="Código único"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-cyan-400 outline-none"
          />
          <select
            value={nuevoEmpleado.empresa}
            onChange={e => setNuevoEmpleado(prev => ({ ...prev, empresa: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-cyan-400 outline-none"
          >
            <option value="zaatar">Zaatar</option>
            <option value="padano">Padano</option>
            <option value="produccion">Producción</option>
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Fecha de nacimiento</label>
            <input
              type="date"
              value={nuevoEmpleado.fecha_cumpleanos}
              onChange={e => setNuevoEmpleado(prev => ({ ...prev, fecha_cumpleanos: e.target.value }))}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-cyan-400 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={creando} className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {creando ? 'Creando...' : 'Crear'}
            </button>
            {mensaje && (
              <span className={`text-xs ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
                {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
              </span>
            )}
          </div>
        </form>
      )}

      {/* Mensaje fuera del form */}
      {!mostrarForm && mensaje && (
        <p className={`text-xs mb-2 ${mensaje.startsWith('ok:') ? 'text-green-600' : 'text-red-600'}`}>
          {mensaje.startsWith('ok:') ? mensaje.slice(3) : mensaje}
        </p>
      )}

      {/* Lista */}
      {empleados.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No hay empleados creados</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {empleados.map(emp => (
            <div key={emp.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              {editandoId === emp.id ? (
                <div className="flex items-center gap-2 flex-1 flex-wrap">
                  <input
                    type="text"
                    value={editandoData.nombre}
                    onChange={e => setEditandoData(prev => ({ ...prev, nombre: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') guardarEdicion(emp.id)
                      if (e.key === 'Escape') setEditandoId(null)
                    }}
                    autoFocus
                    placeholder="Nombre"
                    className="flex-1 min-w-[120px] border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-cyan-400 outline-none"
                  />
                  <input
                    type="text"
                    value={editandoData.codigo}
                    onChange={e => setEditandoData(prev => ({ ...prev, codigo: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') guardarEdicion(emp.id)
                      if (e.key === 'Escape') setEditandoId(null)
                    }}
                    placeholder="Código"
                    className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-cyan-400 outline-none"
                  />
                  <select
                    value={editandoData.empresa}
                    onChange={e => setEditandoData(prev => ({ ...prev, empresa: e.target.value }))}
                    className="w-28 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-cyan-400 outline-none"
                  >
                    <option value="zaatar">Zaatar</option>
                    <option value="padano">Padano</option>
                    <option value="produccion">Producción</option>
                  </select>
                  <input
                    type="date"
                    value={editandoData.fecha_cumpleanos}
                    onChange={e => setEditandoData(prev => ({ ...prev, fecha_cumpleanos: e.target.value }))}
                    title="Fecha de nacimiento"
                    className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-cyan-400 outline-none"
                  />
                  <button onClick={() => guardarEdicion(emp.id)} className="text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2.5 py-1.5 rounded-lg">OK</button>
                  <button onClick={() => setEditandoId(null)} className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2.5 py-1.5 rounded-lg">X</button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => iniciarEdicion(emp)}>
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {emp.nombre}
                      {emp.codigo && <span className="text-xs text-gray-400 ml-2">[{emp.codigo}]</span>}
                      {emp.empresa && (
                        <span className={`text-xs ml-2 px-1.5 py-0.5 rounded-full ${
                          emp.empresa === 'zaatar' ? 'bg-orange-100 text-orange-700' :
                          emp.empresa === 'padano' ? 'bg-blue-100 text-blue-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {emp.empresa === 'produccion' ? 'Producción' : emp.empresa.charAt(0).toUpperCase() + emp.empresa.slice(1)}
                        </span>
                      )}
                      {emp.fecha_cumpleanos && (
                        <span className="text-xs ml-2 text-gray-400">
                          {new Date(emp.fecha_cumpleanos + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleActivo(emp)}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${emp.activo ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                    >
                      {emp.activo ? 'Activo' : 'Inactivo'}
                    </button>
                    <button onClick={() => iniciarEdicion(emp)} className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg">Editar</button>
                    <button onClick={() => eliminarEmpleado(emp)} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg">Eliminar</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== TAB: CUENTA CORRIENTE =====
const TabCuentaCorriente = () => {
  const [empleados, setEmpleados] = useState([])
  const [cargando, setCargando] = useState(true)
  const [seleccionado, setSeleccionado] = useState(null)
  const [movimientos, setMovimientos] = useState({ ventas: [], pagos: [] })
  const [cargandoMov, setCargandoMov] = useState(false)
  const [montoPago, setMontoPago] = useState('')
  const [conceptoPago, setConceptoPago] = useState('')
  const [guardandoPago, setGuardandoPago] = useState(false)
  const [mensajePago, setMensajePago] = useState('')
  const [ventaExpandida, setVentaExpandida] = useState(null)
  const [ejecutandoCierre, setEjecutandoCierre] = useState(false)
  const [confirmandoCierre, setConfirmandoCierre] = useState(false)
  const [reimprimiendo, setReimprimiendo] = useState(false)
  const empleadoRefs = useRef({})

  useEffect(() => { cargarSaldos() }, [])

  const cargarSaldos = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/cuenta-empleados/saldos')
      setEmpleados(data || [])
      // Actualizar seleccionado con datos frescos
      setSeleccionado(prev => prev ? (data || []).find(e => e.id === prev.id) || prev : null)
    } catch (err) {
      console.error('Error cargando saldos:', err)
    } finally {
      setCargando(false)
    }
  }

  const verDetalle = async (emp) => {
    setSeleccionado(emp)
    setTimeout(() => {
      empleadoRefs.current[emp.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    setCargandoMov(true)
    setVentaExpandida(null)
    try {
      const { data } = await api.get(`/api/cuenta-empleados/${emp.id}/movimientos`)
      setMovimientos(data)
    } catch (err) {
      console.error('Error cargando movimientos:', err)
    } finally {
      setCargandoMov(false)
    }
  }

  const registrarPago = async () => {
    if (!montoPago || parseFloat(montoPago) === 0) {
      setMensajePago('El monto no puede ser 0')
      return
    }
    setGuardandoPago(true)
    setMensajePago('')
    try {
      await api.post(`/api/cuenta-empleados/${seleccionado.id}/pagos`, {
        monto: parseFloat(montoPago),
        concepto: conceptoPago.trim() || 'Descuento de sueldo',
      })
      setMontoPago('')
      setConceptoPago('')
      setMensajePago('Pago registrado')
      setTimeout(() => setMensajePago(''), 3000)
      cargarSaldos()
      verDetalle(seleccionado)
    } catch (err) {
      setMensajePago(err.response?.data?.error || 'Error al registrar pago')
    } finally {
      setGuardandoPago(false)
    }
  }

  const empleadosConDeuda = empleados.filter(e => e.saldo > 0)
  const totalDeuda = empleadosConDeuda.reduce((sum, e) => sum + e.saldo, 0)

  const ejecutarCierreMasivo = async () => {
    setEjecutandoCierre(true)
    try {
      const { data } = await api.post('/api/cuenta-empleados/cierre-masivo')
      const { cierres } = data

      if (cierres.length === 0) {
        alert('No hay empleados con saldo pendiente')
        setConfirmandoCierre(false)
        setEjecutandoCierre(false)
        return
      }

      // Imprimir comprobante de cada empleado con delay entre cada uno
      for (let i = 0; i < cierres.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1500))
        imprimirCierreCuentaEmpleado(cierres[i])
      }

      setConfirmandoCierre(false)
      setSeleccionado(null)
      cargarSaldos()
    } catch (err) {
      alert(err.response?.data?.error || 'Error al ejecutar cierre masivo')
    } finally {
      setEjecutandoCierre(false)
    }
  }

  const reimprimirUltimoCierre = async () => {
    setReimprimiendo(true)
    try {
      const { data } = await api.get('/api/cuenta-empleados/ultimo-cierre')
      const { cierres } = data

      if (!cierres || cierres.length === 0) {
        alert('No se encontró ningún cierre mensual previo')
        return
      }

      for (let i = 0; i < cierres.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 1500))
        imprimirCierreCuentaEmpleado(cierres[i])
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error al obtener último cierre')
    } finally {
      setReimprimiendo(false)
    }
  }

  const timeline = [
    ...(movimientos.ventas || []).map(v => ({ ...v, _tipo: 'venta', _fecha: v.created_at })),
    ...(movimientos.pagos || []).map(p => ({ ...p, _tipo: 'pago', _fecha: p.created_at })),
  ].sort((a, b) => new Date(b._fecha) - new Date(a._fecha))

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600" />
      </div>
    )
  }

  return (
    <div>
      {/* Barra superior con botón cierre masivo */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {empleadosConDeuda.length > 0
            ? `${empleadosConDeuda.length} empleado${empleadosConDeuda.length !== 1 ? 's' : ''} con deuda · Total: ${formatPrecio(totalDeuda)}`
            : 'Todos los saldos están en $0'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={reimprimirUltimoCierre}
            disabled={reimprimiendo}
            className="border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {reimprimiendo ? 'Reimprimiendo...' : 'Reimprimir último cierre'}
          </button>
          {empleadosConDeuda.length > 0 && !confirmandoCierre && (
            <button
              onClick={() => setConfirmandoCierre(true)}
              className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Cierre mensual (todos a $0)
            </button>
          )}
        </div>
        {confirmandoCierre && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            <span className="text-sm text-red-700">
              Se pagarán {empleadosConDeuda.length} empleados por {formatPrecio(totalDeuda)}. Se imprimirá un comprobante por cada uno.
            </span>
            <button
              onClick={ejecutarCierreMasivo}
              disabled={ejecutandoCierre}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
            >
              {ejecutandoCierre ? 'Procesando...' : 'Confirmar'}
            </button>
            <button
              onClick={() => setConfirmandoCierre(false)}
              disabled={ejecutandoCierre}
              className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1.5"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm text-gray-500 mb-3">{empleados.length} empleado{empleados.length !== 1 ? 's' : ''} con cuenta</p>
        {empleados.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">No hay empleados activos</p>
        ) : (
          <div className="space-y-2">
            {empleados.map(emp => (
              <div key={emp.id} ref={el => empleadoRefs.current[emp.id] = el}>
                <div
                  onClick={() => seleccionado?.id === emp.id ? setSeleccionado(null) : verDetalle(emp)}
                  className={`bg-white rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md ${
                    seleccionado?.id === emp.id ? 'border-cyan-400 ring-2 ring-cyan-100 rounded-b-none' : 'border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{emp.nombre}</p>
                      <p className="text-xs text-gray-400">
                        {emp.codigo}
                        {emp.sucursales && ` · ${emp.sucursales.nombre}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${emp.saldo > 0 ? 'text-red-600' : emp.saldo < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {emp.saldo > 0 ? `Debe ${formatPrecio(emp.saldo)}` : emp.saldo < 0 ? `A favor ${formatPrecio(Math.abs(emp.saldo))}` : '$0'}
                      </p>
                      {emp.tope_mensual != null && (
                        <p className="text-[10px] text-gray-400">
                          Mes: {formatPrecio(emp.consumido_mes)} / {formatPrecio(emp.tope_mensual)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Panel detalle inline */}
                {seleccionado?.id === emp.id && (
                  <div className="bg-white border border-t-0 border-cyan-400 ring-2 ring-cyan-100 rounded-b-xl overflow-hidden mb-2">
                    {/* Header con saldo */}
                    <div className="bg-cyan-50 border-b border-cyan-100 px-4 py-3 flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-500">Saldo pendiente</p>
                      <p className={`text-lg font-bold ${seleccionado.saldo > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {formatPrecio(seleccionado.saldo)}
                      </p>
                    </div>

                    {/* Registrar pago */}
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <p className="text-xs font-medium text-gray-500 mb-2">Registrar pago / descuento de sueldo</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="100"
                          value={montoPago}
                          onChange={e => setMontoPago(e.target.value)}
                          placeholder="Monto"
                          className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-cyan-400 outline-none"
                        />
                        <input
                          type="text"
                          value={conceptoPago}
                          onChange={e => setConceptoPago(e.target.value)}
                          placeholder="Concepto (ej: Desc. sueldo Marzo)"
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-cyan-400 outline-none"
                        />
                        <button
                          onClick={registrarPago}
                          disabled={guardandoPago}
                          className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                        >
                          {guardandoPago ? '...' : 'Registrar'}
                        </button>
                      </div>
                      {mensajePago && (
                        <p className={`text-xs mt-1 ${mensajePago.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
                          {mensajePago}
                        </p>
                      )}
                    </div>

                    {/* Timeline */}
                    <div className="px-4 py-3 overflow-y-auto max-h-[400px]">
                      {cargandoMov ? (
                        <div className="flex justify-center py-6">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-600" />
                        </div>
                      ) : timeline.length === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-6">Sin movimientos</p>
                      ) : (
                        <div className="space-y-2">
                          {(() => {
                            let saldoAcum = seleccionado?.saldo || 0
                            return timeline.map((mov, idx) => {
                              const saldoDespues = saldoAcum
                              const montoMov = mov._tipo === 'venta' ? mov.total : (mov.monto < 0 ? Math.abs(mov.monto) : -mov.monto)
                              saldoAcum = saldoAcum - montoMov
                              return (
                            <div key={idx}>
                              <div
                                className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                                  mov._tipo === 'venta' ? 'bg-red-50 cursor-pointer hover:bg-red-100' : mov.monto < 0 ? 'bg-red-50' : 'bg-green-50'
                                }`}
                                onClick={() => mov._tipo === 'venta' && setVentaExpandida(ventaExpandida === mov.id ? null : mov.id)}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-700">
                                    {mov._tipo === 'venta' ? 'Retiro de mercadería' : 'Pago'}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    {formatFechaHora(mov._fecha)}
                                    {mov._tipo === 'venta' && (mov.empleado_caja || mov.cajero) && ` · Cajero: ${mov.empleado_caja?.nombre || mov.cajero?.nombre || mov.cajero?.username}`}
                                    {mov._tipo === 'pago' && mov.concepto && ` · ${mov.concepto}`}
                                    {mov._tipo === 'pago' && mov.registrado && ` · Por: ${mov.registrado.nombre || mov.registrado.username}`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className={`text-sm font-bold ${mov._tipo === 'venta' ? 'text-red-600' : mov.monto < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                    {mov._tipo === 'venta' ? '+' : mov.monto < 0 ? '+' : '-'}{formatPrecio(Math.abs(mov._tipo === 'venta' ? mov.total : mov.monto))}
                                  </span>
                                  <span className="text-xs text-gray-400 font-medium w-24 text-right">
                                    Saldo: {formatPrecio(saldoDespues)}
                                  </span>
                                </div>
                              </div>

                              {mov._tipo === 'venta' && ventaExpandida === mov.id && mov.items && (
                                <div className="ml-3 mt-1 mb-2 bg-white border border-gray-100 rounded-lg p-2 space-y-1">
                                  {(typeof mov.items === 'string' ? JSON.parse(mov.items) : mov.items).map((item, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                      <span className="text-gray-600 truncate flex-1">
                                        {item.nombre}
                                        {item.descuento_pct > 0 && <span className="text-cyan-500 ml-1">(-{item.descuento_pct}%)</span>}
                                      </span>
                                      <span className="text-gray-500 ml-2">
                                        {item.cantidad} x {formatPrecio(item.precio_final || item.precio_original)} = {formatPrecio(item.subtotal)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                              )
                            })
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ===== TAB: DESCUENTOS POR RUBRO =====
const TabDescuentos = () => {
  const [rubros, setRubros] = useState([])
  const [descuentos, setDescuentos] = useState({})
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setCargando(true)
    try {
      const [rubrosRes, descRes] = await Promise.all([
        api.get('/api/cuenta-empleados/rubros').catch(() => ({ data: [] })),
        api.get('/api/cuenta-empleados/descuentos').catch(() => ({ data: [] })),
      ])
      setRubros(rubrosRes.data || [])
      const descMap = {}
      ;(descRes.data || []).forEach(d => { descMap[d.rubro] = d.porcentaje })
      setDescuentos(descMap)
    } catch (err) {
      console.error('Error cargando datos:', err)
    } finally {
      setCargando(false)
    }
  }

  const guardarDescuentos = async () => {
    setGuardando(true)
    setMensaje('')
    try {
      const payload = rubros
        .filter(r => descuentos[r.nombre] != null && descuentos[r.nombre] !== '')
        .map(r => ({
          rubro: r.nombre,
          rubro_id_centum: r.rubro_id_centum || null,
          porcentaje: parseFloat(descuentos[r.nombre]) || 0,
        }))
      await api.post('/api/cuenta-empleados/descuentos', { descuentos: payload })
      setMensaje('Descuentos guardados')
      setTimeout(() => setMensaje(''), 3000)
    } catch (err) {
      setMensaje(err.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600" />
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Configurá el porcentaje de descuento que se aplica a los empleados por cada rubro de artículos.
      </p>

      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {rubros.map(rubro => (
          <div key={rubro.id || rubro.nombre} className="flex items-center justify-between gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-700 flex-1 truncate">{rubro.nombre}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={descuentos[rubro.nombre] ?? ''}
                onChange={e => setDescuentos(prev => ({ ...prev, [rubro.nombre]: e.target.value }))}
                placeholder="0"
                className="w-20 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </div>
        ))}
      </div>

      {rubros.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-4">No hay rubros cargados</p>
      )}

      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={guardarDescuentos}
          disabled={guardando}
          className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {guardando ? 'Guardando...' : 'Guardar descuentos'}
        </button>
        {mensaje && (
          <span className={`text-sm ${mensaje.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {mensaje}
          </span>
        )}
      </div>
    </div>
  )
}

// ===== TAB: TOPES MENSUALES =====
const TabTopes = () => {
  const [empleados, setEmpleados] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => { cargarTopes() }, [])

  const cargarTopes = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/cuenta-empleados/topes')
      setEmpleados(data || [])
    } catch (err) {
      console.error('Error cargando topes:', err)
    } finally {
      setCargando(false)
    }
  }

  const guardarTope = async (empId, tope) => {
    try {
      await api.put(`/api/cuenta-empleados/topes/${empId}`, {
        tope_mensual: tope === '' ? null : parseFloat(tope),
      })
      setEmpleados(prev => prev.map(e =>
        e.id === empId ? { ...e, tope_mensual: tope === '' ? null : parseFloat(tope) } : e
      ))
    } catch (err) {
      console.error('Error guardando tope:', err)
    }
  }

  if (cargando) {
    return (
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600" />
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Configurá el importe máximo que cada empleado puede retirar por mes. Dejá vacío para sin tope.
      </p>

      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {empleados.map(emp => (
          <div key={emp.id} className="flex items-center justify-between gap-3 bg-white border border-gray-100 rounded-lg px-3 py-2">
            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-700 font-medium">{emp.nombre}</span>
              <span className="text-xs text-gray-400 ml-2">({emp.codigo})</span>
              {emp.sucursales && <span className="text-xs text-gray-400 ml-2">· {emp.sucursales.nombre}</span>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">$</span>
              <input
                type="number"
                min="0"
                step="100"
                value={emp.tope_mensual ?? ''}
                onChange={e => setEmpleados(prev =>
                  prev.map(em => em.id === emp.id ? { ...em, tope_mensual: e.target.value === '' ? null : e.target.value } : em)
                )}
                onBlur={e => guardarTope(emp.id, e.target.value)}
                placeholder="Sin tope"
                className="w-28 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 outline-none"
              />
            </div>
          </div>
        ))}
      </div>

      {empleados.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-4">No hay empleados activos</p>
      )}
    </div>
  )
}

// ===== PÁGINA PRINCIPAL RRHH =====
const RRHHHome = () => {
  const [tabActivo, setTabActivo] = useState('empleados')

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Gestión de RRHH" sinTabs volverA="/apps" />

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setTabActivo(tab.id)}
              className={`text-sm font-medium py-2 px-3 rounded-lg transition-colors whitespace-nowrap ${
                tabActivo === tab.id
                  ? 'bg-white text-cyan-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Contenido */}
        {tabActivo === 'empleados' && <TabEmpleados />}
        {tabActivo === 'cuenta' && <TabCuentaCorriente />}
        {tabActivo === 'descuentos' && <TabDescuentos />}
        {tabActivo === 'topes' && <TabTopes />}
        {tabActivo === 'asistencia' && <TabDashboard />}
        {tabActivo === 'turnos' && <TabTurnos />}
        {tabActivo === 'planificacion' && <TabPlanificacion />}
        {tabActivo === 'licencias' && <TabLicencias />}
        {tabActivo === 'feriados' && <TabFeriados />}
        {tabActivo === 'autorizaciones' && <TabAutorizaciones />}
        {tabActivo === 'reportes-horario' && <TabReportes />}
      </div>
    </div>
  )
}

export default RRHHHome
