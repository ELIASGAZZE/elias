// Detalle de una venta POS
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'

const formatFechaHora = (fecha) => {
  if (!fecha) return ''
  const d = new Date(fecha)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const formatPrecio = (precio) => {
  if (precio == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(precio)
}

const MEDIOS_LABELS = {
  efectivo: 'Efectivo',
  debito: 'Tarjeta Dbto',
  credito: 'Tarjeta Crto',
  qr: 'QR / Transferencia',
  cuenta_corriente: 'Cta. Corriente',
}

const escapeHtml = (s) => {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function imprimirComprobanteVenta(venta) {
  const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
  const pagos = venta.pagos || []
  const fecha = formatFechaHora(venta.created_at)
  const esNC = venta.tipo === 'nota_credito'
  const tipoDoc = esNC ? 'NOTA DE CREDITO B' : 'FACTURA B'
  const numero = venta.centum_comprobante || `#${venta.numero_venta || '—'}`

  let filasItems = ''
  items.forEach((item, i) => {
    const precio = parseFloat(item.precio_unitario || item.precioFinal || item.precio || 0)
    const cant = parseFloat(item.cantidad || 1)
    const sub = precio * cant
    filasItems += `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${i + 1}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${item.codigo || ''}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.nombre)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${cant}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${formatPrecio(precio)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${formatPrecio(sub)}</td>
    </tr>`
  })

  let mediosPago = ''
  if (pagos.length > 0) {
    mediosPago = pagos.map(p =>
      `<span style="display:inline-block;background:#f3f4f6;padding:2px 10px;border-radius:4px;margin-right:6px;font-size:12px">${escapeHtml(MEDIOS_LABELS[p.medio || p.tipo] || p.medio || p.tipo)} ${formatPrecio(p.monto)}</span>`
    ).join('')
  }

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 15mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1f2937; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .empresa { }
  .empresa h1 { font-size: 20px; margin-bottom: 2px; }
  .empresa p { font-size: 11px; color: #6b7280; }
  .tipo-doc { text-align: right; }
  .tipo-doc h2 { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
  .tipo-doc .numero { font-size: 14px; color: #374151; }
  .tipo-doc .fecha { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .info-box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; }
  .info-box .label { font-size: 10px; text-transform: uppercase; color: #9ca3af; font-weight: 600; letter-spacing: 0.5px; }
  .info-box .value { font-size: 13px; color: #111; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; padding: 6px 8px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #d1d5db; }
  th:nth-child(1) { text-align: center; width: 30px; }
  th:nth-child(4) { text-align: center; width: 50px; }
  th:nth-child(5), th:nth-child(6) { text-align: right; width: 100px; }
  .total-row td { padding: 10px 8px; font-size: 15px; font-weight: bold; border-top: 2px solid #111; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
  .footer p { font-size: 10px; color: #9ca3af; text-align: center; }
  .medios { margin-top: 8px; }
  .nc-badge { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 13px; display: inline-block; margin-bottom: 12px; }
</style></head><body>

<div class="header">
  <div class="empresa">
    <h1>PADANO SRL</h1>
    <p>Gestiones Operativas</p>
  </div>
  <div class="tipo-doc">
    <h2>${tipoDoc}</h2>
    <div class="numero">${escapeHtml(numero)}</div>
    <div class="fecha">${escapeHtml(fecha)}</div>
  </div>
</div>

${esNC ? '<div class="nc-badge">NOTA DE CREDITO</div>' : ''}

<div class="info-grid">
  <div class="info-box">
    <div class="label">Cliente</div>
    <div class="value">${escapeHtml(venta.nombre_cliente || 'Consumidor Final')}</div>
  </div>
  <div class="info-box">
    <div class="label">Condicion IVA</div>
    <div class="value">Consumidor Final</div>
  </div>
  ${venta.perfiles?.nombre ? `<div class="info-box">
    <div class="label">Cajero</div>
    <div class="value">${escapeHtml(venta.perfiles.nombre)}</div>
  </div>` : ''}
  ${venta.centum_comprobante ? `<div class="info-box">
    <div class="label">Comprobante Centum</div>
    <div class="value" style="color:#059669">${escapeHtml(venta.centum_comprobante)}</div>
  </div>` : ''}
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Codigo</th>
      <th>Descripcion</th>
      <th>Cant.</th>
      <th>P. Unit.</th>
      <th>Subtotal</th>
    </tr>
  </thead>
  <tbody>
    ${filasItems}
    ${parseFloat(venta.descuento_total) > 0 ? `
    <tr>
      <td colspan="5" style="padding:5px 8px;text-align:right;color:#059669">Descuentos</td>
      <td style="padding:5px 8px;text-align:right;color:#059669">-${formatPrecio(venta.descuento_total)}</td>
    </tr>` : ''}
    <tr class="total-row">
      <td colspan="5" style="text-align:right">TOTAL</td>
      <td style="text-align:right">${formatPrecio(venta.total)}</td>
    </tr>
  </tbody>
</table>

${mediosPago ? `<div class="medios"><strong style="font-size:11px;color:#6b7280">FORMA DE PAGO:</strong> ${mediosPago}</div>` : ''}

<div class="footer">
  <p>Comprobante interno — Padano SRL — ${escapeHtml(fecha)}</p>
  <p>Este documento no reemplaza la factura fiscal emitida por AFIP/ARCA.</p>
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

const DetalleVenta = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { esAdmin } = useAuth()
  const [venta, setVenta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [reenviando, setReenviando] = useState(false)
  const [reenvioMsg, setReenvioMsg] = useState('')
  const [eliminando, setEliminando] = useState(false)

  useEffect(() => {
    const cargar = async () => {
      try {
        const { data } = await api.get(`/api/pos/ventas/${id}`)
        setVenta(data.venta)
      } catch (err) {
        setError(err.response?.data?.error || 'Error al cargar la venta')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id])

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar sinTabs titulo="Detalle Venta" volverA="/ventas" />
        <div className="text-center text-gray-400 py-20">Cargando...</div>
      </div>
    )
  }

  if (error || !venta) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar sinTabs titulo="Detalle Venta" volverA="/ventas" />
        <div className="text-center text-red-500 py-20">{error || 'Venta no encontrada'}</div>
      </div>
    )
  }

  const reenviarCentum = async () => {
    if (!confirm('¿Reintentar envío a Centum? Esto generará una factura fiscal.')) return
    setReenviando(true)
    setReenvioMsg('')
    try {
      const { data } = await api.post(`/api/pos/ventas/${id}/reenviar-centum`)
      setReenvioMsg(`Enviado OK: ${data.comprobante || 'Sin comprobante'}`)
      const { data: updated } = await api.get(`/api/pos/ventas/${id}`)
      setVenta(updated.venta)
    } catch (err) {
      setReenvioMsg(`Error: ${err.response?.data?.error || err.message}`)
    } finally {
      setReenviando(false)
    }
  }

  const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
  const promociones = typeof venta.promociones_aplicadas === 'string'
    ? JSON.parse(venta.promociones_aplicadas)
    : (venta.promociones_aplicadas || [])
  const pagos = venta.pagos || []
  const descFormaPago = venta.descuento_forma_pago

  const esNC = venta.tipo === 'nota_credito'
  const relacionadas = venta.ventas_relacionadas || []
  const ncsHijas = relacionadas.filter(v => v.tipo === 'nota_credito')
  const ventasHijas = relacionadas.filter(v => v.tipo === 'venta')
  const movSaldo = venta.movimiento_saldo
  const ventaNuevaCorreccion = venta.venta_nueva_correccion

  // Determinar tipo de incidente para NC
  let tipoIncidente = null
  if (esNC && movSaldo) {
    const motivo = (movSaldo.motivo || '').toLowerCase()
    if (motivo.includes('devolución') || motivo.includes('devolucion')) tipoIncidente = 'devolucion'
    else if (motivo.includes('diferencia de precio') || motivo.includes('góndola') || motivo.includes('gondola')) tipoIncidente = 'diferencia_precio'
  } else if (esNC && ventaNuevaCorreccion) {
    tipoIncidente = 'correccion_cliente'
  } else if (esNC) {
    tipoIncidente = 'nota_credito'
  }

  // Para ventas originales que tuvieron incidentes
  const tieneIncidentes = ncsHijas.length > 0 || ventasHijas.length > 0

  const INCIDENTE_LABELS = {
    devolucion: 'Devolución de producto',
    diferencia_precio: 'Diferencia de precio',
    correccion_cliente: 'Corrección de cliente',
    nota_credito: 'Nota de crédito',
  }
  const INCIDENTE_COLORS = {
    devolucion: 'bg-orange-100 text-orange-700 border-orange-200',
    diferencia_precio: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    correccion_cliente: 'bg-purple-100 text-purple-700 border-purple-200',
    nota_credito: 'bg-red-100 text-red-700 border-red-200',
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Detalle Venta" volverA="/ventas" />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">

        {/* Badge NC / Incidente */}
        {esNC && (
          <div className={`rounded-xl border p-4 ${INCIDENTE_COLORS[tipoIncidente] || 'bg-red-50 text-red-700 border-red-200'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg font-bold">NOTA DE CREDITO #{venta.numero_venta || venta.id}</span>
            </div>
            {tipoIncidente && (
              <span className="text-sm font-medium">
                Motivo: {INCIDENTE_LABELS[tipoIncidente] || tipoIncidente}
              </span>
            )}
          </div>
        )}

        {/* Info general */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Informacion general</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Fecha</span>
            <span className="text-gray-800 font-medium">{formatFechaHora(venta.created_at)}</span>

            <span className="text-gray-500">Clasificación</span>
            <span className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${
              venta.clasificacion === 'EMPRESA'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {venta.clasificacion}
            </span>

            <span className="text-gray-500">Cliente</span>
            <span className="text-gray-800 font-medium">{venta.nombre_cliente || 'Consumidor Final'}</span>

            {esAdmin && venta.perfiles?.nombre && (
              <>
                <span className="text-gray-500">Cajero</span>
                <span className="text-gray-800 font-medium">{venta.perfiles.nombre}</span>
              </>
            )}

            {venta.pedido && (
              <>
                <span className="text-gray-500">Origen</span>
                <span className="text-violet-600 font-medium">
                  Pedido #{venta.pedido.numero || '—'}
                </span>
              </>
            )}

            {venta.centum_comprobante && (
              <>
                <span className="text-gray-500">Centum</span>
                <span className="text-green-600 font-medium">
                  {venta.centum_comprobante}
                </span>
              </>
            )}
            {!venta.centum_sync && venta.centum_error && (
              <>
                <span className="text-gray-500">Centum</span>
                <span className="text-red-600 font-medium text-sm">
                  Error: {venta.centum_error}
                </span>
              </>
            )}
          </div>

          {/* Botón reintentar Centum */}
          {!venta.centum_sync && !venta.centum_comprobante && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <button
                onClick={reenviarCentum}
                disabled={reenviando}
                className="w-full text-sm font-medium py-2 px-4 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {reenviando ? 'Enviando a Centum...' : 'Reintentar Centum'}
              </button>
              {reenvioMsg && (
                <p className={`text-xs mt-2 ${reenvioMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                  {reenvioMsg}
                </p>
              )}
              {esAdmin && (
                <button
                  onClick={async () => {
                    if (!confirm('¿Eliminar esta venta? Esta acción no se puede deshacer.')) return
                    setEliminando(true)
                    try {
                      await api.delete(`/api/pos/ventas/${id}`)
                      alert('Venta eliminada')
                      navigate('/ventas')
                    } catch (err) {
                      alert('Error: ' + (err.response?.data?.error || err.message))
                    } finally {
                      setEliminando(false)
                    }
                  }}
                  disabled={eliminando}
                  className="w-full text-sm font-medium py-2 px-4 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {eliminando ? 'Eliminando...' : 'Eliminar venta'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Venta origen (si es NC o venta de corrección) */}
        {venta.venta_origen && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Venta original</h2>
            <Link
              to={`/ventas/${venta.venta_origen.id}`}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div>
                <span className="text-sm font-medium text-gray-800">
                  Venta #{venta.venta_origen.numero_venta || venta.venta_origen.id}
                </span>
                <span className="text-xs text-gray-500 ml-2">
                  {venta.venta_origen.nombre_cliente || 'Consumidor Final'}
                </span>
                {venta.venta_origen.centum_comprobante && (
                  <span className="text-xs text-green-600 ml-2">{venta.venta_origen.centum_comprobante}</span>
                )}
              </div>
              <div className="text-right">
                <span className="text-sm font-medium text-gray-700">{formatPrecio(venta.venta_origen.total)}</span>
                <span className="text-xs text-gray-400 block">{formatFechaHora(venta.venta_origen.created_at)}</span>
              </div>
            </Link>
          </div>
        )}

        {/* Detalle del incidente (para NCs) */}
        {esNC && movSaldo && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Detalle del incidente</h2>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-gray-500 uppercase">Motivo</span>
                <p className="text-sm text-gray-800 mt-0.5">{movSaldo.motivo}</p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                <div>
                  <span className="text-xs text-emerald-600 uppercase font-medium">Saldo generado</span>
                  <p className="text-sm text-gray-700 mt-0.5">
                    A favor de: <span className="font-medium">{movSaldo.nombre_cliente || 'Cliente'}</span>
                  </p>
                </div>
                <span className="text-lg font-bold text-emerald-700">{formatPrecio(movSaldo.monto)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Corrección de cliente: venta nueva */}
        {esNC && ventaNuevaCorreccion && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Corrección de cliente</h2>
            <p className="text-sm text-gray-600 mb-3">
              Se anuló la venta original y se generó una nueva al cliente correcto:
            </p>
            <Link
              to={`/ventas/${ventaNuevaCorreccion.id}`}
              className="flex items-center justify-between p-3 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-100 transition-colors"
            >
              <div>
                <span className="text-sm font-medium text-purple-800">
                  Nueva Venta #{ventaNuevaCorreccion.numero_venta || ventaNuevaCorreccion.id}
                </span>
                <span className="text-xs text-purple-600 ml-2">
                  {ventaNuevaCorreccion.nombre_cliente || 'Cliente'}
                </span>
                {ventaNuevaCorreccion.centum_comprobante && (
                  <span className="text-xs text-green-600 ml-2">{ventaNuevaCorreccion.centum_comprobante}</span>
                )}
              </div>
              <span className="text-sm font-medium text-purple-700">{formatPrecio(ventaNuevaCorreccion.total)}</span>
            </Link>
          </div>
        )}

        {/* Incidentes de la venta original (NCs hijas, ventas de corrección) */}
        {tieneIncidentes && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">
              Incidentes ({ncsHijas.length + ventasHijas.length})
            </h2>
            <div className="space-y-2">
              {ncsHijas.map(nc => (
                <Link
                  key={nc.id}
                  to={`/ventas/${nc.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-red-50 hover:bg-red-100 border border-red-100 transition-colors"
                >
                  <div>
                    <span className="text-xs font-medium text-red-600 uppercase">Nota de Crédito</span>
                    <span className="text-sm font-medium text-gray-800 ml-2">
                      #{nc.numero_venta || nc.id}
                    </span>
                    {nc.centum_comprobante && (
                      <span className="text-xs text-green-600 ml-2">{nc.centum_comprobante}</span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-600">{formatPrecio(nc.total)}</span>
                    <span className="text-xs text-gray-400 block">{formatFechaHora(nc.created_at)}</span>
                  </div>
                </Link>
              ))}
              {ventasHijas.map(v => (
                <Link
                  key={v.id}
                  to={`/ventas/${v.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-100 transition-colors"
                >
                  <div>
                    <span className="text-xs font-medium text-purple-600 uppercase">Venta corregida</span>
                    <span className="text-sm font-medium text-gray-800 ml-2">
                      #{v.numero_venta || v.id}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">{v.nombre_cliente}</span>
                    {v.centum_comprobante && (
                      <span className="text-xs text-green-600 ml-2">{v.centum_comprobante}</span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-gray-700">{formatPrecio(v.total)}</span>
                    <span className="text-xs text-gray-400 block">{formatFechaHora(v.created_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Items ({items.length})</h2>
          <div className="divide-y divide-gray-100">
            {items.map((item, i) => {
              const precioUnit = parseFloat(item.precio_unitario || item.precioFinal || item.precio || 0)
              const cant = parseFloat(item.cantidad || 1)
              const subtotal = precioUnit * cant

              return (
                <div key={i} className="py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 font-medium truncate">{item.nombre || item.codigo}</p>
                      <p className="text-xs text-gray-400">
                        {item.codigo && `${item.codigo} — `}
                        {cant} x {formatPrecio(precioUnit)}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      {formatPrecio(subtotal)}
                    </span>
                  </div>
                  {item.descripcionProblema && (
                    <p className="text-xs text-orange-600 mt-1 italic">
                      {item.descripcionProblema}
                    </p>
                  )}
                  {item.precio_cobrado != null && item.precio_correcto != null && (
                    <p className="text-xs text-yellow-600 mt-1">
                      Cobrado: {formatPrecio(item.precio_cobrado)} / Precio correcto: {formatPrecio(item.precio_correcto)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Promociones aplicadas */}
        {promociones.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Promociones aplicadas</h2>
            <div className="space-y-2">
              {promociones.map((promo, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{promo.nombre || promo.tipo || 'Promocion'}</span>
                  {promo.descuento != null && (
                    <span className="text-green-600 font-medium">-{formatPrecio(promo.descuento)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Descuento por forma de pago */}
        {descFormaPago && descFormaPago.total > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Descuento por forma de pago</h2>
            {(descFormaPago.detalle || []).map((d, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">
                  {MEDIOS_LABELS[d.formaCobro?.toLowerCase()] || d.formaCobro}
                  {d.porcentaje ? ` (${d.porcentaje}%)` : ''}
                </span>
                <span className="text-green-600 font-medium">-{formatPrecio(d.descuento || 0)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Resumen de pago */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Resumen de pago</h2>
          <div className="space-y-2 text-sm">
            {parseFloat(venta.subtotal) !== parseFloat(venta.total) && (
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-700">{formatPrecio(venta.subtotal)}</span>
              </div>
            )}
            {parseFloat(venta.descuento_total) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Descuentos</span>
                <span className="text-green-600">-{formatPrecio(venta.descuento_total)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base border-t border-gray-200 pt-2">
              <span className="text-gray-800">Total</span>
              <span className="text-gray-800">{formatPrecio(venta.total)}</span>
            </div>

            {/* Medios de pago */}
            {pagos.length > 0 && (
              <div className="border-t border-gray-100 pt-2 mt-2 space-y-1">
                {pagos.map((p, i) => (
                  <div key={i} className="flex justify-between text-gray-600">
                    <span>{MEDIOS_LABELS[p.medio] || p.medio}</span>
                    <span>{formatPrecio(p.monto)}</span>
                  </div>
                ))}
              </div>
            )}

            {parseFloat(venta.monto_pagado) > parseFloat(venta.total) && (
              <div className="flex justify-between text-gray-500 border-t border-gray-100 pt-2">
                <span>Pagado</span>
                <span>{formatPrecio(venta.monto_pagado)}</span>
              </div>
            )}
            {parseFloat(venta.vuelto) > 0 && (
              <div className="flex justify-between text-gray-500">
                <span>Vuelto</span>
                <span>{formatPrecio(venta.vuelto)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Botón imprimir comprobante */}
        <button
          onClick={() => imprimirComprobanteVenta(venta)}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Imprimir comprobante A4
        </button>
      </div>
    </div>
  )
}

export default DetalleVenta
