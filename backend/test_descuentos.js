require('dotenv').config();
const { generateAccessToken } = require('./src/services/syncERP');
const BASE_URL = process.env.CENTUM_BASE_URL;
const API_KEY = process.env.CENTUM_API_KEY;
const CONSUMER_ID = process.env.CENTUM_CONSUMER_ID || '2';
const CLIENT_ID = process.env.CENTUM_CLIENT_ID || '2';

(async () => {
  // Obtener artículo completo de Centum
  let accessToken = generateAccessToken(API_KEY);
  const hoy = new Date().toISOString().split('T')[0];
  const artResp = await fetch(BASE_URL + '/Articulos/Venta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': accessToken },
    body: JSON.stringify({ IdCliente: parseInt(CLIENT_ID), FechaDocumento: hoy, Habilitado: true }),
  });
  const artData = await artResp.json();
  const items = artData?.Articulos?.Items || [];
  const art = items.find(a => a.IdArticulo === 4036);
  if (!art) { console.log('Art not found'); return; }

  // Usar artículo completo como VentaArticulo, solo agregar Cantidad
  accessToken = generateAccessToken(API_KEY);
  const ventaArt = { ...art, Cantidad: 5 };

  const body = {
    NumeroDocumento: { PuntoVenta: 9 },
    Bonificacion: { IdBonificacion: 6235 },
    EsContado: true,
    Cliente: { IdCliente: 2 },
    CondicionVenta: { IdCondicionVenta: 14 },
    TipoComprobanteVenta: { IdTipoComprobanteVenta: 4 },
    Vendedor: { IdVendedor: 2 },
    PorcentajeDescuento: 0,
    VentaArticulos: [ventaArt],
  };

  const response = await fetch(BASE_URL + '/Ventas/DescuentosPorPromocion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID, 'CentumSuiteAccessToken': accessToken },
    body: JSON.stringify(body),
  });
  console.log('Status:', response.status);
  const text = await response.text();
  const json = JSON.parse(text);
  console.log('VentaDescuentosPorPromocion:', JSON.stringify(json.VentaDescuentosPorPromocion, null, 2));
  console.log('VentaArticulos count:', json.VentaArticulos?.length);
  if (json.VentaArticulos?.length > 0) {
    const art0 = json.VentaArticulos[0];
    console.log('Art[0] Precio:', art0.Precio, 'Cantidad:', art0.Cantidad, 'PorcentajeDescuento:', art0.PorcentajeDescuento, 'ImporteDescuento:', art0.ImporteDescuento);
  }
})();
