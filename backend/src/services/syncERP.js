// Servicio de sincronización con ERP Centum
const crypto = require('crypto')
const supabase = require('../config/supabase')

// Genera el access token para la API de Centum
// Algoritmo: fechaUTC + " " + uuid + " " + SHA1(fechaUTC + " " + uuid + " " + clavePublica)
function generateAccessToken(clavePublica) {
  const now = new Date()
  const fechaUTC = now.getUTCFullYear() + '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(now.getUTCDate()).padStart(2, '0') + 'T' +
    String(now.getUTCHours()).padStart(2, '0') + ':' +
    String(now.getUTCMinutes()).padStart(2, '0') + ':' +
    String(now.getUTCSeconds()).padStart(2, '0')

  const uuid = crypto.randomUUID().replace(/-/g, '').toLowerCase()
  const textoParaHash = fechaUTC + ' ' + uuid + ' ' + clavePublica
  const hashHex = crypto.createHash('sha1').update(textoParaHash, 'utf8').digest('hex').toUpperCase()

  return fechaUTC + ' ' + uuid + ' ' + hashHex
}

/**
 * Sincroniza artículos desde ERP Centum.
 * Retorna { mensaje, cantidad } o lanza error.
 */
async function sincronizarERP() {
  const baseUrl = process.env.CENTUM_BASE_URL || 'https://plataforma5.centum.com.ar:23990/BL7'
  const apiKey = process.env.CENTUM_API_KEY || '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'
  const consumerId = process.env.CENTUM_CONSUMER_ID || '2'
  const clientId = process.env.CENTUM_CLIENT_ID || '2'

  if (!baseUrl || !apiKey) {
    throw new Error('Faltan credenciales del ERP Centum en las variables de entorno')
  }

  const accessToken = generateAccessToken(apiKey)

  // Llamar al ERP Centum
  const hoy = new Date().toISOString().split('T')[0]
  const response = await fetch(`${baseUrl}/Articulos/Venta`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': consumerId,
      'CentumSuiteAccessToken': accessToken,
    },
    body: JSON.stringify({
      IdCliente: parseInt(clientId),
      FechaDocumento: hoy,
      Habilitado: true,
      EsCombo: false,
    }),
  })

  if (!response.ok) {
    const texto = await response.text()
    console.error('Error del ERP Centum:', response.status, texto)
    throw new Error(`Error al conectar con ERP Centum (${response.status})`)
  }

  const erpData = await response.json()

  // Los artículos están en Articulos.Items[]
  const items = erpData?.Articulos?.Items || erpData?.Items || (Array.isArray(erpData) ? erpData : [])
  const articulosERP = items.filter(art => {
    if (art.Habilitado === false) return false
    if (art.EsCombo === true) return false
    const nombre = (art.NombreFantasia || art.Nombre || '').toUpperCase()
    if (nombre.startsWith('COMBO ') || nombre.startsWith('COMBO\t')) return false
    return true
  })

  if (articulosERP.length === 0) {
    return { mensaje: 'No se encontraron artículos habilitados en el ERP', cantidad: 0 }
  }

  // Mapear campos del ERP a nuestro schema
  const articulosMapeados = articulosERP.map(art => ({
    codigo: art.Codigo != null ? String(art.Codigo).trim() : '',
    nombre: art.NombreFantasia || art.Nombre || 'Sin nombre',
    rubro: art.Rubro?.Nombre || null,
    marca: art.MarcaArticulo?.Nombre || null,
    tipo: 'automatico',
  }))

  // Upsert en lotes de 500
  const BATCH_SIZE = 500
  let totalInsertados = 0
  let todosLosArticulos = []

  for (let i = 0; i < articulosMapeados.length; i += BATCH_SIZE) {
    const lote = articulosMapeados.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('articulos')
      .upsert(lote, { onConflict: 'codigo' })
      .select('id')

    if (error) throw error
    todosLosArticulos = todosLosArticulos.concat(data)
    totalInsertados += data.length
  }

  // Crear relaciones con sucursales
  const { data: sucursales } = await supabase
    .from('sucursales')
    .select('id')

  if (sucursales && sucursales.length > 0 && todosLosArticulos.length > 0) {
    const filasRelacion = []
    for (const art of todosLosArticulos) {
      for (const suc of sucursales) {
        filasRelacion.push({
          articulo_id: art.id,
          sucursal_id: suc.id,
          habilitado: false,
        })
      }
    }

    for (let i = 0; i < filasRelacion.length; i += BATCH_SIZE) {
      const lote = filasRelacion.slice(i, i + BATCH_SIZE)
      await supabase
        .from('articulos_por_sucursal')
        .upsert(lote, { onConflict: 'articulo_id,sucursal_id', ignoreDuplicates: true })
    }
  }

  return {
    mensaje: `${totalInsertados} artículos sincronizados desde el ERP`,
    cantidad: totalInsertados,
  }
}

module.exports = { sincronizarERP, generateAccessToken }
