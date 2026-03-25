// Detalle de una venta POS
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Navbar from '../../components/layout/Navbar'
import api from '../../services/api'
import { imprimirComprobanteA4 } from '../../utils/imprimirComprobante'

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
  const [imprimiendo, setImprimiendo] = useState(false)
  const [enviandoEmail, setEnviandoEmail] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [mostrarEmailForm, setMostrarEmailForm] = useState(false)

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

  // Calcular redondeo de efectivo (centenas)
  const totalEsperado = Math.round(
    ((parseFloat(venta.subtotal) || 0) - (parseFloat(venta.descuento_total) || 0) - (descFormaPago?.total || 0) - (parseFloat(venta.descuento_grupo_cliente) || 0)) * 100
  ) / 100
  const redondeoEfectivo = Math.round((parseFloat(venta.total) - totalEsperado) * 100) / 100

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
          {esAdmin && !venta.centum_sync && !venta.centum_comprobante && (
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
                      {item.descuento_pct > 0 && item.precio_original != null && (
                        <p className="text-xs text-orange-500 mt-0.5">
                          Desc. empleado -{item.descuento_pct}% (orig. {formatPrecio(item.precio_original)})
                        </p>
                      )}
                      {item.cambio_precio && (
                        <p className="text-xs text-blue-500 mt-0.5">
                          Precio modificado: {formatPrecio(item.cambio_precio.precio_original)} → {formatPrecio(item.cambio_precio.precio_nuevo)}
                          {item.cambio_precio.motivo && ` — ${item.cambio_precio.motivo}`}
                        </p>
                      )}
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
            <div className="space-y-3">
              {promociones.map((promo, i) => {
                const tieneDetalle = promo.itemsAfectados && promo.descuentoPorItem
                return (
                  <div key={i} className={tieneDetalle ? 'border-b border-gray-100 pb-3 last:border-0 last:pb-0' : ''}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 font-medium">{promo.promoNombre || promo.nombre || promo.tipo || 'Promocion'}</span>
                      {promo.descuento != null && (
                        <span className="text-green-600 font-medium">-{formatPrecio(promo.descuento)}</span>
                      )}
                    </div>
                    {promo.detalle && (
                      <p className="text-xs text-gray-400 mt-0.5">{promo.detalle}</p>
                    )}
                    {tieneDetalle && (
                      <div className="mt-1.5 space-y-0.5">
                        {promo.itemsAfectados.map(artId => {
                          const descItem = promo.descuentoPorItem[artId]
                          if (!descItem) return null
                          const itemVenta = items.find(it => String(it.articulo_id || it.id) === String(artId))
                          const nombre = itemVenta?.nombre || itemVenta?.codigo || `Art. ${artId}`
                          return (
                            <div key={artId} className="flex justify-between text-xs pl-2">
                              <span className="text-gray-500">· {nombre}</span>
                              <span className="text-green-600">-{formatPrecio(descItem)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
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
                <span className="text-gray-500">Descuentos promociones</span>
                <span className="text-green-600">-{formatPrecio(venta.descuento_total)}</span>
              </div>
            )}
            {parseFloat(venta.descuento_grupo_cliente) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Desc. {venta.grupo_descuento_nombre || 'grupo'}</span>
                <span className="text-green-600">-{formatPrecio(venta.descuento_grupo_cliente)}</span>
              </div>
            )}
            {redondeoEfectivo !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Redondeo efectivo</span>
                <span className={redondeoEfectivo < 0 ? 'text-green-600' : 'text-red-500'}>{redondeoEfectivo > 0 ? '+' : ''}{formatPrecio(redondeoEfectivo)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-base border-t border-gray-200 pt-2">
              <span className="text-gray-800">Total</span>
              <span className="text-gray-800">{formatPrecio(venta.total)}</span>
            </div>

            {/* Medios de pago - agrupados */}
            {pagos.length > 0 && (() => {
              // Agrupar: efectivo por denominación, otros por tipo
              const grupos = {}
              pagos.forEach(p => {
                const tipo = p.tipo || p.medio || 'efectivo'
                const tipoKey = tipo.toLowerCase()
                const esEfectivo = tipoKey === 'efectivo'
                const key = esEfectivo ? `${tipoKey}_${p.monto}` : tipoKey
                if (!grupos[key]) {
                  grupos[key] = { tipo: tipoKey, monto: 0, cantidad: 0, denominacion: esEfectivo ? p.monto : null }
                }
                grupos[key].monto += p.monto
                grupos[key].cantidad += 1
              })
              const agrupados = Object.values(grupos)
              // Separar efectivo del resto
              const efectivoItems = agrupados.filter(g => g.tipo === 'efectivo').sort((a, b) => b.denominacion - a.denominacion)
              const otrosItems = agrupados.filter(g => g.tipo !== 'efectivo')
              const totalEfectivo = efectivoItems.reduce((s, g) => s + g.monto, 0)

              return (
                <div className="border-t border-gray-100 pt-2 mt-2 space-y-1">
                  {efectivoItems.length > 0 && (
                    <div>
                      <div className="flex justify-between text-gray-600">
                        <span>{MEDIOS_LABELS['efectivo']}</span>
                        <span>{formatPrecio(totalEfectivo)}</span>
                      </div>
                      {efectivoItems.length > 1 && (
                        <p className="text-xs text-gray-400 ml-1 mt-0.5">
                          {efectivoItems.map(g => `${g.cantidad} × ${formatPrecio(g.denominacion)}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  )}
                  {otrosItems.map((g, i) => (
                    <div key={i} className="flex justify-between text-gray-600">
                      <span>{MEDIOS_LABELS[g.tipo] || g.tipo}</span>
                      <span>{formatPrecio(g.monto)}</span>
                    </div>
                  ))}
                </div>
              )
            })()}

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
          onClick={async () => {
            setImprimiendo(true)
            try {
              let caeData = null
              if (venta.id_venta_centum || venta.centum_comprobante) {
                const { data } = await api.get(`/api/pos/ventas/${id}/cae`)
                caeData = data
              }
              await imprimirComprobanteA4(venta, caeData)
            } catch (err) {
              console.error('Error al obtener CAE:', err)
              await imprimirComprobanteA4(venta, null)
            } finally {
              setImprimiendo(false)
            }
          }}
          disabled={imprimiendo}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          {imprimiendo ? 'Obteniendo datos fiscales...' : 'Imprimir comprobante A4'}
        </button>

        {/* Enviar por email — solo comprobantes Empresa con CAE */}
        {(() => {
          if (!venta.centum_comprobante) return false
          const pagos = venta.pagos || []
          const tiposEf = ['efectivo', 'saldo', 'gift_card', 'cuenta_corriente']
          const soloEfectivo = pagos.length === 0 || pagos.every(p => tiposEf.includes((p.tipo || '').toLowerCase()))
          const condIva = venta.condicion_iva || 'CF'
          const esFacturaA = condIva === 'RI' || condIva === 'MT'
          const esPrueba = !esFacturaA && soloEfectivo
          return !esPrueba
        })() && (!mostrarEmailForm ? (
          <button
            onClick={() => {
              setMostrarEmailForm(true)
              setEmailInput(venta.email_cliente || '')
              setEmailMsg('')
            }}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Enviar comprobante por email
          </button>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Enviar por email</h3>
              <button onClick={() => setMostrarEmailForm(false)} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
            </div>
            <input
              type="email"
              value={emailInput}
              onChange={e => setEmailInput(e.target.value)}
              placeholder="Email del cliente"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              onKeyDown={e => {
                if (e.key === 'Enter' && emailInput.trim()) {
                  e.preventDefault()
                  document.getElementById('btn-enviar-email')?.click()
                }
              }}
            />
            <button
              id="btn-enviar-email"
              onClick={async () => {
                if (!emailInput.trim()) return
                setEnviandoEmail(true)
                setEmailMsg('')
                try {
                  const { data } = await api.post(`/api/pos/ventas/${id}/enviar-email`, { email: emailInput.trim() })
                  setEmailMsg(data.mensaje || 'Enviado correctamente')
                } catch (err) {
                  setEmailMsg('Error: ' + (err.response?.data?.error || err.message))
                } finally {
                  setEnviandoEmail(false)
                }
              }}
              disabled={enviandoEmail || !emailInput.trim()}
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {enviandoEmail ? 'Enviando...' : 'Enviar'}
            </button>
            {emailMsg && (
              <p className={`text-xs ${emailMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                {emailMsg}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default DetalleVenta
