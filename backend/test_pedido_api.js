require('dotenv').config();
const crypto = require('crypto');

const BASE_URL = 'https://plataforma5.centum.com.ar:23990/BL7';
const API_KEY = '0f09803856c74e07a95c637e15b1d742149a72ffcd684e679e5fede6fb89ae3232fd1cc2954941679c91e8d847587aeb';
const CONSUMER_ID = '2';

function gen() {
  const now = new Date();
  const f = now.getUTCFullYear()+'-'+String(now.getUTCMonth()+1).padStart(2,'0')+'-'+String(now.getUTCDate()).padStart(2,'0')+'T'+String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+':'+String(now.getUTCSeconds()).padStart(2,'0');
  const u = crypto.randomUUID().replace(/-/g,'').toLowerCase();
  const h = crypto.createHash('sha1').update(f+' '+u+' '+API_KEY,'utf8').digest('hex').toUpperCase();
  return f+' '+u+' '+h;
}

async function post(path, body) {
  const t = gen();
  const r = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CentumSuiteConsumidorApiPublicaId': CONSUMER_ID,
      'CentumSuiteAccessToken': t,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  return { status: r.status, text: txt };
}

(async () => {
  const base = {
    Cliente: { IdCliente: 604 },
    Vendedor: { IdVendedor: 2 },
    TurnoEntrega: { IdTurnoEntrega: 8782 },
    SeccionSucursalFisica: { IdSeccionSucursalFisica: 6636 },
    FechaEntrega: '2026-03-10T00:00:00',
  };

  // Try with full Articulo object (Codigo + Nombre like Centum uses for other entities)
  const fullArticulo = {
    IdArticulo: 8135,
    Codigo: '08136',
    Nombre: 'PEDIDO APP PADANO GESTION',
  };

  const formats = [
    ['Items + full art', { Items: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }] }],
    ['Renglones', { Renglones: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }] }],
    ['RenglonesDetalle', { RenglonesDetalle: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }] }],
    ['ItemsDetalle', { ItemsDetalle: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }] }],
    ['PedidoVentaItems + full', { PedidoVentaItems: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }] }],
    ['Productos', { Productos: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }] }],
  ];

  for (const [name, extra] of formats) {
    const body = { ...base, ...extra };
    const { status, text } = await post('/PedidosVenta', body);
    const diff = status !== 400 || !text.includes('SinArticulos');
    console.log(`${name}: ${status} ${diff ? '*** DIFF ***' : ''} ${text.substring(0, 120)}`);
  }

  // Also try /PedidoVenta (singular)
  console.log('\n--- Singular endpoint ---');
  const { status: s1, text: t1 } = await post('/PedidoVenta', {
    ...base,
    Items: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }]
  });
  console.log(`/PedidoVenta: ${s1} ${t1.substring(0, 200)}`);

  // Try /PedidosVenta/Crear
  const { status: s2, text: t2 } = await post('/PedidosVenta/Crear', {
    ...base,
    Items: [{ Articulo: fullArticulo, Cantidad: 1.0, Precio: 0.0 }]
  });
  console.log(`/PedidosVenta/Crear: ${s2} ${t2.substring(0, 200)}`);

  process.exit(0);
})();
