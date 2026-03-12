// Utilidad de impresión de comprobantes 80mm (comandera)

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
    font-size: 22px;
    width: 302px;
    padding: 8px;
    line-height: 1.4;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .titulo { font-size: 28px; font-weight: bold; }
  .total { font-size: 26px; font-weight: bold; }
  .seccion { font-size: 20px; font-weight: bold; margin-top: 4px; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .line-double { border-top: 2px solid #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; }
  .firma { margin-top: 24px; border-top: 1px solid #000; width: 80%; margin-left: 10%; padding-top: 4px; text-align: center; font-size: 20px; }
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
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } catch (e) {
      console.error('Error al imprimir:', e)
    }
    // Limpiar iframe después de imprimir
    setTimeout(() => {
      try { document.body.removeChild(iframe) } catch {}
    }, 2000)
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
      html += `<div class="row"><span>$${d.valor.toLocaleString('es-AR')} x ${cant}</span><span>${formatMonto(total)}</span></div>`
    })
  }

  if (monedasActivas.length > 0) {
    html += '<div class="seccion">MONEDAS</div>'
    monedasActivas.forEach(d => {
      const cant = monedas[String(d.valor)]
      const total = d.valor * cant
      html += `<div class="row"><span>$${d.valor.toLocaleString('es-AR')} x ${cant}</span><span>${formatMonto(total)}</span></div>`
    })
  }

  return html
}

export function imprimirCierre(cierre, retiros, denominaciones, gastos) {
  let html = ''

  html += '<div class="center titulo">CIERRE DE CAJA</div>'
  html += '<div class="line-double"></div>'
  html += `<div>Planilla: #${escapeHtml(cierre.planilla_id)}</div>`
  if (cierre.caja?.nombre) html += `<div>Caja: ${escapeHtml(cierre.caja.nombre)}</div>`
  if (cierre.caja?.sucursales?.nombre) html += `<div>Sucursal: ${escapeHtml(cierre.caja.sucursales.nombre)}</div>`
  if (cierre.empleado?.nombre) html += `<div>Abrio: ${escapeHtml(cierre.empleado.nombre)}</div>`
  if (cierre.cerrado_por?.nombre) html += `<div>Cerro: ${escapeHtml(cierre.cerrado_por.nombre)}</div>`
  html += `<div>Fecha: ${escapeHtml(formatFecha(cierre.fecha))}</div>`
  if (cierre.fondo_fijo > 0) html += `<div>Cambio inicial: ${formatMonto(cierre.fondo_fijo)}</div>`
  html += '<div class="line-double"></div>'

  // Denominaciones
  html += buildDenominacionesHtml(cierre.billetes, cierre.monedas, denominaciones)

  html += '<div class="line"></div>'
  html += `<div class="row total"><span>Total efectivo</span><span>${formatMonto(cierre.total_efectivo)}</span></div>`
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

  html += `<div class="row total"><span>TOTAL GENERAL</span><span>${formatMonto(cierre.total_general)}</span></div>`
  html += '<div class="line-double"></div>'

  // Cambio y retiros
  if (parseFloat(cierre.cambio_que_queda) > 0 || parseFloat(cierre.efectivo_retirado) > 0) {
    html += `<div class="row"><span>Cambio que queda</span><span>${formatMonto(cierre.cambio_que_queda)}</span></div>`
    html += `<div class="row"><span>Efectivo retirado</span><span>${formatMonto(cierre.efectivo_retirado)}</span></div>`
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

export function imprimirTicketPOS({ items, cliente, pagos, promosAplicadas, descuentosPorForma, subtotal, descuentoTotal, totalDescuentoPagos, total, totalPagado, vuelto, esOffline, numeroVenta }) {
  let html = ''

  html += '<div class="center titulo">PADANO SRL</div>'
  html += '<div class="center" style="font-size:18px;margin-bottom:4px">Punto de Venta</div>'
  if (numeroVenta) html += `<div class="center bold" style="font-size:14px;margin-bottom:4px">Venta #${numeroVenta}</div>`
  html += '<div class="line-double"></div>'

  // Fecha y cliente
  const ahora = new Date()
  html += `<div style="font-size:20px">${ahora.toLocaleDateString('es-AR')} ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>`
  if (cliente?.razon_social) html += `<div style="font-size:20px">Cliente: ${escapeHtml(cliente.razon_social)}</div>`
  html += '<div class="line"></div>'

  // Items
  items.forEach(item => {
    const lineTotal = item.precio_unitario * item.cantidad
    html += `<div style="font-size:20px">${escapeHtml(item.nombre)}</div>`
    html += `<div class="row" style="font-size:20px;padding-left:8px"><span>${item.cantidad} x ${formatMonto(item.precio_unitario)}</span><span>${formatMonto(lineTotal)}</span></div>`
  })

  html += '<div class="line"></div>'

  // Subtotal
  html += `<div class="row"><span>Subtotal</span><span>${formatMonto(subtotal)}</span></div>`

  // Descuentos promos
  if (promosAplicadas && promosAplicadas.length > 0) {
    promosAplicadas.forEach(p => {
      html += `<div class="row" style="font-size:20px"><span>${escapeHtml(p.promoNombre || p.detalle || 'Promo')}</span><span>-${formatMonto(p.descuento)}</span></div>`
    })
  }

  // Descuentos forma de pago
  if (descuentosPorForma && descuentosPorForma.length > 0) {
    descuentosPorForma.forEach(d => {
      html += `<div class="row" style="font-size:20px"><span>Desc. ${escapeHtml(d.formaCobro)} ${d.porcentaje}%</span><span>-${formatMonto(d.descuento)}</span></div>`
    })
  }

  if ((descuentoTotal || 0) + (totalDescuentoPagos || 0) > 0) {
    html += '<div class="line"></div>'
  }

  // Total
  html += `<div class="row total"><span>TOTAL</span><span>${formatMonto(total)}</span></div>`
  html += '<div class="line-double"></div>'

  // Pagos
  if (pagos && pagos.length > 0) {
    const resumen = pagos.reduce((acc, p) => { acc[p.tipo] = (acc[p.tipo] || 0) + p.monto; return acc }, {})
    Object.entries(resumen).forEach(([tipo, monto]) => {
      html += `<div class="row" style="font-size:20px"><span>${escapeHtml(tipo)}</span><span>${formatMonto(monto)}</span></div>`
    })
  }

  if (vuelto > 0) {
    html += '<div class="line"></div>'
    html += `<div class="row total"><span>VUELTO</span><span>${formatMonto(vuelto)}</span></div>`
  }

  if (esOffline) {
    html += '<div class="line"></div>'
    html += '<div class="center" style="font-size:18px;font-weight:bold">** VENTA OFFLINE - PENDIENTE SYNC **</div>'
  }

  html += '<div class="line-double"></div>'
  html += '<div class="center" style="font-size:18px;margin-top:8px">Gracias por su compra</div>'
  html += '<div class="line"></div>'
  html += '<div class="center" style="font-size:16px;margin-top:4px;line-height:1.4">Este ticket no es un comprobante fiscal.</div>'
  html += '<div class="center" style="font-size:16px;line-height:1.4">El comprobante oficial (AFIP/ARCA) sera enviado por correo electronico a la direccion proporcionada al cajero.</div>'

  abrirVentanaImpresion(html)
}
