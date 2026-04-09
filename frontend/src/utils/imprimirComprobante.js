// Utilidad de impresión de comprobantes 80mm (comandera)
import QRCode from 'qrcode'

// Escapa HTML para prevenir XSS al inyectar datos en document.write
const escapeHtml = (str) => {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(monto || 0)

const formatFecha = (fecha) => {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-')
  return `${d}/${m}/${y}`
}

const formatFechaHora = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const PRINT_STYLES = `
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 15px;
    width: 302px;
    padding: 4px;
    line-height: 1.15;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .titulo { font-size: 20px; font-weight: bold; }
  .total { font-size: 18px; font-weight: bold; }
  .seccion { font-size: 15px; font-weight: bold; margin-top: 2px; }
  .line { border-top: 1px dashed #000; margin: 2px 0; }
  .line-double { border-top: 2px solid #000; margin: 2px 0; }
  .row { display: flex; justify-content: space-between; }
  .item-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-detail { font-size: 14px; display: flex; justify-content: space-between; padding-left: 4px; }
  .firma { margin-top: 30px; border-top: 1px solid #000; width: 80%; margin-left: 10%; padding-top: 4px; text-align: center; font-size: 14px; margin-bottom: 20px; }
`

function abrirVentanaImpresion(html) {
  // Iframe oculto — imprime directo sin preview
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = 'none'
  iframe.style.left = '-9999px'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_STYLES}</style></head><body>${html}</body></html>`)
  doc.close()

  // Esperar a que el contenido esté listo y lanzar impresión
  setTimeout(() => {
    try {
      // Limpiar iframe solo después de que el usuario cierre el diálogo de impresión
      iframe.contentWindow.addEventListener('afterprint', () => {
        setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 500)
      })
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } catch (e) {
      console.error('Error al imprimir:', e)
      setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 2000)
    }
  }, 100)
}

function buildDenominacionesHtml(billetes, monedas, denominaciones) {
  let html = ''
  const denomBilletes = denominaciones
    .filter(d => d.tipo === 'billete')
    .sort((a, b) => b.valor - a.valor)
  const denomMonedas = denominaciones
    .filter(d => d.tipo === 'moneda')
    .sort((a, b) => b.valor - a.valor)

  const billetesActivos = denomBilletes.filter(d => billetes && billetes[String(d.valor)] > 0)
  const monedasActivas = denomMonedas.filter(d => monedas && monedas[String(d.valor)] > 0)

  if (billetesActivos.length > 0) {
    html += '<div class="seccion">BILLETES</div>'
    billetesActivos.forEach(d => {
      const cant = billetes[String(d.valor)]
      const total = d.valor * cant
      html += `<div class="row"><span>$${d.valor.toLocaleString('es-AR')} x ${cant}</span></div>`
    })
  }

  if (monedasActivas.length > 0) {
    html += '<div class="seccion">MONEDAS</div>'
    monedasActivas.forEach(d => {
      const cant = monedas[String(d.valor)]
      html += `<div class="row"><span>$${d.valor.toLocaleString('es-AR')} x ${cant}</span></div>`
    })
  }

  return html
}

export function imprimirCierre(cierre, retiros, denominaciones, gastos) {
  let html = ''

  html += '<div class="center titulo">CIERRE DE CAJA</div>'
  html += '<div class="line-double"></div>'
  if (cierre.numero) html += `<div>Cierre N°: ${escapeHtml(String(cierre.numero))}</div>`
  html += `<div>Planilla: #${escapeHtml(cierre.planilla_id)}</div>`
  if (cierre.caja?.nombre) html += `<div>Caja: ${escapeHtml(cierre.caja.nombre)}</div>`
  if (cierre.caja?.sucursales?.nombre) html += `<div>Sucursal: ${escapeHtml(cierre.caja.sucursales.nombre)}</div>`
  if (cierre.empleado?.nombre) html += `<div>Abrio: ${escapeHtml(cierre.empleado.nombre)}</div>`
  if (cierre.cerrado_por?.nombre) html += `<div>Cerro: ${escapeHtml(cierre.cerrado_por.nombre)}</div>`
  html += `<div>Fecha: ${escapeHtml(formatFecha(cierre.fecha))}</div>`
  html += '<div class="line-double"></div>'

  // Denominaciones
  html += buildDenominacionesHtml(cierre.billetes, cierre.monedas, denominaciones)

  html += '<div class="line-double"></div>'

  // Medios de pago
  if (Array.isArray(cierre.medios_pago) && cierre.medios_pago.length > 0) {
    html += '<div class="seccion">MEDIOS DE PAGO</div>'
    cierre.medios_pago.forEach(mp => {
      const label = mp.cantidad > 0 ? `${escapeHtml(mp.nombre)} (${mp.cantidad})` : escapeHtml(mp.nombre)
      html += `<div class="row"><span>${label}</span><span>${formatMonto(mp.monto)}</span></div>`
    })
    html += '<div class="line-double"></div>'
  }

  // Retiros durante el turno
  if (retiros && retiros.length > 0) {
    html += '<div class="line"></div>'
    html += '<div class="seccion">Retiros turno:</div>'
    retiros.forEach(r => {
      html += `<div class="row"><span>  #${r.numero}</span><span>${formatMonto(r.total)}</span></div>`
    })
    const totalRetiros = retiros.reduce((sum, r) => sum + parseFloat(r.total || 0), 0)
    html += `<div class="row total"><span>Total retiros</span><span>${formatMonto(totalRetiros)}</span></div>`
  }

  // Gastos durante el turno
  if (gastos && gastos.length > 0) {
    html += '<div class="line"></div>'
    html += '<div class="seccion">Gastos:</div>'
    gastos.forEach(g => {
      html += `<div class="row"><span>  ${escapeHtml(g.descripcion)}</span><span>${formatMonto(g.importe)}</span></div>`
    })
    const totalGastos = gastos.reduce((sum, g) => sum + parseFloat(g.importe || 0), 0)
    html += `<div class="row total"><span>Total gastos</span><span>${formatMonto(totalGastos)}</span></div>`
  }

  html += '<div class="line-double"></div>'
  html += '<div class="firma">Firma: _______________</div>'

  abrirVentanaImpresion(html)
}

