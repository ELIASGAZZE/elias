// Servicio para consultar Pedidos de Venta desde la API REST de Centum
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')
const logger = require('../config/logger')

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY
if (!API_KEY) throw new Error('CENTUM_API_KEY env var is required')
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
}

/**
 * Obtiene pedidos de venta desde Centum con filtros.
 * POST /PedidosVenta/FiltrosPedidoVenta
 * @param {Object} opciones
 * @param {string} [opciones.fechaDesde] - Fecha desde (ISO)
 * @param {string} [opciones.fechaHasta] - Fecha hasta (ISO)
 * @param {number} [opciones.idSucursal] - ID sucursal física Centum
 * @param {number} [opciones.pagina] - Número de página (default 1)
 * @param {number} [opciones.cantidadPorPagina] - Items por página (default 500)
 * @returns {Promise<{items: Array, total: number}>}
 */
async function fetchPedidosCentum({ fechaDesde, fechaHasta, idSucursal, pagina = 1, cantidadPorPagina = 500 } = {}) {
  const url = `${BASE_URL}/PedidosVenta/FiltrosPedidoVenta?numeroPagina=${pagina}&cantidadItemsPorPagina=${cantidadPorPagina}`
  const inicio = Date.now()

  const body = {}
  if (fechaDesde) body.FechaDocumentoDesde = fechaDesde
  if (fechaHasta) body.FechaDocumentoHasta = fechaHasta
  if (idSucursal) body.IdSucursal = idSucursal

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'api',
    })
    throw new Error('Error al conectar con Centum ERP: ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
    })
    throw new Error(`Error al consultar pedidos Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()
  const pv = data.PedidosVenta || data
  const items = pv.Items || (Array.isArray(pv) ? pv : [])
  const total = pv.CantidadTotalItems || items.length

  registrarLlamada({
    servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: items.length, origen: 'api',
  })

  return { items, total }
}

/**
 * Obtiene un pedido de venta específico con ítems.
 * GET /PedidosVenta/{id}
 * @param {number} idPedidoVenta - ID del pedido en Centum
 * @returns {Promise<Object>}
 */
async function fetchPedidoCentum(idPedidoVenta) {
  const url = `${BASE_URL}/PedidosVenta/${idPedidoVenta}`
  const inicio = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: getHeaders(),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'GET',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'api',
    })
    throw new Error('Error al conectar con Centum ERP: ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'GET',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
    })
    if (response.status === 404) {
      throw new Error(`Pedido ${idPedidoVenta} no encontrado en Centum`)
    }
    throw new Error(`Error al obtener pedido Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'api',
  })

  return data
}

/**
 * Formatea NumeroDocumento de Centum.
 * { PuntoVenta: 5, Numero: 1182 } → "PV 5-1182"
 * "X00005-00001147" → "PV 5-1147"
 */
function formatNumeroDocumento(numDoc) {
  if (!numDoc) return null
  if (typeof numDoc === 'object') {
    const pv = numDoc.PuntoVenta ?? ''
    const num = numDoc.Numero ?? ''
    return `PV ${pv}-${num}`
  }
  const s = String(numDoc)
  const match = s.match(/X?0*(\d+)-0*(\d+)/)
  if (match) return `PV ${parseInt(match[1])}-${parseInt(match[2])}`
  return s
}

/**
 * Extrae el número de factura del detalle de estados suscriptos.
 * Busca "Alta de Venta B00002-00007584" en los estados (último primero).
 * @param {Array} estados - PedidoVentaEstados del pedido Centum
 * @returns {string|null} NumeroDocumento de la factura (ej: "B00002-00007584")
 */
function extractFacturaFromEstados(estados) {
  if (!estados || !Array.isArray(estados)) return null
  for (let i = estados.length - 1; i >= 0; i--) {
    const e = estados[i]
    const nombre = e.Estado?.Nombre || ''
    if (nombre.toLowerCase().includes('suscripto')) {
      const match = e.Detalle?.match(/Alta de Venta\s+(\S+)/)
      if (match) return match[1]
    }
  }
  return null
}

/**
 * Mapea un pedido de Centum al formato que espera el frontend.
 * @param {Object} p - Pedido crudo de la API de Centum
 * @param {Object|null} local - Registro local de pedidos_delivery (estado, perfiles, etc.)
 * @param {Object} sucursalesMap - centum_sucursal_id → { id, nombre }
 * @param {string|null} turnoFacturaNombre - Nombre del TurnoEntrega de la factura (de SQL Server)
 */
