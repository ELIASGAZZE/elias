import React, { useState, useEffect } from 'react'
import api from '../../services/api'
import Navbar from '../../components/layout/Navbar'

const formatPrecio = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0)

const formatFechaHora = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const SaldosEmpleados = () => {
  const [empleados, setEmpleados] = useState([])
  const [cargando, setCargando] = useState(true)
  const [seleccionado, setSeleccionado] = useState(null) // empleado seleccionado para ver detalle
  const [movimientos, setMovimientos] = useState({ ventas: [], pagos: [] })
  const [cargandoMov, setCargandoMov] = useState(false)

  // Form pago
  const [montoPago, setMontoPago] = useState('')
  const [conceptoPago, setConceptoPago] = useState('')
  const [guardandoPago, setGuardandoPago] = useState(false)
  const [mensajePago, setMensajePago] = useState('')

  // Detalle venta expandido
  const [ventaExpandida, setVentaExpandida] = useState(null)

  useEffect(() => { cargarSaldos() }, [])

  async function cargarSaldos() {
    setCargando(true)
    try {
      const { data } = await api.get('/api/cuenta-empleados/saldos')
      setEmpleados(data || [])
    } catch (err) {
      console.error('Error cargando saldos:', err)
    } finally {
      setCargando(false)
    }
  }

  async function verDetalle(emp) {
    setSeleccionado(emp)
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

  async function registrarPago() {
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
      // Refrescar
      cargarSaldos()
      verDetalle(seleccionado)
    } catch (err) {
      setMensajePago(err.response?.data?.error || 'Error al registrar pago')
    } finally {
      setGuardandoPago(false)
    }
  }

  // Combinar ventas + pagos en timeline ordenado
  const timeline = [
    ...(movimientos.ventas || []).map(v => ({ ...v, _tipo: 'venta', _fecha: v.created_at })),
    ...(movimientos.pagos || []).map(p => ({ ...p, _tipo: 'pago', _fecha: p.created_at })),
  ].sort((a, b) => new Date(b._fecha) - new Date(a._fecha))

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar titulo="Saldos Empleados" />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Lista de empleados */}
          <div className={`${seleccionado ? 'w-1/3' : 'w-full'} transition-all`}>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Empleados</h2>

            {cargando ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
              </div>
            ) : empleados.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-10">No hay empleados activos</p>
            ) : (
              <div className="space-y-2">
                {empleados.map(emp => (
                  <div
                    key={emp.id}
                    onClick={() => verDetalle(emp)}
                    className={`bg-white rounded-xl border p-3 cursor-pointer transition-all hover:shadow-md ${
                      seleccionado?.id === emp.id ? 'border-orange-400 ring-2 ring-orange-100' : 'border-gray-100'
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
                ))}
              </div>
            )}
          </div>

          {/* Panel detalle */}
          {seleccionado && (
            <div className="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="bg-orange-50 border-b border-orange-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">{seleccionado.nombre}</h3>
                  <p className="text-xs text-gray-500">{seleccionado.codigo} · {seleccionado.sucursales?.nombre || ''}</p>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-bold ${seleccionado.saldo > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {formatPrecio(seleccionado.saldo)}
                  </p>
                  <p className="text-[10px] text-gray-400">saldo pendiente</p>
                </div>
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
                    className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-orange-400 outline-none"
                  />
                  <input
                    type="text"
                    value={conceptoPago}
                    onChange={e => setConceptoPago(e.target.value)}
                    placeholder="Concepto (ej: Desc. sueldo Marzo)"
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:border-orange-400 outline-none"
                  />
                  <button
                    onClick={registrarPago}
                    disabled={guardandoPago}
                    className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
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

              {/* Timeline de movimientos */}
              <div className="px-4 py-3 overflow-y-auto max-h-[500px]">
                {cargandoMov ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600" />
                  </div>
                ) : timeline.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">Sin movimientos</p>
                ) : (
                  <div className="space-y-2">
                    {timeline.map((mov, idx) => (
                      <div key={idx}>
                        <div
                          className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                            mov._tipo === 'venta' ? 'bg-red-50 cursor-pointer hover:bg-red-100' : 'bg-green-50'
                          }`}
                          onClick={() => mov._tipo === 'venta' && setVentaExpandida(ventaExpandida === mov.id ? null : mov.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-700">
                              {mov._tipo === 'venta' ? 'Retiro de mercadería' : 'Pago'}
                            </p>
                            <p className="text-xs text-gray-400">
                              {formatFechaHora(mov._fecha)}
                              {mov._tipo === 'venta' && mov.cajero && ` · Cajero: ${mov.cajero.nombre || mov.cajero.username}`}
                              {mov._tipo === 'pago' && mov.concepto && ` · ${mov.concepto}`}
                              {mov._tipo === 'pago' && mov.registrado && ` · Por: ${mov.registrado.nombre || mov.registrado.username}`}
                            </p>
                          </div>
                          <span className={`text-sm font-bold ${mov._tipo === 'venta' ? 'text-red-600' : 'text-green-600'}`}>
                            {mov._tipo === 'venta' ? '+' : '-'}{formatPrecio(mov._tipo === 'venta' ? mov.total : mov.monto)}
                          </span>
                        </div>

                        {/* Detalle items expandido */}
                        {mov._tipo === 'venta' && ventaExpandida === mov.id && mov.items && (
                          <div className="ml-3 mt-1 mb-2 bg-white border border-gray-100 rounded-lg p-2 space-y-1">
                            {(typeof mov.items === 'string' ? JSON.parse(mov.items) : mov.items).map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <span className="text-gray-600 truncate flex-1">
                                  {item.nombre}
                                  {item.descuento_pct > 0 && <span className="text-orange-500 ml-1">(-{item.descuento_pct}%)</span>}
                                </span>
                                <span className="text-gray-500 ml-2">
                                  {item.cantidad} x {formatPrecio(item.precio_final || item.precio_original)} = {formatPrecio(item.subtotal)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SaldosEmpleados
