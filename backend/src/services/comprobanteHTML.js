// Genera el HTML del comprobante A4 (misma estructura que el frontend)
const QRCode = require('qrcode')
const logger = require('../config/logger')

const formatPrecio = (precio) => {
  if (precio == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const escapeHtml = (s) => {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const MEDIOS_LABELS = {
  efectivo: 'Efectivo',
  debito: 'Tarjeta Dbto',
  credito: 'Tarjeta Crto',
  qr: 'QR / Transferencia',
  cuenta_corriente: 'Cta. Corriente',
}

async function generarComprobanteHTML(venta, caeData) {
  // Generar QR de AFIP como data URL
  let qrDataUrl = ''
  try {
    qrDataUrl = await QRCode.toDataURL('https://www.afip.gob.ar/landing/default.asp', { width: 100, margin: 1 })
  } catch (e) {
    logger.error('Error generando QR:', e)
  }
  const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
  const pagos = venta.pagos || []
  const descFormaPago = (() => {
    const raw = venta.descuento_forma_pago
    if (!raw) return null
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  })()
  const descFormaDetalle = Array.isArray(descFormaPago?.detalle) ? descFormaPago.detalle : []
  const esNC = venta.tipo === 'nota_credito'
  const esFacturaA = caeData?.esFacturaA || false
  const cliente = caeData?.cliente || null

  const letraDoc = esFacturaA ? 'A' : 'B'
  const tipoDoc = esNC ? 'Nota de Crédito' : 'Factura'
  const codigoDoc = esNC ? (esFacturaA ? '03' : '08') : (esFacturaA ? '01' : '06')

  const numero = venta.centum_comprobante
    ? venta.centum_comprobante.replace(/^[A-Z]\s*/, '')
    : `INT-${String(venta.numero_venta || '0').padStart(8, '0')}`

  const fechaObj = new Date(venta.created_at)
  const fechaStr = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  const totalNum = parseFloat(venta.total) || 0
  const netoTotal = Math.round(totalNum / 1.21 * 100) / 100
  const ivaTotal = Math.round((totalNum - netoTotal) * 100) / 100

  let filasItems = ''
  items.forEach(item => {
    const precioConIva = parseFloat(item.precio_unitario || item.precioFinal || item.precio || 0)
    const cant = parseFloat(item.cantidad || 1)
    const ivaTasa = parseFloat(item.iva_tasa || item.ivaTasa || 21)
    const precioMostrar = esFacturaA ? Math.round(precioConIva / (1 + ivaTasa / 100) * 100) / 100 : precioConIva
    const sub = Math.round(precioMostrar * cant * 100) / 100
    filasItems += `<tr>
      <td class="td">${escapeHtml(item.codigo || '')}</td>
      <td class="td" style="text-align:center">${cant.toFixed(2)}</td>
      <td class="td">${escapeHtml(item.nombre)}</td>
      <td class="td" style="text-align:right">${formatPrecio(precioMostrar)}</td>
      <td class="td" style="text-align:right">${formatPrecio(sub)}</td>
    </tr>`
  })

  const gcMonto = parseFloat(venta.gc_aplicada_monto) || 0
  const formasPago = pagos.map(p => MEDIOS_LABELS[p.medio || p.tipo] || p.medio || p.tipo || '').filter(Boolean)
  if (gcMonto > 0) formasPago.push('Gift Card')
  const formaPago = formasPago.join(', ') || 'Cuenta Corriente'

  const cae = caeData?.cae || null
  const caeVto = caeData?.cae_vencimiento || null
  const caeVtoStr = caeVto ? new Date(caeVto).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''

  const COND_IVA_LABELS = { RI: 'Responsable Inscripto', MT: 'Monotributista', CF: 'Consumidor Final', EX: 'Exento' }
  const condIvaCliente = cliente?.condicion_iva ? (COND_IVA_LABELS[cliente.condicion_iva] || cliente.condicion_iva) : 'Consumidor Final'
  const direccionCliente = cliente ? [cliente.direccion, cliente.localidad, cliente.codigo_postal].filter(Boolean).join(' - ') : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 12mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; }
  .page { border: 1px solid #000; padding: 0; }
  .hdr { display: flex; border-bottom: 2px solid #000; }
  .hdr-left { flex: 1; padding: 10px 14px; border-right: 1px solid #000; }
  .hdr-letra { width: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 1px solid #000; padding: 6px; }
  .hdr-letra .letra { font-size: 28px; font-weight: bold; border: 2px solid #000; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; }
  .hdr-letra .cod { font-size: 9px; margin-top: 2px; }
  .hdr-right { flex: 1; padding: 10px 14px; }
  .empresa-nombre { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
  .empresa-dir { font-size: 10px; color: #333; }
  .empresa-contacto { font-size: 10px; color: #555; }
  .doc-tipo { font-size: 16px; font-weight: bold; text-align: right; }
  .doc-num { font-size: 12px; margin-top: 4px; }
  .doc-fecha { font-size: 11px; margin-top: 2px; }
  .fiscal-data { font-size: 10px; margin-top: 8px; color: #333; line-height: 1.5; }
  .fiscal-data span { display: inline-block; width: 130px; }
  .cliente { border-bottom: 1px solid #000; padding: 8px 14px; font-size: 11px; line-height: 1.6; }
  .cliente-row { display: flex; gap: 20px; }
  .cliente-row .lbl { color: #555; min-width: 110px; }
  .items { padding: 0; }
  .items table { width: 100%; border-collapse: collapse; }
  .items th { background: #eee; padding: 5px 8px; text-align: left; font-size: 10px; font-weight: 600; border-bottom: 1px solid #000; border-top: 1px solid #000; }
  .td { padding: 4px 8px; border-bottom: 1px solid #ddd; font-size: 11px; }
  .footer-zone { display: flex; border-top: 2px solid #000; }
  .footer-left { flex: 1; padding: 10px 14px; border-right: 1px solid #000; }
  .footer-right { width: 240px; padding: 10px 14px; }
  .firma-line { border-bottom: 1px solid #000; margin-bottom: 2px; padding-bottom: 14px; font-size: 10px; }
  .totales-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
  .totales-row.total { font-size: 14px; font-weight: bold; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
  .cae-zone { border-top: 1px solid #000; padding: 8px 14px; display: flex; justify-content: space-between; align-items: flex-start; }
  .cae-left { font-size: 10px; }
  .cae-right { text-align: right; font-size: 10px; }
  .transparencia { font-size: 9px; color: #555; margin-top: 6px; }
</style></head><body>
<div class="page">
  <div class="hdr">
    <div class="hdr-left">
      <div class="empresa-nombre">Comercial Padano SRL</div>
      <div class="empresa-dir">Brasil 313 Barrio Belgrano (2000)</div>
      <div class="empresa-contacto">+54 9 3412 28-6109 &nbsp; administracion@padano.com.ar &nbsp; www.padano.com.ar</div>
    </div>
    <div class="hdr-letra">
      <div class="letra">${letraDoc}</div>
      <div class="cod">${codigoDoc}</div>
    </div>
    <div class="hdr-right">
      <div class="doc-tipo">${tipoDoc}</div>
      <div class="doc-num">Numero: ${escapeHtml(numero)}</div>
      <div class="doc-fecha">Fecha: ${escapeHtml(fechaStr)}</div>
      <div class="fiscal-data">
        <div><span>IVA:</span> Responsable Inscripto</div>
        <div><span>CUIT:</span> 30-71885278-8</div>
        <div><span>INGRESOS BRUTOS:</span> 0213900654</div>
        <div><span>INICIO ACTIVIDADES:</span> 01/09/2019</div>
      </div>
    </div>
  </div>
  <div class="cliente">
    <div class="cliente-row">
      <div><span class="lbl">Razon Social:</span> <strong>${escapeHtml(venta.nombre_cliente || 'CONSUMIDOR FINAL')}</strong></div>
      ${cliente?.cuit ? `<div><span class="lbl">CUIT:</span> ${escapeHtml(cliente.cuit)}</div>` : ''}
    </div>
    ${direccionCliente ? `<div class="cliente-row">
      <div><span class="lbl">Direccion:</span> ${escapeHtml(direccionCliente)}</div>
      <div><span class="lbl">Condicion IVA:</span> ${escapeHtml(condIvaCliente)}</div>
    </div>` : `<div class="cliente-row">
      <div><span class="lbl">Condicion IVA:</span> ${escapeHtml(condIvaCliente)}</div>
    </div>`}
    <div class="cliente-row">
      <div><span class="lbl">Condicion Venta:</span> CONTADO</div>
      <div><span class="lbl">Moneda:</span> Peso Argentino</div>
    </div>
  </div>
  <div class="items">
    <table>
      <thead>
        <tr>
          <th style="width:70px">Codigo</th>
          <th style="width:50px;text-align:center">Cant.</th>
          <th>Descripcion</th>
          <th style="width:90px;text-align:right">Unit.</th>
          <th style="width:100px;text-align:right">Importe</th>
        </tr>
      </thead>
      <tbody>${filasItems}</tbody>
    </table>
  </div>
  <div class="footer-zone">
    <div class="footer-left">
      <div style="font-size:10px;color:#555;margin-bottom:10px">RECIBI CONFORME</div>
      <div class="firma-line">Firma:____________________</div>
      <div class="firma-line">Aclaracion:____________________</div>
      <div class="firma-line">DNI:____________________</div>
      <div class="firma-line">Forma de Pago: ${escapeHtml(formaPago)}</div>
    </div>
    <div class="footer-right">
      ${esFacturaA
        ? `<div class="totales-row"><span>Subtotal:</span><span>${formatPrecio(netoTotal)}</span></div>
           ${parseFloat(venta.descuento_total) > 0 ? `<div class="totales-row"><span>Dto:</span><span>-${formatPrecio(venta.descuento_total)}</span></div>` : ''}
           ${descFormaDetalle.map(d => `<div class="totales-row"><span>Desc. ${escapeHtml(d.formaCobro)} ${d.porcentaje}%${d.baseDescuento ? ` s/ ${formatPrecio(d.baseDescuento)}` : ''}:</span><span>-${formatPrecio(d.descuento)}</span></div>`).join('')}
           <div class="totales-row"><span>Subtotal:</span><span>${formatPrecio(netoTotal)}</span></div>
           <div class="totales-row"><span>Imp. Internos:</span><span>$0,00</span></div>
           <div class="totales-row"><span>Reg. Especiales:</span><span>$0,00</span></div>
           <div class="totales-row"><span>IVA:</span><span>${formatPrecio(ivaTotal)}</span></div>
           <div class="totales-row total"><span>TOTAL:</span><span>${formatPrecio(totalNum)}</span></div>
           ${pagos.map(p => `<div class="totales-row" style="font-size:10px"><span>${escapeHtml(MEDIOS_LABELS[p.medio || p.tipo] || p.medio || p.tipo || '')}</span><span>${formatPrecio(p.monto)}</span></div>`).join('')}
           ${gcMonto > 0 ? `<div class="totales-row" style="font-size:10px"><span>Gift Card</span><span>${formatPrecio(gcMonto)}</span></div>` : ''}`
        : `<div class="totales-row"><span>Subtotal:</span><span>${formatPrecio(venta.subtotal || venta.total)}</span></div>
           ${parseFloat(venta.descuento_total) > 0 ? `<div class="totales-row"><span>Dto:</span><span>-${formatPrecio(venta.descuento_total)}</span></div>` : ''}
           ${descFormaDetalle.map(d => `<div class="totales-row"><span>Desc. ${escapeHtml(d.formaCobro)} ${d.porcentaje}%${d.baseDescuento ? ` s/ ${formatPrecio(d.baseDescuento)}` : ''}:</span><span>-${formatPrecio(d.descuento)}</span></div>`).join('')}
           <div class="totales-row"><span>Imp. Internos:</span><span>$0,00</span></div>
           <div class="totales-row"><span>Reg. Especiales:</span><span>$0,00</span></div>
           <div class="totales-row total"><span>TOTAL:</span><span>${formatPrecio(totalNum)}</span></div>
           ${pagos.map(p => `<div class="totales-row" style="font-size:10px"><span>${escapeHtml(MEDIOS_LABELS[p.medio || p.tipo] || p.medio || p.tipo || '')}</span><span>${formatPrecio(p.monto)}</span></div>`).join('')}
           ${gcMonto > 0 ? `<div class="totales-row" style="font-size:10px"><span>Gift Card</span><span>${formatPrecio(gcMonto)}</span></div>` : ''}`
      }
    </div>
  </div>
  <div class="cae-zone">
    <div class="cae-left">
      ${cae
        ? `<div><strong>CAE:</strong> ${escapeHtml(cae)}</div>
           <div style="margin-top:2px">${escapeHtml(caeVtoStr)}</div>`
        : `<div style="margin-bottom:6px">Gracias por su compra</div>`
      }
      ${!esFacturaA ? `<div class="transparencia">
        <div><strong>Regimen de Transparencia Fiscal al Consumidor (Ley 27.743)</strong></div>
        <div>IVA Contenido: ${formatPrecio(netoTotal * 0.21)}</div>
        <div>Otros Impuestos Nacionales Indirectos</div>
      </div>` : ''}
    </div>
    <div class="cae-right" style="text-align:center">
      ${qrDataUrl ? `<img src="${qrDataUrl}" style="width:80px;height:80px;margin-bottom:4px" alt="QR AFIP">` : ''}
      ${cae
        ? `<div style="font-size:9px;color:#555">Comprobante fiscal autorizado por AFIP</div>`
        : venta.centum_comprobante
          ? `<div>Comprobante: ${escapeHtml(venta.centum_comprobante)}</div><div style="font-size:9px;color:#999;margin-top:2px">CAE no disponible</div>`
          : `<div style="color:#999">Comprobante interno - sin CAE</div>`
      }
    </div>
  </div>
</div>
</body></html>`
}

module.exports = { generarComprobanteHTML }
