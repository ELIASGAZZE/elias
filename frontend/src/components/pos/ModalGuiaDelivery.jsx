import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../services/api'
import { imprimirTicketsDeliveryBatch } from '../../utils/imprimirComprobante'

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

export default function ModalGuiaDelivery({ onCerrar, cajaId: cajaIdProp }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [guiasExistentes, setGuiasExistentes] = useState([])
  const printRef = useRef()

  // Popup despacho
  const [mostrarDespacho, setMostrarDespacho] = useState(null) // 'AM' | 'PM' | null
  const [cadeteNombre, setCadeteNombre] = useState('')
  const [cambioEntregado, setCambioEntregado] = useState('')
  const [despachando, setDespachando] = useState(false)
  const [descEfectivoPct, setDescEfectivoPct] = useState(0)

  // Cargar promo descuento efectivo
  useEffect(() => {
    api.get('/api/pos/promociones').then(({ data }) => {
      const promos = data?.promociones || data || []
      const promo = promos.find(p => p.activa && p.tipo === 'forma_pago' && (p.reglas?.forma_cobro_nombre || '').toLowerCase() === 'efectivo')
      if (promo) setDescEfectivoPct(parseFloat(promo.reglas?.valor) || 0)
    }).catch(err => console.error('Error loading promotions:', err.message))
  }, [])

  useEffect(() => {
    setCargando(true)
    Promise.all([
      api.get('/api/pos/pedidos/guia-delivery', { params: { fecha } }),
      api.get('/api/pos/guias-delivery', { params: { fecha } }),
    ])
      .then(([pedidosRes, guiasRes]) => {
        setPedidos(pedidosRes.data.pedidos || [])
        setGuiasExistentes(guiasRes.data || [])
      })
      .catch(err => console.error('Error cargando guía:', err))
      .finally(() => setCargando(false))
  }, [fecha])

  const pedidosAM = useMemo(() => pedidos.filter(p => p.turno_entrega === 'AM'), [pedidos])
  const pedidosPM = useMemo(() => pedidos.filter(p => p.turno_entrega === 'PM'), [pedidos])
  const pedidosSinTurno = useMemo(() => pedidos.filter(p => !p.turno_entrega || (p.turno_entrega !== 'AM' && p.turno_entrega !== 'PM')), [pedidos])

  const guiaAM = useMemo(() => guiasExistentes.find(g => g.turno === 'AM'), [guiasExistentes])
  const guiaPM = useMemo(() => guiasExistentes.find(g => g.turno === 'PM'), [guiasExistentes])

  // Helper: total efectivo con descuento aplicado para una lista de pedidos
  function calcTotalEfectivoConDesc(lista) {
    return lista.filter(p => (p.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO'))
      .reduce((s, p) => {
        const t = parseFloat(p.total) || 0
        const desc = descEfectivoPct > 0 ? Math.round(t * descEfectivoPct / 100 * 100) / 100 : 0
        return s + Math.round((t - desc) * 100) / 100
      }, 0)
  }

  function totalConDescuento(pedido) {
    const obs = pedido.observaciones || ''
    const t = parseFloat(pedido.total) || 0
    if (obs.includes('PAGO EN ENTREGA: EFECTIVO') && descEfectivoPct > 0) {
      const desc = Math.round(t * descEfectivoPct / 100 * 100) / 100
      return Math.round((t - desc) * 100) / 100
    }
    return t
  }

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

  async function handleDespachar() {
    if (!mostrarDespacho) return
    setDespachando(true)
    try {
      const { data } = await api.post('/api/pos/guias-delivery/despachar', {
        fecha,
        turno: mostrarDespacho,
        cadete_id: null,
        cadete_nombre: cadeteNombre || null,
        cambio_entregado: parseFloat(cambioEntregado) || 0,
        caja_id: cajaIdProp,
      })

      // Imprimir guía del cadete
      imprimirGuiaCadete(mostrarDespacho, data)

      // Imprimir tickets de las ventas en comandera (80mm)
      if (data.ventas_creadas && data.ventas_creadas.length > 0) {
        setTimeout(() => {
          imprimirTicketsDeliveryBatch(data.ventas_creadas, data.punto_venta)
        }, 1000)
      }

      // Recargar datos
      setMostrarDespacho(null)
      setCadeteNombre('')
      setCambioEntregado('')
      const [pedidosRes, guiasRes] = await Promise.all([
        api.get('/api/pos/pedidos/guia-delivery', { params: { fecha } }),
        api.get('/api/pos/guias-delivery', { params: { fecha } }),
      ])
      setPedidos(pedidosRes.data.pedidos || [])
      setGuiasExistentes(guiasRes.data || [])
    } catch (err) {
      alert(err.response?.data?.error || 'Error al despachar')
    } finally {
      setDespachando(false)
    }
  }

  function imprimirGuiaCadete(turno, datosDespacho) {
    const lista = turno === 'AM' ? pedidosAM : pedidosPM
    const tituloTurno = turno === 'AM' ? 'Turno AM — 9 a 13hs' : 'Turno PM — 17 a 21hs'
    const cambio = parseFloat(cambioEntregado) || 0
    const totalEfectivo = datosDespacho.total_efectivo || 0
    const totalDescuento = datosDespacho.total_descuento || 0
    const descPct = datosDespacho.descuento_efectivo_pct || 0
    const totalADevolver = datosDespacho.total_a_devolver || 0

    const win = window.open('', '_blank')
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Guía de envíos ${turno} - ${fechaFormateada}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; color: #333; }
          h1 { font-size: 16px; margin-bottom: 4px; }
          .fecha { font-size: 13px; color: #666; margin-bottom: 4px; }
          .cadete { font-size: 13px; font-weight: bold; margin-bottom: 16px; }
          .cambio-box { background: #f3f4f6; border: 2px solid #333; border-radius: 6px; padding: 10px; margin-bottom: 16px; font-size: 14px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          th { text-align: left; font-size: 10px; text-transform: uppercase; color: #888; padding: 4px 8px; border-bottom: 2px solid #e5e7eb; }
          td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          .num { font-weight: bold; color: #7c3aed; }
          .items { font-size: 11px; color: #555; }
          .pago { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
          .pago-pagado { background: #d1fae5; color: #065f46; }
          .pago-efectivo { background: #fef3c7; color: #92400e; }
          .check-col { width: 30px; text-align: center; }
          .check-box { width: 16px; height: 16px; border: 2px solid #aaa; border-radius: 3px; display: inline-block; }
          .resumen { margin-top: 20px; border: 2px solid #333; border-radius: 6px; padding: 14px; font-size: 13px; }
          .resumen-row { display: flex; justify-content: space-between; padding: 4px 0; }
          .resumen-total { font-size: 16px; font-weight: bold; border-top: 2px solid #333; padding-top: 8px; margin-top: 8px; }
          .firmas { margin-top: 30px; display: flex; gap: 40px; }
          .firma { flex: 1; border-top: 1px solid #333; padding-top: 6px; font-size: 11px; text-align: center; }
          .no-entregados { margin-top: 20px; font-size: 11px; }
          .no-entregados-line { border-bottom: 1px dotted #999; padding: 6px 0; margin-bottom: 4px; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <h1>Guía de envíos a domicilio — ${tituloTurno}</h1>
        <div class="fecha">${fechaFormateada} — ${lista.length} envío${lista.length !== 1 ? 's' : ''}</div>
        <div class="cadete">Cadete: ${cadeteNombre || 'Sin asignar'}</div>

        ${cambio > 0 ? `<div class="cambio-box">CAMBIO ENTREGADO: ${formatPrecio(cambio)}</div>` : ''}

        <table>
          <thead><tr>
            <th class="check-col"></th>
            <th>#</th>
            <th>Cliente / Dirección</th>
            <th>Artículos</th>
            <th style="text-align:right">Total</th>
            <th>Pago</th>
          </tr></thead>
          <tbody>
            ${lista.map((p, i) => {
              const items = typeof p.items === 'string' ? JSON.parse(p.items) : p.items
              const resumenItems = items.map(it => `${it.cantidad}x ${it.nombre}`).join(', ')
              const pago = estadoPago(p.observaciones)
              const obsMatch = (p.observaciones || '').match(/Dirección: ([^|]+)/)
              const direccion = obsMatch ? obsMatch[1].trim() : ''
              const esEfectivo = (p.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO')
              const totalMostrar = totalConDescuento(p)
              const tieneDesc = esEfectivo && descPct > 0 && totalMostrar !== (parseFloat(p.total) || 0)
              return `
                <tr>
                  <td class="check-col"><div class="check-box"></div></td>
                  <td class="num">#${p.numero || i + 1}</td>
                  <td><strong>${p.nombre_cliente || 'S/N'}</strong><br/><span style="font-size:11px;color:#666">${direccion}</span></td>
                  <td class="items">${resumenItems}</td>
                  <td style="text-align:right;white-space:nowrap">${tieneDesc ? `<s style="color:#999;font-size:10px">${formatPrecio(p.total)}</s><br/>` : ''}${formatPrecio(totalMostrar)}</td>
                  <td><span class="pago ${pago.cls}">${esEfectivo ? 'COBRAR' : 'YA PAGÓ'}</span></td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>

        <div class="resumen">
          ${totalDescuento > 0 ? `<div class="resumen-row"><span>Desc. efectivo (${descPct}%):</span> <span>- ${formatPrecio(totalDescuento)}</span></div>` : ''}
          <div class="resumen-row"><span>Total a cobrar en efectivo:</span> <span>${formatPrecio(totalEfectivo)}</span></div>
          ${cambio > 0 ? `<div class="resumen-row"><span>Cambio entregado:</span> <span>+ ${formatPrecio(cambio)}</span></div>` : ''}
          <div class="resumen-row resumen-total"><span>TOTAL A DEVOLVER:</span> <span>${formatPrecio(totalADevolver)}</span></div>
        </div>

        <div class="no-entregados">
          <strong>Pedidos no entregados:</strong>
          <div class="no-entregados-line">[ ] #_____ Motivo: _________________________________</div>
          <div class="no-entregados-line">[ ] #_____ Motivo: _________________________________</div>
          <div class="no-entregados-line">[ ] #_____ Motivo: _________________________________</div>
        </div>

        <div class="firmas">
          <div class="firma">Firma cadete</div>
          <div class="firma">Firma receptor buzón</div>
        </div>
      </body>
      </html>
    `)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 300)
  }

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
      const obsMatch = (p.observaciones || '').match(/Dirección: ([^|]+)/)
      const direccion = obsMatch ? obsMatch[1].trim() : ''
      const totalMostrar = totalConDescuento(p)
      const esEfectivo = (p.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO')
      const tieneDesc = esEfectivo && descEfectivoPct > 0 && totalMostrar !== (parseFloat(p.total) || 0)
      return `
        <tr>
          <td class="check-col"><div class="check-box"></div></td>
          <td class="num">#${p.numero || i + 1}</td>
          <td><strong>${p.nombre_cliente || 'S/N'}</strong><br/><span style="font-size:11px;color:#666">${direccion}</span></td>
          <td class="items">${resumenItems}</td>
          <td style="text-align:right;white-space:nowrap">${tieneDesc ? `<s style="color:#999;font-size:10px">${formatPrecio(p.total)}</s><br/>` : ''}${formatPrecio(totalMostrar)}</td>
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
          ) : pedidos.length === 0 && !guiaAM && !guiaPM ? (
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
                  <span className="font-semibold text-gray-800">{pedidos.length}</span> pendiente{pedidos.length !== 1 ? 's' : ''}
                </span>
                {pedidosAM.length > 0 && (
                  <span className="text-amber-600 font-medium">{pedidosAM.length} AM</span>
                )}
                {pedidosPM.length > 0 && (
                  <span className="text-indigo-600 font-medium">{pedidosPM.length} PM</span>
                )}
                <span className="text-gray-500 ml-auto">
                  Total: <span className="font-semibold text-gray-800">{formatPrecio(pedidos.reduce((s, p) => s + totalConDescuento(p), 0))}</span>
                </span>
              </div>

              {/* Guías ya despachadas */}
              {guiaAM && (
                <GuiaDespachada guia={guiaAM} turno="AM" />
              )}
              {guiaPM && (
                <GuiaDespachada guia={guiaPM} turno="PM" />
              )}

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
                  onDespachar={() => setMostrarDespacho('AM')}
                  yaDespacho={!!guiaAM}
                  calcTotal={totalConDescuento}
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
                  onDespachar={() => setMostrarDespacho('PM')}
                  yaDespacho={!!guiaPM}
                  calcTotal={totalConDescuento}
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

      {/* Popup despacho */}
      {mostrarDespacho && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setMostrarDespacho(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              Despachar turno {mostrarDespacho}
            </h3>

            <div className="space-y-4">
              {/* Resumen */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Pedidos:</span>
                  <span className="font-medium">{mostrarDespacho === 'AM' ? pedidosAM.length : pedidosPM.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Total efectivo a cobrar{descEfectivoPct > 0 ? ` (${descEfectivoPct}% desc.)` : ''}:</span>
                  <span className="font-medium text-amber-700">
                    {formatPrecio(calcTotalEfectivoConDesc(mostrarDespacho === 'AM' ? pedidosAM : pedidosPM))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pagos anticipados:</span>
                  <span className="font-medium text-green-700">
                    {formatPrecio((mostrarDespacho === 'AM' ? pedidosAM : pedidosPM)
                      .filter(p => (p.observaciones || '').includes('PAGO ANTICIPADO'))
                      .reduce((s, p) => s + (p.total || 0), 0))}
                  </span>
                </div>
              </div>

              {/* Cadete */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Nombre del cadete</label>
                <input
                  type="text"
                  value={cadeteNombre}
                  onChange={e => setCadeteNombre(e.target.value)}
                  placeholder="Ej: Pablo"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Cambio */}
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Cambio entregado al cadete</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    value={cambioEntregado}
                    onChange={e => setCambioEntregado(e.target.value)}
                    placeholder="0"
                    min="0"
                    className="w-full text-sm border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {/* Total a devolver */}
              {(parseFloat(cambioEntregado) > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                  <div className="flex justify-between font-semibold text-amber-800">
                    <span>Total que debe devolver el cadete:</span>
                    <span>{formatPrecio(
                      calcTotalEfectivoConDesc(mostrarDespacho === 'AM' ? pedidosAM : pedidosPM) + (parseFloat(cambioEntregado) || 0)
                    )}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setMostrarDespacho(null)}
                className="flex-1 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 py-2.5 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDespachar}
                disabled={despachando || !cajaIdProp}
                className="flex-1 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 py-2.5 rounded-lg transition-colors"
              >
                {despachando ? 'Despachando...' : 'Despachar e imprimir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function GuiaDespachada({ guia, turno }) {
  const estadoColor = guia.estado === 'cerrada' ? 'bg-green-50 border-green-300 text-green-800'
    : guia.estado === 'con_diferencia' ? 'bg-red-50 border-red-300 text-red-800'
    : 'bg-blue-50 border-blue-300 text-blue-800'

  const estadoLabel = guia.estado === 'cerrada' ? 'Cerrada'
    : guia.estado === 'con_diferencia' ? 'Con diferencia'
    : 'Despachada — pendiente verificación en Control Caja'

  const cambio = parseFloat(guia.cambio_entregado) || 0
  const totalADevolver = (parseFloat(guia.total_efectivo) || 0) + cambio

  return (
    <div className={`rounded-lg border p-3 text-sm ${estadoColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-semibold">Turno {turno} — {estadoLabel}</span>
        </div>
        <span className="text-xs">{guia.cantidad_pedidos} pedidos · {guia.cadete_nombre || 'Sin cadete'}</span>
      </div>
      <div className="flex gap-4 mt-1 text-xs opacity-80">
        <span>Efectivo: {formatPrecio(guia.total_efectivo)}</span>
        {cambio > 0 && <span>Cambio: {formatPrecio(cambio)}</span>}
        <span className="font-semibold">A devolver: {formatPrecio(totalADevolver)}</span>
      </div>
    </div>
  )
}

function TurnoSection({ titulo, turno, pedidos, colorBorder, colorBg, colorText, tieneNoPagados, onImprimir, onDespachar, yaDespacho, calcTotal }) {
  return (
    <div>
      <div className={`text-sm font-semibold ${colorText} ${colorBg} px-3 py-2 rounded-lg border-l-4 ${colorBorder} flex items-center justify-between`}>
        <span>{titulo} ({pedidos.length})</span>
        <div className="flex items-center gap-2">
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
          {onDespachar && !yaDespacho && (
            <button
              onClick={onDespachar}
              disabled={tieneNoPagados}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
              title={tieneNoPagados ? 'Hay pedidos sin forma de pago definida' : `Despachar turno ${turno}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.079-.504 1.004-1.1A17.05 17.05 0 0015.064 8.39a2.25 2.25 0 00-1.89-1.014H12m-1.5 11.374h6" />
              </svg>
              Despachar
            </button>
          )}
        </div>
      </div>
      {tieneNoPagados && (
        <div className="mt-1 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-red-700 font-medium">Hay pedidos sin forma de pago — no se puede despachar</span>
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
                  <span className="text-sm font-bold text-gray-800">{formatPrecio(calcTotal ? calcTotal(p) : p.total)}</span>
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
