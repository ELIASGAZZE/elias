// Página de Pedidos POS — ventana separada del POS
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import ModalArticulosPedidos from '../../components/pos/ModalArticulosPedidos'
import ModalGuiaDelivery from '../../components/pos/ModalGuiaDelivery'
import ModalTarjetasRegalo from '../../components/pos/ModalTarjetasRegalo'

const formatPrecio = (n) => {
  if (n == null) return '$0'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
}

const FILTROS_ESTADO = [
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'entregado', label: 'Entregados' },
  { value: 'cancelado', label: 'Cancelados' },
  { value: 'todos', label: 'Todos' },
]

const hoyISO = () => new Date().toISOString().split('T')[0]

const FILTROS_KEY = 'pedidos_pos_filtros'

function getFiltrosGuardados(defaultSucursal) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FILTROS_KEY))
    if (saved) return saved
  } catch {}
  return { estado: 'pendiente', fecha: '', sucursal: '' }
}

const PedidosPOS = ({ embebido, terminalConfig, onEntregarPedido, onEditarPedido, onCobrarEnCaja }) => {
  const { usuario, esAdmin } = useAuth()
  const filtrosIniciales = getFiltrosGuardados(terminalConfig?.sucursal_id)
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtroEstado, setFiltroEstado] = useState(filtrosIniciales.estado)
  const [filtroFecha, setFiltroFecha] = useState(filtrosIniciales.fecha)
  const [filtroSucursal, setFiltroSucursal] = useState(filtrosIniciales.sucursal)
  const [filtroTipo, setFiltroTipo] = useState(filtrosIniciales.tipo || 'todos')
  const [filtroPago, setFiltroPago] = useState(filtrosIniciales.pago || 'todos')
  const [sucursales, setSucursales] = useState([])
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [generandoLink, setGenerandoLink] = useState(null)
  const [linkCopiado, setLinkCopiado] = useState(null)
  const [mostrarArticulos, setMostrarArticulos] = useState(false)
  const [mostrarGuiaDelivery, setMostrarGuiaDelivery] = useState(false)
  const [mostrarTarjetasRegalo, setMostrarTarjetasRegalo] = useState(false)
  const [editObsPedido, setEditObsPedido] = useState('')
  const [editTarjeta, setEditTarjeta] = useState('')
  const [editObsEntrega, setEditObsEntrega] = useState('')
  const [guardandoExtras, setGuardandoExtras] = useState(false)

  // Cargar sucursales para el dropdown
  useEffect(() => {
    api.get('/api/sucursales')
      .then(({ data }) => setSucursales((data || []).filter(s => s.permite_pedidos)))
      .catch(err => console.error('Error loading sucursales:', err.message))
  }, [])

  // Persistir filtros en sessionStorage
  useEffect(() => {
    sessionStorage.setItem(FILTROS_KEY, JSON.stringify({ estado: filtroEstado, fecha: filtroFecha, sucursal: filtroSucursal, tipo: filtroTipo, pago: filtroPago }))
  }, [filtroEstado, filtroFecha, filtroSucursal, filtroTipo, filtroPago])

  // Debounce de búsqueda (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setBusquedaDebounced(busqueda), 400)
    return () => clearTimeout(timer)
  }, [busqueda])

  const cargarPedidos = useCallback(async () => {
    setCargando(true)
    try {
      const params = { estado: filtroEstado }
      if (filtroTipo !== 'todos') params.tipo = filtroTipo
      if (busquedaDebounced.trim()) {
        // Con búsqueda: solo filtrar por estado + nombre (ignorar fecha/sucursal)
        params.busqueda = busquedaDebounced.trim()
      } else {
        // Sin búsqueda: aplicar filtros de fecha y sucursal
        if (filtroFecha) params.fecha = filtroFecha
        if (filtroSucursal) params.sucursal_id = filtroSucursal
      }
      const { data } = await api.get('/api/pos/pedidos', { params })
      setPedidos(data.pedidos || [])
    } catch (err) {
      console.error('Error cargando pedidos:', err)
    } finally {
      setCargando(false)
    }
  }, [filtroEstado, filtroFecha, filtroSucursal, filtroTipo, busquedaDebounced])

  useEffect(() => {
    cargarPedidos()
  }, [cargarPedidos])

  // Filtrar por estado de pago (client-side)
  const pedidosFiltrados = useMemo(() => {
    if (filtroPago === 'todos') return pedidos
    return pedidos.filter(p => {
      const obs = p.observaciones || ''
      const totalPagado = parseFloat(p.total_pagado) || 0
      const esPagado = obs.includes('PAGO ANTICIPADO') || obs.includes('TALO PAY') || totalPagado > 0
      const pagaEfectivo = obs.includes('PAGO EN ENTREGA: EFECTIVO')
      if (filtroPago === 'pago') return esPagado
      if (filtroPago === 'efectivo') return pagaEfectivo
      if (filtroPago === 'no_pago') return !esPagado && !pagaEfectivo
      return true
    })
  }, [pedidos, filtroPago])

  // Tarjetas de regalo para hoy
  const tarjetasHoy = useMemo(() => {
    const hoy = new Date().toISOString().split('T')[0]
    return pedidos
      .filter(p => p.tarjeta_regalo && p.estado === 'pendiente' && p.fecha_entrega === hoy)
      .map(p => ({ numero: p.numero, cliente: p.nombre_cliente, mensaje: p.tarjeta_regalo, id: p.id }))
  }, [pedidos])

  async function marcarPagaEfectivo(pedidoId) {
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/pago`, {
        total_pagado: 0,
        observaciones: 'PAGO EN ENTREGA: EFECTIVO',
      })
      cargarPedidos()
    } catch (err) {
      console.error('Error marcando paga en efectivo:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function cambiarEstado(pedidoId, estado) {
    const pedido = pedidos.find(p => p.id === pedidoId)
    const esPagado = pedido && ((pedido.observaciones || '').includes('PAGO ANTICIPADO') || (pedido.observaciones || '').includes('TALO PAY'))
    const totalPagado = pedido ? (parseFloat(pedido.total_pagado) || 0) : 0

    if (estado === 'cancelado' && esPagado && totalPagado > 0) {
      if (!confirm(`Se generará saldo a favor de ${formatPrecio(totalPagado)} para el cliente.\n\n¿Cancelar pedido?`)) return
    } else {
      if (!confirm(`¿Marcar pedido como "${estado}"?`)) return
    }
    try {
      await api.put(`/api/pos/pedidos/${pedidoId}/estado`, { estado })
      setPedidos(prev => prev.filter(p => p.id !== pedidoId))
      setPedidoSeleccionado(null)
    } catch (err) {
      console.error('Error cambiando estado:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function revertirPedido(pedidoId) {
    const motivo = prompt('Motivo de la reversión:')
    if (!motivo || !motivo.trim()) return
    if (!confirm(`¿Revertir pedido a pendiente?\n\nMotivo: ${motivo}`)) return
    try {
      const { data } = await api.put(`/api/pos/pedidos/${pedidoId}/revertir`, { motivo: motivo.trim() })
      if (data.nota_credito) {
        alert(`Pedido revertido. Se generó Nota de Crédito #${data.nota_credito.numero || data.nota_credito.id}`)
      }
      cargarPedidos()
      setPedidoSeleccionado(null)
    } catch (err) {
      console.error('Error revirtiendo pedido:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function duplicarPedido(pedido) {
    if (!confirm('¿Crear un nuevo pedido con los mismos artículos y cliente?')) return
    try {
      const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()
      const payload = {
        id_cliente_centum: pedido.id_cliente_centum,
        nombre_cliente: pedido.nombre_cliente,
        items,
        total: pedido.total,
        tipo: pedido.tipo || 'retiro',
        sucursal_id: pedido.sucursal_id || undefined,
        tarjeta_regalo: pedido.tarjeta_regalo || undefined,
        observaciones_pedido: pedido.observaciones_pedido || undefined,
      }
      await api.post('/api/pos/pedidos', payload)
      alert('Pedido duplicado correctamente')
      cargarPedidos()
      setPedidoSeleccionado(null)
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  async function generarLinkMP(pedidoId) {
    setGenerandoLink(pedidoId)
    try {
      const { data } = await api.post(`/api/pos/pedidos/${pedidoId}/link-pago`)
      if (data.link) {
        const textoCompleto = `Importante!! por favor transferir al cbu que figura en el link y el importe del link para que su pago se regitre de forma correcta. Si usted realiza la transferencia a un cbu viejo el pago no impactara.\n${data.link}`
        try {
          await navigator.clipboard.writeText(textoCompleto)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = textoCompleto
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setLinkCopiado(pedidoId)
        setTimeout(() => setLinkCopiado(null), 2000)
        // El backend ya actualiza observaciones al generar el link
        cargarPedidos()
      }
    } catch (err) {
      console.error('Error generando link MP:', err)
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setGenerandoLink(null)
    }
  }

  async function descargarPrefactura(pedido) {
    // Buscar datos del cliente
    let emailCliente = ''
    let cuitCliente = ''
    let condicionIva = ''
    let celularCliente = ''
    let direccionCliente = ''
    if (pedido.id_cliente_centum) {
      try {
        const { data } = await api.get(`/api/clientes/por-centum/${pedido.id_cliente_centum}`)
        if (data) {
          emailCliente = data.email || ''
          cuitCliente = data.cuit || ''
          celularCliente = data.celular || data.telefono || ''
          direccionCliente = [data.direccion, data.localidad, data.codigo_postal].filter(Boolean).join(' - ')
          const COND = { RI: 'Responsable Inscripto', MT: 'Monotributista', CF: 'Consumidor Final', EX: 'Exento' }
          condicionIva = COND[data.condicion_iva] || data.condicion_iva || 'Consumidor Final'
        }
      } catch {}
    }
    const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()
    const fechaEntrega = pedido.fecha_entrega
      ? new Date(pedido.fecha_entrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : ''
    const fechaCreacion = new Date(pedido.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const totalNum = parseFloat(pedido.total) || 0

    const esc = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    let filasItems = ''
    items.forEach(item => {
      const precio = parseFloat(item.precio_unitario || item.precioFinal || item.precio || 0)
      const cant = parseFloat(item.cantidad || 1)
      const sub = Math.round(precio * cant * 100) / 100
      filasItems += `<tr>
        <td class="td">${esc(item.codigo || '')}</td>
        <td class="td" style="text-align:center">${item.esPesable ? cant.toFixed(3) + ' kg' : cant}</td>
        <td class="td">${esc(item.nombre)}</td>
        <td class="td" style="text-align:right">${formatPrecio(precio)}</td>
        <td class="td" style="text-align:right">${formatPrecio(sub)}</td>
      </tr>`
    })

    // Extraer dirección de observaciones
    const obsMatch = (pedido.observaciones || '').match(/Dirección:\s*([^|]+)/)
    const direccionEntrega = obsMatch ? obsMatch[1].trim() : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prefactura #${pedido.numero}</title>
<style>
  @page { margin: 10mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; }
  .page { border: 2px solid #000; position: relative; }
  .watermark { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 80px; font-weight: bold; color: rgba(0,0,0,0.04); white-space: nowrap; pointer-events: none; z-index: 0; letter-spacing: 10px; }

  .hdr { display: flex; border-bottom: 2px solid #000; position: relative; z-index: 1; }
  .hdr-left { flex: 1; padding: 10px 14px; border-right: 1px solid #000; }
  .hdr-letra { width: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 1px solid #000; padding: 6px; }
  .hdr-letra .letra { font-size: 28px; font-weight: bold; border: 2px solid #000; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; }
  .hdr-letra .cod { font-size: 9px; margin-top: 2px; font-weight: 600; }
  .hdr-right { flex: 1; padding: 10px 14px; }
  .empresa-nombre { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
  .empresa-dir { font-size: 10px; color: #333; margin-bottom: 1px; }
  .empresa-contacto { font-size: 10px; color: #555; }
  .doc-tipo { font-size: 16px; font-weight: bold; text-align: right; }
  .doc-num { font-size: 12px; margin-top: 4px; text-align: right; }
  .doc-fecha { font-size: 11px; margin-top: 2px; text-align: right; }
  .fiscal-data { font-size: 10px; margin-top: 6px; color: #333; line-height: 1.5; }
  .fiscal-data span { display: inline-block; width: 70px; }

  .cliente { border-bottom: 2px solid #000; padding: 8px 14px; font-size: 11px; line-height: 1.6; position: relative; z-index: 1; }
  .cliente-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .cliente-row .lbl { color: #555; font-size: 10px; }

  .entrega-info { border-bottom: 1px solid #999; padding: 6px 14px; font-size: 11px; line-height: 1.5; position: relative; z-index: 1; background: #fafafa; }
  .entrega-row { display: flex; gap: 16px; flex-wrap: wrap; }
  .entrega-row .lbl { color: #555; font-size: 10px; }

  .items { padding: 0; position: relative; z-index: 1; }
  .items table { width: 100%; border-collapse: collapse; }
  .items th { background: #e8e8e8; padding: 5px 10px; text-align: left; font-size: 10px; font-weight: 700; border-bottom: 2px solid #000; border-top: 2px solid #000; text-transform: uppercase; letter-spacing: 0.3px; }
  .td { padding: 4px 10px; border-bottom: 1px solid #ddd; font-size: 11px; }

  .obs-section { border-top: 1px solid #999; padding: 6px 14px; font-size: 11px; position: relative; z-index: 1; background: #fffbeb; }
  .obs-section .obs-title { font-weight: 700; color: #555; margin-bottom: 2px; font-size: 10px; text-transform: uppercase; }

  .footer-zone { display: flex; border-top: 2px solid #000; position: relative; z-index: 1; }
  .footer-left { flex: 1; padding: 10px 14px; border-right: 1px solid #000; }
  .footer-right { width: 220px; padding: 10px 14px; }
  .totales-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
  .totales-row.total { font-size: 16px; font-weight: bold; border-top: 2px solid #000; padding-top: 6px; margin-top: 6px; }
  .prefactura-badge { background: #f3f4f6; border: 2px solid #999; padding: 3px 10px; font-size: 10px; font-weight: 700; color: #555; letter-spacing: 2px; display: inline-block; margin-top: 6px; }
  .factura-msg { margin-top: 10px; font-size: 10px; color: #333; line-height: 1.6; border-top: 1px solid #ddd; padding-top: 8px; }
  .cajero-info { margin-top: 6px; font-size: 9px; color: #999; }
</style></head><body>
<div class="page">
  <div class="watermark">PREFACTURA</div>
  <div class="hdr">
    <div class="hdr-left">
      <div class="empresa-nombre">Comercial Padano SRL</div>
      <div class="empresa-dir">Brasil 313 Barrio Belgrano (2000) Rosario, Santa Fe</div>
      <div class="empresa-contacto">Tel: +54 9 3412 28-6109 &nbsp;|&nbsp; administracion@padano.com.ar &nbsp;|&nbsp; www.padano.com.ar</div>
    </div>
    <div class="hdr-letra">
      <div class="letra">X</div>
      <div class="cod">PRE</div>
    </div>
    <div class="hdr-right">
      <div class="doc-tipo">Prefactura</div>
      <div class="doc-num">Pedido #${pedido.numero || '---'}</div>
      <div class="doc-fecha">Fecha: ${esc(fechaCreacion)}</div>
      <div class="fiscal-data">
        <div><span>IVA:</span> Responsable Inscripto &nbsp;&nbsp; <span>CUIT:</span> 30-71885278-8</div>
        <div><span>IIBB:</span> 0213900654 &nbsp;&nbsp; <span>Inicio Act.:</span> 01/09/2019</div>
      </div>
    </div>
  </div>

  <div class="cliente">
    <div class="cliente-row">
      <div><span class="lbl">Razon Social:</span> <strong style="font-size:13px">${esc(pedido.nombre_cliente || 'CONSUMIDOR FINAL')}</strong></div>
      ${cuitCliente ? `<div><span class="lbl">CUIT:</span> <strong>${esc(cuitCliente)}</strong></div>` : ''}
    </div>
    <div class="cliente-row">
      ${condicionIva ? `<div><span class="lbl">Cond. IVA:</span> ${esc(condicionIva)}</div>` : ''}
      ${direccionCliente ? `<div><span class="lbl">Domicilio:</span> ${esc(direccionCliente)}</div>` : ''}
    </div>
    <div class="cliente-row">
      ${emailCliente ? `<div><span class="lbl">Email:</span> ${esc(emailCliente)}</div>` : ''}
      ${celularCliente ? `<div><span class="lbl">Celular:</span> ${esc(celularCliente)}</div>` : ''}
    </div>
  </div>

  <div class="entrega-info">
    <div class="entrega-row">
      <div><span class="lbl">Tipo:</span> <strong>${pedido.tipo === 'delivery' ? 'Delivery' : 'Retiro en sucursal'}</strong></div>
      ${fechaEntrega ? `<div><span class="lbl">Fecha entrega:</span> <strong>${esc(fechaEntrega)}</strong></div>` : ''}
      ${pedido.turno_entrega ? `<div><span class="lbl">Turno:</span> <strong>${pedido.turno_entrega === 'AM' ? 'AM (9 a 13hs)' : 'PM (17 a 21hs)'}</strong></div>` : ''}
    </div>
    ${direccionEntrega ? `<div class="entrega-row"><div><span class="lbl">Dir. entrega:</span> <strong>${esc(direccionEntrega)}</strong></div></div>` : ''}
  </div>

  <div class="items">
    <table>
      <thead>
        <tr>
          <th style="width:80px">Codigo</th>
          <th style="width:65px;text-align:center">Cant.</th>
          <th>Descripcion</th>
          <th style="width:100px;text-align:right">Precio Unit.</th>
          <th style="width:110px;text-align:right">Importe</th>
        </tr>
      </thead>
      <tbody>${filasItems}</tbody>
    </table>
  </div>

  ${pedido.observaciones_pedido ? `<div class="obs-section"><div class="obs-title">Observaciones del pedido:</div><div>${esc(pedido.observaciones_pedido)}</div></div>` : ''}

  <div class="footer-zone">
    <div class="footer-left">
      <div style="font-size:11px;color:#555;font-weight:600">DOCUMENTO NO VALIDO COMO FACTURA</div>
      <div class="prefactura-badge">PREFACTURA - SIN VALOR FISCAL</div>
      <div class="factura-msg">
        Una vez despachado el pedido se generara la factura para el cliente <strong>${esc(pedido.nombre_cliente || 'CONSUMIDOR FINAL')}</strong>${emailCliente ? ` y se enviara por email a <strong>${esc(emailCliente)}</strong>` : ''}.
      </div>
      <div class="cajero-info">
        Creado por: ${esc(pedido.cajero_nombre || pedido.perfiles?.nombre || '')}${pedido.creado_en_cierre ? ` (Caja #${pedido.creado_en_cierre})` : ''}${pedido.creado_sucursal_nombre || pedido.sucursales?.nombre ? ` - ${esc(pedido.creado_sucursal_nombre || pedido.sucursales?.nombre)}` : ''} - ${new Date(pedido.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
        ${pedido.cobrado_por ? `<br>Cobrado por: ${esc(pedido.cobrado_por)}${pedido.cobrado_en_cierre ? ` (Caja #${pedido.cobrado_en_cierre})` : ''}${pedido.cobrado_sucursal_nombre ? ` - ${esc(pedido.cobrado_sucursal_nombre)}` : ''}${pedido.cobrado_at ? ` - ${new Date(pedido.cobrado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}${pedido.pagos && Array.isArray(pedido.pagos) ? ` (${pedido.pagos.map(p => esc(p.tipo || p.forma)).join(', ')})` : ''}` : ''}
        ${pedido.entregado_por ? `<br>Entregado por: ${esc(pedido.entregado_por)}${pedido.entregado_en_cierre ? ` (Caja #${pedido.entregado_en_cierre})` : ''}${pedido.entregado_sucursal_nombre ? ` - ${esc(pedido.entregado_sucursal_nombre)}` : ''}${pedido.entregado_at ? ` - ${new Date(pedido.entregado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` : ''}
      </div>
    </div>
    <div class="footer-right">
      <div class="totales-row"><span>Subtotal:</span><span>${formatPrecio(totalNum)}</span></div>
      <div class="totales-row total"><span>TOTAL:</span><span>${formatPrecio(totalNum)}</span></div>
    </div>
  </div>
</div>
</body></html>`

    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.print() }, 400)
  }

  function imprimirPedidoComandera(pedido) {
    const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()
    const esc = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const fechaEntrega = pedido.fecha_entrega
      ? new Date(pedido.fecha_entrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      : ''
    const obsEntregaMatch = (pedido.observaciones || '').match(/ENTREGA:\s*(.+?)(?:\s*\|(?=[A-Z]+:)|$)/)
    const obsEntrega = obsEntregaMatch ? obsEntregaMatch[1].trim() : ''
    const dirMatch = (pedido.observaciones || '').match(/Dirección:\s*([^|]+)/)
    const dirEntrega = dirMatch ? dirMatch[1].trim() : ''

    let filasItems = ''
    items.forEach(item => {
      const cant = parseFloat(item.cantidad || 1)
      filasItems += `<tr>
        <td style="width:20px;vertical-align:top;padding:3px 0;">&#9744;</td>
        <td style="padding:3px 6px;font-size:13px;font-weight:600;">${item.esPesable ? cant.toFixed(3) + ' kg' : cant}x</td>
        <td style="padding:3px 0;font-size:13px;">${esc(item.nombre)}</td>
      </tr>`
    })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pedido #${pedido.numero}</title>
<style>
  @page { margin: 4mm; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; }
  .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 6px; }
  .header h1 { font-size: 18px; margin-bottom: 2px; }
  .header .num { font-size: 22px; font-weight: bold; }
  .info { font-size: 11px; margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px dashed #000; }
  .info div { margin-bottom: 2px; }
  .info .lbl { font-weight: bold; }
  .obs { font-size: 11px; margin-bottom: 6px; padding: 4px; border: 1px solid #000; background: #f5f5f5; }
  .obs .lbl { font-weight: bold; font-size: 10px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .sep { border-top: 2px dashed #000; padding-top: 6px; margin-top: 6px; text-align: center; font-size: 10px; color: #555; }
</style></head><body>
<div class="header">
  <h1>PEDIDO</h1>
  <div class="num">#${pedido.numero || '---'}</div>
  <div style="font-size:11px;margin-top:2px;">${esc(pedido.nombre_cliente || 'Consumidor Final')}</div>
</div>
<div class="info">
  ${pedido.tipo ? `<div><span class="lbl">${pedido.tipo === 'delivery' ? 'DELIVERY' : 'RETIRO'}</span></div>` : ''}
  ${fechaEntrega ? `<div><span class="lbl">Entrega:</span> ${esc(fechaEntrega)} ${pedido.turno_entrega ? (pedido.turno_entrega === 'AM' ? '(9-13hs)' : '(17-21hs)') : ''}</div>` : ''}
  ${dirEntrega ? `<div><span class="lbl">Dir:</span> ${esc(dirEntrega)}</div>` : ''}
  ${pedido.sucursales?.nombre ? `<div><span class="lbl">Suc:</span> ${esc(pedido.sucursales.nombre)}</div>` : ''}
</div>
${obsEntrega ? `<div class="obs"><div class="lbl">Obs. entrega:</div>${esc(obsEntrega)}</div>` : ''}
${pedido.observaciones_pedido ? `<div class="obs"><div class="lbl">Obs. pedido:</div>${esc(pedido.observaciones_pedido)}</div>` : ''}
<table>${filasItems}</table>
<div style="text-align:right;font-size:12px;font-weight:bold;border-top:1px dashed #000;padding-top:4px;">${items.length} artículos</div>
${pedido.tarjeta_regalo ? `<div class="obs" style="margin-top:6px;"><div class="lbl">&#10084; Tarjeta regalo:</div>${esc(pedido.tarjeta_regalo)}</div>` : ''}
<div class="sep">${new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>
</body></html>`

    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.print() }, 400)
  }

  // Datos del pedido seleccionado para el drawer
  const pedidoDetalle = useMemo(() => {
    if (!pedidoSeleccionado) return null
    const p = pedidos.find(p => p.id === pedidoSeleccionado)
    if (!p) return null
    const totalPagado = parseFloat(p.total_pagado) || 0
    const esPagado = (p.observaciones || '').includes('PAGO ANTICIPADO') || (p.observaciones || '').includes('TALO PAY') || totalPagado > 0
    const pagaEfectivoEntrega = (p.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO')
    const pagaConLink = (p.observaciones || '').match(/PAGO PENDIENTE: LINK (MP|TALO)/)
    const descFormaPago = p.descuento_forma_pago?.total || 0
    const totalConDescuento = Math.round((p.total - descFormaPago) * 100) / 100
    const difRaw = esPagado ? (totalConDescuento - totalPagado) : 0
    // Tolerancia de $1 por redondeo a centenas del efectivo
    const diferencia = Math.abs(difRaw) < 1 ? 0 : difRaw
    return {
      ...p,
      items: typeof p.items === 'string' ? JSON.parse(p.items) : p.items,
      esPagado,
      pagaEfectivoEntrega,
      pagaConLink,
      totalPagado,
      diferencia, // >0 debe más, <0 devolver
    }
  }, [pedidoSeleccionado, pedidos])

  // Sincronizar campos editables al abrir drawer
  useEffect(() => {
    if (pedidoDetalle) {
      setEditObsPedido(pedidoDetalle.observaciones_pedido || '')
      setEditTarjeta(pedidoDetalle.tarjeta_regalo || '')
      const m = (pedidoDetalle.observaciones || '').match(/ENTREGA:\s*(.+?)(?:\s*\|(?=[A-Z]+:)|$)/)
      setEditObsEntrega(m ? m[1].trim() : '')
    }
  }, [pedidoSeleccionado])

  return (
    <div className={embebido ? 'h-full bg-gray-50 flex flex-col overflow-hidden' : 'min-h-screen bg-gray-50'}>
      {/* Header — solo en modo standalone */}
      {!embebido && (
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <a href="/apps" className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
                </svg>
              </a>
              <h1 className="text-lg font-bold text-gray-800">Pedidos POS</h1>
            </div>
            <button
              onClick={cargarPedidos}
              className="text-sm text-violet-600 hover:text-violet-700 font-medium"
            >
              Actualizar
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className={embebido ? 'px-4 pt-3 space-y-2' : 'max-w-4xl mx-auto px-4 pt-4 space-y-2'}>
        {/* Fila 1: estados + actualizar */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {FILTROS_ESTADO.map(f => (
              <button
                key={f.value}
                onClick={() => setFiltroEstado(f.value)}
                className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  filtroEstado === f.value
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-gray-600 border hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => tarjetasHoy.length > 0 ? setMostrarTarjetasRegalo(true) : alert('No hay tarjetas de regalo para hoy')}
              className={`relative text-sm font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                tarjetasHoy.length > 0
                  ? 'bg-pink-100 hover:bg-pink-200 text-pink-700 animate-pulse'
                  : 'bg-pink-50 hover:bg-pink-100 text-pink-400'
              }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              Tarjetas{tarjetasHoy.length > 0 ? ` (${tarjetasHoy.length})` : ''}
            </button>
            <button
              onClick={() => setMostrarGuiaDelivery(true)}
              className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Guía envíos
            </button>
            <button
              onClick={() => setMostrarArticulos(true)}
              className="text-sm bg-violet-100 hover:bg-violet-200 text-violet-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Ver Artículos
            </button>
            {embebido && (
              <button onClick={cargarPedidos} className="text-sm text-violet-600 hover:text-violet-700 font-medium">
                Actualizar
              </button>
            )}
          </div>
        </div>

        {/* Fila 2: fecha + sucursal + buscador */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filtroFecha}
            onChange={e => setFiltroFecha(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white"
          />
          <select
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white min-w-[100px]"
          >
            <option value="todos">Todos</option>
            <option value="delivery">Delivery</option>
            <option value="retiro">Retiro</option>
          </select>
          <select
            value={filtroPago}
            onChange={e => setFiltroPago(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white min-w-[110px]"
          >
            <option value="todos">Todo pago</option>
            <option value="pago">Pagó</option>
            <option value="efectivo">Paga en efectivo</option>
            <option value="no_pago">No pagó</option>
          </select>
          <select
            value={filtroSucursal}
            onChange={e => setFiltroSucursal(e.target.value)}
            className="text-sm border rounded-lg px-2.5 py-2 focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white min-w-[140px]"
          >
            <option value="">Todas las sucursales</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre de cliente..."
              className="w-full pl-9 pr-8 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {busquedaDebounced.trim() && (
          <p className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded">
            Buscando por nombre en todos los pedidos {filtroEstado !== 'todos' ? filtroEstado + 's' : ''} (sin filtro de fecha/sucursal)
          </p>
        )}
      </div>

      {/* Lista */}
      <div className={embebido ? 'flex-1 overflow-y-auto px-4 py-3' : 'max-w-4xl mx-auto px-4 py-4'}>
        {cargando ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Cargando pedidos...
          </div>
        ) : pedidos.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
            {busqueda ? 'Sin resultados para la búsqueda' : `No hay pedidos ${filtroEstado !== 'todos' ? filtroEstado + 's' : ''}`}
          </div>
        ) : pedidosFiltrados.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            No hay pedidos con ese filtro de pago
          </div>
        ) : (
          <div className="space-y-3">
            {pedidosFiltrados.map(pedido => {
              const fecha = new Date(pedido.created_at)
              const totalPagado = parseFloat(pedido.total_pagado) || 0
              const esPagado = (pedido.observaciones || '').includes('PAGO ANTICIPADO') || (pedido.observaciones || '').includes('TALO PAY') || totalPagado > 0
              const pagaEfectivoEntrega = (pedido.observaciones || '').includes('PAGO EN ENTREGA: EFECTIVO')
              const pagaConLink = (pedido.observaciones || '').match(/PAGO PENDIENTE: LINK (MP|TALO)/)
              const descFormaPagoPed = pedido.descuento_forma_pago?.total || 0
              const difRawPed = esPagado ? (Math.round((pedido.total - descFormaPagoPed) * 100) / 100 - totalPagado) : 0
              const diferencia = Math.abs(difRawPed) < 1 ? 0 : difRawPed
              const items = (() => { try { return typeof pedido.items === 'string' ? JSON.parse(pedido.items) : (pedido.items || []) } catch { return [] } })()

              return (
                <div
                  key={pedido.id}
                  className={`bg-white rounded-xl border shadow-sm overflow-hidden cursor-pointer hover:bg-gray-50 transition-colors ${pedidoSeleccionado === pedido.id ? 'ring-2 ring-violet-500' : ''}`}
                  onClick={() => setPedidoSeleccionado(pedidoSeleccionado === pedido.id ? null : pedido.id)}
                >
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {pedido.numero && (
                          <span className="text-xs font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                            #{pedido.numero}
                          </span>
                        )}
                        <span className="text-sm font-semibold text-gray-800 truncate">
                          {pedido.nombre_cliente || 'Consumidor Final'}
                        </span>
                        {pedido.tipo && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            pedido.tipo === 'delivery' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {pedido.tipo === 'delivery' ? 'Delivery' : 'Retiro'}
                          </span>
                        )}
                        {esPagado ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-700">
                            Pagó
                          </span>
                        ) : pagaEfectivoEntrega ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700">
                            Paga en efectivo
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-50 text-red-600">
                            No pagó
                          </span>
                        )}
                        {esPagado && diferencia > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-50 text-red-600">
                            Debe {formatPrecio(diferencia)}
                          </span>
                        )}
                        {esPagado && diferencia < 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-50 text-emerald-700">
                            Saldo +{formatPrecio(Math.abs(diferencia))}
                          </span>
                        )}
                        {pedido.estado !== 'pendiente' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            pedido.estado === 'entregado' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                          }`}>
                            {pedido.estado.charAt(0).toUpperCase() + pedido.estado.slice(1)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-sm font-bold text-gray-800">{formatPrecio(pedido.total)}</span>
                        <span className="text-xs text-gray-400">{items.length} art.</span>
                      </div>
                    </div>
                    {pedido.fecha_entrega && (
                      <div className="mt-1">
                        <span className="text-base font-bold text-purple-600">Entrega: {new Date(pedido.fecha_entrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span>
                        {fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })} {fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {pedido.turno_entrega && (
                        <>
                          <span>|</span>
                          <span className="font-medium">{pedido.turno_entrega === 'AM' ? 'AM (9-13hs)' : 'PM (17-21hs)'}</span>
                        </>
                      )}
                      {pedido.sucursales?.nombre && (
                        <>
                          <span>|</span>
                          <span>{pedido.sucursales.nombre}</span>
                        </>
                      )}
                      {(pedido.cajero_nombre || pedido.perfiles?.nombre) && (
                        <>
                          <span>|</span>
                          <span>Creado por: {pedido.cajero_nombre || pedido.perfiles.nombre}{pedido.creado_en_cierre ? ` (Caja #${pedido.creado_en_cierre})` : ''}{pedido.creado_sucursal_nombre ? ` - ${pedido.creado_sucursal_nombre}` : ''}</span>
                        </>
                      )}
                      {(pedido.cobrado_por || (pedido.cobrado_at && pedido.mp_payment_id)) && (
                        <>
                          <span>|</span>
                          <span>Cobrado por: {pedido.cobrado_por || 'Talo Pay'}{pedido.cobrado_en_cierre ? ` (Caja #${pedido.cobrado_en_cierre})` : ''}{pedido.cobrado_sucursal_nombre ? ` - ${pedido.cobrado_sucursal_nombre}` : ''}{pedido.cobrado_at ? ` el ${new Date(pedido.cobrado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                        </>
                      )}
                      {pedido.entregado_por && (
                        <>
                          <span>|</span>
                          <span>Entregado por: {pedido.entregado_por}{pedido.entregado_en_cierre ? ` (Caja #${pedido.entregado_en_cierre})` : ''}{pedido.entregado_sucursal_nombre ? ` - ${pedido.entregado_sucursal_nombre}` : ''}{pedido.entregado_at ? ` el ${new Date(pedido.entregado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                        </>
                      )}
                    </div>
                    {/* Obs entrega, obs pedido, tarjeta regalo */}
                    {(() => {
                      const obsEntregaMatch = (pedido.observaciones || '').match(/ENTREGA:\s*(.+?)(?:\s*\|(?=[A-Z]+:)|$)/)
                      const obsEntrega = obsEntregaMatch ? obsEntregaMatch[1].trim() : null
                      return (obsEntrega || pedido.observaciones_pedido || pedido.tarjeta_regalo) ? (
                        <div className="flex flex-col gap-1 mt-1.5">
                          {obsEntrega && (
                            <div className="text-[11px] px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="font-semibold">Entrega:</span> {obsEntrega}
                            </div>
                          )}
                          {pedido.observaciones_pedido && (
                            <div className="text-[11px] px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              <span className="font-semibold">Obs:</span> {pedido.observaciones_pedido}
                            </div>
                          )}
                          {pedido.tarjeta_regalo && (
                            <div className="text-[11px] px-2 py-1 rounded bg-pink-50 text-pink-700 border border-pink-200">
                              <span className="font-semibold">Tarjeta:</span> {pedido.tarjeta_regalo}
                            </div>
                          )}
                        </div>
                      ) : null
                    })()}

                    {/* Botones de acción en la card */}
                    {pedido.estado !== 'pendiente' && (
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                        {(pedido.estado === 'entregado' || pedido.estado === 'no_entregado') &&
                         !(pedido.tipo === 'retiro' && !(pedido.observaciones || '').includes('PAGO ANTICIPADO') && !(pedido.observaciones || '').includes('TALO PAY') && !pedido.venta_anticipada_id) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); revertirPedido(pedido.id) }}
                            className="bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                            Revertir
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); duplicarPedido(pedido) }}
                          className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                          Duplicar
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); descargarPrefactura({ ...pedido, items }) }}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                          Prefactura
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); imprimirPedidoComandera({ ...pedido, items }) }}
                          className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-3 0h.008v.008h-.008V12z" /></svg>
                          Imprimir pedido
                        </button>
                      </div>
                    )}
                    {pedido.estado === 'pendiente' && (
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                        {onEditarPedido && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditarPedido({ ...pedido, items, esPagado, totalPagado: parseFloat(pedido.total_pagado) || 0, diferencia }); setPedidoSeleccionado(null) }}
                            className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (esPagado && diferencia > 0) { alert(`Falta cobrar ${formatPrecio(diferencia)} antes de entregar`); return }
                            onEntregarPedido ? onEntregarPedido({ ...pedido, items, esPagado, totalPagado: parseFloat(pedido.total_pagado) || 0, diferencia }) : cambiarEstado(pedido.id, 'entregado')
                          }}
                          className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                        >
                          {esPagado && diferencia < 0 ? `Entregar (saldo +${formatPrecio(Math.abs(diferencia))})` : 'Entregar'}
                        </button>
                        {(!esPagado || diferencia > 0) && (<>
                          {onCobrarEnCaja && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onCobrarEnCaja({ id: pedido.id, total: diferencia > 0 ? diferencia : pedido.total, items: pedido.items, nombre_cliente: pedido.nombre_cliente, id_cliente_centum: pedido.id_cliente_centum }) }}
                              className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                            >
                              {diferencia > 0 ? `Cobrar dif. ${formatPrecio(diferencia)}` : 'Cobrar en caja'}
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); generarLinkMP(pedido.id) }}
                            disabled={generandoLink === pedido.id}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                          >
                            {generandoLink === pedido.id ? (
                              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                            ) : linkCopiado === pedido.id ? 'Copiado!' : diferencia > 0 ? `Link dif. ${formatPrecio(diferencia)}` : 'Link pago'}
                          </button>
                        </>)}
                        {!esPagado && !pagaEfectivoEntrega && (
                          <button
                            onClick={(e) => { e.stopPropagation(); marcarPagaEfectivo(pedido.id) }}
                            className="bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                          >
                            Paga en efectivo
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); cambiarEstado(pedido.id, 'cancelado') }}
                          className="bg-red-100 hover:bg-red-200 text-red-600 text-xs font-semibold px-2 py-1 rounded-md transition-colors"
                        >
                          Cancelar
                        </button>
                        <div className="flex items-center gap-1.5 ml-auto">
                          <button
                            onClick={(e) => { e.stopPropagation(); imprimirPedidoComandera({ ...pedido, items }) }}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-3 0h.008v.008h-.008V12z" /></svg>
                            Imprimir
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); descargarPrefactura({ ...pedido, items }) }}
                            className="bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            Prefactura
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Drawer lateral derecho */}
      {pedidoDetalle && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setPedidoSeleccionado(null)}
          />
          {/* Panel */}
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right">
            {/* Header del drawer */}
            <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50">
              <div>
                <div className="flex items-center gap-2">
                  {pedidoDetalle.numero && (
                    <span className="text-sm font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded">
                      #{pedidoDetalle.numero}
                    </span>
                  )}
                  <h2 className="text-lg font-bold text-gray-800">
                    {pedidoDetalle.nombre_cliente || 'Consumidor Final'}
                  </h2>
                </div>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>
                    {new Date(pedidoDetalle.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}{' '}
                    {new Date(pedidoDetalle.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {pedidoDetalle.tipo && (
                    <>
                      <span>|</span>
                      <span className={`px-1.5 py-0.5 rounded font-medium ${
                        pedidoDetalle.tipo === 'delivery' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {pedidoDetalle.tipo === 'delivery' ? 'Delivery' : 'Retiro'}
                      </span>
                    </>
                  )}
                  {pedidoDetalle.esPagado ? (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-700">Pagó</span>
                  ) : pedidoDetalle.pagaEfectivoEntrega ? (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700">Paga en efectivo</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded font-medium bg-red-50 text-red-600">No pagó</span>
                  )}
                  {pedidoDetalle.estado !== 'pendiente' && (
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      pedidoDetalle.estado === 'entregado' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {pedidoDetalle.estado.charAt(0).toUpperCase() + pedidoDetalle.estado.slice(1)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setPedidoSeleccionado(null)}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Items scrolleables */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Badges de diferencia en el drawer */}
              {pedidoDetalle.esPagado && pedidoDetalle.diferencia !== 0 && (
                <div className={`mb-3 px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-between ${
                  pedidoDetalle.diferencia > 0 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  <span>
                    {pedidoDetalle.diferencia > 0
                      ? `Debe ${formatPrecio(pedidoDetalle.diferencia)}`
                      : `Saldo a favor: +${formatPrecio(Math.abs(pedidoDetalle.diferencia))}`
                    }
                  </span>
                  <span className="text-xs opacity-70">Pagó {formatPrecio(pedidoDetalle.totalPagado)}</span>
                </div>
              )}

              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                {pedidoDetalle.items.length} artículos
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left font-medium pb-2">Producto</th>
                    <th className="text-center font-medium pb-2 w-14">Cant.</th>
                    <th className="text-right font-medium pb-2 w-24">Precio</th>
                    <th className="text-right font-medium pb-2 w-24">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pedidoDetalle.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2 text-gray-700">{item.nombre}</td>
                      <td className="py-2 text-center text-gray-500">{item.cantidad}</td>
                      <td className="py-2 text-right text-gray-500">{formatPrecio(item.precio)}</td>
                      <td className="py-2 text-right font-medium text-gray-700">{formatPrecio(item.precio * item.cantidad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Campos editables: obs pedido, tarjeta, obs entrega */}
              {pedidoDetalle.estado === 'pendiente' ? (
                <div className="mt-4 space-y-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Observaciones del pedido</label>
                    <textarea
                      value={editObsPedido}
                      onChange={e => setEditObsPedido(e.target.value)}
                      placeholder="Ej: separar bebidas del resto..."
                      rows={2}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 text-pink-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                      Tarjeta de regalo
                    </label>
                    <textarea
                      value={editTarjeta}
                      onChange={e => setEditTarjeta(e.target.value)}
                      placeholder="Ej: Feliz cumpleaños Maria! De parte de Julian"
                      rows={2}
                      className="w-full text-sm border border-pink-200 rounded-lg px-3 py-2 focus:outline-none focus:border-pink-400 resize-none bg-pink-50/30"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Observacion de entrega</label>
                    <textarea
                      value={editObsEntrega}
                      onChange={e => setEditObsEntrega(e.target.value)}
                      placeholder="Ej: entregar antes de las 18hs..."
                      rows={2}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 resize-none"
                    />
                  </div>
                  <button
                    disabled={guardandoExtras}
                    onClick={async () => {
                      setGuardandoExtras(true)
                      try {
                        let obs = (pedidoDetalle.observaciones || '').replace(/\s*\|?\s*ENTREGA:\s*.+?(?:\s*\|(?=[A-Z]+:)|$)/, '').trim()
                        const entrega = editObsEntrega.trim()
                        if (entrega) {
                          obs = obs ? `${obs} | ENTREGA: ${entrega}` : `ENTREGA: ${entrega}`
                        }
                        await api.put(`/api/pos/pedidos/${pedidoDetalle.id}`, {
                          observaciones: obs || null,
                          tarjeta_regalo: editTarjeta.trim() || null,
                          observaciones_pedido: editObsPedido.trim() || null,
                        })
                        cargarPedidos()
                        alert('Datos actualizados')
                      } catch (err) {
                        alert('Error: ' + (err.response?.data?.error || err.message))
                      } finally {
                        setGuardandoExtras(false)
                      }
                    }}
                    className="w-full text-xs py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold transition-colors"
                  >
                    {guardandoExtras ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              ) : (
                <>
                  {pedidoDetalle.observaciones_pedido && (
                    <div className="mt-4 px-3 py-2 text-sm text-gray-700 bg-blue-50 rounded-lg border border-blue-200 flex items-start gap-2">
                      <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                      <span>{pedidoDetalle.observaciones_pedido}</span>
                    </div>
                  )}
                  {pedidoDetalle.tarjeta_regalo && (
                    <div className="mt-3 px-3 py-2 text-sm text-pink-700 bg-pink-50 rounded-lg border border-pink-200 flex items-start gap-2">
                      <svg className="w-4 h-4 text-pink-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                      <span>{pedidoDetalle.tarjeta_regalo}</span>
                    </div>
                  )}
                </>
              )}

              {/* Observaciones internas */}
              {pedidoDetalle.observaciones && (
                <div className="mt-3 px-3 py-2 text-xs text-gray-600 bg-amber-50 rounded-lg border border-amber-100">
                  {pedidoDetalle.observaciones}
                </div>
              )}

              {/* Info extra */}
              {pedidoDetalle.fecha_entrega && (
                <div className="mt-3 text-xs text-gray-500">
                  Fecha entrega: {new Date(pedidoDetalle.fecha_entrega + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </div>
              )}
              {pedidoDetalle.turno_entrega && (
                <div className="mt-1 text-xs text-gray-500">
                  Turno: <span className="font-medium text-gray-700">{pedidoDetalle.turno_entrega === 'AM' ? 'AM (9-13hs)' : 'PM (17-21hs)'}</span>
                </div>
              )}
              {/* Trazabilidad: Creación / Cobro / Entrega */}
              <div className="mt-3 space-y-1.5">
                {/* Creación */}
                <div className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1.5">
                  <span className="font-semibold text-gray-600">Creado:</span>{' '}
                  {pedidoDetalle.cajero_nombre || pedidoDetalle.perfiles?.nombre || '—'}
                  {pedidoDetalle.creado_en_cierre ? ` (Caja #${pedidoDetalle.creado_en_cierre})` : ''}
                  {(pedidoDetalle.creado_sucursal_nombre || pedidoDetalle.sucursales?.nombre) ? ` — ${pedidoDetalle.creado_sucursal_nombre || pedidoDetalle.sucursales.nombre}` : ''}
                  {pedidoDetalle.created_at ? ` — ${new Date(pedidoDetalle.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                </div>
                {/* Cobro */}
                {(pedidoDetalle.cobrado_por || (pedidoDetalle.cobrado_at && pedidoDetalle.mp_payment_id)) && (
                  <div className={`text-xs rounded px-2 py-1.5 ${pedidoDetalle.cobrado_por ? 'text-green-700 bg-green-50' : 'text-indigo-700 bg-indigo-50'}`}>
                    <span className="font-semibold">Cobrado:</span>{' '}
                    {pedidoDetalle.cobrado_por || 'Talo Pay'}
                    {pedidoDetalle.cobrado_en_cierre ? ` (Caja #${pedidoDetalle.cobrado_en_cierre})` : ''}
                    {pedidoDetalle.cobrado_sucursal_nombre ? ` — ${pedidoDetalle.cobrado_sucursal_nombre}` : ''}
                    {pedidoDetalle.cobrado_at ? ` — ${new Date(pedidoDetalle.cobrado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                    {pedidoDetalle.pagos && Array.isArray(pedidoDetalle.pagos) ? ` — ${pedidoDetalle.pagos.map(p => p.tipo || p.forma).join(', ')}` : ''}
                  </div>
                )}
                {/* Entrega */}
                {pedidoDetalle.entregado_por && (
                  <div className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1.5">
                    <span className="font-semibold">Entregado:</span>{' '}
                    {pedidoDetalle.entregado_por}
                    {pedidoDetalle.entregado_en_cierre ? ` (Caja #${pedidoDetalle.entregado_en_cierre})` : ''}
                    {pedidoDetalle.entregado_sucursal_nombre ? ` — ${pedidoDetalle.entregado_sucursal_nombre}` : ''}
                    {pedidoDetalle.entregado_at ? ` — ${new Date(pedidoDetalle.entregado_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </div>
                )}
              </div>
            </div>

            {/* Footer con total + acciones */}
            <div className="border-t bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-500">Total</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => imprimirPedidoComandera(pedidoDetalle)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                    title="Imprimir checklist del pedido"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-3 0h.008v.008h-.008V12z" />
                    </svg>
                    Imprimir
                  </button>
                  <button
                    onClick={() => descargarPrefactura(pedidoDetalle)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                    title="Descargar prefactura PDF"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Prefactura
                  </button>
                  <span className="text-xl font-bold text-gray-800">{formatPrecio(pedidoDetalle.total)}</span>
                </div>
              </div>

              {pedidoDetalle.estado === 'pendiente' && (
                <div className="flex flex-wrap gap-2">
                  {onEditarPedido && (
                    <button
                      onClick={() => { onEditarPedido(pedidoDetalle); setPedidoSeleccionado(null) }}
                      className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (pedidoDetalle.esPagado && pedidoDetalle.diferencia > 0) {
                        alert(`Falta cobrar ${formatPrecio(pedidoDetalle.diferencia)} antes de entregar`)
                        return
                      }
                      onEntregarPedido ? onEntregarPedido(pedidoDetalle) : cambiarEstado(pedidoDetalle.id, 'entregado')
                    }}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                  >
                    {pedidoDetalle.esPagado && pedidoDetalle.diferencia < 0
                      ? `Entregar (saldo +${formatPrecio(Math.abs(pedidoDetalle.diferencia))})`
                      : onEntregarPedido ? 'Entregar' : 'Marcar entregado'
                    }
                  </button>
                  {(!pedidoDetalle.esPagado || pedidoDetalle.diferencia > 0) && (<>
                    {onCobrarEnCaja && (
                      <button
                        onClick={() => { setPedidoSeleccionado(null); onCobrarEnCaja({ id: pedidoDetalle.id, total: pedidoDetalle.diferencia > 0 ? pedidoDetalle.diferencia : pedidoDetalle.total, items: pedidoDetalle.items, nombre_cliente: pedidoDetalle.nombre_cliente, id_cliente_centum: pedidoDetalle.id_cliente_centum }) }}
                        className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                      >
                        {pedidoDetalle.diferencia > 0 ? `Cobrar dif. ${formatPrecio(pedidoDetalle.diferencia)}` : 'Cobrar en caja'}
                      </button>
                    )}
                    <button
                      onClick={() => generarLinkMP(pedidoDetalle.id)}
                      disabled={generandoLink === pedidoDetalle.id}
                      className="bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {generandoLink === pedidoDetalle.id ? 'Generando...' : linkCopiado === pedidoDetalle.id ? 'Copiado!' : pedidoDetalle.diferencia > 0 ? `Link dif. ${formatPrecio(pedidoDetalle.diferencia)}` : 'Link pago'}
                    </button>
                  </>)}
                  {!pedidoDetalle.esPagado && !pedidoDetalle.pagaEfectivoEntrega && (
                    <button
                      onClick={() => { marcarPagaEfectivo(pedidoDetalle.id); setPedidoSeleccionado(null) }}
                      className="bg-amber-100 hover:bg-amber-200 text-amber-700 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                    >
                      Paga en efectivo
                    </button>
                  )}
                  <button
                    onClick={() => cambiarEstado(pedidoDetalle.id, 'cancelado')}
                    className="bg-red-100 hover:bg-red-200 text-red-600 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {pedidoDetalle.estado !== 'pendiente' && (
                <div className="flex flex-wrap gap-2">
                  {(pedidoDetalle.estado === 'entregado' || pedidoDetalle.estado === 'no_entregado') &&
                   !(pedidoDetalle.tipo === 'retiro' && !(pedidoDetalle.observaciones || '').includes('PAGO ANTICIPADO') && !(pedidoDetalle.observaciones || '').includes('TALO PAY') && !pedidoDetalle.venta_anticipada_id) && (
                    <button
                      onClick={() => revertirPedido(pedidoDetalle.id)}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                      Revertir a pendiente
                    </button>
                  )}
                  <button
                    onClick={() => duplicarPedido(pedidoDetalle)}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                    Duplicar pedido
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal artículos a preparar */}
      {mostrarArticulos && (
        <ModalArticulosPedidos
          onCerrar={() => setMostrarArticulos(false)}
          terminalConfig={terminalConfig}
          sucursales={sucursales}
        />
      )}

      {/* Modal guía de delivery */}
      {mostrarGuiaDelivery && (
        <ModalGuiaDelivery onCerrar={() => setMostrarGuiaDelivery(false)} cajaId={terminalConfig?.caja_id} />
      )}

      {/* Modal tarjetas de regalo */}
      {mostrarTarjetasRegalo && (
        <ModalTarjetasRegalo
          tarjetas={tarjetasHoy}
          onCerrar={() => setMostrarTarjetasRegalo(false)}
        />
      )}

      {/* CSS para animación del drawer */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out;
        }
      `}</style>
    </div>
  )
}

export default PedidosPOS
