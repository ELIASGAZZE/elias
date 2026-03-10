// Modal de cobro — POS (pantalla completa, denominaciones desde config, pagos parciales, offline support)
import React, { useState, useEffect } from 'react'
import api, { isNetworkError } from '../../services/api'
import { guardarDenominaciones, getDenominaciones, guardarFormasCobro, getFormasCobro as getFormasCobroDB, encolarVenta } from '../../services/offlineDB'
import { syncVentasPendientes } from '../../services/offlineSync'
import { imprimirTicketPOS } from '../../utils/imprimirComprobante'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const formatDenominacion = (valor) => {
  if (valor >= 1000) return `$${new Intl.NumberFormat('es-AR').format(valor)}`
  return `$${valor}`
}

function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

const ModalCobrar = ({ total, subtotal, descuentoTotal, ivaTotal, carrito, cliente, promosAplicadas, onConfirmar, onCerrar, isOnline, onVentaOffline, soloPago, pedidoPosId, saldoCliente: saldoProp, giftCardsEnVenta }) => {
  const [denominaciones, setDenominaciones] = useState([])
  const [formasCobro, setFormasCobro] = useState([])
  const [pagos, setPagos] = useState([])
  const [montoFormaPago, setMontoFormaPago] = useState('')
  const [formaSeleccionada, setFormaSeleccionada] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ultimoPago, setUltimoPago] = useState(null) // flash feedback
  const [promosPago, setPromosPago] = useState([])

  // Gift Cards
  const [gcCodigo, setGcCodigo] = useState('')
  const [gcConsultando, setGcConsultando] = useState(false)
  const [gcResultado, setGcResultado] = useState(null) // { gift_card, error }
  const [giftCardsAplicadas, setGiftCardsAplicadas] = useState([]) // [{ codigo, monto, saldo }]

  // Saldo a favor del cliente
  const saldoDisponible = parseFloat(saldoProp) || 0

  useEffect(() => {
    cargarConfig()
  }, [])

  async function cargarConfig() {
    try {
      const [denRes, fcRes, promosRes] = await Promise.all([
        api.get('/api/denominaciones'),
        api.get('/api/formas-cobro'),
        api.get('/api/pos/promociones'),
      ])
      const dens = (denRes.data.denominaciones || denRes.data || [])
        .filter(d => d.activo !== false)
        .sort((a, b) => Number(a.valor) - Number(b.valor))
      setDenominaciones(dens)
      guardarDenominaciones(dens).catch(() => {})

      const fcs = (fcRes.data.formas_cobro || fcRes.data || [])
        .filter(f => f.activo !== false && (f.nombre || '').toLowerCase() !== 'efectivo')
      setFormasCobro(fcs)
      // Guardar todas las formas de cobro (sin filtrar efectivo) para offline
      const fcsAll = (fcRes.data.formas_cobro || fcRes.data || []).filter(f => f.activo !== false)
      guardarFormasCobro(fcsAll).catch(() => {})

      const promos = (promosRes.data.promociones || [])
        .filter(p => p.activa && p.tipo === 'forma_pago')
      setPromosPago(promos)
    } catch (err) {
      console.error('Error cargando config cobro:', err)
      // Fallback a IndexedDB si es error de red
      if (isNetworkError(err)) {
        try {
          const cachedDens = await getDenominaciones()
          if (cachedDens.length > 0) {
            setDenominaciones(cachedDens.filter(d => d.activo !== false).sort((a, b) => Number(a.valor) - Number(b.valor)))
          }
          const cachedFcs = await getFormasCobroDB()
          if (cachedFcs.length > 0) {
            setFormasCobro(cachedFcs.filter(f => f.activo !== false && (f.nombre || '').toLowerCase() !== 'efectivo'))
          }
        } catch {}
      }
    }
  }

  // Resumen por tipo de pago
  const resumenPagos = pagos.reduce((acc, p) => {
    acc[p.tipo] = (acc[p.tipo] || 0) + p.monto
    return acc
  }, {})

  // Calcular descuentos por forma de pago
  const descuentosPorForma = promosPago.map(promo => {
    const reglas = promo.reglas || {}
    const nombreForma = reglas.forma_cobro_nombre
    const porcentaje = reglas.valor || 0
    const montoPagado = resumenPagos[nombreForma] || 0
    if (montoPagado <= 0 || porcentaje <= 0) return null
    return {
      promoId: promo.id,
      promoNombre: promo.nombre,
      formaCobro: nombreForma,
      porcentaje,
      montoPagado,
      descuento: Math.round(montoPagado * porcentaje / 100 * 100) / 100,
    }
  }).filter(Boolean)

  const totalDescuentoPagos = descuentosPorForma.reduce((s, d) => s + d.descuento, 0)

  // Saldo aplicado: min(saldoDisponible, total después de descuentos forma pago)
  const totalConDescFormaPago = Math.round((total - totalDescuentoPagos) * 100) / 100
  const saldoAplicado = saldoDisponible > 0 ? Math.min(saldoDisponible, totalConDescFormaPago) : 0
  const totalEfectivo = Math.round((totalConDescFormaPago - saldoAplicado) * 100) / 100

  // Promo de efectivo (para mostrar "resta en efectivo" con descuento)
  const promoEfectivo = promosPago.find(p => (p.reglas?.forma_cobro_nombre || '').toLowerCase() === 'efectivo')
  const porcentajeDescEfectivo = promoEfectivo?.reglas?.valor || 0

  const totalGiftCards = giftCardsAplicadas.reduce((s, g) => s + g.monto, 0)
  const totalEfectivoConGC = Math.round((totalEfectivo - totalGiftCards) * 100) / 100
  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0)
  const restante = Math.max(0, totalEfectivoConGC - totalPagado)
  const montoSuficiente = totalEfectivoConGC <= 0 || totalPagado >= totalEfectivoConGC
  const vuelto = Math.max(0, totalPagado - totalEfectivoConGC)

  // Conteo de billetes por denominación para efectivo
  const conteoBilletes = pagos
    .filter(p => p.tipo === 'Efectivo' && p.detalle?.denominacion)
    .reduce((acc, p) => {
      const den = p.detalle.denominacion
      if (!acc[den]) acc[den] = { cantidad: 0, total: 0 }
      acc[den].cantidad += 1
      acc[den].total += p.monto
      return acc
    }, {})

  function agregarBillete(valor) {
    setPagos(prev => [...prev, { tipo: 'Efectivo', monto: valor, detalle: { denominacion: valor } }])
    // Flash feedback
    setUltimoPago(valor)
    setTimeout(() => setUltimoPago(null), 300)
  }

  function borrarPagos() {
    setPagos([])
    setFormaSeleccionada(null)
    setMontoFormaPago('')
  }

  function borrarUltimoPago() {
    setPagos(prev => prev.slice(0, -1))
  }

  function agregarFormaPago() {
    const monto = parseFloat(montoFormaPago)
    if (!formaSeleccionada || isNaN(monto) || monto <= 0) return
    setPagos(prev => [...prev, { tipo: formaSeleccionada.nombre, monto, detalle: { forma_cobro_id: formaSeleccionada.id } }])
    setMontoFormaPago('')
    setFormaSeleccionada(null)
  }

  // Gift Cards
  async function consultarGiftCard() {
    if (!gcCodigo.trim()) return
    setGcConsultando(true)
    setGcResultado(null)
    try {
      const { data } = await api.get(`/api/gift-cards/consultar/${gcCodigo.trim()}`)
      if (data.gift_card.estado !== 'activa') {
        setGcResultado({ error: `Gift card ${data.gift_card.estado}` })
      } else if (parseFloat(data.gift_card.saldo) <= 0) {
        setGcResultado({ error: 'Gift card sin saldo' })
      } else if (giftCardsAplicadas.some(g => g.codigo === data.gift_card.codigo)) {
        setGcResultado({ error: 'Esta gift card ya fue agregada' })
      } else {
        setGcResultado({ gift_card: data.gift_card })
      }
    } catch (err) {
      setGcResultado({ error: err.response?.data?.error || 'Gift card no encontrada' })
    } finally {
      setGcConsultando(false)
    }
  }

  function aplicarGiftCard() {
    if (!gcResultado?.gift_card) return
    const gc = gcResultado.gift_card
    const saldo = parseFloat(gc.saldo)
    const restanteActual = Math.max(0, totalEfectivo - totalPagado - totalGiftCards)
    const montoAplicar = Math.min(saldo, restanteActual > 0 ? restanteActual : saldo)
    if (montoAplicar <= 0) return

    setGiftCardsAplicadas(prev => [...prev, { codigo: gc.codigo, monto: montoAplicar, saldo }])
    setGcCodigo('')
    setGcResultado(null)
  }

  function quitarGiftCard(codigo) {
    setGiftCardsAplicadas(prev => prev.filter(g => g.codigo !== codigo))
  }

  async function confirmarVenta() {
    if (!montoSuficiente) return
    setGuardando(true)
    setError('')

    const items = carrito.map(i => ({
      id_articulo: i.articulo.id,
      codigo: i.articulo.codigo,
      nombre: i.articulo.nombre,
      precio_unitario: i.precioOverride != null ? i.precioOverride : calcularPrecioConDescuentosBase(i.articulo),
      cantidad: i.cantidad,
      iva_tasa: i.articulo.iva?.tasa || 21,
      rubro: i.articulo.rubro?.nombre || null,
      subRubro: i.articulo.subRubro?.nombre || null,
    }))

    const promosParaGuardar = promosAplicadas.map(p => ({
      promoId: p.promoId,
      promoNombre: p.promoNombre,
      porcentajeDescuento: p.porcentajeDescuento,
      descuento: p.descuento,
      entidadNombre: p.entidadNombre,
    }))

    const totalOriginalSinSaldo = totalConDescFormaPago
    const payload = {
      id_cliente_centum: cliente.id_centum,
      nombre_cliente: cliente.razon_social,
      items,
      promociones_aplicadas: promosParaGuardar.length > 0 ? promosParaGuardar : null,
      subtotal,
      descuento_total: descuentoTotal,
      descuento_forma_pago: totalDescuentoPagos > 0 ? {
        total: totalDescuentoPagos,
        detalle: descuentosPorForma,
      } : null,
      total: totalOriginalSinSaldo,
      monto_pagado: totalPagado + saldoAplicado,
      vuelto: vuelto > 0 ? vuelto : 0,
      pagos: pagos.map(p => ({ tipo: p.tipo, monto: p.monto, detalle: p.detalle || null })),
    }
    if (saldoAplicado > 0) payload.saldo_aplicado = saldoAplicado
    if (pedidoPosId) payload.pedido_pos_id = pedidoPosId
    if (giftCardsAplicadas.length > 0) {
      payload.gift_cards_aplicadas = giftCardsAplicadas.map(g => ({ codigo: g.codigo, monto: g.monto }))
    }
    if (giftCardsEnVenta && giftCardsEnVenta.length > 0) {
      payload.gift_cards_a_activar = giftCardsEnVenta
    }

    const ticketData = {
      items,
      cliente,
      pagos,
      promosAplicadas,
      descuentosPorForma,
      subtotal,
      descuentoTotal,
      totalDescuentoPagos,
      total: totalEfectivo,
      totalPagado,
      vuelto: vuelto > 0 ? vuelto : 0,
    }

    // Modo soloPago: no crear venta, solo devolver datos de pago (para pedidos con pago anticipado)
    if (soloPago) {
      onConfirmar({ pagos: payload.pagos, total: payload.total, monto_pagado: payload.monto_pagado, vuelto: payload.vuelto })
      setGuardando(false)
      return
    }

    try {
      await api.post('/api/pos/ventas', payload)
      syncVentasPendientes().catch(() => {})
      imprimirTicketPOS({ ...ticketData, esOffline: false })
      onConfirmar()
    } catch (err) {
      console.error('Error al guardar venta:', err)
      if (isNetworkError(err)) {
        try {
          await encolarVenta(payload)
          if (onVentaOffline) onVentaOffline()
          imprimirTicketPOS({ ...ticketData, esOffline: true })
          onConfirmar()
        } catch (dbErr) {
          setError('Error al guardar venta offline')
        }
      } else {
        setError(err.response?.data?.error || 'Error al guardar la venta')
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-800 flex flex-col lg:flex-row">

      {/* ====== IZQUIERDA: Denominaciones ====== */}
      <div className="flex-1 p-5 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest">Efectivo</h3>
          <button
            onClick={onCerrar}
            className="text-white/40 hover:text-white/80 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 flex-1 content-start">
          {denominaciones.map(den => (
            <button
              key={den.id}
              onClick={() => agregarBillete(den.valor)}
              className={`relative bg-slate-700 hover:bg-slate-600 active:bg-violet-600 text-white font-bold text-lg py-4 rounded-xl transition-all duration-150 active:scale-95 select-none ${
                ultimoPago === den.valor ? 'bg-violet-600 scale-95' : ''
              }`}
            >
              {formatDenominacion(den.valor)}
              {conteoBilletes[den.valor]?.cantidad > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-white text-slate-800 text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-md">
                  {conteoBilletes[den.valor].cantidad}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Borrar / Deshacer */}
        <div className="flex gap-2.5 mt-3">
          {pagos.length > 0 && (
            <button
              onClick={borrarUltimoPago}
              className="flex-1 bg-slate-600 hover:bg-slate-500 text-white/80 font-medium text-sm py-3 rounded-xl transition-colors"
            >
              Deshacer
            </button>
          )}
          <button
            onClick={borrarPagos}
            className={`${pagos.length > 0 ? 'flex-1' : 'w-full'} bg-red-500/80 hover:bg-red-500 text-white font-medium text-sm py-3 rounded-xl transition-colors`}
          >
            Borrar todo
          </button>
        </div>
      </div>

      {/* ====== CENTRO: Otros medios + detalle ====== */}
      <div className="w-72 p-5 flex flex-col gap-4 border-l border-white/10">
        {/* Formas de pago */}
        {formasCobro.length > 0 && (
          <div>
            <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Otros medios</h3>
            <div className="space-y-2">
              {formasCobro.map(fc => (
                <button
                  key={fc.id}
                  onClick={() => setFormaSeleccionada(formaSeleccionada?.id === fc.id ? null : fc)}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                    formaSeleccionada?.id === fc.id
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  {fc.nombre}
                </button>
              ))}
            </div>

            {formaSeleccionada && (
              <div className="mt-3 bg-slate-700/50 rounded-xl p-3 space-y-2">
                <label className="text-white/50 text-xs">Monto en {formaSeleccionada.nombre}</label>
                <input
                  type="number"
                  value={montoFormaPago}
                  onChange={e => setMontoFormaPago(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && agregarFormaPago()}
                  placeholder="0"
                  className="w-full bg-slate-600 border-0 rounded-lg px-3 py-2.5 text-xl font-bold text-white text-center focus:ring-2 focus:ring-violet-500 placeholder-white/30"
                  autoFocus
                  min="0"
                  step="0.01"
                />
                <button
                  onClick={agregarFormaPago}
                  disabled={!montoFormaPago || parseFloat(montoFormaPago) <= 0}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-slate-600 disabled:text-white/30 text-white font-semibold py-2.5 rounded-lg transition-colors"
                >
                  Agregar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Gift Card */}
        <div>
          <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Gift Card</h3>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={gcCodigo}
              onChange={e => setGcCodigo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); consultarGiftCard() } }}
              placeholder="Escanear código..."
              className="flex-1 bg-slate-600 border-0 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:ring-2 focus:ring-violet-500"
            />
            <button
              onClick={consultarGiftCard}
              disabled={gcConsultando || !gcCodigo.trim()}
              className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-600 text-white text-xs font-semibold px-3 rounded-lg transition-colors"
            >
              {gcConsultando ? '...' : 'Consultar'}
            </button>
          </div>
          {gcResultado?.error && (
            <div className="mt-2 text-red-400 text-xs">{gcResultado.error}</div>
          )}
          {gcResultado?.gift_card && (
            <div className="mt-2 bg-slate-700/50 rounded-xl p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-white/60 text-xs font-mono">{gcResultado.gift_card.codigo}</span>
                <span className="text-emerald-400 font-bold text-sm">Saldo: {formatPrecio(parseFloat(gcResultado.gift_card.saldo))}</span>
              </div>
              <button
                onClick={aplicarGiftCard}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
              >
                Aplicar
              </button>
            </div>
          )}
          {giftCardsAplicadas.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {giftCardsAplicadas.map(gc => (
                <div key={gc.codigo} className="flex items-center justify-between bg-slate-700/40 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-white/60 text-xs font-mono">{gc.codigo}</span>
                    <span className="text-emerald-400 font-semibold text-sm ml-2">{formatPrecio(gc.monto)}</span>
                  </div>
                  <button onClick={() => quitarGiftCard(gc.codigo)} className="text-red-400 hover:text-red-300 text-xs">
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detalle de pagos cargados */}
        {pagos.length > 0 && (
          <div className="flex-1">
            <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Detalle</h3>
            <div className="bg-slate-700/40 rounded-xl p-3 space-y-1.5 max-h-60 overflow-y-auto">
              {/* Efectivo con conteo de billetes */}
              {resumenPagos['Efectivo'] && (
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/60 text-sm">Efectivo</span>
                    <span className="text-white font-semibold text-sm">{formatPrecio(resumenPagos['Efectivo'])}</span>
                  </div>
                  {Object.keys(conteoBilletes).length > 0 && (
                    <div className="ml-3 mt-0.5 space-y-0.5">
                      {Object.entries(conteoBilletes)
                        .sort(([a], [b]) => Number(b) - Number(a))
                        .map(([den, info]) => (
                          <div key={den} className="flex justify-between text-xs">
                            <span className="text-white/40">{info.cantidad}x {formatDenominacion(Number(den))}</span>
                            <span className="text-white/50">{formatPrecio(info.total)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
              {/* Otros medios de pago */}
              {Object.entries(resumenPagos)
                .filter(([tipo]) => tipo !== 'Efectivo')
                .map(([tipo, monto]) => (
                  <div key={tipo} className="flex justify-between items-center">
                    <span className="text-white/60 text-sm">{tipo}</span>
                    <span className="text-white font-semibold text-sm">{formatPrecio(monto)}</span>
                  </div>
                ))}
              {/* Descuentos por forma de pago */}
              {descuentosPorForma.length > 0 && (
                <div className="border-t border-white/10 pt-1.5 mt-1.5 space-y-1">
                  {descuentosPorForma.map(d => (
                    <div key={d.promoId} className="flex justify-between items-center">
                      <span className="text-cyan-400 text-xs">Desc. {d.formaCobro} {d.porcentaje}%</span>
                      <span className="text-cyan-400 font-semibold text-xs">-{formatPrecio(d.descuento)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-white/10 pt-2 mt-2 flex justify-between">
                <span className="text-white/80 text-sm font-medium">Total pagado</span>
                <span className="text-white font-bold">{formatPrecio(totalPagado)}</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-400/20 rounded-xl px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* ====== DERECHA: Total + confirmar ====== */}
      <div className="w-80 p-5 flex flex-col border-l border-white/10">
        {/* Bloque total */}
        <div className={`flex-1 rounded-2xl flex flex-col items-center justify-center p-6 transition-colors duration-300 ${
          montoSuficiente ? 'bg-emerald-500' : 'bg-slate-700'
        }`}>
          <span className={`text-xs font-semibold uppercase tracking-widest mb-1 ${
            montoSuficiente ? 'text-emerald-900/60' : 'text-white/40'
          }`}>
            Total a cobrar
          </span>
          {(totalDescuentoPagos > 0 || saldoAplicado > 0 || totalGiftCards > 0) ? (
            <>
              <span className="text-2xl font-bold text-white/40 line-through mb-1">
                {formatPrecio(total)}
              </span>
              <div className="flex flex-col items-center mb-2">
                {descuentosPorForma.map(d => (
                  <span key={d.promoId} className="text-cyan-300 text-xs font-medium">
                    Desc. {d.formaCobro} {d.porcentaje}%: -{formatPrecio(d.descuento)}
                  </span>
                ))}
                {saldoAplicado > 0 && (
                  <span className="text-emerald-300 text-xs font-medium">
                    Saldo a favor: -{formatPrecio(saldoAplicado)}
                  </span>
                )}
                {totalGiftCards > 0 && (
                  <span className="text-amber-300 text-xs font-medium">
                    Gift Card: -{formatPrecio(totalGiftCards)}
                  </span>
                )}
              </div>
              <span className="text-5xl font-black text-white mb-6">
                {totalEfectivoConGC <= 0 ? '$0' : formatPrecio(totalEfectivoConGC)}
              </span>
            </>
          ) : (
            <span className="text-5xl font-black text-white mb-8">
              {formatPrecio(total)}
            </span>
          )}

          {restante > 0 ? (
            <div className="bg-white/10 rounded-xl px-8 py-4 text-center backdrop-blur-sm">
              <span className={`text-xs font-medium block mb-1 ${montoSuficiente ? 'text-emerald-900/60' : 'text-white/50'}`}>
                Resta cobrar
              </span>
              <span className="text-white text-3xl font-bold">{formatPrecio(restante)}</span>
              {porcentajeDescEfectivo > 0 && (
                <div className="mt-2 pt-2 border-t border-white/15">
                  <span className="text-cyan-300 text-xs font-medium block mb-0.5">
                    En efectivo ({porcentajeDescEfectivo}% desc.)
                  </span>
                  <span className="text-cyan-200 text-2xl font-bold">
                    {formatPrecio(Math.round(restante * (1 - porcentajeDescEfectivo / 100) * 100) / 100)}
                  </span>
                </div>
              )}
            </div>
          ) : vuelto > 0 ? (
            <div className="bg-white/20 rounded-xl px-8 py-4 text-center backdrop-blur-sm">
              <span className="text-emerald-900/60 text-xs font-medium block mb-1">Vuelto</span>
              <span className="text-white text-3xl font-bold">{formatPrecio(vuelto)}</span>
            </div>
          ) : totalPagado > 0 ? (
            <div className="bg-white/20 rounded-xl px-8 py-4 text-center backdrop-blur-sm">
              <svg className="w-8 h-8 text-white mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <span className="text-white text-lg font-bold">Monto exacto</span>
            </div>
          ) : null}
        </div>

        {/* Botón confirmar */}
        <button
          onClick={confirmarVenta}
          disabled={!montoSuficiente || guardando}
          className={`mt-4 w-full font-bold py-4 rounded-xl text-lg transition-all duration-200 ${
            montoSuficiente && !guardando
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/30 active:scale-[0.98]'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
        >
          {guardando ? 'Guardando...' : montoSuficiente ? (totalEfectivoConGC <= 0 ? 'Confirmar (cubierto)' : 'Confirmar venta') : 'Ingresá el pago'}
        </button>
      </div>
    </div>
  )
}

export default ModalCobrar
