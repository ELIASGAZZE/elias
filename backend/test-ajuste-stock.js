// Test rápido: verificar permisos de AjustesMovimientoStock en Centum
// Ejecutar: node test-ajuste-stock.js
require('dotenv').config()

const crypto = require('crypto')

const BASE_URL = process.env.CENTUM_BASE_URL
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'
const OPERADOR = process.argv[2] || 'APIFE'  // Pasar operador por CLI
const CONCEPTO_VARIOS = parseInt(process.env.CENTUM_CONCEPTO_VARIOS_TRASPASO || '42')

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

async function testAjusteStock() {
  console.log('=== Test de permisos AjustesMovimientoStock ===\n')
  console.log('Base URL:', BASE_URL)
  console.log('Consumer ID:', CONSUMER_ID)
  console.log('Operador:', OPERADOR)
  console.log('Concepto Varios:', CONCEPTO_VARIOS)
  console.log('')

  // Ajuste de cantidad 0 para no afectar stock real
  // Usamos un artículo conocido con cantidad 0 como prueba
  const body = {
    FechaImputacion: new Date().toISOString(),
    ConceptoVarios: { IdConceptoVarios: CONCEPTO_VARIOS },
    SucursalFisica: { IdSucursalFisica: parseInt(process.argv[3] || '6084') },
    AjusteMovimientoStockItems: [
      {
        IdAjusteMovimientoStockItem: 1,
        Articulo: { IdArticulo: 1450 },  // Un artículo cualquiera
        Cantidad: 1,  // +1 para testear (luego revertimos con -1)
        Existencias: 0,
        CostoReposicion: 0,
        SegundoControlStock: 0,
        ExistenciasSegundoControlStock: 0,
        NumeroLote: '',
        FechaVencimiento: '0001-01-01T00:00:00',
        Observacion: 'TEST - Verificación de permisos API',
      }
    ],
  }

  const url = `${BASE_URL}/AjustesMovimientoStock?bAjustePrevioACero=false`

  console.log('URL:', url)
  console.log('Body:', JSON.stringify(body, null, 2))
  console.log('\nEnviando request...\n')

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
        'CentumSuiteAccessToken': generateAccessToken(API_KEY),
        'CentumSuiteOperadorMovilUser': OPERADOR,
      },
      body: JSON.stringify(body),
    })

    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }

    console.log('HTTP Status:', response.status)
    console.log('Response:', JSON.stringify(data, null, 2))

    if (response.status === 200 || response.status === 201) {
      console.log('\n✅ ÉXITO — Los permisos de AjustesMovimientoStock están habilitados!')
      if (data?.IdAjusteMovimientoStock) {
        console.log('   ID del ajuste creado:', data.IdAjusteMovimientoStock)
      }
    } else if (response.status === 401 || response.status === 403) {
      console.log('\n❌ FALLO — Todavía sin permisos (HTTP', response.status + ')')
    } else {
      console.log('\n⚠️  Respuesta inesperada — revisar detalle arriba')
    }
  } catch (err) {
    console.error('\n❌ Error de conexión:', err.message)
  }
}

testAjusteStock()
