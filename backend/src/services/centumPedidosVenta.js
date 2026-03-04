// Servicio para consultar Pedidos de Venta desde la API REST de Centum
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
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
 * Mapea un pedido de Centum al formato que espera el frontend.
 * @param {Object} p - Pedido crudo de la API de Centum
 * @param {Object|null} local - Registro local de pedidos_delivery (estado, perfiles, etc.)
 * @param {Object} sucursalesMap - centum_sucursal_id → { id, nombre }
 */
function mapCentumPedido(p, local, sucursalesMap) {
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

  // Items de Centum
  const items_delivery = (p.PedidoVentaArticulos || []).map((item, idx) => ({
    id: item.IdPedidoVentaArticulo || `centum-${idx}`,
    cantidad: item.Cantidad || 0,
    precio: item.Precio != null ? Math.round(item.Precio * 100) / 100 : null,
    observaciones: item.Observaciones || null,
    articulos: {
      id: item.IdArticulo || null,
      codigo: item.Codigo || null,
      nombre: item.Nombre || item.NombreArticulo || 'Sin nombre',
    },
  }))

  // Pedido anulado en Centum
  const anulado = p.Anulado === true || p.Anulado === 1

  return {
    id: p.IdPedidoVenta,
    id_pedido_centum: p.IdPedidoVenta,
    estado: anulado ? 'cancelado' : (local?.estado || 'pendiente_pago'),
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

module.exports = { fetchPedidosCentum, fetchPedidoCentum, mapCentumPedido, formatNumeroDocumento }
