require('dotenv').config()
const { generateAccessToken } = require('./src/services/syncERP')

const BASE_URL = process.env.CENTUM_BASE_URL
const API_KEY = process.env.CENTUM_API_KEY
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2'

;(async () => {
  const at1 = generateAccessToken(API_KEY)
  const hoy = new Date().toISOString().split('T')[0]
  const artResp = await fetch(BASE_URL + '/Articulos/Venta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at1 },
    body: JSON.stringify({ IdCliente: 2, FechaDocumento: hoy, Habilitado: true }),
  })
  const artData = await artResp.json()
  const items = artData?.Articulos?.Items || []
  const vinos = items.filter(a => a.SubRubro?.Codigo === 'VINOS' && a.Precio > 0).slice(0, 6)

  console.log('6 vinos seleccionados:')
  vinos.forEach(v => console.log('  ', v.IdArticulo, (v.NombreFantasia||v.Nombre)?.slice(0,45), 'Precio:', v.Precio))

  // Usar parámetros exactos de la venta real: CondicionVentaID=1, SucFis=6084, ListaPrecio=1
  const at2 = generateAccessToken(API_KEY)
  const body = {
    NumeroDocumento: { PuntoVenta: 13 },
    Bonificacion: { IdBonificacion: 6235 },
    EsContado: true,
    Cliente: { IdCliente: 2 },
    CondicionVenta: { IdCondicionVenta: 1 },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },
    Vendedor: { IdVendedor: 2 },
    PorcentajeDescuento: 0,
    FechaDocumento: hoy,
    ListaPrecio: { IdListaPrecio: 1 },
    IdSucursalFisica: 6084,
    VentaArticulos: vinos.map(v => ({ ...v, Cantidad: 1 })),
  }

  const resp = await fetch(BASE_URL + '/Ventas/DescuentosPorPromocion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at2 },
    body: JSON.stringify(body),
  })
  console.log('\nStatus:', resp.status)
  const result = await resp.json()
  const descs = result.VentaDescuentosPorPromocion || []
  console.log('Descuentos:', descs.length)
  if (descs.length > 0) {
    descs.forEach(d => console.log('  ', JSON.stringify(d)))
  } else {
    // Checkear artículos devueltos
    console.log('VentaArticulos:', (result.VentaArticulos||[]).length)
    result.VentaArticulos?.forEach(a => {
      console.log('  ', (a.NombreFantasia||a.Nombre)?.slice(0,35), 'Cant:', a.Cantidad, 'DescPromo:', a.DescuentoPromocion, 'PorcDesc:', a.PorcentajeDescuento)
    })
  }

  // Probar también con el artículo 5425 (que tuvo descuento en la venta real)
  console.log('\n--- Con artículo 5425 (descuento real en BI) ---')
  const art5425 = items.find(a => a.IdArticulo === 5425)
  if (art5425) {
    console.log('Art:', (art5425.NombreFantasia||art5425.Nombre)?.slice(0,50), 'SubRubro:', art5425.SubRubro?.Nombre)
    const at3 = generateAccessToken(API_KEY)
    const body2 = {
      ...body,
      VentaArticulos: [{ ...art5425, Cantidad: 6 }],
    }
    // Need new token
    const resp2 = await fetch(BASE_URL + '/Ventas/DescuentosPorPromocion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': at3 },
      body: JSON.stringify(body2),
    })
    const result2 = await resp2.json()
    const descs2 = result2.VentaDescuentosPorPromocion || []
    console.log('Descuentos con art 5425 (6 unidades):', descs2.length)
    if (descs2.length > 0) {
      descs2.forEach(d => console.log('  ', JSON.stringify(d).slice(0, 300)))
    }
  }
})()