function mapCentumPedido(p, local, sucursalesMap, turnoFacturaNombre) {
  const numero_documento = formatNumeroDocumento(p.NumeroDocumento)

  // Estado Centum (último de la lista de estados)
  let estado_centum = null
  const estados = p.PedidoVentaEstados
  if (estados && estados.length > 0) {
    const ultimo = estados[estados.length - 1]
    const est = ultimo.Estado
    estado_centum = typeof est === 'object' ? (est.Nombre || est.Codigo || null) : (est || ultimo.Nombre || null)
  }

  // Sucursal local
  const sucursalFisicaId = p.SucursalFisica?.IdSucursalFisica || null
  const sucursalLocal = sucursalFisicaId ? sucursalesMap[sucursalFisicaId] : null

  // Cliente directo de Centum
  const clientes = p.Cliente ? {
    razon_social: p.Cliente.RazonSocial || 'Sin cliente',
    cuit: p.Cliente.CUIT || null,
    direccion: p.Cliente.Direccion || null,
    localidad: p.Cliente.Localidad || null,
    telefono: p.Cliente.Telefono || null,
  } : null

  // Items de Centum (aplicar descuentos al precio)
  const items_delivery = (p.PedidoVentaArticulos || []).map((item, idx) => {
    let precio = item.Precio
    if (precio != null) {
      const d1 = item.PorcentajeDescuento1 || 0
      const d2 = item.PorcentajeDescuento2 || 0
      const d3 = item.PorcentajeDescuento3 || 0
      precio = precio * (1 - d1 / 100) * (1 - d2 / 100) * (1 - d3 / 100)
      precio = Math.round(precio * 100) / 100
    }
    return {
      id: item.IdPedidoVentaArticulo || `centum-${idx}`,
      cantidad: item.Cantidad || 0,
      precio,
      observaciones: item.Observaciones || null,
      articulos: {
        id: item.IdArticulo || null,
        codigo: item.Codigo || null,
        nombre: item.Nombre || item.NombreArticulo || 'Sin nombre',
      },
    }
  })

  // Pedido anulado en Centum
  const anulado = p.Anulado === true || p.Anulado === 1
  // Suscripto en Centum → pagado o entregado automáticamente
  const suscripto = estado_centum && typeof estado_centum === 'string' && estado_centum.toLowerCase().includes('suscripto')

  // Determinar estado local
  let estadoFinal = local?.estado || 'pendiente_pago'
  if (anulado) estadoFinal = 'cancelado'
  else if (suscripto && (estadoFinal === 'pendiente_pago' || estadoFinal === 'pagado')) {
    // Si tenemos turno de factura, determinar entregado vs pagado
    if (turnoFacturaNombre) {
      const turnoLower = turnoFacturaNombre.toLowerCase()
      // RETIRADO o ENTREGADO → entregado (cliente ya retiró/se entregó)
      // NO RETIRADO o NO ENTREGADO → pagado (pendiente de entrega)
      if ((turnoLower.includes('retirado') && !turnoLower.includes('no retirado')) ||
          (turnoLower.includes('entregado') && !turnoLower.includes('no entregado'))) {
        estadoFinal = 'entregado'
      } else {
        estadoFinal = 'pagado'
      }
    } else if (estadoFinal === 'pendiente_pago') {
      // Sin turno de factura, al menos marcar como pagado
      estadoFinal = 'pagado'
    }
  }

  return {
    id: p.IdPedidoVenta,
    id_pedido_centum: p.IdPedidoVenta,
    estado: estadoFinal,
    estado_centum: anulado ? 'Anulado' : (estado_centum || local?.estado_centum || null),
    numero_documento: numero_documento || local?.numero_documento || null,
    observaciones: p.Observaciones || local?.observaciones || null,
    direccion_entrega: local?.direccion_entrega || null,
    fecha_entrega: p.FechaEntrega || local?.fecha_entrega || null,
    created_at: p.FechaDocumento || local?.created_at || null,
    clientes,
    sucursales: sucursalLocal ? { id: sucursalLocal.id, nombre: sucursalLocal.nombre } : null,
    sucursal_id: sucursalLocal?.id || local?.sucursal_id || null,
    perfiles: local?.perfiles || null,
    items_delivery,
  }
}

/**
 * Anula un pedido de venta en Centum.
 * POST /PedidosVenta/Anular/{idPedidoVenta}
 * @param {number} idPedidoVenta - ID entero del pedido en Centum
 * @returns {Promise<Object>}
 */