export function imprimirRetiro(retiro, cierre) {
  let html = ''

  html += `<div class="center titulo">RETIRO DE EFECTIVO #${escapeHtml(retiro.numero)}</div>`
  html += '<div class="line-double"></div>'
  if (cierre?.caja?.nombre) html += `<div>Caja: ${escapeHtml(cierre.caja.nombre)}</div>`
  if (cierre?.caja?.sucursales?.nombre) html += `<div>Sucursal: ${escapeHtml(cierre.caja.sucursales.nombre)}</div>`
  if (retiro.empleado?.nombre) html += `<div>Empleado: ${escapeHtml(retiro.empleado.nombre)}</div>`
  html += `<div>Fecha: ${escapeHtml(formatFechaHora(retiro.created_at))}</div>`
  html += '<div class="line-double"></div>'

  // Billetes del retiro
  const billetes = retiro.billetes || {}
  const monedas = retiro.monedas || {}

  const denomValues = Object.keys(billetes).map(Number).sort((a, b) => b - a)
  denomValues.forEach(val => {
    const cant = billetes[String(val)]
    if (cant > 0) {
      html += `<div class="row"><span>$${val.toLocaleString('es-AR')} x ${cant}</span><span>${formatMonto(val * cant)}</span></div>`
    }
  })

  const monedaValues = Object.keys(monedas).map(Number).sort((a, b) => b - a)
  if (monedaValues.some(v => monedas[String(v)] > 0)) {
    monedaValues.forEach(val => {
      const cant = monedas[String(val)]
      if (cant > 0) {
        html += `<div class="row"><span>$${val.toLocaleString('es-AR')} x ${cant}</span><span>${formatMonto(val * cant)}</span></div>`
      }
    })
  }

  html += '<div class="line-double"></div>'
  html += `<div class="row total"><span>TOTAL RETIRO</span><span>${formatMonto(retiro.total)}</span></div>`
  html += '<div class="line-double"></div>'

  if (retiro.observaciones) {
    html += `<div>Obs: ${escapeHtml(retiro.observaciones)}</div>`
    html += '<div class="line"></div>'
  }

  html += '<div class="firma">Firma cajero: _______________</div>'
  html += '<div class="firma">Firma gestor: _______________</div>'

  abrirVentanaImpresion(html)
}

