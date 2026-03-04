// Modal de cobro — POS
import React, { useState, useRef, useEffect } from 'react'
import api from '../../services/api'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

function calcularPrecioConDescuentosBase(articulo) {
  let precio = articulo.precio || 0
  if (articulo.descuento1) precio *= (1 - articulo.descuento1 / 100)
  if (articulo.descuento2) precio *= (1 - articulo.descuento2 / 100)
  if (articulo.descuento3) precio *= (1 - articulo.descuento3 / 100)
  return precio
}

const BILLETES_RAPIDOS = [1000, 2000, 5000, 10000, 20000]

const ModalCobrar = ({ total, subtotal, descuentoTotal, ivaTotal, carrito, cliente, promosAplicadas, onConfirmar, onCerrar }) => {
  const [montoPagado, setMontoPagado] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [ventaCreada, setVentaCreada] = useState(null)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const montoNum = parseFloat(montoPagado) || 0
  const vuelto = montoNum - total
  const montoSuficiente = montoNum >= total

  async function confirmarVenta() {
    if (!montoSuficiente) return
    setGuardando(true)
    setError('')

    try {
      const items = carrito.map(i => ({
        id_articulo: i.articulo.id,
        codigo: i.articulo.codigo,
        nombre: i.articulo.nombre,
        precio_unitario: calcularPrecioConDescuentosBase(i.articulo),
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

      const { data } = await api.post('/api/pos/ventas', {
        id_cliente_centum: cliente.id_centum,
        nombre_cliente: cliente.razon_social,
        items,
        promociones_aplicadas: promosParaGuardar.length > 0 ? promosParaGuardar : null,
        subtotal,
        descuento_total: descuentoTotal,
        total,
        monto_pagado: montoNum,
        vuelto: vuelto > 0 ? vuelto : 0,
      })

      setVentaCreada(data.venta)
    } catch (err) {
      console.error('Error al guardar venta:', err)
      setError(err.response?.data?.error || 'Error al guardar la venta')
    } finally {
      setGuardando(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && montoSuficiente && !guardando && !ventaCreada) {
      confirmarVenta()
    }
  }

  function agregarBillete(valor) {
    setMontoPagado(prev => String((parseFloat(prev) || 0) + valor))
  }

  // Vista de confirmación
  if (ventaCreada) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">Venta registrada</h3>
          <p className="text-gray-500 text-sm mb-4">{cliente.razon_social}</p>

          <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-semibold">{formatPrecio(total)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Pagado</span>
              <span className="font-semibold">{formatPrecio(montoNum)}</span>
            </div>
            {vuelto > 0 && (
              <div className="flex justify-between text-lg font-bold text-green-600 pt-1 border-t mt-1">
                <span>Vuelto</span>
                <span>{formatPrecio(vuelto)}</span>
              </div>
            )}
          </div>

          <button
            onClick={onConfirmar}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Nueva venta
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-800">Cobrar</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Resumen */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Subtotal</span>
              <span>{formatPrecio(subtotal)}</span>
            </div>
            {descuentoTotal > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Descuentos</span>
                <span>-{formatPrecio(descuentoTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-gray-500">
              <span>IVA</span>
              <span>{formatPrecio(ivaTotal)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold text-gray-800 pt-2 border-t mt-1">
              <span>TOTAL</span>
              <span>{formatPrecio(total)}</span>
            </div>
          </div>

          {/* Monto recibido */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Monto recibido (efectivo)</label>
            <input
              ref={inputRef}
              type="number"
              value={montoPagado}
              onChange={e => setMontoPagado(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="0"
              className="w-full border-2 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              min="0"
              step="0.01"
            />
          </div>

          {/* Billetes rápidos */}
          <div className="flex flex-wrap gap-2">
            {BILLETES_RAPIDOS.map(b => (
              <button
                key={b}
                onClick={() => agregarBillete(b)}
                className="flex-1 min-w-[60px] bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium py-2 rounded-lg transition-colors"
              >
                +{(b / 1000).toFixed(0)}k
              </button>
            ))}
            <button
              onClick={() => setMontoPagado(String(Math.ceil(total)))}
              className="flex-1 min-w-[60px] bg-violet-100 hover:bg-violet-200 text-violet-700 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Exacto
            </button>
          </div>

          {/* Vuelto */}
          {montoNum > 0 && (
            <div className={`text-center py-3 rounded-xl text-xl font-bold ${
              montoSuficiente ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}>
              {montoSuficiente
                ? <>Vuelto: {formatPrecio(vuelto)}</>
                : <>Falta: {formatPrecio(Math.abs(vuelto))}</>
              }
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Botón confirmar */}
          <button
            onClick={confirmarVenta}
            disabled={!montoSuficiente || guardando}
            className={`w-full font-bold py-3 rounded-xl text-lg transition-colors ${
              montoSuficiente && !guardando
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {guardando ? 'Guardando...' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ModalCobrar
