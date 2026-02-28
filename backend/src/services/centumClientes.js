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
 * Crea un cliente en Centum ERP.
 * @param {Object} cliente - Datos del cliente
 * @returns {Promise<Object>} - Respuesta del ERP
 */
async function crearClienteEnCentum(cliente) {
  const accessToken = generateAccessToken(API_KEY)
  const url = `${BASE_URL}/Clientes`
  const inicio = Date.now()

  const body = {
    RazonSocial: cliente.razon_social,
    CUIT: cliente.cuit || '',
    Direccion: cliente.direccion || '',
    Localidad: cliente.localidad || '',
    CodigoPostal: cliente.codigo_postal || '',
    Telefono: cliente.telefono || '',
    // Campos obligatorios de Centum con defaults
    Provincia: { IdProvincia: 4667, Codigo: '2', Nombre: 'Santa Fe' },
    Pais: { IdPais: 4657, Codigo: 'ARG', Nombre: 'Argentina' },
    Zona: { IdZona: 6099, Codigo: '1', Nombre: 'Zona no identificada' },
    ZonaEntrega: { IdZona: 6095, Codigo: '2', Nombre: 'ROSARIO' },
    CondicionIVA: { IdCondicionIVA: 1892, Codigo: 'CF', Nombre: 'Consumidor Final' },
    CondicionVenta: { IdCondicionVenta: 14, Codigo: '1', Nombre: 'CONTADO CONSUMIDOR FINAL / SIN PRONTO PAGO' },
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

module.exports = { fetchClientesCentum, crearClienteEnCentum }