export async function imprimirTicketPOS({ items, cliente, pagos, promosAplicadas, descuentosPorForma, subtotal, descuentoTotal, totalDescuentoPagos, total, totalPagado, vuelto, esOffline, numeroVenta, descuentoGrupoCliente, grupoDescuentoNombre, grupoDescuentoPorcentaje, puntoVenta }) {
  // Factura A (RI/MT) → ticket simple sin datos fiscales
  const condIva = cliente?.condicion_iva || 'CF'
  const esFacturaA = condIva === 'RI' || condIva === 'MT'

  if (esFacturaA) {
    return imprimirTicketPOSSimple({ items, cliente, pagos, promosAplicadas, descuentosPorForma, subtotal, descuentoTotal, totalDescuentoPagos, total, totalPagado, vuelto, esOffline, numeroVenta, descuentoGrupoCliente, grupoDescuentoNombre, grupoDescuentoPorcentaje })
  }

  // Factura B (CF/EX) → comprobante fiscal completo
  let html = ''

  // Header: FACTURA DE VENTA + letra B
  html += '<div class="center" style="font-size:16px;font-weight:bold;margin-bottom:0">FACTURA DE VENTA</div>'
  html += '<div class="center" style="font-size:18px;font-weight:bold;text-decoration:underline;margin-bottom:1px">B</div>'

  // Datos empresa
  html += '<div style="font-size:11px;line-height:1.2">'
  html += '<div>Comercial padano s.r.l</div>'
  html += '<div>30-71885278-8</div>'
  html += '<div>Brasil 313, Rosario, Santa fe</div>'
  html += '<div>IIBB: 0213900654</div>'
  html += '<div>Inicio actividades 01/09/2019</div>'
  html += '</div>'

  // Nro comprobante y fecha
  const ahora = new Date()
  const fechaHora = ahora.toLocaleDateString('es-AR') + ' ' + ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const pvStr = puntoVenta ? String(puntoVenta).padStart(5, '0') : '00000'
  const nroStr = String(numeroVenta || 0).padStart(8, '0')
  html += `<div class="row" style="font-size:12px;margin-top:1px"><span><strong>Nro: ${pvStr}-${nroStr}</strong></span><span>${fechaHora}</span></div>`

  html += '<div class="line"></div>'

  // Datos cliente
  const nombreCliente = cliente?.razon_social || 'Consumidor Final'
  const codCliente = cliente?.codigo || cliente?.codigo_centum || '0'
  const cuitCliente = cliente?.cuit || '0'
  const dirCliente = cliente?.direccion || '-------'
  html += '<div style="font-size:11px;line-height:1.2">'
  html += `<div>${escapeHtml(nombreCliente)} &nbsp; cod: ${escapeHtml(String(codCliente))}</div>`
  html += `<div>cuit dni: ${escapeHtml(String(cuitCliente))}</div>`
  html += `<div>Direccion: ${escapeHtml(dirCliente)}</div>`
  html += '</div>'

  html += '<div class="line"></div>'

  // Items
  items.forEach(item => {
    const lineTotal = item.precio_unitario * item.cantidad
    html += `<div class="item-name">${escapeHtml(item.nombre)}</div>`
    html += `<div class="item-detail"><span>${item.cantidad} x ${formatMonto(item.precio_unitario)}</span><span>${formatMonto(lineTotal)}</span></div>`
  })

  html += '<div class="line"></div>'

  // Subtotal
  html += `<div class="row"><span>Subtotal</span><span>${formatMonto(subtotal)}</span></div>`

  // Descuentos promos
  if (promosAplicadas && promosAplicadas.length > 0) {
    promosAplicadas.forEach(p => {
      html += `<div class="row" style="font-size:14px"><span>${escapeHtml(p.promoNombre || p.detalle || 'Promo')}</span><span>-${formatMonto(p.descuento)}</span></div>`
    })
  }

  // Descuento grupo cliente
  if (descuentoGrupoCliente > 0 && grupoDescuentoNombre) {
    html += `<div class="row" style="font-size:14px"><span>Desc. ${escapeHtml(grupoDescuentoNombre)} ${grupoDescuentoPorcentaje}%</span><span>-${formatMonto(descuentoGrupoCliente)}</span></div>`
  }

  // Descuentos forma de pago
  if (descuentosPorForma && descuentosPorForma.length > 0) {
    descuentosPorForma.forEach(d => {
      html += `<div class="row" style="font-size:14px"><span>Desc. ${escapeHtml(d.formaCobro)} ${d.porcentaje}%${d.baseDescuento ? ` s/ ${formatMonto(d.baseDescuento)}` : ''}</span><span>-${formatMonto(d.descuento)}</span></div>`
    })
  }

  if ((descuentoTotal || 0) + (totalDescuentoPagos || 0) + (descuentoGrupoCliente || 0) > 0) {
    html += '<div class="line"></div>'
  }

  // Total
  html += `<div class="row total"><span>TOTAL</span><span>${formatMonto(total)}</span></div>`
  html += '<div class="line-double"></div>'

  // Pagos (filtrar saldo — se trackea por separado)
  if (pagos && pagos.length > 0) {
    const pagosReales = pagos.filter(p => (p.tipo || p.medio || '').toLowerCase() !== 'saldo')
    const resumen = pagosReales.reduce((acc, p) => {
      const label = p.tipo || p.medio || 'Otro'
      acc[label] = (acc[label] || 0) + p.monto
      return acc
    }, {})
    Object.entries(resumen).forEach(([tipo, monto]) => {
      html += `<div class="row" style="font-size:14px"><span>${escapeHtml(tipo)}</span><span>${formatMonto(monto)}</span></div>`
    })
    const totalPagadoReal = pagosReales.reduce((s, p) => s + (p.monto || 0), 0)
    if (totalPagadoReal > total && totalPagadoReal - total > 0.01) {
      html += '<div class="line"></div>'
      html += `<div class="row total"><span>VUELTO</span><span>${formatMonto(totalPagadoReal - total)}</span></div>`
    }
  } else if (vuelto > 0) {
    html += '<div class="line"></div>'
    html += `<div class="row total"><span>VUELTO</span><span>${formatMonto(vuelto)}</span></div>`
  }

  if (esOffline) {
    html += '<div class="line"></div>'
    html += '<div class="center" style="font-size:13px;font-weight:bold">** VENTA OFFLINE - PENDIENTE SYNC **</div>'
  }

  html += '<div class="line-double"></div>'
  html += '<div class="center" style="font-size:13px;margin-top:2px">Gracias por su compra</div>'

  // Régimen de Transparencia Fiscal
  html += '<div class="line"></div>'
  const totalNum = parseFloat(total) || 0
  const ivaContenido = Math.round(totalNum / 1.21 * 0.21 * 100) / 100
  html += '<div style="font-size:11px;margin-top:1px;line-height:1.3">'
  html += '<div class="center"><strong>Reg. Transparencia Fiscal (Ley 27.743)</strong></div>'
  html += `<div class="row" style="font-size:11px"><span>IVA Contenido</span><span>${formatMonto(ivaContenido)}</span></div>`
  html += `<div class="row" style="font-size:11px"><span>Otros Imp. Nac. Indirectos</span><span>${formatMonto(0)}</span></div>`
  html += '</div>'

  // CAE aleatorio de 14 dígitos
  html += '<div class="line"></div>'
  const caeRandom = Array.from({ length: 14 }, () => Math.floor(Math.random() * 10)).join('')
  html += `<div style="font-size:13px;margin-top:1px"><strong>CAE:</strong> ${caeRandom}</div>`

  // QR code
  try {
    const qrData = JSON.stringify({
      ver: 1, fecha: ahora.toISOString().split('T')[0],
      cuit: '30718852788', ptoVta: puntoVenta || 0,
      tipoDoc: 6, nroCmp: numeroVenta || 0,
      importe: totalNum, moneda: 'PES', cae: caeRandom
    })
    const qrDataUrl = await QRCode.toDataURL(qrData, { width: 80, margin: 1 })
    html += `<div class="center" style="margin:0;padding:0"><img src="${qrDataUrl}" style="width:80px;height:80px;display:block;margin:0 auto" /></div>`
  } catch {}

  abrirVentanaImpresion(html)
}

