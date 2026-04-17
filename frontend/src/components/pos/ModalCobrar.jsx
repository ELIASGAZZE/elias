// Modal de cobro — POS (pantalla completa, numpad efectivo, pagos parciales, offline support)
import React, { useState, useEffect, useRef } from 'react'
import api, { isNetworkError } from '../../services/api'
import { guardarFormasCobro, getFormasCobro as getFormasCobroDB, encolarVenta } from '../../services/offlineDB'
import { syncVentasPendientes } from '../../services/offlineSync'
import { imprimirTicketPOS } from '../../utils/imprimirComprobante'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const formatMontoInput = (valor) => {
  if (!valor && valor !== 0) return ''
  return new Intl.NumberFormat('es-AR').format(valor)
}

function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

const redondearCentena = (monto) => {
  if (monto <= 0) return 0
  // Montos chicos (< $100): redondear a decena para no perder el monto
  if (monto < 100) return Math.ceil(monto / 10) * 10
  return Math.round(monto / 100) * 100
}

// Mapeo de F-keys fijo (fuera del componente para evitar recrear en cada render)
const FKEY_FORMAS = { F10: 'Transferencia', F11: 'Payway', F12: 'Rappi / PedidosYa' }

const ModalCobrar = ({ total, subtotal, descuentoTotal, ivaTotal, carrito, cliente, promosAplicadas, ticketUid, onConfirmar, onCerrar, isOnline, onVentaOffline, soloPago, pedidoPosId, saldoCliente: saldoProp, saldoDesglose = {}, giftCardsEnVenta, canal, modoDelivery, idPedidoPlataforma, descuentoGrupoCliente = 0, grupoDescuentoNombre, grupoDescuentoPorcentaje }) => {
  const [formasCobro, setFormasCobro] = useState([])
  const [pagos, setPagos] = useState([])
  const [montoFormaPago, setMontoFormaPago] = useState('')
  const [formaSeleccionada, setFormaSeleccionada] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [promosPago, setPromosPago] = useState([])
  const [montoEfectivoInput, setMontoEfectivoInput] = useState('') // string numérico para el numpad

  // Gift Cards
  const [gcCodigo, setGcCodigo] = useState('')
  const [gcConsultando, setGcConsultando] = useState(false)
  const [gcResultado, setGcResultado] = useState(null) // { gift_card, error }
  const [giftCardsAplicadas, setGiftCardsAplicadas] = useState([]) // [{ codigo, monto, saldo }]

  // Saldo a favor del cliente (opt-in: el cajero decide si aplicarlo)
  const saldoDisponible = parseFloat(saldoProp) || 0
  const [usarSaldo, setUsarSaldo] = useState(false)

  // Mercado Pago Point
  const [mpEstado, setMpEstado] = useState(null) // null | 'creando' | 'esperando' | 'procesando' | 'aprobado' | 'error' | 'cancelado'
  const [mpShowProblema, setMpShowProblema] = useState(false)
  const [mpIntentId, setMpIntentId] = useState(null)
  const [mpDeviceId, setMpDeviceId] = useState(null)
  const [mpError, setMpError] = useState('')
  const [mpPaymentId, setMpPaymentId] = useState(null)
  const [mpMontoIntent, setMpMontoIntent] = useState(0)
  const [mpUltimoPaymentType, setMpUltimoPaymentType] = useState(null)
  const [mpRefundingIdx, setMpRefundingIdx] = useState(null) // índice del pago que se está anulando
  const [mpCancelando, setMpCancelando] = useState(false) // cancelando QR instore
  const mpQrPosIdRef = useRef(null) // qr_pos_id activo (solo QR instore N950)
  const mpPollingRef = useRef(null)
  const mpTimeoutRef = useRef(null)
  const mpPollingBusyRef = useRef(false)
  const mpSSERef = useRef(null)
  const mpResolvedRef = useRef(false) // guard anti-duplicado SSE+polling
  const cobrarRootRef = useRef(null)

  // Cleanup polling + SSE + timeout on unmount
  useEffect(() => {
    return () => {
      if (mpPollingRef.current) clearInterval(mpPollingRef.current)
      if (mpTimeoutRef.current) clearTimeout(mpTimeoutRef.current)
      if (mpSSERef.current) { mpSSERef.current.close(); mpSSERef.current = null }
    }
  }, [])

  // Cleanup cuando el pago MP se resuelve (aprobado/cancelado/error)
  useEffect(() => {
    if (mpEstado === 'aprobado' || mpEstado === 'cancelado' || mpEstado === 'error') {
      if (mpPollingRef.current) { clearInterval(mpPollingRef.current); mpPollingRef.current = null }
      if (mpTimeoutRef.current) { clearTimeout(mpTimeoutRef.current); mpTimeoutRef.current = null }
      if (mpSSERef.current) { mpSSERef.current.close(); mpSSERef.current = null }
    }
  }, [mpEstado])

  useEffect(() => {
    async function cargarDesdeCache() {
      try {
        const cachedFcs = await getFormasCobroDB()
        if (cachedFcs.length > 0) {
          setFormasCobro(cachedFcs.filter(f => f.activo !== false && (f.nombre || '').toLowerCase() !== 'efectivo'))
        }
      } catch {}
    }
    cargarDesdeCache()
    cargarConfigDesdeAPI()
  }, [])

  async function cargarConfigDesdeAPI() {
    try {
      const [fcRes, promosRes] = await Promise.all([
        api.get('/api/formas-cobro'),
        api.get('/api/pos/promociones'),
      ])

      const fcs = (fcRes.data.formas_cobro || fcRes.data || [])
        .filter(f => f.activo !== false && (f.nombre || '').toLowerCase() !== 'efectivo')
      setFormasCobro(fcs)
      const fcsAll = (fcRes.data.formas_cobro || fcRes.data || []).filter(f => f.activo !== false)
      guardarFormasCobro(fcsAll).catch(err => console.error('Error caching formas cobro:', err.message))

      const promos = (promosRes.data.promociones || [])
        .filter(p => p.activa && p.tipo === 'forma_pago')
      setPromosPago(promos)
    } catch (err) {
      console.error('Error cargando config cobro:', err)
    }
  }

  // Resumen por tipo de pago
  const resumenPagos = pagos.reduce((acc, p) => {
    acc[p.tipo] = (acc[p.tipo] || 0) + p.monto
    return acc
  }, {})

  // Saldo preliminar para ajustar base de descuento por forma de pago
  const saldoPreliminar = (usarSaldo && saldoDisponible > 0) ? Math.min(saldoDisponible, total) : 0

  // Desglose del saldo por forma de pago original (ej: { Efectivo: 26100, Transferencia: 5000 })
  const saldoEfectivoOrigen = usarSaldo ? Math.min(parseFloat(saldoDesglose['Efectivo']) || 0, saldoPreliminar) : 0

  // Descuento separado por saldo proveniente de efectivo (se calcula primero, es fijo)
  const esVentaSoloGC = giftCardsEnVenta && giftCardsEnVenta.length > 0 && carrito.length === 0
  const promoEfectivoForSaldo = (!modoDelivery && !esVentaSoloGC) ? promosPago.find(p => (p.reglas?.forma_cobro_nombre || '').toLowerCase() === 'efectivo') : null
  const porcentajeSaldoEf = promoEfectivoForSaldo?.reglas?.valor || 0
  const descuentoSaldoEfectivo = saldoEfectivoOrigen > 0 && porcentajeSaldoEf > 0
    ? Math.round(saldoEfectivoOrigen * porcentajeSaldoEf / 100 * 100) / 100 : 0

  // totalParaDescuento: base para descuentos de efectivo nuevo = remanente después de saldo + desc saldo
  const totalParaDescuento = total - saldoPreliminar - descuentoSaldoEfectivo

  // Calcular descuentos por forma de pago (desactivado en modo delivery y ventas solo GC)
  const descuentosPorForma = (modoDelivery || esVentaSoloGC ? [] : promosPago).map(promo => {
    const reglas = promo.reglas || {}
    const nombreForma = reglas.forma_cobro_nombre
    const porcentaje = reglas.valor || 0
    const montoPagado = resumenPagos[nombreForma] || 0
    if (montoPagado <= 0 || porcentaje <= 0) return null
    // Si el efectivo cubre el total descontado → descuento completo sobre el remanente
    // Si no alcanza (pago mixto) → descuento solo sobre lo pagado en esta forma
    const totalDescontado = totalParaDescuento * (1 - porcentaje / 100)
    // Tolerancia de $100 para cubrir diferencias por redondeo a centenas
    const baseDescuento = (montoPagado >= totalDescontado || (totalDescontado - montoPagado) < 100) ? totalParaDescuento : montoPagado
    return {
      promoId: promo.id,
      promoNombre: promo.nombre,
      formaCobro: nombreForma,
      porcentaje,
      montoPagado,
      baseDescuento,
      descuento: Math.round(baseDescuento * porcentaje / 100 * 100) / 100,
    }
  }).filter(Boolean)

  // Total descuentos = descuento por forma de pago nuevo + descuento fijo por saldo de efectivo
  const totalDescuentoPagos = descuentosPorForma.reduce((s, d) => s + d.descuento, 0) + descuentoSaldoEfectivo

  // Saldo aplicado: min(saldoDisponible, total después de descuentos forma pago)
  const totalConDescFormaPago = Math.round((total - totalDescuentoPagos) * 100) / 100
  const saldoAplicado = (usarSaldo && saldoDisponible > 0) ? Math.min(saldoDisponible, totalConDescFormaPago) : 0
  const totalEfectivo = Math.round((totalConDescFormaPago - saldoAplicado) * 100) / 100

  // Promo de efectivo (para mostrar "resta en efectivo" con descuento)
  const promoEfectivo = promosPago.find(p => (p.reglas?.forma_cobro_nombre || '').toLowerCase() === 'efectivo')
  const porcentajeDescEfectivo = promoEfectivo?.reglas?.valor || 0

  const totalGiftCards = giftCardsAplicadas.reduce((s, g) => s + g.monto, 0)
  const totalEfectivoConGC = Math.round((totalEfectivo - totalGiftCards) * 100) / 100

  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0)
  const efectivoPagado = resumenPagos['Efectivo'] || 0
  // Cuando hay efectivo, redondear el total operativo a centenas (el cajero no maneja monedas)
  const totalOperativo = efectivoPagado > 0 ? redondearCentena(totalEfectivoConGC) : totalEfectivoConGC
  const restante = Math.max(0, totalOperativo - totalPagado)
  const montoSuficiente = totalOperativo <= 0 || totalPagado >= totalOperativo
  const vuelto = Math.max(0, totalPagado - totalOperativo)
  const pagosNoEfectivo = pagos.filter(p => p.tipo !== 'Efectivo').reduce((s, p) => s + p.monto, 0)
  // Usar totalOperativo (redondeado) cuando ya hay efectivo, para evitar residuos por redondeo
  const baseParaRestante = efectivoPagado > 0 ? totalOperativo : totalEfectivoConGC
  const restanteParaEfectivo = Math.max(0, baseParaRestante - pagosNoEfectivo - efectivoPagado)
  const restanteEfectivoRedondeado = restanteParaEfectivo > 0 ? redondearCentena(restanteParaEfectivo) : 0
  // Monto exacto en efectivo con descuento: si hay promo efectivo, calcular post-descuento redondeado
  const montoExactoEnEfectivo = (() => {
    if (!porcentajeDescEfectivo || porcentajeDescEfectivo <= 0 || modoDelivery || esVentaSoloGC) return null
    const restanteSinEfectivo = totalEfectivoConGC - pagosNoEfectivo
    if (restanteSinEfectivo <= 0) return 0
    const totalDescontado = totalParaDescuento * (1 - porcentajeDescEfectivo / 100)
    if (restanteSinEfectivo >= totalDescontado || (totalDescontado - restanteSinEfectivo) < 100) {
      const neto = totalDescontado - pagosNoEfectivo
      return neto > 0 ? redondearCentena(neto) : 0
    }
    const neto = restanteSinEfectivo / (1 + porcentajeDescEfectivo / 100)
    return neto > 0 ? redondearCentena(neto) : 0
  })()
  const montoExactoRestante = montoExactoEnEfectivo != null ? Math.max(0, montoExactoEnEfectivo - efectivoPagado) : null

  // Mercado Pago Point — funciones (Orders API: tarjeta + QR)
  // Handler compartido para procesar cambios de estado (usado por SSE y polling)
  async function handleMpOrderStatus(status, transactions, orderId, montoACobrar) {
    if (mpResolvedRef.current) return // ya procesado (evitar duplicado SSE+polling)

    if (status === 'processing') {
      setMpEstado('procesando')
    } else if (status === 'processed' || status === 'finished') {
      mpResolvedRef.current = true
      const payment = transactions?.payments?.find(p => p.status === 'approved' || p.status === 'processed')
      const payId = payment?.payment_id || payment?.id
      if (payId) {
        setMpPaymentId(payId)
        try {
          const { data: pd } = await api.get(`/api/mp-point/payment/${payId}`)
          const tipoPago = pd.payment_type_id === 'account_money' ? 'QR MP' : 'Posnet MP'
          setPagos(prev => [...prev, {
            tipo: tipoPago,
            monto: montoACobrar,
            detalle: {
              mp_payment_id: payId,
              mp_order_id: orderId,
              payment_type: pd.payment_type_id,
              card_last_four: pd.card?.last_four_digits || null,
              card_brand: pd.payment_method_id || null,
              operation_number: pd.operation_number || null,
            }
          }])
        } catch {
          setPagos(prev => [...prev, {
            tipo: 'Posnet MP',
            monto: montoACobrar,
            detalle: { mp_payment_id: payId, mp_order_id: orderId }
          }])
        }
        setMpEstado('aprobado')
      } else {
        const detail = transactions?.payments?.[0]?.status_detail || ''
        const motivo = detail.includes('insufficient') ? 'Fondos insuficientes'
          : detail.includes('expired') ? 'Tarjeta vencida'
          : detail.includes('disabled') ? 'Tarjeta deshabilitada'
          : detail.includes('blocked') ? 'Tarjeta bloqueada'
          : detail ? `Rechazado: ${detail}`
          : 'Pago rechazado'
        setMpEstado('cancelado')
        setMpError(motivo)
      }
    } else if (status === 'canceled' || status === 'expired' || status === 'reverted') {
      mpResolvedRef.current = true
      setMpEstado('cancelado')
      setMpError('Pago cancelado en el posnet')
      setMpShowProblema(false)
    } else if (status === 'rejected' || status === 'failed' || status === 'refunded') {
      mpResolvedRef.current = true
      const detail = transactions?.payments?.[0]?.status_detail || ''
      const motivo = detail.includes('insufficient') ? 'Fondos insuficientes'
        : detail.includes('expired') ? 'Tarjeta vencida'
        : detail.includes('disabled') ? 'Tarjeta deshabilitada'
        : detail.includes('blocked') ? 'Tarjeta bloqueada'
        : 'Pago rechazado'
      setMpEstado('cancelado')
      setMpError(motivo)
      setMpShowProblema(false)
    }
  }

  async function iniciarPagoMP(paymentType) {
    // No iniciar si ya hay un pago MP en curso
    if (mpEstado && mpEstado !== 'error' && mpEstado !== 'cancelado' && mpEstado !== 'aprobado') return
    const montoACobrar = restante
    if (montoACobrar <= 0) return

    setMpEstado('creando')
    setMpError('')
    setMpPaymentId(null)
    setMpUltimoPaymentType(paymentType)
    mpResolvedRef.current = false

    try {
      const terminalConfig = (() => { try { return JSON.parse(localStorage.getItem('pos_terminal_config') || '{}') } catch { return {} } })()
      const deviceId = terminalConfig.mp_device_id
      if (!deviceId) {
        setMpError('No hay posnet configurado. Configuralo en ajustes del terminal.')
        setMpEstado('error')
        return
      }
      setMpDeviceId(deviceId)

      // N950 + QR → usar QR instore (QR físico en mostrador)
      const esN950 = deviceId.includes('N950')
      const qrPosId = terminalConfig.mp_qr_pos_id
      if (esN950 && paymentType === 'qr') {
        if (!qrPosId) {
          setMpError('No hay caja QR vinculada al posnet. Reconfigurá el terminal o vinculá un QR desde el dashboard de MP.')
          setMpEstado('error')
          return
        }
        mpQrPosIdRef.current = qrPosId
        return iniciarPagoQRInstore(montoACobrar, qrPosId)
      }

      mpQrPosIdRef.current = null // No es QR instore
      const orderBody = {
        device_id: deviceId,
        amount: montoACobrar,
        external_reference: `pos-${Date.now()}`,
        description: 'Venta POS',
      }
      if (paymentType) orderBody.payment_type = paymentType

      const { data } = await api.post('/api/mp-point/order', orderBody)

      setMpIntentId(data.id) // order ID
      setMpMontoIntent(montoACobrar)
      setMpEstado('esperando')

      // Safety timeout: 3 minutos
      mpTimeoutRef.current = setTimeout(() => {
        if (mpPollingRef.current) { clearInterval(mpPollingRef.current); mpPollingRef.current = null }
        if (mpSSERef.current) { mpSSERef.current.close(); mpSSERef.current = null }
        mpTimeoutRef.current = null
        setMpEstado('error')
        setMpError('Tiempo agotado esperando respuesta del posnet. Verificá el estado del pago antes de reintentar.')
      }, 180000)

      // 1) SSE — canal principal (notificación instantánea via webhook de MP)
      try {
        const baseUrl = api.defaults.baseURL
        const token = localStorage.getItem('token')
        const sseUrl = `${baseUrl}/api/mp-point/order/${data.id}/events?token=${encodeURIComponent(token)}`
        const es = new EventSource(sseUrl)
        mpSSERef.current = es

        es.addEventListener('order_update', (evt) => {
          try {
            const { status, transactions } = JSON.parse(evt.data)
            handleMpOrderStatus(status, transactions, data.id, montoACobrar)
          } catch {}
        })

        es.onerror = () => {
          console.log('[MP SSE] Error de conexión, polling fallback activo')
        }
      } catch {
        console.log('[MP SSE] No se pudo conectar, usando solo polling')
      }

      // 2) Polling como fallback cada 5s (con guard anti-overlap)
      mpPollingRef.current = setInterval(async () => {
        if (mpPollingBusyRef.current || mpResolvedRef.current) return
        mpPollingBusyRef.current = true
        try {
          const { data: order } = await api.get(`/api/mp-point/order/${data.id}`)
          await handleMpOrderStatus(order.status, order.transactions, data.id, montoACobrar)
        } catch (err) {
          console.error('[MP Point] Error polling:', err.message)
        } finally {
          mpPollingBusyRef.current = false
        }
      }, 5000)
    } catch (err) {
      console.error('[MP Point] Error creando orden:', err)
      setMpError(err.response?.data?.error || err.response?.data?.errors?.[0]?.message || 'Error al enviar al posnet')
      setMpEstado('error')
    }
  }

  // QR Instore — para posnet N950 (QR físico en mostrador)
  async function iniciarPagoQRInstore(montoACobrar, qrPosId) {
    try {
      const extRef = `pos-qr-${Date.now()}`
      const { data } = await api.put('/api/mp-point/qr-order', {
        qr_pos_id: qrPosId,
        amount: montoACobrar,
        external_reference: extRef,
        description: 'Venta POS',
      })

      if (!data.ok) {
        setMpError(data.error || 'Error al crear orden QR')
        setMpEstado('error')
        return
      }

      setMpIntentId(extRef) // usamos external_reference como ID
      setMpMontoIntent(montoACobrar)
      setMpEstado('esperando')

      // Safety timeout: 3 minutos
      mpTimeoutRef.current = setTimeout(() => {
        if (mpPollingRef.current) { clearInterval(mpPollingRef.current); mpPollingRef.current = null }
        mpTimeoutRef.current = null
        // Cancelar orden QR
        api.delete(`/api/mp-point/qr-order/${qrPosId}`).catch(err => console.error('Error cancelling QR order:', err.message))
        setMpEstado('error')
        setMpError('Tiempo agotado esperando pago QR. Verificá el estado antes de reintentar.')
      }, 180000)

      // Polling cada 3s buscando el pago (QR instore no tiene SSE por ahora)
      mpPollingRef.current = setInterval(async () => {
        if (mpPollingBusyRef.current || mpResolvedRef.current) return
        mpPollingBusyRef.current = true
        try {
          const { data: result } = await api.get(`/api/mp-point/qr-order/${extRef}/status`)
          if (result.status === 'approved') {
            mpResolvedRef.current = true
            const payId = result.payment_id
            if (payId) {
              setMpPaymentId(payId)
              try {
                const { data: pd } = await api.get(`/api/mp-point/payment/${payId}`)
                const tipoPago = pd.payment_type_id === 'account_money' ? 'QR MP' : 'Posnet MP'
                setPagos(prev => [...prev, {
                  tipo: tipoPago,
                  monto: montoACobrar,
                  detalle: {
                    mp_payment_id: payId,
                    mp_merchant_order_id: result.merchant_order_id,
                    payment_type: pd.payment_type_id,
                    operation_number: pd.operation_number || null,
                  }
                }])
              } catch {
                setPagos(prev => [...prev, {
                  tipo: 'QR MP',
                  monto: montoACobrar,
                  detalle: { mp_payment_id: payId, mp_merchant_order_id: result.merchant_order_id }
                }])
              }
            } else {
              setPagos(prev => [...prev, { tipo: 'QR MP', monto: montoACobrar, detalle: {} }])
            }
            setMpEstado('aprobado')
          }
        } catch (err) {
          console.error('[MP QR] Error polling:', err.message)
        } finally {
          mpPollingBusyRef.current = false
        }
      }, 3000)
    } catch (err) {
      console.error('[MP QR] Error creando orden:', err)
      setMpError(err.response?.data?.error || 'Error al crear orden QR')
      setMpEstado('error')
    }
  }

  // Helper: dado un orderId y monto, intenta obtener el pago y agregarlo a pagos
  async function detectarPagoCompletado(orderId, monto) {
    try {
      const { data: order } = await api.get(`/api/mp-point/order/${orderId}`)
      if (order.status === 'processed' || order.status === 'finished') {
        const payment = order.transactions?.payments?.find(p => p.status === 'approved' || p.status === 'processed')
        const payId = payment?.payment_id || payment?.id
        if (payId) {
          setMpPaymentId(payId)
          try {
            const { data: pd } = await api.get(`/api/mp-point/payment/${payId}`)
            const tipoPago = pd.payment_type_id === 'account_money' ? 'QR MP' : 'Posnet MP'
            setPagos(prev => [...prev, {
              tipo: tipoPago,
              monto: monto,
              detalle: {
                mp_payment_id: payId,
                mp_order_id: orderId,
                payment_type: pd.payment_type_id,
                card_last_four: pd.card?.last_four_digits || null,
                card_brand: pd.payment_method_id || null,
              }
            }])
          } catch {
            setPagos(prev => [...prev, {
              tipo: 'Posnet MP',
              monto: monto,
              detalle: { mp_payment_id: payId, mp_order_id: orderId }
            }])
          }
          setMpEstado('aprobado')
          setMpIntentId(null)
          setMpError('')
          return true // pago detectado
        }
      }
    } catch {}
    return false
  }

  // "Tengo problema" — resolver cobro MP con problema
  function resolverProblemaMP(tipoProblema) {
    // Limpiar polling + SSE
    if (mpPollingRef.current) { clearInterval(mpPollingRef.current); mpPollingRef.current = null }
    if (mpTimeoutRef.current) { clearTimeout(mpTimeoutRef.current); mpTimeoutRef.current = null }
    if (mpSSERef.current) { mpSSERef.current.close(); mpSSERef.current = null }
    const monto = mpMontoIntent

    if (tipoProblema === 'cobro_sin_confirmar') {
      // Opción 1: El cobro se realizó en el posnet pero el sistema no lo detectó
      setPagos(prev => [...prev, {
        tipo: 'Posnet MP',
        monto,
        detalle: {
          mp_order_id: mpIntentId,
          mp_problema: 'cobro_sin_confirmar',
          mp_problema_desc: 'Cobro realizado en posnet pero no confirmado por el sistema',
        }
      }])
    } else if (tipoProblema === 'posnet_manual') {
      // Opción 2: No llegó al posnet, se cobra en posnet manual (fuera del sistema)
      setPagos(prev => [...prev, {
        tipo: 'Posnet MP',
        monto,
        detalle: {
          mp_order_id: mpIntentId,
          mp_problema: 'posnet_manual',
          mp_problema_desc: 'Cobrado en posnet manual (fuera del sistema)',
        }
      }])
    }

    setMpEstado('aprobado')
    setMpIntentId(null)
    setMpError('')
  }

  // Cancelar cobro QR Instore (N950) — libera la caja QR para que el cajero pueda cambiar de medio de pago
  async function cancelarQRInstore() {
    const qrPosId = mpQrPosIdRef.current
    if (!qrPosId) return
    setMpCancelando(true)
    try {
      await api.delete(`/api/mp-point/qr-order/${qrPosId}`)
    } catch (err) {
      console.error('[MP QR] Error cancelando orden:', err.message)
    }
    // Limpiar polling + timeout
    if (mpPollingRef.current) { clearInterval(mpPollingRef.current); mpPollingRef.current = null }
    if (mpTimeoutRef.current) { clearTimeout(mpTimeoutRef.current); mpTimeoutRef.current = null }
    mpQrPosIdRef.current = null
    setMpEstado(null)
    setMpIntentId(null)
    setMpMontoIntent(0)
    setMpError('')
    setMpCancelando(false)
    setMpShowProblema(false)
  }

  // Anular cobro MP (refund)
  async function anularPagoMP(pagoIdx) {
    const pago = pagos[pagoIdx]
    if (!pago?.detalle?.mp_order_id && !pago?.detalle?.mp_payment_id) return
    setMpRefundingIdx(pagoIdx)
    try {
      // Orders API refund si hay order_id, sino Payments API refund con payment_id (QR instore)
      const refundUrl = pago.detalle.mp_order_id
        ? `/api/mp-point/order/${pago.detalle.mp_order_id}/refund`
        : `/api/mp-point/payment/${pago.detalle.mp_payment_id}/refund`
      const { data } = await api.post(refundUrl)
      if (data.ok || data.id) {
        // Quitar el pago de la lista
        setPagos(prev => prev.filter((_, i) => i !== pagoIdx))
        // Reset estado MP para permitir nuevo cobro
        setMpEstado(null)
        setMpIntentId(null)
        setMpError('')
        setMpPaymentId(null)
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al anular el cobro'
      setMpError(msg)
    } finally {
      setMpRefundingIdx(null)
    }
  }

  function agregarEfectivo(monto) {
    if (!monto || monto <= 0) return
    setPagos(prev => [...prev, { tipo: 'Efectivo', monto, detalle: {} }])
    setMontoEfectivoInput('')
  }

  function handleNumpadKey(key) {
    if (key === 'C') {
      setMontoEfectivoInput('')
    } else if (key === 'backspace') {
      setMontoEfectivoInput(prev => prev.slice(0, -1))
    } else if (key === '00') {
      setMontoEfectivoInput(prev => prev + '00')
    } else {
      setMontoEfectivoInput(prev => prev + key)
    }
  }

  // Auto-focus el div root para que capture teclas después de cualquier cambio de estado
  useEffect(() => {
    const timer = setTimeout(() => {
      const active = document.activeElement
      const enInputInterno = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') && cobrarRootRef.current?.contains(active)
      if (!enInputInterno) {
        cobrarRootRef.current?.focus()
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [pagos, mpEstado, formaSeleccionada, giftCardsAplicadas, guardando])

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

  const submittingRef = useRef(false)

  const ventaTimeoutRef = useRef(null)

  async function confirmarVenta() {
    if (!montoSuficiente || submittingRef.current) return
    submittingRef.current = true
    setGuardando(true)
    setError('')

    // Safety timeout: si el request se cuelga, reactivar el botón después de 30s
    ventaTimeoutRef.current = setTimeout(() => {
      submittingRef.current = false
      setGuardando(false)
      setError('Tiempo agotado al guardar la venta. Verificá si se registró antes de reintentar.')
    }, 30000)

    // Modo soloPago: no necesita items ni venta, solo datos de pago
    if (soloPago) {
      const pagosPayload = [
        ...pagos.map(p => ({ tipo: p.tipo, monto: p.monto, detalle: p.detalle || null })),
      ]
      const descFormaPagoData = totalDescuentoPagos > 0 ? { total: totalDescuentoPagos, detalle: descuentosPorForma } : null
      onConfirmar({ pagos: pagosPayload, total: totalConDescFormaPago, monto_pagado: totalPagado, vuelto: vuelto > 0 ? vuelto : 0, descuento_forma_pago: descFormaPagoData })
      setGuardando(false)
      return
    }

    const items = carrito.map(i => ({
      id_articulo: i.articulo.id,
      codigo: i.articulo.codigo,
      nombre: i.articulo.nombre,
      precio_unitario: i.precioOverride != null ? i.precioOverride : calcularPrecioConDescuentosBase(i.articulo),
      cantidad: i.cantidad,
      iva_tasa: i.articulo.iva?.tasa || 21,
      rubro: i.articulo.rubro?.nombre || null,
      subRubro: i.articulo.subRubro?.nombre || null,
      ...(i.precioOverride != null && i.motivoCambioPrecio ? {
        cambio_precio: {
          precio_original: i.precioOriginalAntesCambio ?? calcularPrecioConDescuentosBase(i.articulo),
          precio_nuevo: i.precioOverride,
          motivo: i.motivoCambioPrecio,
        }
      } : {}),
    }))

    const promosParaGuardar = promosAplicadas.map(p => ({
      promoId: p.promoId,
      promoNombre: p.promoNombre,
      tipoPromo: p.tipoPromo,
      detalle: p.detalle,
      porcentajeDescuento: p.porcentajeDescuento,
      descuento: p.descuento,
      entidadNombre: p.entidadNombre,
      itemsAfectados: p.itemsAfectados,
      descuentoPorItem: p.descuentoPorItem,
    }))

    const totalOriginalSinSaldo = totalConDescFormaPago
    // Obtener caja_id de la config del terminal (localStorage)
    const terminalConfig = (() => { try { return JSON.parse(localStorage.getItem('pos_terminal_config') || '{}') } catch { return {} } })()
    const payload = {
      id_cliente_centum: cliente.id_centum,
      nombre_cliente: cliente.razon_social,
      condicion_iva: cliente.condicion_iva || 'CF',
      caja_id: terminalConfig.caja_id || null,
      items,
      promociones_aplicadas: promosParaGuardar.length > 0 ? promosParaGuardar : null,
      subtotal,
      descuento_total: descuentoTotal,
      descuento_forma_pago: totalDescuentoPagos > 0 ? {
        total: totalDescuentoPagos,
        detalle: [
          ...(descuentoSaldoEfectivo > 0 ? [{ formaCobro: 'Saldo Efectivo', porcentaje: porcentajeSaldoEf, baseDescuento: saldoEfectivoOrigen, descuento: descuentoSaldoEfectivo }] : []),
          ...descuentosPorForma,
        ],
      } : null,
      total: totalOperativo > 0 ? totalOperativo : totalConDescFormaPago,
      monto_pagado: totalPagado,
      vuelto: vuelto > 0 ? vuelto : 0,
      pagos: [
        ...pagos.map(p => ({ tipo: p.tipo, monto: p.monto, detalle: p.detalle || null })),
      ],
    }
    if (descuentoGrupoCliente > 0) {
      payload.descuento_grupo_cliente = descuentoGrupoCliente
      payload.grupo_descuento_nombre = grupoDescuentoNombre
    }
    if (saldoAplicado > 0) {
      payload.saldo_aplicado = saldoAplicado
      // Enviar desglose de forma de pago del saldo consumido
      if (saldoDesglose && Object.keys(saldoDesglose).length > 0) {
        const consumido = {}
        let restante = saldoAplicado
        // Distribuir el saldo aplicado proporcionalmente al desglose disponible
        const totalDesglose = Object.values(saldoDesglose).reduce((s, v) => s + Math.max(0, v), 0)
        if (totalDesglose > 0) {
          for (const [tipo, monto] of Object.entries(saldoDesglose)) {
            if (monto <= 0) continue
            const porcion = Math.min(Math.round(monto / totalDesglose * saldoAplicado * 100) / 100, restante)
            if (porcion > 0) {
              consumido[tipo] = porcion
              restante -= porcion
            }
          }
          // Ajustar redondeo
          if (restante > 0.01 && Object.keys(consumido).length > 0) {
            const pk = Object.keys(consumido)[0]
            consumido[pk] = Math.round((consumido[pk] + restante) * 100) / 100
          }
          payload.saldo_forma_pago_origen = consumido
        }
      }
    }
    if (pedidoPosId) payload.pedido_pos_id = pedidoPosId
    if (ticketUid) payload.ticket_uid = ticketUid
    if (canal && canal !== 'pos') payload.canal = canal
    if (idPedidoPlataforma) payload.id_pedido_plataforma = idPedidoPlataforma
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
      total: totalOperativo > 0 ? totalOperativo : totalConDescFormaPago,
      totalPagado,
      vuelto: vuelto > 0 ? vuelto : 0,
      descuentoGrupoCliente,
      grupoDescuentoNombre,
      grupoDescuentoPorcentaje,
      puntoVenta: terminalConfig.punto_venta_centum || null,
      gcAplicadaMonto: totalGiftCards > 0 ? totalGiftCards : 0,
    }

    try {
      const { data: ventaResp } = await api.post('/api/pos/ventas', payload)
      const numeroVenta = ventaResp?.venta?.numero_venta
      syncVentasPendientes().catch(err => console.error('Error syncing pending sales:', err.message))
      imprimirTicketPOS({ ...ticketData, esOffline: false, numeroVenta })
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
      if (ventaTimeoutRef.current) { clearTimeout(ventaTimeoutRef.current); ventaTimeoutRef.current = null }
      setGuardando(false)
      submittingRef.current = false
    }
  }

  // Atajos de teclado globales del modal de cobro
  function handleCobrarKeyDown(e) {
    const enInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'

    // Escape = Cancelar QR instore si hay uno activo, sino cerrar modal (bloqueado si hay cobro MP no-QR en curso)
    if (e.key === 'Escape' && !guardando) {
      e.preventDefault()
      if (mpIntentId && (mpEstado === 'esperando' || mpEstado === 'procesando' || mpEstado === 'creando')) {
        // Si es QR instore, Escape cancela el cobro QR (no cierra el modal)
        if (mpQrPosIdRef.current && !mpCancelando) {
          cancelarQRInstore()
        }
        return
      }
      onCerrar()
      return
    }
    // Enter = si hay monto en el input de efectivo → agregar, sino monto exacto
    if (e.key === 'Enter' && !enInput) {
      e.preventDefault()
      const montoNum = parseInt(montoEfectivoInput)
      if (montoNum > 0) {
        agregarEfectivo(montoNum)
      } else {
        // Monto exacto
        const montoEfectivo = montoExactoRestante != null && montoExactoRestante > 0
          ? montoExactoRestante
          : restanteEfectivoRedondeado
        if (montoEfectivo > 0) {
          agregarEfectivo(Math.ceil(montoEfectivo * 100) / 100)
        }
      }
      return
    }
    if (enInput) return

    // Teclas numéricas → alimentar input de efectivo
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      setMontoEfectivoInput(prev => prev + e.key)
      return
    }

    // Backspace = borrar último dígito del input, o borrar pagos si input vacío
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (montoEfectivoInput.length > 0) {
        setMontoEfectivoInput(prev => prev.slice(0, -1))
      } else {
        borrarPagos()
      }
      return
    }

    // Delete = borrar todo el input
    if (e.key === 'Delete') {
      e.preventDefault()
      setMontoEfectivoInput('')
      return
    }

    // F1 = Tarjeta (posnet MP) — solo si no hay pago MP activo (desactivado en delivery)
    if (e.key === 'F1' && !modoDelivery && (!mpEstado || mpEstado === 'error' || mpEstado === 'cancelado' || mpEstado === 'aprobado')) {
      e.preventDefault()
      if (mpEstado === 'error' || mpEstado === 'cancelado') { if (mpDeviceId) api.post(`/api/mp-point/devices/${mpDeviceId}/clear`).catch(err => console.error('Error clearing MP device:', err.message)); setMpEstado(null); setMpError(''); setMpIntentId(null); setMpPaymentId(null) }
      iniciarPagoMP('credit_card')
    }
    // F2 = QR (posnet MP) — solo si no hay pago MP activo (desactivado en delivery)
    if (e.key === 'F2' && !modoDelivery && (!mpEstado || mpEstado === 'error' || mpEstado === 'cancelado' || mpEstado === 'aprobado')) {
      e.preventDefault()
      if (mpEstado === 'error' || mpEstado === 'cancelado') { if (mpDeviceId) api.post(`/api/mp-point/devices/${mpDeviceId}/clear`).catch(err => console.error('Error clearing MP device:', err.message)); setMpEstado(null); setMpError(''); setMpIntentId(null); setMpPaymentId(null) }
      iniciarPagoMP('qr')
    }

    // F10-F12 = Formas de cobro (Transferencia, Payway, Rappi)
    const nombreForma = FKEY_FORMAS[e.key]
    if (nombreForma) {
      e.preventDefault()
      if (modoDelivery && !nombreForma.toLowerCase().includes('rappi') && !nombreForma.toLowerCase().includes('pedidosya')) return
      if (!modoDelivery && (nombreForma.toLowerCase().includes('rappi') || nombreForma.toLowerCase().includes('pedidosya'))) return
      const found = formasCobro.find(f => f.nombre.toLowerCase().includes(nombreForma.toLowerCase()) || nombreForma.toLowerCase().includes(f.nombre.toLowerCase()))
      if (found) {
        setFormaSeleccionada(found)
        setMontoFormaPago(restante > 0 ? restante.toFixed(2) : '')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-800 flex flex-col lg:flex-row outline-none" onKeyDown={handleCobrarKeyDown} tabIndex={-1} ref={cobrarRootRef} data-modal>

      {/* ====== IZQUIERDA: Efectivo (display grande + numpad compacto) ====== */}
      <div className="flex-1 p-5 flex flex-col min-w-0 relative">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest">Efectivo</h3>
          <button
            onClick={() => {
              if (mpIntentId && (mpEstado === 'esperando' || mpEstado === 'procesando' || mpEstado === 'creando')) return
              onCerrar()
            }}
            className={`transition-colors flex items-center gap-1.5 ${
              mpIntentId && (mpEstado === 'esperando' || mpEstado === 'procesando' || mpEstado === 'creando')
                ? 'text-white/10 cursor-not-allowed'
                : 'text-white/40 hover:text-white/80'
            }`}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="text-[9px] opacity-50">Esc</span>
          </button>
        </div>

        {/* Display del monto — protagonista */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <span className="text-white/30 text-sm font-medium mb-2">Monto en efectivo</span>
          <span className={`text-7xl font-black tracking-tight ${montoEfectivoInput ? 'text-white' : 'text-white/15'}`}>
            ${montoEfectivoInput ? formatMontoInput(parseInt(montoEfectivoInput)) : '0'}
          </span>
          {montoEfectivoInput && parseInt(montoEfectivoInput) > 0 && (
            <span className="text-violet-400 text-sm font-medium mt-2">
              Enter para agregar
            </span>
          )}
        </div>

        {/* Numpad compacto + acciones — anclado abajo */}
        <div className="w-64 mx-auto">
          {/* Monto exacto */}
          <button
            onClick={() => {
              // Si hay descuento por efectivo, cargar el monto post-descuento redondeado
              const montoEfectivo = montoExactoRestante != null && montoExactoRestante > 0
                ? montoExactoRestante
                : restanteEfectivoRedondeado
              if (montoEfectivo > 0) {
                agregarEfectivo(Math.ceil(montoEfectivo * 100) / 100)
              }
            }}
            disabled={restanteEfectivoRedondeado <= 0 && (montoExactoRestante == null || montoExactoRestante <= 0)}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-white/30 text-white font-bold text-sm py-2.5 rounded-xl mb-2 transition-colors active:scale-[0.98]"
          >
            {(() => {
              const monto = montoExactoRestante != null && montoExactoRestante > 0 ? montoExactoRestante : restanteEfectivoRedondeado
              return `Monto exacto${monto > 0 ? ` (${formatPrecio(monto)})` : ''}`
            })()}
          </button>

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-1.5">
            {['1','2','3','4','5','6','7','8','9','00','0','backspace'].map(key => (
              <button
                key={key}
                onClick={() => handleNumpadKey(key)}
                className={`rounded-lg font-bold text-lg py-3 transition-all duration-100 active:scale-95 select-none ${
                  key === 'backspace'
                    ? 'bg-amber-600/80 hover:bg-amber-500 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 active:bg-violet-600 text-white'
                }`}
              >
                {key === 'backspace' ? (
                  <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.374-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.21-.211.497-.33.795-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.795-.33z" />
                  </svg>
                ) : key}
              </button>
            ))}
          </div>

          {/* Agregar */}
          <button
            onClick={() => {
              const montoNum = parseInt(montoEfectivoInput)
              if (montoNum > 0) agregarEfectivo(montoNum)
            }}
            disabled={!montoEfectivoInput || parseInt(montoEfectivoInput) <= 0}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-white/30 text-white font-bold text-sm py-2.5 rounded-xl mt-2 transition-colors active:scale-[0.98]"
          >
            Agregar {montoEfectivoInput && parseInt(montoEfectivoInput) > 0 ? formatPrecio(parseInt(montoEfectivoInput)) : ''}
          </button>

          {/* Borrar / Deshacer */}
          <div className="flex gap-2 mt-2">
            {pagos.length > 0 && (
              <button
                onClick={borrarUltimoPago}
                className="flex-1 bg-slate-600 hover:bg-slate-500 text-white/80 font-medium text-xs py-2.5 rounded-xl transition-colors"
              >
                Deshacer
              </button>
            )}
            <button
              onClick={borrarPagos}
              className={`${pagos.length > 0 ? 'flex-1' : 'w-full'} bg-red-500/80 hover:bg-red-500 text-white font-medium text-xs py-2.5 rounded-xl transition-colors`}
            >
              Borrar todo
            </button>
          </div>
        </div>
      </div>

      {/* ====== CENTRO: Otros medios + detalle ====== */}
      <div className="w-72 p-5 flex flex-col gap-4 border-l border-white/10">
        {/* Formas de pago */}
        {formasCobro.length > 0 && (
          <div>
            <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Otros medios</h3>
            <div className="space-y-2">
              {formasCobro.filter(fc => {
                const esDeliveryPago = fc.nombre.toLowerCase().includes('rappi') || fc.nombre.toLowerCase().includes('pedidosya') || fc.nombre.toLowerCase().includes('pedidos')
                if (modoDelivery) return esDeliveryPago
                return !esDeliveryPago
              }).map((fc) => {
                const fkeyMatch = Object.entries(FKEY_FORMAS).find(([,name]) => fc.nombre.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(fc.nombre.toLowerCase()))
                return (
                <button
                  key={fc.id}
                  onClick={() => {
                    if (formaSeleccionada?.id === fc.id) {
                      setFormaSeleccionada(null)
                      setMontoFormaPago('')
                    } else {
                      setFormaSeleccionada(fc)
                      setMontoFormaPago(restante > 0 ? restante.toFixed(2) : '')
                    }
                  }}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
                    formaSeleccionada?.id === fc.id
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                      : 'bg-slate-700 hover:bg-slate-600 text-white'
                  }`}
                >
                  {fc.nombre} {fkeyMatch && <span className="text-[9px] opacity-50 ml-1">{fkeyMatch[0]}</span>}
                </button>
                )
              })}
            </div>

            {formaSeleccionada && (
              <div className="mt-3 bg-slate-700/50 rounded-xl p-3 space-y-2">
                <label className="text-white/50 text-xs">Monto en {formaSeleccionada.nombre}</label>
                <input
                  type="number"
                  value={montoFormaPago}
                  onChange={e => setMontoFormaPago(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && agregarFormaPago()}
                  onFocus={e => e.target.select()}
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

        {/* Saldo a favor del cliente */}
        {saldoDisponible > 0 && !modoDelivery && (
          <div>
            <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Saldo a favor</h3>
            <button
              onClick={() => setUsarSaldo(prev => !prev)}
              className={`w-full flex items-center justify-between rounded-xl px-4 py-3 font-semibold text-sm transition-all ${
                usarSaldo
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-slate-600 hover:bg-slate-500 text-white/70'
              }`}
            >
              <span>{usarSaldo ? 'Saldo aplicado' : 'Aplicar saldo'}</span>
              <span className="font-bold">{formatPrecio(usarSaldo ? saldoAplicado : saldoDisponible)}</span>
            </button>
          </div>
        )}

        {/* Gift Card (oculto en delivery) */}
        {!modoDelivery && <div>
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
        </div>}

        {/* Mercado Pago Posnet (oculto en delivery) */}
        {!modoDelivery && <div>
          <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Posnet MP</h3>
          {!mpEstado && (
            <div className="flex gap-2">
              <button
                onClick={() => iniciarPagoMP('credit_card')}
                disabled={montoSuficiente || restante <= 0}
                className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all bg-sky-600 hover:bg-sky-500 text-white disabled:bg-slate-600 disabled:text-white/30"
              >
                <span className="block text-xs opacity-70">Tarjeta <span className="text-[9px] opacity-60">F1</span></span>
                {formatPrecio(restante)}
              </button>
              <button
                onClick={() => iniciarPagoMP('qr')}
                disabled={montoSuficiente || restante <= 0}
                className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-600 disabled:text-white/30"
              >
                <span className="block text-xs opacity-70">QR <span className="text-[9px] opacity-60">F2</span></span>
                {formatPrecio(restante)}
              </button>
            </div>
          )}
          {mpEstado === 'creando' && (
            <div className="bg-sky-900/40 rounded-xl p-4 text-center">
              <div className="animate-spin w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sky-300 text-sm font-medium">Enviando al posnet...</p>
            </div>
          )}
          {(mpEstado === 'esperando' || mpEstado === 'procesando') && !mpShowProblema && (
            <div className="bg-sky-900/40 rounded-xl p-4 text-center">
              <div className="animate-pulse">
                <svg className="w-10 h-10 text-sky-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                </svg>
                <p className="text-sky-300 text-sm font-bold">{formatPrecio(mpMontoIntent)}</p>
                <p className="text-sky-300/70 text-xs mt-1">
                  {mpQrPosIdRef.current ? 'Esperando pago por QR...' : (mpEstado === 'esperando' ? 'Esperando pago en el posnet...' : 'Procesando pago...')}
                </p>
                {mpQrPosIdRef.current ? (
                  <button
                    onClick={cancelarQRInstore}
                    disabled={mpCancelando}
                    className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all bg-red-600 hover:bg-red-500 text-white disabled:bg-slate-600 disabled:text-white/40"
                  >
                    {mpCancelando ? 'Cancelando...' : 'Cancelar cobro QR (Esc)'}
                  </button>
                ) : (
                  <p className="text-sky-300/40 text-[10px] mt-1">Para cancelar, hacelo desde el posnet</p>
                )}
              </div>
              <button
                onClick={() => setMpShowProblema(true)}
                className="mt-3 text-amber-400 hover:text-amber-300 text-xs font-medium underline"
              >
                Tengo problema
              </button>
            </div>
          )}
          {(mpEstado === 'esperando' || mpEstado === 'procesando') && mpShowProblema && (
            <div className="bg-amber-900/30 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-amber-300 text-sm font-bold">Seleccioná el problema:</p>
                <button
                  onClick={() => setMpShowProblema(false)}
                  className="text-white/40 hover:text-white/70 text-xs"
                >
                  Volver
                </button>
              </div>
              <button
                onClick={() => { setMpShowProblema(false); resolverProblemaMP('cobro_sin_confirmar') }}
                className="w-full text-left bg-amber-800/40 hover:bg-amber-800/60 rounded-lg p-3 transition-colors"
              >
                <p className="text-amber-200 text-sm font-semibold">El cobro se realizó en el posnet</p>
                <p className="text-amber-300/60 text-xs mt-0.5">Pero el sistema no lo detectó. Guardar la venta igual.</p>
              </button>
              <button
                onClick={() => { setMpShowProblema(false); resolverProblemaMP('posnet_manual') }}
                className="w-full text-left bg-amber-800/40 hover:bg-amber-800/60 rounded-lg p-3 transition-colors"
              >
                <p className="text-amber-200 text-sm font-semibold">No aparece en el posnet</p>
                <p className="text-amber-300/60 text-xs mt-0.5">Lo cobro en posnet manual (fuera del sistema).</p>
              </button>
            </div>
          )}
          {mpEstado === 'aprobado' && (
            <div className="bg-emerald-900/40 rounded-xl p-4 text-center">
              <svg className="w-8 h-8 text-emerald-400 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <p className="text-emerald-300 text-sm font-bold">Pago aprobado - {formatPrecio(mpMontoIntent)}</p>
            </div>
          )}
          {(mpEstado === 'error' || mpEstado === 'cancelado') && (
            <div className="space-y-2">
              <div className="bg-red-900/30 rounded-xl p-2 text-center">
                <p className="text-red-400 text-xs">{mpError || 'Error en el pago'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { if (mpDeviceId) { api.post(`/api/mp-point/devices/${mpDeviceId}/clear`).catch(err => console.error('Error clearing MP device:', err.message)) }; setMpEstado(null); setMpError(''); setMpIntentId(null); setMpPaymentId(null); iniciarPagoMP('credit_card') }}
                  disabled={montoSuficiente || restante <= 0}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all bg-sky-600 hover:bg-sky-500 text-white disabled:bg-slate-600 disabled:text-white/30"
                >
                  <span className="block text-xs opacity-70">Tarjeta <span className="text-[9px] opacity-60">F1</span></span>
                  {formatPrecio(restante)}
                </button>
                <button
                  onClick={() => { if (mpDeviceId) { api.post(`/api/mp-point/devices/${mpDeviceId}/clear`).catch(err => console.error('Error clearing MP device:', err.message)) }; setMpEstado(null); setMpError(''); setMpIntentId(null); setMpPaymentId(null); iniciarPagoMP('qr') }}
                  disabled={montoSuficiente || restante <= 0}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-600 disabled:text-white/30"
                >
                  <span className="block text-xs opacity-70">QR <span className="text-[9px] opacity-60">F2</span></span>
                  {formatPrecio(restante)}
                </button>
              </div>
            </div>
          )}
        </div>}

        {/* Detalle de pagos cargados */}
        {pagos.length > 0 && (
          <div className="flex-1">
            <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest mb-3">Detalle</h3>
            <div className="bg-slate-700/40 rounded-xl p-3 space-y-1.5 max-h-60 overflow-y-auto">
              {/* Efectivo */}
              {resumenPagos['Efectivo'] && (
                <div className="flex justify-between items-center">
                  <span className="text-white/60 text-sm">Efectivo</span>
                  <span className="text-white font-semibold text-sm">{formatPrecio(resumenPagos['Efectivo'])}</span>
                </div>
              )}
              {/* Otros medios de pago — pagos MP se muestran individual con botón anular */}
              {Object.entries(resumenPagos)
                .filter(([tipo]) => tipo !== 'Efectivo' && !pagos.some(p => p.tipo === tipo && p.detalle?.mp_order_id))
                .map(([tipo, monto]) => (
                  <div key={tipo} className="flex justify-between items-center">
                    <span className="text-white/60 text-sm">{tipo}</span>
                    <span className="text-white font-semibold text-sm">{formatPrecio(monto)}</span>
                  </div>
                ))}
              {/* Pagos MP individuales con opción de anular */}
              {pagos.map((p, idx) => p.detalle?.mp_order_id ? (
                <div key={`mp-${idx}`} className="flex justify-between items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/60 text-sm">{p.tipo}</span>
                    {p.detalle?.card_last_four && <span className="text-white/30 text-xs">****{p.detalle.card_last_four}</span>}
                    {p.detalle?.mp_problema && <span className="text-amber-400 text-[9px]">(problema)</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">{formatPrecio(p.monto)}</span>
                    {!p.detalle?.mp_problema && (
                      <button
                        onClick={() => anularPagoMP(idx)}
                        disabled={mpRefundingIdx === idx}
                        className="text-red-400 hover:text-red-300 text-[10px] font-medium underline disabled:opacity-50 disabled:no-underline"
                      >
                        {mpRefundingIdx === idx ? 'Anulando...' : 'Anular'}
                      </button>
                    )}
                  </div>
                </div>
              ) : null)}
              {/* Descuentos por forma de pago */}
              {(descuentosPorForma.length > 0 || descuentoSaldoEfectivo > 0) && (
                <div className="border-t border-white/10 pt-1.5 mt-1.5 space-y-1">
                  {descuentoSaldoEfectivo > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-cyan-400 text-xs">Desc. Saldo efvo. {porcentajeSaldoEf}% s/ {formatPrecio(saldoEfectivoOrigen)}</span>
                      <span className="text-cyan-400 font-semibold text-xs">-{formatPrecio(descuentoSaldoEfectivo)}</span>
                    </div>
                  )}
                  {descuentosPorForma.map(d => (
                    <div key={d.promoId} className="flex justify-between items-center">
                      <span className="text-cyan-400 text-xs">Desc. {d.formaCobro} {d.porcentaje}% s/ {formatPrecio(d.baseDescuento)}</span>
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
      <div className="w-80 p-5 flex flex-col border-l border-white/10 overflow-y-auto">
        {/* Bloque total */}
        <div className={`flex-1 rounded-2xl flex flex-col items-center justify-center p-6 transition-colors duration-300 ${
          montoSuficiente ? 'bg-emerald-500' : 'bg-slate-700'
        }`}>
          <span className={`text-xs font-semibold uppercase tracking-widest mb-1 ${
            montoSuficiente ? 'text-emerald-900/60' : 'text-white/40'
          }`}>
            Total a cobrar
          </span>
          {(descuentoGrupoCliente > 0 || totalDescuentoPagos > 0 || saldoAplicado > 0 || totalGiftCards > 0) ? (
            <>
              <span className="text-2xl font-bold text-white/40 line-through mb-1">
                {formatPrecio(descuentoGrupoCliente > 0 ? total + descuentoGrupoCliente : total)}
              </span>
              <div className="flex flex-col items-center mb-2">
                {descuentoGrupoCliente > 0 && (
                  <span className="text-violet-300 text-xs font-medium">
                    {grupoDescuentoNombre}: -{formatPrecio(descuentoGrupoCliente)}
                  </span>
                )}
                {descuentoSaldoEfectivo > 0 && (
                  <span className="text-cyan-300 text-xs font-medium">
                    Desc. Saldo efvo. {porcentajeSaldoEf}% s/ {formatPrecio(saldoEfectivoOrigen)}: -{formatPrecio(descuentoSaldoEfectivo)}
                  </span>
                )}
                {descuentosPorForma.map(d => (
                  <span key={d.promoId} className="text-cyan-300 text-xs font-medium">
                    Desc. {d.formaCobro} {d.porcentaje}% s/ {formatPrecio(d.baseDescuento)}: -{formatPrecio(d.descuento)}
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
                {totalOperativo <= 0 ? '$0' : formatPrecio(totalOperativo)}
              </span>
            </>
          ) : (
            <span className="text-5xl font-black text-white mb-8">
              {formatPrecio(totalOperativo)}
            </span>
          )}

          {restante > 0 ? (
            <div className="bg-white/10 rounded-xl px-8 py-4 text-center backdrop-blur-sm">
              <span className={`text-xs font-medium block mb-1 ${montoSuficiente ? 'text-emerald-900/60' : 'text-white/50'}`}>
                Resta cobrar
              </span>
              <span className="text-white text-3xl font-bold">{formatPrecio(restante)}</span>
              {montoExactoRestante != null && montoExactoRestante > 0 && montoExactoRestante < restante && (
                <div className="mt-2 pt-2 border-t border-white/15">
                  <span className="text-cyan-300 text-xs font-medium block mb-0.5">
                    En efectivo ({porcentajeDescEfectivo}% desc.)
                  </span>
                  <span className="text-cyan-200 text-2xl font-bold">
                    {formatPrecio(montoExactoRestante)}
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
          {guardando ? 'Guardando...' : montoSuficiente ? (<>{totalEfectivoConGC <= 0 ? 'Confirmar (cubierto)' : 'Confirmar venta'} <span className="text-[9px] opacity-50">Enter</span></>) : 'Ingresá el pago'}
        </button>
      </div>

    </div>
  )
}

export default ModalCobrar