async function anularPedidoCentum(idPedidoVenta) {
  const url = `${BASE_URL}/PedidosVenta/Anular/${idPedidoVenta}`
  const inicio = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'api',
    })
    throw new Error('Error al conectar con Centum ERP: ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
    })
    throw new Error(`Error al anular pedido Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json().catch(() => ({ anulado: true }))

  registrarLlamada({
    servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'api',
  })

  return data
}

/**
 * Crea un Pedido de Venta en Centum con artículos completos (para recrear un pedido editado).
 * A diferencia de crearPedidoVentaCentum (artículo fijo 08136), recibe los artículos originales.
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function crearPedidoVentaCompletoCentum({
  idCliente,
  fechaEntrega,
  observaciones,
  sucursalFisicaId,
  articulos,
  bonificacion,
  vendedor,
  turnoEntrega,
  condicionVenta,
  transporte,
}) {
  const url = `${BASE_URL}/PedidosVenta`
  const inicio = Date.now()

  const body = {
    Cliente: { IdCliente: idCliente },
    NumeroDocumento: { PuntoVenta: 4 },
    FechaEntrega: `${fechaEntrega}T00:00:00`,
    Observaciones: observaciones || '',
    PedidoVentaArticulos: articulos.map(a => ({
      IdArticulo: a.IdArticulo,
      Codigo: a.Codigo,
      Nombre: a.Nombre,
      Cantidad: a.Cantidad,
      Precio: a.Precio,
      PorcentajeDescuento1: a.PorcentajeDescuento1 || 0,
      PorcentajeDescuento2: a.PorcentajeDescuento2 || 0,
      PorcentajeDescuento3: a.PorcentajeDescuento3 || 0,
      PorcentajeDescuentoMaximo: a.PorcentajeDescuentoMaximo || 100,
      CategoriaImpuestoIVA: a.CategoriaImpuestoIVA,
    })),
    Bonificacion: bonificacion || { IdBonificacion: 6235 },
    Vendedor: vendedor || { IdVendedor: 2 },
    TurnoEntrega: turnoEntrega || { IdTurnoEntrega: 8782 },
  }

  if (sucursalFisicaId) body.SucursalFisica = { IdSucursalFisica: sucursalFisicaId }
  if (condicionVenta) body.CondicionVenta = condicionVenta
  if (transporte) body.Transporte = transporte

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'api',
    })
    throw new Error('Error al conectar con Centum ERP: ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
    })
    throw new Error(`Error al crear pedido de venta en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'api',
  })

  return data
}

/**
 * Crea una Venta (factura) suscribiendo un PedidoVenta existente en Centum.
 * POST /Ventas
 * @param {number} idPedidoVenta - ID del pedido a suscribir
 * @param {number} idCliente - ID del cliente en Centum
 * @param {number} sucursalFisicaId - ID de sucursal física en Centum
 * @returns {Promise<Object>} Venta creada (IdVenta, Total, NumeroDocumento, etc.)
 */
