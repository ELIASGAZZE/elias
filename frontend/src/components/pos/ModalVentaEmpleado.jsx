import React, { useState, useEffect, useRef, useMemo } from 'react'
import api from '../../services/api'

const formatPrecio = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0)

// Impresión 80mm
const PRINT_STYLES = `
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 22px; width: 302px; padding: 8px; line-height: 1.4; }
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

const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const formatMonto = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n || 0)

function imprimirHTML(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;left:-9999px'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_STYLES}</style></head><body>${html}</body></html>`)
  doc.close()
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print() } catch {}
    setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 2000)
  }, 100)
}

function imprimirComprobantes(empleado, items, total) {
  const ahora = new Date()
  const fecha = `${ahora.toLocaleDateString('es-AR')} ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`

  function buildTicket(tipo) {
    let html = ''
    html += '<div class="center titulo">PADANO SRL</div>'
    html += `<div class="center bold" style="font-size:20px;margin-bottom:4px">${tipo === 'firma' ? 'RETIRO DE MERCADERIA' : 'COMPROBANTE - RETIRO EMPLEADO'}</div>`
    html += '<div class="line-double"></div>'
    html += `<div style="font-size:20px">${escapeHtml(fecha)}</div>`
    html += `<div style="font-size:20px">Empleado: ${escapeHtml(empleado.nombre)} (${escapeHtml(empleado.codigo)})</div>`
    html += '<div class="line"></div>'

    items.forEach(item => {
      const lineTotal = (item.precio_final || item.precio_original) * item.cantidad
      html += `<div style="font-size:20px">${escapeHtml(item.nombre)}</div>`
      if (item.descuento_pct > 0) {
        html += `<div class="row" style="font-size:18px;padding-left:8px"><span>${item.cantidad} x ${formatMonto(item.precio_original)} (-${item.descuento_pct}%)</span><span>${formatMonto(lineTotal)}</span></div>`
      } else {
        html += `<div class="row" style="font-size:20px;padding-left:8px"><span>${item.cantidad} x ${formatMonto(item.precio_final)}</span><span>${formatMonto(lineTotal)}</span></div>`
      }
    })

    html += '<div class="line"></div>'
    html += `<div class="row total"><span>TOTAL</span><span>${formatMonto(total)}</span></div>`
    html += '<div class="line-double"></div>'

    if (tipo === 'firma') {
      html += '<div class="center" style="font-size:18px;margin-top:8px">Declaro haber retirado la mercaderia detallada en este comprobante.</div>'
      html += '<div class="firma">Firma empleado: _______________</div>'
      html += '<div style="text-align:center;font-size:18px;margin-top:4px">Aclaracion: _______________</div>'
      html += '<div style="text-align:center;font-size:18px;margin-top:4px">DNI: _______________</div>'
    } else {
      html += '<div class="center" style="font-size:18px;margin-top:8px">Este importe sera descontado de su sueldo.</div>'
      html += '<div class="center" style="font-size:16px;margin-top:4px">Conserve este comprobante.</div>'
    }

    return html
  }

  // Imprimir comprobante del empleado primero, luego el de firma
  imprimirHTML(buildTicket('empleado'))
  setTimeout(() => imprimirHTML(buildTicket('firma')), 1500)
}

