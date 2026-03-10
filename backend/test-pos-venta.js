// Test script para debuggear POST /Ventas para POS (sin PedidoVenta previo)
// Uso: node test-pos-venta.js
require('dotenv').config()
const { generateAccessToken } = require('./src/services/syncERP')

const BASE_URL = process.env.CENTUM_BASE_URL
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
}

async function testCrearVenta() {
  const url = `${BASE_URL}/Ventas`
  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'

  // Artículo de prueba: SALENTEIN RESERVE MALBEC *1500ML
  // IdArticulo: 4408, Código: 04340, Precio: 9247.2435
  const precioUnitario = 9247.2435
  const cantidad = 1
  const ivaTasa = 21

  // Probar: precio YA incluye IVA → Importe = precio * cantidad
  const importeSinIVA = Math.round(precioUnitario * cantidad * 100) / 100
  const importeConIVA = Math.round(precioUnitario * cantidad * (1 + ivaTasa / 100) * 100) / 100
  // Intentar con el precio tal cual (sin agregar IVA)
  const importeTotal = importeSinIVA

  console.log('=== TEST POST /Ventas (POS - sin PedidoVenta) ===')
  console.log(`URL: ${url}`)
  console.log(`Importe sin IVA: $${importeSinIVA}`)
  console.log(`Importe con IVA: $${importeConIVA}`)
  console.log(`Usando: $${importeTotal}`)

  const body = {
    FechaImputacion: fechaHoy,
    Cliente: { IdCliente: 2 },                          // Elias Gazze (prueba)
    SucursalFisica: { IdSucursalFisica: 6088 },         // Camara Newbery
    DivisionEmpresa: { IdDivisionEmpresa: 2 },          // "Prueba"
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },// Factura B
    NumeroDocumento: { PuntoVenta: 9 },
    EsContado: true,
    Vendedor: { IdVendedor: 2 },
    CondicionVenta: { IdCondicionVenta: 14 },
    Bonificacion: { IdBonificacion: 6235 },
    VentaArticulos: [{
      IdArticulo: 4408,
      Codigo: '04340',
      Nombre: 'SALENTEIN RESERVE MALBEC *1500ML',
      Cantidad: cantidad,
      Precio: precioUnitario,
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
      IdValor: 1,        // Efectivo (no 13=MP)
      Cotizacion: 1,
      Importe: importeTotal,
    }],
  }

  console.log('\nBody enviado:')
  console.log(JSON.stringify(body, null, 2))

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    })

    const texto = await response.text()
    console.log(`\nHTTP Status: ${response.status}`)
    console.log('Response headers:', Object.fromEntries(response.headers.entries()))

    let data
    try {
      data = JSON.parse(texto)
      console.log('\nResponse JSON:')
      console.log(JSON.stringify(data, null, 2))
    } catch {
      console.log('\nResponse text (no JSON):')
      console.log(texto)
    }

    if (response.ok || response.status === 500) {
      console.log('\n✅ Venta creada (o 500 con creación exitosa)')
      if (data) {
        console.log('IdVenta:', data.IdVenta)
        console.log('Total:', data.Total)
        console.log('NumeroDocumento:', data.NumeroDocumento)
      }
    } else {
      console.log('\n❌ Error al crear venta')
    }
  } catch (err) {
    console.error('\n❌ Error de conexión:', err.message)
  }
}

// Test anular una venta
async function testAnularVenta(idVenta) {
  console.log(`\n=== TEST ANULAR Venta ${idVenta} ===`)

  const endpoints = [
    { url: `${BASE_URL}/Ventas/Anular/${idVenta}`, method: 'POST' },
    { url: `${BASE_URL}/Ventas/${idVenta}/Anular`, method: 'POST' },
    { url: `${BASE_URL}/Ventas/${idVenta}`, method: 'DELETE' },
  ]

  for (const ep of endpoints) {
    console.log(`\nProbando: ${ep.method} ${ep.url}`)
    try {
      const response = await fetch(ep.url, {
        method: ep.method,
        headers: getHeaders(),
      })
      const texto = await response.text()
      console.log(`  Status: ${response.status}`)
      try {
        const data = JSON.parse(texto)
        console.log(`  Response:`, JSON.stringify(data, null, 2).slice(0, 500))
      } catch {
        console.log(`  Response text:`, texto.slice(0, 500))
      }
      if (response.ok) {
        console.log('  ✅ Funcionó!')
        return
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`)
    }
  }
  console.log('\n❌ Ningún endpoint de anulación funcionó')
}

// Test GET venta y crear con Confirmar: false
async function testGetVenta(idVenta) {
  console.log(`\n=== GET Venta ${idVenta} ===`)
  const url = `${BASE_URL}/Ventas/${idVenta}`
  const response = await fetch(url, { method: 'GET', headers: getHeaders() })
  console.log(`Status: ${response.status}`)
  if (response.ok) {
    const data = await response.json()
    // Solo mostrar campos clave
    console.log('IdVenta:', data.IdVenta)
    console.log('NumeroDocumento:', JSON.stringify(data.NumeroDocumento))
    console.log('Total:', data.Total)
    console.log('EsContado:', data.EsContado)
    console.log('Anulado:', data.Anulado)
    console.log('DivisionEmpresa:', JSON.stringify(data.DivisionEmpresa))
    console.log('VentaArticulos precio:', data.VentaArticulos?.[0]?.Precio)
    console.log('DescuentoPromocion:', data.VentaArticulos?.[0]?.DescuentoPromocion)
  } else {
    console.log(await response.text())
  }
}

async function testCrearSinConfirmar() {
  const url = `${BASE_URL}/Ventas`
  const fechaHoy = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const precioUnitario = 9247.2435
  const cantidad = 2

  console.log('\n=== TEST POST /Ventas con Confirmar: false ===')

  const body = {
    FechaImputacion: fechaHoy,
    Confirmar: false,
    Cliente: { IdCliente: 2 },
    SucursalFisica: { IdSucursalFisica: 6088 },
    DivisionEmpresa: { IdDivisionEmpresa: 2 },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },
    NumeroDocumento: { PuntoVenta: 9 },
    EsContado: true,
    Vendedor: { IdVendedor: 2 },
    CondicionVenta: { IdCondicionVenta: 14 },
    Bonificacion: { IdBonificacion: 6235 },
    VentaArticulos: [{
      IdArticulo: 4408,
      Codigo: '04340',
      Nombre: 'SALENTEIN RESERVE MALBEC *1500ML',
      Cantidad: cantidad,
      Precio: precioUnitario,
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
      Importe: Math.round(precioUnitario * cantidad * 100) / 100,
    }],
  }

  console.log('Body Confirmar:', body.Confirmar)
  console.log('Importe:', body.VentaValoresEfectivos[0].Importe)

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  })

  console.log(`Status: ${response.status}`)
  const texto = await response.text()
  try {
    const data = JSON.parse(texto)
    console.log('IdVenta:', data.IdVenta)
    console.log('NumeroDocumento:', JSON.stringify(data.NumeroDocumento))
    console.log('CAE:', data.CAE)
    console.log('Precio artículo:', data.VentaArticulos?.[0]?.Precio)
    console.log('DescuentoPromocion:', data.VentaArticulos?.[0]?.DescuentoPromocion)
    console.log('VentaDescuentosPorPromocion:', JSON.stringify(data.VentaDescuentosPorPromocion))
    return data
  } catch {
    console.log(texto.slice(0, 500))
  }
}

async function main() {
  // Ver la venta anterior
  await testGetVenta(198370)
  // Probar Confirmar: false
  await testCrearSinConfirmar()
}
main()