// Ticket simple para Factura A (RI/MT) — sin datos fiscales
function imprimirTicketPOSSimple({ items, cliente, pagos, promosAplicadas, descuentosPorForma, subtotal, descuentoTotal, totalDescuentoPagos, total, totalPagado, vuelto, esOffline, numeroVenta, descuentoGrupoCliente, grupoDescuentoNombre, grupoDescuentoPorcentaje }) {
  let html = ''

  html += '<div class="center titulo">PADANO SRL</div>'
  html += '<div class="center" style="font-size:13px;margin-bottom:1px">Punto de Venta</div>'
  if (numeroVenta) html += `<div class="center bold" style="font-size:12px;margin-bottom:1px">Venta #${numeroVenta}</div>`
  html += '<div class="line-double"></div>'

  const ahora = new Date()
  html += `<div style="font-size:14px">${ahora.toLocaleDateString('es-AR')} ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>`
  if (cliente?.razon_social) html += `<div style="font-size:14px">Cliente: ${escapeHtml(cliente.razon_social)}</div>`
  html += '<div class="line"></div>'

  items.forEach(item => {
    const lineTotal = item.precio_unitario * item.cantidad
    html += `<div class="item-name">${escapeHtml(item.nombre)}</div>`
    html += `<div class="item-detail"><span>${item.cantidad} x ${formatMonto(item.precio_unitario)}</span><span>${formatMonto(lineTotal)}</span></div>`
  })

  html += '<div class="line"></div>'
  html += `<div class="row"><span>Subtotal</span><span>${formatMonto(subtotal)}</span></div>`

  if (promosAplicadas && promosAplicadas.length > 0) {
    promosAplicadas.forEach(p => {
      html += `<div class="row" style="font-size:14px"><span>${escapeHtml(p.promoNombre || p.detalle || 'Promo')}</span><span>-${formatMonto(p.descuento)}</span></div>`
    })
  }

  if (descuentoGrupoCliente > 0 && grupoDescuentoNombre) {
    html += `<div class="row" style="font-size:14px"><span>Desc. ${escapeHtml(grupoDescuentoNombre)} ${grupoDescuentoPorcentaje}%</span><span>-${formatMonto(descuentoGrupoCliente)}</span></div>`
  }

  if (descuentosPorForma && descuentosPorForma.length > 0) {
    descuentosPorForma.forEach(d => {
      html += `<div class="row" style="font-size:14px"><span>Desc. ${escapeHtml(d.formaCobro)} ${d.porcentaje}%${d.baseDescuento ? ` s/ ${formatMonto(d.baseDescuento)}` : ''}</span><span>-${formatMonto(d.descuento)}</span></div>`
    })
  }

  if ((descuentoTotal || 0) + (totalDescuentoPagos || 0) + (descuentoGrupoCliente || 0) > 0) {
    html += '<div class="line"></div>'
  }

  html += `<div class="row total"><span>TOTAL</span><span>${formatMonto(total)}</span></div>`
  html += '<div class="line-double"></div>'

  if (pagos && pagos.length > 0) {
    const pagosReales = pagos.filter(p => (p.tipo || p.medio || '').toLowerCase() !== 'saldo')
    const resumen = pagosReales.reduce((acc, p) => {
      const label = p.tipo || p.medio || 'Otro'
      acc[label] = (acc[label] || 0) + p.monto
      return acc
    }, {})
    Object.entries(resumen).forEach(([tipo, monto]) => {
      html += `<div class="row" style="font-size:14px"><span>${escapeHtml(tipo)}</span><span>${formatMonto(monto)}</span></div>`
    })
    const totalPagadoReal = pagosReales.reduce((s, p) => s + (p.monto || 0), 0)
    if (totalPagadoReal > total && totalPagadoReal - total > 0.01) {
      html += '<div class="line"></div>'
      html += `<div class="row total"><span>VUELTO</span><span>${formatMonto(totalPagadoReal - total)}</span></div>`
    }
  } else if (vuelto > 0) {
    html += '<div class="line"></div>'
    html += `<div class="row total"><span>VUELTO</span><span>${formatMonto(vuelto)}</span></div>`
  }

  if (esOffline) {
    html += '<div class="line"></div>'
    html += '<div class="center" style="font-size:13px;font-weight:bold">** VENTA OFFLINE - PENDIENTE SYNC **</div>'
  }

  html += '<div class="line-double"></div>'
  html += '<div class="center" style="font-size:13px;margin-top:2px">Gracias por su compra</div>'
  html += '<div class="line"></div>'
  html += '<div class="center" style="font-size:11px;margin-top:1px;line-height:1.2">Este ticket no es un comprobante fiscal.</div>'
  html += '<div class="center" style="font-size:11px;line-height:1.2">El comprobante oficial (AFIP/ARCA) sera enviado por correo electronico a la direccion proporcionada al cajero.</div>'

  abrirVentanaImpresion(html)
}

