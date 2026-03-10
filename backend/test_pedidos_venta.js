require('dotenv').config()
const { generateAccessToken } = require('./src/services/syncERP')
const BASE_URL = process.env.CENTUM_BASE_URL
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

;(async () => {
  // Test 1: GET /PedidosVenta (list all)
  let at = generateAccessToken(API_KEY)
  let resp = await fetch(BASE_URL + '/PedidosVenta', {
    headers: { 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at }
  })
  console.log('GET /PedidosVenta:', resp.status)
  if (resp.ok) {
    const data = await resp.json()
    console.log('Type:', typeof data, Array.isArray(data) ? 'array' : '')
    if (Array.isArray(data)) {
      console.log('Count:', data.length)
      if (data[0]) console.log('First keys:', Object.keys(data[0]).join(', '))
      // Show last 3
      data.slice(-3).forEach(p => console.log('  #' + p.IdPedidoVenta, p.NumeroDocumento?.PuntoVenta + '-' + p.NumeroDocumento?.Numero, 'Estado:', p.Estado?.Nombre || p.Estado, 'Fecha:', p.FechaDocumento))
    } else {
      console.log('Keys:', Object.keys(data).join(', '))
      // Maybe paginated?
      const items = data.Items || data.PedidosVenta || data.Pedidos || Object.values(data).find(v => Array.isArray(v))
      if (items) {
        console.log('Items count:', items.length)
        if (items[0]) console.log('Item keys:', Object.keys(items[0]).join(', '))
        items.slice(-3).forEach(p => console.log('  #' + (p.IdPedidoVenta || p.Id), p.FechaDocumento))
      } else {
        console.log('Raw:', JSON.stringify(data).slice(0, 1000))
      }
    }
  } else {
    const text = await resp.text()
    console.log('Error:', text.slice(0, 500))
  }

  // Test 2: Try with query params (date filter, etc)
  at = generateAccessToken(API_KEY)
  const hoy = new Date().toISOString().split('T')[0]
  resp = await fetch(BASE_URL + '/PedidosVenta?FechaDesde=' + hoy, {
    headers: { 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at }
  })
  console.log('\nGET /PedidosVenta?FechaDesde=' + hoy + ':', resp.status)
  if (resp.ok) {
    const data = await resp.json()
    const items = Array.isArray(data) ? data : data.Items || data.PedidosVenta || []
    console.log('Count:', items.length || Object.keys(data).length)
  }

  // Test 3: Try POST /PedidosVenta/Buscar or /PedidosVenta/Listar
  for (const path of ['/PedidosVenta/Buscar', '/PedidosVenta/Listar', '/PedidosVenta/Consultar']) {
    at = generateAccessToken(API_KEY)
    resp = await fetch(BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at },
      body: JSON.stringify({ FechaDesde: hoy, FechaHasta: hoy }),
    })
    console.log('\nPOST ' + path + ':', resp.status)
    if (resp.ok) {
      const data = await resp.json()
      console.log('Response:', JSON.stringify(data).slice(0, 500))
    }
  }

  // Test 4: Get a known pedido to see its full structure including Estado
  at = generateAccessToken(API_KEY)
  resp = await fetch(BASE_URL + '/PedidosVenta/29209', {
    headers: { 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at }
  })
  if (resp.ok) {
    const data = await resp.json()
    console.log('\n=== Pedido 29209 full structure ===')
    console.log('All keys:', Object.keys(data).join(', '))
    console.log('Estado:', JSON.stringify(data.Estado))
    console.log('FechaDocumento:', data.FechaDocumento)
    console.log('FechaEntrega:', data.FechaEntrega)
    console.log('Cliente:', data.Cliente?.IdCliente, data.EmpresaDireccionCliente?.Empresa?.RazonSocial)
    console.log('SucursalFisica:', data.SucursalFisica?.IdSucursalFisica, data.SucursalFisica?.Nombre)
    console.log('Observaciones:', data.Observaciones)
    console.log('NumeroDocumento:', JSON.stringify(data.NumeroDocumento))
    console.log('Articles:', data.PedidoVentaArticulos?.length)
    data.PedidoVentaArticulos?.forEach(a => {
      console.log('  ', a.Codigo, (a.Nombre || a.NombreFantasia)?.slice(0,40), 'Cant:', a.Cantidad, 'Precio:', a.Precio)
    })
  } else {
    console.log('\nGET /PedidosVenta/29209:', resp.status)
    const text = await resp.text()
    console.log('Error:', text.slice(0, 500))
  }
})()
