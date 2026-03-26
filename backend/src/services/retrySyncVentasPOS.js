// Retry automático de ventas POS que no se enviaron a Centum
// Busca ventas con centum_sync=false y centum_error=null (nunca se intentaron o se cortó el proceso)
// Si falla, graba el error y no las vuelve a tocar

const supabase = require('../config/supabase')
const { crearVentaPOS, crearNotaCreditoPOS, crearNotaCreditoConceptoPOS } = require('./centumVentasPOS')

const OPERADOR_MOVIL_USER_PRUEBA = process.env.CENTUM_OPERADOR_PRUEBA_USER || 'api123'

async function retrySyncVentasPOS() {
  // Buscar ventas pendientes: centum_sync != true Y sin error (nunca se intentó o se cortó)
  const { data: ventasPendientes, error } = await supabase
    .from('ventas_pos')
    .select('*')
    .or('centum_sync.is.null,centum_sync.eq.false')
    .is('centum_error', null)
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[RetrySyncVentasPOS] Error al consultar ventas pendientes:', error.message)
    return { intentadas: 0, exitosas: 0, fallidas: 0 }
  }

  if (!ventasPendientes || ventasPendientes.length === 0) {
    return { intentadas: 0, exitosas: 0, fallidas: 0 }
  }

  console.log(`[RetrySyncVentasPOS] ${ventasPendientes.length} ventas pendientes de enviar a Centum`)

  let exitosas = 0
  let fallidas = 0

  for (const venta of ventasPendientes) {
    try {
      // Obtener config de caja/sucursal
      let puntoVenta, sucursalFisicaId, centumOperadorEmpresa, centumOperadorPrueba

      if (venta.caja_id) {
        const { data: cajaData } = await supabase
          .from('cajas')
          .select('punto_venta_centum, sucursal_id, sucursales(centum_sucursal_id, centum_operador_empresa, centum_operador_prueba)')
          .eq('id', venta.caja_id)
          .single()

        puntoVenta = cajaData?.punto_venta_centum
        sucursalFisicaId = cajaData?.sucursales?.centum_sucursal_id
        centumOperadorEmpresa = cajaData?.sucursales?.centum_operador_empresa
        centumOperadorPrueba = cajaData?.sucursales?.centum_operador_prueba
      }

      if (!puntoVenta || !sucursalFisicaId) {
        const falta = !venta.caja_id
          ? 'La venta no tiene caja asignada'
          : !puntoVenta
            ? 'La caja no tiene punto de venta Centum configurado'
            : 'La sucursal no tiene ID de sucursal física Centum configurado'
        throw new Error(`Sin config Centum: ${falta}. Configure el punto de venta en la caja y reenvíe manualmente.`)
      }

      const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
      const pagos = Array.isArray(venta.pagos) ? venta.pagos : []

      // Obtener condición IVA del cliente
      let condicionIva = 'CF'
      if (venta.id_cliente_centum) {
        const { data: cliente } = await supabase
          .from('clientes')
          .select('condicion_iva')
          .eq('id_centum', venta.id_cliente_centum)
          .single()
        condicionIva = cliente?.condicion_iva || 'CF'
      }

      const esFacturaA = condicionIva === 'RI' || condicionIva === 'MT'
      const tiposEfectivo = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
      const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
      const idDivisionEmpresa = esFacturaA ? 3 : (soloEfectivo ? 2 : 3)

      const operadorMovilUser = idDivisionEmpresa === 2
        ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
        : (centumOperadorEmpresa || null)

      let resultado

      if (venta.tipo === 'nota_credito') {
        const itemsPositivos = items.map(it => ({
          ...it,
          precio_unitario: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
          precioUnitario: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
          precio: Math.abs(parseFloat(it.precio_unitario || it.precioUnitario || it.precio || 0)),
          cantidad: Math.abs(parseFloat(it.cantidad || 1)),
        }))

        let comprobanteOriginal = null
        let idClienteNC = venta.id_cliente_centum || 2
        let condicionIvaNC = condicionIva
        let idDivisionNC = idDivisionEmpresa
        let operadorNC = operadorMovilUser

        if (venta.venta_origen_id) {
          const { data: ventaOrigen } = await supabase
            .from('ventas_pos')
            .select('centum_comprobante, id_cliente_centum, pagos')
            .eq('id', venta.venta_origen_id)
            .single()
          comprobanteOriginal = ventaOrigen?.centum_comprobante || null

          if (ventaOrigen) {
            idClienteNC = ventaOrigen.id_cliente_centum || 2
            let condIvaOrig = 'CF'
            if (ventaOrigen.id_cliente_centum) {
              const { data: cliOrig } = await supabase
                .from('clientes').select('condicion_iva')
                .eq('id_centum', ventaOrigen.id_cliente_centum).single()
              condIvaOrig = cliOrig?.condicion_iva || 'CF'
            }
            condicionIvaNC = condIvaOrig
            const esFacturaAOrig = condIvaOrig === 'RI' || condIvaOrig === 'MT'
            const pagosOrig = Array.isArray(ventaOrigen.pagos) ? ventaOrigen.pagos : []
            const soloEfectivoOrig = pagosOrig.length === 0 || pagosOrig.every(p => tiposEfectivo.includes((p.tipo || '').toLowerCase()))
            idDivisionNC = esFacturaAOrig ? 3 : (soloEfectivoOrig ? 2 : 3)
            operadorNC = idDivisionNC === 2
              ? (centumOperadorPrueba || OPERADOR_MOVIL_USER_PRUEBA)
              : (centumOperadorEmpresa || null)
          }
        }

        const esNCConcepto = items.some(it => it.precio_cobrado != null && it.precio_correcto != null)

        if (esNCConcepto) {
          const descripcionItems = items.map(it =>
            `${it.cantidad || 1}x ${it.nombre}: $${it.precio_cobrado} → $${it.precio_correcto}`
          ).join(', ')
          resultado = await crearNotaCreditoConceptoPOS({
            idCliente: idClienteNC,
            sucursalFisicaId,
            idDivisionEmpresa: idDivisionNC,
            puntoVenta,
            total: Math.abs(parseFloat(venta.total) || 0),
            condicionIva: condicionIvaNC,
            descripcion: `DIFERENCIA EN PRECIO DE GONDOLA - ${descripcionItems}`,
            operadorMovilUser: operadorNC,
            comprobanteOriginal,
          })
        } else {
          resultado = await crearNotaCreditoPOS({
            idCliente: idClienteNC,
            sucursalFisicaId,
            idDivisionEmpresa: idDivisionNC,
            puntoVenta,
            items: itemsPositivos,
            total: Math.abs(parseFloat(venta.total) || 0),
            condicionIva: condicionIvaNC,
            operadorMovilUser: operadorNC,
            comprobanteOriginal,
          })
        }
      } else {
        resultado = await crearVentaPOS({
          idCliente: venta.id_cliente_centum || 2,
          sucursalFisicaId,
          idDivisionEmpresa,
          puntoVenta,
          items,
          pagos,
          total: parseFloat(venta.total) || 0,
          condicionIva,
          operadorMovilUser,
        })
      }

      // Éxito: actualizar venta
      const numDoc = resultado.NumeroDocumento
      const comprobante = numDoc
        ? `${numDoc.LetraDocumento || ''} PV${numDoc.PuntoVenta}-${numDoc.Numero}`
        : null

      await supabase
        .from('ventas_pos')
        .update({
          id_venta_centum: resultado.IdVenta || null,
          centum_comprobante: comprobante,
          centum_sync: true,
          centum_error: null,
        })
        .eq('id', venta.id)

      console.log(`[RetrySyncVentasPOS] ✓ Venta ${venta.id} (POS #${venta.numero_venta}) enviada: ${comprobante}`)
      exitosas++

    } catch (err) {
      // Error: grabar el error para que no se reintente
      console.error(`[RetrySyncVentasPOS] ✗ Venta ${venta.id} (POS #${venta.numero_venta}): ${err.message}`)
      try {
        await supabase
          .from('ventas_pos')
          .update({ centum_error: err.message })
          .eq('id', venta.id)
      } catch (_) {}
      fallidas++
    }
  }

  return { intentadas: ventasPendientes.length, exitosas, fallidas }
}

module.exports = { retrySyncVentasPOS }