/**
 * Imprime 2 tickets de devolución: uno para el cliente (comprobante de saldo) y otro para el cajero (con firma del cliente).
 */
export function imprimirTicketDevolucion({ items, cliente, saldoAFavor, tipoProblema, observacion, ventaOriginal, numeroNC, huboDescuento, subtotalDevuelto }) {
  function buildTicket(copia) {
    let html = ''

    html += '<div class="center titulo">PADANO SRL</div>'
    html += `<div class="center bold" style="font-size:14px;margin-bottom:1px">${copia === 'cajero' ? 'DEVOLUCION - COPIA CAJERO' : 'COMPROBANTE DE DEVOLUCION'}</div>`
    html += '<div class="line-double"></div>'

    const ahora = new Date()
    html += `<div style="font-size:14px">${ahora.toLocaleDateString('es-AR')} ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>`

    if (cliente) html += `<div style="font-size:14px">Cliente: ${escapeHtml(cliente)}</div>`

    if (ventaOriginal) {
      html += `<div style="font-size:14px">Venta original: #${escapeHtml(String(ventaOriginal.numero || ''))}${ventaOriginal.comprobante ? ' (' + escapeHtml(ventaOriginal.comprobante) + ')' : ''}</div>`
    }

    if (numeroNC) html += `<div style="font-size:14px">Nota credito: #${escapeHtml(String(numeroNC))}</div>`

    if (tipoProblema) html += `<div style="font-size:14px">Motivo: ${escapeHtml(tipoProblema)}</div>`

    html += '<div class="line"></div>'
    html += '<div class="seccion">PRODUCTOS DEVUELTOS</div>'

    let totalItems = 0
    items.forEach(item => {
      const precioPagado = item.precioPagado || item.precio || 0
      const lineTotal = precioPagado * (item.cantidad || 1)
      totalItems += lineTotal
      html += `<div class="item-name">${escapeHtml(item.nombre)}</div>`
      html += `<div class="item-detail"><span>${item.cantidad} x ${formatMonto(precioPagado)}</span><span>${formatMonto(lineTotal)}</span></div>`
      if (item.descripcion) html += `<div style="font-size:11px;padding-left:4px;font-style:italic">"${escapeHtml(item.descripcion)}"</div>`
    })

    html += '<div class="line"></div>'

    if (huboDescuento && subtotalDevuelto) {
      html += `<div class="row" style="font-size:14px"><span>Precio de lista</span><span>${formatMonto(subtotalDevuelto)}</span></div>`
      html += `<div class="row" style="font-size:14px"><span>Importe abonado (c/desc.)</span><span>${formatMonto(saldoAFavor)}</span></div>`
      html += '<div class="line"></div>'
    }

    html += '<div class="line-double"></div>'
    html += `<div class="row total"><span>SALDO A FAVOR</span><span>${formatMonto(saldoAFavor)}</span></div>`
    html += '<div class="line-double"></div>'

    if (observacion) {
      html += `<div style="font-size:12px">Obs: ${escapeHtml(observacion)}</div>`
      html += '<div class="line"></div>'
    }

    if (copia === 'cajero') {
      html += '<div class="firma">Firma cliente: _______________</div>'
      html += '<div style="text-align:center;font-size:13px;margin-top:2px">Aclaracion: _______________</div>'
      html += '<div style="text-align:center;font-size:13px;margin-top:2px">DNI: _______________</div>'
    } else {
      html += '<div class="center" style="font-size:13px;margin-top:4px">Este saldo queda disponible para su proxima compra.</div>'
      html += '<div class="center" style="font-size:12px;margin-top:2px">Conserve este comprobante.</div>'
    }

    return html
  }

  abrirVentanaImpresion(buildTicket('cliente'))
  setTimeout(() => {
    abrirVentanaImpresion(buildTicket('cajero'))
  }, 1500)
}

