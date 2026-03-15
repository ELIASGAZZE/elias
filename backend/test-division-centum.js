// Script para probar cómo forzar la división PRUEBA en Centum
// Ejecutar: node test-division-centum.js
//
// Prueba 5 variantes para enviar el operador móvil 18 (división Prueba)
// y detectar cuál cambia la división de la venta.
//
// IMPORTANTE: Cada prueba crea una venta REAL en Centum.
// Después de cada prueba, verificar manualmente en Centum en qué división cayó.

require('dotenv').config()
const { generateAccessToken } = require('./src/services/syncERP')

const BASE_URL = process.env.CENTUM_BASE_URL
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'
const OPERADOR_MOVIL_PRUEBA = 18

const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'

// Body base mínimo (Consumidor Final, efectivo, 1 artículo barato)
const bodyBase = {
  FechaImputacion: fechaHoy,
  Cliente: { IdCliente: 2 }, // Consumidor Final (ID 2 en Centum)
  SucursalFisica: { IdSucursalFisica: 1 },
  DivisionEmpresaGrupoEconomico: { IdDivisionEmpresaGrupoEconomico: 2 }, // Prueba
  TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 }, // Factura B
  NumeroDocumento: { PuntoVenta: 2 },
  EsContado: true,
  Vendedor: { IdVendedor: 2 },
  CondicionVenta: { IdCondicionVenta: 14 },
  Bonificacion: { IdBonificacion: 6235 },
  VentaArticulos: [{
    IdArticulo: 205,
    Codigo: '00186',
    Nombre: 'BOCADITO LA VACA LECHERA',
    Cantidad: 1,
    Precio: 9508.98,
    PorcentajeDescuento1: 0,
    PorcentajeDescuento2: 0,
    PorcentajeDescuento3: 0,
    PorcentajeDescuentoMaximo: 100,
    CategoriaImpuestoIVA: { IdCategoriaImpuestoIVA: 4, Tasa: 21 },
    ClaseDescuento: { IdClaseDescuento: 0 },
    Comision: { IdComision: 6089, Calculada: 0 },
    ImpuestoInterno: 0,
  }],
  VentaValoresEfectivos: [{
    IdValor: 1,
    Cotizacion: 1,
    Importe: 9508.98,
  }],
}

// Headers base (sin operador)
function headersBase() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
}