const ModalVentaEmpleado = ({ carrito, calcularPrecioConDescuentosBase, onCerrar, onExito, terminalConfig }) => {
  const [paso, setPaso] = useState('codigo') // 'codigo' | 'resumen' | 'confirmar' | 'guardando'
  const [codigoEmpleado, setCodigoEmpleado] = useState('')
  const [empleado, setEmpleado] = useState(null)
  const [error, setError] = useState('')
  const [descuentos, setDescuentos] = useState({}) // { rubroNombre: porcentaje }
  const [codigoConfirm, setCodigoConfirm] = useState('')
  const inputRef = useRef(null)
  const inputConfirmRef = useRef(null)

  useEffect(() => {
    // Cargar descuentos por rubro
    api.get('/api/cuenta-empleados/descuentos').then(({ data }) => {
      const map = {}
      ;(data || []).forEach(d => { map[d.rubro] = d.porcentaje })
      setDescuentos(map)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (paso === 'codigo') setTimeout(() => inputRef.current?.focus(), 100)
    if (paso === 'confirmar') setTimeout(() => inputConfirmRef.current?.focus(), 100)
  }, [paso])

  // Items con descuento empleado aplicado
  const itemsConDescuento = useMemo(() => {
    return carrito.map(item => {
      const art = item.articulo
      const precioBase = calcularPrecioConDescuentosBase(art)
      const rubroNombre = art.rubro?.nombre || ''
      const descPct = descuentos[rubroNombre] || 0
      const precioFinal = descPct > 0 ? Math.round(precioBase * (1 - descPct / 100) * 100) / 100 : precioBase

      return {
        articulo_id: art.id,
        id_centum: art.id_centum,
        codigo: art.codigo,
        nombre: art.nombre,
        rubro: rubroNombre,
        cantidad: item.cantidad,
        precio_original: precioBase,
        descuento_pct: descPct,
        precio_final: precioFinal,
        subtotal: Math.round(precioFinal * item.cantidad * 100) / 100,
        iva_tasa: art.iva_tasa || 21,
      }
    })
  }, [carrito, descuentos, calcularPrecioConDescuentosBase])

  const totalConDescuento = useMemo(() =>
    itemsConDescuento.reduce((s, i) => s + i.subtotal, 0),
    [itemsConDescuento]
  )

  const validarEmpleado = async () => {
    setError('')
    if (!codigoEmpleado.trim()) {
      setError('Ingresá el código del empleado')
      return
    }
    try {
      const { data } = await api.get(`/api/empleados/por-codigo/${codigoEmpleado.trim()}`)
      setEmpleado(data)
      setPaso('resumen')
    } catch (err) {
      setError(err.response?.data?.error || 'Empleado no encontrado')
    }
  }

  const confirmarVenta = async () => {
    setError('')
    if (codigoConfirm.trim() !== codigoEmpleado.trim()) {
      setError('El código no coincide')
      return
    }

    setPaso('guardando')
    try {
      const { data } = await api.post('/api/cuenta-empleados/ventas', {
        codigo_empleado: codigoEmpleado.trim(),
        items: itemsConDescuento,
        total: totalConDescuento,
        sucursal_id: terminalConfig?.sucursalId || null,
        caja_id: terminalConfig?.cajaId || null,
      })

      // Imprimir 2 comprobantes
      imprimirComprobantes(data.empleado || empleado, itemsConDescuento, totalConDescuento)

      onExito(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar la venta')
      setPaso('confirmar')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-800">Venta a empleado</h3>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Paso 1: Código empleado */}
        {paso === 'codigo' && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600">Ingresá el código del empleado para aplicar descuentos y registrar a cuenta corriente.</p>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Código empleado</label>
              <input
                ref={inputRef}
                type="text"
                value={codigoEmpleado}
                onChange={e => setCodigoEmpleado(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && validarEmpleado()}
                placeholder="Ingresá el código..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-center text-lg font-mono focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"
                autoComplete="off"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={validarEmpleado}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Validar
            </button>
          </div>
        )}

        {/* Paso 2: Resumen con descuentos */}
        {paso === 'resumen' && empleado && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Info empleado */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <svg className="w-5 h-5 text-orange-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-gray-800">{empleado.nombre}</p>
                <p className="text-xs text-gray-500">Código: {codigoEmpleado}</p>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-1">
              {itemsConDescuento.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{item.nombre}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{item.cantidad} x {formatPrecio(item.precio_final)}</span>
                      {item.descuento_pct > 0 && (
                        <span className="text-orange-600 font-medium">-{item.descuento_pct}%</span>
                      )}
                      {item.descuento_pct > 0 && (
                        <span className="line-through text-gray-400">{formatPrecio(item.precio_original)}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-gray-700 ml-2">{formatPrecio(item.subtotal)}</span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="bg-gray-50 rounded-lg px-3 py-2.5 flex items-center justify-between">
              <span className="font-semibold text-gray-700">Total a cta. cte.</span>
              <span className="text-lg font-bold text-orange-600">{formatPrecio(totalConDescuento)}</span>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setPaso('codigo'); setError('') }}
                className="flex-1 text-sm py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Volver
              </button>
              <button
                onClick={() => { setPaso('confirmar'); setError('') }}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        {/* Paso 3: Confirmación con código */}
        {paso === 'confirmar' && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600">
              Para confirmar el retiro de <strong>{formatPrecio(totalConDescuento)}</strong>, el empleado <strong>{empleado?.nombre}</strong> debe ingresar su código nuevamente.
            </p>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Código empleado (confirmación)</label>
              <input
                ref={inputConfirmRef}
                type="password"
                value={codigoConfirm}
                onChange={e => setCodigoConfirm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmarVenta()}
                placeholder="Ingresá el código..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-center text-lg font-mono focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"
                autoComplete="off"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => { setPaso('resumen'); setError(''); setCodigoConfirm('') }}
                className="flex-1 text-sm py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Volver
              </button>
              <button
                onClick={confirmarVenta}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
              >
                Confirmar retiro
              </button>
            </div>
          </div>
        )}

        {/* Paso 4: Guardando */}
        {paso === 'guardando' && (
          <div className="p-8 flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
            <p className="text-sm text-gray-600">Registrando venta a cuenta corriente...</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ModalVentaEmpleado