async function crearVentaDesdePedido(idPedidoVenta, idCliente, sucursalFisicaId, pedidoCentum) {
  const url = `${BASE_URL}/Ventas`
  const inicio = Date.now()

  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'

  // Calcular total con descuentos e IVA para Valores
  const articulos = pedidoCentum?.PedidoVentaArticulos || []
  let importeTotal = 0
  for (const a of articulos) {
    let precio = a.Precio || 0
    precio *= (1 - (a.PorcentajeDescuento1 || 0) / 100)
    precio *= (1 - (a.PorcentajeDescuento2 || 0) / 100)
    precio *= (1 - (a.PorcentajeDescuento3 || 0) / 100)
    const iva = a.CategoriaImpuestoIVA?.Tasa || 0
    precio *= (1 + iva / 100)
    importeTotal += precio * (a.Cantidad || 0)
  }
  importeTotal = Math.round(importeTotal * 100) / 100

  const body = {
    FechaImputacion: fechaHoy,
    Cliente: { IdCliente: idCliente },
    SucursalFisica: { IdSucursalFisica: sucursalFisicaId },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },
    NumeroDocumento: { PuntoVenta: 9 },
    PedidoVenta: { IdPedidoVenta: idPedidoVenta },
    EsContado: true,
    VentaValoresEfectivos: [{ IdValor: 13, Cotizacion: 1, Importe: importeTotal }],
    Vendedor: pedidoCentum?.Vendedor || { IdVendedor: 2 },
    CondicionVenta: pedidoCentum?.CondicionVenta || { IdCondicionVenta: 14 },
    Bonificacion: pedidoCentum?.Bonificacion || { IdBonificacion: 6235 },
    Transporte: pedidoCentum?.Transporte || undefined,
    VentaArticulos: (pedidoCentum?.PedidoVentaArticulos || []).map(a => ({
      IdArticulo: a.IdArticulo,
      Codigo: a.Codigo,
      Nombre: a.Nombre,
      Cantidad: a.Cantidad,
      Precio: a.Precio,
      PorcentajeDescuento1: a.PorcentajeDescuento1 || 0,
      PorcentajeDescuento2: a.PorcentajeDescuento2 || 0,
      PorcentajeDescuento3: a.PorcentajeDescuento3 || 0,
      PorcentajeDescuentoMaximo: a.PorcentajeDescuentoMaximo || 100,
      CategoriaImpuestoIVA: a.CategoriaImpuestoIVA,
      ClaseDescuento: a.ClaseDescuento || { IdClaseDescuento: 0 },
      Comision: { IdComision: 6089, Calculada: 0 },
      ImpuestoInterno: a.ImpuestoInterno || 0,
    })),
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_ventas', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'api',
    })
    throw new Error('Error al conectar con Centum ERP (Ventas): ' + err.message)
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_ventas', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
    })
    throw new Error(`Error al crear venta en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_ventas', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'api',
  })

  return data
}

/**
 * Crea un Cobro para una Venta en Centum (registra el pago con IdValor 13 = Mercado Pago).
 * POST /Cobros
 * @param {number} idVenta - ID de la venta a cobrar
 * @param {number} idCliente - ID del cliente en Centum
 * @param {number} sucursalFisicaId - ID de sucursal física en Centum
 * @param {number} importe - Monto total a cobrar
 * @returns {Promise<Object>} Cobro creado
 */
async function crearCobroDeVenta(idVenta, idCliente, sucursalFisicaId, importe) {
  const url = `${BASE_URL}/Cobros`
  const inicio = Date.now()

  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const body = {
    FechaImputacion: fechaHoy,
    Cliente: { IdCliente: idCliente },
    SucursalFisica: { IdSucursalFisica: sucursalFisicaId },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 6 },
    NumeroDocumento: { PuntoVenta: 9 },
    Vendedor: { IdVendedor: 2 },
    CobroAnticipos: [{ Importe: importe }],
    CobroEfectivos: [{
      Valor: { IdValor: 13 },
      Importe: importe,
      Cotizacion: 1,
      CotizacionMonedaRespectoMonedaCliente: 1,
    }],
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_cobros', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'api',
    })
    throw new Error('Error al conectar con Centum ERP (Cobros): ' + err.message)
  }

  // Centum devuelve 500 ErrorNoEsperadoCreacionComprobanteException en la serialización
  // de la respuesta, pero el cobro SÍ se crea correctamente. Aceptamos 500 como éxito.
  const texto = await response.text()
  let data = {}
  try { data = JSON.parse(texto) } catch { /* response may not be JSON on 500 */ }

  if (response.ok) {
    registrarLlamada({
      servicio: 'centum_cobros', endpoint: url, metodo: 'POST',
      estado: 'ok', status_code: response.status, duracion_ms: Date.now() - inicio,
      items_procesados: 1, origen: 'api',
    })
    return data
  }

  if (response.status === 500) {
    // 500 = cobro creado pero error en serialización de respuesta
    logger.warn(`[Cobro] Centum devolvió 500 pero el cobro se crea igualmente (idVenta=${idVenta})`)
    registrarLlamada({
      servicio: 'centum_cobros', endpoint: url, metodo: 'POST',
      estado: 'ok_con_warning', status_code: 500, duracion_ms: Date.now() - inicio,
      items_procesados: 1, error_mensaje: 'HTTP 500 pero cobro creado', origen: 'api',
    })
    return { _cobroCreadoConWarning: true, ...data }
  }

  // Otros errores (400, 404, etc.) sí son errores reales
  registrarLlamada({
    servicio: 'centum_cobros', endpoint: url, metodo: 'POST',
    estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
    error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'api',
  })
  throw new Error(`Error al crear cobro en Centum (${response.status}): ${texto.slice(0, 500)}`)
}

module.exports = { fetchPedidosCentum, fetchPedidoCentum, mapCentumPedido, formatNumeroDocumento, anularPedidoCentum, crearPedidoVentaCompletoCentum, extractFacturaFromEstados, crearVentaDesdePedido, crearCobroDeVenta }
