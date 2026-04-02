import React from 'react'
import ModalCobrar from '../../../components/pos/ModalCobrar'
import NuevoClienteModal from '../../../components/NuevoClienteModal'
import api from '../../../services/api'
import { formatPrecio } from '../utils/promotionEngine'

const PedidoWizardModal = ({
  // POS state
  carrito,
  cliente,
  total,
  subtotal,
  descuentoTotal,
  promosAplicadas,
  isOnline,
  actualizarPendientes,
  terminalConfig,
  // Wizard state & handlers from usePedidoWizard
  mostrarCobrarPedido,
  cobrarPedidoExistente,
  handleCobroPedidoExitoso,
  setMostrarCobrarPedido,
  setCobrarPedidoExistente,
  pedidoWizardDataRef,
  mostrarBuscarClientePedido,
  cerrarWizardPedido,
  pasoPedido,
  setPasoPedido,
  fechaEntregaPedido,
  setFechaEntregaPedido,
  turnoPedido,
  setTurnoPedido,
  observacionEntregaPedido,
  setObservacionEntregaPedido,
  tarjetaRegaloPedido,
  setTarjetaRegaloPedido,
  observacionesPedidoTexto,
  setObservacionesPedidoTexto,
  bloqueosFecha,
  setBloqueosFecha,
  clientePedido,
  setClientePedido,
  busquedaClientePedido,
  setBusquedaClientePedido,
  clientesPedido,
  buscandoClientePedido,
  inputClientePedidoRef,
  seleccionarClienteParaPedido,
  mostrarCrearClientePedido,
  setMostrarCrearClientePedido,
  onClientePedidoCreado,
  tipoPedidoSeleccionado,
  setTipoPedidoSeleccionado,
  seleccionarTipoPedido,
  cargandoDetallePedido,
  direccionesPedido,
  direccionSeleccionadaPedido,
  setDireccionSeleccionadaPedido,
  editandoDirPedido,
  setEditandoDirPedido,
  guardandoEditDirPedido,
  guardarEditDirPedido,
  mostrarNuevaDirPedido,
  setMostrarNuevaDirPedido,
  nuevaDirPedido,
  setNuevaDirPedido,
  guardandoDirPedido,
  guardarNuevaDirPedido,
  sucursalesPedido,
  sucursalSeleccionadaPedido,
  setSucursalSeleccionadaPedido,
  confirmarPedidoWizard,
  guardandoPedido,
  finalizarPedidoWizard,
}) => {
  return (
    <>
      {/* Modal de cobro para pedido (pago anticipado o cobro en caja) */}
      {mostrarCobrarPedido && (
        <ModalCobrar
          total={cobrarPedidoExistente ? cobrarPedidoExistente.total : total}
          subtotal={cobrarPedidoExistente ? cobrarPedidoExistente.total : subtotal}
          descuentoTotal={cobrarPedidoExistente ? 0 : descuentoTotal}
          ivaTotal={0}
          carrito={cobrarPedidoExistente ? (typeof cobrarPedidoExistente.items === 'string' ? JSON.parse(cobrarPedidoExistente.items) : cobrarPedidoExistente.items || []) : carrito}
          cliente={cobrarPedidoExistente ? { id_centum: cobrarPedidoExistente.id_cliente_centum || 0, razon_social: cobrarPedidoExistente.nombre_cliente || 'Consumidor Final', condicion_iva: 'CF' } : cliente}
          promosAplicadas={cobrarPedidoExistente ? [] : promosAplicadas}
          onConfirmar={handleCobroPedidoExitoso}
          onCerrar={() => { setMostrarCobrarPedido(false); setCobrarPedidoExistente(null); pedidoWizardDataRef.current = null }}
          isOnline={isOnline}
          onVentaOffline={actualizarPendientes}
          soloPago
        />
      )}

      {/* Modal wizard pedido: paso 0 = fecha, paso 1 = cliente, paso 2 = tipo, paso 3 = dirección/sucursal, paso 4 = pago */}
      {mostrarBuscarClientePedido && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={cerrarWizardPedido}>
          <div
            className="bg-white rounded-xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">
                  {pasoPedido === 0 ? 'Fecha de entrega' : pasoPedido === 1 ? 'Seleccionar cliente' : pasoPedido === 2 ? 'Tipo de pedido' : pasoPedido === 3 ? (tipoPedidoSeleccionado === 'delivery' ? 'Direccion de entrega' : 'Sucursal de retiro') : 'Pago anticipado'}
                </h2>
                <button onClick={cerrarWizardPedido} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {pasoPedido === 1 && (
                <button onClick={() => { setPasoPedido(0); setFechaEntregaPedido('') }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar fecha
                </button>
              )}
              {pasoPedido === 2 && (
                <button onClick={() => { setPasoPedido(1); setClientePedido(null) }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar cliente
                </button>
              )}
              {pasoPedido === 3 && (
                <button onClick={() => { setPasoPedido(2); setTipoPedidoSeleccionado(null) }} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Cambiar tipo
                </button>
              )}
              {pasoPedido === 4 && (
                <button onClick={() => setPasoPedido(3)} className="text-xs text-amber-600 hover:text-amber-700 mt-1">
                  ← Volver
                </button>
              )}

              {/* Progress dots */}
              <div className="flex gap-1.5 mt-2">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className={`h-1 flex-1 rounded-full ${i <= pasoPedido ? 'bg-amber-500' : 'bg-gray-200'}`} />
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto flex-1 space-y-3">

              {/* PASO 0: Fecha de entrega */}
              {pasoPedido === 0 && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha de entrega / retiro
                    </label>
                    <input
                      type="date"
                      value={fechaEntregaPedido}
                      onChange={e => setFechaEntregaPedido(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  {(() => {
                    const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
                    const tienePerecedor = carrito.some(i => {
                      const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
                      return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
                    })
                    if (tienePerecedor) {
                      const manana = new Date()
                      manana.setDate(manana.getDate() + 1)
                      const mananaISO = manana.toISOString().split('T')[0]
                      const excede = fechaEntregaPedido && fechaEntregaPedido > mananaISO
                      return (
                        <div className={`text-xs px-3 py-2 rounded-lg ${excede ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                          {excede
                            ? 'El pedido contiene Fiambres, Quesos o Frescos. La fecha no puede ser mayor a mañana.'
                            : 'El pedido contiene productos perecederos (max. mañana).'}
                        </div>
                      )
                    }
                    return null
                  })()}
                  <button
                    onClick={() => {
                      if (!fechaEntregaPedido) return
                      // Validar perecederos
                      const RUBROS_PERECEDEROS = ['fiambres', 'quesos', 'frescos']
                      const manana = new Date()
                      manana.setDate(manana.getDate() + 1)
                      const mananaISO = manana.toISOString().split('T')[0]
                      const tienePerecedor = carrito.some(i => {
                        const rubro = (i.articulo.rubro?.nombre || '').toLowerCase()
                        return RUBROS_PERECEDEROS.some(r => rubro.includes(r))
                      })
                      if (tienePerecedor && fechaEntregaPedido > mananaISO) return
                      // Cargar bloqueos para la fecha seleccionada
                      api.get('/api/pos/bloqueos', { params: { fecha: fechaEntregaPedido } })
                        .then(({ data }) => {
                          const diaSemana = new Date(fechaEntregaPedido + 'T12:00:00').getDay()
                          const activos = (data || []).filter(b => {
                            if (!b.activo) return false
                            if (b.tipo === 'fecha' && b.fecha === fechaEntregaPedido) return true
                            if (b.tipo === 'semanal' && b.dia_semana === diaSemana) return true
                            return false
                          })
                          setBloqueosFecha(activos)
                        })
                        .catch(() => setBloqueosFecha([]))
                      // Si ya tiene cliente real, saltar al paso 2 (tipo)
                      if (cliente.id_centum && cliente.id_centum !== 0) {
                        setClientePedido(cliente)
                        setPasoPedido(2)
                      } else {
                        setPasoPedido(1)
                      }
                    }}
                    disabled={!fechaEntregaPedido}
                    className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors mt-2"
                  >
                    Continuar
                  </button>
                </>
              )}

              {/* PASO 1: Buscar cliente */}
              {pasoPedido === 1 && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm">
                    <span className="text-gray-500">Fecha:</span>{' '}
                    <span className="font-medium text-gray-800">{new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  </div>
                  <input
                    ref={inputClientePedidoRef}
                    type="text"
                    value={busquedaClientePedido}
                    onChange={e => setBusquedaClientePedido(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    inputMode="numeric"
                    placeholder="DNI (7-8 dígitos) o CUIT (11 dígitos)"
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                  />
                  {buscandoClientePedido && (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                    </div>
                  )}
                  {!buscandoClientePedido && clientesPedido.length > 0 && (
                    <div className="space-y-1">
                      {clientesPedido.map(c => (
                        <button
                          key={c.id || c.id_centum}
                          onClick={() => seleccionarClienteParaPedido(c)}
                          disabled={!c.id_centum}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            c.id_centum
                              ? 'border-gray-100 hover:border-amber-300 hover:bg-amber-50/50'
                              : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-800 truncate">{c.razon_social}</span>
                            {!c.id_centum && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">Sin Centum</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {c.cuit && <span>{c.cuit}</span>}
                            {c.direccion && <span> · {c.direccion}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {!buscandoClientePedido && busquedaClientePedido.trim().length >= 2 && clientesPedido.length === 0 && (
                    <div className="text-center py-4 space-y-3">
                      <p className="text-sm text-gray-400">No se encontraron clientes</p>
                      <button
                        onClick={() => setMostrarCrearClientePedido(true)}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                        <span className="text-sm font-medium">Crear nuevo cliente</span>
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* PASO 2: Tipo de pedido */}
              {pasoPedido === 2 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Fecha:</span>{' '}
                      <span className="font-medium text-gray-800">{new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                  </div>
                  {/* Email y celular del cliente */}
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                      <input
                        type="email"
                        value={clientePedido.email || ''}
                        onChange={e => setClientePedido(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="Email del cliente"
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
                      <input
                        type="tel"
                        value={clientePedido.celular || ''}
                        onChange={e => setClientePedido(prev => ({ ...prev, celular: e.target.value }))}
                        placeholder="Celular del cliente"
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
                      />
                    </div>
                  </div>
                  {bloqueosFecha.length > 0 && (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 mt-2">
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        <div className="text-sm text-amber-800">
                          {bloqueosFecha.map((b, i) => (
                            <div key={i} className="font-medium">
                              {b.motivo || `Bloqueo ${b.turno === 'todo' ? 'todo el día' : b.turno.toUpperCase()}`}
                              {b.turno !== 'todo' && <span className="font-normal text-amber-600"> — turno {b.turno.toUpperCase()}</span>}
                              {b.aplica_a !== 'todos' && <span className="font-normal text-amber-600"> ({b.aplica_a})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <button
                      onClick={() => seleccionarTipoPedido('delivery')}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                    >
                      <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Delivery</span>
                    </button>
                    <button
                      onClick={() => seleccionarTipoPedido('retiro')}
                      className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 transition-all"
                    >
                      <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0V7.875C3 6.839 3.839 6 4.875 6h14.25C20.16 6 21 6.839 21 7.875v1.474" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Retiro por Sucursal</span>
                    </button>
                  </div>
                </>
              )}

              {/* PASO 3: Dirección (delivery) o Sucursal (retiro) */}
              {pasoPedido === 3 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Fecha:</span>{' '}
                      <span className="font-medium text-gray-800">{new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                  </div>

                  {cargandoDetallePedido ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-amber-600" />
                    </div>
                  ) : tipoPedidoSeleccionado === 'delivery' ? (
                    <>
                      {/* Direcciones del cliente */}
                      {direccionesPedido.length === 0 && !mostrarNuevaDirPedido && (
                        <p className="text-sm text-gray-400 py-2">Este cliente no tiene direcciones cargadas.</p>
                      )}
                      {direccionesPedido.length > 0 && (
                        <div className="space-y-1">
                          {direccionesPedido.map(d => (
                            editandoDirPedido?.id === d.id ? (
                              <div key={d.id} className="bg-gray-50 rounded-lg p-3 space-y-2 border-2 border-amber-400">
                                <input
                                  type="text"
                                  value={editandoDirPedido.direccion}
                                  onChange={e => setEditandoDirPedido(prev => ({ ...prev, direccion: e.target.value }))}
                                  placeholder="Direccion *"
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  value={editandoDirPedido.localidad}
                                  onChange={e => setEditandoDirPedido(prev => ({ ...prev, localidad: e.target.value }))}
                                  placeholder="Localidad"
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setEditandoDirPedido(null)}
                                    className="flex-1 text-sm py-2 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    onClick={guardarEditDirPedido}
                                    disabled={guardandoEditDirPedido || !editandoDirPedido.direccion.trim()}
                                    className="flex-1 text-sm py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                                  >
                                    {guardandoEditDirPedido ? 'Guardando...' : 'Guardar'}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div key={d.id} className={`flex items-center gap-1 rounded-lg border-2 transition-colors ${
                                direccionSeleccionadaPedido === d.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}>
                                <button
                                  onClick={() => { setDireccionSeleccionadaPedido(d.id); setMostrarNuevaDirPedido(false); setEditandoDirPedido(null) }}
                                  className="flex-1 text-left p-3"
                                >
                                  <span className="text-sm text-gray-800">{d.direccion}</span>
                                  {d.localidad && <span className="text-xs text-gray-400 ml-1">({d.localidad})</span>}
                                  {d.es_principal && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-2">Principal</span>}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditandoDirPedido({ id: d.id, direccion: d.direccion || '', localidad: d.localidad || '' }); setMostrarNuevaDirPedido(false) }}
                                  className="p-2 mr-1 text-gray-400 hover:text-amber-600 transition-colors"
                                  title="Editar dirección"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                                  </svg>
                                </button>
                              </div>
                            )
                          ))}
                        </div>
                      )}

                      {/* Nueva dirección */}
                      {mostrarNuevaDirPedido ? (
                        <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
                          <input
                            type="text"
                            value={nuevaDirPedido.direccion}
                            onChange={e => setNuevaDirPedido(prev => ({ ...prev, direccion: e.target.value }))}
                            placeholder="Direccion *"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={nuevaDirPedido.localidad}
                            onChange={e => setNuevaDirPedido(prev => ({ ...prev, localidad: e.target.value }))}
                            placeholder="Localidad"
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setMostrarNuevaDirPedido(false); setNuevaDirPedido({ direccion: '', localidad: '' }) }}
                              className="flex-1 text-sm py-2 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={guardarNuevaDirPedido}
                              disabled={guardandoDirPedido || !nuevaDirPedido.direccion.trim()}
                              className="flex-1 text-sm py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                            >
                              {guardandoDirPedido ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setMostrarNuevaDirPedido(true); setDireccionSeleccionadaPedido(null) }}
                          className="w-full mt-2 flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 border-dashed border-gray-200 hover:border-amber-400 hover:bg-amber-50/50 text-gray-500 hover:text-amber-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                          <span className="text-sm font-medium">Nueva direccion</span>
                        </button>
                      )}

                      {/* Observación de entrega */}
                      <div className="mt-2">
                        <label className="text-xs text-gray-500 mb-1 block">Observacion de entrega (opcional)</label>
                        <textarea
                          value={observacionEntregaPedido}
                          onChange={e => setObservacionEntregaPedido(e.target.value)}
                          placeholder="Ej: entregar antes de las 18hs, tocar timbre..."
                          rows={2}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                        />
                      </div>

                      {/* Turno de entrega */}
                      {(() => {
                        const esHoy = fechaEntregaPedido === new Date().toISOString().split('T')[0]
                        const horaActual = new Date().getHours()
                        const amDisabled = esHoy && horaActual >= 9
                        const pmDisabled = esHoy && horaActual >= 17
                        return (
                          <div className="mt-3">
                            <p className="text-xs text-gray-500 mb-1.5">Turno de entrega</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => !amDisabled && setTurnoPedido('AM')}
                                disabled={amDisabled}
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-colors ${
                                  amDisabled
                                    ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                                    : turnoPedido === 'AM'
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-gray-100 hover:border-gray-300'
                                }`}
                              >
                                <span className={`text-sm font-semibold ${amDisabled ? 'text-gray-400' : 'text-gray-800'}`}>AM</span>
                                <span className="block text-[11px] text-gray-400">9 a 13hs</span>
                                {amDisabled && <span className="block text-[10px] text-red-400 mt-0.5">Fuera de horario</span>}
                              </button>
                              <button
                                onClick={() => !pmDisabled && setTurnoPedido('PM')}
                                disabled={pmDisabled}
                                className={`flex-1 p-3 rounded-lg border-2 text-center transition-colors ${
                                  pmDisabled
                                    ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                                    : turnoPedido === 'PM'
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-gray-100 hover:border-gray-300'
                                }`}
                              >
                                <span className={`text-sm font-semibold ${pmDisabled ? 'text-gray-400' : 'text-gray-800'}`}>PM</span>
                                <span className="block text-[11px] text-gray-400">17 a 21hs</span>
                                {pmDisabled && <span className="block text-[10px] text-red-400 mt-0.5">Fuera de horario</span>}
                              </button>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Observaciones del pedido + Tarjeta regalo */}
                      <div className="mt-3 space-y-2">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Observaciones del pedido (opcional)</label>
                          <textarea
                            value={observacionesPedidoTexto}
                            onChange={e => setObservacionesPedidoTexto(e.target.value)}
                            placeholder="Ej: separar bebidas del resto, agregar cubiertos..."
                            rows={2}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 text-pink-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                            Tarjeta de regalo (opcional)
                          </label>
                          <textarea
                            value={tarjetaRegaloPedido}
                            onChange={e => setTarjetaRegaloPedido(e.target.value)}
                            placeholder="Ej: Feliz cumpleaños Maria! De parte de Julian"
                            rows={2}
                            className="w-full text-sm border border-pink-200 rounded-lg px-3 py-2 focus:outline-none focus:border-pink-400 resize-none bg-pink-50/30"
                          />
                        </div>
                      </div>

                      {/* Botón confirmar delivery */}
                      <button
                        onClick={confirmarPedidoWizard}
                        disabled={!direccionSeleccionadaPedido || !turnoPedido || guardandoPedido}
                        className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {guardandoPedido ? 'Guardando...' : 'Confirmar pedido'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Sucursales para retiro */}
                      {sucursalesPedido.length > 0 && (
                        <div className="space-y-1">
                          {sucursalesPedido.map(s => (
                            <button
                              key={s.id}
                              onClick={() => setSucursalSeleccionadaPedido(s.id)}
                              className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                                sucursalSeleccionadaPedido === s.id
                                  ? 'border-amber-400 bg-amber-50'
                                  : 'border-gray-100 hover:border-gray-300'
                              }`}
                            >
                              <span className="text-sm font-medium text-gray-800">{s.nombre}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Observación de entrega (retiro) */}
                      <div className="mt-2">
                        <label className="text-xs text-gray-500 mb-1 block">Observacion de entrega (opcional)</label>
                        <textarea
                          value={observacionEntregaPedido}
                          onChange={e => setObservacionEntregaPedido(e.target.value)}
                          placeholder="Ej: retira otra persona, avisar cuando esté listo..."
                          rows={2}
                          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                        />
                      </div>

                      {/* Observaciones del pedido + Tarjeta regalo (retiro) */}
                      <div className="mt-3 space-y-2">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Observaciones del pedido (opcional)</label>
                          <textarea
                            value={observacionesPedidoTexto}
                            onChange={e => setObservacionesPedidoTexto(e.target.value)}
                            placeholder="Ej: separar bebidas del resto, agregar cubiertos..."
                            rows={2}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 text-pink-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                            Tarjeta de regalo (opcional)
                          </label>
                          <textarea
                            value={tarjetaRegaloPedido}
                            onChange={e => setTarjetaRegaloPedido(e.target.value)}
                            placeholder="Ej: Feliz cumpleaños Maria! De parte de Julian"
                            rows={2}
                            className="w-full text-sm border border-pink-200 rounded-lg px-3 py-2 focus:outline-none focus:border-pink-400 resize-none bg-pink-50/30"
                          />
                        </div>
                      </div>

                      {/* Botón confirmar retiro */}
                      <button
                        onClick={confirmarPedidoWizard}
                        disabled={!sucursalSeleccionadaPedido || guardandoPedido}
                        className="w-full mt-3 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {guardandoPedido ? 'Guardando...' : 'Confirmar pedido'}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* PASO 4: Pago anticipado */}
              {pasoPedido === 4 && clientePedido && (
                <>
                  <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                    <div>
                      <span className="text-gray-500">Cliente:</span>{' '}
                      <span className="font-medium text-gray-800">{clientePedido.razon_social}</span>
                    </div>
                    {fechaEntregaPedido && (
                      <div>
                        <span className="text-gray-500">Fecha:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {new Date(fechaEntregaPedido + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-500">Tipo:</span>{' '}
                      <span className="font-medium text-gray-800">{tipoPedidoSeleccionado === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}</span>
                    </div>
                    {tipoPedidoSeleccionado === 'delivery' && direccionSeleccionadaPedido && (
                      <div>
                        <span className="text-gray-500">Direccion:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {(() => { const d = direccionesPedido.find(x => x.id === direccionSeleccionadaPedido); return d ? `${d.direccion}${d.localidad ? `, ${d.localidad}` : ''}` : '' })()}
                        </span>
                      </div>
                    )}
                    {tipoPedidoSeleccionado === 'retiro' && sucursalSeleccionadaPedido && (
                      <div>
                        <span className="text-gray-500">Sucursal:</span>{' '}
                        <span className="font-medium text-gray-800">
                          {sucursalesPedido.find(s => s.id === sucursalSeleccionadaPedido)?.nombre || ''}
                        </span>
                      </div>
                    )}
                    {tipoPedidoSeleccionado === 'delivery' && turnoPedido && (
                      <div>
                        <span className="text-gray-500">Turno:</span>{' '}
                        <span className="font-medium text-gray-800">{turnoPedido === 'AM' ? 'AM (9-13hs)' : 'PM (17-21hs)'}</span>
                      </div>
                    )}
                    <div className="pt-1 border-t border-gray-200 mt-1">
                      <span className="text-gray-500">Total:</span>{' '}
                      <span className="font-bold text-gray-800">{formatPrecio(total)}</span>
                    </div>
                  </div>

                  {tipoPedidoSeleccionado === 'delivery' ? (
                    <>
                      <div className="text-center py-1">
                        <p className="text-sm font-medium text-gray-700">Forma de pago</p>
                      </div>
                      <div className="space-y-2">
                        <button
                          onClick={() => finalizarPedidoWizard('cobrar')}
                          disabled={guardandoPedido}
                          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-7 h-7 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                          </svg>
                          <span className="text-sm font-medium text-green-700">Cobrar ahora</span>
                        </button>
                        <button
                          onClick={() => finalizarPedidoWizard('efectivo_entrega')}
                          disabled={guardandoPedido}
                          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-amber-200 hover:border-amber-400 hover:bg-amber-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-7 h-7 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
                          </svg>
                          <span className="text-sm font-medium text-amber-700">Paga en la entrega en efectivo</span>
                        </button>
                        <button
                          onClick={() => finalizarPedidoWizard('link_pago')}
                          disabled={guardandoPedido}
                          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-blue-200 hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-7 h-7 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.06a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364l1.757 1.757" />
                          </svg>
                          <span className="text-sm font-medium text-blue-700">Link de pago</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-center py-2">
                        <p className="text-sm font-medium text-gray-700">¿Desea abonar por anticipado?</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => finalizarPedidoWizard(false)}
                          disabled={guardandoPedido}
                          className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <span className="text-sm font-medium text-gray-700">No, solo guardar</span>
                        </button>
                        <button
                          onClick={() => finalizarPedidoWizard('cobrar')}
                          disabled={guardandoPedido}
                          className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-green-200 hover:border-green-400 hover:bg-green-50 transition-all disabled:opacity-50"
                        >
                          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                          </svg>
                          <span className="text-sm font-medium text-green-700">Si, cobrar ahora</span>
                        </button>
                      </div>
                    </>
                  )}
                  {guardandoPedido && (
                    <div className="flex justify-center py-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-amber-600" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Modal crear cliente (se superpone) */}
          {mostrarCrearClientePedido && (
            <NuevoClienteModal
              onClose={() => setMostrarCrearClientePedido(false)}
              onCreado={onClientePedidoCreado}
              cuitInicial={busquedaClientePedido.trim()}
            />
          )}
        </div>
      )}
    </>
  )
}

export default PedidoWizardModal
