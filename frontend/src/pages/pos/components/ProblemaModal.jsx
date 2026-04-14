import React from 'react'
import NuevoClienteModal from '../../../components/NuevoClienteModal'
import api from '../../../services/api'
import { imprimirTicketDevolucion, imprimirTicketAnulacion } from '../../../utils/imprimirComprobante'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

export default function ProblemaModal(props) {
  const {
    mostrarProblema,
    problemaSeleccionado, setProblemaSeleccionado,
    problemaPaso, setProblemaPaso,
    problemaBusqueda, setProblemaBusqueda,
    problemaBusFactura, setProblemaBusFactura,
    problemaFecha, setProblemaFecha,
    problemaBusArticulo, setProblemaBusArticulo,
    problemaSucursal, setProblemaSucursal,
    problemaSucursales, setProblemaSucursales,
    problemaVentas, setProblemaVentas,
    problemaBuscando,
    problemaVentaSel, setProblemaVentaSel,
    problemaItemsSel, setProblemaItemsSel,
    problemaDescripciones, setProblemaDescripciones,
    problemaYaDevuelto, setProblemaYaDevuelto,
    problemaCliente, setProblemaCliente,
    problemaBusCliente, setProblemaBusCliente,
    problemaClientesRes, setProblemaClientesRes,
    problemaBuscandoCli,
    problemaCrearCliente, setProblemaCrearCliente,
    problemaConfirmando, setProblemaConfirmando,
    problemaObservacion, setProblemaObservacion,
    problemaPreciosCorregidos, setProblemaPreciosCorregidos,
    problemaEmailCliente, setProblemaEmailCliente,
    problemaVentasCierre, setProblemaVentasCierre,
    problemaCargandoCierre, setProblemaCargandoCierre,
    problemaMotivoAnulacion, setProblemaMotivoAnulacion,
    problemaResultadoAnulacion, setProblemaResultadoAnulacion,
    problemaCliTimerRef,
    cerrarModalProblema,
    buscarVentasProblema,
    buscarVentasProblemaDebounced,
    terminalConfig,
    cierreActivo,
    setProblemaBuscandoCli,
  } = props

  if (!mostrarProblema) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-modal>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-red-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            <h2 className="text-white font-bold text-lg">
              {problemaPaso === 0 ? 'Reportar problema' : problemaPaso === 1 ? 'Buscar factura' : problemaPaso === 2 ? 'Seleccionar productos' : problemaPaso === 3 ? 'Describir problema' : problemaPaso === 4 ? 'Identificar cliente' : problemaPaso === 5 ? 'Confirmar devolucion' : problemaPaso === 10 ? 'Cliente correcto' : problemaPaso === 11 ? 'Confirmar correccion' : problemaPaso === 20 ? 'Precio correcto' : problemaPaso === 21 ? 'Confirmar diferencia' : problemaPaso === 30 ? 'Cambio de producto' : problemaPaso === 40 ? 'Anular venta reciente' : problemaPaso === 41 ? 'Confirmar anulacion' : problemaPaso === 42 ? 'Venta anulada' : ''}
            </h2>
          </div>
          <button onClick={cerrarModalProblema} className="text-white/70 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Paso 0: Seleccionar tipo de problema */}
        {problemaPaso === 0 && (
          <div className="p-5">
            <p className="text-sm text-gray-500 mb-4">Selecciona el tipo de problema:</p>
            <div className="space-y-2">
              {[
                { id: 'devolucion', label: 'Cliente devuelve producto en mal estado', icon: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3' },
                { id: 'cliente_erroneo', label: 'Se facturo a un cliente erroneo', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z' },
                { id: 'cantidad_mal', label: 'Se facturo mal la cantidad de un articulo', icon: 'M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z' },
                { id: 'precio_mal', label: 'Se facturo mal el precio de un articulo', icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z' },
                { id: 'cambio', label: 'El cliente desea cambiar el producto', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
                { id: 'anular_venta', label: 'Anular venta reciente (de este turno)', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
              ].map(op => (
                <button
                  key={op.id}
                  onClick={() => setProblemaSeleccionado(op.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                    problemaSeleccionado === op.id
                      ? 'border-red-500 bg-red-50'
                      : 'border-gray-200 hover:border-red-300 hover:bg-red-50/50'
                  }`}
                >
                  <svg className={`w-5 h-5 flex-shrink-0 ${problemaSeleccionado === op.id ? 'text-red-600' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={op.icon} />
                  </svg>
                  <span className={`text-sm font-medium ${problemaSeleccionado === op.id ? 'text-red-700' : 'text-gray-700'}`}>{op.label}</span>
                </button>
              ))}
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={cerrarModalProblema}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                disabled={!problemaSeleccionado}
                onClick={() => {
                  if (problemaSeleccionado === 'anular_venta') {
                    if (!cierreActivo?.id) {
                      alert('No hay un turno de caja abierto. Abrí la caja antes de anular una venta.')
                      return
                    }
                    setProblemaCargandoCierre(true)
                    setProblemaVentasCierre([])
                    setProblemaVentaSel(null)
                    // Cargar ventas del turno actual usando el endpoint de ventas con filtros
                    const apertura = cierreActivo.apertura_at?.split('T')[0]
                    api.get('/api/pos/ventas', { params: {
                      caja_id: terminalConfig?.caja_id,
                      desde_hora: cierreActivo.apertura_at,
                      problema: 1,
                      tipo: 'venta',
                      excluir_con_nc: 1,
                    }})
                      .then(({ data }) => {
                        const ventas = (data.ventas || []).filter(v => {
                          if (v.tipo && v.tipo !== 'venta') return false
                          if (v.anulada) return false
                          // Excluir ventas cobradas con Talo Pay (no se pueden anular)
                          const pagos = typeof v.pagos === 'string' ? JSON.parse(v.pagos) : (v.pagos || [])
                          const esTaloPay = pagos.some(p => ['talo pay', 'pago anticipado'].includes((p.tipo || '').toLowerCase()))
                          if (esTaloPay) return false
                          return true
                        })
                        setProblemaVentasCierre(ventas)
                      })
                      .catch(() => setProblemaVentasCierre([]))
                      .finally(() => setProblemaCargandoCierre(false))
                    setProblemaPaso(40)
                  } else if (problemaSeleccionado === 'cambio') {
                    setProblemaPaso(30)
                  } else {
                    setProblemaPaso(1)
                    buscarVentasProblema()
                    if (problemaSucursales.length === 0) {
                      api.get('/api/sucursales').then(r => setProblemaSucursales(r.data || [])).catch(err => console.error('Error loading sucursales:', err.message))
                    }
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
              >
                Continuar
              </button>
            </div>
          </div>
        )}

        {/* Paso 1: Buscar factura */}
        {problemaPaso === 1 && (
          <div className="p-5 flex flex-col min-h-0 flex-1">
            {/* Filtros */}
            <div className="space-y-2 mb-3 flex-shrink-0">
              {/* Fila 0: Buscar por N Factura */}
              <div>
                <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">N° Factura (POS o Centum)</label>
                <input
                  type="text"
                  value={problemaBusFactura}
                  onChange={e => {
                    setProblemaBusFactura(e.target.value)
                    if (e.target.value.trim()) {
                      setProblemaBusqueda('')
                      setProblemaBusArticulo('')
                      setProblemaSucursal('')
                    }
                    buscarVentasProblemaDebounced({ numero_factura: e.target.value })
                  }}
                  placeholder="Ej: 1234 o B PV2-7740"
                  autoFocus
                  className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              {!problemaBusFactura.trim() && <>
              {/* Fila 1: Fecha + Cliente */}
              <div className="flex gap-2">
                <div className="flex-shrink-0">
                  <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Fecha</label>
                  <input
                    type="date"
                    value={problemaFecha}
                    onChange={e => {
                      const f = e.target.value
                      setProblemaFecha(f)
                      buscarVentasProblemaDebounced({ fecha: f || '' })
                    }}
                    className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Cliente</label>
                  <input
                    type="text"
                    value={problemaBusqueda}
                    onChange={e => {
                      setProblemaBusqueda(e.target.value)
                      buscarVentasProblemaDebounced({ buscar: e.target.value })
                    }}
                    placeholder="Nombre del cliente..."
                    className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>
              {/* Fila 2: Articulo + Sucursal */}
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Articulo</label>
                  <input
                    type="text"
                    value={problemaBusArticulo}
                    onChange={e => {
                      setProblemaBusArticulo(e.target.value)
                      buscarVentasProblemaDebounced({ articulo: e.target.value })
                    }}
                    placeholder="Nombre de articulo..."
                    className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div className="flex-shrink-0 w-36">
                  <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Sucursal</label>
                  <select
                    value={problemaSucursal}
                    onChange={e => {
                      setProblemaSucursal(e.target.value)
                      buscarVentasProblemaDebounced({ sucursal_id: e.target.value })
                    }}
                    className="block w-full border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                  >
                    <option value="">Todas</option>
                    {problemaSucursales.map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
              </>}
            </div>

            {/* Contador resultados */}
            {!problemaBuscando && problemaVentas.length > 0 && (
              <div className="text-xs text-gray-400 mb-2 flex-shrink-0">{problemaVentas.length} factura{problemaVentas.length !== 1 ? 's' : ''}</div>
            )}

            {/* Resultados */}
            <div className="flex-1 overflow-y-auto min-h-0 max-h-72 space-y-2">
              {problemaBuscando ? (
                <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                  Buscando...
                </div>
              ) : problemaVentas.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No se encontraron facturas
                </div>
              ) : (
                problemaVentas.filter(v => v.tipo !== 'nota_credito' && !v.anulada).map(v => {
                  const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
                  const pagos = typeof v.pagos === 'string' ? JSON.parse(v.pagos) : (v.pagos || [])
                  const fecha = new Date(v.created_at)
                  const sel = problemaVentaSel?.id === v.id
                  return (
                    <button
                      key={v.id}
                      onClick={() => {
                        setProblemaVentaSel(v)
                        // Consultar items ya devueltos de esta venta
                        api.get(`/api/pos/ventas/${v.id}/devoluciones`).then(r => {
                          setProblemaYaDevuelto(r.data?.ya_devuelto || {})
                        }).catch(() => setProblemaYaDevuelto({}))
                      }}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                        sel ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-red-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-800">
                          {v.numero_venta ? <span className="text-blue-600 mr-1">#{v.numero_venta}</span> : null}
                          {v.nombre_cliente || 'Consumidor Final'}
                        </span>
                        <span className="text-sm font-bold text-gray-700">{formatPrecio(v.total)}</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                        {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        {v.centum_comprobante && <span className="text-violet-500 font-medium"> · {v.centum_comprobante}</span>}
                        {v.sucursales?.nombre && <span> · {v.sucursales.nombre}</span>}
                        {(v.empleado_nombre || v.perfiles?.nombre) && <span> · {v.empleado_nombre || v.perfiles.nombre}</span>}
                      </div>
                      {pagos.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {[...new Set(pagos.map(p => p.tipo))].map(tipo => (
                            <span key={tipo} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">
                              {tipo}
                            </span>
                          ))}
                          {v.saldo_aplicado > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                              Saldo
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5 truncate">
                        {items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ')}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {/* Botones */}
            <div className="flex gap-3 mt-4 flex-shrink-0">
              <button
                onClick={() => { setProblemaPaso(0); setProblemaBusqueda(''); setProblemaBusFactura(''); setProblemaBusArticulo(''); setProblemaSucursal(''); setProblemaVentas([]); setProblemaVentaSel(null) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Volver
              </button>
              <button
                disabled={!problemaVentaSel}
                onClick={() => {
                  if (problemaSeleccionado === 'cliente_erroneo') {
                    // Ir directo a identificar cliente correcto
                    setProblemaCliente(null)
                    setProblemaBusCliente('')
                    setProblemaClientesRes([])
                    setProblemaPaso(10) // paso especial cliente erroneo
                  } else {
                    setProblemaPaso(2)
                    setProblemaItemsSel({})
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
              >
                Seleccionar
              </button>
            </div>
          </div>
        )}

        {/* Paso 2: seleccionar productos a devolver */}
        {problemaPaso === 2 && problemaVentaSel && (() => {
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              {/* Info venta */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">
                    {problemaVentaSel.numero_venta ? <span className="text-blue-600 mr-1">#{problemaVentaSel.numero_venta}</span> : null}
                    {problemaVentaSel.nombre_cliente || 'Consumidor Final'}
                  </span>
                  <span className="text-sm font-bold text-gray-600">{formatPrecio(problemaVentaSel.total)}</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {new Date(problemaVentaSel.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                  {new Date(problemaVentaSel.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 flex-shrink-0">
                Selecciona los productos a devolver
              </div>

              {/* Lista de productos */}
              <div className="flex-1 overflow-y-auto min-h-0 max-h-72 space-y-2">
                {items.map((item, idx) => {
                  const cantSel = problemaItemsSel[idx] || 0
                  const selected = cantSel > 0
                  const cantYaDevuelta = problemaYaDevuelto[idx] || 0
                  const cantDisponible = (item.cantidad || 1) - cantYaDevuelta
                  const cantMax = cantDisponible
                  const totalmenteDevuelto = cantDisponible <= 0
                  return (
                    <div
                      key={idx}
                      className={`px-4 py-3 rounded-xl border-2 transition-all ${
                        totalmenteDevuelto ? 'border-gray-200 bg-gray-100 opacity-50' : selected ? 'border-red-500 bg-red-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          disabled={totalmenteDevuelto}
                          onClick={() => {
                            if (totalmenteDevuelto) return
                            setProblemaItemsSel(prev => {
                              const copy = { ...prev }
                              if (selected) { delete copy[idx] } else { copy[idx] = cantMax < 1 ? cantMax : 1 }
                              return copy
                            })
                          }}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                            totalmenteDevuelto ? 'border-gray-300 bg-gray-200' : selected ? 'bg-red-500 border-red-500' : 'border-gray-300'
                          }`}
                        >
                          {selected && !totalmenteDevuelto && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${totalmenteDevuelto ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{item.nombre}</div>
                          <div className="text-xs text-gray-400">
                            {item.cantidad}x {formatPrecio(item.precio_unitario || item.precioUnitario || item.precio)} = {formatPrecio((item.precio_unitario || item.precioUnitario || item.precio) * item.cantidad)}
                          </div>
                          {totalmenteDevuelto && (
                            <div className="text-xs text-red-500 font-medium mt-0.5">Ya devuelto</div>
                          )}
                          {cantYaDevuelta > 0 && !totalmenteDevuelto && (
                            <div className="text-xs text-amber-600 font-medium mt-0.5">Ya devuelto: {cantYaDevuelta} — disponible: {cantDisponible}</div>
                          )}
                        </div>
                      </div>
                      {selected && cantMax > 1 && (
                        <div className="flex items-center gap-2 mt-2 ml-8">
                          <span className="text-xs text-red-600 font-medium">Cantidad:</span>
                          <button
                            onClick={() => setProblemaItemsSel(prev => {
                              const v = (prev[idx] || 1) - 1
                              if (v <= 0) { const copy = { ...prev }; delete copy[idx]; return copy }
                              return { ...prev, [idx]: v }
                            })}
                            className="w-7 h-7 rounded-lg border border-red-300 bg-white flex items-center justify-center text-red-600 font-bold text-sm hover:bg-red-50"
                          >{'\u2212'}</button>
                          <span className="text-sm font-bold text-red-700 w-6 text-center">{cantSel}</span>
                          <button
                            onClick={() => setProblemaItemsSel(prev => {
                              const v = Math.min((prev[idx] || 1) + 1, cantMax)
                              return { ...prev, [idx]: v }
                            })}
                            disabled={cantSel >= cantMax}
                            className="w-7 h-7 rounded-lg border border-red-300 bg-white flex items-center justify-center text-red-600 font-bold text-sm hover:bg-red-50 disabled:opacity-30"
                          >+</button>
                          <span className="text-xs text-gray-400">/ {cantMax}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Resumen seleccion */}
              {Object.keys(problemaItemsSel).length > 0 && (
                <div className="bg-red-50 rounded-lg px-3 py-2 mt-3 flex-shrink-0">
                  <span className="text-xs text-red-600 font-medium">
                    {Object.keys(problemaItemsSel).length} producto{Object.keys(problemaItemsSel).length !== 1 ? 's' : ''} · {Object.values(problemaItemsSel).reduce((a, b) => a + b, 0)} unidad{Object.values(problemaItemsSel).reduce((a, b) => a + b, 0) !== 1 ? 'es' : ''}
                  </span>
                </div>
              )}

              {/* Botones */}
              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => { setProblemaPaso(1); setProblemaItemsSel({}) }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  disabled={Object.keys(problemaItemsSel).length === 0}
                  onClick={() => {
                    if (problemaSeleccionado === 'cantidad_mal' || problemaSeleccionado === 'cambio') {
                      const v = problemaVentaSel
                      if (v.id_cliente_centum && v.id_cliente_centum !== 0 && v.nombre_cliente && v.nombre_cliente !== 'Consumidor Final') {
                        setProblemaCliente({ id_centum: v.id_cliente_centum, razon_social: v.nombre_cliente })
                      } else { setProblemaCliente(null) }
                      setProblemaBusCliente(''); setProblemaClientesRes([])
                      setProblemaPaso(4)
                    } else if (problemaSeleccionado === 'precio_mal') {
                      setProblemaPreciosCorregidos({})
                      setProblemaPaso(20)
                    } else {
                      setProblemaPaso(3)
                      setProblemaDescripciones({})
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  Continuar
                </button>
              </div>
            </div>
          )
        })()}

        {/* Paso 3: describir problema de cada producto */}
        {problemaPaso === 3 && problemaVentaSel && (() => {
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          const indices = Object.keys(problemaItemsSel).map(Number)
          const todasCompletas = indices.every(idx => (problemaDescripciones[idx] || '').trim().length > 0)
          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex-shrink-0">
                Describe lo que observas en cada producto
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 max-h-80 space-y-4">
                {indices.map(idx => {
                  const item = items[idx]
                  const cant = problemaItemsSel[idx]
                  return (
                    <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-800">{item.nombre}</span>
                        <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded-full">
                          {cant} {cant > 1 ? 'unidades' : 'unidad'}
                        </span>
                      </div>
                      <textarea
                        value={problemaDescripciones[idx] || ''}
                        onChange={e => setProblemaDescripciones(prev => ({ ...prev, [idx]: e.target.value }))}
                        placeholder="Ej: Se observa color oscuro, el cliente comenta sabor agrio..."
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                      />
                    </div>
                  )
                })}
              </div>

              {/* Botones */}
              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(2)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  disabled={!todasCompletas}
                  onClick={() => {
                    // Pre-fill cliente si la venta ya tiene uno
                    const v = problemaVentaSel
                    if (v.id_cliente_centum && v.id_cliente_centum !== 0 && v.nombre_cliente && v.nombre_cliente !== 'Consumidor Final') {
                      setProblemaCliente({ id_centum: v.id_cliente_centum, razon_social: v.nombre_cliente })
                    } else {
                      setProblemaCliente(null)
                    }
                    setProblemaBusCliente('')
                    setProblemaClientesRes([])
                    setProblemaPaso(4)
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  Continuar
                </button>
              </div>
            </div>
          )
        })()}

        {/* Paso 4: identificar cliente */}
        {problemaPaso === 4 && (() => {
          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              {/* Cliente ya identificado */}
              {problemaCliente ? (
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Cliente identificado</div>
                  <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{problemaCliente.razon_social}</div>
                      {problemaCliente.cuit && (
                        <div className="text-xs text-gray-400 mt-0.5">CUIT: {problemaCliente.cuit}</div>
                      )}
                      {problemaCliente.celular && (
                        <div className="text-xs text-gray-400">Tel: {problemaCliente.celular}</div>
                      )}
                    </div>
                    <button
                      onClick={() => { setProblemaCliente(null); setProblemaBusCliente('') }}
                      className="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Cambiar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col min-h-0 flex-1">
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Buscar cliente</div>
                  <div className="flex-shrink-0 mb-3">
                    <input
                      type="text"
                      value={problemaBusCliente}
                      onChange={e => {
                        const val = e.target.value
                        setProblemaBusCliente(val)
                        clearTimeout(problemaCliTimerRef.current)
                        if (val.trim().length < 2) { setProblemaClientesRes([]); return }
                        problemaCliTimerRef.current = setTimeout(async () => {
                          setProblemaBuscandoCli(true)
                          try {
                            const { data } = await api.get('/api/clientes', { params: { buscar: val.trim(), limit: 10 } })
                            setProblemaClientesRes(data.clientes || data.data || [])
                          } catch { setProblemaClientesRes([]) }
                          finally { setProblemaBuscandoCli(false) }
                        }, 400)
                      }}
                      placeholder="Nombre, CUIT o razon social..."
                      autoFocus
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 max-h-56 space-y-2">
                    {problemaBuscandoCli ? (
                      <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                        Buscando...
                      </div>
                    ) : problemaClientesRes.length > 0 ? (
                      problemaClientesRes.map(cli => (
                        <button
                          key={cli.id || cli.id_centum}
                          onClick={() => { setProblemaCliente(cli); setProblemaClientesRes([]) }}
                          className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-red-300 transition-all"
                        >
                          <div className="text-sm font-medium text-gray-800">{cli.razon_social}</div>
                          <div className="text-xs text-gray-400">
                            {cli.cuit && <span>CUIT: {cli.cuit}</span>}
                            {cli.celular && <span> · Tel: {cli.celular}</span>}
                          </div>
                        </button>
                      ))
                    ) : problemaBusCliente.trim().length >= 2 && !problemaBuscandoCli ? (
                      <div className="text-center py-6 text-gray-400 text-sm">
                        No se encontraron clientes
                      </div>
                    ) : null}
                  </div>

                  {/* Boton crear cliente */}
                  <button
                    onClick={() => setProblemaCrearCliente(true)}
                    className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors flex items-center justify-center gap-2 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Crear cliente nuevo
                  </button>
                </div>
              )}

              {/* Botones */}
              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(3)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  disabled={!problemaCliente}
                  onClick={() => setProblemaPaso(5)}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  Continuar
                </button>
              </div>

              {/* Modal crear cliente superpuesto */}
              {problemaCrearCliente && (
                <NuevoClienteModal
                  onClose={() => setProblemaCrearCliente(false)}
                  onCreado={(cli) => {
                    setProblemaCliente(cli)
                    setProblemaCrearCliente(false)
                  }}
                  cuitInicial={problemaBusCliente.trim()}
                />
              )}
            </div>
          )
        })()}

        {/* Paso 5: resumen y confirmar devolucion */}
        {problemaPaso === 5 && problemaVentaSel && (() => {
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          const indices = Object.keys(problemaItemsSel).map(Number)
          const subtotalVenta = parseFloat(problemaVentaSel.subtotal) || 0
          const totalVenta = parseFloat(problemaVentaSel.total) || 0

          // Calcular subtotal de items devueltos
          let subtotalDevuelto = 0
          const detalleItems = indices.map(idx => {
            const item = items[idx]
            const cant = problemaItemsSel[idx]
            const precioUnit = item.precio_unitario || item.precioUnitario || item.precio || 0
            const sub = precioUnit * cant
            subtotalDevuelto += sub
            return { ...item, cantDevolver: cant, subtotal: sub, descripcion: problemaDescripciones[idx] }
          })

          const proporcion = subtotalVenta > 0 ? subtotalDevuelto / subtotalVenta : 0
          const saldoAFavor = Math.round(proporcion * totalVenta * 100) / 100
          const huboDescuento = totalVenta < subtotalVenta

          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              <div className="flex-1 overflow-y-auto min-h-0 max-h-96 space-y-4">
                {/* Info venta original */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Venta original</div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Subtotal</span>
                      <span className="font-medium">{formatPrecio(subtotalVenta)}</span>
                    </div>
                    {huboDescuento && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Descuentos</span>
                        <span className="font-medium">-{formatPrecio(subtotalVenta - totalVenta)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold border-t mt-1 pt-1">
                      <span>Total pagado</span>
                      <span>{formatPrecio(totalVenta)}</span>
                    </div>
                  </div>
                </div>

                {/* Cliente */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Cliente</div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-gray-800">{problemaCliente?.razon_social}</span>
                  </div>
                </div>

                {/* Productos a devolver */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Productos a devolver</div>
                  <div className="space-y-2">
                    {detalleItems.map((item, i) => (
                      <div key={i} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium text-gray-800">{item.cantDevolver}x {item.nombre}</span>
                          <span className="font-medium text-gray-600">{formatPrecio(item.subtotal)}</span>
                        </div>
                        {item.descripcion && <div className="text-xs text-gray-500 mt-0.5 italic">"{item.descripcion}"</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Calculo del saldo */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Saldo a generar</div>
                  <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl px-4 py-3">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Valor productos devueltos</span>
                      <span>{formatPrecio(subtotalDevuelto)}</span>
                    </div>
                    {huboDescuento && (
                      <div className="flex justify-between text-sm text-gray-500">
                        <span>Proporcion del total pagado ({Math.round(proporcion * 100)}%)</span>
                        <span>de {formatPrecio(totalVenta)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-lg border-t border-emerald-300 mt-2 pt-2 text-emerald-700">
                      <span>Saldo a favor</span>
                      <span>{formatPrecio(saldoAFavor)}</span>
                    </div>
                    {huboDescuento && (
                      <div className="text-[10px] text-emerald-600 mt-1">
                        Se calcula sobre lo efectivamente pagado (con descuentos aplicados)
                      </div>
                    )}
                  </div>
                </div>

                {/* Observacion */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Observacion (opcional)</div>
                  <textarea
                    value={problemaObservacion}
                    onChange={e => setProblemaObservacion(e.target.value)}
                    placeholder="Alguna nota adicional..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>

              {/* Botones */}
              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(4)}
                  disabled={problemaConfirmando}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Volver
                </button>
                <button
                  disabled={problemaConfirmando}
                  onClick={async () => {
                    setProblemaConfirmando(true)
                    try {
                      const tipoProblemaLabel = problemaSeleccionado === 'cantidad_mal' ? 'Cantidad mal facturada' : problemaSeleccionado === 'cambio' ? 'Cambio de producto' : 'Producto en mal estado'
                      const itemsDevueltos = indices.map(idx => ({
                        indice: idx,
                        nombre: items[idx].nombre,
                        cantidad: problemaItemsSel[idx],
                        descripcion: problemaDescripciones[idx]?.trim() || undefined,
                      }))
                      const { data } = await api.post('/api/pos/devolucion', {
                        venta_id: problemaVentaSel.id,
                        id_cliente_centum: problemaCliente.id_centum,
                        nombre_cliente: problemaCliente.razon_social,
                        tipo_problema: tipoProblemaLabel,
                        observacion: problemaObservacion.trim() || undefined,
                        items_devueltos: itemsDevueltos,
                        caja_id: terminalConfig?.caja_id || null,
                      })
                      // Imprimir 2 tickets: cliente + cajero
                      // Usar items_nc del backend (tienen precio con descuento aplicado)
                      const itemsTicket = (data.items_nc || []).map(it => ({
                        nombre: it.nombre,
                        cantidad: it.cantidad,
                        precioOriginal: it.precio_unitario || it.precioUnitario || it.precio || 0,
                        precioPagado: it.precioUnitario || it.precio || 0,
                        descripcion: it.descripcionProblema,
                      }))
                      imprimirTicketDevolucion({
                        items: itemsTicket,
                        cliente: problemaCliente.razon_social,
                        saldoAFavor: data.saldo_generado,
                        tipoProblema: tipoProblemaLabel,
                        observacion: problemaObservacion.trim() || undefined,
                        ventaOriginal: { numero: problemaVentaSel.numero_venta, comprobante: problemaVentaSel.centum_comprobante },
                        numeroNC: data.numero_nc,
                        huboDescuento: data.factor_descuento < 0.999,
                        subtotalDevuelto: data.subtotal_devuelto,
                      })
                      alert(`Devolucion registrada. Se genero un saldo a favor de ${formatPrecio(data.saldo_generado)} para ${problemaCliente.razon_social}`)
                      cerrarModalProblema()
                    } catch (err) {
                      alert('Error al procesar devolucion: ' + (err.response?.data?.error || err.message))
                    } finally {
                      setProblemaConfirmando(false)
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {problemaConfirmando ? 'Procesando...' : 'Confirmar devolucion'}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Paso 10: Cliente erroneo — identificar cliente correcto */}
        {problemaPaso === 10 && problemaVentaSel && (() => {
          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              {/* Info venta original */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-400">Facturado a:</div>
                    <span className="text-sm font-semibold text-gray-700">
                      {problemaVentaSel.numero_venta ? <span className="text-blue-600 mr-1">#{problemaVentaSel.numero_venta}</span> : null}
                      {problemaVentaSel.nombre_cliente || 'Consumidor Final'}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-gray-600">{formatPrecio(problemaVentaSel.total)}</span>
                </div>
              </div>

              <div className="text-xs font-medium text-red-500 uppercase tracking-wide mb-3 flex-shrink-0">
                Selecciona el cliente correcto
              </div>

              {/* Cliente ya seleccionado */}
              {problemaCliente ? (
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{problemaCliente.razon_social}</div>
                    {problemaCliente.cuit && <div className="text-xs text-gray-400 mt-0.5">CUIT: {problemaCliente.cuit}</div>}
                    {problemaCliente.celular && <div className="text-xs text-gray-400">Tel: {problemaCliente.celular}</div>}
                  </div>
                  <button
                    onClick={() => { setProblemaCliente(null); setProblemaBusCliente(''); setProblemaEmailCliente('') }}
                    className="text-xs text-red-500 hover:text-red-700 font-medium"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="flex flex-col min-h-0 flex-1">
                  <div className="flex-shrink-0 mb-3">
                    <input
                      type="text"
                      value={problemaBusCliente}
                      onChange={e => {
                        const val = e.target.value
                        setProblemaBusCliente(val)
                        clearTimeout(problemaCliTimerRef.current)
                        if (val.trim().length < 2) { setProblemaClientesRes([]); return }
                        problemaCliTimerRef.current = setTimeout(async () => {
                          setProblemaBuscandoCli(true)
                          try {
                            const { data } = await api.get('/api/clientes', { params: { buscar: val.trim(), limit: 10 } })
                            setProblemaClientesRes(data.clientes || data.data || [])
                          } catch { setProblemaClientesRes([]) }
                          finally { setProblemaBuscandoCli(false) }
                        }, 400)
                      }}
                      placeholder="Nombre, CUIT o razon social..."
                      autoFocus
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    />
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0 max-h-56 space-y-2">
                    {problemaBuscandoCli ? (
                      <div className="flex items-center justify-center py-6 text-gray-400 text-sm">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                        Buscando...
                      </div>
                    ) : problemaClientesRes.length > 0 ? (
                      problemaClientesRes.map(cli => (
                        <button
                          key={cli.id || cli.id_centum}
                          onClick={() => { setProblemaCliente(cli); setProblemaEmailCliente(cli.email || ''); setProblemaClientesRes([]) }}
                          className="w-full text-left px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-red-300 transition-all"
                        >
                          <div className="text-sm font-medium text-gray-800">{cli.razon_social}</div>
                          <div className="text-xs text-gray-400">
                            {cli.cuit && <span>CUIT: {cli.cuit}</span>}
                            {cli.celular && <span> · Tel: {cli.celular}</span>}
                            {cli.email && <span> · {cli.email}</span>}
                          </div>
                        </button>
                      ))
                    ) : problemaBusCliente.trim().length >= 2 && !problemaBuscandoCli ? (
                      <div className="text-center py-6 text-gray-400 text-sm">No se encontraron clientes</div>
                    ) : null}
                  </div>

                  <button
                    onClick={() => setProblemaCrearCliente(true)}
                    className="mt-3 w-full py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors flex items-center justify-center gap-2 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Crear cliente nuevo
                  </button>
                </div>
              )}

              {/* Email del cliente (editable) */}
              {problemaCliente && (
                <div className="mt-3 flex-shrink-0">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email para envio de factura</label>
                  <input
                    type="email"
                    value={problemaEmailCliente}
                    onChange={e => setProblemaEmailCliente(e.target.value)}
                    placeholder="email@ejemplo.com"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              )}

              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(1)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  disabled={!problemaCliente}
                  onClick={() => setProblemaPaso(11)}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  Continuar
                </button>
              </div>

              {problemaCrearCliente && (
                <NuevoClienteModal
                  onClose={() => setProblemaCrearCliente(false)}
                  onCreado={(cli) => { setProblemaCliente(cli); setProblemaEmailCliente(cli.email || ''); setProblemaCrearCliente(false) }}
                  cuitInicial={problemaBusCliente.trim()}
                />
              )}
            </div>
          )
        })()}

        {/* Paso 11: Cliente erroneo — confirmar correccion */}
        {problemaPaso === 11 && problemaVentaSel && problemaCliente && (() => {
          const pagos = typeof problemaVentaSel.pagos === 'string' ? JSON.parse(problemaVentaSel.pagos) : (problemaVentaSel.pagos || [])
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              <div className="flex-1 overflow-y-auto min-h-0 max-h-96 space-y-4">
                {/* Cambio de cliente */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Correccion de cliente</div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <div className="text-[10px] text-red-400 uppercase font-medium">Incorrecto</div>
                      <div className="text-sm font-semibold text-gray-700">{problemaVentaSel.nombre_cliente || 'Consumidor Final'}</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                    <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <div className="text-[10px] text-emerald-500 uppercase font-medium">Correcto</div>
                      <div className="text-sm font-semibold text-gray-700">{problemaCliente.razon_social}</div>
                    </div>
                  </div>
                </div>

                {/* Detalle de la venta */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Detalle de la venta</div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Fecha</span>
                      <span className="font-medium">
                        {new Date(problemaVentaSel.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                        {new Date(problemaVentaSel.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-bold border-t pt-1">
                      <span>Total</span>
                      <span>{formatPrecio(problemaVentaSel.total)}</span>
                    </div>
                  </div>
                </div>

                {/* Productos */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Productos</div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                    {items.map((i, idx) => (
                      <div key={idx}>{i.cantidad}x {i.nombre}</div>
                    ))}
                  </div>
                </div>

                {/* Formas de pago */}
                {pagos.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Forma de pago</div>
                    <div className="flex flex-wrap gap-1">
                      {pagos.map((p, idx) => (
                        <span key={idx} className="inline-flex items-center px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-medium">
                          {p.tipo} {formatPrecio(p.monto)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Que se va a hacer */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Se realizara</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <span className="text-xs font-bold text-red-600 bg-red-200 px-1.5 py-0.5 rounded">NC</span>
                      <span className="text-xs text-gray-600">Nota de credito a <strong>{problemaVentaSel.nombre_cliente || 'Consumidor Final'}</strong> por {formatPrecio(problemaVentaSel.total)}</span>
                    </div>
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <span className="text-xs font-bold text-emerald-600 bg-emerald-200 px-1.5 py-0.5 rounded">V</span>
                      <span className="text-xs text-gray-600">Nueva venta a <strong>{problemaCliente.razon_social}</strong> por {formatPrecio(problemaVentaSel.total)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(10)}
                  disabled={problemaConfirmando}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Volver
                </button>
                <button
                  disabled={problemaConfirmando}
                  onClick={async () => {
                    setProblemaConfirmando(true)
                    try {
                      await api.post('/api/pos/correccion-cliente', {
                        venta_id: problemaVentaSel.id,
                        id_cliente_centum: problemaCliente.id_centum,
                        nombre_cliente: problemaCliente.razon_social,
                        caja_id: terminalConfig?.caja_id || null,
                      })
                      alert(`Correccion realizada:\n\u2022 Nota de credito generada para ${problemaVentaSel.nombre_cliente || 'Consumidor Final'}\n\u2022 Nueva venta generada para ${problemaCliente.razon_social}`)
                      cerrarModalProblema()
                    } catch (err) {
                      alert('Error al corregir cliente: ' + (err.response?.data?.error || err.message))
                    } finally {
                      setProblemaConfirmando(false)
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {problemaConfirmando ? 'Procesando...' : 'Confirmar correccion'}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Paso 30: Cambio — confirmar buen estado del producto */}
        {problemaPaso === 30 && (
          <div className="p-5 flex flex-col items-center justify-center flex-1">
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-gray-800 mb-2 text-center">Confirmar estado del producto</h3>
            <p className="text-sm text-gray-500 text-center mb-6 max-w-xs">
              ¿El producto que devuelve el cliente se encuentra en buen estado?
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setProblemaPaso(0)}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                No, cancelar
              </button>
              <button
                onClick={() => {
                  setProblemaPaso(1)
                  buscarVentasProblema()
                  if (problemaSucursales.length === 0) {
                    api.get('/api/sucursales').then(r => setProblemaSucursales(r.data || [])).catch(err => console.error('Error loading sucursales:', err.message))
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                Si, confirmo
              </button>
            </div>
          </div>
        )}

        {/* Paso 40: Anular venta — seleccionar venta del cierre actual */}
        {problemaPaso === 40 && (
          <div className="p-5 flex flex-col min-h-0 flex-1">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1 flex-shrink-0">
              Ventas realizadas en este turno de caja
            </div>
            <div className="text-[10px] text-gray-400 mb-3 flex-shrink-0">
              Solo se pueden anular ventas del turno actual ({cierreActivo?.numero ? `#${cierreActivo.numero}` : ''})
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 max-h-72 space-y-2">
              {problemaCargandoCierre ? (
                <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />
                  Cargando ventas...
                </div>
              ) : problemaVentasCierre.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  No se realizaron ventas en este turno
                </div>
              ) : (
                problemaVentasCierre.filter(v => !v.anulada).map(v => {
                  const items = typeof v.items === 'string' ? JSON.parse(v.items) : (v.items || [])
                  const pagos = typeof v.pagos === 'string' ? JSON.parse(v.pagos) : (v.pagos || [])
                  const fecha = new Date(v.created_at)
                  const sel = problemaVentaSel?.id === v.id
                  return (
                    <button
                      key={v.id}
                      onClick={() => setProblemaVentaSel(v)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                        sel ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-red-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-gray-800">
                          {v.numero_venta ? <span className="text-blue-600 mr-1">#{v.numero_venta}</span> : null}
                          {v.nombre_cliente || 'Consumidor Final'}
                        </span>
                        <span className="text-sm font-bold text-gray-700">{formatPrecio(v.total)}</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {pagos.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {[...new Set(pagos.map(p => p.tipo))].map(tipo => (
                            <span key={tipo} className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">
                              {tipo}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5 truncate">
                        {items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ')}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            <div className="flex gap-3 mt-4 flex-shrink-0">
              <button
                onClick={() => { setProblemaPaso(0); setProblemaVentaSel(null); setProblemaVentasCierre([]) }}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Volver
              </button>
              <button
                disabled={!problemaVentaSel}
                onClick={() => { setProblemaMotivoAnulacion(''); setProblemaPaso(41) }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
              >
                Seleccionar
              </button>
            </div>
          </div>
        )}

        {/* Paso 41: Anular venta — motivo + resumen + confirmar */}
        {problemaPaso === 41 && problemaVentaSel && (() => {
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          const pagos = typeof problemaVentaSel.pagos === 'string' ? JSON.parse(problemaVentaSel.pagos) : (problemaVentaSel.pagos || [])
          const descFormaPago = parseFloat(problemaVentaSel.descuento_forma_pago) || 0

          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              {/* Info venta — fija arriba */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-gray-700">
                    {problemaVentaSel.numero_venta ? <span className="text-blue-600 mr-1">#{problemaVentaSel.numero_venta}</span> : null}
                    {problemaVentaSel.nombre_cliente || 'Consumidor Final'}
                  </span>
                  <span className="text-sm font-bold text-gray-700">{formatPrecio(problemaVentaSel.total)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(problemaVentaSel.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  {problemaVentaSel.centum_comprobante && <span className="text-violet-500 font-medium"> · {problemaVentaSel.centum_comprobante}</span>}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                {/* Productos */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Productos ({items.length})</div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600 space-y-0.5">
                    {items.map((i, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{i.cantidad}x {i.nombre}</span>
                        <span className="text-gray-500">{formatPrecio((i.precio_unitario || i.precioUnitario || i.precio || 0) * i.cantidad)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Formas de pago originales + instrucciones de reembolso */}
                {pagos.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Reembolso al cliente</div>
                    <div className="space-y-2">
                      {pagos.map((p, idx) => {
                        const tipoLower = (p.tipo || '').toLowerCase()
                        let colorBg = 'bg-gray-50'
                        let colorBorder = 'border-gray-200'
                        let colorText = 'text-gray-700'
                        let instruccion = ''

                        if (tipoLower === 'efectivo') {
                          colorBg = 'bg-emerald-50'; colorBorder = 'border-emerald-200'; colorText = 'text-emerald-700'
                          instruccion = `Devolver ${formatPrecio(p.monto)} en efectivo al cliente`
                          if (descFormaPago > 0) instruccion += ` (incluye dto. forma pago $${descFormaPago.toFixed(2)})`
                        } else if (tipoLower === 'posnet mp' || tipoLower === 'qr mp') {
                          colorBg = 'bg-blue-50'; colorBorder = 'border-blue-200'; colorText = 'text-blue-700'
                          instruccion = p.detalle?.mp_order_id
                            ? `Reembolso automatico de ${formatPrecio(p.monto)} via Mercado Pago (se procesa al confirmar)`
                            : `Hacer devolucion manual en Mercado Pago por ${formatPrecio(p.monto)}`
                        } else if (tipoLower === 'payway') {
                          colorBg = 'bg-amber-50'; colorBorder = 'border-amber-200'; colorText = 'text-amber-700'
                          instruccion = `Realizar la anulacion en el posnet Payway por ${formatPrecio(p.monto)}`
                        } else if (tipoLower === 'transferencia') {
                          colorBg = 'bg-purple-50'; colorBorder = 'border-purple-200'; colorText = 'text-purple-700'
                          instruccion = `Coordinar devolucion de transferencia por ${formatPrecio(p.monto)} con administracion`
                        } else if (tipoLower === 'saldo') {
                          colorBg = 'bg-teal-50'; colorBorder = 'border-teal-200'; colorText = 'text-teal-700'
                          instruccion = `Se restaurara ${formatPrecio(p.monto)} al saldo del cliente`
                        } else if (tipoLower === 'gift card') {
                          colorBg = 'bg-pink-50'; colorBorder = 'border-pink-200'; colorText = 'text-pink-700'
                          instruccion = `Coordinar recarga de Gift Card por ${formatPrecio(p.monto)} con administracion`
                        } else {
                          instruccion = `Coordinar devolucion de ${p.tipo} por ${formatPrecio(p.monto)}`
                        }

                        return (
                          <div key={idx} className={`${colorBg} border ${colorBorder} rounded-lg px-3 py-2`}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className={`text-sm font-semibold ${colorText}`}>{p.tipo}</span>
                              <span className={`text-sm font-bold ${colorText}`}>{formatPrecio(p.monto)}</span>
                            </div>
                            <div className="text-xs text-gray-600">{instruccion}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Motivo */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Motivo de la anulacion <span className="text-red-500">*</span></div>
                  <textarea
                    value={problemaMotivoAnulacion}
                    onChange={e => setProblemaMotivoAnulacion(e.target.value)}
                    placeholder="Explica por que se anula esta venta..."
                    rows={2}
                    autoFocus
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                  />
                </div>

                {/* Advertencia */}
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  </svg>
                  <div className="text-xs text-red-700">
                    <strong>Esta accion es irreversible.</strong> Se generara una nota de credito que anula completamente la factura en Centum y AFIP.
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(40)}
                  disabled={problemaConfirmando}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Volver
                </button>
                <button
                  disabled={!problemaMotivoAnulacion.trim() || problemaConfirmando}
                  onClick={async () => {
                    setProblemaConfirmando(true)
                    try {
                      const itemsVenta = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
                      const { data } = await api.post('/api/pos/anular-venta', {
                        venta_id: problemaVentaSel.id,
                        motivo: problemaMotivoAnulacion.trim(),
                        caja_id: terminalConfig?.caja_id || null,
                      })
                      setProblemaResultadoAnulacion(data)
                      // Imprimir 2 tickets: cliente + cajero con firma
                      imprimirTicketAnulacion({
                        ventaNumero: problemaVentaSel.numero_venta,
                        ventaComprobante: problemaVentaSel.centum_comprobante,
                        cliente: problemaVentaSel.nombre_cliente || 'Consumidor Final',
                        items: itemsVenta,
                        totalAnulado: data.total_anulado,
                        reembolsos: data.reembolsos,
                        motivo: problemaMotivoAnulacion.trim(),
                        numeroNC: data.numero_nc,
                        cajeroNombre: cierreActivo?.empleado?.nombre || 'Cajero',
                      })
                      setProblemaPaso(42)
                    } catch (err) {
                      alert('Error al anular la venta: ' + (err.response?.data?.error || err.message))
                    } finally {
                      setProblemaConfirmando(false)
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {problemaConfirmando ? 'Anulando...' : 'Anular venta'}
                </button>
              </div>
            </div>
          )
        })()}

        {/* Paso 42: Anular venta — resultado */}
        {problemaPaso === 42 && problemaResultadoAnulacion && (
          <div className="p-5 flex flex-col min-h-0 flex-1">
            <div className="flex flex-col items-center mb-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-gray-800">Venta anulada correctamente</h3>
              {problemaResultadoAnulacion.numero_nc && (
                <p className="text-sm text-gray-500 mt-1">NC #{problemaResultadoAnulacion.numero_nc}</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 max-h-72 space-y-3">
              <div className="bg-gray-50 rounded-lg px-3 py-2 flex justify-between text-sm">
                <span className="text-gray-600">Total anulado</span>
                <span className="font-bold text-gray-800">{formatPrecio(problemaResultadoAnulacion.total_anulado)}</span>
              </div>

              {problemaResultadoAnulacion.centum_nc && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700 font-medium flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Nota de credito sincronizada con Centum
                </div>
              )}

              {!problemaResultadoAnulacion.centum_nc && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 font-medium flex items-center gap-2">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  </svg>
                  NC registrada localmente (no se pudo sincronizar con Centum)
                </div>
              )}

              {/* Instrucciones de reembolso */}
              {problemaResultadoAnulacion.reembolsos?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Acciones de reembolso</div>
                  <div className="space-y-2">
                    {problemaResultadoAnulacion.reembolsos.map((r, idx) => {
                      const esOk = r.estado === 'reembolsado' || r.estado === 'automatico'
                      const esError = r.estado === 'error'
                      return (
                        <div key={idx} className={`rounded-lg px-3 py-2 border ${
                          esOk ? 'bg-emerald-50 border-emerald-200' : esError ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                        }`}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-sm font-semibold ${esOk ? 'text-emerald-700' : esError ? 'text-red-700' : 'text-amber-700'}`}>
                              {r.tipo}
                            </span>
                            <span className="flex items-center gap-1">
                              {esOk && <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                              {esError && <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                              {r.estado === 'manual' && <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>}
                              <span className={`text-sm font-bold ${esOk ? 'text-emerald-700' : esError ? 'text-red-700' : 'text-amber-700'}`}>{formatPrecio(r.monto)}</span>
                            </span>
                          </div>
                          <div className={`text-xs ${esOk ? 'text-emerald-600' : esError ? 'text-red-600' : 'text-amber-600'}`}>
                            {r.mensaje}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex-shrink-0">
              <button
                onClick={cerrarModalProblema}
                className="w-full py-2.5 rounded-xl bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Paso 20: Precio mal — ingresar precio correcto */}
        {problemaPaso === 20 && problemaVentaSel && (() => {
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          const indices = Object.keys(problemaItemsSel).map(Number)
          const todosCompletos = indices.every(idx => {
            const val = problemaPreciosCorregidos[idx]
            return val !== undefined && val !== '' && parseFloat(val) >= 0
          })
          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3 flex-shrink-0">
                Ingresa el precio que figura en gondola
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 max-h-80 space-y-3">
                {indices.map(idx => {
                  const item = items[idx]
                  const precioOriginal = item.precio_unitario || item.precioUnitario || item.precio || 0
                  const precioCorr = problemaPreciosCorregidos[idx]
                  const cantItem = item.cantidad || 1
                  const diferencia = precioCorr !== undefined && precioCorr !== '' ? (precioOriginal - parseFloat(precioCorr)) * cantItem : null
                  return (
                    <div key={idx} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="text-sm font-semibold text-gray-800 mb-2">{item.nombre}</div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-400 uppercase font-medium">Cobrado</label>
                          <div className="text-sm font-bold text-red-600">{formatPrecio(precioOriginal)}</div>
                        </div>
                        <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-400 uppercase font-medium">Precio gondola</label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={problemaPreciosCorregidos[idx] ?? ''}
                              onChange={e => setProblemaPreciosCorregidos(prev => ({ ...prev, [idx]: e.target.value }))}
                              placeholder="0.00"
                              className="w-full pl-7 pr-2 py-2 border border-gray-300 rounded-lg text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      </div>
                      {diferencia !== null && diferencia > 0 && (
                        <div className="mt-2 text-xs text-emerald-600 font-medium bg-emerald-50 rounded px-2 py-1 text-center">
                          Diferencia a favor: {formatPrecio(diferencia)}
                        </div>
                      )}
                      {diferencia !== null && diferencia <= 0 && (
                        <div className="mt-2 text-xs text-amber-600 font-medium bg-amber-50 rounded px-2 py-1 text-center">
                          {diferencia === 0 ? 'Sin diferencia' : 'El precio de gondola es mayor al cobrado'}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button
                  onClick={() => setProblemaPaso(2)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Volver
                </button>
                <button
                  disabled={!todosCompletos}
                  onClick={() => {
                    const v = problemaVentaSel
                    if (v.id_cliente_centum && v.id_cliente_centum !== 0 && v.nombre_cliente && v.nombre_cliente !== 'Consumidor Final') {
                      setProblemaCliente({ id_centum: v.id_cliente_centum, razon_social: v.nombre_cliente })
                    } else { setProblemaCliente(null) }
                    setProblemaBusCliente(''); setProblemaClientesRes([])
                    setProblemaPaso(21)
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                >
                  Continuar
                </button>
              </div>
            </div>
          )
        })()}

        {/* Paso 21: Precio mal — identificar cliente + confirmar */}
        {problemaPaso === 21 && problemaVentaSel && (() => {
          const items = typeof problemaVentaSel.items === 'string' ? JSON.parse(problemaVentaSel.items) : (problemaVentaSel.items || [])
          const indices = Object.keys(problemaItemsSel).map(Number)

          // Calcular diferencia total
          let totalDiferencia = 0
          const detalleItems = indices.map(idx => {
            const item = items[idx]
            const cant = item.cantidad || 1
            const precioCobrado = item.precio_unitario || item.precioUnitario || item.precio || 0
            const precioGondola = parseFloat(problemaPreciosCorregidos[idx]) || 0
            const dif = (precioCobrado - precioGondola) * cant
            totalDiferencia += dif
            return { nombre: item.nombre, cantidad: cant, precioCobrado, precioGondola, diferencia: dif, indice: idx }
          })

          // Aplicar proporcion de descuento de la venta original
          const subtotalVenta = parseFloat(problemaVentaSel.subtotal) || 0
          const totalVenta = parseFloat(problemaVentaSel.total) || 0
          const factorDescuento = subtotalVenta > 0 ? totalVenta / subtotalVenta : 1
          const saldoAFavor = Math.round(totalDiferencia * factorDescuento * 100) / 100
          const huboDescuento = factorDescuento < 1

          return (
            <div className="p-5 flex flex-col min-h-0 flex-1">
              <div className="flex-1 overflow-y-auto min-h-0 max-h-96 space-y-4">
                {/* Cliente */}
                {!problemaCliente ? (
                  <div>
                    <div className="text-xs font-medium text-red-500 uppercase tracking-wide mb-3">Identificar cliente</div>
                    <div className="flex-shrink-0 mb-3">
                      <input
                        type="text"
                        value={problemaBusCliente}
                        onChange={e => {
                          const val = e.target.value
                          setProblemaBusCliente(val)
                          clearTimeout(problemaCliTimerRef.current)
                          if (val.trim().length < 2) { setProblemaClientesRes([]); return }
                          problemaCliTimerRef.current = setTimeout(async () => {
                            setProblemaBuscandoCli(true)
                            try {
                              const { data } = await api.get('/api/clientes', { params: { buscar: val.trim(), limit: 10 } })
                              setProblemaClientesRes(data.clientes || data.data || [])
                            } catch { setProblemaClientesRes([]) }
                            finally { setProblemaBuscandoCli(false) }
                          }, 400)
                        }}
                        placeholder="Nombre, CUIT o razon social..."
                        autoFocus
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {problemaBuscandoCli ? (
                        <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mr-2" />Buscando...
                        </div>
                      ) : problemaClientesRes.map(cli => (
                        <button key={cli.id || cli.id_centum} onClick={() => { setProblemaCliente(cli); setProblemaClientesRes([]) }}
                          className="w-full text-left px-4 py-2 rounded-xl border-2 border-gray-200 hover:border-red-300 transition-all">
                          <div className="text-sm font-medium text-gray-800">{cli.razon_social}</div>
                          <div className="text-xs text-gray-400">{cli.cuit && `CUIT: ${cli.cuit}`}{cli.celular && ` \u00b7 Tel: ${cli.celular}`}</div>
                        </button>
                      ))}
                      {problemaBusCliente.trim().length >= 2 && !problemaBuscandoCli && problemaClientesRes.length === 0 && (
                        <div className="text-center py-4 text-gray-400 text-sm">No se encontraron clientes</div>
                      )}
                    </div>
                    <button onClick={() => setProblemaCrearCliente(true)}
                      className="mt-3 w-full py-2 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-500 hover:border-red-400 hover:text-red-600 transition-colors flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      Crear cliente nuevo
                    </button>
                    {problemaCrearCliente && (
                      <NuevoClienteModal onClose={() => setProblemaCrearCliente(false)}
                        onCreado={(cli) => { setProblemaCliente(cli); setProblemaCrearCliente(false) }}
                        cuitInicial={problemaBusCliente.trim()} />
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Cliente</div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-800">{problemaCliente.razon_social}</span>
                        <button onClick={() => { setProblemaCliente(null); setProblemaBusCliente('') }} className="text-xs text-red-500 font-medium">Cambiar</button>
                      </div>
                    </div>

                    {/* Detalle diferencias */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Diferencias de precio</div>
                      <div className="space-y-2">
                        {detalleItems.map((d, i) => (
                          <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                            <div className="text-sm font-medium text-gray-800">{d.cantidad !== 1 ? `${d.cantidad}x ` : ''}{d.nombre}</div>
                            <div className="flex items-center gap-2 mt-1 text-xs">
                              <span className="text-red-600">Cobrado: {formatPrecio(d.precioCobrado)}</span>
                              <span className="text-gray-400">{'\u2192'}</span>
                              <span className="text-emerald-600">Gondola: {formatPrecio(d.precioGondola)}</span>
                              <span className="ml-auto font-bold text-emerald-700">+{formatPrecio(d.diferencia)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Saldo a generar */}
                    <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl px-4 py-3">
                      {huboDescuento && (
                        <div className="flex justify-between text-sm text-gray-500 mb-1">
                          <span>Diferencia bruta</span>
                          <span>{formatPrecio(totalDiferencia)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-lg text-emerald-700">
                        <span>Saldo a favor</span>
                        <span>{formatPrecio(saldoAFavor)}</span>
                      </div>
                      {huboDescuento && (
                        <div className="text-[10px] text-emerald-600 mt-1">Ajustado al descuento aplicado en la venta original</div>
                      )}
                    </div>

                    {/* Observacion */}
                    <div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Observacion (opcional)</div>
                      <textarea value={problemaObservacion} onChange={e => setProblemaObservacion(e.target.value)}
                        placeholder="Alguna nota adicional..." rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none" />
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-3 mt-4 flex-shrink-0">
                <button onClick={() => setProblemaPaso(20)} disabled={problemaConfirmando}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Volver
                </button>
                <button
                  disabled={!problemaCliente || saldoAFavor <= 0 || problemaConfirmando}
                  onClick={async () => {
                    setProblemaConfirmando(true)
                    try {
                      const { data } = await api.post('/api/pos/devolucion-precio', {
                        venta_id: problemaVentaSel.id,
                        id_cliente_centum: problemaCliente.id_centum,
                        nombre_cliente: problemaCliente.razon_social,
                        observacion: problemaObservacion.trim() || undefined,
                        items_corregidos: detalleItems.map(d => ({
                          indice: d.indice,
                          nombre: d.nombre,
                          cantidad: d.cantidad,
                          precio_cobrado: d.precioCobrado,
                          precio_correcto: d.precioGondola,
                        })),
                        caja_id: terminalConfig?.caja_id || null,
                      })
                      alert(`Correccion registrada. Se genero un saldo a favor de ${formatPrecio(data.saldo_generado)} para ${problemaCliente.razon_social}`)
                      cerrarModalProblema()
                    } catch (err) {
                      alert('Error: ' + (err.response?.data?.error || err.message))
                    } finally { setProblemaConfirmando(false) }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                  {problemaConfirmando && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                  {problemaConfirmando ? 'Procesando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
