import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../services/api'

const hoyISO = () => new Date().toISOString().split('T')[0]
const mananaISO = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

function estadoPago(obs) {
  if (!obs) return { label: 'No pagó', color: 'text-red-600 bg-red-50', cls: 'pago-nopago' }
  if (obs.includes('PAGO ANTICIPADO')) return { label: 'Pagó', color: 'text-green-700 bg-green-50', cls: 'pago-pagado' }
  if (obs.includes('PAGO EN ENTREGA: EFECTIVO')) return { label: 'Paga en efectivo', color: 'text-amber-700 bg-amber-50', cls: 'pago-efectivo' }
  return { label: 'No pagó', color: 'text-red-600 bg-red-50', cls: 'pago-nopago' }
}

export default function ModalGuiaDelivery({ onCerrar }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const printRef = useRef()

  useEffect(() => {
    setCargando(true)
    api.get('/api/pos/pedidos/guia-delivery', { params: { fecha } })
      .then(({ data }) => setPedidos(data.pedidos || []))
      .catch(err => console.error('Error cargando guía:', err))
      .finally(() => setCargando(false))
  }, [fecha])

  const pedidosAM = useMemo(() => pedidos.filter(p => p.turno_entrega === 'AM'), [pedidos])
  const pedidosPM = useMemo(() => pedidos.filter(p => p.turno_entrega === 'PM'), [pedidos])
  const pedidosSinTurno = useMemo(() => pedidos.filter(p => !p.turno_entrega || (p.turno_entrega !== 'AM' && p.turno_entrega !== 'PM')), [pedidos])

  function tieneNoPagados(lista) {
    return lista.some(p => {
      const obs = p.observaciones || ''
      return !obs.includes('PAGO ANTICIPADO') && !obs.includes('PAGO EN ENTREGA: EFECTIVO')
    })
  }

  const noPagadosAM = useMemo(() => tieneNoPagados(pedidosAM), [pedidosAM])
  const noPagadosPM = useMemo(() => tieneNoPagados(pedidosPM), [pedidosPM])

  const fechaFormateada = new Date(fecha + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  function handleImprimir(turno) {
    const lista = turno === 'AM' ? pedidosAM : turno === 'PM' ? pedidosPM : pedidos
    const tituloTurno = turno === 'AM' ? 'Turno AM — 9 a 13hs' : turno === 'PM' ? 'Turno PM — 17 a 21hs' : 'Todos los turnos'
    if (lista.length === 0) return
    const win = window.open('', '_blank')
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Guía de envíos ${turno || ''} - ${fechaFormateada}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; color: #333; }
          h1 { font-size: 16px; margin-bottom: 4px; }
          .fecha { font-size: 13px; color: #666; margin-bottom: 16px; }
          .turno { font-size: 14px; font-weight: bold; margin: 16px 0 8px; padding: 6px 10px; background: #f3f4f6; border-radius: 4px; }
          .turno-am { border-left: 4px solid #f59e0b; }
          .turno-pm { border-left: 4px solid #6366f1; }
          .turno-sin { border-left: 4px solid #9ca3af; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          th { text-align: left; font-size: 10px; text-transform: uppercase; color: #888; padding: 4px 8px; border-bottom: 2px solid #e5e7eb; }
          td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          .num { font-weight: bold; color: #7c3aed; }
          .items { font-size: 11px; color: #555; }
          .pago { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
          .pago-pagado { background: #d1fae5; color: #065f46; }
          .pago-efectivo { background: #fef3c7; color: #92400e; }
          .pago-nopago { background: #fee2e2; color: #991b1b; }
          .check-col { width: 30px; text-align: center; }
          .check-box { width: 16px; height: 16px; border: 2px solid #aaa; border-radius: 3px; display: inline-block; }
          .total-row { font-weight: bold; background: #f9fafb; }
          .resumen { margin-top: 16px; padding: 10px; background: #f9fafb; border-radius: 4px; font-size: 11px; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>Guía de envíos a domicilio — ${tituloTurno}</h1>
        <div class="fecha">${fechaFormateada} — ${lista.length} envío${lista.length !== 1 ? 's' : ''}</div>
        ${turno ? renderTurnoHTML(lista, turno, tituloTurno, turno === 'AM' ? 'turno-am' : 'turno-pm') : [
          renderTurnoHTML(pedidosAM, 'AM', 'Turno AM — 9 a 13hs', 'turno-am'),
          renderTurnoHTML(pedidosPM, 'PM', 'Turno PM — 17 a 21hs', 'turno-pm'),
          renderTurnoHTML(pedidosSinTurno, 'SIN', 'Sin turno asignado', 'turno-sin'),
        ].join('')}
      </body>
      </html>
    `)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 300)
  }

  function renderTurnoHTML(lista, key, titulo, cls) {
    if (lista.length === 0) return ''
    const rows = lista.map((p, i) => {
      const items = typeof p.items === 'string' ? JSON.parse(p.items) : p.items
      const resumenItems = items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ')
      const pago = estadoPago(p.observaciones)
      const pagoClass = pago.cls
      // Extract address from observaciones
      const obsMatch = (p.observaciones || '').match(/Dirección: ([^|]+)/)
      const direccion = obsMatch ? obsMatch[1].trim() : ''
      return `
        <tr>
          <td class="check-col"><div class="check-box"></div></td>
          <td class="num">#${p.numero || i + 1}</td>
          <td><strong>${p.nombre_cliente || 'S/N'}</strong><br/><span style="font-size:11px;color:#666">${direccion}</span></td>
          <td class="items">${resumenItems}</td>
          <td style="text-align:right;white-space:nowrap">${formatPrecio(p.total)}</td>
          <td><span class="pago ${pagoClass}">${pago.label}</span></td>
        </tr>
      `
    }).join('')
    return `
      <div class="turno ${cls}">${titulo} (${lista.length})</div>
      <table>
        <thead><tr>
          <th class="check-col"></th>
          <th>#</th>
          <th>Cliente / Dirección</th>
          <th>Artículos</th>
          <th style="text-align:right">Total</th>
          <th>Pago</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCerrar}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-amber-600 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-white font-semibold text-base">Guía de envíos</h2>
            <p className="text-amber-200 text-xs mt-0.5">Pedidos delivery por turno</p>
          </div>
          <button onClick={onCerrar} className="text-amber-200 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 border-b flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFecha(hoyISO())}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${fecha === hoyISO() ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Hoy
            </button>
            <button
              onClick={() => setFecha(mananaISO())}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${fecha === mananaISO() ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Mañana
            </button>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="text-sm border rounded-lg px-2.5 py-1.5 bg-white"
            />
          </div>
          <div className="flex-1" />
          <button
            onClick={() => handleImprimir(null)}
            disabled={pedidos.length === 0 || noPagadosAM || noPagadosPM}
            title={noPagadosAM || noPagadosPM ? 'Hay pedidos sin forma de pago definida' : ''}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
            </svg>
            Imprimir todo
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto" ref={printRef}>
          {cargando ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Cargando...
            </div>
          ) : pedidos.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
              </svg>
              No hay envíos delivery para esta fecha
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Resumen */}
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500">
                  <span className="font-semibold text-gray-800">{pedidos.length}</span> envío{pedidos.length !== 1 ? 's' : ''}
                </span>
                {pedidosAM.length > 0 && (
                  <span className="text-amber-600 font-medium">{pedidosAM.length} AM</span>
                )}
                {pedidosPM.length > 0 && (
                  <span className="text-indigo-600 font-medium">{pedidosPM.length} PM</span>
                )}
                <span className="text-gray-500 ml-auto">
                  Total: <span className="font-semibold text-gray-800">{formatPrecio(pedidos.reduce((s, p) => s + (p.total || 0), 0))}</span>
                </span>
              </div>

              {/* Turno AM */}
              {pedidosAM.length > 0 && (
                <TurnoSection
                  titulo="Turno AM — 9 a 13hs"
                  turno="AM"
                  pedidos={pedidosAM}
                  colorBorder="border-amber-400"
                  colorBg="bg-amber-50"
                  colorText="text-amber-700"
                  tieneNoPagados={noPagadosAM}
                  onImprimir={handleImprimir}
                />
              )}

              {/* Turno PM */}
              {pedidosPM.length > 0 && (
                <TurnoSection
                  titulo="Turno PM — 17 a 21hs"
                  turno="PM"
                  pedidos={pedidosPM}
                  colorBorder="border-indigo-400"
                  colorBg="bg-indigo-50"
                  colorText="text-indigo-700"
                  tieneNoPagados={noPagadosPM}
                  onImprimir={handleImprimir}
                />
              )}

              {/* Sin turno */}
              {pedidosSinTurno.length > 0 && (
                <TurnoSection
                  titulo="Sin turno asignado"
                  pedidos={pedidosSinTurno}
                  colorBorder="border-gray-300"
                  colorBg="bg-gray-50"
                  colorText="text-gray-600"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TurnoSection({ titulo, turno, pedidos, colorBorder, colorBg, colorText, tieneNoPagados, onImprimir }) {
  return (
    <div>
      <div className={`text-sm font-semibold ${colorText} ${colorBg} px-3 py-2 rounded-lg border-l-4 ${colorBorder} flex items-center justify-between`}>
        <span>{titulo} ({pedidos.length})</span>
        {onImprimir && (
          <button
            onClick={() => onImprimir(turno)}
            disabled={tieneNoPagados}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-medium bg-white/80 hover:bg-white disabled:opacity-40 transition-colors"
            title={tieneNoPagados ? 'Hay pedidos sin forma de pago definida' : `Imprimir guía ${turno}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
            </svg>
            Imprimir
          </button>
        )}
      </div>
      {tieneNoPagados && (
        <div className="mt-1 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-red-700 font-medium">Hay pedidos sin forma de pago — no se puede imprimir</span>
        </div>
      )}
      <div className="mt-2 space-y-2">
        {pedidos.map((p, idx) => {
          const items = typeof p.items === 'string' ? JSON.parse(p.items) : p.items
          const obsMatch = (p.observaciones || '').match(/Dirección: ([^|]+)/)
          const direccion = obsMatch ? obsMatch[1].trim() : ''
          const pago = estadoPago(p.observaciones)

          return (
            <div key={p.id} className="bg-white border rounded-lg px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                      #{p.numero || idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-gray-800 truncate">
                      {p.nombre_cliente || 'S/N'}
                    </span>
                    {pago && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${pago.color}`}>
                        {pago.label}
                      </span>
                    )}
                  </div>
                  {direccion && (
                    <div className="flex items-center gap-1 mt-1">
                      <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                      </svg>
                      <span className="text-xs text-gray-600">{direccion}</span>
                    </div>
                  )}
                  <div className="mt-1.5 text-xs text-gray-500">
                    {items.map(it => `${it.cantidad}x ${it.nombre}`).join(' · ')}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-sm font-bold text-gray-800">{formatPrecio(p.total)}</span>
                  <div className="text-[10px] text-gray-400 mt-0.5">{items.length} art.</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