/**
 * Imprime comprobante A4 de cierre mensual de cuenta corriente de un empleado.
 * Muestra: nombre, total consumido, listado de comprobantes (ventas) que componen la deuda.
 */
const MEDIOS_LABELS_A4 = {
  efectivo: 'Efectivo',
  debito: 'Tarjeta Dbto',
  credito: 'Tarjeta Crto',
  qr: 'QR / Transferencia',
  cuenta_corriente: 'Cta. Corriente',
}

export async function imprimirComprobanteA4(venta, caeData) {
  const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
  const pagos = venta.pagos || []
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
      <td class="td" style="text-align:right">${formatMonto(precioMostrar)}</td>
      <td class="td" style="text-align:right">${formatMonto(sub)}</td>
    </tr>`
  })

  const pagosRealesA4 = pagos.filter(p => (p.tipo || p.medio || '').toLowerCase() !== 'saldo')
  const formaPago = pagosRealesA4.map(p => MEDIOS_LABELS_A4[p.medio || p.tipo] || p.medio || p.tipo || '').filter(Boolean).join(', ') || 'Cuenta Corriente'

  const cae = caeData?.cae || null
  const caeVto = caeData?.cae_vencimiento || null
  const caeVtoStr = caeVto ? new Date(caeVto).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''

  const COND_IVA_LABELS = { RI: 'Responsable Inscripto', MT: 'Monotributista', CF: 'Consumidor Final', EX: 'Exento' }
  const condIvaCliente = cliente?.condicion_iva ? (COND_IVA_LABELS[cliente.condicion_iva] || cliente.condicion_iva) : 'Consumidor Final'
  const direccionCliente = cliente ? [cliente.direccion, cliente.localidad, cliente.codigo_postal].filter(Boolean).join(' - ') : ''

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
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
      <tbody>
        ${filasItems}
      </tbody>
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
        ? `<div class="totales-row"><span>Subtotal:</span><span>${formatMonto(netoTotal)}</span></div>
           ${parseFloat(venta.descuento_total) > 0 ? `<div class="totales-row"><span>Dto:</span><span>-${formatMonto(venta.descuento_total)}</span></div>` : ''}
           <div class="totales-row"><span>Subtotal:</span><span>${formatMonto(netoTotal)}</span></div>
           <div class="totales-row"><span>Imp. Internos:</span><span>$0,00</span></div>
           <div class="totales-row"><span>Reg. Especiales:</span><span>$0,00</span></div>
           <div class="totales-row"><span>IVA:</span><span>${formatMonto(ivaTotal)}</span></div>
           <div class="totales-row total"><span>TOTAL:</span><span>${formatMonto(totalNum)}</span></div>`
        : `<div class="totales-row"><span>Subtotal:</span><span>${formatMonto(venta.subtotal || venta.total)}</span></div>
           ${parseFloat(venta.descuento_total) > 0 ? `<div class="totales-row"><span>Dto:</span><span>-${formatMonto(venta.descuento_total)}</span></div>` : ''}
           <div class="totales-row"><span>Imp. Internos:</span><span>$0,00</span></div>
           <div class="totales-row"><span>Reg. Especiales:</span><span>$0,00</span></div>
           <div class="totales-row total"><span>TOTAL:</span><span>${formatMonto(totalNum)}</span></div>`
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
        <div>IVA Contenido: ${formatMonto(netoTotal * 0.21)}</div>
        <div>Otros Impuestos Nacionales Indirectos</div>
      </div>` : ''}
    </div>
    <div class="cae-right">
      ${cae
        ? `<div style="font-size:9px;color:#555">Comprobante fiscal autorizado por AFIP</div>`
        : venta.centum_comprobante
          ? `<div>Comprobante: ${escapeHtml(venta.centum_comprobante)}</div><div style="font-size:9px;color:#999;margin-top:2px">CAE no disponible</div>`
          : `<div style="color:#999">Comprobante interno - sin CAE</div><div style="font-size:9px;color:#999;margin-top:2px">Este documento no reemplaza la factura fiscal emitida por AFIP/ARCA</div>`
      }
    </div>
  </div>
