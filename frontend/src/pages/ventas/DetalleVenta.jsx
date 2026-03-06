// Detalle de una venta POS
import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
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

const DetalleVenta = () => {
  const { id } = useParams()
  const { esAdmin } = useAuth()
  const [venta, setVenta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

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

  const items = typeof venta.items === 'string' ? JSON.parse(venta.items) : (venta.items || [])
  const promociones = typeof venta.promociones_aplicadas === 'string'
    ? JSON.parse(venta.promociones_aplicadas)
    : (venta.promociones_aplicadas || [])
  const pagos = venta.pagos || []
  const descFormaPago = venta.descuento_forma_pago

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar sinTabs titulo="Detalle Venta" volverA="/ventas" />

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Info general */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Informacion general</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Fecha</span>
            <span className="text-gray-800 font-medium">{formatFechaHora(venta.created_at)}</span>

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
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Items ({items.length})</h2>
          <div className="divide-y divide-gray-100">
            {items.map((item, i) => {
              const precioUnit = parseFloat(item.precioFinal || item.precio || 0)
              const cant = parseFloat(item.cantidad || 1)
              const subtotal = precioUnit * cant

              return (
                <div key={i} className="py-2 flex items-start justify-between gap-2">
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
        {descFormaPago && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">Descuento por forma de pago</h2>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-700">
                {MEDIOS_LABELS[descFormaPago.medio] || descFormaPago.medio}
                {descFormaPago.porcentaje ? ` (${descFormaPago.porcentaje}%)` : ''}
              </span>
              <span className="text-green-600 font-medium">-{formatPrecio(descFormaPago.monto || 0)}</span>
            </div>
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
      </div>
    </div>
  )
}

export default DetalleVenta