async function probar(nombre, headers, bodyOverride = {}) {
  const body = { ...bodyBase, ...bodyOverride }
  const url = `${BASE_URL}/Ventas`

  console.log(`\n${'='.repeat(60)}`)
  console.log(`PRUEBA: ${nombre}`)
  console.log(`${'='.repeat(60)}`)
  console.log('Headers extra:', JSON.stringify(
    Object.fromEntries(Object.entries(headers).filter(([k]) => !['Content-Type', 'Accept', 'CentumSuiteConsumidorApiPublicaId', 'CentumSuiteAccessToken'].includes(k)))
  ) || '(ninguno)')
  console.log('Body extra keys:', Object.keys(bodyOverride).length ? Object.keys(bodyOverride).join(', ') : '(ninguno)')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const texto = await res.text()
    let data = {}
    try { data = JSON.parse(texto) } catch {}

    if (res.ok) {
      console.log(`✅ HTTP ${res.status} — IdVenta: ${data.IdVenta}`)
      console.log(`   División: ${data.DivisionEmpresaGrupoEconomico?.IdDivisionEmpresaGrupoEconomico || '???'}`)
      console.log(`   Nombre División: ${data.DivisionEmpresaGrupoEconomico?.Nombre || '???'}`)
      console.log(`   Comprobante: ${data.NumeroDocumento?.Numero || '???'}`)
      return { ok: true, division: data.DivisionEmpresaGrupoEconomico?.IdDivisionEmpresaGrupoEconomico, data }
    } else {
      console.log(`❌ HTTP ${res.status}`)
      console.log(`   Response: ${texto.slice(0, 300)}`)
      return { ok: false, status: res.status, error: texto.slice(0, 300) }
    }
  } catch (err) {
    console.log(`💥 Error de conexión: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

async function main() {
  const prueba = process.argv[2] ? parseInt(process.argv[2]) : null

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║  TEST: Forzar División Prueba en Centum         ║')
  console.log('║  Operador Móvil: 18 (División Prueba)           ║')
  console.log('╚══════════════════════════════════════════════════╝')

  if (prueba === null) {
    console.log('\nUso: node test-division-centum.js [1-5]')
    console.log('  1 = CentumSuiteClientUser header')
    console.log('  2 = Usuario.IdUsuario en body')
    console.log('  3 = Vendedor.IdVendedor en body')
    console.log('  4 = OperadorMovil.IdOperadorMovil en body')
    console.log('  5 = CentumSuiteClientUser header + Usuario en body')
    console.log('  6 = CentumSuiteOperadorMovilId header (actual)')
    console.log('  0 = Control (sin cambios, debería caer en Empresa)')
    console.log('\nEjemplo: node test-division-centum.js 1')
    console.log('\n⚠️  Cada prueba crea una venta REAL. Verificar en Centum después.')
    return
  }

  const resultados = []

  switch (prueba) {
    case 0: {
      // Control: sin operador, sin nada extra
      const h = headersBase()
      resultados.push(await probar('CONTROL — Sin operador (debería ir a Empresa)', h))
      break
    }
    case 1: {
      // Prueba 1: CentumSuiteClientUser header
      const h = { ...headersBase(), 'CentumSuiteClientUser': 'api123' }
      resultados.push(await probar('CentumSuiteClientUser: 18 (header)', h))
      break
    }
    case 2: {
      // Prueba 2: Usuario.IdUsuario en body
      const h = headersBase()
      resultados.push(await probar('Usuario.IdUsuario: 18 (body)', h, {
        Usuario: { IdUsuario: OPERADOR_MOVIL_PRUEBA }
      }))
      break
    }
    case 3: {
      // Prueba 3: Vendedor.IdVendedor = 18
      const h = headersBase()
      resultados.push(await probar('Vendedor.IdVendedor: 18 (body)', h, {
        Vendedor: { IdVendedor: OPERADOR_MOVIL_PRUEBA }
      }))
      break
    }
    case 4: {
      // Prueba 4: OperadorMovil.IdOperadorMovil en body
      const h = headersBase()
      resultados.push(await probar('OperadorMovil.IdOperadorMovil: 18 (body)', h, {
        OperadorMovil: { IdOperadorMovil: OPERADOR_MOVIL_PRUEBA }
      }))
      break
    }
    case 5: {
      // Prueba 5: Header + Usuario en body
      const h = { ...headersBase(), 'CentumSuiteClientUser': 'api123' }
      resultados.push(await probar('CentumSuiteClientUser + Usuario.IdUsuario (combo)', h, {
        Usuario: { IdUsuario: OPERADOR_MOVIL_PRUEBA }
      }))
      break
    }
    case 6: {
      // Prueba 6: Lo que tenemos ahora (CentumSuiteOperadorMovilId)
      const h = { ...headersBase(), 'CentumSuiteOperadorMovilId': String(OPERADOR_MOVIL_PRUEBA) }
      resultados.push(await probar('CentumSuiteOperadorMovilId: 18 (header actual)', h))
      break
    }
    default:
      console.log('Prueba no válida. Usar 0-6.')
  }

  console.log('\n' + '='.repeat(60))
  console.log('RESUMEN')
  console.log('='.repeat(60))
  resultados.forEach(r => {
    if (r.ok) {
      console.log(`  División obtenida: ${r.division} ${r.division === 2 ? '✅ PRUEBA' : '⚠️ EMPRESA'}`)
    } else {
      console.log(`  Error: ${r.error?.slice(0, 100)}`)
    }
  })
}

main()
