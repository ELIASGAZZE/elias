// Servicio de sincronización de clientes con ERP Centum
const { generateAccessToken } = require('./syncERP')
const { registrarLlamada } = require('./apiLogger')

const BASE_URL = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

/**
 * Obtiene una página de clientes activos desde Centum ERP.
 * @param {number} pagina - Número de página (1-based)
 * @param {number} cantidadPorPagina - Items por página (default 500)
 * @returns {Promise<{items: Array, total: number}>}
 */
async function fetchClientesCentum(pagina = 1, cantidadPorPagina = 500) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes?activo=true&numeroPagina=${pagina}&cantidadItemsPorPagina=${cantidadPorPagina}`
  const inicio = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'GET',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'GET',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al consultar clientes Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()
  const items = data.Items || data.Clientes?.Items || (Array.isArray(data) ? data : [])
  const total = data.CantidadTotalItems || items.length

  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'GET',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: items.length, origen: 'manual',
  })

  return { items, total }
}

/**
 * Sync incremental: importa clientes creados en las últimas N horas desde Centum BI (SQL Server).
 * Mucho más liviano que el sync masivo vía API REST.
 * @param {number} horasAtras - ventana de tiempo (default 2 horas)
 * @returns {Promise<{nuevos: number, existentes: number}>}
 */
async function syncClientesRecientes(horasAtras = 2) {
  const { getPool } = require('../config/centum')
  const sql = require('mssql')
  const supabase = require('../config/supabase')

  const db = await getPool()
  const desde = new Date(Date.now() - horasAtras * 60 * 60 * 1000)

  const result = await db.request()
    .input('desde', sql.DateTime, desde)
    .query(`
      SELECT ClienteID, CodigoCliente, RazonSocialCliente, CUITCliente,
             DireccionCliente, LocalidadCliente, CodigoPostalCliente, Telefono1Cliente
      FROM Clientes_VIEW
      WHERE ActivoCliente = 1 AND FechaAltaCliente >= @desde
    `)

  if (result.recordset.length === 0) {
    return { nuevos: 0, actualizados: 0 }
  }

  const mapearCliente = (r) => ({
    razon_social: r.RazonSocialCliente?.trim() || 'Sin nombre',
    cuit: r.CUITCliente?.trim() || null,
    direccion: r.DireccionCliente?.trim() || null,
    localidad: r.LocalidadCliente?.trim() || null,
    codigo_postal: r.CodigoPostalCliente?.trim() || null,
    telefono: r.Telefono1Cliente?.trim() || null,
  })

  // Obtener clientes locales con estos id_centum
  const idsCentum = result.recordset.map(r => r.ClienteID)
  const { data: existentes } = await supabase
    .from('clientes')
    .select('id, id_centum')
    .in('id_centum', idsCentum)

  const existentesMap = new Map((existentes || []).map(e => [e.id_centum, e.id]))

  // Separar nuevos y existentes
  const nuevosBI = result.recordset.filter(r => !existentesMap.has(r.ClienteID))
  const existentesBI = result.recordset.filter(r => existentesMap.has(r.ClienteID))

  let nuevosCount = 0
  let actualizadosCount = 0

  // Insertar nuevos
  if (nuevosBI.length > 0) {
    const { data: ultimo } = await supabase
      .from('clientes')
      .select('codigo')
      .like('codigo', 'CLI-%')
      .order('codigo', { ascending: false })
      .limit(1)

    let siguiente = 1
    if (ultimo && ultimo.length > 0) {
      const match = ultimo[0].codigo.match(/CLI-(\d+)/)
      if (match) siguiente = parseInt(match[1]) + 1
    }

    const inserts = nuevosBI.map((r, i) => ({
      codigo: `CLI-${String(siguiente + i).padStart(4, '0')}`,
      ...mapearCliente(r),
      id_centum: r.ClienteID,
      activo: true,
    }))

    const { error } = await supabase.from('clientes').insert(inserts)
    if (error) throw error
    nuevosCount = inserts.length
  }

  // Actualizar existentes
  for (const r of existentesBI) {
    const localId = existentesMap.get(r.ClienteID)
    const { error } = await supabase
      .from('clientes')
      .update(mapearCliente(r))
      .eq('id', localId)
    if (error) console.warn(`[SyncClientes] Error actualizando ${localId}:`, error.message)
    else actualizadosCount++
  }

  return { nuevos: nuevosCount, actualizados: actualizadosCount }
}

/**
 * Retry: busca clientes locales sin id_centum y los crea en Centum.
 * Corre periódicamente desde el cron.
 * @returns {Promise<{reintentados: number, exitosos: number, fallidos: number}>}
 */
async function retrySyncCentum() {
  const supabase = require('../config/supabase')

  const { data: pendientes, error } = await supabase
    .from('clientes')
    .select('*')
    .is('id_centum', null)
    .eq('activo', true)
    .like('codigo', 'CLI-%')
    .order('created_at', { ascending: true })
    .limit(10)

  if (error || !pendientes || pendientes.length === 0) {
    return { reintentados: 0, exitosos: 0, fallidos: 0 }
  }

  let exitosos = 0
  let fallidos = 0

  for (const cliente of pendientes) {
    try {
      const condicion = cliente.condicion_iva || 'CF'
      const resultado = await crearClienteEnCentum(cliente, condicion)
      const idCentum = resultado.IdCliente || resultado.Id || null

      if (idCentum) {
        await supabase
          .from('clientes')
          .update({ id_centum: idCentum })
          .eq('id', cliente.id)

        // Intentar agregar contacto de envío si tiene email/celular
        if (cliente.email || cliente.celular) {
          try {
            await agregarContactoEnvioCentum(idCentum, {
              email: cliente.email,
              celular: cliente.celular,
            })
          } catch (_) { /* best effort */ }
        }

        exitosos++
      } else {
        fallidos++
      }
    } catch (err) {
      console.warn(`[RetryCentum] Falló cliente ${cliente.id} (${cliente.razon_social}):`, err.message)
      fallidos++
    }
  }

  return { reintentados: pendientes.length, exitosos, fallidos }
}

// Mapping de condición IVA para Centum
const CONDICION_IVA_MAP = {
  CF: {
    CondicionIVA: { IdCondicionIVA: 1892, Codigo: 'CF', Nombre: 'Consumidor Final' },
    CondicionVenta: { IdCondicionVenta: 14, Codigo: '1', Nombre: 'CONTADO CONSUMIDOR FINAL / SIN PRONTO PAGO' },
  },
  RI: {
    CondicionIVA: { IdCondicionIVA: 1895, Codigo: 'RI', Nombre: 'Responsable Inscripto' },
    CondicionVenta: { IdCondicionVenta: 1, Codigo: '3', Nombre: 'CONTADO C/ PRONTO PAGO' },
  },
}

/**
 * Crea un cliente en Centum ERP.
 * @param {Object} cliente - Datos del cliente
 * @param {string} condicion_iva - 'CF' o 'RI' (default 'CF')
 * @param {Object} [direccionEntrega] - Dirección de entrega principal { direccion, localidad }
 * @returns {Promise<Object>} - Respuesta del ERP
 */
async function crearClienteEnCentum(cliente, condicion_iva = 'CF', direccionEntrega = null) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes`
  const inicio = Date.now()

  const condicion = CONDICION_IVA_MAP[condicion_iva] || CONDICION_IVA_MAP.CF

  const body = {
    RazonSocial: cliente.razon_social,
    CUIT: cliente.cuit || '',
    Direccion: cliente.direccion || '',
    Localidad: cliente.localidad || '',
    CodigoPostal: cliente.codigo_postal || '',
    Telefono: cliente.telefono || '',
    // Dirección de entrega (si se proporciona)
    CalleEntrega: direccionEntrega?.direccion || '',
    LocalidadEntrega: direccionEntrega?.localidad || '',
    // Campos obligatorios de Centum con defaults
    Provincia: { IdProvincia: 4667, Codigo: '2', Nombre: 'Santa Fe' },
    Pais: { IdPais: 4657, Codigo: 'ARG', Nombre: 'Argentina' },
    Zona: { IdZona: 6099, Codigo: '1', Nombre: 'Zona no identificada' },
    ZonaEntrega: { IdZona: 6095, Codigo: '2', Nombre: 'ROSARIO' },
    CondicionIVA: condicion.CondicionIVA,
    CondicionVenta: condicion.CondicionVenta,
    Vendedor: { IdVendedor: 2, Codigo: '01', Nombre: 'Sin Vendedor' },
    Transporte: { IdTransporte: 1 },
    ListaPrecio: { IdListaPrecio: 1 },
    Bonificacion: { IdBonificacion: 6235 },
    LimiteCredito: { IdLimiteCredito: 46005 },
    ClaseCliente: { IdClaseCliente: 8723 },
    FrecuenciaCliente: { IdFrecuenciaCliente: 6891 },
    CanalCliente: { IdCanalCliente: 6899 },
    CadenaCliente: { IdCadenaCliente: 6920 },
    UbicacionCliente: { IdUbicacionCliente: 6942 },
    EdadesPromedioConsumidoresCliente: { IdEdadesPromedioConsumidoresCliente: 6951 },
    GeneroPromedioConsumidoresCliente: { IdGeneroPromedioConsumidoresCliente: 6964 },
    DiasAtencionCliente: { IdDiasAtencionCliente: 6969 },
    HorarioAtencionCliente: { IdHorarioAtencionCliente: 6970 },
    CigarreraCliente: { IdCigarreraCliente: 6972 },
    CondicionIIBB: { IdCondicionIIBB: 6053, Codigo: '1' },
    DiasMorosidad: 30,
    DiasIncobrables: 180,
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al crear cliente en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })

  return data
}

