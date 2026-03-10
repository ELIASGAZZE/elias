require('dotenv').config()
const { generateAccessToken } = require('./src/services/syncERP')
const { crearPedidoVentaCentum } = require('./src/services/centumClientes')
const BASE_URL = 'https://plataforma5.centum.com.ar:23990/BL7'
const API_KEY = '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb'

async function test() {
  // 1. Create a test PedidoVenta
  console.log('=== Creando PedidoVenta de prueba ===')
  const pvResult = await crearPedidoVentaCentum({
    idCliente: 11928,
    fechaEntrega: '2026-03-06',
    tipo: 'delivery',
    observaciones: 'TEST - Prueba facturacion automatica',
    sucursalFisicaId: 6084,
  })
  const idPedido = pvResult.IdPedidoVenta || pvResult.Id
  console.log('PedidoVenta creado:', idPedido)

  // 2. Get full details
  let headers = {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': '2',
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
  const rDet = await fetch(BASE_URL + '/PedidosVenta/' + idPedido, { headers })
  const det = await rDet.json()
  const articulos = det.PedidoVentaArticulos || []
  console.log('Articulos:', articulos.length)
  articulos.forEach(a => console.log('  -', a.Nombre, 'x', a.Cantidad, '@ $' + a.Precio))

  // Calculate total with IVA
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
  console.log('Importe total (con IVA):', importeTotal)

  // 3. POST /Ventas
  console.log('\n=== POST /Ventas ===')
  headers = {
    'Content-Type': 'application/json',
    'CentumSuiteConsumidorApiPublicaId': '2',
    'CentumSuiteAccessToken': generateAccessToken(API_KEY),
  }
  const ventaBody = {
    FechaImputacion: '2026-03-05T00:00:00',
    Cliente: { IdCliente: det.Cliente?.IdCliente },
    SucursalFisica: { IdSucursalFisica: det.SucursalFisica?.IdSucursalFisica },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },
    NumeroDocumento: { PuntoVenta: 9 },
    PedidoVenta: { IdPedidoVenta: idPedido },
    EsContado: true,
    Vendedor: det.Vendedor || { IdVendedor: 2 },
    CondicionVenta: det.CondicionVenta || { IdCondicionVenta: 14 },
    Bonificacion: det.Bonificacion || { IdBonificacion: 6235 },
    Transporte: det.Transporte || undefined,
    VentaArticulos: articulos.map(a => ({
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
    VentaValoresEfectivos: [{ IdValor: 13, Cotizacion: 1, Importe: importeTotal }],
  }

  const rVenta = await fetch(BASE_URL + '/Ventas', {
    method: 'POST',
    headers,
    body: JSON.stringify(ventaBody),
  })

  if (rVenta.ok) {
    const venta = await rVenta.json()
    console.log('EXITO! Venta creada!')
    console.log('IdVenta:', venta.IdVenta)
    console.log('NumeroDocumento:', JSON.stringify(venta.NumeroDocumento))
    console.log('Total:', venta.Total || venta.ImporteTotal)

    // 4. Now try POST /Cobros
    console.log('\n=== POST /Cobros ===')
    headers = {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': '2',
      'CentumSuiteAccessToken': generateAccessToken(API_KEY),
    }
    const cobroBody = {
      FechaImputacion: '2026-03-05T00:00:00',
      Cliente: { IdCliente: det.Cliente?.IdCliente },
      SucursalFisica: { IdSucursalFisica: det.SucursalFisica?.IdSucursalFisica },
      TipoComprobanteVenta: { IdTipoComprobanteVenta: 6 },
      NumeroDocumento: { PuntoVenta: 9 },
      Vendedor: det.Vendedor || { IdVendedor: 2 },
      CobroCancelaciones: [{ Venta: { IdVenta: venta.IdVenta, TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 } }, Importe: importeTotal }],
      CobroValores: [{ IdValor: 13, Cotizacion: 1, Importe: importeTotal }],
    }
    const rCobro = await fetch(BASE_URL + '/Cobros', {
      method: 'POST',
      headers,
      body: JSON.stringify(cobroBody),
    })
    if (rCobro.ok) {
      const cobro = await rCobro.json()
      console.log('EXITO! Cobro creado!')
      console.log('IdCobro:', cobro.IdCobro || cobro.Id)
    } else {
      const txt = await rCobro.text()
      console.log('Error Cobro:', rCobro.status, txt.slice(0, 800))
    }
  } else {
    const txt = await rVenta.text()
    console.log('Error Venta:', rVenta.status, txt.slice(0, 800))
  }
}

test().catch(console.error)