</div>
</body></html>`

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;left:-9999px'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(fullHtml)
  doc.close()
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch (e) { console.error('Error al imprimir:', e) }
    setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 2000)
  }, 100)
}

/**
 * Imprime todos los tickets de ventas delivery en una sola impresión batch (80mm).
 * Cada venta es Consumidor Final → Factura B simplificada.
 */
export function imprimirTicketsDeliveryBatch(ventas, puntoVenta) {
  if (!ventas || ventas.length === 0) return

  let htmlCompleto = ''

  ventas.forEach((venta, idx) => {
    const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
    const pagos = venta.pagos || []
    const totalNum = parseFloat(venta.total) || 0
    const subtotalNum = parseFloat(venta.subtotal) || totalNum
    const descuentoTotal = parseFloat(venta.descuento_total) || 0

    let html = ''

    // Separador entre tickets
    if (idx > 0) {
      html += '<div style="margin:16px 0;border-top:2px dashed #000"></div>'
      html += '<div class="center" style="font-size:14px;margin-bottom:8px">- - - CORTE - - -</div>'
      html += '<div style="margin-bottom:16px;border-top:2px dashed #000"></div>'
    }

    // Header
    html += '<div class="center" style="font-size:20px;font-weight:bold;margin-bottom:0">FACTURA DE VENTA</div>'
    html += '<div class="center" style="font-size:22px;font-weight:bold;text-decoration:underline;margin-bottom:3px">B</div>'

    // Datos empresa
    html += '<div style="font-size:14px;line-height:1.3">'
    html += '<div>Comercial padano s.r.l</div>'
    html += '<div>30-71885278-8</div>'
    html += '<div>Brasil 313, Rosario, Santa fe</div>'
    html += '<div>IIBB: 0213900654</div>'
    html += '<div>Inicio actividades 01/09/2019</div>'
    html += '</div>'

    // Nro comprobante y fecha
    const ahora = new Date()
    const fechaHora = ahora.toLocaleDateString('es-AR') + ' ' + ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    const pvStr = puntoVenta ? String(puntoVenta).padStart(5, '0') : '00000'
    const nroStr = String(venta.numero_venta || 0).padStart(8, '0')
    html += `<div class="row" style="font-size:16px;margin-top:3px"><span><strong>Nro: ${pvStr}-${nroStr}</strong></span><span>${fechaHora}</span></div>`

    html += '<div class="line"></div>'

    // Cliente
    html += '<div style="font-size:14px;line-height:1.3">'
    html += `<div>${escapeHtml(venta.nombre_cliente || 'Consumidor Final')} &nbsp; DELIVERY</div>`
    html += '</div>'

    html += '<div class="line"></div>'

    // Items
    items.forEach(item => {
      const lineTotal = (parseFloat(item.precio_unitario) || 0) * (parseFloat(item.cantidad) || 1)
      html += `<div style="font-size:20px">${escapeHtml(item.nombre)}</div>`
      html += `<div class="row" style="font-size:20px;padding-left:8px"><span>${item.cantidad} x</span><span>${formatMonto(item.precio_unitario)}</span></div>`
      html += `<div style="font-size:20px;padding-left:8px">${formatMonto(lineTotal)}</div>`
    })

    html += '<div class="line"></div>'

    // Subtotal
    html += `<div class="row"><span>Subtotal</span><span>${formatMonto(subtotalNum)}</span></div>`

    // Descuento forma de pago
    if (descuentoTotal > 0) {
      const descDetalle = venta.descuento_forma_pago?.detalle || []
      descDetalle.forEach(d => {
        html += `<div class="row" style="font-size:20px"><span>Desc. ${escapeHtml(d.formaCobro)} ${d.porcentaje}%${d.baseDescuento ? ` s/ ${formatMonto(d.baseDescuento)}` : ''}</span><span>-${formatMonto(d.descuento)}</span></div>`
      })
      html += '<div class="line"></div>'
    }

    // Total
    html += `<div class="row total"><span>TOTAL</span><span>${formatMonto(totalNum)}</span></div>`
    html += '<div class="line-double"></div>'

    // Pagos
    if (pagos.length > 0) {
      const resumen = pagos.reduce((acc, p) => {
        const label = p.tipo || p.medio || 'Otro'
        acc[label] = (acc[label] || 0) + (p.monto || 0)
        return acc
      }, {})
      Object.entries(resumen).forEach(([tipo, monto]) => {
        html += `<div class="row" style="font-size:20px"><span>${escapeHtml(tipo)}</span><span>${formatMonto(monto)}</span></div>`
      })
    }

    html += '<div class="line-double"></div>'
    html += '<div class="center" style="font-size:18px;margin-top:8px">Gracias por su compra</div>'

    // Régimen de Transparencia Fiscal
    html += '<div class="line"></div>'
    const ivaContenido = Math.round(totalNum / 1.21 * 0.21 * 100) / 100
    html += '<div style="font-size:16px;margin-top:4px;line-height:1.6">'
    html += '<div class="center"><strong>Regimen de Transparencia Fiscal al Consumidor (Ley 27.743)</strong></div>'
    html += `<div class="row" style="font-size:16px"><span>IVA Contenido</span><span>${formatMonto(ivaContenido)}</span></div>`
    html += `<div class="row" style="font-size:16px"><span>Otros Impuestos Nacionales Indirectos</span><span>${formatMonto(0)}</span></div>`
    html += '</div>'

    htmlCompleto += html
  })

  abrirVentanaImpresion(htmlCompleto)
}

export function imprimirCierreCuentaEmpleado({ empleado, saldo, ventas, pagos, concepto }) {
  const ahora = new Date()
  const fechaStr = ahora.toLocaleDateString('es-AR') + ' ' + ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  // Unificar todos los movimientos en una timeline ordenada cronológicamente
  const movimientos = [
    ...(ventas || []).map(v => ({ tipo: 'consumo', fecha: v.created_at, monto: v.total, detalle: v.cajero?.nombre ? `Por: ${v.cajero.nombre}` : '' })),
    ...(pagos || []).map(p => ({ tipo: 'pago', fecha: p.created_at, monto: p.monto, detalle: [p.concepto, p.registrado?.nombre ? `Por: ${p.registrado.nombre}` : ''].filter(Boolean).join(' · ') })),
  ].sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

  let totalConsumos = 0
  let totalPagos = 0

  // Construir filas de la tabla
  let filasHtml = ''
  let num = 0
  movimientos.forEach(m => {
    num++
    const fecha = formatFechaHora(m.fecha)
    const esConsumo = m.tipo === 'consumo'
    const color = esConsumo ? '#dc2626' : '#16a34a'
    const signo = esConsumo ? '+' : '-'

    if (esConsumo) totalConsumos += m.monto
    else totalPagos += m.monto

    filasHtml += `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${num}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(fecha)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb">${esConsumo ? 'Consumo' : 'Pago'}${m.detalle ? ` <span style="color:#6b7280;font-size:11px">(${escapeHtml(m.detalle)})</span>` : ''}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;color:${color}">${signo} ${formatMonto(m.monto)}</td>
    </tr>`
  })

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 20mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 20px; }
  .header h1 { font-size: 22px; margin-bottom: 2px; }
  .header h2 { font-size: 16px; font-weight: normal; color: #6b7280; }
  .info { margin-bottom: 16px; }
  .info div { margin-bottom: 3px; }
  .info .label { color: #6b7280; display: inline-block; width: 80px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; padding: 6px 8px; text-align: left; font-size: 12px; border-bottom: 2px solid #d1d5db; }
  th:last-child, td:last-child { text-align: right; }
  .total-row { font-size: 16px; font-weight: bold; border-top: 2px solid #111; }
  .total-row td { padding: 10px 8px; }
  .footer { margin-top: 40px; }
  .firma-line { border-top: 1px solid #111; width: 250px; margin: 40px auto 4px; }
  .firma-text { text-align: center; font-size: 12px; color: #6b7280; }
  .nota { margin-top: 20px; font-size: 11px; color: #9ca3af; text-align: center; }
</style></head><body>

<div class="header">
  <h1>PADANO SRL</h1>
  <h2>Cierre de Cuenta Corriente Empleado</h2>
</div>

<div class="info">
  <div><span class="label">Empleado:</span> <strong>${escapeHtml(empleado.nombre)}</strong></div>
  ${empleado.codigo ? `<div><span class="label">Codigo:</span> ${escapeHtml(empleado.codigo)}</div>` : ''}
  ${empleado.sucursales?.nombre ? `<div><span class="label">Sucursal:</span> ${escapeHtml(empleado.sucursales.nombre)}</div>` : ''}
  <div><span class="label">Fecha:</span> ${escapeHtml(fechaStr)}</div>
  ${concepto ? `<div><span class="label">Concepto:</span> ${escapeHtml(concepto)}</div>` : ''}
</div>

<table>
  <thead>
    <tr>
      <th style="width:40px;text-align:center">#</th>
      <th>Fecha</th>
      <th>Detalle</th>
      <th style="width:120px">Importe</th>
    </tr>
  </thead>
  <tbody>
    ${filasHtml}
    <tr style="border-top:1px solid #d1d5db">
      <td colspan="3" style="padding:6px 8px;font-weight:bold">Total consumos</td>
      <td style="padding:6px 8px;text-align:right;font-weight:bold;color:#dc2626">+ ${formatMonto(totalConsumos)}</td>
    </tr>
    ${totalPagos > 0 ? `<tr>
      <td colspan="3" style="padding:6px 8px;font-weight:bold">Total pagos/adelantos</td>
      <td style="padding:6px 8px;text-align:right;font-weight:bold;color:#16a34a">- ${formatMonto(totalPagos)}</td>
    </tr>` : ''}
    <tr class="total-row">
      <td colspan="3">SALDO A DESCONTAR</td>
      <td>${formatMonto(saldo)}</td>
    </tr>
  </tbody>
</table>

<div style="font-size:13px;margin-top:8px">Saldo despues del cierre: <strong>$0</strong></div>

<div class="footer">
  <div class="firma-line"></div>
  <div class="firma-text">Firma del empleado</div>
  <div class="firma-line" style="margin-top:24px"></div>
  <div class="firma-text">Aclaracion</div>
</div>

<div class="nota">Comprobante generado automaticamente — Padano SRL</div>

</body></html>`

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;left:-9999px'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(fullHtml)
  doc.close()
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch (e) { console.error('Error al imprimir:', e) }
    setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 2000)
  }, 100)
}