// Cache de actividades de envío de comprobante (no cambian)
let actividadesCache = null

/**
 * Obtiene los IDs de actividades para envío de comprobante desde Centum.
 * Se cachean en memoria ya que no cambian.
 */
async function getActividadesEnvio() {
  if (actividadesCache) return actividadesCache

  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Actividades/EnvioContactoComprobantes`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
      'CentumSuiteAccessToken': accessToken,
    },
  })

  if (!response.ok) {
    const texto = await response.text()
    throw new Error(`Error al obtener actividades de envío (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()
  // Extraer IDs de actividades
  const items = Array.isArray(data) ? data : (data.Items || [])
  actividadesCache = items.map(a => a.IdActividad || a.Id || a)
  return actividadesCache
}

/**
 * Agrega contacto de envío de comprobante a un cliente en Centum.
 * @param {number} idCliente - ID del cliente en Centum
 * @param {Object} contacto - { email, celular }
 */
async function agregarContactoEnvioCentum(idCliente, { email, celular }) {
  if (!email && !celular) return null

  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/ContactoEnvioComprobanteEmpresa/${idCliente}`
  const inicio = Date.now()

  let idsActividad = []
  try {
    idsActividad = await getActividadesEnvio()
  } catch (err) {
    console.warn('No se pudieron obtener actividades de envío:', err.message)
  }

  const body = {
    Email: email || '',
    Celular: celular || '',
    IdsActividad: idsActividad,
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al agregar contacto envío en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json().catch(() => ({}))

  registrarLlamada({
    servicio: 'centum_clientes', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })

  return data
}

/**
 * Crea un Pedido de Venta en Centum ERP.
 * Artículo fijo: 08136 "PEDIDO APP PADANO GESTION"
 * @param {Object} params
 * @param {number} params.idCliente - ID del cliente en Centum
 * @param {string} params.fechaEntrega - Fecha ISO (YYYY-MM-DD)
 * @param {string} params.tipo - "delivery" o "retiro"
 * @param {string} [params.observaciones] - Observaciones libres
 * @param {number} [params.sucursalFisicaId] - ID de SucursalFisica Centum (solo para retiro)
 * @returns {Promise<Object>} - Respuesta del ERP con el pedido creado
 */
async function crearPedidoVentaCentum({ idCliente, fechaEntrega, tipo, observaciones, sucursalFisicaId }) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/PedidosVenta`
  const inicio = Date.now()

  const obs = observaciones
    ? `Pedido desde App Padano (${tipo === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'}) - ${observaciones}`
    : `Pedido desde App Padano (${tipo === 'delivery' ? 'Delivery' : 'Retiro por Sucursal'})`

  const body = {
    Bonificacion: { IdBonificacion: 6235 },
    Cliente: { IdCliente: idCliente },
    FechaEntrega: `${fechaEntrega}T00:00:00`,
    Observaciones: obs,
    PedidoVentaArticulos: [
      {
        IdArticulo: 8135,
        Codigo: '08136',
        Nombre: 'PEDIDO APP PADANO GESTION',
        Cantidad: 1.0,
        Precio: 1.0,
        CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: 21.0 },
      },
    ],
    Vendedor: { IdVendedor: 2 },
    TurnoEntrega: { IdTurnoEntrega: 8782 },
  }

  // Agregar sucursal física (delivery → Fisherton, retiro → la elegida)
  if (sucursalFisicaId) {
    body.SucursalFisica = { IdSucursalFisica: sucursalFisicaId }
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': accessToken,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', duracion_ms: Date.now() - inicio,
      error_mensaje: err.message, origen: 'manual',
    })
    throw err
  }

  if (!response.ok) {
    const texto = await response.text()
    registrarLlamada({
      servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
      estado: 'error', status_code: response.status, duracion_ms: Date.now() - inicio,
      error_mensaje: `HTTP ${response.status}: ${texto.slice(0, 500)}`, origen: 'manual',
    })
    throw new Error(`Error al crear pedido de venta en Centum (${response.status}): ${texto.slice(0, 500)}`)
  }

  const data = await response.json()

  registrarLlamada({
    servicio: 'centum_pedidos_venta', endpoint: url, metodo: 'POST',
    estado: 'ok', status_code: 200, duracion_ms: Date.now() - inicio,
    items_procesados: 1, origen: 'manual',
  })

  return data
}

module.exports = { fetchClientesCentum, crearClienteEnCentum, agregarContactoEnvioCentum, syncClientesRecientes, retrySyncCentum, crearPedidoVentaCentum }
